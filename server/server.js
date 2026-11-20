// Serveur sans dépendance : fichiers statiques de ../app + API JSON + SQLite (node:sqlite).
'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { DatabaseSync } = require('node:sqlite');
const vm = require('node:vm');
const { importUrl, importPhoto } = require('./import');
const DBPATH = process.env.DB || path.join(__dirname, 'recettes.db');
fs.mkdirSync(path.dirname(DBPATH), { recursive: true });
const db = new DatabaseSync(DBPATH);
db.exec('PRAGMA foreign_keys=ON'); db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
const WEB = path.join(__dirname, '..', 'app'), MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Validation / normalisation d'une recette reçue (création, modification, restauration)
function clean(r) {
  if (!r || typeof r.title !== 'string' || !r.title.trim()) throw new Error('Titre requis');
  const I = (x, lo, hi, d) => { x = Math.round(Number(x)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; }, A = a => Array.isArray(a) ? a : [];
  return { title: r.title.trim().slice(0, 140), type: String(r.type || 'Plat').slice(0, 40), difficulty: I(r.difficulty, 1, 3, 1), prep: I(r.prep, 0, 1440, 0), cook: I(r.cook, 0, 1440, 0), rest: I(r.rest, 0, 10080, 0), servings: I(r.servings, 1, 100, 4),
    emoji: String(r.emoji || '🍽️').slice(0, 8), hue: I(r.hue, 0, 360, 200), diets: A(r.diets).map(String), method: A(r.method).map(String), tags: A(r.tags).map(String),
    ingredients: A(r.ingredients).filter(i => i && i.n).map(i => ({ q: Math.max(0, Number(i.q) || 0), u: String(i.u || ''), n: String(i.n) })),
    steps: A(r.steps).filter(s => s && s.t).map(s => ({ t: String(s.t), temp: I(s.temp, 1, 350, null), timer: I(s.timer, 1, 10080, null), kind: s.kind === 'repos' || s.kind === 'cuisson' ? s.kind : null })) };
}
function saveRecipe(r, kind, src, fixedId, replace) {
  const id = fixedId || 'r' + Date.now().toString(36);
  db.exec('BEGIN');
  try {
    let created = null;
    if (replace) { const o = db.prepare('SELECT created_at,source_url,source_kind FROM recipes WHERE id=?').get(id); if (!o) throw new Error('Recette introuvable'); created = o.created_at; src = o.source_url; kind = o.source_kind; db.prepare('DELETE FROM recipes WHERE id=?').run(id); }
    db.prepare('INSERT INTO recipes(id,title,type,difficulty,prep_min,cook_min,rest_min,servings,source_url,source_kind,emoji,hue) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, r.title, r.type, r.difficulty, r.prep, r.cook, r.rest, r.servings, src || null, kind, r.emoji || '🍽️', r.hue ?? 200);
    r.ingredients.forEach((i, p) => db.prepare('INSERT INTO ingredients VALUES(?,?,?,?,?)').run(id, p, i.q, i.u, i.n));
    r.steps.forEach((s, p) => db.prepare('INSERT INTO steps VALUES(?,?,?,?,?,?)').run(id, p, s.t, s.temp ?? null, s.timer ?? null, s.kind ?? null));
    for (const [f, a] of [['diet', r.diets], ['method', r.method], ['tag', r.tags]]) a.forEach(l => db.prepare('INSERT OR IGNORE INTO recipe_labels VALUES(?,?,?)').run(id, f, l));
    if (created) db.prepare('UPDATE recipes SET created_at=? WHERE id=?').run(created, id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return id;
}
function listRecipes() {
  return db.prepare('SELECT * FROM recipes ORDER BY created_at DESC').all().map(r => {
    const L = f => db.prepare('SELECT label FROM recipe_labels WHERE recipe_id=? AND facet=?').all(r.id, f).map(x => x.label);
    return { id: r.id, title: r.title, type: r.type, difficulty: r.difficulty, prep: r.prep_min, cook: r.cook_min, rest: r.rest_min, servings: r.servings, diets: L('diet'), method: L('method'), tags: L('tag'), emoji: r.emoji, hue: r.hue,
      ingredients: db.prepare('SELECT qty q,unit u,name n FROM ingredients WHERE recipe_id=? ORDER BY pos').all(r.id),
      steps: db.prepare('SELECT text t,temp_c temp,timer_min timer,kind FROM steps WHERE recipe_id=? ORDER BY pos').all(r.id).map(s => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null))) };
  });
}
// Premier lancement : charge les recettes d'exemple de app/data.js
if (db.prepare('SELECT COUNT(*) c FROM recipes').get().c === 0) {
  const sb = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(WEB, 'data.js'), 'utf8'), sb);
  sb.window.RECIPES.forEach(r => saveRecipe(r, 'manual', null, r.id));
}
const body = req => new Promise((ok, ko) => { let b = '', n = 0; req.on('data', c => { n += c.length; if (n > 12e6) { ko(new Error('Trop gros')); req.destroy(); } else b += c; }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { ko(e); } }); });
const send = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

