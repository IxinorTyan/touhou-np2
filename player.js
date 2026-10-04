import {games} from './app.js';
import {NP21} from './vendor/np2/np2-wasm.js';
import {isolateDisk} from './disk-images.js';

const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);
const game = games.find(g => g.id === query.get('game')) || games[0];
const lang = game.id !== '1' && query.get('lang') === 'cn' ? 'cn' : 'jp';
const diskName = `${game.id}-${lang}.hdi`;
const saveKey = `touhou-v2-${game.id}-${lang}`;
let emulator, metadata, manifest, database, dirty = false, saving = false, saveTimer, busy = false;
let persistenceWarning = '';

$('title').textContent = game.name;
$('subtitle').textContent = game.subtitle;
document.title = `${game.name} · 东方旧作`;

function setButtonText(btn, text) {
  if (!btn) return;
  const span = btn.querySelector('span');
  if (span) span.textContent = text;
  else btn.textContent = text;
}

function status(message) {
  $('status').textContent = message;
  const dot = $('status-dot');
  if (dot) {
    if (message.includes('运行中')) {
      dot.className = 'status-dot running';
    } else if (message.includes('暂停')) {
      dot.className = 'status-dot paused';
    } else if (message.includes('正在') || message.includes('加载') || message.includes('准备')) {
      dot.className = 'status-dot loading';
    } else {
      dot.className = 'status-dot';
    }
  }
}

function report(error) {
  console.error(error);
  status(`错误：${error.message || error}`);
  const dot = $('status-dot');
  if (dot) dot.className = 'status-dot error';
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('touhou-pc98', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('disks');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('存档数据库被占用'));
  });
}

function storage(mode, value, key = saveKey) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('disks', mode);
    const store = transaction.objectStore('disks');
    const request = mode === 'readonly' ? store.get(key) : store.put(value, key);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error || request.error);
    transaction.onabort = () => reject(transaction.error || new Error('存档写入已取消'));
  });
}

async function getMetadata() {
  if (!metadata) {
    const response = await fetch('disks/manifest.json');
    if (!response.ok) throw new Error(`镜像清单加载失败 (${response.status})`);
    manifest = await response.json();
    metadata = manifest.games[`${game.id}-${lang}`];
    if (!metadata) throw new Error('找不到游戏镜像');
  }
  return metadata;
}

function validate(data, meta) {
  const signature = new TextDecoder().decode(data.subarray(meta.autoexecSizeOffset - 28, meta.autoexecSizeOffset - 17));
  if (data.byteLength !== meta.size || signature !== 'AUTOEXECBAT')
    throw new Error('镜像结构不匹配');
  const marker = new TextDecoder().decode(data.subarray(meta.languageMarkerOffset, meta.languageMarkerOffset + 8));
  if (marker !== meta.languageMarker) throw new Error('请选择对应的存档文件');
}

function migrateLegacy(data, meta) {
  validate(data, manifest.legacy[lang]);
  isolateDisk(data, game.dir, meta.languageMarker);
  validate(data, meta);
  return patchBoot(data, meta);
}

function patchBoot(data, meta) {
  validate(data, meta);
  const script = new TextEncoder().encode(`@ECHO OFF\r\nPATH A:\\DOS;A:\\\r\nSET TEMP=A:\\DOS\r\nSET DOSDIR=A:\\DOS\r\nA:\r\nCD \\${game.dir}\r\nCALL GAME.BAT\r\n`);
  if (script.length > meta.autoexecCapacity) throw new Error('启动脚本空间不足');
  data.fill(0, meta.autoexecOffset, meta.autoexecOffset + meta.autoexecCapacity);
  data.set(script, meta.autoexecOffset);
  new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(meta.autoexecSizeOffset, script.length, true);
  return data;
}

async function loadDisk() {
  const meta = await getMetadata();
  try {
    database ||= await openDB();
    const saved = await storage('readonly');
    if (saved) {
      validate(saved, meta);
      status('正在读取本地存档…');
      return patchBoot(new Uint8Array(saved), meta);
    }
    const legacy = await storage('readonly', undefined, `touhou-v1-${lang}`);
    if (legacy) {
      const migrated = migrateLegacy(new Uint8Array(legacy), meta);
      await storage('readwrite', migrated);
      status('已同步历史存档');
      return migrated;
    }
  } catch (error) {
    persistenceWarning = `存档读取受限：${error.message}`;
    $('save-status').textContent = persistenceWarning;
  }
  status(`正在加载游戏镜像 (${(meta.compressedSize / 1048576).toFixed(1)} MB)…`);
  const response = await fetch(meta.url);
  if (!response.ok) throw new Error(`镜像加载失败 (${response.status})`);
  if (!globalThis.DecompressionStream) throw new Error('浏览器不支持解压流，请使用新版浏览器');
  const data = new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== meta.sha256) throw new Error('镜像校验失败');
  return patchBoot(data, meta);
}

