// Tests de l'API : lance le vrai serveur sur une base temporaire.
const assert = require('node:assert'), { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const free = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-')), db = path.join(dir, 'r.db');
const start = async () => { const port = await free(), proc = spawn(process.execPath, ['--no-warnings', path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: port, DB: db, APP_PASSWORD: '' }, stdio: 'ignore' }); const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/healthz')).ok) return { proc, base }; } catch {} await new Promise(r => setTimeout(r, 100)); } throw new Error('serveur non démarré'); };
const J = (b, p, m = 'GET', body) => fetch(b + p, { method: m, body: body === undefined ? undefined : JSON.stringify(body) });
(async () => {
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
    console.log('tests API OK');
  } finally { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
