// Servidor para varias "colecciones" (products, tiendas, …).
// Guarda cada registro como un archivo en TU repo de GitHub: data/{coleccion}/{id}.json
// Producción: GH_TOKEN (token con permiso Contents) + GH_REPO ("owner/repo").
// Sin GH_TOKEN usa archivos locales data-{coleccion}.json (solo pruebas).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4000;
const GH = {
  token: process.env.GH_TOKEN,
  repo: process.env.GH_REPO,
  branch: process.env.GH_BRANCH || 'main',
  base: (process.env.GH_DIR || 'data').replace(/\/+$/, ''),
};
const useGH = !!(GH.token && GH.repo);

const cache = {};   // cache[coleccion] = { id: { data, created_at, updated_at, _sha? } }
const loaded = {};
const validColl = (c) => /^[a-z0-9_-]{1,40}$/.test(c);

// ─────────── GitHub ───────────
const ghHeaders = () => ({
  'Authorization': 'Bearer ' + GH.token,
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'seguimiento-app',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
});
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
const localFile = (coll) => path.join(__dirname, `data-${coll}.json`);
const writeLocal = (coll) => {
  const clean = {};
  for (const [id, r] of Object.entries(cache[coll])) clean[id] = { data: r.data, created_at: r.created_at, updated_at: r.updated_at };
  fs.writeFileSync(localFile(coll), JSON.stringify(clean));
};

async function ensureLoaded(coll) {
  if (loaded[coll]) return;
  cache[coll] = {};
  if (useGH) {
    const dir = await ghApi('GET', `${GH.base}/${coll}`, null, true);
    if (Array.isArray(dir)) {
      for (const item of dir) {
        if (item.type === 'file' && item.name.endsWith('.json')) {
          try {
            const f = await ghApi('GET', item.path);
            const rec = JSON.parse(Buffer.from(f.content, 'base64').toString('utf8'));
            cache[coll][item.name.replace(/\.json$/, '')] = { ...rec, _sha: f.sha };
          } catch (e) { console.error('leer', item.name, e.message); }
        }
      }
    }
  } else {
    try { cache[coll] = JSON.parse(fs.readFileSync(localFile(coll), 'utf8') || '{}'); } catch { cache[coll] = {}; }
  }
  loaded[coll] = true;
}
function listItems(coll) {
  return Object.entries(cache[coll] || {})
    .map(([id, r]) => ({ pid: id, ...r.data, _created: r.created_at, _updated: r.updated_at }))
    .sort((a, b) => (b._created || '').localeCompare(a._created || ''));
}
async function saveBackend(coll, id) {
  const r = cache[coll][id];
  if (useGH) {
    const body = { message: `${coll} ${id}`, content: b64(recJson(r)), branch: GH.branch };
    if (r._sha) body.sha = r._sha;
    const res = await ghApi('PUT', `${GH.base}/${coll}/${id}.json`, body);
    r._sha = res.content.sha;
  } else writeLocal(coll);
}
async function createItem(coll, data) {
  const id = newId(); const now = new Date().toISOString();
  cache[coll][id] = { data, created_at: now, updated_at: now };
  await saveBackend(coll, id);
  return { pid: id, ...data, _created: now, _updated: now };
}
async function updateItem(coll, id, data) {
  if (!cache[coll][id]) return null;
  cache[coll][id].data = data; cache[coll][id].updated_at = new Date().toISOString();
  await saveBackend(coll, id);
  return { pid: id, ...data, _updated: cache[coll][id].updated_at };
}
async function deleteItem(coll, id) {
  const r = cache[coll][id]; if (!r) return false;
  if (useGH) await ghApi('DELETE', `${GH.base}/${coll}/${id}.json`, { message: `borrar ${id}`, sha: r._sha, branch: GH.branch });
  delete cache[coll][id];
  if (!useGH) writeLocal(coll);
  return true;
}

// ─────────── HTTP ───────────
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
const PAGES = { '/': 'index.html', '/tiendas': 'tiendas.html', '/productos': 'index.html' };

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    const mList = url.match(/^\/api\/([a-z0-9_-]+)$/);
    const mItem = url.match(/^\/api\/([a-z0-9_-]+)\/([^/]+)$/);
    if (mList && validColl(mList[1])) {
      const coll = mList[1]; await ensureLoaded(coll);
      if (req.method === 'GET') return sendJson(res, 200, listItems(coll));
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body || !body.data) return sendJson(res, 400, { error: 'faltan datos' });
        return sendJson(res, 201, await createItem(coll, body.data));
      }
    }
    if (mItem && validColl(mItem[1])) {
      const coll = mItem[1], id = decodeURIComponent(mItem[2]); await ensureLoaded(coll);
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const upd = await updateItem(coll, id, body.data);
        return upd ? sendJson(res, 200, upd) : sendJson(res, 404, { error: 'no existe' });
      }
      if (req.method === 'DELETE') {
        const ok = await deleteItem(coll, id);
        return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'no existe' });
      }
    }

    let file = PAGES[url] ? '/' + PAGES[url] : url;
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

const modo = useGH ? `GitHub (${GH.repo})` : 'archivos locales (pruebas)';
server.listen(PORT, () => console.log(`App en http://localhost:${PORT} — almacenamiento: ${modo}`));
