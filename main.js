const { app, BrowserWindow, protocol, shell, ipcMain, Menu, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const mm = require('music-metadata');

const WEB_DIR = path.join(__dirname, 'web');
const CUBE_DIR = path.join(WEB_DIR, 'летающая по фону хня');
const APP_ORIGIN = 'app://local';
const APP_UA = 'VebPrilozhenie/1.1 (personal desktop app)';

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.flac', '.aac',
  '.opus', '.webm', '.wma', '.mid', '.midi']);

const metaCache = new Map();
const artCache = new Map();
const embeddedArt = new Map();
const lyricsCache = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.webm': 'video/webm',
  '.wma': 'audio/x-ms-wma',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi'
};

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true
  }
}]);

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  } catch { /* не критично */ }
  return next;
}

function isDir(p) {
  try {
    return !!p && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function sourceMusicDir() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'source.json'), 'utf8'));
    return cfg.musicDir || '';
  } catch {
    return '';
  }
}

function musicDir() {
  const saved = readSettings().musicDir;
  const candidates = [
    saved,
    sourceMusicDir(),
    path.join(app.getPath('music'), 'Веб-приложение'),
    path.join(app.getPath('userData'), 'музыка')
  ];
  for (const dir of candidates) {
    if (isDir(dir)) return dir;
  }
  const fallback = path.join(app.getPath('music'), 'Веб-приложение');
  try {
    fs.mkdirSync(fallback, { recursive: true });
  } catch { /* путь недоступен — вернём как есть */ }
  return fallback;
}

function listFiles(dir, exts) {
  try {
    return fs.readdirSync(dir)
      .filter(n => {
        const ext = path.extname(n).toLowerCase();
        if (!exts.has(ext)) return false;
        try {
          return fs.statSync(path.join(dir, n)).isFile();
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.localeCompare(b, 'ru'));
  } catch {
    return [];
  }
}

function assetList({ lightOnly = false } = {}) {
  const names = listFiles(WEB_DIR, IMG_EXT);
  const dark = names.filter(n => n.toLowerCase().includes('темн'));
  const light = names.filter(n => !n.toLowerCase().includes('темн') && !/^icon-/i.test(n));
  const cubes = listFiles(CUBE_DIR, IMG_EXT);
  return { dark, light, cubes };
}

function safeJoin(root, relative) {
  const target = path.resolve(root, relative);
  const rootResolved = path.resolve(root);
  if (target === rootResolved || target.startsWith(rootResolved + path.sep)) return target;
  return null;
}

function fileResponse(file, request) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return new Response('Не найдено', { status: 404 });
  }
  if (!stat.isFile()) return new Response('Не найдено', { status: 404 });

  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  };

  const range = request.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      let start = m[1] === '' ? null : Number(m[1]);
      let end = m[2] === '' ? null : Number(m[2]);
      if (start === null && end !== null) {
        start = Math.max(0, stat.size - end);
        end = stat.size - 1;
      } else {
        if (start === null) start = 0;
        if (end === null || end >= stat.size) end = stat.size - 1;
      }
      if (start > end || start >= stat.size) {
        return new Response(null, {
          status: 416,
          headers: { ...headers, 'Content-Range': `bytes */${stat.size}` }
        });
      }
      const chunk = Buffer.alloc(end - start + 1);
      const fd = fs.openSync(file, 'r');
      try {
        fs.readSync(fd, chunk, 0, chunk.length, start);
      } finally {
        fs.closeSync(fd);
      }
      return new Response(new Uint8Array(chunk), {
        status: 206,
        headers: {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': String(chunk.length)
        }
      });
    }
  }

  return new Response(new Uint8Array(fs.readFileSync(file)), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(stat.size) }
  });
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

/* ===== Метаданные треков, обложки и текст песен ===== */

function guessFromName(name) {
  const base = name.replace(/\.[^.]+$/, '').trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: '', title: base };
}

function trackFilePath(name) {
  if (!name || name !== path.basename(name)) return null;
  return safeJoin(musicDir(), name);
}

