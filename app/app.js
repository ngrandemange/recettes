(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('rec.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rec.' + k, JSON.stringify(v)); } catch (e) { alert('Stockage plein : photo trop lourde ?'); } }
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`;
const fmtQty = q => { if (!q) return ''; const r = Math.round(q * 100) / 100; return String(r).replace('.', ','); };
const DIFF = ['', 'Facile', 'Moyen', 'Difficile'];

let userRecipes = store.get('user', []);
let photos = store.get('photos', {});
let favs = new Set(store.get('favs', []));
const all = () => [...userRecipes, ...window.RECIPES].map(r => ({ ...r, total: r.prep + r.cook + r.rest, photo: photos[r.id] || r.photo }));
const byId = id => all().find(r => r.id === id);

// ---------- thèmes & vue ----------
function setTheme(t) { document.documentElement.dataset.theme = t; store.set('theme', t); document.querySelectorAll('[data-th]').forEach(b => b.classList.toggle('on', b.dataset.th === t)); }
setTheme(store.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
document.querySelectorAll('[data-th]').forEach(b => b.onclick = () => setTheme(b.dataset.th));
addEventListener('message', e => { if (e.data && e.data.theme) setTheme(e.data.theme); });
let view = store.get('view', 'grid');
function setView(v) { view = v; store.set('view', v); $('#vGrid').classList.toggle('on', v === 'grid'); $('#vList').classList.toggle('on', v === 'list'); if (!location.hash.startsWith('#/r/')) renderList(); }
$('#vGrid').onclick = () => setView('grid'); $('#vList').onclick = () => setView('list');

// ---------- filtres ----------
const F = { q: '', type: new Set(), diet: new Set(), diff: new Set(), method: new Set(), max: 360, fav: false, sort: 'rel' };
const uniq = (key) => [...new Set(all().flatMap(r => [].concat(r[key])))].sort();
function buildFilters() {
  const grp = (title, key, set, vals) => `<div class="fgroup"><h3>${title}</h3><div class="chips">${vals.map(v => `<button class="chip ${set.has(String(v.v)) ? 'on' : ''}" data-k="${key}" data-v="${esc(v.v)}">${esc(v.l)}</button>`).join('')}</div></div>`;
  $('#fbody').innerHTML =
    grp('Type de plat', 'type', F.type, uniq('type').map(v => ({ v, l: v }))) +
    grp('Régime', 'diet', F.diet, uniq('diets').map(v => ({ v, l: v }))) +
    grp('Difficulté', 'diff', F.diff, [1, 2, 3].map(v => ({ v, l: DIFF[v] }))) +
    grp('Méthode de cuisson', 'method', F.method, uniq('method').map(v => ({ v, l: v }))) +
    `<div class="fgroup"><h3>Temps total max : <b id="maxl">${F.max >= 360 ? 'illimité' : fmtMin(F.max)}</b></h3><input type="range" id="max" min="10" max="360" step="5" value="${F.max}"></div>` +
    `<div class="fgroup"><div class="chips"><button class="chip ${F.fav ? 'on' : ''}" id="favOnly">♥ Favoris uniquement</button></div></div>`;
}
$('#fbody').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  if (c.id === 'favOnly') F.fav = !F.fav;
  else { const s = F[c.dataset.k], v = c.dataset.v; s.has(v) ? s.delete(v) : s.add(v); }
  buildFilters(); renderList();
});
$('#fbody').addEventListener('input', e => { if (e.target.id === 'max') { F.max = +e.target.value; $('#maxl').textContent = F.max >= 360 ? 'illimité' : fmtMin(F.max); renderList(); } });
$('#fReset').onclick = () => { Object.assign(F, { q: '', max: 360, fav: false }); ['type', 'diet', 'diff', 'method'].forEach(k => F[k].clear()); $('#q').value = ''; buildFilters(); renderList(); };
const drawer = o => { $('#filters').classList.toggle('open', o); $('#scrim').hidden = !o; };
$('#btnFilters').onclick = () => drawer(true); $('#fClose').onclick = () => drawer(false); $('#scrim').onclick = () => drawer(false);
let qt; $('#q').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { F.q = e.target.value; if (location.hash !== '#/') location.hash = '#/'; else renderList(); }, 120); };

function score(r, terms) {
  if (!terms.length) return 1;
  const title = norm(r.title), ing = norm(r.ingredients.map(i => i.n).join(' ')), rest = norm([r.type, ...r.diets, ...r.method, ...r.tags, DIFF[r.difficulty]].join(' ')), steps = norm(r.steps.map(s => s.t).join(' '));
  let sc = 0;
  for (const t of terms) {
    const s = (title.includes(t) ? 8 : 0) + (rest.includes(t) ? 4 : 0) + (ing.includes(t) ? 3 : 0) + (steps.includes(t) ? 1 : 0);
    if (!s) return 0; sc += s; // tous les mots doivent correspondre (ET)
  }
  return sc;
}
function filtered() {
  const terms = norm(F.q).split(/\s+/).filter(Boolean);
  let out = all().map(r => ({ r, s: score(r, terms) })).filter(({ r, s }) => s &&
    (!F.type.size || F.type.has(r.type)) && (![...F.diet].length || [...F.diet].every(d => r.diets.includes(d))) &&
    (!F.diff.size || F.diff.has(String(r.difficulty))) && (!F.method.size || r.method.some(m => F.method.has(m))) &&
    r.total <= F.max && (!F.fav || favs.has(r.id)));
  const sorters = { rel: (a, b) => b.s - a.s, time: (a, b) => a.r.total - b.r.total, diff: (a, b) => a.r.difficulty - b.r.difficulty || a.r.total - b.r.total, az: (a, b) => a.r.title.localeCompare(b.r.title, 'fr') };
  return out.sort(sorters[F.sort]).map(x => x.r);
}
const nActive = () => F.type.size + F.diet.size + F.diff.size + F.method.size + (F.max < 360) + F.fav;

// ---------- rendu ----------
const thumbStyle = r => r.photo ? `background-image:url('${r.photo}')` : `background:linear-gradient(135deg,hsl(${r.hue} 70% 62%),hsl(${(r.hue + 40) % 360} 60% 38%))`;
const thumb = r => `<div class="thumb" style="${thumbStyle(r)}" role="img" aria-label="${esc(r.title)}">${r.photo ? '' : r.emoji}</div>`;
function card(r) {
  return `<a class="card" href="#/r/${r.id}">${thumb(r)}<button class="fav ${favs.has(r.id) ? 'on' : ''}" data-fav="${r.id}" aria-label="Favori">${favs.has(r.id) ? '♥' : '♡'}</button>
  <div class="body"><h3>${esc(r.title)}</h3><div class="meta"><span>⏱ ${fmtMin(r.total)}</span><span>👨‍🍳 ${DIFF[r.difficulty]}</span><span>${esc(r.type)}</span></div>
  <div class="tags">${r.diets.map(d => `<span class="tag">${esc(d)}</span>`).join('')}</div></div></a>`;
}
function renderList() {
  const rs = filtered(), n = nActive();
  const fc = $('#fcount'); fc.hidden = !n; fc.textContent = n;
  const act = [...F.type, ...F.diet, ...[...F.diff].map(d => DIFF[d]), ...F.method].map(v => `<span class="tag">${esc(v)}</span>`).join('');
  $('#main').innerHTML = `<div class="results-bar"><strong>${rs.length} recette${rs.length > 1 ? 's' : ''}</strong>
    <label>Trier : <select id="sort">${[['rel', 'Pertinence'], ['time', 'Plus rapide'], ['diff', 'Plus facile'], ['az', 'A → Z']].map(([v, l]) => `<option value="${v}" ${F.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    ${act ? `<div class="active">${act}</div>` : ''}
    ${rs.length ? `<div class="${view === 'grid' ? 'grid' : 'list'}">${rs.map(card).join('')}</div>` : `<div class="empty"><div style="font-size:3rem">🥕</div><p>Aucune recette ne correspond.</p><button class="btn" onclick="document.getElementById('fReset').click()">Réinitialiser les filtres</button></div>`}`;
  $('#sort').onchange = e => { F.sort = e.target.value; renderList(); };
}
$('#main').addEventListener('click', e => { const b = e.target.closest('[data-fav]'); if (b) { e.preventDefault(); toggleFav(b.dataset.fav); } });
function toggleFav(id) { favs.has(id) ? favs.delete(id) : favs.add(id); store.set('favs', [...favs]); route(); }

function renderDetail(id) {
  const r = byId(id); if (!r) { location.hash = '#/'; return; }
  let n = r.servings;
  const ingHtml = () => r.ingredients.map((i, k) => `<li><input type="checkbox" id="i${k}"><span>${i.q ? `<b>${fmtQty(i.q * n / r.servings)}</b> ` : ''}${esc(i.u)} ${esc(i.n)}</span></li>`).join('');
  $('#main').innerHTML = `<div class="detail"><a class="back" href="#/">← Toutes les recettes</a>
  <div class="hero">${thumb(r)}<div class="info"><div class="chips">${r.diets.map(d => `<span class="tag">${esc(d)}</span>`).join('')}<span class="tag">${esc(r.type)}</span></div>
  <h1>${esc(r.title)}</h1>
  <div class="stats"><div class="stat"><b>${fmtMin(r.prep)}</b><span>Préparation</span></div><div class="stat"><b>${fmtMin(r.cook)}</b><span>Cuisson</span></div>${r.rest ? `<div class="stat"><b>${fmtMin(r.rest)}</b><span>Repos</span></div>` : ''}<div class="stat"><b>${fmtMin(r.total)}</b><span>Total</span></div><div class="stat"><b>${DIFF[r.difficulty]}</b><span>Difficulté</span></div></div>
  <div class="meta">🔥 ${r.method.map(esc).join(' · ')}</div>
  <div class="tags">${r.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
  <div class="toolbar" style="margin-top:16px"><button class="btn" data-fav="${r.id}">${favs.has(r.id) ? '♥ Favori' : '♡ Favori'}</button><button class="btn" id="print">🖨 Imprimer</button><label class="btn">📷 Photo<input id="photo" type="file" accept="image/*" hidden></label>${photos[r.id] ? '<button class="btn" id="rmphoto">Retirer la photo</button>' : ''}${userRecipes.some(u => u.id === r.id) ? '<button class="btn" id="del">🗑 Supprimer</button>' : ''}</div></div></div>
  <div class="cols"><section class="panel"><h2>Ingrédients</h2><div class="servings"><button id="m" aria-label="Moins">−</button><b id="n">${n}</b> personnes <button id="p" aria-label="Plus">+</button></div><ul class="ing" id="ing">${ingHtml()}</ul></section>
  <section class="panel"><h2>Préparation</h2><ol class="steps">${r.steps.map((s, k) => `<li data-k="${k}"><div><span>${esc(s.t)}</span><div class="chiprow">${s.temp ? `<span class="pill temp">🌡 ${s.temp} °C</span>` : ''}${s.timer ? `<span class="pill">${s.kind === 'repos' ? '💤 Repos' : '🔥 Cuisson'} ${fmtMin(s.timer)}</span><button class="tbtn" data-timer="${s.timer}" data-label="${esc(r.title)} — étape ${k + 1}">▶ Lancer le minuteur</button>` : ''}</div></div></li>`).join('')}</ol></section></div></div>`;
  $('#ing').onchange = e => e.target.closest('li').classList.toggle('done', e.target.checked);
  const upd = d => { n = Math.max(1, n + d); $('#n').textContent = n; $('#ing').innerHTML = ingHtml(); };
  $('#m').onclick = () => upd(-1); $('#p').onclick = () => upd(1);
  $('#print').onclick = () => print();
  document.querySelectorAll('.steps li').forEach(li => li.addEventListener('dblclick', () => li.classList.toggle('done')));
  $('#photo').onchange = e => resizePhoto(e.target.files[0]).then(d => { photos[r.id] = d; store.set('photos', photos); route(); });
  if ($('#rmphoto')) $('#rmphoto').onclick = () => { delete photos[r.id]; store.set('photos', photos); route(); };
  if ($('#del')) $('#del').onclick = () => { if (confirm('Supprimer cette recette ?')) { userRecipes = userRecipes.filter(u => u.id !== r.id); store.set('user', userRecipes); location.hash = '#/'; } };
  scrollTo(0, 0);
}
function resizePhoto(file, m = 900) {
  return new Promise(res => { const img = new Image(); img.onload = () => { const k = Math.min(1, m / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .8)); }; img.src = URL.createObjectURL(file); });
}

