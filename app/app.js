(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const SK = new Set(['favs', 'shop', 'plan', 'cooklog', 'pantry']); // clés stockées côté serveur quand il est disponible
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
const { norm, fmtQty, keyName, parseIng, ingLine, parseStep, stepLine, shopPart, itemQty, expandIngredients, fuzzyHas, words, findSubst, nutrition, SEASONS, seasonOf, inSeason, panRatio, suggestWeek, voiceCommand } = window.Lib;
const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`;
const DIFF = ['', 'Facile', 'Moyen', 'Difficile'];

let userRecipes = [], photos = {}, favs = new Set();
const all = () => [...userRecipes, ...(serverRecipes || window.RECIPES).filter(b => !userRecipes.some(u => u.id === b.id))].map(r => ({ ...r, total: r.prep + r.cook + r.rest, photo: photos[r.id] || r.photo }));
const byId = id => all().find(r => r.id === id);

// ---------- thèmes & vue ----------
function setTheme(t) { document.documentElement.dataset.theme = t; store.set('theme', t); document.querySelectorAll('[data-th]').forEach(b => b.classList.toggle('on', b.dataset.th === t)); }
setTheme(store.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
document.querySelectorAll('[data-th]').forEach(b => b.onclick = () => setTheme(b.dataset.th));
$('#themeCycle').onclick = () => { const o = ['light', 'dark', 'gothic']; setTheme(o[(o.indexOf(document.documentElement.dataset.theme) + 1) % 3]); };
addEventListener('message', e => { if (e.data && e.data.theme) setTheme(e.data.theme); });
let view = store.get('view', 'grid');
function setView(v) { view = v; store.set('view', v); $('#vGrid').classList.toggle('on', v === 'grid'); $('#vList').classList.toggle('on', v === 'list'); if (document.body.dataset.page === 'list') renderList(); }
$('#vGrid').onclick = () => setView('grid'); $('#vList').onclick = () => setView('list');

// ---------- filtres ----------
let LG = {}; // journal chargé à chaque affichage de la liste
const F = { q: '', type: new Set(), diet: new Set(), diff: new Set(), method: new Set(), season: new Set(), coll: new Set(), protein: false, max: 360, fav: false, sort: 'rel' };
const uniq = (key) => [...new Set(all().flatMap(r => [].concat(r[key] || [])))].sort();
const nutriCache = new Map();
const nutriOf = r => { const sig = JSON.stringify(r.ingredients).length + r.title; let c = nutriCache.get(r.id); if (!c || c.sig !== sig) { c = { sig, v: nutrition(r, byId) }; nutriCache.set(r.id, c); } return c.v; };
function buildFilters() {
  const grp = (title, key, set, vals) => `<div class="fgroup"><h3>${title}</h3><div class="chips">${vals.map(v => `<button class="chip ${set.has(String(v.v)) ? 'on' : ''}" data-k="${key}" data-v="${esc(v.v)}">${esc(v.l)}</button>`).join('')}</div></div>`;
  $('#fbody').innerHTML =
    grp('Type de plat', 'type', F.type, uniq('type').map(v => ({ v, l: v }))) +
    grp('Régime', 'diet', F.diet, uniq('diets').map(v => ({ v, l: v }))) +
    grp('Difficulté', 'diff', F.diff, [1, 2, 3].map(v => ({ v, l: DIFF[v] }))) +
    grp('Méthode de cuisson', 'method', F.method, uniq('method').map(v => ({ v, l: v }))) +
    grp('Saison', 'season', F.season, SEASONS.map(v => ({ v, l: v + (v === seasonOf(new Date()) ? ' · en cours' : '') }))) +
    (uniq('collections').length ? grp('Collection', 'coll', F.coll, uniq('collections').map(v => ({ v, l: v }))) : '') +
    `<div class="fgroup"><h3>Temps total max : <b id="maxl">${F.max >= 360 ? 'illimité' : fmtMin(F.max)}</b></h3><input type="range" id="max" min="10" max="360" step="5" value="${F.max}"></div>` +
    `<div class="fgroup"><div class="chips"><button class="chip ${F.fav ? 'on' : ''}" id="favOnly">♥ Favoris uniquement</button><button class="chip ${F.protein ? 'on' : ''}" id="protOnly" title="Estimation à partir des ingrédients">💪 Riche en protéines</button></div></div>`;
}
$('#fbody').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  if (c.id === 'favOnly') F.fav = !F.fav;
  else if (c.id === 'protOnly') F.protein = !F.protein;
  else { const s = F[c.dataset.k], v = c.dataset.v; s.has(v) ? s.delete(v) : s.add(v); }
  buildFilters(); renderList();
});
$('#fbody').addEventListener('input', e => { if (e.target.id === 'max') { F.max = +e.target.value; $('#maxl').textContent = F.max >= 360 ? 'illimité' : fmtMin(F.max); renderList(); } });
$('#fReset').onclick = () => { Object.assign(F, { q: '', max: 360, fav: false, protein: false }); ['type', 'diet', 'diff', 'method', 'season', 'coll'].forEach(k => F[k].clear()); $('#q').value = ''; buildFilters(); renderList(); };
const drawer = o => { $('#filters').classList.toggle('open', o); $('#scrim').hidden = !o; };
$('#btnFilters').onclick = () => drawer(true); $('#fClose').onclick = () => drawer(false); $('#scrim').onclick = () => drawer(false);
let qt; $('#q').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { F.q = e.target.value; if (location.hash !== '#/') location.hash = '#/'; else renderList(); }, 120); };

const wordCache = new Map();
function recipeWords(r) { const sig = r.title + '|' + r.ingredients.length + '|' + r.tags.length; let c = wordCache.get(r.id); if (!c || c.sig !== sig) { c = { sig, w: words([r.title, r.type, ...r.tags, ...r.ingredients.map(i => i.n)].join(' ')) }; wordCache.set(r.id, c); } return c.w; }
function score(r, terms) {
  if (!terms.length) return 1;
  const title = norm(r.title), ing = norm(r.ingredients.map(i => i.n).join(' ')), rest = norm([r.type, ...r.diets, ...r.method, ...r.tags, DIFF[r.difficulty]].join(' ')), steps = norm(r.steps.map(s => s.t).join(' '));
  let sc = 0;
  for (const t of terms) {
    let s = (title.includes(t) ? 8 : 0) + (rest.includes(t) ? 4 : 0) + (ing.includes(t) ? 3 : 0) + (steps.includes(t) ? 1 : 0);
    if (!s && fuzzyHas(recipeWords(r), t)) s = 2; // faute de frappe tolérée
    if (!s) return 0; sc += s; // tous les mots doivent correspondre (ET)
  }
  return sc;
}
function filtered() {
  const terms = norm(F.q).split(/\s+/).filter(Boolean);
  let out = all().map(r => ({ r, s: score(r, terms) })).filter(({ r, s }) => s &&
    (!F.type.size || F.type.has(r.type)) && (![...F.diet].length || [...F.diet].every(d => r.diets.includes(d))) &&
    (!F.diff.size || F.diff.has(String(r.difficulty))) && (!F.method.size || r.method.some(m => F.method.has(m))) &&
    (!F.season.size || [...F.season].some(x => inSeason(r, x))) && (!F.coll.size || (r.collections || []).some(c => F.coll.has(c))) &&
    (!F.protein || (n => n.coverage >= .6 && n.protein >= 15)(nutriOf(r))) &&
    r.total <= F.max && (!F.fav || favs.has(r.id)));
  const sorters = { rel: (a, b) => b.s - a.s, time: (a, b) => a.r.total - b.r.total, diff: (a, b) => a.r.difficulty - b.r.difficulty || a.r.total - b.r.total, az: (a, b) => a.r.title.localeCompare(b.r.title, 'fr'),
    stale: (a, b) => (stat(a.r.id, LG)?.last || '').localeCompare(stat(b.r.id, LG)?.last || '') || a.r.title.localeCompare(b.r.title, 'fr'),
    rated: (a, b) => (stat(b.r.id, LG)?.avg || 0) - (stat(a.r.id, LG)?.avg || 0) || b.s - a.s };
  return out.sort(sorters[F.sort]).map(x => x.r);
}
const nActive = () => F.type.size + F.diet.size + F.diff.size + F.method.size + F.season.size + F.coll.size + (F.max < 360) + F.fav + F.protein;

// ---------- rendu ----------
const thumbStyle = r => r.photo ? `background-image:url('${r.photo}')` : `background:linear-gradient(135deg,hsl(${r.hue} 70% 62%),hsl(${(r.hue + 40) % 360} 60% 38%))`;
const thumb = r => `<div class="thumb" style="${thumbStyle(r)}" role="img" aria-label="${esc(r.title)}">${r.photo ? '' : r.emoji}</div>`;
function card(r) {
  return `<a class="card" href="#/r/${r.id}">${thumb(r)}<button class="fav ${favs.has(r.id) ? 'on' : ''}" data-fav="${r.id}" aria-label="Favori">${favs.has(r.id) ? '♥' : '♡'}</button>
  <div class="body"><h3>${esc(r.title)}</h3><div class="meta"><span>⏱ ${fmtMin(r.total)}</span><span>👨‍🍳 ${DIFF[r.difficulty]}</span><span>${esc(r.type)}</span>${(s => s ? `<span>★ ${s.avg ? fmtQty(Math.round(s.avg * 10) / 10) : '–'} · ${s.n}×</span>` : '')(stat(r.id, LG))}</div>
  <div class="tags">${r.diets.map(d => `<span class="tag">${esc(d)}</span>`).join('')}</div></div></a>`;
}
function renderList() {
  LG = logs();
  const rs = filtered(), n = nActive();
  const fc = $('#fcount'); fc.hidden = !n; fc.textContent = n;
  const act = [...F.type, ...F.diet, ...[...F.diff].map(d => DIFF[d]), ...F.method, ...F.season, ...F.coll, ...(F.protein ? ['Riche en protéines'] : [])].map(v => `<span class="tag">${esc(v)}</span>`).join('');
  $('#rcount').textContent = `${rs.length} recette${rs.length > 1 ? 's' : ''}`; $('#sort').value = F.sort; $('#fApply').textContent = `Voir ${rs.length} recette${rs.length > 1 ? 's' : ''}`;
  $('#main').innerHTML = `${act ? `<div class="active">${act}</div>` : ''}
    ${rs.length ? `<div class="${view === 'grid' ? 'grid' : 'list'}">${rs.map(card).join('')}</div>` : `<div class="empty"><div style="font-size:3rem">🥕</div><p>Aucune recette ne correspond.</p><button class="btn" onclick="document.getElementById('fReset').click()">Réinitialiser les filtres</button></div>`}
    <p style="text-align:center;margin:28px 0 8px"><button class="btn small" id="backup">💾 Sauvegarde &amp; export</button></p>`;
  $('#backup').onclick = openBackup;
}
$('#sort').onchange = e => { F.sort = e.target.value; renderList(); };
$('#fApply').onclick = () => drawer(false);
$('#main').addEventListener('click', e => { const b = e.target.closest('[data-fav]'); if (b) { e.preventDefault(); toggleFav(b.dataset.fav); } });
function toggleFav(id) { favs.has(id) ? favs.delete(id) : favs.add(id); store.set('favs', [...favs]); route(); }

function renderDetail(id) {
  const r = byId(id); if (!r) { location.hash = '#/'; return; }
  let n = r.servings;
  const ingHtml = () => r.ingredients.map((i, k) => `<li><label><input type="checkbox" id="i${k}"><span>${i.q ? `<b>${fmtQty(i.q * n / r.servings)}</b> ` : ''}${esc(i.u)} ${i.ref ? `<a href="#/r/${esc(i.ref)}" title="Voir la recette de base">${esc(i.n)} ↗</a>` : esc(i.n)}</span></label></li>`).join('');
  $('#main').innerHTML = `<div class="detail"><a class="back" href="#/">← Toutes les recettes</a>
  <div class="hero">${thumb(r)}<div class="info"><div class="chips">${r.diets.map(d => `<span class="tag">${esc(d)}</span>`).join('')}<span class="tag">${esc(r.type)}</span></div>
  <h1>${esc(r.title)}</h1>
  <div class="stats"><div class="stat"><b>${fmtMin(r.prep)}</b><span>Préparation</span></div><div class="stat"><b>${fmtMin(r.cook)}</b><span>Cuisson</span></div>${r.rest ? `<div class="stat"><b>${fmtMin(r.rest)}</b><span>Repos</span></div>` : ''}<div class="stat"><b>${fmtMin(r.total)}</b><span>Total</span></div><div class="stat"><b>${DIFF[r.difficulty]}</b><span>Difficulté</span></div></div>
  <div class="meta">🔥 ${r.method.map(esc).join(' · ')}</div>
  <div class="tags">${r.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
  ${(r.seasons || []).length + (r.collections || []).length ? `<div class="tags">${(r.seasons || []).map(x => `<span class="tag">🌿 ${esc(x)}</span>`).join('')}${(r.collections || []).map(x => `<span class="tag">📁 ${esc(x)}</span>`).join('')}</div>` : ''}
  ${r.source && /^https?:\/\//.test(r.source) ? `<div class="meta" style="margin-top:6px">🔗 <a href="${esc(r.source)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(r.source))}</a></div>` : ''}
  <div class="toolbar detail-actions"><button class="btn primary" id="cookmode">👩‍🍳 <span>Cuisiner</span></button><button class="btn" id="shop">🛒 <span>Courses</span></button><button class="btn" data-fav="${r.id}">${favs.has(r.id) ? '♥' : '♡'} <span class="hide-s">Favori</span></button><details class="more"><summary class="btn" aria-label="Plus d'actions">⋯<span class="hide-s"> Plus</span></summary><div class="menu"><button class="btn" id="edit">✏️ Modifier</button><button class="btn" id="print">🖨 Imprimer</button><label class="btn">📷 Photo<input id="photo" type="file" accept="image/*" hidden></label>${photos[r.id] || (serverMode && r.photo) ? '<button class="btn" id="rmphoto">Retirer la photo</button>' : ''}${serverMode || userRecipes.some(u => u.id === r.id) ? `<button class="btn" id="del">${!serverMode && window.RECIPES.some(b => b.id === r.id) ? '↩ Rétablir l\'original' : '🗑 Supprimer'}</button>` : ''}</div></details></div></div></div>
  <div class="cols"><section class="panel"><h2>Ingrédients</h2><div class="servings"><button id="m" aria-label="Moins">−</button><b id="n">${fmtQty(n)}</b> personnes <button id="p" aria-label="Plus">+</button></div><details class="pan" id="pan"><summary>📐 Adapter à mon moule</summary><div id="panbody"></div></details><ul class="ing" id="ing">${ingHtml()}</ul><div id="subs"></div><div id="nutri"></div></section>
  <section class="panel"><h2>Préparation</h2><ol class="steps">${r.steps.map((s, k) => `<li data-k="${k}"><div><span>${esc(s.t)}</span><div class="chiprow">${s.temp ? `<span class="pill temp">🌡 ${s.temp} °C</span>` : ''}${s.timer ? `<span class="pill">${s.kind === 'repos' ? '💤 Repos' : '🔥 Cuisson'} ${fmtMin(s.timer)}</span><button class="tbtn" data-timer="${s.timer}" data-label="${esc(r.title)} — étape ${k + 1}">▶ Lancer le minuteur</button>` : ''}</div></div></li>`).join('')}</ol></section></div><section class="panel" id="journal" style="margin-top:24px"></section></div>`;
  renderJournal(r);
  const setScale = ratio => { n = Math.round(r.servings * ratio * 100) / 100; $('#n').textContent = ratio === 1 ? fmtQty(n) : '≈ ' + fmtQty(Math.round(n * 10) / 10); $('#ing').innerHTML = ingHtml(); };
  $('#subs').innerHTML = subsHtml(r); $('#nutri').innerHTML = nutriHtml(r); initPan(r, setScale);
  $('#ing').onchange = e => e.target.closest('li').classList.toggle('done', e.target.checked);
  const upd = d => { n = Math.max(1, Math.round(n) + d); $('#n').textContent = fmtQty(n); $('#ing').innerHTML = ingHtml(); };
  $('#m').onclick = () => upd(-1); $('#p').onclick = () => upd(1);
  $('#print').onclick = () => print();
  $('#shop').onclick = () => addToShop(r, n);
  $('#cookmode').onclick = () => openCook(r, n);
  $('#edit').onclick = () => openForm(r);
  document.querySelectorAll('.steps li').forEach(li => li.addEventListener('dblclick', () => li.classList.toggle('done')));
  $('#photo').onchange = async e => { try { await setPhoto(r.id, await resizePhoto(e.target.files[0], serverMode ? 1200 : 900)); route(); } catch (err) { alert('Photo non enregistrée : ' + err.message); } };
  if ($('#rmphoto')) $('#rmphoto').onclick = async () => { await clearPhoto(r.id); route(); };
  if ($('#del')) $('#del').onclick = async () => { if (confirm($('#del').textContent.includes('original') ? 'Rétablir la version d\'origine ?' : 'Supprimer cette recette ?')) { if (serverMode) { await fetch('/api/recipes/' + r.id, { method: 'DELETE' }); await reloadServer(); } else { userRecipes = userRecipes.filter(u => u.id !== r.id); store.set('user', userRecipes); } buildFilters(); location.hash = '#/'; } };
  scrollTo(0, 0);
}
// Substitutions vegan (suggestions) : seulement pour une recette qui n'est pas déjà étiquetée Vegan
function subsHtml(r) {
  if ((r.diets || []).includes('Vegan')) return '';
  const hits = r.ingredients.map(i => ({ i, s: findSubst(i.n) })).filter(x => x.s);
  if (!hits.length) return '';
  return `<details class="subs" open><summary>🌱 Rendre cette recette vegan <small>(${hits.length} ingrédient${hits.length > 1 ? 's' : ''} à remplacer)</small></summary>${hits.map(({ i, s }) => `<div class="subitem"><b>${esc(cleanName(i.n))}</b> <small>(${esc(s.name)})</small><ul>${s.alt.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>`).join('')}<p class="foot-note">Suggestions générales : à ajuster selon la recette.</p></details>`;
}
// Valeurs nutritionnelles : estimation par portion à partir d'une table interne
function nutriHtml(r) {
  const x = nutriOf(r);
  if (x.total < 2) return '';
  if (x.coverage < .6) return `<p class="foot-note">Valeurs nutritionnelles : données insuffisantes (${x.covered}/${x.total} ingrédients reconnus).</p>`;
  const cell = (v, l) => `<div class="stat"><b>${fmtQty(v)}</b><span>${l}</span></div>`;
  return `<details class="nutri"><summary>🥗 Valeurs nutritionnelles <small>(estimation, par portion${x.protein >= 15 ? ' · 💪 riche en protéines' : ''})</small></summary><div class="stats">${cell(Math.round(x.kcal), 'kcal')}${cell(x.protein, 'protéines g')}${cell(x.carbs, 'glucides g')}${cell(x.fat, 'lipides g')}${cell(x.fiber, 'fibres g')}${cell(x.iron, 'fer mg')}</div><p class="foot-note">Pour ${r.servings} portion${r.servings > 1 ? 's' : ''} · ${x.covered}/${x.total} ingrédients reconnus · table interne approximative, à titre indicatif.</p></details>`;
}
// Adapter les quantités à la taille du moule (surface)
function initPan(r, setScale) {
  const box = $('#panbody'); let from = { shape: 'round', a: 22, b: 30 }, to = store.get('mypan', { shape: 'round', a: 24, b: 30 });
  const row = (id, p, label) => `<div class="panrow"><span>${label}</span><select data-p="${id}:shape"><option value="round" ${p.shape === 'round' ? 'selected' : ''}>Rond Ø</option><option value="square" ${p.shape === 'square' ? 'selected' : ''}>Carré</option><option value="rect" ${p.shape === 'rect' ? 'selected' : ''}>Rectangle</option></select><input type="number" inputmode="decimal" min="5" max="80" data-p="${id}:a" value="${p.a}" aria-label="${label} : dimension"><span class="x">×</span><input type="number" inputmode="decimal" min="5" max="80" data-p="${id}:b" value="${p.b}" aria-label="${label} : seconde dimension"><span>cm</span></div>`;
  const draw = () => { box.innerHTML = `${row('from', from, 'Moule de la recette')}${row('to', to, 'Mon moule')}<p class="foot-note" id="panres"></p><button type="button" class="btn small" id="panreset">Réinitialiser</button>`; sync(); };
  const sync = () => {
    box.querySelectorAll('[data-p$=":b"],.x').forEach(el => { const id = el.dataset.p ? el.dataset.p.split(':')[0] : null; const p = id === 'from' ? from : id === 'to' ? to : null; if (p) el.hidden = p.shape !== 'rect'; });
    box.querySelectorAll('.panrow').forEach((rw, i) => { const p = i ? to : from; rw.querySelector('.x').hidden = p.shape !== 'rect'; });
    const ratio = panRatio(from, to), res = $('#panres');
    res.textContent = ratio === 1 ? 'Mêmes quantités.' : `Quantités × ${fmtQty(Math.round(ratio * 100) / 100)}. Gardez la même hauteur de pâte ; la cuisson varie peu, vérifiez à la fin.`;
    setScale(ratio);
  };
  box.addEventListener('input', e => { const d = e.target.dataset.p; if (!d) return; const [id, k] = d.split(':'), p = id === 'from' ? from : to; p[k] = k === 'shape' ? e.target.value : +e.target.value || 0; if (id === 'to') store.set('mypan', to); sync(); });
  box.addEventListener('click', e => { if (e.target.id === 'panreset') { from = { shape: 'round', a: 22, b: 30 }; to = { ...from }; draw(); } });
  $('#pan').addEventListener('toggle', e => { if (e.target.open && !box.innerHTML) draw(); if (!e.target.open) setScale(1); });
}
// Photos : en mode serveur, BLOB dans la base (API /api/recipes/:id/photo) ; en mode local, texte dans localStorage.
const toBlob = u => fetch(u).then(r => r.blob());
const urlToDataUrl = async u => { const b = await (await fetch(u)).blob(); return new Promise(ok => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); }); };
async function setPhoto(id, dataUrl, reload = true) {
  if (!serverMode) { photos[id] = dataUrl; store.set('photos', photos); return; }
  const x = await fetch('/api/recipes/' + id + '/photo', { method: 'PUT', body: await toBlob(dataUrl) });
  if (!x.ok) throw new Error((await x.json().catch(() => ({}))).error || 'Erreur serveur');
  if (reload) await reloadServer();
}
async function clearPhoto(id) {
  if (serverMode) { await fetch('/api/recipes/' + id + '/photo', { method: 'DELETE' }); await reloadServer(); } else { delete photos[id]; store.set('photos', photos); }
}
function resizePhoto(file, m = 900) {
  return new Promise(res => { const img = new Image(); img.onload = () => { const k = Math.min(1, m / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .8)); }; img.src = URL.createObjectURL(file); });
}

// ---------- minuteurs ----------
const timers = (() => { try { const t = JSON.parse(localStorage.getItem('rec.timers') || '[]'); return Array.isArray(t) ? t.filter(x => x && typeof x.end === 'number') : []; } catch { return []; } })(); let actx;
const saveTimers = () => { try { localStorage.setItem('rec.timers', JSON.stringify(timers)); } catch {} };
function beep() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); [0, .25, .5].forEach(t => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(actx.destination); g.gain.setValueAtTime(.2, actx.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, actx.currentTime + t + .2); o.start(actx.currentTime + t); o.stop(actx.currentTime + t + .22); }); navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {} }
const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600); return (h ? h + ':' : '') + String(Math.floor(s % 3600 / 60)).padStart(h ? 2 : 1, '0') + ':' + String(s % 60).padStart(2, '0'); };
function drawTimers() {
  $('#timers').innerHTML = timers.map((t, i) => `<div class="timer ${t.done ? 'ring' : ''}"><div class="clock">${clock(t.end - Date.now())}</div><div class="lbl">${t.done ? '⏰ Terminé ! ' : ''}${esc(t.label)}</div>${t.done ? `<button class="btn small" data-snooze="${i}" title="Relancer 1 minute">+1 min</button>` : ''}<button class="btn small" data-x="${i}" aria-label="${t.done ? 'Fermer' : 'Arrêter'}">${t.done ? 'OK' : '✕'}</button></div>`).join(''); const tc = $('#tcount'); tc.hidden = !timers.length; tc.textContent = timers.length;
}
$('#timerOpen').onclick = () => openTimerForm();
const updateClocks = () => $('#timers').querySelectorAll('.clock').forEach((el, i) => { if (timers[i]) el.textContent = clock(timers[i].end - Date.now()); }); // sans refaire le DOM : un clic n'est jamais perdu
$('#timers').addEventListener('click', e => {
  const x = e.target.closest('[data-x]'), z = e.target.closest('[data-snooze]');
  if (x) { timers.splice(+x.dataset.x, 1); saveTimers(); drawTimers(); }
  else if (z) { const t = timers[+z.dataset.snooze]; t.end = Date.now() + 60000; t.done = false; saveTimers(); drawTimers(); }
});
function openTimerForm() {
  const m = $('#modal'); m.hidden = false;
  m.innerHTML = `<form class="mbox" id="tf"><h2>⏱ Nouveau minuteur</h2><div class="fld"><label>Nom</label><input name="name" placeholder="Pâtes, repos de la pâte…"></div><div class="fld"><label>Durée (minutes)</label><input name="min" type="number" min="1" max="1440" value="10" required></div><div class="chips" id="tpre">${[3, 5, 10, 15, 20, 30, 45, 60].map(v => `<button type="button" class="chip" data-v="${v}">${v} min</button>`).join('')}</div><div class="toolbar" style="margin-top:14px"><button class="btn primary">Lancer</button><button type="button" class="btn" id="tc">Annuler</button></div></form>`;
  $('#tpre').onclick = e => { const b = e.target.closest('[data-v]'); if (b) $('#tf').elements.min.value = b.dataset.v; };
  $('#tc').onclick = () => { m.hidden = true; };
  $('#tf').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); startTimer(+f.get('min'), String(f.get('name')).trim() || 'Minuteur'); m.hidden = true; };
}
function startTimer(min, label) {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch {} // débloque l'audio (iOS)
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); } catch {} // pour être prévenu si l'app est en arrière-plan
  timers.push({ end: Date.now() + min * 60000, label, done: false }); saveTimers(); drawTimers();
}
document.addEventListener('click', e => { const b = e.target.closest('[data-timer]'); if (b) startTimer(+b.dataset.timer, b.dataset.label); });
// Les minuteurs sont enregistrés avec leur heure de fin : ils survivent à la fermeture de l'app. Au retour au premier plan
// (iOS suspend les pages en arrière-plan), le temps restant est recalculé aussitôt.
function tickTimers() {
  let ch = false;
  timers.forEach(t => { if (!t.done && Date.now() >= t.end) { t.done = true; ch = true; beep(); try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('⏰ Minuteur terminé', { body: t.label, tag: 'timer-' + t.end }); } catch {} } });
  if (ch) { saveTimers(); drawTimers(); } else if (timers.length) updateClocks();
}
setInterval(tickTimers, 250);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tickTimers(); });
drawTimers(); tickTimers();

// ---------- nouvelle recette ----------
const findRef = t => (all().find(x => norm(x.title) === norm(t)) || {}).id;
const hostOf = u => { try { return new URL(u).host; } catch { return u; } };
function shrinkDataUrl(u, m) { return new Promise(res => { const img = new Image(); img.onload = () => { const k = Math.min(1, m / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .82)); }; img.onerror = () => res(null); img.src = u; }); }
function openForm(edit) {
  const m = $('#modal'); m.hidden = false; let importMeta = null, importedPhoto = null;
  const types = ['Plat', 'Entrée', 'Dessert', 'Petit-déjeuner', 'Boisson', 'Base']; if (edit && !types.includes(edit.type)) types.push(edit.type);
  const opt = a => a.map(v => `<option>${esc(v)}</option>`).join('');
  m.innerHTML = `<form class="mbox full" id="nf"><div class="mhead"><h2>${edit ? 'Modifier la recette' : 'Nouvelle recette'}</h2><button type="button" class="btn icon" id="cancel2" aria-label="Fermer">✕</button></div>
  ${edit ? '' : `<div class="panel" style="margin-bottom:14px"><b>✨ Importer</b> <small id="imsg" style="color:var(--muted)">depuis une URL ou une photo (nécessite le serveur)</small><div class="toolbar" style="margin-top:8px"><input id="iurl" type="url" placeholder="https://…" style="flex:1;min-width:180px;padding:8px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface2)"><button type="button" class="btn" id="igo">Importer l'URL</button><label class="btn">📸 Photo / scan<input id="iph" type="file" accept="image/*" capture="environment" hidden></label></div></div>`}
  <div class="fld"><label>Titre</label><input name="title" required></div>
  <div class="row2"><div class="fld"><label>Type</label><select name="type">${opt(types)}</select></div>
  <div class="fld"><label>Difficulté</label><select name="difficulty"><option value="1">Facile</option><option value="2">Moyen</option><option value="3">Difficile</option></select></div>
  <div class="fld"><label>Personnes</label><input name="servings" type="number" min="1" value="4"></div></div>
  <div class="row2"><div class="fld"><label>Préparation (min)</label><input name="prep" type="number" min="0" value="15"></div><div class="fld"><label>Cuisson (min)</label><input name="cook" type="number" min="0" value="20"></div><div class="fld"><label>Repos (min)</label><input name="rest" type="number" min="0" value="0"></div></div>
  <div class="fld"><label>Régimes (séparés par des virgules)</label><input name="diets" value="Vegan"></div>
  <div class="fld"><label>Méthodes de cuisson (virgules)</label><input name="method" value="Four"></div>
  <div class="fld"><label>Tags (virgules)</label><input name="tags" placeholder="rapide, brunch"></div>
  <div class="fld"><label>Saisons</label><div class="chips">${['Printemps', 'Été', 'Automne', 'Hiver', "Toute l'année"].map(x => `<label class="chip"><input type="checkbox" name="seasons" value="${esc(x)}" style="accent-color:var(--accent)"> ${esc(x)}</label>`).join('')}</div></div>
  <div class="fld"><label>Collections (virgules)</label><input name="collections" placeholder="Fêtes, Batch cooking"></div>
  <div class="fld"><label>Ingrédients — un par ligne : « 200 g farine ». Pour inclure une recette de base : « 1 @Pâte brisée vegan »</label><textarea name="ing" rows="6" placeholder="200 g farine&#10;2 oignons"></textarea></div>
  <div class="fld"><label>Étapes — une par ligne. Optionnel : « texte | 180°C | 25 min » (ajouter « repos » après les minutes pour un temps de repos)</label><textarea name="steps" rows="6" placeholder="Préchauffer et mélanger.&#10;Cuire au four | 180°C | 25 min&#10;Laisser tiédir | 10 min repos"></textarea></div>
  <div class="fld"><label>${edit ? 'Nouvelle photo (vide = garder l\'actuelle)' : 'Photo'}</label><input name="photo" type="file" accept="image/*"></div>
  <div class="toolbar mfoot"><button class="btn primary">Enregistrer</button><button type="button" class="btn" id="cancel">Annuler</button></div></form>`;
  $('#cancel').onclick = $('#cancel2').onclick = () => { m.hidden = true; };
  const fill = r => { const f = $('#nf').elements, set = (k, v) => { f[k].value = v; };
    set('title', r.title); set('type', r.type); set('difficulty', r.difficulty); set('servings', r.servings); set('prep', r.prep); set('cook', r.cook); set('rest', r.rest);
    set('diets', (r.diets || []).join(', ')); set('method', (r.method || []).join(', ')); set('tags', (r.tags || []).join(', ')); set('collections', (r.collections || []).join(', '));
    $('#nf').querySelectorAll('[name=seasons]').forEach(c => { c.checked = (r.seasons || []).includes(c.value); });
    set('ing', r.ingredients.map(ingLine).join('\n')); set('steps', r.steps.map(stepLine).join('\n')); };
  if (edit) fill(edit);
  else {
    const imp = async (path, payload, label) => { const msg = $('#imsg'); msg.textContent = '⏳ ' + label + '…';
      try { const r = await fetch('/api/import/' + path, { method: 'POST', body: JSON.stringify(payload) }), j = await r.json(); if (!r.ok) throw new Error(j.error); fill(j.recipe); importMeta = path === 'url' ? { kind: 'url', source_url: j.source_url } : { kind: 'photo' }; importedPhoto = j.imageData || null;
        msg.innerHTML = `✅ Importé (${esc(j.via)})${j.imageData ? ' · 📷 photo de la page récupérée' : ''} — relisez avant d'enregistrer !` + (j.duplicate ? `<br>⚠️ <b>Déjà dans vos recettes</b> : <a href="#/r/${esc(j.duplicate.id)}" id="dup">${esc(j.duplicate.title)}</a>` : '');
        const dl = $('#dup'); if (dl) dl.onclick = () => { m.hidden = true; }; }
      catch (e) { msg.textContent = '⚠️ ' + e.message; } };
    $('#igo').onclick = () => $('#iurl').value && imp('url', { url: $('#iurl').value }, 'Lecture de la page');
    $('#iph').onchange = async e => { const d = await resizePhoto(e.target.files[0], 1600); imp('photo', { data: d.split(',')[1], mediaType: 'image/jpeg' }, 'Lecture de la photo'); };
  }
  $('#nf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target), list = k => f.get(k).split(',').map(x => x.trim()).filter(Boolean), lines = k => f.get(k).split('\n').map(l => l.trim()).filter(Boolean);
    const { total, photo: _p, ...base } = edit || {}, file = f.get('photo');
    const r = { ...base, id: edit ? edit.id : 'u' + Date.now(), title: f.get('title'), emoji: base.emoji || '🍽️', hue: base.hue ?? Math.floor(Math.random() * 360), type: f.get('type'), diets: list('diets'), difficulty: +f.get('difficulty'), prep: +f.get('prep'), cook: +f.get('cook'), rest: +f.get('rest'), method: list('method'), servings: +f.get('servings') || 1, tags: list('tags'), seasons: f.getAll('seasons'), collections: list('collections'), ingredients: lines('ing').map(l => parseIng(l, t => { const id = findRef(t); return id === (edit && edit.id) ? undefined : id; })), steps: lines('steps').map(parseStep) };
    const newPhoto = file && file.size ? await resizePhoto(file, serverMode ? 1200 : 900) : importedPhoto ? await shrinkDataUrl(importedPhoto, serverMode ? 1200 : 900) : null;
    try {
      if (serverMode) {
        const send = (url, method, b) => fetch(url, { method, body: JSON.stringify(b) }).then(x => { if (!x.ok) throw new Error('Erreur serveur'); return x.json(); });
        if (edit) await send('/api/recipes/' + r.id, 'PUT', { recipe: r }); else r.id = (await send('/api/recipes', 'POST', { recipe: r, kind: importMeta ? importMeta.kind : 'manual', source_url: importMeta ? importMeta.source_url : undefined })).id;
        if (newPhoto) await setPhoto(r.id, newPhoto); else await reloadServer();
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
  $('#bx').onclick = async () => {
    const ph = { ...photos };
    if (serverMode) for (const r of serverRecipes) if (r.photo) { try { ph[r.id] = await urlToDataUrl(r.photo); } catch {} }
    const d = { app: 'mes-recettes', version: 1, exported: new Date().toISOString(), recipes: serverMode ? serverRecipes : userRecipes, favs: [...favs], cooklog: logs(), pantry: pantry(), photos: ph, shop: shopList(), plan: store.get('plan', {}) };
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
    if (serverMode) { for (const [id, u] of Object.entries(d.photos || {})) { const rr = serverRecipes.find(x => x.id === id); if (rr && !rr.photo) { try { await setPhoto(id, u, false); } catch {} } } await reloadServer(); }
    else { photos = { ...photos, ...(d.photos || {}) }; store.set('photos', photos); }
    store.set('plan', { ...store.get('plan', {}), ...(d.plan || {}) });
    if (!shopList().length && Array.isArray(d.shop)) store.set('shop', d.shop);
    if (d.cooklog && typeof d.cooklog === 'object') { const A = logs(); for (const [id, l] of Object.entries(d.cooklog)) { const have = new Set((A[id] || []).map(x => x.id)); A[id] = [...(A[id] || []), ...(Array.isArray(l) ? l : []).filter(x => x && x.id && x.d && !have.has(x.id))]; } store.set('cooklog', A); }
    if (Array.isArray(d.pantry)) store.set('pantry', [...new Set([...pantry(), ...d.pantry.filter(x => typeof x === 'string')])]);
    m.hidden = true; buildFilters(); updateBadge(); route(); toast(`✅ ${added} recette${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''}`);
  };
}
// Menu « Plus » : se ferme au clic ailleurs ; fenêtres courtes : un clic sur le fond les ferme (jamais le formulaire, pour ne pas perdre la saisie)
document.addEventListener('click', e => { document.querySelectorAll('details.more[open]').forEach(d => { if (!d.contains(e.target) || e.target.closest('.menu button')) d.open = false; }); });
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' && !$('#nf')) $('#modal').hidden = true; });
const setPlaceholder = () => { $('#q').placeholder = innerWidth > 640 ? 'Rechercher une recette, un ingrédient, une méthode…' : 'Rechercher…'; };
addEventListener('resize', setPlaceholder); setPlaceholder();
addEventListener('keydown', e => { if (e.key === 'Escape') { $('#modal').hidden = true; drawer(false); } if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); } });

