// Logique pure de l'app (aucun accès au DOM ni au réseau) : testable avec Node (server/test-lib.js) et utilisée par app.js.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Lib = factory(); })(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// ---------- texte ----------
const norm = s => String(s).toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '');
// Précision adaptée à la taille : 139,5 g -> 140 g ; 7,25 -> 7,3 ; 0,666 -> 0,67
const fmtQty = q => { if (!q) return ''; const r = q >= 20 ? Math.round(q) : q >= 5 ? Math.round(q * 10) / 10 : Math.round(q * 100) / 100; return String(r).replace('.', ','); };
const keyName = n => norm(n).replace(/^(de la |de l'|de |d'|du |des |la |le |les |l')/, '').split(/\s+/).map(w => w.replace(/s$/, '')).join(' ');

// ---------- unités et liste de courses ----------
const UNITS = { 'g': ['m', 1], 'kg': ['m', 1000], 'mg': ['m', .001], 'ml': ['v', 1], 'cl': ['v', 10], 'dl': ['v', 100], 'l': ['v', 1000], 'c. a s.': ['s', 3], 'c. a c.': ['s', 1] };
const normUnit = u => norm(u).replace(/\s+/g, ' ').trim();
const COUNTABLE = /^(gousse|pincée|boîte|sachet|bouquet|tranche|poignée|feuille|brin|verre|tasse|tête|branche|cube)s?$/i;
const singular = u => COUNTABLE.test(u.trim()) ? u.trim().replace(/s$/i, '') : u;
const plural = u => COUNTABLE.test(u.trim()) && !/s$/i.test(u.trim()) ? u.trim() + 's' : u;
const near = (a, b) => Math.abs(a - b) < 1e-9;
function shopPart(i, k) { // quantité d'un ingrédient (facteur k) en unité de base
  const ui = UNITS[normUnit(i.u)], q = Math.round((i.q || 0) * k * (ui ? ui[1] : 1) * 1000) / 1000;
  return ui ? { key: keyName(i.n) + '|' + ui[0], fam: ui[0], u: { m: 'g', v: 'ml', s: 'c. à c.' }[ui[0]], q } : { key: keyName(i.n) + '|u:' + normUnit(singular(i.u)), u: singular(i.u), q };
}
function itemQty(x) { // 500 g + 1 kg -> ['1,5', 'kg']
  if (!x.q) return ['', x.u];
  if (x.fam === 'm') return x.q >= 1000 ? [fmtQty(x.q / 1000), 'kg'] : [fmtQty(x.q), 'g'];
  if (x.fam === 'v') return x.q >= 1000 ? [fmtQty(x.q / 1000), 'L'] : x.q >= 100 && near(x.q / 10, Math.round(x.q / 10)) ? [fmtQty(x.q / 10), 'cl'] : [fmtQty(x.q), 'ml'];
  if (x.fam === 's') return x.q >= 3 && near(x.q / 3, Math.round(x.q / 3)) ? [fmtQty(x.q / 3), 'c. à s.'] : [fmtQty(x.q), 'c. à c.'];
  return [fmtQty(x.q), x.q > 1 ? plural(x.u) : x.u];
}

// ---------- saisie des ingrédients et des étapes (formulaire) ----------
const UNIT = 'c\\. ?à ?[sc]\\.|cuill\\w+ à \\w+|kg|mg|g|cl|ml|dl|l|cm|pincées?|gousses?|boîtes?|sachets?|bouquets?|tranches?|poignées?|feuilles?|brins?|verres?|tasses?';
const ING_RE = new RegExp('^([\\d.,/]+)\\s*(' + UNIT + ')?\\s+(.*)$', 'i');
// « 2 c. à s. de concentré » -> {q:2,u:'c. à s.',n:'de concentré'} ; « 1 @Pâte brisée » relie à une recette de base (findRef(titre) -> id)
function parseIng(l, findRef) {
  let q = 0, u = '', n = l;
  const x = l.match(ING_RE);
  if (x) { q = x[1].includes('/') ? x[1].split('/').reduce((a, b) => a / b) : parseFloat(x[1].replace(',', '.')); q = q || 0; u = x[2] || ''; n = x[3]; }
  else { const m = l.match(/^([\d.,/]+)\s+(@.*)$/); if (m) { q = parseFloat(m[1].replace(',', '.')) || 0; n = m[2]; } }
  if (n.trim().startsWith('@')) { n = n.trim().slice(1).trim(); const ref = findRef && findRef(n); return ref ? { q: q || 1, u: '', n, ref } : { q, u, n }; }
  return { q, u, n };
}
const ingLine = i => i.ref ? [i.q || '', '@' + i.n].filter(Boolean).join(' ') : [i.q || '', i.u, i.n].filter(Boolean).join(' ');
const stepLine = s => [s.t, s.temp ? s.temp + '°C' : '', s.timer ? s.timer + ' min' + (s.kind === 'repos' ? ' repos' : '') : ''].filter((x, k) => k === 0 || x).join(' | ');
const parseStep = l => { const [t, a, b] = l.split('|').map(x => x.trim()), s = { t }; [a, b].forEach(x => { if (!x) return; const n = parseInt(x); if (!(n > 0)) return; if (/°/.test(x)) s.temp = n; else { s.timer = n; s.kind = /repos/i.test(x) || /repos|frais/i.test(t) ? 'repos' : 'cuisson'; } }); return s; };

// ---------- recettes de base réutilisables ----------
// Remplace les lignes qui renvoient à une recette de base par ses ingrédients (facteur = nombre de « fournées »), récursivement.
function expandIngredients(r, factor, byId, depth = 0, seen = new Set()) {
  const out = [];
  for (const i of r.ingredients || []) {
    const sub = i.ref && depth < 3 && !seen.has(i.ref) ? byId(i.ref) : null;
    if (sub) out.push(...expandIngredients(sub, (i.q || 1) * factor, byId, depth + 1, new Set([...seen, r.id, i.ref])));
    else out.push({ ...i, q: (i.q || 0) * factor });
  }
  return out;
}

// ---------- recherche tolérante aux fautes ----------
function lev(a, b, max) { // distance de Levenshtein bornée par max
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let min = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < min) min = cur[j]; }
    if (min > max) return max + 1; prev = cur;
  }
  return prev[b.length];
}
function fuzzyHas(words, term) { // term et words déjà normalisés
  if (term.length < 4) return false;
  const max = term.length >= 8 ? 2 : 1, t = term.replace(/s$/, '');
  return words.some(w => { const x = w.replace(/s$/, ''); return x.startsWith(t) || (x.length >= 3 && lev(x, t, max) <= max); });
}
const words = s => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

