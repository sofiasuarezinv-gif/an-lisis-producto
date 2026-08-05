// Dashboard de análisis de productos.
// Guardado permanente en TU repo de GitHub (una carpeta data/products/ con un archivo por producto).
// Requiere en producción: GH_TOKEN (token de GitHub con permiso de Contents) y GH_REPO ("owner/repo").
// Sin GH_TOKEN usa un archivo local products.json (solo para pruebas).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4000;
const DATA_FILE = path.join(__dirname, 'products.json');

const GH = {
  token: process.env.GH_TOKEN,
  repo: process.env.GH_REPO,                 // ej. "sofiasuarezinv-gif/an-lisis-producto"
  branch: process.env.GH_BRANCH || 'main',
  dir: (process.env.GH_DIR || 'data/products').replace(/\/+$/, ''),
};
const useGH = !!(GH.token && GH.repo);

let cache = {}; // { pid: { data, created_at, updated_at, _sha? } }

// ─────────────── GitHub API ───────────────
function ghHeaders() {
  return {
    'Authorization': 'Bearer ' + GH.token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'analisis-productos',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}
async function ghApi(method, repoPath, body, allow404) {
  const q = method === 'GET' ? `?ref=${encodeURIComponent(GH.branch)}` : '';
  const url = `https://api.github.com/repos/${GH.repo}/contents/${repoPath}${q}`;
  const r = await fetch(url, { method, headers: ghHeaders(), body: body ? JSON.stringify(body) : undefined });
  if (r.status === 404 && allow404) return null;
  if (!r.ok) throw new Error(`GitHub ${method} ${repoPath} → ${r.status} ${await r.text()}`);
  return r.json();
}
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const newId = () => Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const recJson = (r) => JSON.stringify({ data: r.data, created_at: r.created_at, updated_at: r.updated_at });

// ─────────────── Carga inicial ───────────────
async function loadInitial() {
  if (useGH) {
    const dir = await ghApi('GET', GH.dir, null, true);
    if (Array.isArray(dir)) {
      for (const item of dir) {
        if (item.type === 'file' && item.name.endsWith('.json')) {
          try {
            const f = await ghApi('GET', item.path);
            const rec = JSON.parse(Buffer.from(f.content, 'base64').toString('utf8'));
            cache[item.name.replace(/\.json$/, '')] = { ...rec, _sha: f.sha };
          } catch (e) { console.error('No pude leer', item.name, e.message); }
        }
      }
    }
    console.log(`Almacenamiento: GitHub (${GH.repo}/${GH.dir}). Productos: ${Object.keys(cache).length}`);
  } else {
    try { cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}'); } catch { cache = {}; }
    console.log('Almacenamiento: archivo local products.json (solo pruebas)');
  }
}
const writeLocal = () => {
  const clean = {};
  for (const [pid, r] of Object.entries(cache)) clean[pid] = { data: r.data, created_at: r.created_at, updated_at: r.updated_at };
  fs.writeFileSync(DATA_FILE, JSON.stringify(clean));
};

// ─────────────── Operaciones ───────────────
function listProducts() {
  return Object.entries(cache)
    .map(([pid, r]) => ({ pid, ...r.data, _created: r.created_at, _updated: r.updated_at }))
    .sort((a, b) => (b._created || '').localeCompare(a._created || ''));
}
async function saveToBackend(pid) {
  const r = cache[pid];
  if (useGH) {
    const body = { message: `producto ${pid}`, content: b64(recJson(r)), branch: GH.branch };
    if (r._sha) body.sha = r._sha;
    const res = await ghApi('PUT', `${GH.dir}/${pid}.json`, body);
    r._sha = res.content.sha;
  } else writeLocal();
}
async function createProduct(data) {
  const pid = newId(); const now = new Date().toISOString();
  cache[pid] = { data, created_at: now, updated_at: now };
  await saveToBackend(pid);
  return { pid, ...data, _created: now, _updated: now };
}
async function updateProduct(pid, data) {
  if (!cache[pid]) return null;
  cache[pid].data = data; cache[pid].updated_at = new Date().toISOString();
  await saveToBackend(pid);
  return { pid, ...data, _updated: cache[pid].updated_at };
}
async function deleteProduct(pid) {
  const r = cache[pid]; if (!r) return false;
  if (useGH) await ghApi('DELETE', `${GH.dir}/${pid}.json`, { message: `borrar ${pid}`, sha: r._sha, branch: GH.branch });
  delete cache[pid];
  if (!useGH) writeLocal();
  return true;
}

// ─────────────── Servidor HTTP ───────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };
const sendJson = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '', size = 0;
    req.on('data', c => { size += c.length; if (size > 12 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } b += c; });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/api/products' && req.method === 'GET') return sendJson(res, 200, listProducts());
    if (url === '/api/products' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || !body.data) return sendJson(res, 400, { error: 'faltan datos' });
      return sendJson(res, 201, await createProduct(body.data));
    }
    const m = url.match(/^\/api\/products\/([^/]+)$/);
    if (m) {
      const pid = decodeURIComponent(m[1]);
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const upd = await updateProduct(pid, body.data);
        return upd ? sendJson(res, 200, upd) : sendJson(res, 404, { error: 'no existe' });
      }
      if (req.method === 'DELETE') {
        const ok = await deleteProduct(pid);
        return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'no existe' });
      }
    }
    let file = url === '/' ? '/index.html' : url;
    const fp = path.join(__dirname, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
      return fs.createReadStream(fp).pipe(res);
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    console.error(e); sendJson(res, 500, { error: 'error del servidor', detail: String(e.message || e) });
  }
});

loadInitial()
  .catch(e => console.error('Aviso al cargar datos iniciales:', e.message))
  .finally(() => server.listen(PORT, () => console.log(`Dashboard productos en http://localhost:${PORT}`)));
