// Tests de la logique pure (app/lib.js).
const assert = require('node:assert'), L = require('../app/lib.js'), RECIPES = (() => { const sb = { window: {} }; require('node:vm').runInNewContext(require('node:fs').readFileSync(__dirname + '/../app/data.js', 'utf8'), sb); return sb.window.RECIPES; })();
const byId = id => RECIPES.find(r => r.id === id);
// norm / quantités / courses
assert.equal(L.norm('Œufs Épinards'), 'oeufs epinards'); assert.equal(L.fmtQty(1.5), '1,5'); assert.equal(L.fmtQty(139.5), '140'); assert.equal(L.fmtQty(7.25), '7,3'); assert.equal(L.fmtQty(0.666), '0,67'); assert.equal(L.fmtQty(0), ''); assert.equal(L.fmtQty(2), '2');
assert.equal(L.keyName("de l'ail"), 'ail'); assert.equal(L.keyName('de tomates'), 'tomate');
const merged = [{ n: 'de farine', u: 'g', q: 500 }, { n: 'farine', u: 'kg', q: 1 }].map(i => L.shopPart(i, 1)); assert.equal(merged[0].key, merged[1].key);
assert.deepEqual(L.itemQty({ fam: 'm', q: 1500 }), ['1,5', 'kg']); assert.deepEqual(L.itemQty({ fam: 'v', q: 550 }), ['55', 'cl']); assert.deepEqual(L.itemQty({ fam: 's', q: 6 }), ['2', 'c. à s.']);
assert.deepEqual(L.itemQty({ u: 'gousse', q: 3 }), ['3', 'gousses']);
// saisie : aller-retour sans perte
for (const r of RECIPES) { for (const i of r.ingredients) { const back = L.parseIng(L.ingLine(i), t => (RECIPES.find(x => L.norm(x.title) === L.norm(t)) || {}).id); assert.deepEqual({ q: back.q, u: back.u, n: back.n }, { q: i.q || 0, u: i.u, n: i.n }, 'ingrédient ' + L.ingLine(i)); }
  for (const s of r.steps) { const b = L.parseStep(L.stepLine(s)); assert.deepEqual(b, s, 'étape ' + s.t); } }