// ---------- notes et historique ----------
const logs = () => store.get('cooklog', {});
function stat(id, L = logs()) { const l = L[id]; if (!l || !l.length) return null; const rated = l.filter(x => x.r); return { n: l.length, last: l.map(x => x.d).sort().pop(), avg: rated.length ? rated.reduce((a, x) => a + x.r, 0) / rated.length : null }; }
function ago(d) { const n = Math.floor((Date.now() - new Date(d + 'T12:00').getTime()) / 864e5); return n <= 0 ? "aujourd'hui" : n === 1 ? 'hier' : n < 60 ? `il y a ${n} j` : `il y a ${Math.round(n / 30)} mois`; }
function renderJournal(r) {
  const el = $('#journal'); if (!el) return;
  const L = (logs()[r.id] || []).slice().sort((a, b) => b.d.localeCompare(a.d)), s = stat(r.id);
  el.innerHTML = `<h2>📓 Mon journal</h2>${s ? `<p class="meta"><span>Cuisinée ${s.n} fois</span><span>dernière : ${ago(s.last)}</span>${s.avg ? `<span>★ ${fmtQty(Math.round(s.avg * 10) / 10)} / 5</span>` : ''}</p>` : '<p class="meta">Pas encore cuisinée.</p>'}
  <button class="btn primary" id="jadd">✅ Je l'ai cuisinée</button>
  <ul class="journal">${L.map(x => `<li><b>${new Date(x.d + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</b> ${x.r ? `<span class="stars-ro">${'★'.repeat(x.r)}${'☆'.repeat(5 - x.r)}</span>` : ''}${x.n ? `<div>${esc(x.n)}</div>` : ''}<button class="btn small" data-jd="${x.id}" aria-label="Supprimer l'entrée">✕</button></li>`).join('')}</ul>`;
  $('#jadd').onclick = () => openLog(r);
  el.querySelectorAll('[data-jd]').forEach(b => b.onclick = () => { if (!confirm('Supprimer cette entrée ?')) return; const A = logs(); A[r.id] = (A[r.id] || []).filter(x => x.id !== b.dataset.jd); if (!A[r.id].length) delete A[r.id]; store.set('cooklog', A); renderJournal(r); });
}
function openLog(r) {
  const m = $('#modal'); m.hidden = false; let rating = 0; const today = new Date().toLocaleDateString('sv-SE');
  m.innerHTML = `<form class="mbox" id="lf"><h2>📓 ${esc(r.title)}</h2><div class="fld"><label>Date</label><input type="date" name="d" value="${today}" max="${today}" required></div><div class="fld"><label>Note</label><div class="stars" id="stars"></div></div><div class="fld"><label>Commentaire (ajustements, avis…)</label><textarea name="n" rows="3" placeholder="moins de sel, cuire 5 min de plus…"></textarea></div><div class="toolbar"><button class="btn primary">Enregistrer</button><button type="button" class="btn" id="lc">Annuler</button></div></form>`;
  const paint = () => { $('#stars').innerHTML = [1, 2, 3, 4, 5].map(i => `<button type="button" class="star ${i <= rating ? 'on' : ''}" data-s="${i}" aria-label="${i} étoile${i > 1 ? 's' : ''}">${i <= rating ? '★' : '☆'}</button>`).join(''); };
  paint(); $('#stars').onclick = e => { const b = e.target.closest('[data-s]'); if (b) { rating = rating === +b.dataset.s ? 0 : +b.dataset.s; paint(); } };
  $('#lc').onclick = () => { m.hidden = true; };
  $('#lf').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target), A = logs(), note = String(f.get('n')).trim();
    (A[r.id] = A[r.id] || []).push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), d: f.get('d'), ...(rating ? { r: rating } : {}), ...(note ? { n: note } : {}) });
    store.set('cooklog', A); m.hidden = true; toast('📓 Ajouté au journal'); renderJournal(r); };
}

