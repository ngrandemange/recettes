// Serveur sans dépendance : fichiers statiques de ../app + API JSON + SQLite (node:sqlite).
'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { DatabaseSync } = require('node:sqlite');
const vm = require('node:vm');
const { importUrl, importPhoto } = require('./import');
const db = new DatabaseSync(process.env.DB || path.join(__dirname, 'recettes.db'));
db.exec('PRAGMA foreign_keys=ON'); db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
const WEB = path.join(__dirname, '..', 'app'), MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function saveRecipe(r, kind, src, fixedId) {
  const id = fixedId || 'r' + Date.now().toString(36);
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO recipes(id,title,type,difficulty,prep_min,cook_min,rest_min,servings,source_url,source_kind,emoji,hue) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, r.title, r.type, r.difficulty, r.prep, r.cook, r.rest, r.servings, src || null, kind, r.emoji || '🍽️', r.hue ?? 200);
    r.ingredients.forEach((i, p) => db.prepare('INSERT INTO ingredients VALUES(?,?,?,?,?)').run(id, p, i.q, i.u, i.n));
    r.steps.forEach((s, p) => db.prepare('INSERT INTO steps VALUES(?,?,?,?,?,?)').run(id, p, s.t, s.temp ?? null, s.timer ?? null, s.kind ?? null));
    for (const [f, a] of [['diet', r.diets], ['method', r.method], ['tag', r.tags]]) a.forEach(l => db.prepare('INSERT OR IGNORE INTO recipe_labels VALUES(?,?,?)').run(id, f, l));
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

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/api/recipes' && req.method === 'GET') return send(res, 200, listRecipes());
    if (u.pathname === '/api/recipes' && req.method === 'POST') { const b = await body(req); return send(res, 201, { id: saveRecipe(b.recipe, b.kind || 'manual', b.source_url) }); }
    let m;
    if ((m = u.pathname.match(/^\/api\/recipes\/([\w-]+)$/)) && req.method === 'DELETE') { db.prepare('DELETE FROM recipes WHERE id=?').run(m[1]); return send(res, 200, { ok: true }); }
    if (u.pathname === '/api/kv' && req.method === 'GET') return send(res, 200, Object.fromEntries(db.prepare('SELECT key,value FROM kv').all().map(x => [x.key, JSON.parse(x.value)])));
    if ((m = u.pathname.match(/^\/api\/kv\/(\w+)$/)) && req.method === 'PUT') { db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(m[1], JSON.stringify(await body(req))); return send(res, 200, { ok: true }); }
    if (u.pathname === '/api/import/url' && req.method === 'POST') return send(res, 200, await importUrl((await body(req)).url));
    if (u.pathname === '/api/import/photo' && req.method === 'POST') { const b = await body(req); return send(res, 200, await importPhoto(b.data, b.mediaType)); }
    if (u.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const f = path.join(WEB, path.normalize(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  } catch (e) { send(res, e.code === 'NO_KEY' ? 501 : 400, { error: e.message }); }
}).listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
