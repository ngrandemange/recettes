# Mes Recettes — maquette

Ouvrir `app/index.html` (ou `cd app && python3 -m http.server`).
`app/devices.html` : aperçu bureau / iPad / iPhone, portrait et paysage, 3 thèmes.
Données d'exemple : `app/data.js`. Aucune dépendance, tout est stocké en localStorage.

## Serveur + import (prototype)
`cd server && ANTHROPIC_API_KEY=… node server.js` → http://localhost:3000 (Node ≥ 22.13, SQLite intégré).
- `POST /api/import/url {url}` : JSON-LD schema.org → Claude (Haiku) pour structurer → repli texte brut.
- `POST /api/import/photo {data(base64), mediaType}` : Claude vision (Sonnet) lit la photo directement.
- Sans clé : import JSON-LD seul (parseur d'ingrédients basique) ; photo indisponible.
- Modèles réglables : `CLAUDE_MODEL_TEXT`, `CLAUDE_MODEL_VISION`. Tests : `node --no-warnings server/test.js`.
- L'import pré-remplit le formulaire : toujours relire avant d'enregistrer.

## Mode serveur / mode local
L'interface détecte `/api/recipes` au démarrage : si le serveur répond, recettes en base SQLite (seed automatique depuis `app/data.js`), favoris/photos/courses/planning en table `kv`. Sinon (page statique), tout reste en `localStorage`.
Nouveautés : liste de courses fusionnée par rayon (depuis une fiche ou le planning), planning de semaine midi/soir, suppression de recettes.

## Menus multi-plats, mode cuisine, hébergement
- Planning : plusieurs plats par repas (entrée + plat + dessert…).
- Mode cuisine (fiche → « 👩‍🍳 Mode cuisine ») : une étape par écran, swipe ou flèches, minuteur en un geste, ingrédients de l'étape, écran maintenu allumé (Wake Lock).
- Hébergement : voir `DEPLOY.md` (Dockerfile + fly.toml, mot de passe `APP_PASSWORD`, limite d'imports).