// ---------- mode cuisine ----------
let wake = null;
async function keepAwake(on) { try { if (on) wake = await navigator.wakeLock.request('screen'); else { await wake?.release(); wake = null; } } catch {} }
function openCook(r, n) {
  let k = 0, ing = false; const last = r.steps.length - 1, el = document.createElement('div'); el.className = 'cook';
  document.body.append(el); document.body.classList.add('cooking'); keepAwake(true);
  const qty = i => i.q ? `<b>${fmtQty(i.q * n / r.servings)}</b> ` : '';
  const stepIngs = s => r.ingredients.filter(i => norm(i.n).split(/[^a-z]+/).some(w => w.length >= 5 && norm(s.t).includes(w)));
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition, canTalk = 'speechSynthesis' in window; let rec = null, listening = false;
  const close = (done) => { listening = false; try { rec && rec.stop(); } catch {} try { speechSynthesis.cancel(); } catch {} document.removeEventListener('keydown', keys); el.remove(); document.body.classList.remove('cooking'); keepAwake(false); if (done) { toast('Bon appétit ! 🍽️'); setTimeout(() => openLog(r), 400); } };
  const draw = () => {
    const s = r.steps[k], si = stepIngs(s);
    el.innerHTML = `<div class="cooktop"><button class="btn" data-c="x" aria-label="Quitter">✕</button><b class="ct">${esc(r.title)}</b>${canTalk ? '<button class="btn" data-c="say" title="Lire l\'étape à voix haute" aria-label="Lire l\'étape">🔊</button>' : ''}${SR ? `<button class="btn ${listening ? 'primary' : ''}" data-c="mic" title="Commandes vocales : suivant, précédent, répète, minuteur, ingrédients" aria-label="Commandes vocales" aria-pressed="${listening}">🎤</button>` : ''}<button class="btn ${ing ? 'primary' : ''}" data-c="ing" aria-label="Ingrédients">🧺</button></div>
    <div class="cookbar"><i style="width:${(k + 1) / r.steps.length * 100}%"></i></div>
    <div class="cookbody">${ing ? `<h2>Ingrédients · ${fmtQty(n)} pers.</h2><ul class="ing">${r.ingredients.map(i => `<li>${qty(i)}${esc(i.u)} ${esc(i.n)}</li>`).join('')}</ul>` :
      `<div class="cookn">Étape ${k + 1} sur ${r.steps.length}</div><p class="cooktext">${esc(s.t)}</p>
      <div class="chiprow">${s.temp ? `<span class="pill temp big">🌡 ${s.temp} °C</span>` : ''}${s.timer ? `<span class="pill big">${s.kind === 'repos' ? '💤' : '🔥'} ${fmtMin(s.timer)}</span>` : ''}</div>
      ${s.timer ? `<button class="tbtn bigbtn" data-timer="${s.timer}" data-label="${esc(r.title)} — étape ${k + 1}">▶ Lancer le minuteur (${fmtMin(s.timer)})</button>` : ''}
      ${si.length ? `<div class="cookings"><small>Pour cette étape</small>${si.map(i => `<span class="pill">${qty(i)}${esc(i.u)} ${esc(i.n)}</span>`).join('')}</div>` : ''}`}</div>
    <div class="cooknav"><button class="btn" data-c="prev" ${k === 0 ? 'disabled' : ''}>← Précédent</button><button class="btn primary" data-c="next">${k === last ? 'Terminer ✓' : 'Suivant →'}</button></div>`;
  };
  const go = d => { ing = false; if (k + d > last) return close(true); k = Math.max(0, k + d); draw(); };
  const speak = t => { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'fr-FR'; speechSynthesis.speak(u); } catch {} };
  const act = c => {
    if (c === 'next') go(1); else if (c === 'prev') go(-1); else if (c === 'repeat') speak(r.steps[k].t); else if (c === 'ingredients') { ing = !ing; draw(); }
    else if (c === 'timer') { const s = r.steps[k]; s.timer ? startTimer(s.timer, `${r.title} — étape ${k + 1}`) : toast('Pas de minuteur sur cette étape'); }
    else if (c === 'finish') close(true); else if (c === 'quit') close();
  };
  const listen = on => {
    listening = on;
    if (on) { rec = new SR(); rec.lang = 'fr-FR'; rec.continuous = true; rec.interimResults = false;
      rec.onresult = e => act(voiceCommand(e.results[e.results.length - 1][0].transcript));
      rec.onend = () => { if (listening) try { rec.start(); } catch {} };
      rec.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { listening = false; toast('Micro refusé'); draw(); } };
      try { rec.start(); } catch {} toast('🎤 Je vous écoute : « suivant », « répète », « minuteur »…'); }
    else { try { rec && rec.stop(); } catch {} }
    draw();
  };
  const keys = e => { if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', keys);
  el.addEventListener('click', e => { const c = e.target.closest('[data-c]')?.dataset.c; if (!c) return; if (c === 'x') close(); else if (c === 'ing') { ing = !ing; draw(); } else if (c === 'say') speak(r.steps[k].t); else if (c === 'mic') listen(!listening); else go(c === 'next' ? 1 : -1); });
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
function updateBadge() { const n = shopList().filter(x => !x.done).length; document.querySelectorAll('.shopc').forEach(b => { b.hidden = !n; b.textContent = n; }); }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 2200); }
const pantry = () => store.get('pantry', []);
const hasIng = (i, haves) => { const k = keyName(i.n); return k.length >= 3 && haves.some(h => h.length >= 3 && (k.includes(h) || h.includes(k))); };
function addToShop(r, n, only) {
  const list = shopList(), k = n / r.servings, pk = pantry().map(keyName); let skipped = 0;
  expandIngredients(r, k, byId).forEach(i => {
    if (only && !only(i)) return;
    if (hasIng(i, pk)) { skipped++; return; } // déjà au garde-manger
    const p = shopPart(i, 1), ex = list.find(x => x.key === p.key && !x.done);
    if (ex) { ex.q = Math.round((ex.q + p.q) * 1000) / 1000; if (!ex.from.includes(r.title)) ex.from.push(r.title); } else list.push({ ...p, name: i.n, done: false, from: [r.title] });
  });
  store.set('shop', list); updateBadge(); toast('🛒 « ' + r.title + ' » ajoutée' + (skipped ? ` (${skipped} déjà au garde-manger)` : ''));
}
function renderShop() {
  const list = shopList(), groups = {};
  list.forEach((x, i) => (groups[aisle(x.name)] = groups[aisle(x.name)] || []).push([x, i]));
  $('#main').innerHTML = `<div class="detail"><h1>🛒 Liste de courses</h1>
  <form class="toolbar" id="sadd" style="margin:12px 0"><input id="snew" placeholder="Ajouter un article…" style="flex:1;padding:9px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface2)"><button class="btn primary">Ajouter</button></form>
  ${list.length ? `<div class="aisles">${Object.keys(groups).sort().map(g => `<section class="panel"><h2>${g}</h2><ul class="ing">${groups[g].map(([x, i]) => `<li class="${x.done ? 'done' : ''}"><label><input type="checkbox" data-si="${i}" ${x.done ? 'checked' : ''}><span>${(([a, u]) => `${a ? `<b>${a}</b> ` : ''}${esc(u)}`)(itemQty(x))} ${esc(x.name)}<br><small style="color:var(--muted)">${x.from.map(esc).join(', ')}</small></span></label><button class="btn small" data-sd="${i}" aria-label="Retirer">✕</button></li>`).join('')}</ul></section>`).join('')}</div>` : '<div class="empty"><div style="font-size:3rem">🛒</div><p>Votre liste est vide.<br>Ajoutez une recette depuis sa fiche, ou le planning de la semaine.</p></div>'}
  <div class="toolbar"><button class="btn" id="sclean">Retirer les cochés</button><button class="btn" id="sclear">Tout vider</button><button class="btn" id="sshare">📋 Copier / partager</button></div></div>`;
  const save = l => { store.set('shop', l); updateBadge(); renderShop(); };
  $('#sadd').onsubmit = e => { e.preventDefault(); const v = $('#snew').value.trim(); if (v) save([...list, { key: 'm|' + norm(v), name: v, u: '', q: 0, done: false, from: ['Ajout manuel'] }]); };
  $('#main').querySelectorAll('[data-si]').forEach(c => c.onchange = () => { list[c.dataset.si].done = c.checked; save(list); });
  $('#main').querySelectorAll('[data-sd]').forEach(c => c.onclick = () => { list.splice(c.dataset.sd, 1); save(list); });
  $('#sclean').onclick = () => save(list.filter(x => !x.done));
  $('#sclear').onclick = () => confirm('Vider la liste ?') && save([]);
  $('#sshare').onclick = async () => { const t = list.filter(x => !x.done).map(x => `- ${[...itemQty(x), x.name].filter(Boolean).join(' ')}`).join('\n'); try { if (navigator.share) await navigator.share({ title: 'Courses', text: t }); else await copyText(t); } catch {} };
}

