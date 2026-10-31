const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 43110);
const ROOT = path.resolve(__dirname);
const HOME = os.homedir();
const PUBLIC = path.join(ROOT, 'public');
const PID_FILE = path.join(os.tmpdir(), 'space-lens.pid');
const SCAN_ROOTS = [HOME, '/Applications', '/System/Applications'];
const IGNORED = new Set(['node_modules', '.git', '.Trash', 'Library/Caches']);
const CLOUD_ROOTS = [
  path.join(HOME, 'Library', 'Mobile Documents'),
  path.join(HOME, 'Library', 'CloudStorage'),
  path.join(HOME, 'Library', 'FileProvider')
];
const CLEANUP_ROOTS = ['Desktop', 'Documents', 'Downloads', 'Movies', 'Music', 'Pictures', 'Public', 'Applications']
  .map(name => path.join(HOME, name));
const PROTECTED_ROOTS = [ROOT, path.join(HOME, 'Applications', 'Space Lens.app')];
let localDevice = null;

const EXTENSIONS = {
  video: new Set(['.mp4','.mov','.mkv','.avi','.m4v','.webm','.flv','.wmv']),
  images: new Set(['.jpg','.jpeg','.png','.gif','.webp','.heic','.tiff','.bmp','.svg','.raw','.cr2']),
  audio: new Set(['.mp3','.m4a','.wav','.flac','.aac','.ogg','.aiff']),
  documents: new Set(['.pdf','.doc','.docx','.txt','.rtf','.pages','.xls','.xlsx','.csv','.ppt','.pptx','.key','.epub']),
  archives: new Set(['.zip','.rar','.7z','.tar','.gz','.dmg','.pkg','.iso']),
  code: new Set(['.js','.ts','.jsx','.tsx','.py','.go','.rs','.java','.swift','.html','.css','.json','.sql']),
  applications: new Set(['.app'])
};

let state = freshState();
let abortScan = false;
let seenInodes = new Set();
let cleanupFiles = [];

function freshState() {
  return { status: 'idle', startedAt: null, finishedAt: null, currentPath: '', files: 0, folders: 0, bytes: 0, errors: 0, skipped: 0, largest: [], types: {}, extensions: {}, locations: {}, error: null };
}

async function diskStats() {
  const stats = await fsp.statfs(HOME);
  const total = stats.blocks * stats.bsize;
  const free = stats.bfree * stats.bsize;
  return { total, free, used: total - free };
}

function insideHome(target) {
  const resolved = path.resolve(target);
  return resolved === HOME || resolved.startsWith(HOME + path.sep);
}