function diskChanged(name) {
  if (!name.endsWith(diskName)) return;
  dirty = true;
  $('save-status').textContent = '存档写入中…';
  if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; save(); }, 1800);
}

async function save() {
  if (!emulator || !dirty || saving) return;
  saving = true;
  try {
    database ||= await openDB();
    const snapshot = emulator.getDiskImage(diskName);
    dirty = false;
    await storage('readwrite', snapshot);
    $('save-status').textContent = dirty ? '等待写入…' : `已自动保存 (${new Date().toLocaleTimeString()})`;
  } catch (error) {
    dirty = true;
    $('save-status').textContent = `保存失败：${error.message}`;
  } finally { saving = false; }
}

$('start').addEventListener('click', async () => {
  if (busy || emulator) return;
  busy = true;
  $('start').disabled = true;
  setButtonText($('start'), '正在启动…');
  $('import').disabled = true;
  $('clock').disabled = true;
  try {
    const data = await loadDisk();
    status('正在启动模拟器…');
    emulator = await Promise.race([
      NP21.create({canvas: $('canvas'), clk_base: 2457600, clk_mult: Number($('clock').value),
        ...(game.id === '3' ? {DIPswtch: [0x3e, 0xf3, 0x7b]} : {}),
        ExMemory: 7, Latencys: 100, SampleHz: 44100, SNDboard: 4,
        no_mouse: true, use_menu: false, onDiskChange: diskChanged,
        fontfile: lang === 'cn' ? 'font_cn.bmp' : 'font.bmp',
        onExit: () => { status('模拟器已关闭'); save(); }}),
      new Promise((_, reject) => setTimeout(() => reject(new Error('启动超时，请刷新重试')), 30000)),
    ]);
    emulator.addDiskImage(diskName, data);
    emulator.setHdd(0, diskName);
    $('cover').hidden = true;
    emulator.run();
    $('canvas').focus();
    for (const id of ['pause', 'reset', 'export']) $(id).disabled = false;
    status('运行中');
    if (!persistenceWarning) $('save-status').textContent = '自动保存已就绪';
  } catch (error) {
    report(error);
    setButtonText($('start'), '刷新重试');
    $('start').disabled = false;
    $('start').onclick = () => location.reload();
  } finally { busy = false; }
});

$('pause').addEventListener('click', () => {
  if (emulator.state === 'running') {
    emulator.pause();
    setButtonText($('pause'), '继续');
    status('已暂停');
    save();
  } else {
    emulator.run();
    setButtonText($('pause'), '暂停');
    status('运行中');
    $('canvas').focus();
  }
});

$('reset').addEventListener('click', async () => {
  if (!confirm('重新启动将丢失未写入硬盘的临时进度，确定继续吗？')) return;
  await save();
  emulator.reset();
  emulator.run();
  setButtonText($('pause'), '暂停');
  $('canvas').focus();
  status('运行中');
});

$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('screen').requestFullscreen();
    $('canvas').focus();
  } catch (error) { report(error); }
});

$('canvas').addEventListener('contextmenu', event => event.preventDefault());
$('canvas').addEventListener('pointerdown', () => $('canvas').focus());
$('canvas').addEventListener('keydown', event => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Tab'].includes(event.code)) event.preventDefault();
});

$('export').addEventListener('click', () => {
  try {
    const blob = new Blob([emulator.getDiskImage(diskName)], {type:'application/octet-stream'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `touhou-${game.id}-${lang}-${new Date().toISOString().slice(0,10)}.hdi`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    status('存档已导出');
  } catch (error) { report(error); }
});

$('import').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (emulator || busy) throw new Error('请在启动游戏前导入存档');
    const meta = await getMetadata();
    if (file.size !== meta.size) throw new Error('存档文件大小不匹配');
    let data = new Uint8Array(await file.arrayBuffer());
    try { validate(data, meta); }
    catch { data = migrateLegacy(data, meta); }
    if (!confirm('导入将覆盖当前作品的存档，确定继续吗？')) return;
    database ||= await openDB();
    await storage('readwrite', data);
    status('存档导入成功，点击“启动游戏”生效');
  } catch (error) { report(error); }
  finally { event.target.value = ''; }
});

$('back').addEventListener('click', async event => {
  event.preventDefault();
  if (emulator) emulator.pause();
  await save();
  if ((dirty || saving) && !confirm('存档尚未完成保存，确定离开吗？')) return;
  location.href = 'index.html';
});

window.addEventListener('beforeunload', event => {
  if (dirty || saving) { event.preventDefault(); event.returnValue = ''; }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) save();
  else if (emulator?.state === 'running') setButtonText($('pause'), '暂停');
});