// Copie sans API réservée au HTTPS (l'app peut tourner en http:// sur le réseau local)
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch { const a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = 0; document.body.append(a); a.select(); document.execCommand('copy'); a.remove(); }
  toast('Copié !');
}

// ---------- frigo et garde-manger ----------
const STAPLES = ['sel', 'poivre', "huile d'olive", 'huile', 'farine', 'sucre', 'eau', 'curcuma', 'cumin', 'levure chimique', 'moutarde', 'vinaigre', 'sauce soja', 'ail', 'oignon'];
const cleanName = n => n.replace(/\(.*?\)/g, '').replace(/^(de la |de l'|de |d'|du |des )/i, '').trim();
function renderFridge() {
  const fr = store.get('fridge', []), pa = pantry(), frk = fr.map(keyName), all2 = [...frk, ...pa.map(keyName)];
  const names = [...new Set(all().flatMap(r => r.ingredients.filter(i => !i.ref).map(i => cleanName(i.n))))].sort((a, b) => a.localeCompare(b, 'fr'));
  const rows = all().map(r => { const ex = expandIngredients(r, 1, byId); return { r, miss: ex.filter(i => !hasIng(i, all2)), hit: ex.filter(i => hasIng(i, frk)).length }; })
    .filter(x => x.hit > 0).sort((a, b) => a.miss.length - b.miss.length || b.hit - a.hit || a.r.total - b.r.total);
  const chips = (arr, k) => arr.map((x, i) => `<button class="chip on" data-rm="${k}:${i}" title="Retirer">${esc(x)} ✕</button>`).join('');
  $('#main').innerHTML = `<div class="detail"><h1>🧊 Qu'est-ce que je cuisine ?</h1>
  <section class="panel" style="margin:14px 0"><h2>Dans mon frigo</h2><form class="toolbar" id="ff"><input id="fin" list="ingl" placeholder="Ajouter un ingrédient (tofu, courgette…)" autocomplete="off" style="flex:1;min-width:180px;padding:9px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface2)"><datalist id="ingl">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist><button class="btn primary">Ajouter</button></form>
  <div class="chips" style="margin-top:10px">${chips(fr, 'f') || '<small style="color:var(--muted)">Rien pour l\'instant.</small>'}</div></section>
  <section class="panel" style="margin-bottom:14px"><h2>Mon garde-manger <small style="color:var(--muted);font-weight:400">(jamais ajouté aux courses)</small></h2><form class="toolbar" id="pf"><input id="pin" list="ingl" placeholder="Toujours à la maison (sel, huile, farine…)" style="flex:1;min-width:180px;padding:9px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface2)"><button class="btn">Ajouter</button><button type="button" class="btn" id="pbase">＋ Les basiques</button></form>
  <div class="chips" style="margin-top:10px">${chips(pa, 'p') || '<small style="color:var(--muted)">Vide.</small>'}</div></section>
  ${fr.length ? (rows.length ? `<h2>${rows.length} recette${rows.length > 1 ? 's' : ''} possible${rows.length > 1 ? 's' : ''}</h2><div class="list">${rows.map(({ r, miss }) => `<div class="card"><a href="#/r/${r.id}" style="display:contents">${thumb(r)}<div class="body"><h3>${esc(r.title)}</h3><div class="meta"><span>⏱ ${fmtMin(r.total)}</span><span class="${miss.length ? '' : 'ok'}" style="${miss.length ? '' : 'color:var(--accent);font-weight:700'}">${miss.length ? `Il manque ${miss.length} : ${miss.map(i => esc(cleanName(i.n))).join(', ')}` : '✅ Tout est là !'}</span></div></div></a>${miss.length ? `<button class="btn small" data-miss="${r.id}" style="margin-right:10px">🛒 Le manque</button>` : ''}</div>`).join('')}</div>` : '<div class="empty"><p>Aucune recette ne contient ces ingrédients.</p></div>') : '<div class="empty"><div style="font-size:3rem">🥕</div><p>Ajoutez ce que vous avez : les recettes sont classées par ingrédients manquants.</p></div>'}</div>`;
  const add = (inputId, key, cur) => e => { e.preventDefault(); const v = $(inputId).value.trim(); if (v && !cur().includes(v)) store.set(key, [...cur(), v]); renderFridge(); };
  $('#ff').onsubmit = add('#fin', 'fridge', () => store.get('fridge', []));
  $('#pf').onsubmit = add('#pin', 'pantry', pantry);
  $('#pbase').onclick = () => { store.set('pantry', [...new Set([...pantry(), ...STAPLES])]); renderFridge(); };
  $('#main').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const [k, i] = b.dataset.rm.split(':'), key = k === 'f' ? 'fridge' : 'pantry', a = key === 'fridge' ? store.get('fridge', []) : pantry(); a.splice(+i, 1); store.set(key, a); renderFridge(); });
  $('#main').querySelectorAll('[data-miss]').forEach(b => b.onclick = () => { const x = rows.find(y => y.r.id === b.dataset.miss); addToShop(x.r, x.r.servings, i => x.miss.some(m => m.n === i.n)); });
}