function within(target, root) {
  const resolved = path.resolve(target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function canTrashPath(target) {
  const resolved = path.resolve(target);
  if (!insideHome(resolved) || PROTECTED_ROOTS.some(root => within(resolved, root))) return false;
  if (!CLEANUP_ROOTS.some(root => within(resolved, root))) return false;
  const relativeParts = path.relative(HOME, resolved).split(path.sep);
  if (relativeParts.some(part => part.startsWith('.'))) return false;
  return true;
}

function isCloudPath(target) {
  const resolved = path.resolve(target);
  return CLOUD_ROOTS.some(root => resolved === root || resolved.startsWith(root + path.sep));
}

function classify(file, isApp = false) {
  if (isApp) return 'applications';
  const ext = path.extname(file).toLowerCase();
  for (const [name, set] of Object.entries(EXTENSIONS)) if (set.has(ext)) return name;
  return ext ? 'other' : 'no extension';
}

function locationFor(file) {
  if (within(file, HOME)) {
    const rel = path.relative(HOME, file);
    return (rel.split(path.sep)[0] || 'Home').replace(/^$/, 'Home');
  }
  if (within(file, '/System/Applications')) return 'System Applications';
  if (within(file, '/Applications')) return 'Applications';
  return 'Other local files';
}

function addFile(file, size, category) {
  state.files++; state.bytes += size;
  state.types[category] = (state.types[category] || 0) + size;
  const extension = path.extname(file).toLowerCase() || '[no extension]';
  const extensionStats = state.extensions[extension] || { bytes: 0, count: 0 };
  extensionStats.bytes += size; extensionStats.count++;
  state.extensions[extension] = extensionStats;
  const loc = locationFor(file);
  state.locations[loc] = (state.locations[loc] || 0) + size;
  const item = { path: file, name: path.basename(file), size, category, deletable: canTrashPath(file) };
  if (item.deletable) cleanupFiles.push({ ...item, extension });
  if (state.largest.length < 200 || size > state.largest[state.largest.length - 1].size) {
    state.largest.push(item);
    state.largest.sort((a,b) => b.size - a.size);
    if (state.largest.length > 200) state.largest.length = 200;
  }
}

// st_size is the logical file length, which can be enormous for iCloud
// placeholders and sparse files. st_blocks reports 512-byte blocks actually
// allocated on this Mac, which is the number a cleanup tool should display.
function allocatedSize(stat) {
  return typeof stat.blocks === 'number' ? stat.blocks * 512 : stat.size;
}

function firstPhysicalReference(stat) {
  const key = `${stat.dev}:${stat.ino}`;
  if (seenInodes.has(key)) return false;
  seenInodes.add(key);
  return true;
}

async function scanDirectory(dir) {
  if (abortScan) return;
  if (isCloudPath(dir)) { state.skipped++; return; }
  state.currentPath = dir;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch { state.errors++; return; }
  state.folders++;
  for (const entry of entries) {
    if (abortScan) return;
    const full = path.join(dir, entry.name);
    const rel = path.relative(HOME, full);
    if (entry.isSymbolicLink() || isCloudPath(full) || IGNORED.has(entry.name) || IGNORED.has(rel)) { state.skipped++; continue; }
    try {
      if (entry.isDirectory()) {
        const dirStat = await fsp.stat(full);
        // Never cross a mount boundary: external disks, network shares and
        // separately mounted providers are outside the internal-drive scan.
        if (dirStat.dev !== localDevice) { state.skipped++; continue; }
        if (entry.name.endsWith('.app')) {
          const size = await directorySize(full);
          addFile(full, size, 'applications');
        } else await scanDirectory(full);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(full);
        if (firstPhysicalReference(stat)) addFile(full, allocatedSize(stat), classify(full));
      }
    } catch { state.errors++; }
    if (state.files % 250 === 0) await new Promise(r => setImmediate(r));
  }
}

async function directorySize(dir) {
  let total = 0;
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) total += await directorySize(p);
      else if (e.isFile()) {
        const stat = await fsp.stat(p);
        if (firstPhysicalReference(stat)) total += allocatedSize(stat);
      }
    }
  } catch { state.errors++; }
  return total;
}

async function startScan() {
  if (state.status === 'scanning') return;
  abortScan = false; seenInodes = new Set(); cleanupFiles = []; state = freshState(); state.status = 'scanning'; state.startedAt = Date.now();
  try {
    for (const root of SCAN_ROOTS) {
      if (abortScan) break;
      try {
        const rootStat = await fsp.stat(root);
        if (rootStat.dev === localDevice) await scanDirectory(root);
        else state.skipped++;
      } catch { state.errors++; }
    }
    state.status = abortScan ? 'cancelled' : 'complete';
  }
  catch (e) { state.status = 'error'; state.error = e.message; }
  state.finishedAt = Date.now(); state.currentPath = '';
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body));
}

async function body(req) {
  let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 100000) throw Error('Request too large'); }
  return JSON.parse(data || '{}');
}

function isDockerData(target) {
  return target.includes(`${path.sep}com.docker.docker${path.sep}`) || path.basename(target) === 'Docker.raw';
}

async function dockerIsRunning() {
  try { await execFileAsync('pgrep', ['-f', 'Docker Desktop|com.docker.backend|Docker.app']); return true; }
  catch { return false; }
}