async function getTrackInfo(name) {
  const file = trackFilePath(name);
  if (!file) return null;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const key = `${name}|${stat.size}|${stat.mtimeMs}`;
  if (metaCache.has(key)) return metaCache.get(key);

  const guess = guessFromName(name);
  let info = {
    file: name,
    title: guess.title,
    artist: guess.artist,
    album: '',
    duration: 0,
    hasArt: false,
    artUrl: null
  };

  try {
    const parsed = await mm.parseFile(file, { duration: true });
    const c = parsed.common || {};
    info.title = (c.title || '').trim() || guess.title;
    info.artist = (c.artist || '').trim() || guess.artist;
    info.album = (c.album || '').trim();
    info.duration = Math.round(parsed.format && parsed.format.duration || 0);
    const pics = c.picture || [];
    if (pics.length) {
      const pic = pics[0];
      const mime = pic.format || 'image/jpeg';
      embeddedArt.set(name, { buffer: Buffer.from(pic.data), mime });
      if (embeddedArt.size > 30) embeddedArt.delete(embeddedArt.keys().next().value);
      info.hasArt = true;
    }
  } catch {
    /* битый тег — останутся данные из имени файла */
  }

  info.artUrl = `/api/art?name=${encodeURIComponent(name)}`;

  metaCache.set(key, info);
  if (metaCache.size > 200) metaCache.delete(metaCache.keys().next().value);
  return info;
}

function artworkCachePath(name, stat) {
  const key = crypto.createHash('sha1')
    .update(`${name}|${stat.size}|${stat.mtimeMs}`).digest('hex');
  return path.join(app.getPath('userData'), 'artwork', key + '.jpg');
}

async function fetchJson(url, ms = 9000, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    let retryable = false;
    try {
      const r = await fetch(url, {
        signal: ac.signal,
        headers: { 'User-Agent': APP_UA, 'Accept': 'application/json' }
      });
      if (process.env.VEB_DEBUG) console.log('FETCH ' + r.status + ' ' + url);
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
      retryable = r.status === 429 || r.status >= 500;
    } catch {
      retryable = true;
    } finally {
      clearTimeout(timer);
    }
    if (!retryable) return null;
    if (attempt < retries) await new Promise(res => setTimeout(res, 900));
  }
  return null;
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\((?:[^)]*)\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function scoreLrcCandidate(c, info) {
  if (!c) return -1;
  const hasSynced = !!c.syncedLyrics;
  const hasPlain = !!c.plainLyrics;
  if (!hasSynced && !hasPlain) return -1;
  let score = hasSynced ? 60 : 14;
  const title = normalizeText(info.title);
  const artist = normalizeText(info.artist);
  const cTitle = normalizeText(c.trackName);
  const cArtist = normalizeText(c.artistName);
  if (title && cTitle === title) score += 25;
  else if (title && (cTitle.includes(title) || title.includes(cTitle))) score += 12;
  if (artist && cArtist && (cArtist.includes(artist) || artist.includes(cArtist))) score += 15;
  if (info.duration && c.duration) {
    const diff = Math.abs(info.duration - c.duration);
    score -= Math.min(45, diff * 1.5);
    if (diff <= 2) score += 8;
  }
  return score;
}

async function findLyrics(info) {
  const track = encodeURIComponent(info.title || '');
  const artist = encodeURIComponent(info.artist || '');
  const duration = info.duration ? `&duration=${encodeURIComponent(info.duration)}` : '';
  const album = info.album ? `&album_name=${encodeURIComponent(info.album)}` : '';

  const attempts = [];
  if (track && artist) {
    attempts.push(`https://lrclib.net/api/get?track_name=${track}&artist_name=${artist}${album}${duration}`);
  }
  if (track && artist) {
    attempts.push(`https://lrclib.net/api/search?track_name=${track}&artist_name=${artist}`);
  }
  if (info.title) {
    attempts.push(`https://lrclib.net/api/search?q=${encodeURIComponent(`${info.artist} ${info.title}`.trim())}`);
  }

  let best = null;
  let bestScore = -Infinity;
  for (const url of attempts) {
    const data = await fetchJson(url);
    if (!data) continue;
    const list = Array.isArray(data) ? data : [data];
    for (const c of list) {
      const score = scoreLrcCandidate(c, info);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best && bestScore >= 95) break;
  }

  if (!best || bestScore < 45) return null;
  return {
    synced: best.syncedLyrics || '',
    plain: best.plainLyrics || '',
    matched: {
      id: best.id,
      title: best.trackName,
      artist: best.artistName,
      album: best.albumName,
      duration: best.duration
    }
  };
}