// ---------- planning de la semaine ----------
let planOff = 0, planUndo = null;
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'], SLOTS = [['midi', '☀️ Midi'], ['soir', '🌙 Soir']];
const dayKey = d => d.toISOString().slice(0, 10);
function weekDays() { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7 + planOff * 7); return DAYS.map((_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return x; }); }
function renderPlan() {
  const plan = store.get('plan', {}), days = weekDays(), fmt = d => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  $('#main').innerHTML = `<div class="detail"><h1>📅 Planning</h1>
  <div class="toolbar" style="margin:12px 0"><button class="btn" id="pprev">←</button><b style="align-self:center">${fmt(days[0])} – ${fmt(days[6])}</b><button class="btn" id="pnext">→</button><button class="btn" id="ptoday">Aujourd'hui</button><span style="flex:1"></span><button class="btn" id="psuggest">✨ Proposer la semaine</button><button class="btn primary" id="pshop">🛒 Courses de la semaine</button></div>
  ${planUndo ? '<div class="callout info" style="margin:0 0 12px">✨ Semaine proposée pour les repas encore vides. <button class="btn small" id="pundo">Annuler</button></div>' : ''}
  <div class="week">${days.map((d, i) => `<section class="panel"><h2>${DAYS[i]} <small style="color:var(--muted)">${fmt(d)}</small></h2>${SLOTS.map(([s, l]) => { const k = dayKey(d) + '_' + s, ids = [].concat(plan[k] || []).filter(byId); return `<div class="slot"><small>${l}</small><div class="slotl">${ids.map(id => { const r = byId(id); return `<div class="slotd"><a href="#/r/${r.id}" class="slotr">${r.emoji} ${esc(r.title)}</a><button class="btn small" data-pc="${k}|${id}" aria-label="Retirer">✕</button></div>`; }).join('')}<button class="btn small" data-pa="${k}">＋ ${ids.length ? 'Ajouter un plat' : 'Choisir'}</button></div></div>`; }).join('')}</section>`).join('')}</div></div>`;
  $('#psuggest').onclick = () => openSuggest(days);
  if ($('#pundo')) $('#pundo').onclick = () => { store.set('plan', planUndo); planUndo = null; renderPlan(); };
  $('#pprev').onclick = () => { planOff--; renderPlan(); }; $('#pnext').onclick = () => { planOff++; renderPlan(); }; $('#ptoday').onclick = () => { planOff = 0; renderPlan(); };
  $('#pshop').onclick = () => { const rs = days.flatMap(d => SLOTS.flatMap(([s]) => [].concat(plan[dayKey(d) + '_' + s] || []).map(byId))).filter(Boolean); if (!rs.length) return toast('Aucun repas planifié cette semaine'); rs.forEach(r => addToShop(r, r.servings)); };
  $('#main').querySelectorAll('[data-pc]').forEach(b => b.onclick = () => { const [k, id] = b.dataset.pc.split('|'), left = [].concat(plan[k] || []).filter(x => x !== id); left.length ? plan[k] = left : delete plan[k]; store.set('plan', plan); renderPlan(); });
  $('#main').querySelectorAll('[data-pa]').forEach(b => b.onclick = () => pickRecipe(b.dataset.pa));
}
function openSuggest(days) {
  const m = $('#modal'); m.hidden = false;
  m.innerHTML = `<form class="mbox" id="sf"><h2>✨ Proposer la semaine</h2><p style="color:var(--muted)">Remplit seulement les repas vides. Priorité aux recettes de saison, bien notées, pas cuisinées depuis longtemps ; jamais deux fois la même tant qu'il en reste d'autres.</p>
  <div class="fld"><label>Repas à remplir</label><select name="slots"><option value="soir">Les soirs</option><option value="midi,soir">Midi et soir</option></select></div>
  <div class="fld"><label>Temps actif maximum en semaine (préparation + cuisson, minutes)</label><input name="max" type="number" min="10" max="240" value="45"></div>
  <label class="chip" style="align-self:flex-start"><input type="checkbox" name="dessert" checked style="accent-color:var(--accent)"> Un dessert le dimanche</label>
  <div class="toolbar" style="margin-top:14px"><button class="btn primary">Proposer</button><button type="button" class="btn" id="sc">Annuler</button></div></form>`;
  $('#sc').onclick = () => { m.hidden = true; };
  $('#sf').onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.target), plan = store.get('plan', {}), L = logs(), stats = {};
    for (const r of all()) { const st = stat(r.id, L); if (st) stats[r.id] = st; }
    const add = suggestWeek({ recipes: all(), plan, days: days.map((d, i) => ({ key: dayKey(d), weekday: i })), slots: String(f.get('slots')).split(','), stats, favs, season: seasonOf(new Date()), maxWeek: +f.get('max') || 45, dessert: f.get('dessert') === 'on', today: Date.now() });
    m.hidden = true;
    if (!Object.keys(add).length) return toast('Aucun repas vide à remplir (ou pas assez de recettes)');
    planUndo = JSON.parse(JSON.stringify(plan)); store.set('plan', { ...plan, ...add }); renderPlan();
  };
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
let ready = false;
function route() { if (!ready) return; if (location.hash !== '#/planning') planUndo = null; const h = location.hash, m = h.match(/^#\/r\/(.+)$/); drawer(false); document.body.dataset.page = m ? 'detail' : h === '#/courses' ? 'shop' : h === '#/planning' ? 'plan' : h === '#/frigo' ? 'fridge' : 'list';
  document.querySelectorAll('[data-nav]').forEach(a => { const cur = a.dataset.nav === (document.body.dataset.page === 'detail' ? 'list' : document.body.dataset.page); cur ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); }); m ? renderDetail(m[1]) : h === '#/courses' ? renderShop() : h === '#/planning' ? renderPlan() : h === '#/frigo' ? renderFridge() : renderList(); }
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
  ready = true; buildFilters(); setView(view); updateBadge(); route();
  if (serverMode && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
})();
