(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const SK = new Set(['favs', 'photos', 'shop', 'plan']); // clés stockées côté serveur quand il est disponible
let serverMode = false, serverRecipes = null, cache = {};
const store = {
  get(k, d) { if (serverMode && SK.has(k)) return k in cache ? cache[k] : d; try { const v = localStorage.getItem('rec.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) {
    if (serverMode && SK.has(k)) { // copie locale + drapeau « à synchroniser » si le serveur est injoignable
      cache[k] = v; try { localStorage.setItem('rec.' + k, JSON.stringify(v)); } catch {}
      fetch('/api/kv/' + k, { method: 'PUT', body: JSON.stringify(v) }).then(r => { if (!r.ok) throw 0; try { localStorage.removeItem('rec.dirty.' + k); } catch {} }).catch(() => { try { localStorage.setItem('rec.dirty.' + k, '1'); } catch {} });
      return;
    }
    try { localStorage.setItem('rec.' + k, JSON.stringify(v)); } catch (e) { alert('Stockage plein : photo trop lourde ?'); }
  }
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`;
const fmtQty = q => { if (!q) return ''; const r = Math.round(q * 100) / 100; return String(r).replace('.', ','); };
const DIFF = ['', 'Facile', 'Moyen', 'Difficile'];

let userRecipes = [], photos = {}, favs = new Set();
const all = () => [...userRecipes, ...(serverRecipes || window.RECIPES).filter(b => !userRecipes.some(u => u.id === b.id))].map(r => ({ ...r, total: r.prep + r.cook + r.rest, photo: photos[r.id] || r.photo }));
const byId = id => all().find(r => r.id === id);

// ---------- thèmes & vue ----------
function setTheme(t) { document.documentElement.dataset.theme = t; store.set('theme', t); document.querySelectorAll('[data-th]').forEach(b => b.classList.toggle('on', b.dataset.th === t)); }
setTheme(store.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
document.querySelectorAll('[data-th]').forEach(b => b.onclick = () => setTheme(b.dataset.th));
addEventListener('message', e => { if (e.data && e.data.theme) setTheme(e.data.theme); });
let view = store.get('view', 'grid');
function setView(v) { view = v; store.set('view', v); $('#vGrid').classList.toggle('on', v === 'grid'); $('#vList').classList.toggle('on', v === 'list'); if (document.body.dataset.page === 'list') renderList(); }
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
    ${rs.length ? `<div class="${view === 'grid' ? 'grid' : 'list'}">${rs.map(card).join('')}</div>` : `<div class="empty"><div style="font-size:3rem">🥕</div><p>Aucune recette ne correspond.</p><button class="btn" onclick="document.getElementById('fReset').click()">Réinitialiser les filtres</button></div>`}
    <p style="text-align:center;margin:28px 0 8px"><button class="btn small" id="backup">💾 Sauvegarde &amp; export</button></p>`;
  $('#backup').onclick = openBackup;
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
  <div class="toolbar" style="margin-top:16px"><button class="btn" data-fav="${r.id}">${favs.has(r.id) ? '♥ Favori' : '♡ Favori'}</button><button class="btn" id="edit">✏️ Modifier</button><button class="btn primary" id="cookmode">👩‍🍳 Mode cuisine</button><button class="btn" id="shop">🛒 Courses</button><button class="btn" id="print">🖨 Imprimer</button><label class="btn">📷 Photo<input id="photo" type="file" accept="image/*" hidden></label>${photos[r.id] ? '<button class="btn" id="rmphoto">Retirer la photo</button>' : ''}${serverMode || userRecipes.some(u => u.id === r.id) ? `<button class="btn" id="del">${!serverMode && window.RECIPES.some(b => b.id === r.id) ? '↩ Rétablir l\'original' : '🗑 Supprimer'}</button>` : ''}</div></div></div>
  <div class="cols"><section class="panel"><h2>Ingrédients</h2><div class="servings"><button id="m" aria-label="Moins">−</button><b id="n">${n}</b> personnes <button id="p" aria-label="Plus">+</button></div><ul class="ing" id="ing">${ingHtml()}</ul></section>
  <section class="panel"><h2>Préparation</h2><ol class="steps">${r.steps.map((s, k) => `<li data-k="${k}"><div><span>${esc(s.t)}</span><div class="chiprow">${s.temp ? `<span class="pill temp">🌡 ${s.temp} °C</span>` : ''}${s.timer ? `<span class="pill">${s.kind === 'repos' ? '💤 Repos' : '🔥 Cuisson'} ${fmtMin(s.timer)}</span><button class="tbtn" data-timer="${s.timer}" data-label="${esc(r.title)} — étape ${k + 1}">▶ Lancer le minuteur</button>` : ''}</div></div></li>`).join('')}</ol></section></div></div>`;
  $('#ing').onchange = e => e.target.closest('li').classList.toggle('done', e.target.checked);
  const upd = d => { n = Math.max(1, n + d); $('#n').textContent = n; $('#ing').innerHTML = ingHtml(); };
  $('#m').onclick = () => upd(-1); $('#p').onclick = () => upd(1);
  $('#print').onclick = () => print();
  $('#shop').onclick = () => addToShop(r, n);
  $('#cookmode').onclick = () => openCook(r, n);
  $('#edit').onclick = () => openForm(r);
  document.querySelectorAll('.steps li').forEach(li => li.addEventListener('dblclick', () => li.classList.toggle('done')));
  $('#photo').onchange = e => resizePhoto(e.target.files[0]).then(d => { photos[r.id] = d; store.set('photos', photos); route(); });
  if ($('#rmphoto')) $('#rmphoto').onclick = () => { delete photos[r.id]; store.set('photos', photos); route(); };
  if ($('#del')) $('#del').onclick = async () => { if (confirm($('#del').textContent.includes('original') ? 'Rétablir la version d\'origine ?' : 'Supprimer cette recette ?')) { if (serverMode) { await fetch('/api/recipes/' + r.id, { method: 'DELETE' }); await reloadServer(); } else { userRecipes = userRecipes.filter(u => u.id !== r.id); store.set('user', userRecipes); } buildFilters(); location.hash = '#/'; } };
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
function startTimer(min, label) {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch {} // débloque l'audio (iOS)
  timers.push({ end: Date.now() + min * 60000, label, done: false }); drawTimers();
}
document.addEventListener('click', e => { const b = e.target.closest('[data-timer]'); if (b) startTimer(+b.dataset.timer, b.dataset.label); });
setInterval(() => { let ch = false; timers.forEach(t => { if (!t.done && Date.now() >= t.end) { t.done = true; beep(); ch = true; } }); if (timers.length) drawTimers(); }, 250);

// ---------- nouvelle recette ----------
// Analyse d'une ligne d'ingrédient : « 2 c. à s. de concentré » -> {q:2,u:'c. à s.',n:'de concentré'}
const UNIT = 'c\\. ?à ?[sc]\\.|cuill\\w+ à \\w+|kg|mg|g|cl|ml|dl|l|cm|pincées?|gousses?|boîtes?|sachets?|bouquets?|tranches?|poignées?|feuilles?|brins?|verres?|tasses?';
const ING_RE = new RegExp('^([\\d.,/]+)\\s*(' + UNIT + ')?\\s+(.*)$', 'i');
const parseIng = l => { const x = l.match(ING_RE); if (!x) return { q: 0, u: '', n: l }; const q = x[1].includes('/') ? x[1].split('/').reduce((a, b) => a / b) : parseFloat(x[1].replace(',', '.')); return { q: q || 0, u: x[2] || '', n: x[3] }; };
const ingLine = i => [i.q || '', i.u, i.n].filter(Boolean).join(' ');
const stepLine = s => [s.t, s.temp ? s.temp + '°C' : '', s.timer ? s.timer + ' min' + (s.kind === 'repos' ? ' repos' : '') : ''].filter((x, k) => k === 0 || x).join(' | ');
const parseStep = l => { const [t, a, b] = l.split('|').map(x => x.trim()), s = { t }; [a, b].forEach(x => { if (!x) return; if (/°/.test(x)) s.temp = parseInt(x); else if (/\d/.test(x)) { s.timer = parseInt(x); s.kind = /repos/i.test(x) || /repos|frais/i.test(t) ? 'repos' : 'cuisson'; } }); return s; };

function openForm(edit) {
  const m = $('#modal'); m.hidden = false;
  const types = ['Plat', 'Entrée', 'Dessert', 'Petit-déjeuner', 'Boisson', 'Base']; if (edit && !types.includes(edit.type)) types.push(edit.type);
  const opt = a => a.map(v => `<option>${esc(v)}</option>`).join('');
  m.innerHTML = `<form class="mbox" id="nf"><h2>${edit ? 'Modifier la recette' : 'Nouvelle recette'}</h2>
  ${edit ? '' : `<div class="panel" style="margin-bottom:14px"><b>✨ Importer</b> <small id="imsg" style="color:var(--muted)">depuis une URL ou une photo (nécessite le serveur)</small><div class="toolbar" style="margin-top:8px"><input id="iurl" type="url" placeholder="https://…" style="flex:1;min-width:180px;padding:8px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface2)"><button type="button" class="btn" id="igo">Importer l'URL</button><label class="btn">📸 Photo / scan<input id="iph" type="file" accept="image/*" capture="environment" hidden></label></div></div>`}
  <div class="fld"><label>Titre</label><input name="title" required></div>
  <div class="row2"><div class="fld"><label>Type</label><select name="type">${opt(types)}</select></div>
  <div class="fld"><label>Difficulté</label><select name="difficulty"><option value="1">Facile</option><option value="2">Moyen</option><option value="3">Difficile</option></select></div>
  <div class="fld"><label>Personnes</label><input name="servings" type="number" min="1" value="4"></div></div>
  <div class="row2"><div class="fld"><label>Préparation (min)</label><input name="prep" type="number" min="0" value="15"></div><div class="fld"><label>Cuisson (min)</label><input name="cook" type="number" min="0" value="20"></div><div class="fld"><label>Repos (min)</label><input name="rest" type="number" min="0" value="0"></div></div>
  <div class="fld"><label>Régimes (séparés par des virgules)</label><input name="diets" value="Vegan"></div>
  <div class="fld"><label>Méthodes de cuisson (virgules)</label><input name="method" value="Four"></div>
  <div class="fld"><label>Tags (virgules)</label><input name="tags" placeholder="rapide, brunch"></div>
  <div class="fld"><label>Ingrédients — un par ligne : « 200 g farine »</label><textarea name="ing" rows="6" placeholder="200 g farine&#10;2 oignons"></textarea></div>
  <div class="fld"><label>Étapes — une par ligne. Optionnel : « texte | 180°C | 25 min » (ajouter « repos » après les minutes pour un temps de repos)</label><textarea name="steps" rows="6" placeholder="Préchauffer et mélanger.&#10;Cuire au four | 180°C | 25 min&#10;Laisser tiédir | 10 min repos"></textarea></div>
  <div class="fld"><label>${edit ? 'Nouvelle photo (vide = garder l\'actuelle)' : 'Photo'}</label><input name="photo" type="file" accept="image/*"></div>
  <div class="toolbar"><button class="btn primary">Enregistrer</button><button type="button" class="btn" id="cancel">Annuler</button></div></form>`;
  $('#cancel').onclick = () => { m.hidden = true; };
  const fill = r => { const f = $('#nf').elements, set = (k, v) => { f[k].value = v; };
    set('title', r.title); set('type', r.type); set('difficulty', r.difficulty); set('servings', r.servings); set('prep', r.prep); set('cook', r.cook); set('rest', r.rest);
    set('diets', (r.diets || []).join(', ')); set('method', (r.method || []).join(', ')); set('tags', (r.tags || []).join(', '));
    set('ing', r.ingredients.map(ingLine).join('\n')); set('steps', r.steps.map(stepLine).join('\n')); };
  if (edit) fill(edit);
  else {
    const imp = async (path, payload, label) => { const msg = $('#imsg'); msg.textContent = '⏳ ' + label + '…';
      try { const r = await fetch('/api/import/' + path, { method: 'POST', body: JSON.stringify(payload) }), j = await r.json(); if (!r.ok) throw new Error(j.error); fill(j.recipe); msg.textContent = '✅ Importé (' + j.via + ') — relisez avant d\'enregistrer !'; }
      catch (e) { msg.textContent = '⚠️ ' + e.message; } };
    $('#igo').onclick = () => $('#iurl').value && imp('url', { url: $('#iurl').value }, 'Lecture de la page');
    $('#iph').onchange = async e => { const d = await resizePhoto(e.target.files[0], 1600); imp('photo', { data: d.split(',')[1], mediaType: 'image/jpeg' }, 'Lecture de la photo'); };
  }
  $('#nf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target), list = k => f.get(k).split(',').map(x => x.trim()).filter(Boolean), lines = k => f.get(k).split('\n').map(l => l.trim()).filter(Boolean);
    const { total, photo: _p, ...base } = edit || {}, file = f.get('photo');
    const r = { ...base, id: edit ? edit.id : 'u' + Date.now(), title: f.get('title'), emoji: base.emoji || '🍽️', hue: base.hue ?? Math.floor(Math.random() * 360), type: f.get('type'), diets: list('diets'), difficulty: +f.get('difficulty'), prep: +f.get('prep'), cook: +f.get('cook'), rest: +f.get('rest'), method: list('method'), servings: +f.get('servings') || 1, tags: list('tags'), ingredients: lines('ing').map(parseIng), steps: lines('steps').map(parseStep) };
    const newPhoto = file && file.size ? await resizePhoto(file) : null;
    try {
      if (serverMode) {
        const send = (url, method, b) => fetch(url, { method, body: JSON.stringify(b) }).then(x => { if (!x.ok) throw new Error('Erreur serveur'); return x.json(); });
        if (edit) await send('/api/recipes/' + r.id, 'PUT', { recipe: r }); else r.id = (await send('/api/recipes', 'POST', { recipe: r, kind: 'manual' })).id;
        if (newPhoto) { photos[r.id] = newPhoto; store.set('photos', photos); }
        await reloadServer();
      } else {
        const orig = userRecipes.find(u => u.id === r.id); if (orig && orig.photo) r.photo = orig.photo; if (newPhoto) r.photo = newPhoto;
        orig ? userRecipes[userRecipes.indexOf(orig)] = r : userRecipes.unshift(r); store.set('user', userRecipes);
      }
    } catch (err) { return alert('Enregistrement impossible (hors-ligne ?) : ' + err.message); }
    m.hidden = true; buildFilters(); const h = '#/r/' + r.id; location.hash === h ? route() : (location.hash = h);
  };
}
$('#btnNew').onclick = () => openForm();

// ---------- sauvegarde / export ----------
function openBackup() {
  const m = $('#modal'); m.hidden = false;
  m.innerHTML = `<div class="mbox"><h2>💾 Sauvegarde</h2><p style="color:var(--muted)">Un fichier JSON avec vos recettes, favoris, photos, liste de courses et planning. ${serverMode ? 'Le serveur garde aussi une copie quotidienne de la base (7 jours).' : ''}</p>
  <div class="toolbar"><button class="btn primary" id="bx">⬇️ Exporter</button><label class="btn">⬆️ Restaurer / fusionner<input id="bi" type="file" accept="application/json,.json" hidden></label><button class="btn" id="bc">Fermer</button></div>
  <p style="color:var(--muted);font-size:.85rem">La restauration ajoute les recettes absentes et fusionne favoris, photos et planning ; elle ne supprime rien.</p></div>`;
  $('#bc').onclick = () => { m.hidden = true; };
  $('#bx').onclick = () => {
    const d = { app: 'mes-recettes', version: 1, exported: new Date().toISOString(), recipes: serverMode ? serverRecipes : userRecipes, favs: [...favs], photos, shop: shopList(), plan: store.get('plan', {}) };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' })); a.download = 'recettes-' + d.exported.slice(0, 10) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('#bi').onchange = async e => {
    let d; try { d = JSON.parse(await e.target.files[0].text()); } catch { return toast('Fichier illisible'); }
    if (d.app !== 'mes-recettes' || !Array.isArray(d.recipes)) return toast('Ce fichier n\'est pas une sauvegarde');
    const have = new Set(all().map(r => r.id)); let added = 0;
    try {
      for (const r of d.recipes) {
        if (!r || !r.id || have.has(r.id)) continue;
        if (serverMode) { const x = await fetch('/api/recipes', { method: 'POST', body: JSON.stringify({ id: r.id, recipe: r, kind: 'manual' }) }); if (!x.ok) continue; } else userRecipes.push(r);
        added++;
      }
    } catch { return toast('Restauration interrompue (hors-ligne ?)'); }
    if (!serverMode) store.set('user', userRecipes); else await reloadServer();
    favs = new Set([...favs, ...(d.favs || [])]); store.set('favs', [...favs]);
    photos = { ...photos, ...(d.photos || {}) }; store.set('photos', photos);
    store.set('plan', { ...store.get('plan', {}), ...(d.plan || {}) });
    if (!shopList().length && Array.isArray(d.shop)) store.set('shop', d.shop);
    m.hidden = true; buildFilters(); updateBadge(); route(); toast(`✅ ${added} recette${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''}`);
  };
}
addEventListener('keydown', e => { if (e.key === 'Escape') { $('#modal').hidden = true; drawer(false); } if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); } });

// ---------- mode cuisine ----------
let wake = null;
async function keepAwake(on) { try { if (on) wake = await navigator.wakeLock.request('screen'); else { await wake?.release(); wake = null; } } catch {} }
function openCook(r, n) {
  let k = 0, ing = false; const last = r.steps.length - 1, el = document.createElement('div'); el.className = 'cook';
  document.body.append(el); document.body.classList.add('cooking'); keepAwake(true);
  const qty = i => i.q ? `<b>${fmtQty(i.q * n / r.servings)}</b> ` : '';
  const stepIngs = s => r.ingredients.filter(i => norm(i.n).split(/[^a-z]+/).some(w => w.length >= 5 && norm(s.t).includes(w)));
  const close = (done) => { document.removeEventListener('keydown', keys); el.remove(); document.body.classList.remove('cooking'); keepAwake(false); if (done) toast('Bon appétit ! 🍽️'); };
  const draw = () => {
    const s = r.steps[k], si = stepIngs(s);
    el.innerHTML = `<div class="cooktop"><button class="btn" data-c="x">✕ Quitter</button><b class="ct">${esc(r.title)}</b><button class="btn ${ing ? 'primary' : ''}" data-c="ing">🧺 Ingrédients</button></div>
    <div class="cookbar"><i style="width:${(k + 1) / r.steps.length * 100}%"></i></div>
    <div class="cookbody">${ing ? `<h2>Ingrédients · ${n} pers.</h2><ul class="ing">${r.ingredients.map(i => `<li>${qty(i)}${esc(i.u)} ${esc(i.n)}</li>`).join('')}</ul>` :
      `<div class="cookn">Étape ${k + 1} sur ${r.steps.length}</div><p class="cooktext">${esc(s.t)}</p>
      <div class="chiprow">${s.temp ? `<span class="pill temp big">🌡 ${s.temp} °C</span>` : ''}${s.timer ? `<span class="pill big">${s.kind === 'repos' ? '💤' : '🔥'} ${fmtMin(s.timer)}</span>` : ''}</div>
      ${s.timer ? `<button class="tbtn bigbtn" data-timer="${s.timer}" data-label="${esc(r.title)} — étape ${k + 1}">▶ Lancer le minuteur (${fmtMin(s.timer)})</button>` : ''}
      ${si.length ? `<div class="cookings"><small>Pour cette étape</small>${si.map(i => `<span class="pill">${qty(i)}${esc(i.u)} ${esc(i.n)}</span>`).join('')}</div>` : ''}`}</div>
    <div class="cooknav"><button class="btn" data-c="prev" ${k === 0 ? 'disabled' : ''}>← Précédent</button><button class="btn primary" data-c="next">${k === last ? 'Terminer ✓' : 'Suivant →'}</button></div>`;
  };
  const go = d => { ing = false; if (k + d > last) return close(true); k = Math.max(0, k + d); draw(); };
  const keys = e => { if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', keys);
  el.addEventListener('click', e => { const c = e.target.closest('[data-c]')?.dataset.c; if (!c) return; if (c === 'x') close(); else if (c === 'ing') { ing = !ing; draw(); } else go(c === 'next' ? 1 : -1); });
  let x0; el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 70) go(dx < 0 ? 1 : -1); });
  draw();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && document.body.classList.contains('cooking')) keepAwake(true); });

// ---------- liste de courses ----------
const AISLES = [['🥬 Fruits & légumes', /carotte|oignon|\bail\b|poireau|tomate|poivron|banane|citron|basilic|épinard|potimarron|pomme de terre|gingembre|persil|courgette|champignon|salade|avocat|ciboulette/i],
  ['🧊 Frais', /tofu|seitan|tempeh|pâte brisée|yaourt|margarine/i],
  ['🥫 Épicerie', /./]];
const aisle = n => AISLES.find(([, re]) => re.test(n))[0];
const shopList = () => store.get('shop', []);
function updateBadge() { const n = shopList().filter(x => !x.done).length, b = $('#shopc'); b.hidden = !n; b.textContent = n; }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 2200); }
function addToShop(r, n) {
  const list = shopList(), k = n / r.servings;
  r.ingredients.forEach(i => {
    const key = norm(i.n) + '|' + i.u, ex = list.find(x => x.key === key && !x.done), q = (i.q || 0) * k;
    if (ex) { ex.q += q; if (!ex.from.includes(r.title)) ex.from.push(r.title); } else list.push({ key, name: i.n, u: i.u, q, done: false, from: [r.title] });
  });
  store.set('shop', list); updateBadge(); toast('🛒 « ' + r.title + ' » ajoutée à la liste');
}
function renderShop() {
  const list = shopList(), groups = {};
  list.forEach((x, i) => (groups[aisle(x.name)] = groups[aisle(x.name)] || []).push([x, i]));
  $('#main').innerHTML = `<div class="detail"><h1>🛒 Liste de courses</h1>
  <form class="toolbar" id="sadd" style="margin:12px 0"><input id="snew" placeholder="Ajouter un article…" style="flex:1;padding:9px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface2)"><button class="btn primary">Ajouter</button></form>
  ${list.length ? Object.keys(groups).sort().map(g => `<section class="panel" style="margin-bottom:14px"><h2>${g}</h2><ul class="ing">${groups[g].map(([x, i]) => `<li class="${x.done ? 'done' : ''}"><input type="checkbox" data-si="${i}" ${x.done ? 'checked' : ''}><span>${x.q ? `<b>${fmtQty(x.q)}</b> ` : ''}${esc(x.u)} ${esc(x.name)}<br><small style="color:var(--muted)">${x.from.map(esc).join(', ')}</small></span><button class="btn small" data-sd="${i}" style="margin-left:auto" aria-label="Retirer">✕</button></li>`).join('')}</ul></section>`).join('') : '<div class="empty"><div style="font-size:3rem">🛒</div><p>Votre liste est vide.<br>Ajoutez une recette depuis sa fiche, ou le planning de la semaine.</p></div>'}
  <div class="toolbar"><button class="btn" id="sclean">Retirer les cochés</button><button class="btn" id="sclear">Tout vider</button><button class="btn" id="sshare">📋 Copier / partager</button></div></div>`;
  const save = l => { store.set('shop', l); updateBadge(); renderShop(); };
  $('#sadd').onsubmit = e => { e.preventDefault(); const v = $('#snew').value.trim(); if (v) save([...list, { key: 'm|' + norm(v), name: v, u: '', q: 0, done: false, from: ['Ajout manuel'] }]); };
  $('#main').querySelectorAll('[data-si]').forEach(c => c.onchange = () => { list[c.dataset.si].done = c.checked; save(list); });
  $('#main').querySelectorAll('[data-sd]').forEach(c => c.onclick = () => { list.splice(c.dataset.sd, 1); save(list); });
  $('#sclean').onclick = () => save(list.filter(x => !x.done));
  $('#sclear').onclick = () => confirm('Vider la liste ?') && save([]);
  $('#sshare').onclick = async () => { const t = list.filter(x => !x.done).map(x => `- ${[x.q ? fmtQty(x.q) : '', x.u, x.name].filter(Boolean).join(' ')}`).join('\n'); try { if (navigator.share) await navigator.share({ title: 'Courses', text: t }); else await copyText(t); } catch {} };
}

// Copie sans API réservée au HTTPS (l'app peut tourner en http:// sur le réseau local)
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch { const a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = 0; document.body.append(a); a.select(); document.execCommand('copy'); a.remove(); }
  toast('Copié !');
}

// ---------- planning de la semaine ----------
let planOff = 0;
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'], SLOTS = [['midi', '☀️ Midi'], ['soir', '🌙 Soir']];
const dayKey = d => d.toISOString().slice(0, 10);
function weekDays() { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7 + planOff * 7); return DAYS.map((_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return x; }); }
function renderPlan() {
  const plan = store.get('plan', {}), days = weekDays(), fmt = d => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  $('#main').innerHTML = `<div class="detail"><h1>📅 Planning</h1>
  <div class="toolbar" style="margin:12px 0"><button class="btn" id="pprev">←</button><b style="align-self:center">${fmt(days[0])} – ${fmt(days[6])}</b><button class="btn" id="pnext">→</button><button class="btn" id="ptoday">Aujourd'hui</button><span style="flex:1"></span><button class="btn primary" id="pshop">🛒 Courses de la semaine</button></div>
  <div class="week">${days.map((d, i) => `<section class="panel"><h2>${DAYS[i]} <small style="color:var(--muted)">${fmt(d)}</small></h2>${SLOTS.map(([s, l]) => { const k = dayKey(d) + '_' + s, ids = [].concat(plan[k] || []).filter(byId); return `<div class="slot"><small>${l}</small><div class="slotl">${ids.map(id => { const r = byId(id); return `<div class="slotd"><a href="#/r/${r.id}" class="slotr">${r.emoji} ${esc(r.title)}</a><button class="btn small" data-pc="${k}|${id}" aria-label="Retirer">✕</button></div>`; }).join('')}<button class="btn small" data-pa="${k}">＋ ${ids.length ? 'Ajouter un plat' : 'Choisir'}</button></div></div>`; }).join('')}</section>`).join('')}</div></div>`;
  $('#pprev').onclick = () => { planOff--; renderPlan(); }; $('#pnext').onclick = () => { planOff++; renderPlan(); }; $('#ptoday').onclick = () => { planOff = 0; renderPlan(); };
  $('#pshop').onclick = () => { const rs = days.flatMap(d => SLOTS.flatMap(([s]) => [].concat(plan[dayKey(d) + '_' + s] || []).map(byId))).filter(Boolean); if (!rs.length) return toast('Aucun repas planifié cette semaine'); rs.forEach(r => addToShop(r, r.servings)); };
  $('#main').querySelectorAll('[data-pc]').forEach(b => b.onclick = () => { const [k, id] = b.dataset.pc.split('|'), left = [].concat(plan[k] || []).filter(x => x !== id); left.length ? plan[k] = left : delete plan[k]; store.set('plan', plan); renderPlan(); });
  $('#main').querySelectorAll('[data-pa]').forEach(b => b.onclick = () => pickRecipe(b.dataset.pa));
}
function pickRecipe(slotKey) {
  const m = $('#modal'); m.hidden = false;
  const draw = q => { const t = norm(q).split(/\s+/).filter(Boolean); return all().filter(r => t.every(w => norm(r.title + ' ' + r.type + ' ' + r.diets.join(' ')).includes(w))).map(r => `<button class="btn" data-pick="${r.id}" style="display:block;width:100%;text-align:left;margin-bottom:6px">${r.emoji} ${esc(r.title)} <small style="color:var(--muted)">· ${fmtMin(r.total)}</small></button>`).join('') || '<p class="empty">Aucun résultat</p>'; };
  m.innerHTML = `<div class="mbox"><h2>Ajouter un plat au menu</h2><div class="fld"><input id="pq" placeholder="Rechercher…" autofocus></div><div id="pl">${draw('')}</div><button class="btn" id="pcancel">Annuler</button></div>`;
  $('#pq').oninput = e => { $('#pl').innerHTML = draw(e.target.value); };
  $('#pcancel').onclick = () => { m.hidden = true; };
  $('#pl').onclick = e => { const b = e.target.closest('[data-pick]'); if (!b) return; const plan = store.get('plan', {}), cur = [].concat(plan[slotKey] || []); plan[slotKey] = cur.includes(b.dataset.pick) ? cur : [...cur, b.dataset.pick]; store.set('plan', plan); m.hidden = true; renderPlan(); };
}

// ---------- routeur ----------
function route() { const h = location.hash, m = h.match(/^#\/r\/(.+)$/); drawer(false); document.body.dataset.page = m ? 'detail' : h === '#/courses' ? 'shop' : h === '#/planning' ? 'plan' : 'list'; m ? renderDetail(m[1]) : h === '#/courses' ? renderShop() : h === '#/planning' ? renderPlan() : renderList(); }
addEventListener('hashchange', route);

function syncDirty() { // renvoie au serveur ce qui a été modifié hors-ligne
  for (const k of SK) { try { const lv = localStorage.getItem('rec.' + k); if (localStorage.getItem('rec.dirty.' + k) && lv) store.set(k, cache[k] = JSON.parse(lv)); } catch {} }
}
addEventListener('online', () => serverMode && syncDirty());
async function reloadServer() { serverRecipes = await (await fetch('/api/recipes')).json(); }
(async () => {
  try { // le serveur est-il là ? sinon mode local (maquette statique)
    const r = await fetch('/api/recipes', { signal: AbortSignal.timeout(2000) });
    if (r.ok && /json/.test(r.headers.get('content-type') || '')) { serverRecipes = await r.json(); cache = await (await fetch('/api/kv')).json(); serverMode = true; syncDirty(); }
  } catch {}
  if (!serverMode) userRecipes = store.get('user', []);
  photos = store.get('photos', {}); favs = new Set(store.get('favs', []));
  buildFilters(); setView(view); updateBadge(); route();
  if (serverMode && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
})();
