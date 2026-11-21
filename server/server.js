// Serveur sans dépendance : fichiers statiques de ../app + API JSON + SQLite (node:sqlite).
'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { DatabaseSync } = require('node:sqlite');
const vm = require('node:vm');
const { importUrl, importPhoto, sniff, canonicalUrl } = require('./import');
const DBPATH = process.env.DB || path.join(__dirname, 'recettes.db');
fs.mkdirSync(path.dirname(DBPATH), { recursive: true });
const db = new DatabaseSync(DBPATH);
db.exec('PRAGMA foreign_keys=ON'); db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
// Migrations d'une base créée avec un schéma plus ancien
if (!db.prepare('PRAGMA table_info(ingredients)').all().some(c => c.name === 'ref')) db.exec('ALTER TABLE ingredients ADD COLUMN ref TEXT');
if (!/'season'/.test(db.prepare("SELECT sql FROM sqlite_master WHERE name='recipe_labels'").get().sql)) {
  db.exec("BEGIN; CREATE TABLE recipe_labels_new (recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE, facet TEXT NOT NULL CHECK (facet IN ('diet','method','tag','season','collection')), label TEXT NOT NULL, PRIMARY KEY (recipe_id, facet, label)); INSERT INTO recipe_labels_new SELECT recipe_id,facet,label FROM recipe_labels; DROP TABLE recipe_labels; ALTER TABLE recipe_labels_new RENAME TO recipe_labels; CREATE INDEX IF NOT EXISTS idx_labels ON recipe_labels(facet, label); COMMIT;");
}
const WEB = path.join(__dirname, '..', 'app'), MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

