// Import de recette : JSON-LD (gratuit) -> Claude (complément) -> repli texte brut ; photo -> Claude vision.
'use strict';
const dns = require('node:dns/promises'), net = require('node:net');
const TYPES = ['Plat', 'Entrée', 'Dessert', 'Petit-déjeuner', 'Boisson', 'Base'];
const DIETS = ['Vegan', 'Végétarien', 'Sans gluten', 'Sans soja', 'Sans fruits à coque'];
const METHODS = ['Four', 'Poêle', 'Casserole', 'Vapeur', 'Friture', 'Barbecue', 'Mijoteuse', 'Sans cuisson'];
const MODEL_TEXT = process.env.CLAUDE_MODEL_TEXT || 'claude-haiku-5-5';
const MODEL_VISION = process.env.CLAUDE_MODEL_VISION || 'claude-sonnet-5-5';

const RECIPE_TOOL = {
  name: 'enregistrer_recette',
  description: "Enregistre la recette extraite, strictement dans ce format. N'invente rien : omets temp/timer si absents du texte.",
  input_schema: { type: 'object', required: ['title', 'type', 'difficulty', 'servings', 'ingredients', 'steps'], properties: {
    title: { type: 'string' }, type: { type: 'string', enum: TYPES },
    diets: { type: 'array', items: { type: 'string', enum: DIETS } },
    difficulty: { type: 'integer', enum: [1, 2, 3], description: '1 facile, 2 moyen, 3 difficile' },
    prep: { type: 'integer', description: 'minutes de préparation active' }, cook: { type: 'integer', description: 'minutes de cuisson' }, rest: { type: 'integer', description: 'minutes de repos / réfrigération' },
    servings: { type: 'integer' }, method: { type: 'array', items: { type: 'string', enum: METHODS } }, tags: { type: 'array', items: { type: 'string' } },
    ingredients: { type: 'array', items: { type: 'object', required: ['n'], properties: { q: { type: 'number', description: 'quantité numérique, 0 si non précisée' }, u: { type: 'string', description: "unité : g, cl, c. à s., pincée… ('' si aucune)" }, n: { type: 'string', description: "nom, précédé de 'de/d'' si naturel" } } } },
    steps: { type: 'array', items: { type: 'object', required: ['t'], properties: { t: { type: 'string' }, temp: { type: 'integer', description: '°C' }, timer: { type: 'integer', description: 'minutes (cuisson ou repos de CETTE étape)' }, kind: { type: 'string', enum: ['cuisson', 'repos'] } } } } } }
};
const SYSTEM = "Tu convertis des recettes (web ou photo) vers un schéma strict, en français. Reste fidèle à la source : ne devine ni quantité ni température. Découpe en étapes courtes, place temp et timer sur l'étape concernée.";

async function callClaude({ model, content }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY manquante'), { code: 'NO_KEY' });
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4096, system: SYSTEM, tools: [RECIPE_TOOL], tool_choice: { type: 'tool', name: RECIPE_TOOL.name }, messages: [{ role: 'user', content }] }) });
  if (!r.ok) throw new Error('Claude API ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const block = (await r.json()).content.find(b => b.type === 'tool_use');
  if (!block) throw new Error('Réponse sans recette');
  return block.input;
}

// ---- 1. JSON-LD ----
const iso = d => { const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i.exec(d || ''); return m ? (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
const txt = s => String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
function findRecipeNode(x) {
  if (!x || typeof x !== 'object') return null;
  if (Array.isArray(x)) { for (const i of x) { const r = findRecipeNode(i); if (r) return r; } return null; }
  const t = [].concat(x['@type'] || []);
  if (t.includes('Recipe')) return x;
  return findRecipeNode(x['@graph']);
}
function extractJsonLd(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html))) { try { const n = findRecipeNode(JSON.parse(m[1].trim())); if (n) return n; } catch {} }
  return null;
}
function flattenSteps(ins) {
  return [].concat(ins || []).flatMap(i => typeof i === 'string' ? txt(i).split(/\n+/) : i.itemListElement ? flattenSteps(i.itemListElement) : [txt(i.text || i.name || '')]).filter(Boolean);
}
function fromJsonLd(n) {
  const img = [].concat(n.image || [])[0];
  return { title: txt(n.name || ''), prep: iso(n.prepTime), cook: iso(n.cookTime), rest: 0, servings: parseInt([].concat(n.recipeYield || 4)[0]) || 4,
    ingredientsRaw: [].concat(n.recipeIngredient || []).map(txt), stepsRaw: flattenSteps(n.recipeInstructions),
    image: typeof img === 'string' ? img : img && img.url, category: [].concat(n.recipeCategory || []).join(', '), diet: [].concat(n.suitableForDiet || []).join(' ') };
}

