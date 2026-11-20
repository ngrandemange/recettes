const assert = require('node:assert'); const { importUrl, parseIngredient, normalize } = require('./import');
delete process.env.ANTHROPIC_API_KEY;
const html = `<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":"Recipe","name":"Tarte &amp; test","prepTime":"PT20M","cookTime":"PT1H10M","recipeYield":["6","6 parts"],"recipeIngredient":["200 g de farine","2 c. à s. d'huile","1/2 citron","sel"],"recipeInstructions":[{"@type":"HowToSection","itemListElement":[{"@type":"HowToStep","text":"Mélanger."}]},{"@type":"HowToStep","text":"Cuire 30 min à 180°C."}],"image":{"url":"https://x/y.jpg"}}]}</script></html>`;
(async () => {
  const r = await importUrl('https://example.test/r', { html });
  assert.equal(r.via, 'jsonld'); assert.equal(r.recipe.prep, 20); assert.equal(r.recipe.cook, 70); assert.equal(r.recipe.servings, 6);
  assert.deepEqual(r.recipe.ingredients[0], { q: 200, u: 'g', n: 'farine' }); assert.equal(r.recipe.ingredients[2].q, .5); assert.equal(r.recipe.steps.length, 2);
  assert.throws(() => normalize({ title: 'x', ingredients: [], steps: [] }));
  assert.deepEqual(normalize({ title: 't', difficulty: 9, ingredients: [{ n: 'a' }], steps: [{ t: 's', temp: 9999, timer: 5, kind: 'zz' }] }).steps[0], { t: 's', timer: 5, kind: 'cuisson' });
  console.log('tests OK');
})();