// ---------- substitutions vegan (suggestions) ----------
const VEGAN_OK = /coco|soja|avoine|amande|riz|noisette|cajou|cacahu|vegetal|vegan|sarrasin|epeautre|olive|cacao|karite|tournesol|margarine/;
const SUBS = [
  { name: 'œuf', re: /\boeufs?\b/, alt: ["1 c. à s. de graines de lin moulues + 3 c. à s. d'eau par œuf (liant : gâteaux, galettes)", "3 c. à s. d'aquafaba par œuf entier, 2 c. à s. par blanc (montable en neige)", '50 g de tofu soyeux mixé par œuf (quiches, flans, gâteaux moelleux)', '60 g de compote de pomme par œuf (muffins, gâteaux)'] },
  { name: 'lait', re: /\blait\b/, skip: true, alt: ["Lait de soja, d'avoine ou d'amande, 1 pour 1 (le soja est le plus neutre en cuisine salée)", 'Équivalent babeurre : lait végétal + 1 c. à s. de jus de citron pour 25 cl'] },
  { name: 'beurre', re: /\bbeurre\b/, skip: true, alt: ['Margarine végétale, 1 pour 1', "Huile d'olive ou neutre : environ 3/4 de la quantité (cuisine salée, certains gâteaux)", "Purée d'amande pour les biscuits et gâteaux"] },
  { name: 'crème', re: /\bcreme\b/, skip: true, alt: ['Crème de soja ou d\'avoine à cuisiner, 1 pour 1', 'Crème de coco (goût marqué), bien refroidie pour la monter'] },
  { name: 'yaourt', re: /\byaourts?\b|\byogourts?\b/, skip: true, alt: ['Yaourt de soja ou de coco, 1 pour 1'] },
  { name: 'fromage', re: /\b(fromage|parmesan|gruyere|emmental|comte|cheddar|raclette)\b/, skip: true, alt: ['Levure maltée (+ noix de cajou mixées) pour un goût de parmesan', 'Fromage végétal du commerce (la fonte varie selon les marques)'] },
  { name: 'mozzarella, chèvre, feta', re: /\b(mozzarella|chevre|feta|ricotta|fromage blanc)\b/, skip: true, alt: ['Tofu ferme mariné (citron, huile, sel) émietté : effet feta', 'Tofu soyeux ou yaourt de soja égoutté pour la ricotta et le fromage blanc'] },
  { name: 'miel', re: /\bmiel\b/, alt: ["Sirop d'érable ou d'agave, 1 pour 1"] },
  { name: 'viande hachée', re: /\b(viande hachee|boeuf hache|boeuf|porc|veau|agneau)\b/, alt: ['Lentilles cuites, protéines de soja texturées réhydratées ou seitan haché'] },
  { name: 'volaille, charcuterie', re: /\b(poulet|dinde|jambon|lardons?|bacon|saucisse|chorizo)\b/, alt: ['Seitan, tofu ferme ou tempeh', 'Tofu ou tempeh fumé (+ paprika fumé) pour lardons, jambon et bacon'] },
  { name: 'poisson', re: /\b(poisson|saumon|thon|cabillaud|crevettes?|anchois)\b/, alt: ['Pois chiches écrasés + algue nori (effet thon)', 'Tofu mariné (citron, algue, huile)'] },
  { name: 'gélatine', re: /\bgelatine\b/, alt: ["Agar-agar (suivre la dose du sachet : il gélifie plus fort et doit bouillir)"] },
  { name: 'mayonnaise', re: /\bmayonnaise\b/, alt: ["Mayonnaise végétale du commerce, ou maison à l'aquafaba"] },
  { name: 'lait concentré', re: /\blait concentre\b/, alt: ['Lait de coco épais réduit avec du sucre'] },
  { name: 'bouillon animal', re: /\bbouillon de (poule|boeuf|volaille|viande)\b/, alt: ['Bouillon de légumes'] },
  { name: 'sauce poisson', re: /\b(nuoc.?mam|worcestershire|sauce (de )?poisson)\b/, alt: ['Sauce soja + un trait de jus de citron vert'] },
];
function findSubst(name) {
  const n = norm(name);
  const hit = SUBS.find(s => s.re.test(n) && !(s.skip && VEGAN_OK.test(n)));
  return hit || null;
}

