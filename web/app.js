/* ===== Хелперы ===== */
const $ = id => document.getElementById(id);
const rand = n => Math.floor(Math.random() * n);
const pick = arr => arr[rand(arr.length)];

const CUBE_DIR = "летающая по фону хня";
const AUDIO_EXT = ["mp3","wav","ogg","oga","m4a","flac","aac","opus","webm","wma","mid","midi"];

let ASSETS = null;
let zCounter = 30;

function toast(text, ms = 2600) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => { t.hidden = true; }, ms);
}

function bringFront(win) {
  win.style.zIndex = ++zCounter;
}

/* ===== Загрузка списка картинок (сервер или запасной вариант) ===== */
async function loadAssets() {
  try {
    const r = await fetch("/api/assets", { cache: "no-store" });
    if (r.ok) {
      const data = await r.json();
      if (data.dark && data.light && data.cubes) return data;
    }
    throw new Error("no api");
  } catch (e) {
    return FALLBACK_ASSETS;
  }
}

/* ===== Фоны и темы ===== */
const bgA = $("bg-a"), bgB = $("bg-b");
let bgActiveLayer = "a";
const readCustomFlag = t => {
  const v = localStorage.getItem("app-bg-custom-" + t);
  return v === null ? null : v === "1";
};
let bgCustom = { dark: readCustomFlag("dark"), light: readCustomFlag("light") };
let bgIdx = {
  dark: parseInt(localStorage.getItem("app-bg-dark") || "0", 10) || 0,
  light: parseInt(localStorage.getItem("app-bg-light") || "0", 10) || 0
};

function themeKey() {
  return document.documentElement.dataset.theme;
}

function customBgUrl(theme) {
  return (ASSETS && ASSETS.custom && ASSETS.custom[theme]) || null;
}

function setCustomBg(theme, active) {
  bgCustom[theme] = !!active;
  localStorage.setItem("app-bg-custom-" + theme, active ? "1" : "0");
}

function applyBackground() {
  const theme = themeKey();
  const list = (ASSETS && ASSETS[theme]) || [];
  const custom = customBgUrl(theme);
  let url = null;
  if (bgCustom[theme] !== false && custom) {
    url = custom;
  } else if (list.length) {
    const idx = ((bgIdx[theme] % list.length) + list.length) % list.length;
    url = list[idx];
  }
  if (!url) return;
  url = encodeURI(url);
  const nextEl = bgActiveLayer === "a" ? bgB : bgA;
  const curEl = bgActiveLayer === "a" ? bgA : bgB;
  const img = new Image();
  img.onload = () => {
    nextEl.style.backgroundImage = `url("${url}")`;
    nextEl.classList.add("visible");
    curEl.classList.remove("visible");
    bgActiveLayer = bgActiveLayer === "a" ? "b" : "a";
  };
  img.onerror = () => toast("Не нашёл фон: " + decodeURI(url));
  img.src = url;
}

function cycleBackground() {
  const theme = themeKey();
  if (bgCustom[theme] !== false && customBgUrl(theme)) {
    setCustomBg(theme, false);
  } else {
    const list = ASSETS[theme] || [];
    if (!list.length) return;
    bgIdx[theme] = ((bgIdx[theme] % list.length) + list.length + 1) % list.length;
    localStorage.setItem("app-bg-" + theme, bgIdx[theme]);
  }
  applyBackground();
}

async function pickWallpaper() {
  if (!window.desktop || !window.desktop.chooseWallpaper) {
    toast("Свои обои доступны только в приложении");
    return;
  }
  const theme = themeKey();
  const res = await window.desktop.chooseWallpaper(theme);
  if (!res) return;
  ASSETS = ASSETS || {};
  ASSETS.custom = ASSETS.custom || {};
  ASSETS.custom[res.theme] = res.url;
  setCustomBg(res.theme, true);
  applyBackground();
  toast(res.theme === theme ? "Обои обновлены" : "Обои сохранены для другой темы");
}

