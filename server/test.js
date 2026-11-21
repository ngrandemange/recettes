const assert = require('node:assert'); const { importUrl, parseIngredient, normalize } = require('./import');
delete process.env.ANTHROPIC_API_KEY;
const html = `<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":"Recipe","name":"Tarte &amp; test","prepTime":"PT20M","cookTime":"PT1H10M","recipeYield":["6","6 parts"],"recipeIngredient":["200 g de farine","2 c. à s. d'huile","1/2 citron","sel"],"recipeInstructions":[{"@type":"HowToSection","itemListElement":[{"@type":"HowToStep","text":"Mélanger."}]},{"@type":"HowToStep","text":"Cuire 30 min à 180°C."}],"image":{"url":"https://x/y.jpg"}}]}</script></html>`;
(async () => {
  const r = await importUrl('https://example.test/r', { html });
  assert.equal(r.via, 'jsonld'); assert.equal(r.recipe.prep, 20); assert.equal(r.recipe.cook, 70); assert.equal(r.recipe.servings, 6);
  assert.deepEqual(r.recipe.ingredients[0], { q: 200, u: 'g', n: 'farine' }); assert.equal(r.recipe.ingredients[2].q, .5); assert.equal(r.recipe.steps.length, 2);
  assert.throws(() => normalize({ title: 'x', ingredients: [], steps: [] }));
  assert.deepEqual(normalize({ title: 't', difficulty: 9, ingredients: [{ n: 'a' }], steps: [{ t: 's', temp: 9999, timer: 5, kind: 'zz' }] }).steps[0], { t: 's', timer: 5, kind: 'cuisson' });
  const { canonicalUrl, isPrivate } = require('./import');
  assert.equal(canonicalUrl('https://www.Exemple.fr/recette/?utm_source=x&b=2&a=1&fbclid=z#haut'), 'https://exemple.fr/recette?a=1&b=2');
  assert.equal(canonicalUrl('https://exemple.fr/'), 'https://exemple.fr/'); assert.equal(canonicalUrl('ftp://x'), null); assert.equal(canonicalUrl('pas une url'), null);
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.ok(isPrivate(ip), ip + ' doit être refusée');
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1']) assert.ok(!isPrivate(ip), ip + ' est publique');
  // analyseur sans clé API : unités longues, pas de « g » arraché à « gousses »
  const { parseIngredient: pI, fromJsonLd: fJ } = require('./import');
  assert.deepEqual(pI("3 gousses d'ail"), { q: 3, u: 'gousses', n: 'ail' }); assert.deepEqual(pI('1 gros oignon'), { q: 1, u: '', n: 'gros oignon' });
  assert.deepEqual(pI('2 litres de lait'), { q: 2, u: 'litres', n: 'lait' }); assert.deepEqual(pI('1 grosse courgette'), { q: 1, u: '', n: 'grosse courgette' }); assert.deepEqual(pI('200 g de farine'), { q: 200, u: 'g', n: 'farine' });
  // instructions en une seule chaîne : une étape par ligne
  assert.equal(fJ({ recipeInstructions: 'Etape un.\nEtape deux.\nEtape trois.' }).stepsRaw.length, 3);
  assert.deepEqual(fJ({ recipeInstructions: [{ '@type': 'HowToStep', text: 'A.<br>B.' }] }).stepsRaw, ['A.', 'B.']);
  // adresses mappées et plages spéciales
  for (const ip of ['::ffff:7f00:1', '::ffff:a00:1', '[::1]', '198.18.0.1', '224.0.0.1', '192.0.0.8', '::', '64:ff9b::7f00:1', 'pas-une-ip']) assert.ok(isPrivate(ip), ip + ' doit être refusée');
  for (const ip of ['::ffff:808:808', '2606:4700::1111']) assert.ok(!isPrivate(ip), ip + ' est publique');
  console.log('tests OK');
})();