// ---- normalisation / validation (jamais confiance aveugle au modèle) ----
const int = (v, lo, hi, d = 0) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
function normalize(r) {
  const out = { title: String(r.title || '').trim().slice(0, 140), type: TYPES.includes(r.type) ? r.type : 'Plat',
    diets: (r.diets || []).filter(d => DIETS.includes(d)), difficulty: int(r.difficulty, 1, 3, 1),
    prep: int(r.prep, 0, 1440), cook: int(r.cook, 0, 1440), rest: int(r.rest, 0, 10080), servings: int(r.servings, 1, 100, 4),
    method: (r.method || []).filter(m => METHODS.includes(m)), tags: (r.tags || []).map(String).slice(0, 8),
    ingredients: (r.ingredients || []).filter(i => i && i.n).map(i => ({ q: Math.max(0, Number(i.q) || 0), u: String(i.u || ''), n: String(i.n) })).slice(0, 80),
    steps: (r.steps || []).filter(s => s && s.t).map(s => { const o = { t: String(s.t) }; const tp = Number(s.temp) > 0 && Number(s.temp) <= 350 ? Math.round(s.temp) : 0, tm = int(s.timer, 0, 10080, 0); if (tp) o.temp = tp; if (tm) { o.timer = tm; o.kind = s.kind === 'repos' ? 'repos' : 'cuisson'; } return o; }).slice(0, 60) };
  if (!out.title || !out.ingredients.length || !out.steps.length) throw new Error('Extraction incomplète (titre, ingrédients ou étapes manquants)');
  return out;
}

// ---- SSRF : refuse les adresses privées ----
const isPrivate = ip => net.isIPv4(ip) ? /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(ip) : /^(::1|fc|fd|fe80)/i.test(ip);
async function fetchPage(url) {
  const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw new Error('URL non supportée');
  for (const a of await dns.lookup(u.hostname, { all: true })) if (isPrivate(a.address)) throw new Error('Adresse interdite');
  const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'RecettesImporter/0.1', accept: 'text/html' } });
  if (!r.ok) throw new Error('Page inaccessible (' + r.status + ')');
  return (await r.text()).slice(0, 2_000_000);
}
const pageText = html => txt(html.replace(/<(script|style|nav|footer|header|svg)[\s\S]*?<\/\1>/gi, ' ')).slice(0, 30000);

async function importUrl(url, { html } = {}) {
  html = html || await fetchPage(url);
  const node = extractJsonLd(html);
  let recipe, via;
  if (node) {
    const j = fromJsonLd(node);
    if (process.env.ANTHROPIC_API_KEY) { // Haiku structure le texte libre déjà propre
      recipe = await callClaude({ model: MODEL_TEXT, content: `Données JSON-LD d'une recette :\n${JSON.stringify(j)}\n\nStructure-les.` }); via = 'jsonld+claude';
    } else { // sans clé : parseur d'ingrédients minimal
      recipe = { title: j.title, type: 'Plat', difficulty: 1, prep: j.prep, cook: j.cook, servings: j.servings, ingredients: j.ingredientsRaw.map(parseIngredient), steps: j.stepsRaw.map(t => ({ t })) }; via = 'jsonld';
    }
    var image = j.image;
  } else {
    recipe = await callClaude({ model: MODEL_TEXT, content: `Texte brut d'une page web contenant une recette :\n${pageText(html)}` }); via = 'page+claude';
  }
  return { recipe: normalize(recipe), via, source_url: url, image };
}
function parseIngredient(s) { // repli sans IA
  const m = /^\s*([\d.,/]+)\s*(g|kg|cl|ml|l|c\.? ?à ?[sc]\.?|cuill[^ ]*|pincées?|gousses?|boîtes?)?\s*(?:d['e ]\s*|de |du |des )?(.*)$/i.exec(s);
  if (!m) return { q: 0, u: '', n: s };
  let q = m[1].includes('/') ? m[1].split('/').reduce((a, b) => a / b) : parseFloat(m[1].replace(',', '.'));
  return { q: q || 0, u: m[2] || '', n: m[3] || s };
}
async function importPhoto(base64, mediaType) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) throw new Error('Format image non supporté');
  const recipe = await callClaude({ model: MODEL_VISION, content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }, { type: 'text', text: "Transcris et structure la recette de cette photo (imprimée ou manuscrite). Ne complète pas ce qui est illisible." }] });
  return { recipe: normalize(recipe), via: 'photo+claude' };
}
module.exports = { importUrl, importPhoto, extractJsonLd, fromJsonLd, normalize, parseIngredient };