async function clearWallpaper() {
  if (!window.desktop || !window.desktop.resetWallpaper) return;
  const theme = themeKey();
  await window.desktop.resetWallpaper(theme);
  if (ASSETS && ASSETS.custom) ASSETS.custom[theme] = null;
  setCustomBg(theme, false);
  applyBackground();
  toast("Свои обои убраны");
}

function setTheme(t, spin) {
  if (spin) {
    const yw = $("yin-wrap");
    yw.classList.remove("spin");
    void yw.offsetWidth; // перезапуск анимации
    yw.classList.add("spin");
  }
  document.documentElement.dataset.theme = t;
  $("theme-label").textContent = t === "dark" ? "Тёмная тема" : "Светлая тема";
  localStorage.setItem("app-theme", t);
  // при переключении темы берём второй фон
  const list = ASSETS[themeKey()] || [];
  if (list.length) {
    bgIdx[t] = ((bgIdx[t] % list.length) + list.length + 1) % list.length;
    localStorage.setItem("app-bg-" + t, bgIdx[t]);
  }
  applyBackground();
}

$("theme-btn").addEventListener("click", () => {
  setTheme(themeKey() === "dark" ? "light" : "dark", true);
});
$("bg-btn").addEventListener("click", cycleBackground);
$("bg-custom-btn").addEventListener("click", pickWallpaper);
$("bg-custom-btn").addEventListener("contextmenu", e => {
  e.preventDefault();
  clearWallpaper();
});
if (window.desktop && window.desktop.onBgMenu) {
  window.desktop.onBgMenu(action => {
    if (action === "choose") pickWallpaper();
    else if (action === "reset") clearWallpaper();
  });
}

/* ===== Летающие кубики ===== */
function buildDrift(i, dir) {
  const clampY = y => Math.max(2, Math.min(72, y));
  const sY = clampY(4 + Math.random() * 60);
  const eY = clampY(4 + Math.random() * 60);
  const m1 = clampY(sY + (Math.random() * 22 - 11));
  const m2 = clampY(eY + (Math.random() * 22 - 11));
  const midY = clampY((sY + eY) / 2 + (Math.random() * 16 - 8));
  const x = p => dir > 0 ? p : 100 - p;
  const pts = [
    [x(-12), sY],
    [x(20), m1],
    [x(50), midY],
    [x(80), m2],
    [x(112), eY]
  ];
  return `@keyframes drift-${i} {\n` +
    pts.map((p, k) => `  ${k * 25}% { transform: translate3d(${p[0].toFixed(1)}vw, ${p[1].toFixed(1)}vh, 0); }`).join("\n") +
    "\n}";
}

function renderCubes(images) {
  const cont = $("cubes");
  const styleEl = document.createElement("style");
  let css = "";
  images.forEach((src, i) => {
    const size = Math.round(34 + Math.random() * 44);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const dur = 26 + Math.random() * 34;
    const delay = -(Math.random() * dur);
    const spinDur = (5 + Math.random() * 7).toFixed(1);

    css += buildDrift(i, dir) + "\n";

    const wrap = document.createElement("div");
    wrap.className = "cube-wrap";
    wrap.style.setProperty("--size", size + "px");
    wrap.style.setProperty("--half", size / 2 + "px");
    wrap.style.animationName = "drift-" + i;
    wrap.style.animationDuration = dur.toFixed(1) + "s";
    wrap.style.animationDelay = delay.toFixed(1) + "s";

    const cube = document.createElement("div");
    cube.className = "cube";
    cube.style.animation = `cubeSpin ${spinDur}s linear infinite`;
    if (Math.random() < 0.5) cube.style.animationDirection = "reverse";

    const url = `url("${encodeURI(CUBE_DIR + "/" + src)}")`;
    for (let f = 1; f <= 6; f++) {
      const face = document.createElement("div");
      face.className = "face f" + f;
      face.style.backgroundImage = url;
      cube.appendChild(face);
    }
    wrap.appendChild(cube);
    cont.appendChild(wrap);
  });
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
}