// Validation / normalisation d'une recette reçue (création, modification, restauration)
function clean(r) {
  if (!r || typeof r.title !== 'string' || !r.title.trim()) throw new Error('Titre requis');
  const I = (x, lo, hi, d) => { if (x === null || x === undefined || x === '') return d; x = Math.round(Number(x)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; }, A = a => Array.isArray(a) ? a : [];
  return { title: r.title.trim().slice(0, 140), type: String(r.type || 'Plat').slice(0, 40), difficulty: I(r.difficulty, 1, 3, 1), prep: I(r.prep, 0, 1440, 0), cook: I(r.cook, 0, 1440, 0), rest: I(r.rest, 0, 10080, 0), servings: I(r.servings, 1, 100, 4),
    emoji: String(r.emoji || '🍽️').slice(0, 8), hue: I(r.hue, 0, 360, 200), diets: A(r.diets).map(String), method: A(r.method).map(String), tags: A(r.tags).map(String),
    seasons: A(r.seasons).map(String).filter(x => ["Printemps", "Été", "Automne", "Hiver", "Toute l'année"].includes(x)), collections: A(r.collections).map(x => String(x).trim().slice(0, 40)).filter(Boolean),
    ingredients: A(r.ingredients).filter(i => i && i.n).map(i => ({ q: Math.max(0, Number(i.q) || 0), u: String(i.u || ''), n: String(i.n), ref: typeof i.ref === 'string' && /^[\w-]{1,40}$/.test(i.ref) ? i.ref : null })),
    steps: A(r.steps).filter(s => s && s.t).map(s => { const temp = Number(s.temp) > 0 ? I(s.temp, 1, 350, null) : null, timer = Number(s.timer) > 0 ? I(s.timer, 1, 10080, null) : null; return { t: String(s.t), temp, timer, kind: timer && (s.kind === 'repos' || s.kind === 'cuisson') ? s.kind : null }; }) };
}
function saveRecipe(r, kind, src, fixedId, replace) {
  const id = fixedId || 'r' + Date.now().toString(36) + require('node:crypto').randomBytes(3).toString('hex');
  db.exec('BEGIN');
  try {
    let created = null, keepPhoto = null;
    if (replace) { keepPhoto = db.prepare('SELECT mime,data,bytes,updated_at FROM photos WHERE recipe_id=?').get(id); const o = db.prepare('SELECT created_at,source_url,source_kind FROM recipes WHERE id=?').get(id); if (!o) throw new Error('Recette introuvable'); created = o.created_at; src = o.source_url; kind = o.source_kind; db.prepare('DELETE FROM recipes WHERE id=?').run(id); }
    db.prepare('INSERT INTO recipes(id,title,type,difficulty,prep_min,cook_min,rest_min,servings,source_url,source_kind,emoji,hue) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, r.title, r.type, r.difficulty, r.prep, r.cook, r.rest, r.servings, src || null, kind, r.emoji || '🍽️', r.hue ?? 200);
    r.ingredients.forEach((i, p) => db.prepare('INSERT INTO ingredients(recipe_id,pos,qty,unit,name,ref) VALUES(?,?,?,?,?,?)').run(id, p, i.q, i.u, i.n, i.ref ?? null));
    r.steps.forEach((s, p) => db.prepare('INSERT INTO steps VALUES(?,?,?,?,?,?)').run(id, p, s.t, s.temp ?? null, s.timer ?? null, s.kind ?? null));
    for (const [f, a] of [['diet', r.diets], ['method', r.method], ['tag', r.tags], ['season', r.seasons || []], ['collection', r.collections || []]]) a.forEach(l => db.prepare('INSERT OR IGNORE INTO recipe_labels VALUES(?,?,?)').run(id, f, l));
    if (created) db.prepare('UPDATE recipes SET created_at=? WHERE id=?').run(created, id);
    if (keepPhoto) db.prepare('INSERT INTO photos VALUES(?,?,?,?,?)').run(id, keepPhoto.mime, keepPhoto.data, keepPhoto.bytes, keepPhoto.updated_at);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return id;
}
function listRecipes() {
  const ph = new Map(db.prepare('SELECT recipe_id id, updated_at u FROM photos').all().map(x => [x.id, x.u]));
  return db.prepare('SELECT * FROM recipes ORDER BY created_at DESC').all().map(r => {
    const L = f => db.prepare('SELECT label FROM recipe_labels WHERE recipe_id=? AND facet=?').all(r.id, f).map(x => x.label);
    return { id: r.id, title: r.title, type: r.type, difficulty: r.difficulty, prep: r.prep_min, cook: r.cook_min, rest: r.rest_min, servings: r.servings, diets: L('diet'), method: L('method'), tags: L('tag'), seasons: L('season'), collections: L('collection'), source: r.source_url || null, emoji: r.emoji, hue: r.hue, photo: ph.has(r.id) ? `/api/recipes/${r.id}/photo?v=${ph.get(r.id)}` : null,
      ingredients: db.prepare('SELECT qty q,unit u,name n,ref FROM ingredients WHERE recipe_id=? ORDER BY pos').all(r.id).map(i => i.ref ? i : { q: i.q, u: i.u, n: i.n }),
      steps: db.prepare('SELECT text t,temp_c temp,timer_min timer,kind FROM steps WHERE recipe_id=? ORDER BY pos').all(r.id).map(s => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null))) };
  });
}
// Recettes d'exemple (app/data.js) : chargées au premier lancement ; les versions suivantes n'ajoutent que les NOUVELLES
// recettes d'exemple et les étiquettes manquantes, sans ressusciter ce que vous avez supprimé ni écraser vos modifications.
const SEED_VERSION = 2;
(function seed() {
  const sb = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(WEB, 'data.js'), 'utf8'), sb);
  const seeds = sb.window.RECIPES, ver = db.prepare("SELECT value FROM kv WHERE key='seedver'").get(), count = db.prepare('SELECT COUNT(*) c FROM recipes').get().c;
  if (ver && JSON.parse(ver.value) >= SEED_VERSION) return;
  if (count === 0) seeds.forEach(r => saveRecipe(clean(r), 'manual', null, r.id));
  else {
    const NEW = ['pate-brisee-vegan', 'bouillon-legumes'], has = id => db.prepare('SELECT 1 FROM recipes WHERE id=?').get(id);
    seeds.filter(r => NEW.includes(r.id) && !has(r.id)).forEach(r => saveRecipe(clean(r), 'manual', null, r.id));
    for (const r of seeds) if (has(r.id) && !db.prepare("SELECT 1 FROM recipe_labels WHERE recipe_id=? AND facet IN ('season','collection')").get(r.id)) {
      for (const [f, a] of [['season', r.seasons || []], ['collection', r.collections || []]]) a.forEach(l => db.prepare('INSERT OR IGNORE INTO recipe_labels VALUES(?,?,?)').run(r.id, f, l));
    }
    db.prepare("UPDATE ingredients SET name='Pâte brisée vegan', ref='pate-brisee-vegan' WHERE recipe_id='quiche-poireaux-tofu' AND name='pâte brisée vegan' AND ref IS NULL").run();
    db.prepare("UPDATE ingredients SET name='Bouillon de légumes maison', unit='', qty=1, ref='bouillon-legumes' WHERE recipe_id='soupe-potimarron' AND name='de bouillon de légumes' AND ref IS NULL").run();
  }
  db.prepare("INSERT INTO kv VALUES('seedver',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(SEED_VERSION));
})();
const MAX_PHOTO = 8 * 1024 * 1024;
// Lit le corps en octets ; au-delà de max : 413 (le reste est lu puis jeté, la connexion reste utilisable pour répondre)
const raw = (req, max, msg = 'Photo trop lourde (8 Mo max)') => new Promise((ok, ko) => { const parts = []; let n = 0, over = false; req.on('data', c => { n += c.length; if (over) return; if (n > max) { over = true; parts.length = 0; ko(Object.assign(new Error(msg), { status: 413 })); if (n > max * 4) req.destroy(); } else parts.push(c); }); req.on('end', () => { if (!over) ok(Buffer.concat(parts)); }); req.on('error', ko); });
function putPhoto(id, buf, mime) { db.prepare('INSERT INTO photos VALUES(?,?,?,?,?) ON CONFLICT(recipe_id) DO UPDATE SET mime=excluded.mime,data=excluded.data,bytes=excluded.bytes,updated_at=excluded.updated_at').run(id, mime, buf, buf.length, Date.now()); }
// Migration : anciennes photos stockées en texte dans la table kv -> BLOB
(function migratePhotos() {
  const row = db.prepare("SELECT value FROM kv WHERE key='photos'").get(); if (!row) return;
  let map; try { map = JSON.parse(row.value); } catch { return; }
  const left = {}; let moved = 0;
  for (const [id, u] of Object.entries(map || {})) {
    const m = typeof u === 'string' && /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(u), buf = m && Buffer.from(m[1], 'base64'), mime = buf && sniff(buf);
    if (mime && db.prepare('SELECT 1 FROM recipes WHERE id=?').get(id)) { if (!db.prepare('SELECT 1 FROM photos WHERE recipe_id=?').get(id)) putPhoto(id, buf, mime); moved++; } else left[id] = u;
  }
  if (Object.keys(left).length) db.prepare("UPDATE kv SET value=? WHERE key='photos'").run(JSON.stringify(left)); else db.prepare("DELETE FROM kv WHERE key='photos'").run();
  if (moved) console.log(`photos migrées vers la base : ${moved}`);
})();
const body = req => raw(req, 12e6, 'Requête trop volumineuse (12 Mo max)').then(buf => { try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('JSON invalide'), { status: 400 }); } });
const send = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

