// Tests de l'API : lance le vrai serveur sur une base temporaire.
const assert = require('node:assert'), { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const free = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-')), db = path.join(dir, 'r.db');
const start = async (extra = {}, dbFile = db) => { const port = await free(), proc = spawn(process.execPath, ['--no-warnings', path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: port, DB: dbFile, APP_PASSWORD: '', ANTHROPIC_API_KEY: '', ...extra }, stdio: 'ignore' }); const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/healthz')).ok) return { proc, base }; } catch {} await new Promise(r => setTimeout(r, 100)); } throw new Error('serveur non démarré'); };
const J = (b, p, m = 'GET', body) => fetch(b + p, { method: m, body: body === undefined ? undefined : JSON.stringify(body) });
async function testMigration() {
  const { DatabaseSync } = require('node:sqlite'), file = path.join(dir, 'ancienne.db'), d = new DatabaseSync(file);
  const old = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').replace(/\n\s*ref TEXT,[^\n]*/, '').replace("'tag','season','collection'", "'tag'");
  d.exec('PRAGMA foreign_keys=ON'); d.exec(old);
  d.prepare("INSERT INTO recipes(id,title,type,difficulty,source_kind) VALUES('quiche-poireaux-tofu','Quiche','Plat',2,'manual')").run();
  d.prepare("INSERT INTO ingredients VALUES('quiche-poireaux-tofu',0,1,'','pâte brisée vegan')").run();
  d.prepare("INSERT INTO recipe_labels VALUES('quiche-poireaux-tofu','diet','Vegan')").run(); d.close();
  const s = await start({}, file);
  try {
    const list = await (await J(s.base, '/api/recipes')).json(), q = list.find(x => x.id === 'quiche-poireaux-tofu');
    assert.ok(list.find(x => x.id === 'pate-brisee-vegan') && list.find(x => x.id === 'bouillon-legumes'), 'nouvelles recettes de base ajoutées');
    assert.equal(q.ingredients[0].ref, 'pate-brisee-vegan', 'ingrédient relié à la recette de base'); assert.deepEqual(q.seasons.sort(), ['Automne', 'Printemps'], 'saisons ajoutées'); assert.deepEqual(q.diets, ['Vegan'], 'étiquettes existantes conservées');
    assert.ok(!list.find(x => x.id === 'houmous'), 'une recette d\'exemple absente (supprimée par vous) n\'est pas ressuscitée');
    assert.equal(list.length, 3);
  } finally { s.proc.kill(); }
  const again = await start({}, file); try { assert.equal((await (await J(again.base, '/api/recipes')).json()).length, 3, 'redémarrage : rien n\'est ré-ajouté'); } finally { again.proc.kill(); }
}
(async () => {
  await testMigration();
  let { proc, base } = await start();
  try {
    const r = { title: 'Test photo', type: 'Plat', difficulty: 1, prep: 1, cook: 1, rest: 0, servings: 2, diets: [], method: [], tags: [], ingredients: [{ q: 1, u: 'g', n: 'x' }], steps: [{ t: 'a' }] };
    const id = (await (await J(base, '/api/recipes', 'POST', { recipe: r })).json()).id;
    let list = await (await J(base, '/api/recipes')).json(); assert.equal(list.find(x => x.id === id).photo, null);
    // dépôt de photo
    let x = await fetch(base + `/api/recipes/${id}/photo`, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG }); assert.equal(x.status, 200);
    list = await (await J(base, '/api/recipes')).json(); const url = list.find(y => y.id === id).photo; assert.match(url, new RegExp(`^/api/recipes/${id}/photo\\?v=\\d+$`));
    x = await fetch(base + url); assert.equal(x.headers.get('content-type'), 'image/png'); assert.ok(Buffer.from(await x.arrayBuffer()).equals(PNG), 'octets identiques');
    assert.ok(JSON.stringify(list).length < 20000, "la liste ne contient pas l'image");
    // refus : faux fichier, trop gros, recette inconnue
    x = await fetch(base + `/api/recipes/${id}/photo`, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: Buffer.from('<html>pas une image</html>') }); assert.equal(x.status, 400);
    x = await fetch(base + `/api/recipes/${id}/photo`, { method: 'PUT', body: Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]) }).catch(() => ({ status: 413 })); assert.equal(x.status, 413);
    x = await fetch(base + '/api/recipes/inconnue/photo'); assert.equal(x.status, 404);
    // modification de la recette : la photo est conservée
    await J(base, '/api/recipes/' + id, 'PUT', { recipe: { ...r, title: 'Test photo modifié' } });
    list = await (await J(base, '/api/recipes')).json(); assert.equal(list.find(y => y.id === id).title, 'Test photo modifié'); assert.ok(list.find(y => y.id === id).photo, 'photo conservée après modification');
    // suppression de la photo puis de la recette (cascade)
    await J(base, `/api/recipes/${id}/photo`, 'DELETE'); assert.equal((await fetch(base + `/api/recipes/${id}/photo`)).status, 404);
    await fetch(base + `/api/recipes/${id}/photo`, { method: 'PUT', body: PNG }); await J(base, '/api/recipes/' + id, 'DELETE');
    // migration depuis l'ancien stockage (kv, texte) au redémarrage
    const ids = await Promise.all([1, 2, 3, 4, 5].map(async () => (await (await J(base, '/api/recipes', 'POST', { recipe: r })).json()).id));
    assert.equal(new Set(ids).size, 5, 'créations simultanées : identifiants distincts');
    const id2 = (await (await J(base, '/api/recipes', 'POST', { recipe: r })).json()).id;
    await J(base, '/api/kv/photos', 'PUT', { [id2]: 'data:image/png;base64,' + PNG.toString('base64'), fantome: 'data:image/png;base64,' + PNG.toString('base64') });
    proc.kill(); ({ proc, base } = await start());
    list = await (await J(base, '/api/recipes')).json(); assert.ok(list.find(y => y.id === id2).photo, 'photo migrée en BLOB');
    const kv = await (await J(base, '/api/kv')).json(); assert.deepEqual(Object.keys(kv.photos || {}), ['fantome'], 'seule la photo orpheline reste en kv');
    // saisons, collections, recettes de base : aller-retour et conservation à la modification
    const rb = { ...r, title: 'Base', type: 'Base', seasons: ['Hiver', "Toute l'année", 'Inconnue'], collections: ['Fêtes', ' '] };
    const idb = (await (await J(base, '/api/recipes', 'POST', { recipe: rb })).json()).id;
    const rt = { ...r, title: 'Tarte', ingredients: [{ q: 1, u: '', n: 'Base', ref: idb }, { q: 2, u: 'g', n: 'sel', ref: 'pas valide !' }] };
    const idt = (await (await J(base, '/api/recipes', 'POST', { recipe: rt })).json()).id;
    list = await (await J(base, '/api/recipes')).json(); const B = list.find(y => y.id === idb), T = list.find(y => y.id === idt);
    assert.deepEqual(B.seasons.sort(), ['Hiver', "Toute l'année"], 'saisons inconnues écartées'); assert.deepEqual(B.collections, ['Fêtes'], 'collections vides écartées');
    assert.equal(T.ingredients[0].ref, idb); assert.ok(!('ref' in T.ingredients[1]), 'référence invalide ignorée');
    await J(base, '/api/recipes/' + idt, 'PUT', { recipe: { ...rt, title: 'Tarte 2' } }); list = await (await J(base, '/api/recipes')).json(); assert.equal(list.find(y => y.id === idt).ingredients[0].ref, idb, 'référence conservée à la modification');
    // import : doublons, photo de la page, adresse canonique, SSRF
    const http = require('node:http'), fport = await free();
    const page = `<html><script type="application/ld+json">{"@type":"Recipe","name":"Crumble importé","recipeYield":"4","recipeIngredient":["200 g de farine"],"recipeInstructions":["Cuire."],"image":"/img.png"}</script></html>`;
    const fx = http.createServer((q, s) => { if (q.url.startsWith('/img.png')) { s.writeHead(200, { 'content-type': 'image/png' }); s.end(PNG); } else if (q.url.startsWith('/recette')) { s.writeHead(200, { 'content-type': 'text/html' }); s.end(page); } else { s.writeHead(404); s.end(); } }).listen(fport);
    const fixture = `http://127.0.0.1:${fport}/recette`;
    let ref1 = await start({}); let bad = await J(ref1.base, '/api/import/url', 'POST', { url: fixture }); assert.equal(bad.status, 400, 'adresse locale refusée par défaut (SSRF)'); assert.match((await bad.json()).error, /interdite/); ref1.proc.kill();
    const ok = await start({ ALLOW_PRIVATE_FETCH: '1' });
    try {
      const imp = await (await J(ok.base, '/api/import/url', 'POST', { url: fixture + '/?utm_source=x#frag' })).json();
      assert.equal(imp.recipe.title, 'Crumble importé'); assert.equal(imp.source_url, fixture); assert.match(imp.imageData, /^data:image\/png;base64,/); assert.equal(imp.duplicate, null);
      const idi = (await (await J(ok.base, '/api/recipes', 'POST', { recipe: { ...r, title: 'Crumble importé' }, kind: 'url', source_url: fixture + '?utm_medium=y' })).json()).id;
      const again = await (await J(ok.base, '/api/import/url', 'POST', { url: fixture })).json(); assert.deepEqual(again.duplicate, { id: idi, title: 'Crumble importé' }, 'doublon détecté malgré les paramètres de suivi');
      assert.equal((await (await J(ok.base, '/api/recipes')).json()).find(y => y.id === idi).source, fixture, 'source exposée');
    } finally { ok.proc.kill(); fx.close(); }
    console.log('tests API OK');
  } finally { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