/* ===== Плеер ===== */
const audio = new Audio();
audio.preload = "metadata";

let playlist = [];        // [{name, url, obj?}]
let trackIndex = 0;
let shuffleOn = false;
let lastVolume = parseFloat(localStorage.getItem("app-volume") || "0.8") || 0.8;
let serverMode = false;

const trackTitle = $("track-title");
const progressFill = $("progress-fill");
const btnPlay = $("btn-play");

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ":" + String(sec).padStart(2, "0");
}

function niceName(name) {
  return name.replace(/\.[^.]+$/, "");
}

const miniMetaCache = new Map();

async function updateMiniNow() {
  const cur = playlist[trackIndex];
  const img = $("mini-art");
  const artistEl = $("mini-artist");
  if (!cur) {
    img.hidden = true;
    img.removeAttribute("src");
    artistEl.hidden = true;
    artistEl.textContent = "";
    return;
  }
  let meta = miniMetaCache.get(cur.name);
  if (!meta) {
    try {
      meta = await fetch("/api/track-meta?name=" + encodeURIComponent(cur.name)).then(r => r.json());
    } catch {
      meta = null;
    }
    if (meta && !meta.error) miniMetaCache.set(cur.name, meta);
  }
  const still = playlist[trackIndex] && playlist[trackIndex].name === cur.name;
  if (!still) return;
  if (!meta || meta.error) {
    img.hidden = true;
    artistEl.hidden = true;
    return;
  }
  artistEl.textContent = meta.artist || "";
  artistEl.hidden = !meta.artist;
  if (meta.artUrl) {
    img.onerror = () => { img.hidden = true; };
    img.src = meta.artUrl;
    img.hidden = false;
  }
}

function emitTrackChange() {
  document.dispatchEvent(new CustomEvent("miniplayer:track", {
    detail: {
      name: playlist[trackIndex] ? playlist[trackIndex].name : "",
      index: trackIndex
    }
  }));
  updateMiniNow();
}

function updateTitle() {
  if (!playlist.length) {
    trackTitle.textContent = window.desktop
      ? "Нет музыки — нажми «Выбрать папку»"
      : (serverMode
        ? "Папка «музыка» пуста — закинь туда треки"
        : "Нет музыки — выбери папку или запусти start.bat");
    trackTitle.classList.add("dim");
    emitTrackChange();
    return;
  }
  trackTitle.classList.remove("dim");
  trackTitle.textContent = niceName(playlist[trackIndex].name);
  trackTitle.title = playlist[trackIndex].name;
  emitTrackChange();
}

/* SVG-иконки плеера (у SVG нет свойства hidden — управляем display) */
function updatePlayIcon() {
  $("icon-play").style.display = audio.paused ? "" : "none";
  $("icon-pause").style.display = audio.paused ? "none" : "";
}
function updateMuteIcon() {
  $("icon-vol").style.display = audio.muted ? "none" : "";
  $("icon-mute").style.display = audio.muted ? "" : "none";
}

function renderList() {
  const box = $("track-list");
  box.innerHTML = "";
  playlist.forEach((tr, i) => {
    const d = document.createElement("div");
    d.className = "tr" + (i === trackIndex ? " current" : "");
    d.textContent = niceName(tr.name);
    d.title = tr.name;
    d.addEventListener("click", () => playTrack(i));
    box.appendChild(d);
  });
}

async function loadPlaylist(showToast) {
  let names = null;
  try {
    const r = await fetch("/api/music", { cache: "no-store" });
    if (r.ok) names = await r.json();
  } catch (e) { /* нет сервера (открыто как файл) */ }

  if (Array.isArray(names)) {
    serverMode = true;
    playlist = names.map(n => ({ name: n, url: "музыка/" + encodeURIComponent(n) }));
    $("btn-pick-folder").hidden = !(window.desktop && !playlist.length);
  } else {
    serverMode = false;
    $("btn-pick-folder").hidden = false;
  }
  trackIndex = 0;
  renderList();
  updateTitle();
  if (showToast) {
    toast(serverMode
      ? `Плеер: треков в папке «музыка» — ${playlist.length}`
      : "Сервер не запущен — выбери папку с музыкой вручную");
  }
}