// Protection : mot de passe (HTTP Basic) si APP_PASSWORD est défini, limite de débit sur les imports payants.
const PASS = process.env.APP_PASSWORD, hits = new Map();
const authorized = req => { if (!PASS) return true; const [, b64] = (req.headers.authorization || '').split(' '); const given = Buffer.from(b64 || '', 'base64').toString().split(':').slice(1).join(':'); return given.length === PASS.length && require('node:crypto').timingSafeEqual(Buffer.from(given), Buffer.from(PASS)); };
const limited = ip => { const now = Date.now(), a = (hits.get(ip) || []).filter(t => now - t < 3600e3); a.push(now); hits.set(ip, a); return a.length > (+process.env.IMPORTS_PER_HOUR || 30); };
// Sauvegarde quotidienne de la base (7 dernières), à côté du fichier : /data/backups sur le volume
function backup() {
  try {
    const dir = path.join(path.dirname(DBPATH), 'backups'); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'recettes-' + new Date().toISOString().slice(0, 10) + '.db');
    if (!fs.existsSync(f)) db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
    fs.readdirSync(dir).filter(n => /^recettes-.*\.db$/.test(n)).sort().slice(0, -7).forEach(n => fs.unlinkSync(path.join(dir, n)));
  } catch (e) { console.error('backup:', e.message); }
}
backup(); setInterval(backup, 6 * 3600e3).unref();
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (!authorized(req)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Mes Recettes", charset="UTF-8"' }); return res.end('Authentification requise'); }
  try {
    if (u.pathname.startsWith('/api/import/') && limited(req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress)) return send(res, 429, { error: 'Trop d\'imports, réessayez plus tard' });
    if (u.pathname === '/api/recipes' && req.method === 'GET') return send(res, 200, listRecipes());
    if (u.pathname === '/api/recipes' && req.method === 'POST') { const b = await body(req), rec = clean(b.recipe), want = typeof b.id === 'string' && /^[\w-]{1,40}$/.test(b.id) && !db.prepare('SELECT 1 FROM recipes WHERE id=?').get(b.id) ? b.id : undefined; return send(res, 201, { id: saveRecipe(rec, ['manual', 'url', 'photo'].includes(b.kind) ? b.kind : 'manual', typeof b.source_url === 'string' ? b.source_url.slice(0, 500) : null, want) }); }
    let m;
    if ((m = u.pathname.match(/^\/api\/recipes\/([\w-]+)$/)) && req.method === 'DELETE') { db.prepare('DELETE FROM recipes WHERE id=?').run(m[1]); return send(res, 200, { ok: true }); }
    if ((m = u.pathname.match(/^\/api\/recipes\/([\w-]+)$/)) && req.method === 'PUT') return send(res, 200, { id: saveRecipe(clean((await body(req)).recipe), null, null, m[1], true) });
    if (u.pathname === '/api/kv' && req.method === 'GET') return send(res, 200, Object.fromEntries(db.prepare('SELECT key,value FROM kv').all().map(x => [x.key, JSON.parse(x.value)])));
    if ((m = u.pathname.match(/^\/api\/kv\/(\w+)$/)) && req.method === 'PUT') { db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(m[1], JSON.stringify(await body(req))); return send(res, 200, { ok: true }); }
    if (u.pathname === '/api/import/url' && req.method === 'POST') return send(res, 200, await importUrl((await body(req)).url));
    if (u.pathname === '/api/import/photo' && req.method === 'POST') { const b = await body(req); return send(res, 200, await importPhoto(b.data, b.mediaType)); }
    if (u.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const f = path.join(WEB, path.normalize(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); fs.createReadStream(f).pipe(res);
  } catch (e) { send(res, e.code === 'NO_KEY' ? 501 : 400, { error: e.message }); }
}).listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
