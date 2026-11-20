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

## Sauvegarde, PWA, modification
- Bouton « ✏️ Modifier » sur chaque fiche ; « 💾 Sauvegarde & export » en bas de la liste (export/restauration JSON).
- PWA : `manifest.webmanifest`, `sw.js` (réseau d'abord, cache hors-ligne), icônes ; active seulement en mode serveur.
- `./deploy.sh <nom>` : déploiement Fly.io guidé (voir `DEPLOY.md`).

## Photos en base, minuteurs persistants, courses
- Photos : BLOB dans la table `photos` (une par recette, 8 Mo max, JPEG/PNG/WebP vérifiés par signature), servies par `/api/recipes/:id/photo?v=…` (cache navigateur, hors-ligne via le service worker). Les anciennes photos stockées en texte sont migrées au démarrage du serveur.
- Minuteurs : enregistrés avec leur heure de fin, repris à la réouverture de l'app.
- Courses : fusion des unités (g/kg, ml/cl/l, c. à c./c. à s.) et des pluriels (gousse/gousses).
- Tests : `npm test` (import + API avec un vrai serveur sur base temporaire).