// ---------- valeurs nutritionnelles (estimation pour 100 g : kcal, protéines, glucides, lipides, fibres, fer mg) ----------
const IGNORE = /^(sel|poivre|eau|epice|curcuma|cumin|piment|noix de muscade|muscade|levure chimique|kala namak|sel noir|herbe|persil|ciboulette|vinaigre|sauce soja)/;
const NUTR = [
  { re: /farine.*pois chiche/, k: [387, 22, 58, 7, 11, 4.9], d: .6 },
  { re: /^farine/, k: [364, 10, 76, 1, 2.7, 1.2], d: .55 },
  { re: /pois chiche/, k: [164, 8.9, 27, 2.6, 7.6, 2.9], w: { boite: 240 } },
  { re: /lentille/, k: [358, 24, 60, 1.5, 11, 7.5] },
  { re: /haricot/, k: [127, 8.7, 23, .5, 7.4, 2.9], w: { boite: 240 } },
  { re: /^mais/, k: [86, 3.2, 19, 1.2, 2, .5], w: { boite: 140 } },
  { re: /pomme de terre/, k: [77, 2, 17, .1, 2.2, .8], piece: 150 },
  { re: /carotte/, k: [41, .9, 10, .2, 2.8, .3], piece: 80 },
  { re: /oignon nouveau/, k: [32, 1.8, 7, .2, 2.6, 1], piece: 30 },
  { re: /oignon/, k: [40, 1.1, 9, .1, 1.7, .2], piece: 110 },
  { re: /^ail\b/, k: [149, 6.4, 33, .5, 2.1, 1.7], w: { gousse: 4 } },
  { re: /concentre de tomate/, k: [82, 4.3, 19, .5, 4.1, 3] },
  { re: /tomate.*cerise/, k: [18, .9, 3.9, .2, 1.2, .3], piece: 15 },
  { re: /tomate/, k: [21, 1.2, 3.5, .2, 1.2, .5], piece: 120 },
  { re: /^huile/, k: [884, 0, 0, 100, 0, .6], d: .92 },
  { re: /margarine/, k: [717, .2, .4, 80, 0, 0], d: .95 },
  { re: /creme de coco/, k: [330, 3.6, 6, 34, 2.2, 3.3] },
  { re: /lait de coco/, k: [197, 2, 3, 21, 0, 1.6] },
  { re: /lait de soja/, k: [33, 3.3, 1.2, 1.8, .4, .4] },
  { re: /tofu soyeux/, k: [55, 5, 2, 3, .2, 1.4] },
  { re: /tofu/, k: [144, 17, 3, 9, 2, 2.7] },
  { re: /^pate$/, k: [359, 12.5, 73, 1.5, 3.2, 1.3] },
  { re: /basilic/, k: [23, 3.2, 2.7, .6, 1.6, 3.2], w: { bouquet: 30 } },
  { re: /pignon/, k: [673, 14, 13, 68, 3.7, 5.5] },
  { re: /cajou/, k: [553, 18, 30, 44, 3.3, 6.7] },
  { re: /^noix$/, k: [654, 15, 14, 65, 6.7, 2.9] },
  { re: /puree.*amande/, k: [614, 21, 19, 55, 10, 3.7] },
  { re: /levure maltee/, k: [350, 50, 30, 5, 20, 4] },
  { re: /epinard/, k: [23, 2.9, 3.6, .4, 2.2, 2.7] },
  { re: /gingembre/, k: [80, 1.8, 18, .8, 2, .6] },
  { re: /poivron/, k: [31, 1, 6, .3, 2.1, .4], piece: 160 },
  { re: /chocolat/, k: [580, 7.8, 38, 42, 11, 12] },
  { re: /banane/, k: [89, 1.1, 23, .3, 2.6, .3], piece: 100 },
  { re: /^sucre/, k: [400, 0, 100, 0, 0, 0], d: .85 },
  { re: /sirop/, k: [260, 0, 67, 0, 0, .1], d: 1.3 },
  { re: /flocon.*avoine/, k: [372, 13, 59, 7, 10, 4.3] },
  { re: /poireau/, k: [31, 1.5, 7, .3, 1.8, 2.1], piece: 120 },
  { re: /potimarron/, k: [45, 1, 10, .1, 2.5, .8], piece: 1000 },
  { re: /citron/, k: [22, .4, 6.9, .2, .3, .1], piece: 40 },
  { re: /tahini/, k: [595, 17, 21, 54, 9, 8.9] },
  { re: /aquafaba/, k: [12, .8, 1, .1, 0, .1] },
  { re: /fecule/, k: [381, .3, 91, .1, .9, .5], d: .6 },
  { re: /moutarde/, k: [66, 4, 6, 4, 3, 1.5] },
  { re: /bouillon/, k: [5, .2, .9, .1, 0, .1] },
];
function gramsOf(i, e) {
  const q = i.q || 0; if (!q) return null; const u = normUnit(singular(i.u || '')), d = e.d || 1;
  if (u === 'g') return q; if (u === 'kg') return q * 1000; if (u === 'mg') return q / 1000;
  if (u === 'ml') return q * d; if (u === 'cl') return q * 10 * d; if (u === 'dl') return q * 100 * d; if (u === 'l') return q * 1000 * d;
  if (u === 'c. a s.') return q * 15 * d; if (u === 'c. a c.') return q * 5 * d;
  if (u === '' && e.piece) return q * e.piece; if (e.w && e.w[u]) return q * e.w[u];
  return null;
}
function nutrition(r, byId) { // estimation par portion ; coverage = part des ingrédients reconnus
  const t = [0, 0, 0, 0, 0, 0]; let covered = 0, total = 0;
  for (const i of expandIngredients(r, 1, byId || (() => null))) {
    const key = keyName(i.n); if (IGNORE.test(key)) continue; total++;
    const e = NUTR.find(x => x.re.test(key)), g = e && gramsOf(i, e);
    if (g) { covered++; e.k.forEach((v, j) => { t[j] += v * g / 100; }); }
  }
  const s = r.servings || 1, rd = (v, p = 0) => Math.round(v / s * 10 ** p) / 10 ** p;
  return { kcal: rd(t[0]), protein: rd(t[1], 1), carbs: rd(t[2], 1), fat: rd(t[3], 1), fiber: rd(t[4], 1), iron: rd(t[5], 1), covered, total, coverage: total ? covered / total : 0 };
}

