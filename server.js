// Dashboard de análisis de productos — backend simple.
// Persistencia: Postgres (si existe DATABASE_URL) o archivo local products.json (para pruebas).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4000;
const DATA_FILE = path.join(__dirname, 'products.json');
const useDB = !!process.env.DATABASE_URL;
let pool = null;

// ─────────────────────────── Capa de datos ───────────────────────────
async function initStore() {
  if (useDB) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    await pool.query(`CREATE TABLE IF NOT EXISTS products(
      pid TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    console.log('Almacenamiento: PostgreSQL');
  } else {
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');
    console.log('Almacenamiento: archivo local (products.json) — solo para pruebas');
  }
}
const readFile = () => { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}'); } catch { return {}; } };
const writeFile = (o) => fs.writeFileSync(DATA_FILE, JSON.stringify(o));
const newId = () => Date.now().toString(36) + crypto.randomBytes(4).toString('hex');

async function listProducts() {
  if (useDB) {
    const r = await pool.query('SELECT pid, data, created_at, updated_at FROM products ORDER BY created_at DESC');
    return r.rows.map(x => ({ pid: x.pid, ...x.data, _created: x.created_at, _updated: x.updated_at }));
  }
  const o = readFile();
  return Object.entries(o)
    .map(([pid, v]) => ({ pid, ...v.data, _created: v.created_at, _updated: v.updated_at }))
    .sort((a, b) => (b._created || '').localeCompare(a._created || ''));
}
async function createProduct(data) {
  const pid = newId();
  const now = new Date().toISOString();
  if (useDB) {
    await pool.query('INSERT INTO products(pid, data) VALUES($1, $2)', [pid, data]);
  } else {
    const o = readFile(); o[pid] = { data, created_at: now, updated_at: now }; writeFile(o);
  }
  return { pid, ...data, _created: now, _updated: now };
}
async function updateProduct(pid, data) {
  const now = new Date().toISOString();
  if (useDB) {
    const r = await pool.query('UPDATE products SET data=$2, updated_at=now() WHERE pid=$1 RETURNING pid', [pid, data]);
    if (!r.rowCount) return null;
  } else {
    const o = readFile(); if (!o[pid]) return null;
    o[pid].data = data; o[pid].updated_at = now; writeFile(o);
  }
  return { pid, ...data, _updated: now };
}
async function deleteProduct(pid) {
  if (useDB) { const r = await pool.query('DELETE FROM products WHERE pid=$1', [pid]); return r.rowCount > 0; }
  const o = readFile(); if (!o[pid]) return false; delete o[pid]; writeFile(o); return true;
}

// ─────────────────────────── Servidor HTTP ───────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };
const sendJson = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; let size = 0;
    req.on('data', c => { size += c.length; if (size > 12 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } b += c; });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  try {
    // API
    if (url === '/api/products' && req.method === 'GET') return sendJson(res, 200, await listProducts());
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

    // Estáticos
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

initStore().then(() => server.listen(PORT, () => console.log(`Dashboard productos en http://localhost:${PORT}`)))
  .catch(e => { console.error('No pude iniciar el almacenamiento:', e); process.exit(1); });