function playTrack(i) {
  if (!playlist.length) {
    if (serverMode) toast("Закинь музыку в папку «музыка» и нажми 🔄");
    else toast("Выбери папку с музыкой кнопкой ниже");
    return;
  }
  trackIndex = ((i % playlist.length) + playlist.length) % playlist.length;
  audio.src = playlist[trackIndex].url;
  audio.play().then(updatePlayIcon).catch(updatePlayIcon);
  updateTitle();
  renderList();
}

function nextTrack(auto = false) {
  if (playlist.length < 1) return;
  if (shuffleOn && playlist.length > 1) {
    let n;
    do { n = rand(playlist.length); } while (n === trackIndex);
    playTrack(n);
  } else {
    playTrack(trackIndex + 1);
  }
}

btnPlay.addEventListener("click", () => {
  if (!playlist.length) { playTrack(0); return; }
  if (audio.paused) {
    if (!audio.src) playTrack(trackIndex); // ещё ничего не выбрано — ставим текущий трек
    else audio.play().catch(updatePlayIcon);
  } else {
    audio.pause();
  }
});

audio.addEventListener("play", updatePlayIcon);
audio.addEventListener("pause", updatePlayIcon);

audio.addEventListener("ended", () => nextTrack(true));

audio.addEventListener("error", () => {
  if (!audio.src || !playlist.length) return;
  toast("Не смог воспроизвести: " + niceName(playlist[trackIndex].name));
  if (playlist.length > 1) nextTrack(true);
});

audio.addEventListener("timeupdate", () => {
  if (isFinite(audio.duration) && audio.duration > 0) {
    progressFill.style.width = (audio.currentTime / audio.duration * 100) + "%";
  }
  $("time-cur").textContent = fmtTime(audio.currentTime);
});
audio.addEventListener("loadedmetadata", () => {
  $("time-total").textContent = fmtTime(audio.duration);
});