// ---------- saisons ----------
const SEASONS = ['Printemps', 'Été', 'Automne', 'Hiver'];
const seasonOf = d => { const m = (d instanceof Date ? d : new Date(d)).getMonth(); return m >= 2 && m <= 4 ? 'Printemps' : m >= 5 && m <= 7 ? 'Été' : m >= 8 && m <= 10 ? 'Automne' : 'Hiver'; };
const inSeason = (r, season) => (r.seasons || []).includes(season) || (r.seasons || []).includes("Toute l'année");

// ---------- moule : rapport de surface ----------
function panArea(p) {
  if (!p) return 0;
  if (p.shape === 'round') return Math.PI * (p.a / 2) ** 2;
  if (p.shape === 'square') return p.a * p.a;
  if (p.shape === 'rect') return p.a * p.b;
  return 0;
}
const panRatio = (from, to) => { const a = panArea(from), b = panArea(to); return a > 0 && b > 0 ? b / a : 1; };

// ---------- menu de la semaine ----------
// o: { recipes, plan, days:[{key,weekday(0=lundi)}], slots:['midi'|'soir'], stats:{id:{last,avg}}, favs:Set, season, maxWeek, dessert, today, rng }
function suggestWeek(o) {
  const rng = o.rng || Math.random, today = o.today || Date.now(), out = {}, use = new Map();
  Object.values(o.plan || {}).forEach(v => [].concat(v).forEach(id => use.set(id, (use.get(id) || 0) + 1)));
  const times = id => use.get(id) || 0;
  const active = r => (r.prep || 0) + (r.cook || 0);
  const score = r => {
    const st = o.stats[r.id]; let s = 1;
    if (st && st.avg) s += (st.avg - 3) * .3;
    s += (st ? Math.min(60, Math.floor((today - new Date(st.last + 'T12:00').getTime()) / 864e5)) : 60) / 60;
    if (inSeason(r, o.season)) s += .5; if (o.favs && o.favs.has(r.id)) s += .4;
    return s + rng() * .8;
  };
  // d'abord les recettes pas encore au menu ; si on en manque, les moins utilisées (jamais de trou)
  const pick = (type, ok) => { const all = o.recipes.filter(r => r.type === type), min = Math.min(...all.map(r => times(r.id))), c = all.filter(r => times(r.id) === min); const good = c.filter(ok); const pool = good.length ? good : c; return pool.map(r => [score(r), r]).sort((a, b) => b[0] - a[0])[0]?.[1]; };
  for (const d of o.days) for (const slot of o.slots) {
    const key = d.key + '_' + slot; if ([].concat((o.plan || {})[key] || []).length) continue;
    const main = pick('Plat', r => d.weekday >= 5 || active(r) <= (o.maxWeek || 45)); if (!main) continue;
    use.set(main.id, times(main.id) + 1); out[key] = [main.id];
    if (o.dessert && d.weekday === 6 && slot === o.slots[o.slots.length - 1]) { const ds = pick('Dessert', () => true); if (ds) { use.set(ds.id, times(ds.id) + 1); out[key].push(ds.id); } }
  }
  return out;
}

// ---------- commandes vocales du mode cuisine ----------
function voiceCommand(text) {
  const t = norm(text);
  if (/\b(termine|fini|fini|c'est fait)\b/.test(t)) return 'finish';
  if (/\b(quitte|quitter|ferme|fermer)\b/.test(t)) return 'quit';
  if (/\b(precedent|precedente|retour|reviens|arriere)\b/.test(t)) return 'prev';
  if (/\b(repete|repeter|relis|relire|redis|lis|lire)\b/.test(t)) return 'repeat';
  if (/\b(minuteur|chrono|timer)\b/.test(t)) return 'timer';
  if (/\bingredients?\b/.test(t)) return 'ingredients';
  if (/\b(suivant|suivante|suite|prochain|prochaine|apres)\b/.test(t)) return 'next';
  return null;
}

return { voiceCommand, norm, fmtQty, keyName, UNITS, normUnit, singular, plural, shopPart, itemQty, parseIng, ingLine, parseStep, stepLine, expandIngredients,
  lev, fuzzyHas, words, findSubst, SUBS, nutrition, NUTR, SEASONS, seasonOf, inSeason, panArea, panRatio, suggestWeek };
});