// Protection : mot de passe (HTTP Basic) si APP_PASSWORD est défini, limite de débit sur les imports payants.
const PASS = process.env.APP_PASSWORD, hits = new Map();
const crypto = require('node:crypto'), digest = x => crypto.createHash('sha256').update(String(x), 'utf8').digest();
const authorized = req => {
  if (!PASS) return true;
  const [scheme, b64] = String(req.headers.authorization || '').split(' ');
  if (!/^basic$/i.test(scheme || '')) return false;
  const dec = Buffer.from(b64 || '', 'base64').toString('utf8'), i = dec.indexOf(':');
  return crypto.timingSafeEqual(digest(i < 0 ? '' : dec.slice(i + 1)), digest(PASS));
};
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
if (!PASS) console.warn('⚠️  APP_PASSWORD non défini : l\'application est ouverte à tous. À éviter hors poste local.');
backup(); setInterval(backup, 6 * 3600e3).unref();
process.on('unhandledRejection', e => console.error('rejet non traité :', e && e.message));
async function handle(req, res) {
  let u; try { u = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end('Requête invalide'); }
  if (u.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (!authorized(req)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Mes Recettes", charset="UTF-8"' }); return res.end('Authentification requise'); }
  try {
    if (u.pathname.startsWith('/api/import/') && limited(req.headers['x-forwarded-for']?.split(',').pop().trim() || req.socket.remoteAddress)) return send(res, 429, { error: 'Trop d\'imports, réessayez plus tard' });
    if (u.pathname === '/api/recipes' && req.method === 'GET') return send(res, 200, listRecipes());
    if (u.pathname === '/api/recipes' && req.method === 'POST') { const b = await body(req), rec = clean(b.recipe), want = typeof b.id === 'string' && /^[\w-]{1,40}$/.test(b.id) && !db.prepare('SELECT 1 FROM recipes WHERE id=?').get(b.id) ? b.id : undefined; return send(res, 201, { id: saveRecipe(rec, ['manual', 'url', 'photo'].includes(b.kind) ? b.kind : 'manual', typeof b.source_url === 'string' ? (canonicalUrl(b.source_url) || null) : null, want) }); }
    let m;
    if ((m = u.pathname.match(/^\/api\/recipes\/([\w-]+)$/)) && req.method === 'DELETE') { db.prepare('DELETE FROM recipes WHERE id=?').run(m[1]); return send(res, 200, { ok: true }); }
    if ((m = u.pathname.match(/^\/api\/recipes\/([\w-]+)$/)) && req.method === 'PUT') return send(res, 200, { id: saveRecipe(clean((await body(req)).recipe), null, null, m[1], true) });
    if ((m = u.pathname.match(/^\/api\/recipes\/([\w-]+)\/photo$/))) {
      if (!db.prepare('SELECT 1 FROM recipes WHERE id=?').get(m[1])) return send(res, 404, { error: 'Recette introuvable' });
      if (req.method === 'GET') {
        const p = db.prepare('SELECT mime,data FROM photos WHERE recipe_id=?').get(m[1]); if (!p) return send(res, 404, { error: 'Pas de photo' });
        res.writeHead(200, { 'content-type': p.mime, 'content-length': p.data.length, 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' }); return res.end(Buffer.from(p.data));
      }
      if (req.method === 'PUT') { const buf = await raw(req, MAX_PHOTO), mime = sniff(buf); if (!mime) return send(res, 400, { error: 'Fichier image non reconnu (JPEG, PNG ou WebP)' }); putPhoto(m[1], buf, mime); return send(res, 200, { ok: true, bytes: buf.length }); }
      if (req.method === 'DELETE') { db.prepare('DELETE FROM photos WHERE recipe_id=?').run(m[1]); return send(res, 200, { ok: true }); }
    }
    if (u.pathname === '/api/kv' && req.method === 'GET') return send(res, 200, Object.fromEntries(db.prepare('SELECT key,value FROM kv').all().map(x => [x.key, JSON.parse(x.value)])));
    if ((m = u.pathname.match(/^\/api\/kv\/(\w+)$/)) && req.method === 'PUT') { db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(m[1], JSON.stringify(await body(req))); return send(res, 200, { ok: true }); }
    if (u.pathname === '/api/import/url' && req.method === 'POST') {
      const out = await importUrl((await body(req)).url), dup = out.source_url && db.prepare('SELECT id,title FROM recipes WHERE source_url=?').get(out.source_url);
      return send(res, 200, { ...out, duplicate: dup || null });
    }
    if (u.pathname === '/api/import/photo' && req.method === 'POST') { const b = await body(req); return send(res, 200, await importPhoto(b.data, b.mediaType)); }
    if (u.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const f = path.join(WEB, path.normalize(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); fs.createReadStream(f).on('error', () => res.destroy()).pipe(res);
  } catch (e) { if (!res.headersSent) send(res, e.status || (e.code === 'NO_KEY' ? 501 : 400), { error: e.message }); else res.destroy(); }
}
http.createServer((req, res) => { handle(req, res).catch(e => { console.error('erreur :', e && e.message); try { if (!res.headersSent) send(res, 500, { error: 'Erreur interne' }); else res.destroy(); } catch {} }); }).listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
