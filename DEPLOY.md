# Déploiement sur NAS (Docker)

```bash
cp .env.example .env     # puis éditer : APP_PASSWORD (obligatoire), ANTHROPIC_API_KEY (optionnel)
docker compose up -d --build
```
- Données : `./data/recettes.db` + `./data/backups/` (copie quotidienne, 7 jours). Sauvegardez ce dossier avec vos tâches NAS habituelles.
- Santé : `GET /healthz` (sans mot de passe). Image multi-architecture (Node 22), OK sur x86 comme ARM.
- Le port 8080 (variable `HOST_PORT`) est à publier **derrière un reverse proxy HTTPS**.

## HTTPS : indispensable pour l'iPhone
Sur `http://` (hors localhost), Safari refuse le service worker et le Wake Lock : plus d'installation en app, plus de mode hors-ligne, et l'écran peut se verrouiller en mode cuisine. Le mot de passe (HTTP Basic) y circulerait aussi en clair.
Options courantes : le reverse proxy intégré du NAS (Synology / QNAP) avec certificat Let's Encrypt, Caddy ou Traefik, ou **Tailscale** (`tailscale serve --bg 8080` donne un HTTPS privé sans ouvrir de port sur Internet — le plus simple pour une app perso).
Si le proxy est devant, il doit transmettre `X-Forwarded-For` (déjà pris en compte pour la limite d'imports).

---
# Alternative : Fly.io

## Méthode rapide
Prérequis : un compte Fly.io et `flyctl` installé (`brew install flyctl`).
```bash
./deploy.sh <nom-unique>      # crée l'app et le volume, demande mot de passe et clé API (masqués), déploie
```
Le script n'a pas pu être exécuté ici (pas de compte Fly) : en cas d'erreur de syntaxe `fly`, la méthode manuelle ci-dessous fait foi.

## Méthode manuelle

```bash
fly launch --no-deploy --copy-config --name <votre-nom-unique>   # reprend fly.toml
fly volumes create recettes_data --size 1 --region cdg
fly secrets set APP_PASSWORD='<mot de passe long>' ANTHROPIC_API_KEY='sk-ant-…'
fly deploy
```
Ouvrir `https://<votre-nom>.fly.dev` sur l'iPhone : Safari demande le mot de passe (identifiant : n'importe lequel).
Ajouter à l'écran d'accueil : Partager → « Sur l'écran d'accueil ».

- **Sauvegardes** : copie quotidienne automatique dans `/data/backups` (7 jours), snapshots Fly quotidiens du volume, et bouton « 💾 Sauvegarde & export » dans l'app (fichier JSON, à garder de temps en temps sur votre téléphone ou ordinateur).
- **iPhone** : l'app s'installe comme une vraie app (PWA) ; recettes, courses et planning restent lisibles hors-ligne, et les modifications de la liste de courses faites hors-ligne sont renvoyées au retour du réseau.
- **Coûts API** : l'import est limité à 30/heure/IP (`IMPORTS_PER_HOUR`). Fixez aussi une limite de dépense dans la console Anthropic.
- **Une seule machine** : SQLite sur volume = ne pas passer à plusieurs instances (passer à PostgreSQL le moment venu).
- Alternatives : le `Dockerfile` convient aussi à Render, Railway ou un VPS (monter un disque sur `/data`).
- Sans `APP_PASSWORD`, l'accès est public : à ne jamais faire avec une clé API configurée.
