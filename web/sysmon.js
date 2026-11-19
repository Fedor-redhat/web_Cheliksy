(function () {
  const $ = id => document.getElementById(id);
  const panel = $('sys-monitor');
  const player = $('win-player');
  if (!panel || !player) return;

  if (!window.desktop || typeof window.desktop.getSystemStats !== 'function') {
    panel.hidden = true;
    return;
  }

  const toggle = $('sys-toggle');
  const live = $('sys-live');
  let busy = false;
  let lastAt = 0;

  const collapsed = localStorage.getItem('sysmon:collapsed') === '1';
  panel.classList.toggle('collapsed', collapsed);

  toggle.addEventListener('click', () => {
    const next = panel.classList.toggle('collapsed');
    localStorage.setItem('sysmon:collapsed', next ? '1' : '0');
    place();
    if (!next) refresh();
  });

  function fmtBytes(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    if (n < 1024) return Math.round(n) + ' Б';
    const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
    let value = n;
    let i = -1;
    do {
      value /= 1024;
      i++;
    } while (value >= 1024 && i < units.length - 1);
    return (value >= 100 ? Math.round(value) : value.toFixed(1)) + ' ' + units[i];
  }

  function fmtSpeed(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    return fmtBytes(n) + '/с';
  }

  function fmtUptime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return d + 'д ' + h + 'ч';
    if (h) return h + 'ч ' + m + 'м';
    return m + 'м';
  }

  function setBar(barId, pct, hotAt) {
    const bar = $(barId);
    if (!bar) return;
    const v = Math.max(0, Math.min(100, Math.round(pct || 0)));
    bar.style.width = v + '%';
    bar.parentElement.classList.toggle('hot', v >= (hotAt || 85));
  }

  const WEATHER_RU = {
    Clear: 'Ясно',
    Sunny: 'Солнечно',
    'Partly cloudy': 'Переменная облачность',
    'Partly Cloudy': 'Переменная облачность',
    Cloudy: 'Облачно',
    Overcast: 'Пасмурно',
    Mist: 'Дымка',
    Fog: 'Туман',
    Haze: 'Мгла',
    Rain: 'Дождь',
    'Light rain': 'Небольшой дождь',
    'Heavy rain': 'Сильный дождь',
    Drizzle: 'Морось',
    Snow: 'Снег',
    'Light snow': 'Небольшой снег',
    'Heavy snow': 'Сильный снег',
    Sleet: 'Мокрый снег',
    Thunderstorm: 'Гроза',
    'Patchy rain possible': 'Местами дождь'
  };

  function weatherRu(text) {
    if (!text) return '—';
    const clean = String(text).trim();
    return WEATHER_RU[clean] || clean;
  }

  function renderTop(list) {
    const box = $('sys-procs');
    if (!box) return;
    box.textContent = '';
    if (!list || !list.length) {
      const d = document.createElement('div');
      d.className = 'sys-dim';
      d.textContent = 'нет данных';
      box.appendChild(d);
      return;
    }
    for (const p of list) {
      const row = document.createElement('div');
      row.className = 'sys-proc';
      const name = document.createElement('span');
      name.className = 'n';
      name.textContent = String(p.name || '?');
      name.title = String(p.name || '');
      const val = document.createElement('span');
      val.className = 'v';
      val.textContent = p.cpu >= 0.1
        ? (p.cpu < 10 ? p.cpu.toFixed(1) : Math.round(p.cpu)) + '%'
        : fmtBytes(p.mem);
      row.append(name, val);
      box.appendChild(row);
    }
  }

  function render(s) {
    $('sys-host').textContent = s.host || '—';
    $('sys-os').textContent = s.osLabel || '—';
    $('sys-os').title = s.osLabel || '';
    $('sys-uptime').textContent = fmtUptime(s.uptime);

    $('sys-cpu-val').textContent = s.cpu + '%';
    $('sys-cores').textContent = s.cores ? s.cores + ' ядер' : '';
    setBar('sys-cpu-bar', s.cpu);

    const memPct = s.memTotal ? (s.memUsed / s.memTotal) * 100 : 0;
    $('sys-mem-val').textContent = Math.round(memPct) + '%';
    $('sys-mem-txt').textContent = fmtBytes(s.memUsed) + ' / ' + fmtBytes(s.memTotal);
    setBar('sys-mem-bar', memPct);

    if (s.disk) {
      $('sys-disk-name').textContent = 'Диск ' + String(s.disk.mount || 'C:').replace(/[\\/]+$/, '');
      const diskPct = s.disk.pct || (s.disk.total ? (s.disk.used / s.disk.total) * 100 : 0);
      $('sys-disk-val').textContent = Math.round(diskPct) + '%';
      $('sys-disk-txt').textContent = fmtBytes(s.disk.total - s.disk.used) + ' своб.';
      setBar('sys-disk-bar', diskPct, 90);
    } else {
      $('sys-disk-val').textContent = '—';
      $('sys-disk-txt').textContent = '';
    }

    const net = s.net || {};
    $('sys-ip').textContent = net.ip || '—';
    $('sys-down').textContent = fmtSpeed(net.down);
    $('sys-up').textContent = fmtSpeed(net.up);
    $('sys-rx').textContent = fmtBytes(net.rx || 0);
    $('sys-tx').textContent = fmtBytes(net.tx || 0);

    renderTop(s.top);

    const w = s.weather;
    const wBox = $('sys-weather');
    if (w) {
      $('sys-w-text').textContent = weatherRu(w.text);
      $('sys-w-temp').textContent = (w.temp > 0 ? '+' : '') + w.temp + '°';
      $('sys-w-wind').textContent = w.wind + ' км/ч';
      $('sys-w-hum').textContent = w.humidity + '%';
      wBox.hidden = false;
    } else {
      wBox.hidden = true;
    }
  }

  async function refresh() {
    if (busy || panel.hidden || panel.classList.contains('collapsed')) return;
    busy = true;
    live.classList.remove('on');
    try {
      const s = await window.desktop.getSystemStats();
      if (s && !s.error) {
        lastAt = s.at || Date.now();
        render(s);
      } else if (s && s.error) {
        console.warn('sysmon: ' + s.error);
      }
    } catch (e) {
      console.warn('sysmon: ' + (e && e.message));
    } finally {
      busy = false;
      live.classList.add('on');
    }
  }

  function place() {
    if (panel.hidden) return;
    const r = player.getBoundingClientRect();
    if (r.width < 40) {
      panel.hidden = true;
      return;
    }
    const top = Math.round(r.bottom + 12);
    panel.style.top = top + 'px';
    panel.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + 'px';
    panel.style.width = Math.max(230, Math.round(r.width)) + 'px';
    panel.style.maxHeight = Math.max(110, window.innerHeight - top - 96) + 'px';
  }

  function syncVisibility() {
    const playerHidden = player.classList.contains('hidden') ||
      player.hidden ||
      player.getBoundingClientRect().width < 40;
    if (playerHidden) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    place();
  }

  window.addEventListener('resize', () => { syncVisibility(); });
  if (window.ResizeObserver) {
    new ResizeObserver(() => { if (!panel.hidden) place(); }).observe(player);
  }

  setInterval(() => {
    syncVisibility();
    if (!panel.hidden && Date.now() - lastAt > 30000) refresh();
  }, 700);

  setInterval(refresh, 2500);

  syncVisibility();
  refresh();
})();