// ---------- minuteurs ----------
const timers = []; let actx;
function beep() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); [0, .25, .5].forEach(t => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(actx.destination); g.gain.setValueAtTime(.2, actx.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, actx.currentTime + t + .2); o.start(actx.currentTime + t); o.stop(actx.currentTime + t + .22); }); navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {} }
const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600); return (h ? h + ':' : '') + String(Math.floor(s % 3600 / 60)).padStart(h ? 2 : 1, '0') + ':' + String(s % 60).padStart(2, '0'); };
function drawTimers() {
  $('#timers').innerHTML = timers.map((t, i) => `<div class="timer ${t.done ? 'ring' : ''}"><div class="clock">${clock(t.end - Date.now())}</div><div class="lbl">${t.done ? '⏰ Terminé ! ' : ''}${esc(t.label)}</div><button class="btn small" data-x="${i}">${t.done ? 'OK' : '✕'}</button></div>`).join('');
}
$('#timers').addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b) { timers.splice(+b.dataset.x, 1); drawTimers(); } });
$('#main').addEventListener('click', e => {
  const b = e.target.closest('[data-timer]'); if (!b) return;
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch {} // débloque l'audio (iOS)
  timers.push({ end: Date.now() + b.dataset.timer * 60000, label: b.dataset.label, done: false }); drawTimers();
});
setInterval(() => { let ch = false; timers.forEach(t => { if (!t.done && Date.now() >= t.end) { t.done = true; beep(); ch = true; } }); if (timers.length) drawTimers(); }, 250);