$("progress").addEventListener("click", e => {
  if (!isFinite(audio.duration) || !audio.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  audio.currentTime = frac * audio.duration;
});

$("btn-next").addEventListener("click", () => nextTrack());
$("btn-prev").addEventListener("click", () => playTrack(trackIndex - 1));

$("btn-shuffle").addEventListener("click", e => {
  shuffleOn = !shuffleOn;
  e.currentTarget.classList.toggle("active", shuffleOn);
  toast(shuffleOn ? "Перемешка включена" : "Перемешка выключена", 1400);
});

$("volume").addEventListener("input", e => {
  const v = e.target.value / 100;
  audio.volume = v;
  audio.muted = v === 0;
  $("volume-val").textContent = e.target.value;
  localStorage.setItem("app-volume", v);
  updateMuteIcon();
});

$("btn-mute").addEventListener("click", () => {
  audio.muted = !audio.muted;
  if (!audio.muted) audio.volume = lastVolume;
  updateMuteIcon();
});

$("music-refresh").addEventListener("click", () => loadPlaylist(true));

function openNowPlaying() {
  if (window.NowPlaying) window.NowPlaying.open();
  else toast("Плеер с текстом не загрузился");
}

trackTitle.addEventListener("click", () => {
  if (!playlist.length && window.desktop) {
    window.desktop.openMusicFolder();
    return;
  }
  openNowPlaying();
});

$("btn-nowplaying").addEventListener("click", openNowPlaying);

$("music-list").addEventListener("click", () => {
  const box = $("track-list");
  box.hidden = !box.hidden;
});

$("btn-pick-folder").addEventListener("click", async () => {
  if (window.desktop) {
    const names = await window.desktop.pickMusicFolder();
    if (!names) return;
    if (!names.length) {
      toast("В выбранной папке нет музыки");
      return;
    }
    serverMode = true;
    playlist = names.map(n => ({ name: n, url: "музыка/" + encodeURIComponent(n) }));
    renderList();
    playTrack(0);
    toast(`Найдено треков: ${playlist.length}`);
    return;
  }
  $("music-input").click();
});

$("music-input").addEventListener("change", e => {
  const files = [...e.target.files].filter(f => {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    return AUDIO_EXT.includes(ext);
  });
  if (!files.length) { toast("В выбранной папке нет аудиофайлов"); return; }
  playlist = files.map(f => ({ name: f.name, url: URL.createObjectURL(f) }));
  renderList();
  playTrack(0);
  toast(`Найдено треков: ${playlist.length}`);
});

/* ===== Слоты ===== */
const SYMBOLS = ["🍒", "🍋", "⭐", "🔔", "💎", "7️⃣", "🍀", "🎲"];
const reels = [...document.querySelectorAll(".reel")];
let spinning = false;
let spins = 0, jackpots = 0;
let lastJokeIdx = -1;

function showJoke() {
  let i;
  do { i = rand(JOKES.length); } while (i === lastJokeIdx && JOKES.length > 1);
  lastJokeIdx = i;
  $("joke-text").textContent = JOKES[i];
  $("joke-box").hidden = false;
}

function evaluate(results) {
  spins++;
  const msg = $("slots-msg");
  const winEl = $("win-slots");
  const all = results[0] === results[1] && results[1] === results[2];
  const two = results[0] === results[1] || results[1] === results[2] || results[0] === results[2];

  if (all) {
    jackpots++;
    msg.textContent = "🎉 ДЖЕКПОТ! Три в ряд — лови анекдот!";
    msg.classList.add("win");
    showJoke();
    winEl.classList.add("jackpot-glow");
    setTimeout(() => winEl.classList.remove("jackpot-glow"), 3500);
  } else {
    msg.classList.remove("win");
    msg.textContent = two
      ? pick(["Почти! Два из трёх 😏", "Двойняшка! Ещё чуть-чуть…", "Два в ряд — уже тёпло!"])
      : pick(["Мимо. Крути ещё!", "Не повезло — зато красиво.", "Барабаны молчат. Ещё раз?"]);
    $("joke-box").hidden = true;
  }
  $("slots-stats").textContent = `Крутов: ${spins} · Джекпотов: ${jackpots}`;
}

function spin() {
  if (spinning) return;
  spinning = true;
  $("btn-spin").disabled = true;
  $("joke-box").hidden = true;
  const msg = $("slots-msg");
  msg.classList.remove("win");
  msg.textContent = "Барабаны крутятся…";

  const results = [pick(SYMBOLS), pick(SYMBOLS), pick(SYMBOLS)];

  reels.forEach((reel, i) => {
    reel.classList.remove("done");
    reel.classList.add("spinning");
    const iv = setInterval(() => { reel.textContent = pick(SYMBOLS); }, 60);
    setTimeout(() => {
      clearInterval(iv);
      reel.textContent = results[i];
      reel.classList.remove("spinning");
      reel.classList.add("done");
      if (i === 2) {
        evaluate(results);
        spinning = false;
        $("btn-spin").disabled = false;
      }
    }, 650 + i * 500);
  });
}

$("btn-spin").addEventListener("click", spin);

/* ===== Док как в macOS ===== */
function makeDraggable(win) {
  const head = win.querySelector(".win-head");
  head.addEventListener("pointerdown", e => {
    if (e.target.closest(".icon-btn")) return;
    e.preventDefault();
    const r = win.getBoundingClientRect();
    const ox = e.clientX - r.left;
    const oy = e.clientY - r.top;
    win.classList.add("dragging");
    win.style.right = "auto";
    win.style.bottom = "auto";
    bringFront(win);

    const move = ev => {
      let x = ev.clientX - ox;
      let y = ev.clientY - oy;
      x = Math.max(4, Math.min(window.innerWidth - r.width - 4, x));
      y = Math.max(4, Math.min(window.innerHeight - r.height - 4, y));
      win.style.left = x + "px";
      win.style.top = y + "px";
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      win.classList.remove("dragging");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

document.querySelectorAll(".window").forEach(win => {
  if (win.id === "sys-monitor") return;
  makeDraggable(win);
  bringFront(win);
  const closeBtn = win.querySelector(".win-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      win.classList.add("hidden");
      syncDock();
    });
  }
});

function syncDock() {
  document.querySelectorAll("#dock .dock-app[data-win]").forEach(b => {
    const win = $(b.dataset.win);
    b.classList.toggle("running", !win.classList.contains("hidden"));
  });
}

function bounce(btn) {
  btn.classList.remove("bounce");
  void btn.offsetWidth;
  btn.classList.add("bounce");
  setTimeout(() => btn.classList.remove("bounce"), 950);
}

document.querySelectorAll("#dock .dock-app").forEach(b => {
  b.addEventListener("click", () => {
    bounce(b);
    if (b.dataset.win) {
      const win = $(b.dataset.win);
      if (win.classList.contains("hidden")) {
        win.classList.remove("hidden");
        bringFront(win);
      } else {
        win.classList.add("hidden");
      }
      syncDock();
    } else if (b.dataset.url) {
      window.open(b.dataset.url, "_blank", "noopener");
    } else if (b.id === "install-app" && installPrompt) {
      installPrompt.prompt();
      installPrompt = null;
    }
  });
});
syncDock();

/* ===== Установка как приложения (PWA) ===== */
let installPrompt = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  installPrompt = e;
  $("install-app").hidden = false;
});
window.addEventListener("appinstalled", () => {
  $("install-app").hidden = true;
  installPrompt = null;
  toast("Приложение установлено — ищи его в меню «Пуск»");
});

if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* ===== Мост для полноэкранного плеера ===== */
window.miniApp = {
  audio,
  getPlaylist: () => playlist,
  getIndex: () => trackIndex,
  play: i => playTrack(i),
  next: () => nextTrack(),
  prev: () => playTrack(trackIndex - 1),
  isShuffle: () => shuffleOn,
  toggleShuffle: () => $("btn-shuffle").click(),
  openFolder: () => {
    if (window.desktop) window.desktop.openMusicFolder();
  }
};

/* ===== Полоса заголовка (десктопное приложение) ===== */
if (window.desktop) {
  const ICON_MAX = '<svg class="tb-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';
  const ICON_RESTORE = '<svg class="tb-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="3" width="13" height="13" rx="2"/><path d="M4 8v11a2 2 0 0 0 2 2h11"/></svg>';

  function setMaximizedIcon(max) {
    $("tb-max").innerHTML = max ? ICON_RESTORE : ICON_MAX;
    $("tb-max").title = max ? "Восстановить" : "Развернуть";
  }

  $("tb-min").addEventListener("click", () => window.desktop.minimize());
  $("tb-max").addEventListener("click", () => window.desktop.toggleMaximize());
  $("tb-close").addEventListener("click", () => window.desktop.close());
  $("tb-menu").addEventListener("click", e => {
    const r = e.currentTarget.getBoundingClientRect();
    window.desktop.openMenu(Math.round(r.left), Math.round(r.bottom) + 2);
  });
  window.desktop.onMaximized(setMaximizedIcon);
  window.desktop.isMaximized().then(setMaximizedIcon);
}

/* ===== Старт ===== */
(async function init() {
  ASSETS = await loadAssets();

  // тема (сохранённая или тёмная по умолчанию)
  const saved = localStorage.getItem("app-theme") || "dark";
  document.documentElement.dataset.theme = saved;
  $("theme-label").textContent = saved === "dark" ? "Тёмная тема" : "Светлая тема";

  // громкость
  audio.volume = lastVolume;
  $("volume").value = Math.round(lastVolume * 100);
  $("volume-val").textContent = Math.round(lastVolume * 100);
  updateMuteIcon();
  updatePlayIcon();

  applyBackground();
  renderCubes(ASSETS.cubes || []);
  await loadPlaylist(false);
})();