function lyricsCachePath(name, stat) {
  const key = crypto.createHash('sha1')
    .update(`${name}|${stat.size}|${stat.mtimeMs}`).digest('hex');
  return path.join(app.getPath('userData'), 'lyrics', key + '.json');
}

function readSidecarLrc(name) {
  const base = name.replace(/\.[^.]+$/, '');
  for (const ext of ['.lrc', '.LRC', '.Lrc']) {
    const p = safeJoin(musicDir(), base + ext);
    if (!p) continue;
    try {
      const text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
      if (text.trim()) return text;
    } catch { /* нет файла */ }
  }
  return null;
}

async function getLyricsPayload(name, force) {
  const file = trackFilePath(name);
  if (!file) return { error: 'not_found' };
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return { error: 'not_found' };
  }

  const info = await getTrackInfo(name);
  const base = {
    file: name,
    title: info.title,
    artist: info.artist,
    duration: info.duration
  };

  const sidecar = readSidecarLrc(name);
  if (sidecar) {
    return { ...base, synced: sidecar, plain: '', source: 'file' };
  }

  const cachePath = lyricsCachePath(name, stat);
  if (!force && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached && (cached.synced || cached.plain)) {
        return { ...base, ...cached, source: cached.source || 'cache', cached: true };
      }
    } catch { /* битый кэш — перезагрузим */ }
  }

  const found = await findLyrics(info);
  if (!found) {
    return { ...base, synced: '', plain: '', source: 'none' };
  }

  const payload = {
    synced: found.synced,
    plain: found.plain,
    source: 'lrclib',
    matched: found.matched,
    fetchedAt: new Date().toISOString()
  };
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(payload), 'utf8');
  } catch { /* кэш не обязателен */ }
  return { ...base, ...payload };
}

async function fetchArtwork(name) {
  const file = trackFilePath(name);
  if (!file) return null;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }

  if (embeddedArt.has(name)) return embeddedArt.get(name);

  const cacheFile = artworkCachePath(name, stat);
  if (fs.existsSync(cacheFile)) {
    try {
      return { buffer: fs.readFileSync(cacheFile), mime: 'image/jpeg' };
    } catch { /* перекачаем */ }
  }

  const info = await getTrackInfo(name);
  if (embeddedArt.has(name)) return embeddedArt.get(name);

  if (artCache.has(name)) return artCache.get(name);

  const term = encodeURIComponent(`${info.artist} ${info.title}`.trim() || info.title);
  const data = await fetchJson(`https://itunes.apple.com/search?term=${term}&entity=song&limit=5`);
  const hit = data && data.results && data.results.find(r => r.artworkUrl100);
  if (!hit) return null;

  const artUrl = hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetch(artUrl, { signal: ac.signal, headers: { 'User-Agent': APP_UA } });
    if (!r.ok) return null;
    const buffer = Buffer.from(await r.arrayBuffer());
    const result = { buffer, mime: r.headers.get('content-type') || 'image/jpeg' };
    artCache.set(name, result);
    if (artCache.size > 30) artCache.delete(artCache.keys().next().value);
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, buffer);
    } catch { /* кэш не обязателен */ }
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function imageResponse(art) {
  if (!art) return new Response('Не найдено', { status: 404 });
  return new Response(new Uint8Array(art.buffer), {
    status: 200,
    headers: {
      'Content-Type': art.mime || 'image/jpeg',
      'Cache-Control': 'max-age=3600'
    }
  });
}