// ---------- nouvelle recette ----------
$('#btnNew').onclick = () => {
  const m = $('#modal'); m.hidden = false;
  const opt = a => a.map(v => `<option>${v}</option>`).join('');
  m.innerHTML = `<form class="mbox" id="nf"><h2>Nouvelle recette</h2>
  <div class="panel" style="margin-bottom:14px"><b>✨ Importer</b> <small id="imsg" style="color:var(--muted)">depuis une URL ou une photo (nécessite le serveur)</small><div class="toolbar" style="margin-top:8px"><input id="iurl" type="url" placeholder="https://…" style="flex:1;min-width:180px;padding:8px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface2)"><button type="button" class="btn" id="igo">Importer l'URL</button><label class="btn">📸 Photo / scan<input id="iph" type="file" accept="image/*" capture="environment" hidden></label></div></div>
  <div class="fld"><label>Titre</label><input name="title" required></div>
  <div class="row2"><div class="fld"><label>Type</label><select name="type">${opt(['Plat', 'Entrée', 'Dessert', 'Petit-déjeuner', 'Boisson', 'Base'])}</select></div>
  <div class="fld"><label>Difficulté</label><select name="difficulty"><option value="1">Facile</option><option value="2">Moyen</option><option value="3">Difficile</option></select></div>
  <div class="fld"><label>Personnes</label><input name="servings" type="number" min="1" value="4"></div></div>
  <div class="row2"><div class="fld"><label>Préparation (min)</label><input name="prep" type="number" min="0" value="15"></div><div class="fld"><label>Cuisson (min)</label><input name="cook" type="number" min="0" value="20"></div><div class="fld"><label>Repos (min)</label><input name="rest" type="number" min="0" value="0"></div></div>
  <div class="fld"><label>Régimes (séparés par des virgules)</label><input name="diets" value="Vegan"></div>
  <div class="fld"><label>Méthodes de cuisson (virgules)</label><input name="method" value="Four"></div>
  <div class="fld"><label>Ingrédients — un par ligne : « 200 g farine »</label><textarea name="ing" rows="5" placeholder="200 g farine&#10;2 oignons"></textarea></div>
  <div class="fld"><label>Étapes — une par ligne. Syntaxe optionnelle : « texte | 180°C | 25 min »</label><textarea name="steps" rows="5" placeholder="Préchauffer et mélanger.&#10;Cuire au four | 180°C | 25 min"></textarea></div>
  <div class="fld"><label>Photo</label><input name="photo" type="file" accept="image/*"></div>
  <div class="toolbar"><button class="btn primary">Enregistrer</button><button type="button" class="btn" id="cancel">Annuler</button></div></form>`;
  $('#cancel').onclick = () => { m.hidden = true; };
  const fill = r => { const f = $('#nf').elements, set = (k, v) => { f[k].value = v; };
    set('title', r.title); set('type', r.type); set('difficulty', r.difficulty); set('servings', r.servings); set('prep', r.prep); set('cook', r.cook); set('rest', r.rest);
    set('diets', r.diets.join(', ')); set('method', r.method.join(', '));
    set('ing', r.ingredients.map(i => [i.q || '', i.u, i.n].filter(Boolean).join(' ')).join('\n'));
    set('steps', r.steps.map(s => [s.t, s.temp ? s.temp + '°C' : '', s.timer ? s.timer + ' min' : ''].filter((x, k) => k === 0 || x).join(' | ')).join('\n')); };
  const imp = async (path, payload, label) => { const msg = $('#imsg'); msg.textContent = '⏳ ' + label + '…';
    try { const r = await fetch('/api/import/' + path, { method: 'POST', body: JSON.stringify(payload) }), j = await r.json(); if (!r.ok) throw new Error(j.error); fill(j.recipe); msg.textContent = '✅ Importé (' + j.via + ') — relisez avant d\'enregistrer !'; }
    catch (e) { msg.textContent = '⚠️ ' + e.message; } };
  $('#igo').onclick = () => $('#iurl').value && imp('url', { url: $('#iurl').value }, 'Lecture de la page');
  $('#iph').onchange = async e => { const d = await resizePhoto(e.target.files[0], 1600); imp('photo', { data: d.split(',')[1], mediaType: 'image/jpeg' }, 'Lecture de la photo'); };
  $('#nf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target), list = k => f.get(k).split(',').map(s => s.trim()).filter(Boolean);
    const ing = f.get('ing').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const x = l.match(/^([\d.,]+)\s*(\S+)?\s+(.*)$/); return x ? { q: parseFloat(x[1].replace(',', '.')), u: x[2] || '', n: x[3] } : { q: 0, u: '', n: l }; });
    const steps = f.get('steps').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [t, a, b] = l.split('|').map(s => s.trim()), s = { t }; [a, b].forEach(x => { if (!x) return; if (/°/.test(x)) s.temp = parseInt(x); else if (/\d/.test(x)) { s.timer = parseInt(x); s.kind = /repos|frais/i.test(t) ? 'repos' : 'cuisson'; } }); return s; });
    const file = f.get('photo');
    const r = { id: 'u' + Date.now(), title: f.get('title'), emoji: '🍽️', hue: Math.floor(Math.random() * 360), type: f.get('type'), diets: list('diets'), difficulty: +f.get('difficulty'), prep: +f.get('prep'), cook: +f.get('cook'), rest: +f.get('rest'), method: list('method'), servings: +f.get('servings') || 1, tags: [], ingredients: ing, steps };
    if (file && file.size) r.photo = await resizePhoto(file);
    userRecipes.unshift(r); store.set('user', userRecipes); m.hidden = true; buildFilters(); location.hash = '#/r/' + r.id;
  };
};
addEventListener('keydown', e => { if (e.key === 'Escape') { $('#modal').hidden = true; drawer(false); } if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); } });

// ---------- routeur ----------
function route() { const m = location.hash.match(/^#\/r\/(.+)$/); drawer(false); m ? renderDetail(m[1]) : renderList(); }
addEventListener('hashchange', route);
buildFilters(); setView(view); route();
})();
