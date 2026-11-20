// Service worker : réseau d'abord, copie en cache si hors-ligne (recettes, courses, planning lisibles en cuisine).
const CACHE = 'recettes-v5', SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'data.js', 'lib.js', 'manifest.webmanifest', 'icon-192.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (u.origin === location.origin && r.method !== 'GET' && u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/import')) { e.respondWith(afterWrite(r, u)); return; }
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/import')) return;
  e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })
    .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html'))));
});

// Après une écriture réussie, la copie en cache des données est remise à jour : sinon, rouvrir l'app
// hors-ligne afficherait la version d'avant (liste de courses, recettes modifiées).
async function afterWrite(r, u) {
  const body = r.method === 'PUT' && u.pathname.startsWith('/api/kv/') ? await r.clone().text() : null;
  const res = await fetch(r);
  if (!res.ok) return res;
  try {
    const c = await caches.open(CACHE);
    if (body !== null) {
      const key = new Request('/api/kv'), hit = await c.match(key), cur = hit ? await hit.json() : {};
      cur[u.pathname.split('/').pop()] = JSON.parse(body);
      await c.put(key, new Response(JSON.stringify(cur), { headers: { 'content-type': 'application/json' } }));
    } else if (u.pathname.startsWith('/api/recipes')) {
      const fresh = await fetch('/api/recipes'); if (fresh.ok) await c.put(new Request('/api/recipes'), fresh);
    }
  } catch {}
  return res;
}