function handleAppRequest(request) {
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);
  const name = url.searchParams.get('name') || '';

  if (pathname === '/api/music') {
    return jsonResponse(listFiles(musicDir(), AUDIO_EXT));
  }
  if (pathname === '/api/assets') {
    return jsonResponse(assetList());
  }
  if (pathname === '/api/track-meta') {
    return getTrackInfo(name).then(info => jsonResponse(info || { error: 'not_found' }));
  }
  if (pathname === '/api/lyrics') {
    const force = url.searchParams.get('refresh') === '1';
    return getLyricsPayload(name, force).then(payload => jsonResponse(payload));
  }
  if (pathname === '/api/art') {
    return fetchArtwork(name).then(imageResponse);
  }

  if (pathname.startsWith('/музыка/')) {
    const name = pathname.slice('/музыка/'.length);
    const file = safeJoin(musicDir(), name);
    if (!file) return new Response('Запрещено', { status: 403 });
    return fileResponse(file, request);
  }

  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = safeJoin(WEB_DIR, rel);
  if (!file) return new Response('Запрещено', { status: 403 });
  return fileResponse(file, request);
}

let mainWindow = null;
let isQuitting = false;

function sendMaximizedState(win) {
  win.webContents.send('win:maximized', win.isMaximized());
}

function createWindow() {
  const winSize = (process.env.VEB_WIN_SIZE || '').split('x').map(Number);
  mainWindow = new BrowserWindow({
    width: winSize[0] || 1280,
    height: winSize[1] || 820,
    minWidth: 920,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#0a0c10',
    title: 'Веб-приложение',
    icon: path.join(WEB_DIR, 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  mainWindow.loadURL(`${APP_ORIGIN}/index.html`);

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('maximize', () => sendMaximizedState(mainWindow));
  mainWindow.on('unmaximize', () => sendMaximizedState(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  const selfTestArg = process.argv.find(a => a.startsWith('--selftest='));
  if (selfTestArg) {
    const dir = selfTestArg.slice('--selftest='.length);
    const sleep = ms => new Promise(res => setTimeout(res, ms));
    const shot = async name => {
      const img = await mainWindow.webContents.capturePage();
      fs.writeFileSync(path.join(dir, name), img.toPNG());
    };
    mainWindow.webContents.on('did-finish-load', async () => {
      try {
        await sleep(2500);
        const theme = await mainWindow.webContents.executeJavaScript(
          `document.getElementById('theme-btn').click(); document.documentElement.dataset.theme;`);
        await sleep(1200);
        await shot('theme-light.png');
        console.log('SELFTEST theme=' + theme);

        await mainWindow.webContents.executeJavaScript(`document.getElementById('btn-spin').click(); 'spin'`);
        await sleep(3200);
        const slots = await mainWindow.webContents.executeJavaScript(`({
          reels: [...document.querySelectorAll('.reel')].map(r => r.textContent),
          stats: document.getElementById('slots-stats').textContent,
          joke: !document.getElementById('joke-box').hidden,
          msg: document.getElementById('slots-msg').textContent
        })`);
        console.log('SELFTEST slots=' + JSON.stringify(slots));
        await shot('slots.png');

        await mainWindow.webContents.executeJavaScript(`document.getElementById('btn-play').click(); 'play'`);
        await sleep(2500);
        const audioState = await mainWindow.webContents.executeJavaScript(`({
          paused: audio.paused,
          muted: audio.muted,
          currentTime: Math.round(audio.currentTime * 10) / 10,
          duration: Math.round(audio.duration || 0),
          src: decodeURIComponent(audio.src)
        })`);
        console.log('SELFTEST audio=' + JSON.stringify(audioState));

        const seek = await mainWindow.webContents.executeJavaScript(`new Promise(res => {
          audio.currentTime = Math.max(1, (audio.duration || 2) - 0.5);
          audio.onseeked = () => res({ t: Math.round(audio.currentTime * 10) / 10 });
          setTimeout(() => res({ t: 'timeout ' + Math.round(audio.currentTime * 10) / 10 }), 3000);
        })`);
        console.log('SELFTEST seek=' + JSON.stringify(seek));

        const selected = await mainWindow.webContents.executeJavaScript(`(() => {
          const b = window.miniApp;
          b.audio.muted = true;
          const list = b.getPlaylist();
          const idx = list.findIndex(x => /Спокойная ночь/i.test(x.name));
          if (idx >= 0) b.play(idx);
          window.NowPlaying.open();
          return { idx, name: idx >= 0 ? list[idx].name : null, count: list.length };
        })()`);
        console.log('SELFTEST np-select=' + JSON.stringify(selected));
        await sleep(8000);
        const np = await mainWindow.webContents.executeJavaScript(`({
          open: window.NowPlaying.isOpen(),
          title: document.getElementById('np-title').textContent,
          artist: document.getElementById('np-artist').textContent,
          source: document.getElementById('np-lyrics-source').textContent,
          lines: document.querySelectorAll('#np-lyrics .np-line').length,
          current: (document.querySelector('#np-lyrics .np-line.current') || {}).textContent || null,
          empty: !document.getElementById('np-lyrics-empty').hidden,
          emptyText: document.getElementById('np-empty-text').textContent,
          artVisible: !document.getElementById('np-art').hidden,
          hue: getComputedStyle(document.getElementById('now-playing')).getPropertyValue('--np-hue').trim(),
          htmlClass: document.documentElement.className,
          tbBg: getComputedStyle(document.getElementById('titlebar')).backgroundColor
        })`);
        console.log('SELFTEST np=' + JSON.stringify(np));
        await shot('nowplaying.png');

        await mainWindow.webContents.executeJavaScript(`(() => {
          const a = window.miniApp.audio;
          window.__npVol = a.volume;
          a.muted = false;
          a.volume = 0.8;
          if (window.NowPlaying.setMonitor) window.NowPlaying.setMonitor(0);
          a.currentTime = 62;
          return 'ok';
        })()`);
        await sleep(1600);
        const np2 = await mainWindow.webContents.executeJavaScript(`({
          current: (document.querySelector('#np-lyrics .np-line.current') || {}).textContent || null,
          fill: document.getElementById('np-progress-fill').style.width,
          time: document.getElementById('np-cur').textContent,
          dbg: window.NowPlaying.debug ? window.NowPlaying.debug() : null
        })`);
        console.log('SELFTEST np-play=' + JSON.stringify(np2));
        const series = await mainWindow.webContents.executeJavaScript(`new Promise(res => {
          const arr = [];
          const t = setInterval(() => {
            arr.push(window.NowPlaying.debug().energy);
            if (arr.length >= 8) { clearInterval(t); res(arr); }
          }, 900);
        })`);
        console.log('SELFTEST series=' + JSON.stringify(series));
        await shot('nowplaying-62s.png');
        await mainWindow.webContents.executeJavaScript(`(() => {
          const a = window.miniApp.audio;
          if (window.NowPlaying.setMonitor) window.NowPlaying.setMonitor(1);
          a.muted = true;
          a.volume = window.__npVol;
          return 'ok';
        })()`);
        const listClick = await mainWindow.webContents.executeJavaScript(`(() => {
          const rows = document.querySelectorAll('#np-tracklist .np-track');
          const target = rows[3];
          const name = target ? target.textContent : null;
          if (target) target.click();
          return { rows: rows.length, clicked: name };
        })()`);
        console.log('SELFTEST list=' + JSON.stringify(listClick));
        await sleep(1500);
        const listAfter = await mainWindow.webContents.executeJavaScript(`({
          active: (document.querySelector('#np-tracklist .np-track.active') || {}).textContent || null,
          title: document.getElementById('np-title').textContent,
          src: decodeURIComponent(window.miniApp.audio.src)
        })`);
        console.log('SELFTEST list-after=' + JSON.stringify(listAfter));
      } catch (e) {
        console.log('SELFTEST FAIL ' + e.message);
      }
      app.exit(0);
    });
  }

  const lyricsTestArg = process.argv.find(a => a.startsWith('--lyricstest'));
  if (lyricsTestArg) {
    mainWindow.webContents.on('did-finish-load', async () => {
      await new Promise(res => setTimeout(res, 2000));
      try {
        if (process.env.LT_ONLY) {
          await mainWindow.webContents.executeJavaScript(
            'window.__ltOnly = ' + JSON.stringify(process.env.LT_ONLY) + '; "ok"');
        }
        const results = await mainWindow.webContents.executeJavaScript(`(async () => {
          let names = await (await fetch('/api/music')).json();
          if (window.__ltOnly) names = names.filter(n => n.toLowerCase().includes(window.__ltOnly));
          const out = [];
          for (const n of names) {
            const t0 = performance.now();
            let p;
            try {
              p = await (await fetch('/api/lyrics?name=' + encodeURIComponent(n))).json();
            } catch (e) {
              p = { error: 'fetch ' + e.message };
            }
            out.push({
              n,
              src: p.source || null,
              synced: !!p.synced,
              plain: !!p.plain,
              err: p.error || null,
              ms: Math.round(performance.now() - t0)
            });
            await new Promise(r => setTimeout(r, 700));
          }
          return out;
        })()`);
        for (const r of results) console.log('LT ' + JSON.stringify(r));
        const ok = results.filter(r => r.synced).length;
        const plain = results.filter(r => !r.synced && r.plain).length;
        console.log('LT SUMMARY synced=' + ok + '/' + results.length + ' plain=' + plain);
      } catch (e) {
        console.log('LT FAIL ' + e.message);
      }
      app.exit(0);
    });
  }

  const sysmonArg = process.argv.find(a => a.startsWith('--sysmontest='));
  if (sysmonArg) {
    const dir = sysmonArg.slice('--sysmontest='.length);
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
    mainWindow.webContents.on('did-finish-load', async () => {
      await new Promise(res => setTimeout(res, 9000));
      try {
        if (process.env.SYSMON_THEME === 'light') {
          await mainWindow.webContents.executeJavaScript(`document.getElementById('theme-btn').click(); 'ok'`);
          await new Promise(res => setTimeout(res, 900));
        }
        const info = await mainWindow.webContents.executeJavaScript(`(() => {
          const p = document.getElementById('sys-monitor');
          const pl = document.getElementById('win-player');
          const r = p.getBoundingClientRect();
          const pr = pl.getBoundingClientRect();
          const txt = id => (document.getElementById(id) || {}).textContent || null;
          return {
            visible: !p.hidden,
            panel: { top: Math.round(r.top), right: Math.round(window.innerWidth - r.right), w: Math.round(r.width), h: Math.round(r.height) },
            player: { top: Math.round(pr.top), bottom: Math.round(pr.bottom), w: Math.round(pr.width) },
            host: txt('sys-host'), os: txt('sys-os'), uptime: txt('sys-uptime'),
            cpu: txt('sys-cpu-val'), cores: txt('sys-cores'),
            mem: txt('sys-mem-val'), memTxt: txt('sys-mem-txt'),
            disk: txt('sys-disk-val'), diskTxt: txt('sys-disk-txt'),
            ip: txt('sys-ip'), down: txt('sys-down'), up: txt('sys-up'),
            rx: txt('sys-rx'), tx: txt('sys-tx'),
            procs: [...document.querySelectorAll('#sys-procs .sys-proc')].map(x => x.textContent),
            weatherHidden: document.getElementById('sys-weather').hidden,
            weather: txt('sys-w-temp') + ' ' + txt('sys-w-text')
          };
        })()`);
        console.log('SYSMON ' + JSON.stringify(info));
        const img = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(dir, 'sysmon.png'), img.toPNG());
        console.log('SHOT sysmon.png');
      } catch (e) {
        console.log('SYSMON FAIL ' + e.message);
      }
      app.exit(0);
    });
  }

  const shotArg = process.argv.find(a => a.startsWith('--shot='));
  if (shotArg) {
    const shotPath = shotArg.slice('--shot='.length);
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
    mainWindow.webContents.on('did-finish-load', async () => {
      setTimeout(async () => {
        try {
          const info = await mainWindow.webContents.executeJavaScript(`(async () => {
            const out = { cubes: document.querySelectorAll('.cube-wrap').length, tracks: null, audioTest: null, desktopApi: !!window.desktop };
            let names = [];
            try { names = await (await fetch('/api/music')).json(); out.tracks = names.length; } catch (e) { out.tracks = 'fetch error: ' + e.message; }
            try {
              const r = await fetch('/api/assets'); const a = await r.json();
              out.assets = { dark: a.dark, light: a.light, cubes: a.cubes.length };
            } catch (e) { out.assets = 'fetch error: ' + e.message; }
            if (names.length) {
              out.audioTest = await new Promise(res => {
                const a = new Audio();
                a.preload = 'metadata';
                a.src = 'музыка/' + encodeURIComponent(names[0]);
                a.onloadedmetadata = () => res('ok duration=' + Math.round(a.duration));
                a.onerror = () => res('error code=' + (a.error && a.error.code));
                setTimeout(() => res('timeout'), 5000);
              });
            }
            return out;
          })()`);
          console.log('DIAG ' + JSON.stringify(info));
          const img = await mainWindow.webContents.capturePage();
          fs.writeFileSync(shotPath, img.toPNG());
          console.log('SHOT ' + shotPath);
        } catch (e) {
          console.error('DIAG FAIL ' + e.message);
        }
        app.quit();
      }, 3000);
    });
  }
}

function buildAppMenu() {
  const win = mainWindow;
  return Menu.buildFromTemplate([
    {
      label: 'Выбрать папку с музыкой…',
      click: () => chooseMusicFolder(win)
    },
    {
      label: 'Открыть папку с музыкой',
      click: () => shell.openPath(musicDir())
    },
    { type: 'separator' },
    {
      label: 'Всегда поверх окон',
      type: 'checkbox',
      checked: win ? win.isAlwaysOnTop() : false,
      click: item => { if (win) win.setAlwaysOnTop(item.checked); }
    },
    {
      label: 'Обновить страницу',
      accelerator: 'F5',
      click: () => win && win.reload()
    },
    { type: 'separator' },
    {
      label: 'Инструменты разработчика',
      accelerator: 'F12',
      click: () => win && win.webContents.openDevTools({ mode: 'detach' })
    },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() }
  ]);
}

async function chooseMusicFolder(win) {
  const result = await dialog.showOpenDialog(win || mainWindow, {
    title: 'Выбери папку с музыкой',
    defaultPath: musicDir(),
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return null;
  writeSettings({ musicDir: result.filePaths[0] });
  return listFiles(musicDir(), AUDIO_EXT);
}

ipcMain.handle('music:list', () => listFiles(musicDir(), AUDIO_EXT));
ipcMain.handle('music:choose', () => chooseMusicFolder(mainWindow));
ipcMain.handle('music:path', () => musicDir());
ipcMain.handle('music:open', () => shell.openPath(musicDir()));

const sysCache = {
  disk: { at: 0, data: null },
  top: { at: 0, data: [] },
  weather: { at: 0, busy: false, data: null }
};

function lanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return null;
}

function fetchWeather() {
  return new Promise((resolve, reject) => {
    const req = require('node:https').get('https://wttr.in/?format=j1', {
      headers: { 'User-Agent': 'curl/8.0' }
    }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const c = j.current_condition && j.current_condition[0];
          if (!c) return reject(new Error('no weather'));
          const area = j.nearest_area && j.nearest_area[0] &&
            j.nearest_area[0].areaName && j.nearest_area[0].areaName[0] &&
            j.nearest_area[0].areaName[0].value;
          resolve({
            temp: Math.round(Number(c.temp_C)),
            feels: Math.round(Number(c.FeelsLikeC)),
            humidity: Number(c.humidity),
            wind: Math.round(Number(c.windspeedKmph)),
            text: (c.weatherDesc && c.weatherDesc[0] && c.weatherDesc[0].value) || '',
            area: area || ''
          });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(9000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function refreshWeather() {
  const now = Date.now();
  const ttl = sysCache.weather.data ? 30 * 60 * 1000 : 5 * 60 * 1000;
  if (sysCache.weather.busy || now - sysCache.weather.at < ttl) return;
  sysCache.weather.busy = true;
  sysCache.weather.at = now;
  fetchWeather().then(w => {
    sysCache.weather.data = w;
  }).catch(() => {
    sysCache.weather.data = null;
  }).finally(() => {
    sysCache.weather.busy = false;
  });
}

ipcMain.handle('sys:stats', async () => {
  try {
    const si = require('systeminformation');
    const now = Date.now();
    refreshWeather();

    const [load, mem, netStats] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
      si.networkStats().catch(() => [])
    ]);

    if (!sysCache.disk.data || now - sysCache.disk.at > 20000) {
      try {
        const fsList = await si.fsSize();
        const disk = (fsList || []).find(d => /^c:/i.test(d.mount || '')) || (fsList || [])[0] || null;
        sysCache.disk.data = disk
          ? { mount: disk.mount || 'C:', used: disk.used, total: disk.size, pct: disk.use }
          : null;
        sysCache.disk.at = now;
      } catch {
        sysCache.disk.at = now;
      }
    }

    if (now - sysCache.top.at > 5000) {
      sysCache.top.at = now;
      try {
        const procs = await si.processes();
        const agg = new Map();
        for (const p of procs.list || []) {
          if (!p.name || p.name.toLowerCase() === 'system idle process') continue;
          const key = p.name.toLowerCase();
          const cpu = Number(p.cpu) || 0;
          const mem = Number(p.memRss) || 0;
          const cur = agg.get(key);
          if (cur) {
            cur.cpu += cpu;
            cur.mem += mem;
          } else {
            agg.set(key, { name: p.name, cpu, mem });
          }
        }
        const list = [...agg.values()];
        const byCpu = list.slice().sort((a, b) => b.cpu - a.cpu);
        const byMem = list.slice().sort((a, b) => b.mem - a.mem);
        sysCache.top.data = (byCpu[0] && byCpu[0].cpu > 0.4 ? byCpu : byMem).slice(0, 3);
      } catch {
        sysCache.top.data = [];
      }
    }

    const nets = (netStats || []).filter(n => n && n.iface !== 'lo');
    let down = null;
    let up = null;
    let rx = 0;
    let tx = 0;
    for (const n of nets) {
      if (Number(n.rx_sec) >= 0) down = (down || 0) + Number(n.rx_sec);
      if (Number(n.tx_sec) >= 0) up = (up || 0) + Number(n.tx_sec);
      rx += Number(n.rx_bytes) || 0;
      tx += Number(n.tx_bytes) || 0;
    }

    return {
      at: now,
      host: os.hostname(),
      osLabel: os.version() || `${os.type()} ${os.release()}`,
      uptime: os.uptime(),
      cpu: Math.round((load && load.currentLoad) || 0),
      cores: os.cpus().length,
      memUsed: mem ? Number(mem.active) || (mem.total - mem.available) : 0,
      memTotal: mem ? mem.total : 0,
      swapUsed: mem ? Number(mem.swapused) || 0 : 0,
      swapTotal: mem ? Number(mem.swaptotal) || 0 : 0,
      disk: sysCache.disk.data,
      net: { ip: lanIp(), down, up, rx, tx },
      top: sysCache.top.data,
      weather: sysCache.weather.data
    };
  } catch (e) {
    return { error: e.message };
  }
});


ipcMain.handle('lyrics:save', (_e, payload) => {
  const name = payload && payload.name;
  const text = payload && payload.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 300000) return false;
  const file = trackFilePath(name);
  if (!file) return false;
  const target = file.replace(/\.[^.]+$/, '') + '.lrc';
  try {
    fs.writeFileSync(target, text, 'utf8');
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('win:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.handle('win:maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('win:close', () => mainWindow && mainWindow.close());
ipcMain.handle('win:isMaximized', () => !!mainWindow && mainWindow.isMaximized());
ipcMain.handle('win:fullscreen', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return next;
});

ipcMain.handle('app:menu', (_e, pos) => {
  const menu = buildAppMenu();
  menu.popup({
    window: mainWindow,
    x: Number(pos && pos.x) || 0,
    y: Number(pos && pos.y) || 0
  });
});

const testProfile = process.env.VEB_TEST_PROFILE;
if (testProfile) app.setPath('userData', testProfile);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('before-quit', () => { isQuitting = true; });
  app.setAppUserModelId('ru.miklm.vebprilozhenie');

  app.whenReady().then(() => {
    protocol.handle('app', handleAppRequest);
    Menu.setApplicationMenu(null);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (isQuitting || process.platform !== 'darwin') app.quit();
  });
}