assert.deepEqual(L.parseIng('1/2 citron'), { q: .5, u: '', n: 'citron' }); assert.deepEqual(L.parseIng('2 c. à s. de concentré'), { q: 2, u: 'c. à s.', n: 'de concentré' });
const ref = L.parseIng('1 @Pâte brisée vegan', t => t === 'Pâte brisée vegan' ? 'pate-brisee-vegan' : null); assert.equal(ref.ref, 'pate-brisee-vegan'); assert.equal(ref.q, 1);
assert.deepEqual(L.parseIng('1 @Inconnue', () => null), { q: 1, u: '', n: '@Inconnue'.slice(1) }); 
// recettes de base : expansion, facteur, cycles
const base = { id: 'b', servings: 4, ingredients: [{ q: 200, u: 'g', n: 'farine' }] }, top = { id: 't', ingredients: [{ q: 2, u: '', n: 'base', ref: 'b' }, { q: 1, u: '', n: 'sel' }] };
assert.deepEqual(L.expandIngredients(top, 1, id => id === 'b' ? base : null).map(i => i.q), [400, 1]); assert.deepEqual(L.expandIngredients(top, 2, id => id === 'b' ? base : null).map(i => i.q), [800, 2]);
const A = { id: 'a', ingredients: [{ q: 1, n: 'b', ref: 'b' }] }, B = { id: 'b', ingredients: [{ q: 1, n: 'a', ref: 'a' }, { q: 5, u: 'g', n: 'x' }] };
assert.doesNotThrow(() => L.expandIngredients(A, 1, id => ({ a: A, b: B })[id]), 'cycle sans boucle infinie');
// recherche tolérante
assert.ok(L.fuzzyHas(L.words('Omelette aux pois chiches'), 'chicches')); assert.ok(L.fuzzyHas(L.words('Hachis parmentier'), 'hachi')); assert.ok(L.fuzzyHas(L.words('Houmous maison'), 'humous'));
assert.ok(!L.fuzzyHas(L.words('Houmous maison'), 'chocolat')); assert.ok(!L.fuzzyHas(L.words('Pâtes'), 'ail'));
// substitutions
assert.equal(L.findSubst('œufs').name, 'œuf'); assert.equal(L.findSubst('de lait').name, 'lait'); assert.equal(L.findSubst('de lait de coco'), null); assert.equal(L.findSubst('de lait de soja nature'), null);
assert.equal(L.findSubst('de beurre').name, 'beurre'); assert.equal(L.findSubst('de beurre de cacahuète'), null); assert.equal(L.findSubst('de crème fraîche').name, 'crème'); assert.equal(L.findSubst('de crème de coco'), null);
assert.equal(L.findSubst('de parmesan râpé').name, 'fromage'); assert.equal(L.findSubst('de miel').name, 'miel'); assert.equal(L.findSubst('de farine'), null);
assert.equal(RECIPES.filter(r => r.ingredients.some(i => L.findSubst(i.n))).length, 0, 'aucune recette vegan du jeu de données ne déclenche de substitution');
// nutrition
const om = L.nutrition(byId('omelette-pois-chiches'), byId); assert.ok(om.kcal > 150 && om.kcal < 400, 'omelette kcal ' + om.kcal); assert.ok(om.protein > 8, 'protéines ' + om.protein); assert.ok(om.coverage >= .8, 'couverture ' + om.coverage);
const hp = L.nutrition(byId('hachis-lentilles'), byId); assert.ok(hp.protein > 12 && hp.kcal > 250 && hp.kcal < 700, JSON.stringify(hp));
for (const r of RECIPES) { const n = L.nutrition(r, byId); assert.ok(n.kcal >= 0 && n.kcal < 1500, r.id + ' ' + n.kcal); }
assert.equal(L.nutrition({ servings: 2, ingredients: [{ q: 100, u: 'g', n: 'de farine' }] }).kcal, 182);
// saisons / moule
assert.equal(L.seasonOf(new Date('2026-12-05')), 'Hiver'); assert.equal(L.seasonOf(new Date('2026-04-05')), 'Printemps'); assert.equal(L.seasonOf(new Date('2026-07-14')), 'Été'); assert.equal(L.seasonOf(new Date('2026-10-02')), 'Automne');
assert.ok(L.inSeason({ seasons: ["Toute l'année"] }, 'Hiver')); assert.ok(!L.inSeason({ seasons: ['Été'] }, 'Hiver'));
assert.ok(Math.abs(L.panRatio({ shape: 'round', a: 22 }, { shape: 'round', a: 24 }) - 1.19) < .01); assert.equal(L.panRatio({ shape: 'square', a: 20 }, { shape: 'rect', a: 20, b: 40 }), 2); assert.equal(L.panRatio(null, { shape: 'round', a: 20 }), 1);
// menu de la semaine
const days = Array.from({ length: 7 }, (_, i) => ({ key: '2026-11-' + (16 + i), weekday: i })), rec = RECIPES.map(r => ({ ...r }));
const plan = L.suggestWeek({ recipes: rec, plan: {}, days, slots: ['soir'], stats: {}, favs: new Set(), season: 'Automne', maxWeek: 45, dessert: true, today: Date.parse('2026-11-16'), rng: () => .5 });
const ids = Object.values(plan).flat(), plats = rec.filter(r => r.type === 'Plat').length; assert.equal(Object.keys(plan).length, 7, 'la semaine est complète, sans trou');
const mains = Object.values(plan).map(v => v[0]); assert.equal(new Set(mains).size, Math.min(7, plats), 'pas de doublon tant qu\'il reste des recettes inutilisées');
for (const [k, v] of Object.entries(plan)) { const d = days.find(x => k.startsWith(x.key)); const r = rec.find(x => x.id === v[0]); if (d.weekday < 5 && rec.filter(x => x.type === 'Plat' && x.prep + x.cook <= 45).length >= 5) assert.ok(r.prep + r.cook <= 45, 'semaine rapide: ' + r.title); }
assert.ok(plan['2026-11-22_soir'].length === 2 && rec.find(x => x.id === plan['2026-11-22_soir'][1]).type === 'Dessert', 'dessert le dimanche');
const kept = L.suggestWeek({ recipes: rec, plan: { '2026-11-16_soir': ['hachis-lentilles'] }, days, slots: ['soir'], stats: {}, favs: new Set(), season: 'Automne', today: Date.now(), rng: Math.random });
assert.ok(!('2026-11-16_soir' in kept) && !Object.values(kept).flat().includes('hachis-lentilles'), 'ne touche pas au planning existant');
const rated = L.suggestWeek({ recipes: rec, plan: {}, days: days.slice(0, 1), slots: ['soir'], stats: { 'chili-sin-carne': { last: '2026-01-01', avg: 5 } }, favs: new Set(['chili-sin-carne']), season: 'Hiver', maxWeek: 99, today: Date.parse('2026-11-16'), rng: () => 0 });
assert.equal(Object.values(rated)[0][0], 'chili-sin-carne', 'préfère le mieux noté, de saison et favori');
for (const [say, cmd] of [['Suivant', 'next'], ['étape suivante', 'next'], ['passe à la suite', 'next'], ['précédent', 'prev'], ['retour', 'prev'], ['répète', 'repeat'], ['relis-moi l\'étape', 'repeat'], ['lance le minuteur', 'timer'], ['les ingrédients', 'ingredients'], ['quitter', 'quit'], ['j\'ai terminé', 'finish'], ['bonjour', null], ['', null]]) assert.equal(L.voiceCommand(say), cmd, `« ${say} » -> ${cmd}`);
assert.deepEqual(L.parseStep('Cuire | °C | 0 min'), { t: 'Cuire' }, 'valeurs vides ignorées');
console.log('tests lib OK');
