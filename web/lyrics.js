/* ===== Полноэкранный плеер с синхронным текстом ===== */
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const overlay = $("now-playing");
  if (!overlay) return;

  const canvas = $("np-canvas");
  const g = canvas.getContext("2d");
  const spec = $("np-spectrum");
  const sg = spec.getContext("2d");
  const lyricsEl = $("np-lyrics");
  const scrollEl = $("np-lyrics-scroll");
  const emptyEl = $("np-lyrics-empty");
  const emptyText = $("np-empty-text");
  const sourceEl = $("np-lyrics-source");
  const artEl = $("np-art");
  const artFallback = $("np-art-fallback");
  const titleEl = $("np-title");
  const artistEl = $("np-artist");
  const eqEl = $("np-eq");
  const fillEl = $("np-progress-fill");
  const knobEl = $("np-progress-knob");
  const curEl = $("np-cur");
  const totalEl = $("np-total");
  const ringEl = $("np-ring");
  const energyEl = $("np-energy-val");
  const offsetChip = $("np-offset-reset");
  const tracklistEl = $("np-tracklist");
  const trackCountEl = $("np-track-count");

  const bridge = () => window.miniApp || null;

  let player = null;
  let audioHooked = false;
  let visible = false;

  let actx = null;
  let analyser = null;
  let freqData = null;
  let timeData = null;
  let rmsSmooth = 0;
  let outGain = null;

  let hue = 212;
  let hueTarget = 212;

  let stars = [];
  let particles = [];
  let rings = [];
  let shoots = [];
  let dust = [];
  let nextShoot = 5;
  let sizeW = 0, sizeH = 0, dpr = 1;

  let bassSmooth = 0, trebleSmooth = 0, energySmooth = 0;
  let bassPrev = 0;
  let lastBeat = 0;
  let lastEnergy = -1;

  let lrc = [];
  let lineEls = [];
  let curIndex = -2;
  let isSynced = false;
  let trackName = "";
  let lyricsToken = 0;
  let artToken = 0;

  let offset = parseFloat(localStorage.getItem("np-offset") || "0") || 0;
  let scrollY = 0;
  let scrollTarget = 0;

  let rafId = 0;
  let lastFrame = 0;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function niceName(name) {
    return String(name || "").replace(/\.[^.]+$/, "");
  }

  function hashHue(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
    return h;
  }

  function setHue(value, instant) {
    hueTarget = ((value % 360) + 360) % 360;
    if (instant) {
      hue = hueTarget;
      overlay.style.setProperty("--np-hue", hue.toFixed(1));
    }
  }

  /* ===== Открытие / закрытие ===== */
  function openView() {
    if (visible) return;
    const b = bridge();
    if (!b) return;

    player = b.audio;
    visible = true;
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("np-open");
    document.body.classList.add("np-open");

    requestAnimationFrame(() => overlay.classList.add("np-visible"));

    ensureGraph();
    resize();
    bindAudio();
    syncPlayState();

    if (!player.src && b.getPlaylist().length) b.play(b.getIndex());

    loadTrack(false);
    startLoop();
  }

  function closeView() {
    if (!visible) return;
    visible = false;
    overlay.classList.remove("np-visible");
    overlay.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("np-open");
    document.body.classList.remove("np-open");
    stopLoop();
    setTimeout(() => {
      if (!visible) overlay.hidden = true;
    }, 380);
  }

  /* ===== Аудио-анализ ===== */
  function ensureGraph() {
    if (!player) return;
    if (actx) {
      actx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      actx = new AC();
      const src = actx.createMediaElementSource(player);
      analyser = actx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.82;
      src.connect(analyser);
      outGain = actx.createGain();
      analyser.connect(outGain);
      outGain.connect(actx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
      timeData = new Uint8Array(analyser.fftSize);
    } catch {
      actx = null;
      analyser = null;
      freqData = null;
      timeData = null;
    }
    if (actx) actx.resume().catch(() => {});
  }

  function average(from, to) {
    if (!freqData) return 0;
    let sum = 0;
    const end = Math.min(to, freqData.length);
    for (let i = from; i < end; i++) sum += freqData[i];
    return sum / Math.max(1, end - from);
  }

  function readAudio(dt, now) {
    if (analyser && player && !player.paused) {
      analyser.getByteFrequencyData(freqData);
      const bass = average(1, 10) / 255;
      const mid = average(10, 60) / 255;
      const treble = average(90, 320) / 255;
      bassSmooth = lerp(bassSmooth, bass, 0.3);
      trebleSmooth = lerp(trebleSmooth, treble, 0.18);

      /* Энергию считаем по реальной громкости (RMS сигнала), а не по сумме
         басов и середины: при громкости 90-100% те упирались в потолок и
         индикатор всё время показывал 100%. */
      analyser.getByteTimeDomainData(timeData);
      let sum = 0;
      for (let i = 0; i < timeData.length; i++) {
        const v = (timeData[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / timeData.length);
      rmsSmooth = lerp(rmsSmooth, rms, rms > rmsSmooth ? 0.35 : 0.1);

      // Громкость колонки компенсируем, чтобы энергия зависела от самой песни,
      // а не от положения ползунка.
      const volComp = clamp(player.volume || 0, 0.06, 1);
      const level = rmsSmooth / volComp;
      // дБ -> проценты: тишина ~0%, обычная музыка ~50-70%, пики ~90-100%
      const db = 20 * Math.log10(Math.max(level, 0.0001));
      const target = clamp((db + 26) * 4.6, 0, 100) / 100;

      energySmooth = lerp(energySmooth, target, target > energySmooth ? 0.3 : 0.08);

      // Частицы рождаются на удар, а не просто на громкий бас: иначе на
      // максимальной громкости они летели бы непрерывно.
      const onset = bass - bassPrev;
      bassPrev = bass;
      if (bassSmooth > 0.62 && onset > 0.04 && now - lastBeat > 280) {
        lastBeat = now;
        burst(7 + Math.round(bassSmooth * 12));
      }
    } else {
      const k = Math.pow(0.92, dt * 60);
      bassSmooth *= k;
      trebleSmooth *= k;
      rmsSmooth *= k;
      energySmooth *= k;
    }
  }

  /* ===== Визуализация ===== */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    sizeW = overlay.clientWidth || window.innerWidth;
    sizeH = overlay.clientHeight || window.innerHeight;
    canvas.width = Math.round(sizeW * dpr);
    canvas.height = Math.round(sizeH * dpr);
    seedStars();
  }

  function seedStars() {
    const count = clamp(Math.round((sizeW * sizeH) / 12500), 60, 260);
    stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * sizeW,
        y: Math.random() * sizeH,
        z: 0.25 + Math.random() * 0.75,
        r: 0.4 + Math.random() * 1.7,
        ph: Math.random() * Math.PI * 2,
        sp: 0.15 + Math.random() * 0.55,
        vx: (Math.random() - 0.5) * 7
      });
    }
    particles = [];
    rings = [];
    dust = [];
    const dustCount = clamp(Math.round((sizeW * sizeH) / 26000), 28, 90);
    for (let i = 0; i < dustCount; i++) {
      dust.push({
        x: Math.random() * sizeW,
        y: Math.random() * sizeH,
        r: 0.6 + Math.random() * 1.8,
        vx: (Math.random() - 0.5) * 10,
        vy: -(6 + Math.random() * 18),
        ph: Math.random() * Math.PI * 2,
        sp: 0.4 + Math.random() * 1.1
      });
    }
  }

  function burst(n) {
    if (sizeW === 0) return;
    const cx = sizeW * (0.55 + Math.random() * 0.2);
    const cy = sizeH * (0.45 + Math.random() * 0.15);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 90 + Math.random() * 260;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed * 0.8,
        life: 0.9 + Math.random() * 0.9,
        max: 1.8,
        r: 0.8 + Math.random() * 2.2
      });
    }
    if (particles.length > 240) particles.splice(0, particles.length - 240);
    rings.push({ r: 18, a: 0.5 });
    if (rings.length > 4) rings.shift();
  }

  function drawBackdrop(t, dt) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, sizeW, sizeH);

    g.globalCompositeOperation = "lighter";
    const cx1 = sizeW * (0.68 + Math.sin(t * 0.11) * 0.05);
    const cy1 = sizeH * (0.3 + Math.cos(t * 0.09) * 0.04);
    const radius = Math.max(sizeW, sizeH) * (0.55 + bassSmooth * 0.08);
    const neb = g.createRadialGradient(cx1, cy1, 0, cx1, cy1, radius);
    neb.addColorStop(0, `hsla(${hue}, 85%, 62%, ${0.13 + energySmooth * 0.09})`);
    neb.addColorStop(0.45, `hsla(${hue + 40}, 85%, 55%, 0.05)`);
    neb.addColorStop(1, "hsla(0, 0%, 0%, 0)");
    g.fillStyle = neb;
    g.fillRect(0, 0, sizeW, sizeH);

    const cx2 = sizeW * (0.2 + Math.cos(t * 0.07) * 0.05);
    const cy2 = sizeH * (0.78 + Math.sin(t * 0.1) * 0.05);
    const neb2 = g.createRadialGradient(cx2, cy2, 0, cx2, cy2, radius * 0.8);
    neb2.addColorStop(0, `hsla(${hue + 80}, 80%, 58%, ${0.07 + energySmooth * 0.05})`);
    neb2.addColorStop(1, "hsla(0, 0%, 0%, 0)");
    g.fillStyle = neb2;
    g.fillRect(0, 0, sizeW, sizeH);

    // Медленные «полярные сияния» — мягкие вытянутые пятна света
    for (let i = 0; i < 3; i++) {
      const ax = sizeW * (0.18 + i * 0.32) + Math.sin(t * 0.16 + i * 1.7) * sizeW * 0.07;
      const ay = sizeH * (0.1 + i * 0.06) + Math.cos(t * 0.12 + i) * sizeH * 0.04;
      const ar = Math.max(sizeW, sizeH) * 0.4;
      g.save();
      g.translate(ax, ay);
      g.rotate(-0.42 + Math.sin(t * 0.09 + i) * 0.12);
      g.scale(2.4, 0.5);
      const aurg = g.createRadialGradient(0, 0, 0, 0, 0, ar);
      aurg.addColorStop(0, `hsla(${hue + i * 46}, 92%, 66%, ${0.045 + trebleSmooth * 0.05})`);
      aurg.addColorStop(0.55, `hsla(${hue + 40 + i * 46}, 92%, 60%, 0.02)`);
      aurg.addColorStop(1, "hsla(0, 0%, 0%, 0)");
      g.fillStyle = aurg;
      g.beginPath();
      g.arc(0, 0, ar, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.globalCompositeOperation = "lighter";

    // Медленно плывущая «пыль» — движение есть даже в тихих местах
    for (const d of dust) {
      d.x += (d.vx + Math.sin(t * d.sp + d.ph) * 6) * dt;
      d.y += d.vy * dt;
      if (d.y < -6) { d.y = sizeH + 6; d.x = Math.random() * sizeW; }
      if (d.x < -6) d.x = sizeW + 6;
      else if (d.x > sizeW + 6) d.x = -6;
      const a = 0.1 + 0.16 * Math.abs(Math.sin(t * d.sp + d.ph));
      g.beginPath();
      g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      g.fillStyle = `hsla(${hue + 18}, 90%, 74%, ${(a + trebleSmooth * 0.12).toFixed(3)})`;
      g.fill();
    }

    g.globalCompositeOperation = "source-over";

    for (const s of stars) {
      s.x += s.vx * s.z * dt * 0.5;
      if (s.x < -4) s.x = sizeW + 4;
      else if (s.x > sizeW + 4) s.x = -4;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * s.sp + s.ph));
      const alpha = clamp((0.22 + 0.58 * tw) * (0.75 + trebleSmooth * 0.8), 0, 1);
      g.beginPath();
      g.arc(s.x, s.y, s.r * (0.8 + trebleSmooth * 0.9), 0, Math.PI * 2);
      g.fillStyle = `rgba(215, 232, 255, ${alpha.toFixed(3)})`;
      g.fill();
    }

    // Падающие звёзды
    nextShoot -= dt;
    if (nextShoot <= 0) {
      nextShoot = 6 + Math.random() * 9;
      shoots.push({
        x: sizeW * (0.12 + Math.random() * 0.7),
        y: sizeH * (0.04 + Math.random() * 0.32),
        vx: 520 + Math.random() * 340,
        vy: 150 + Math.random() * 120,
        life: 1
      });
    }
    for (let i = shoots.length - 1; i >= 0; i--) {
      const s = shoots[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt * 1.4;
      if (s.life <= 0 || s.x > sizeW + 120) {
        shoots.splice(i, 1);
        continue;
      }
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.lineTo(s.x - s.vx * 0.085, s.y - s.vy * 0.085);
      g.strokeStyle = `hsla(${hue + 40}, 92%, 80%, ${(s.life * 0.7).toFixed(3)})`;
      g.lineWidth = 2;
      g.stroke();
      g.beginPath();
      g.arc(s.x, s.y, 1.7, 0, Math.PI * 2);
      g.fillStyle = `rgba(255, 255, 255, ${(s.life * 0.9).toFixed(3)})`;
      g.fill();
    }

    g.globalCompositeOperation = "lighter";

    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += 420 * dt;
      r.a -= dt * 0.85;
      if (r.a <= 0) {
        rings.splice(i, 1);
        continue;
      }
      g.beginPath();
      g.arc(sizeW * 0.62, sizeH * 0.42, r.r, 0, Math.PI * 2);
      g.strokeStyle = `hsla(${hue + 30}, 95%, 70%, ${r.a.toFixed(3)})`;
      g.lineWidth = 1.6;
      g.stroke();
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      const a = clamp(p.life / p.max, 0, 1);
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fillStyle = `hsla(${hue + 20}, 96%, 72%, ${(a * 0.75).toFixed(3)})`;
      g.fill();
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
      g.strokeStyle = `hsla(${hue + 50}, 96%, 76%, ${(a * 0.35).toFixed(3)})`;
      g.lineWidth = Math.max(0.6, p.r * 0.6);
      g.stroke();
    }

    g.globalCompositeOperation = "source-over";
  }

  function drawSpectrum() {
    const w = spec.clientWidth;
    const h = spec.clientHeight;
    if (!w || !h) return;
    const wantW = Math.round(w * dpr);
    const wantH = Math.round(h * dpr);
    if (spec.width !== wantW || spec.height !== wantH) {
      spec.width = wantW;
      spec.height = wantH;
    }
    sg.setTransform(dpr, 0, 0, dpr, 0, 0);
    sg.clearRect(0, 0, w, h);

    const bars = clamp(Math.round(w / 7), 18, 44);
    const gap = 2;
    const bw = (w - gap * (bars - 1)) / bars;
    const playing = !!freqData && player && !player.paused;

    for (let i = 0; i < bars; i++) {
      let v;
      if (playing) {
        const idx = Math.min(freqData.length - 1, Math.floor(Math.pow(i / bars, 1.7) * freqData.length * 0.55) + 2);
        v = freqData[idx] / 255;
      } else {
        v = 0.06 + 0.03 * Math.abs(Math.sin(i * 0.55 + performance.now() / 900));
      }
      const bh = Math.max(2, v * h * 1.1);
      const x = i * (bw + gap);
      const grd = sg.createLinearGradient(0, h, 0, h - bh);
      grd.addColorStop(0, `hsla(${hue}, 90%, 60%, 0.35)`);
      grd.addColorStop(1, `hsla(${hue + 55}, 96%, 72%, 0.95)`);
      sg.fillStyle = grd;
      sg.beginPath();
      if (sg.roundRect) sg.roundRect(x, h - bh, bw, bh, 1.5);
      else sg.rect(x, h - bh, bw, bh);
      sg.fill();
    }
  }

  function updateEnergy() {
    const e = Math.round(clamp(energySmooth, 0, 1) * 100);
    if (e !== lastEnergy) {
      lastEnergy = e;
      ringEl.style.setProperty("--e", String(e));
      energyEl.textContent = e + "%";
    }
  }

  function updateProgress() {
    if (!player) return;
    const d = isFinite(player.duration) && player.duration > 0 ? player.duration : 0;
    const p = d ? clamp(player.currentTime / d, 0, 1) : 0;
    fillEl.style.width = (p * 100).toFixed(2) + "%";
    knobEl.style.left = (p * 100).toFixed(2) + "%";
    const c = fmt(player.currentTime);
    if (curEl.textContent !== c) curEl.textContent = c;
    const tt = d ? fmt(d) : "0:00";
    if (totalEl.textContent !== tt) totalEl.textContent = tt;
  }

  /* ===== Текст ===== */
  function parseLrc(text) {
    const out = [];
    let offsetMs = 0;
    for (const raw of String(text).split(/\r?\n/)) {
      const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
      if (off) {
        offsetMs = parseInt(off[1], 10) || 0;
        continue;
      }
      const times = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
      if (!times.length) continue;
      const content = raw.replace(/\[[^\]]*\]/g, "").trim();
      if (!content) continue;
      for (const m of times) {
        const min = parseInt(m[1], 10);
        const sec = parseFloat(String(m[2]).replace(":", "."));
        out.push({ t: min * 60 + sec - offsetMs / 1000, text: content });
      }
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  function clearLines() {
    lrc = [];
    lineEls = [];
    curIndex = -2;
    isSynced = false;
    lyricsEl.innerHTML = "";
    lyricsEl.className = "np-lyrics";
    scrollEl.classList.remove("plain");
    scrollY = 0;
    scrollTarget = 0;
    lyricsEl.style.transform = "";
  }

  function showEmpty(text) {
    clearLines();
    emptyEl.hidden = false;
    emptyText.textContent = text;
    sourceEl.textContent = "—";
  }

  function setSource(text) {
    sourceEl.textContent = text;
  }

  function renderSynced(list, sourceLabel) {
    clearLines();
    isSynced = true;
    lrc = list;
    emptyEl.hidden = true;
    setSource(sourceLabel);

    const frag = document.createDocumentFragment();
    lineEls = list.map(line => {
      const d = document.createElement("div");
      d.className = "np-line";
      d.textContent = line.text;
      d.addEventListener("click", () => seekTo(line.t));
      frag.appendChild(d);
      return d;
    });
    lyricsEl.appendChild(frag);

    requestAnimationFrame(() => {
      const idx = indexAt(displayTime());
      if (idx >= 0) {
        highlight(idx, true);
        const el = lineEls[idx];
        scrollTarget = scrollEl.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2);
        scrollY = scrollTarget;
        lyricsEl.style.transform = "translate3d(0, " + scrollY.toFixed(2) + "px, 0)";
      }
    });
  }

  function renderPlain(text, sourceLabel) {
    clearLines();
    emptyEl.hidden = true;
    setSource(sourceLabel);
    scrollEl.classList.add("plain");
    lyricsEl.className = "np-lyrics plain";

    const frag = document.createDocumentFragment();
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      const d = document.createElement("div");
      if (!line) {
        d.className = "np-line verse-break";
      } else {
        d.className = "np-line";
        d.textContent = line;
      }
      frag.appendChild(d);
    }
    lyricsEl.appendChild(frag);
  }

  function applyLyrics(payload) {
    if (!payload || payload.error) {
      showEmpty("Не удалось получить текст");
      return;
    }
    if (payload.title) {
      const t = titleEl.textContent;
      if (!t || t === niceName(trackName)) titleEl.textContent = payload.title;
    }
    if (payload.artist && !artistEl.textContent) {
      artistEl.textContent = payload.artist;
      artistEl.hidden = false;
    }

    const src = payload.source;
    const fromLrclib = src === "lrclib" || src === "cache" || payload.cached;
    let label = "";
    if (src === "file") label = "Синхронный текст из .lrc";
    else if (fromLrclib) {
      const m = payload.matched;
      label = "LRCLIB" + (m && m.artist ? " · " + m.artist + " — " + m.title : "") + (payload.cached ? " · кэш" : "");
    }

    if (payload.synced) {
      const parsed = parseLrc(payload.synced);
      if (parsed.length) {
        renderSynced(parsed, label || "Синхронный текст");
        return;
      }
    }
    if (payload.plain) {
      renderPlain(payload.plain, (label ? label + " · " : "") + "без тайминга");
      return;
    }
    showEmpty("Текст этой песни не найден");
    emptyText.textContent = "Текст этой песни не найден — можно загрузить свой .lrc";
  }

  function displayTime() {
    return (player ? player.currentTime : 0) + offset;
  }

  function indexAt(t) {
    let lo = 0;
    let hi = lrc.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lrc[mid].t <= t + 0.1) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  function highlight(idx, force) {
    if (idx === curIndex && !force) return;
    if (curIndex >= 0 && lineEls[curIndex]) {
      lineEls[curIndex].classList.remove("current");
      lineEls[curIndex].style.removeProperty("--p");
    }
    for (const el of lineEls) el.classList.remove("near");
    curIndex = idx;
    if (idx >= 0 && lineEls[idx]) {
      lineEls[idx].classList.add("current");
      if (lineEls[idx - 1]) lineEls[idx - 1].classList.add("near");
      if (lineEls[idx + 1]) lineEls[idx + 1].classList.add("near");
    } else if (idx < 0 && lineEls[0]) {
      lineEls[0].classList.add("near");
    }
  }

  function updateLyrics(dt) {
    if (!isSynced || !lrc.length) return;
    const t = displayTime();
    const idx = indexAt(t);

    if (idx !== curIndex) highlight(idx);

    if (idx >= 0) {
      const line = lrc[idx];
      const next = lrc[idx + 1];
      const span = next ? Math.max(0.4, next.t - line.t) : 4;
      const p = clamp((t - line.t) / span, 0, 1);
      lineEls[idx].style.setProperty("--p", (p * 100).toFixed(1) + "%");

      const el = lineEls[idx];
      scrollTarget = scrollEl.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2);
    } else if (lineEls[0]) {
      const el = lineEls[0];
      scrollTarget = scrollEl.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2);
    }

    scrollY = lerp(scrollY, scrollTarget, Math.min(1, dt * 9));
    lyricsEl.style.transform = "translate3d(0, " + scrollY.toFixed(2) + "px, 0)";
  }

  function seekTo(t) {
    if (!player) return;
    const d = isFinite(player.duration) ? player.duration : 0;
    player.currentTime = clamp(t - offset, 0, d || 0);
  }

  /* ===== Загрузка трека ===== */
  function setTitle(title, artist) {
    titleEl.textContent = title;
    titleEl.title = title;
    artistEl.textContent = artist || "";
    artistEl.hidden = !artist;
  }

  function setArt(url) {
    const token = ++artToken;
    if (!url) {
      artEl.hidden = true;
      artEl.removeAttribute("src");
      artFallback.hidden = false;
      setHue(hashHue(trackName || "music"), false);
      return;
    }
    if (artEl.getAttribute("src") === url && artEl.complete && artEl.naturalWidth) {
      artEl.hidden = false;
      artFallback.hidden = true;
      extractPalette(artEl);
      return;
    }
    artEl.onload = () => {
      if (token !== artToken) return;
      artEl.hidden = false;
      artFallback.hidden = true;
      extractPalette(artEl);
    };
    artEl.onerror = () => {
      if (token !== artToken) return;
      artEl.hidden = true;
      artFallback.hidden = false;
    };
    artEl.src = url;
  }

  function extractPalette(img) {
    try {
      const c = document.createElement("canvas");
      c.width = 24;
      c.height = 24;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(img, 0, 0, 24, 24);
      const data = x.getImageData(0, 0, 24, 24).data;
      let bestHue = 0;
      let bestScore = -1;
      let sinSum = 0;
      let cosSum = 0;
      let weight = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255;
        const gg = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const max = Math.max(r, gg, b);
        const min = Math.min(r, gg, b);
        const l = (max + min) / 2;
        const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
        if (l < 0.12 || l > 0.9 || s < 0.2) continue;
        let h;
        if (max === r) h = ((gg - b) / (max - min)) % 6;
        else if (max === gg) h = (b - r) / (max - min) + 2;
        else h = (r - gg) / (max - min) + 4;
        h = ((h * 60) + 360) % 360;
        const w = s * (1 - Math.abs(l - 0.5));
        sinSum += Math.sin(h * Math.PI / 180) * w;
        cosSum += Math.cos(h * Math.PI / 180) * w;
        weight += w;
        if (w > bestScore) {
          bestScore = w;
          bestHue = h;
        }
      }
      if (weight > 0.2) {
        let avg = Math.atan2(sinSum, cosSum) * 180 / Math.PI;
        if (avg < 0) avg += 360;
        setHue(bestScore > 0.12 ? avg : bestHue, false);
      } else {
        setHue(hashHue(trackName || "music"), false);
      }
    } catch {
      setHue(hashHue(trackName || "music"), false);
    }
  }

  function renderTracklist() {
    const b = bridge();
    if (!b || !tracklistEl) return;
    const list = b.getPlaylist() || [];
    const cur = b.getIndex();
    trackCountEl.textContent = list.length ? String(list.length) : "";
    const frag = document.createDocumentFragment();
    list.forEach((t, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "np-track" + (i === cur ? " active" : "");
      row.dataset.i = String(i);
      row.title = niceName(t.name);
      const num = document.createElement("span");
      num.className = "np-track-num";
      num.textContent = String(i + 1);
      const name = document.createElement("span");
      name.className = "np-track-name";
      name.textContent = niceName(t.name);
      row.append(num, name);
      frag.append(row);
    });
    tracklistEl.replaceChildren(frag);
    const act = tracklistEl.querySelector(".np-track.active");
    if (act) {
      const listRect = tracklistEl.getBoundingClientRect();
      const actRect = act.getBoundingClientRect();
      tracklistEl.scrollTop +=
        (actRect.top - listRect.top) -
        (tracklistEl.clientHeight - actRect.height) / 2;
    }
  }

  async function loadTrack(force) {
    const b = bridge();
    if (!b) return;
    const list = b.getPlaylist();
    const cur = list[b.getIndex()];
    const token = ++lyricsToken;
    renderTracklist();

    if (!cur) {
      trackName = "";
      setTitle("Ничего не играет", "");
      setArt(null);
      showEmpty("Нет музыки — добавь треки в папку");
      return;
    }

    trackName = cur.name;
    setTitle(niceName(cur.name), "");
    setArt(null);
    showEmpty("Ищу текст…");
    emptyText.textContent = "Ищу текст…";

    try {
      const meta = await fetch("/api/track-meta?name=" + encodeURIComponent(cur.name))
        .then(r => r.json());
      if (token !== lyricsToken) return;
      if (meta && !meta.error) {
        setTitle(meta.title || niceName(cur.name), meta.artist || "");
        if (meta.artUrl) setArt(meta.artUrl);
      }
    } catch { /* оставим имя файла */ }

    if (token !== lyricsToken) return;

    try {
      const url = "/api/lyrics?name=" + encodeURIComponent(cur.name) + (force ? "&refresh=1" : "");
      const payload = await fetch(url).then(r => r.json());
      if (token !== lyricsToken) return;
      applyLyrics(payload);
    } catch {
      if (token === lyricsToken) {
        showEmpty("Нет интернета — текст не загрузился");
      }
    }
  }

  /* ===== Управление ===== */
  function syncPlayState() {
    if (!player) return;
    const playing = !player.paused;
    $("np-icon-play").style.display = playing ? "none" : "";
    $("np-icon-pause").style.display = playing ? "" : "none";
    eqEl.classList.toggle("np-paused", !playing);
    overlay.classList.toggle("np-playing", playing);
    $("np-shuffle").classList.toggle("active", !!(bridge() && bridge().isShuffle()));
    syncVolume();
    if (actx && playing) actx.resume().catch(() => {});
  }

  function syncVolume() {
    if (!player) return;
    const v = Math.round((player.muted ? 0 : player.volume) * 100);
    $("np-volume").value = v;
    $("np-volume-val").textContent = v;
    $("np-icon-vol").style.display = player.muted || v === 0 ? "none" : "";
    $("np-icon-mute").style.display = player.muted || v === 0 ? "" : "none";
  }

  function bindAudio() {
    if (!player) player = (bridge() || {}).audio;
    if (audioHooked || !player) return;
    audioHooked = true;
    player.addEventListener("play", syncPlayState);
    player.addEventListener("pause", syncPlayState);
    player.addEventListener("volumechange", syncVolume);
    player.addEventListener("loadedmetadata", () => {
      totalEl.textContent = fmt(player.duration);
    });
  }

  function startLoop() {
    stopLoop();
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function frame(now) {
    if (!visible) return;
    rafId = requestAnimationFrame(frame);
    const dt = clamp((now - lastFrame) / 1000, 0, 0.05);
    lastFrame = now;

    readAudio(dt, now);
    drawBackdrop(now / 1000, dt);
    drawSpectrum();
    updateEnergy();
    updateProgress();
    updateLyrics(dt);

    hue = lerp(hue, hueTarget, Math.min(1, dt * 2.4));
    overlay.style.setProperty("--np-hue", hue.toFixed(1));
  }

  /* ===== События ===== */
  $("np-close").addEventListener("click", closeView);

  $("np-play").addEventListener("click", () => {
    const b = bridge();
    if (!b) return;
    if (!player) player = b.audio;
    if (!player.src) {
      if (b.getPlaylist().length) b.play(b.getIndex());
      return;
    }
    if (player.paused) player.play().catch(() => {});
    else player.pause();
  });

  $("np-prev").addEventListener("click", () => bridge() && bridge().prev());
  $("np-next").addEventListener("click", () => bridge() && bridge().next());
  $("np-shuffle").addEventListener("click", () => {
    const b = bridge();
    if (!b) return;
    b.toggleShuffle();
    $("np-shuffle").classList.toggle("active", b.isShuffle());
  });

  $("np-mute").addEventListener("click", () => {
    if (!player) return;
    player.muted = !player.muted;
    syncVolume();
  });

  $("np-volume").addEventListener("input", e => {
    if (!player) return;
    const v = e.target.value / 100;
    player.volume = v;
    player.muted = v === 0;
    $("np-volume-val").textContent = e.target.value;
    syncVolume();
  });

  $("np-open-folder").addEventListener("click", () => {
    const b = bridge();
    if (b && b.openFolder) b.openFolder();
  });

  tracklistEl.addEventListener("click", e => {
    const row = e.target.closest(".np-track");
    if (!row) return;
    const b = bridge();
    if (!b) return;
    const i = Number(row.dataset.i);
    if (!Number.isInteger(i) || i < 0) return;
    if (i === b.getIndex()) {
      const a = b.audio;
      if (a && a.paused) a.play().catch(() => {});
      return;
    }
    b.play(i);
  });

  $("np-fullscreen").addEventListener("click", toggleFullscreen);

  function toggleFullscreen() {
    if (window.desktop && window.desktop.toggleFullscreen) {
      window.desktop.toggleFullscreen();
      return;
    }
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  function reloadLyrics() {
    loadTrack(true);
  }
  $("np-lyrics-reload").addEventListener("click", reloadLyrics);
  $("np-empty-reload").addEventListener("click", reloadLyrics);

  function setupProgress() {
    const bar = $("np-progress");
    let dragging = false;

    const seekToClient = clientX => {
      if (!player) return;
      const r = bar.getBoundingClientRect();
      const p = clamp((clientX - r.left) / r.width, 0, 1);
      const d = player.duration;
      if (isFinite(d) && d > 0) player.currentTime = p * d;
    };

    bar.addEventListener("pointerdown", e => {
      if (!player) return;
      dragging = true;
      bar.setPointerCapture(e.pointerId);
      seekToClient(e.clientX);
    });
    bar.addEventListener("pointermove", e => {
      if (dragging) seekToClient(e.clientX);
    });
    const stop = () => { dragging = false; };
    bar.addEventListener("pointerup", stop);
    bar.addEventListener("pointercancel", stop);
  }
  setupProgress();

  /* ===== Сдвиг текста ===== */
  function updateOffsetLabel() {
    if (!offset) offsetChip.textContent = "0";
    else offsetChip.textContent = (offset > 0 ? "+" : "") + offset.toFixed(2).replace(/0$/, "");
  }

  function changeOffset(delta) {
    offset = Math.round((offset + delta) * 100) / 100;
    offset = clamp(offset, -15, 15);
    localStorage.setItem("np-offset", String(offset));
    updateOffsetLabel();
    scrollTarget = scrollY;
  }

  $("np-offset-plus").addEventListener("click", () => changeOffset(0.25));
  $("np-offset-minus").addEventListener("click", () => changeOffset(-0.25));
  offsetChip.addEventListener("click", () => {
    offset = 0;
    localStorage.setItem("np-offset", "0");
    updateOffsetLabel();
  });
  updateOffsetLabel();

  /* ===== Загрузка своего .lrc ===== */
  function handleLrcFile(file) {
    if (!file || !trackName) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const parsed = parseLrc(text);
      if (parsed.length) {
        renderSynced(parsed, "Синхронный текст из файла");
      } else {
        renderPlain(text, "Текст из файла");
      }
      if (window.desktop && window.desktop.saveLyrics) {
        window.desktop.saveLyrics(trackName, text).then(ok => {
          if (ok) {
            if (typeof toast === "function") toast("Текст сохранён рядом с треком", 1800);
            setSource(sourceEl.textContent + " · сохранено");
          }
        }).catch(() => {});
      }
    };
    reader.readAsText(file, "utf-8");
  }

  $("np-lrc-file").addEventListener("change", e => {
    handleLrcFile(e.target.files && e.target.files[0]);
    e.target.value = "";
  });
  $("np-empty-lrc").addEventListener("change", e => {
    handleLrcFile(e.target.files && e.target.files[0]);
    e.target.value = "";
  });

  /* ===== Горячие клавиши ===== */
  document.addEventListener("keydown", e => {
    if (!visible) return;
    const tag = (e.target && e.target.tagName) || "";
    const typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable);

    if (e.key === "Escape") {
      e.preventDefault();
      closeView();
    } else if (e.key === " " && !typing) {
      e.preventDefault();
      $("np-play").click();
    } else if (e.key === "F11") {
      e.preventDefault();
      toggleFullscreen();
    } else if (e.key === "ArrowRight" && !typing && player) {
      e.preventDefault();
      player.currentTime = clamp(player.currentTime + 5, 0, player.duration || 0);
    } else if (e.key === "ArrowLeft" && !typing && player) {
      e.preventDefault();
      player.currentTime = clamp(player.currentTime - 5, 0, player.duration || 0);
    }
  });

  document.addEventListener("miniplayer:track", () => {
    if (visible) loadTrack(false);
  });

  window.addEventListener("resize", () => {
    if (visible) resize();
  });

  /* ===== Публичный интерфейс ===== */
  window.NowPlaying = {
    open: openView,
    close: closeView,
    isOpen: () => visible,
    debug: () => ({
      state: actx ? actx.state : null,
      maxFreq: freqData ? Math.max.apply(null, freqData) : -1,
      rms: Math.round(rmsSmooth * 1000) / 1000,
      db: Math.round(20 * Math.log10(Math.max(rmsSmooth, 0.0001)) * 10) / 10,
      vol: player ? Math.round(player.volume * 100) / 100 : null,
      energy: lastEnergy
    }),
    setMonitor: v => {
      if (outGain) outGain.gain.value = v;
    }
  };
})();