async function moveToTrash(target) {
  const trashDir = path.join(HOME, '.Trash');
  await fsp.mkdir(trashDir, { recursive: true });
  const parsed = path.parse(target);
  let destination = path.join(trashDir, parsed.base);
  let suffix = 2;
  while (true) {
    try { await fsp.lstat(destination); destination = path.join(trashDir, `${parsed.name} ${suffix++}${parsed.ext}`); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
  await fsp.rename(target, destination);
}

async function route(req, res) {
  const url = new URL(req.url, `http://${HOST}`);
  if (url.pathname === '/api/status' && req.method === 'GET') return json(res, 200, { ...state, home: HOME, disk: await diskStats() });
  if (url.pathname === '/api/files' && req.method === 'GET') {
    const extension = url.searchParams.get('extension');
    if (!extension) return json(res, 400, { error: 'Extension is required' });
    const matches = cleanupFiles.filter(file => file.extension === extension).sort((a,b) => b.size - a.size);
    return json(res, 200, { extension, total: matches.length, totalBytes: matches.reduce((sum,file) => sum + file.size, 0), files: matches.slice(0, 1000) });
  }
  if (url.pathname === '/api/scan' && req.method === 'POST') { startScan(); return json(res, 202, { ok: true }); }
  if (url.pathname === '/api/stop' && req.method === 'POST') { abortScan = true; return json(res, 200, { ok: true }); }
  if (url.pathname === '/api/reveal' && req.method === 'POST') {
    const { path: target } = await body(req);
    if (!target || !insideHome(target)) return json(res, 400, { error: 'Invalid path' });
    await execFileAsync('open', ['-R', target]); return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/trash' && req.method === 'POST') {
    const { path: target } = await body(req);
    if (!target || !canTrashPath(target)) return json(res, 403, { error: 'This item is protected. Space Lens only permits cleanup inside your standard personal folders.' });
    try {
      await fsp.lstat(target);
      if (isDockerData(target) && await dockerIsRunning()) {
        return json(res, 409, { error: 'Quit Docker Desktop completely, then try again. Docker.raw contains your Docker images, containers, and volumes.' });
      }
      await moveToTrash(target);
      state.largest = state.largest.filter(x => x.path !== target);
      cleanupFiles = cleanupFiles.filter(x => x.path !== target);
      return json(res, 200, { ok: true });
    } catch (e) {
      const message = ['EACCES','EPERM'].includes(e.code)
        ? 'macOS denied access. Close the app using this item, then try again.'
        : `Could not move this item to Trash: ${e.message}`;
      return json(res, 500, { error: message });
    }
  }
  if (url.pathname === '/api/trash-bulk' && req.method === 'POST') {
    const request = await body(req);
    const excluded = new Set(request.exclude || []);
    const requested = new Set(request.paths || []);
    const targets = request.all && request.extension
      ? cleanupFiles.filter(file => file.extension === request.extension && !excluded.has(file.path))
      : cleanupFiles.filter(file => requested.has(file.path));
    let moved = 0; const failed = [];
    for (const file of targets) {
      if (!canTrashPath(file.path)) { failed.push({ path: file.path, error: 'Protected' }); continue; }
      try { await moveToTrash(file.path); moved++; }
      catch (error) { failed.push({ path: file.path, error: error.message }); }
    }
    const movedPaths = new Set(targets.filter(file => !failed.some(f => f.path === file.path)).map(file => file.path));
    cleanupFiles = cleanupFiles.filter(file => !movedPaths.has(file.path));
    state.largest = state.largest.filter(file => !movedPaths.has(file.path));
    return json(res, 200, { ok: true, moved, failed: failed.length, failures: failed.slice(0, 10) });
  }
  let file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  file = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, '');
  const target = path.join(PUBLIC, file);
  if (!target.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try {
    const data = await fsp.readFile(target);
    const type = { '.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml' }[path.extname(target)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}

function freePort() {
  try {
    const pids = execFileSync('lsof', ['-ti', `tcp:${PORT}`], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
    for (const pid of pids) { if (Number(pid) !== process.pid) { try { process.kill(Number(pid), 'SIGTERM'); } catch {} } }
    if (pids.length) execFileSync('sleep', ['1']);
  } catch {}
}

async function boot() {
  localDevice = (await fsp.stat(HOME)).dev;
  freePort();
  const server = http.createServer((req,res) => route(req,res).catch(e => json(res,500,{error:e.message})));
  server.listen(PORT, HOST, () => { fs.writeFileSync(PID_FILE, String(process.pid)); console.log(`Space Lens: http://${HOST}:${PORT}`); });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

boot().catch(error => { console.error(error); process.exit(1); });
