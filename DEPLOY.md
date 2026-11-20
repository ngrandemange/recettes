# Mode retenu : réseau local uniquement (aucune exposition Internet)

Accès : `http://<ip-du-nas>:8090` depuis l'iPhone ou le portable, en Wi-Fi maison. Pas de certificat, pas de proxy, pas de service externe.

**Vérifications à faire une fois**
- **Box/routeur** : aucune redirection de port vers le NAS (ni 8090, ni 80/443) ; UPnP désactivé sur la box et dans DSM (*Panneau de configuration → Accès externe → Configuration du routeur*).
- **Pare-feu DSM** (*Sécurité → Pare-feu*) : autoriser le port 8090 uniquement depuis votre sous-réseau local (ex. `192.168.1.0/24`), refuser le reste. Seconde barrière si une redirection était ajoutée par erreur.
- **Test** : depuis l'iPhone en 4G/5G (Wi-Fi coupé), `http://<votre-ip-publique>:8090` ne doit pas répondre.
- **Gardez `APP_PASSWORD`** : il protège contre un appareil invité sur le Wi-Fi. En clair sur le réseau local, c'est un risque accepté.
- **Adresse stable** : réservation DHCP du NAS dans la box, ou `http://<nom-du-nas>.local:8090` (Bonjour activé dans *Services de fichiers → Avancé*).

**HTTPS** : fourni devant l'app par nas-deploy (autorité privée locale, à mettre en place dans cet outil). L'app reste en HTTP simple derrière lui ; ce qu'elle attend de l'outil :
- **Un hôte/port à elle, pas un sous-chemin** : les appels de l'app sont en chemins absolus (`/api/...`, `/sw.js`), un préfixe d'URL les casserait.
- **Transmettre `X-Forwarded-For`** (la limite d'imports lit la dernière adresse) ; le contrôle de santé `GET /healthz` reste en HTTP direct, sans mot de passe.
- **Certificat valable pour le nom ET l'IP utilisés sur l'iPhone** (ex. `nas.local` et l'IP du NAS), et certificat racine installé sur l'iPhone puis activé dans *Réglages → Général → Informations → Réglages de confiance du certificat*. Sans cela, Safari refuse le service worker.
- Une fois en HTTPS, le mode hors-ligne, l'installation en app et l'écran maintenu allumé fonctionnent ; ils se vérifient en ouvrant l'app sur l'iPhone, puis en coupant le Wi-Fi.

---

# Déploiement avec nas-deploy (Synology, recommandé)

Le dépôt contient déjà `deploy.json` (profil validé avec le schéma de nas-deploy), `package.json` (la version vient de là) et le `Dockerfile`.

1. **Enregistrer l'app** (une seule fois), sur le portable :
   ```powershell
   nas-deploy register C:\Projets\recettes --port 8090
   ```
   Choisissez un port libre sur le NAS (8080 = Filmo, 8096 = Jellyfin, 5055 = Jellyseerr).
2. **Secrets** : dans `~/.nas-deploy/settings.json`, section de l'app `recettes`, ajouter les variables (jamais dans le dépôt) :
   ```json
   "env": { "APP_PASSWORD": "un mot de passe long", "ANTHROPIC_API_KEY": "sk-ant-…" }
   ```
   `APP_PASSWORD` est obligatoire (sans lui l'app est ouverte à tous ; le serveur le signale au démarrage). `ANTHROPIC_API_KEY` est facultative : elle active l'import par URL et par photo.
3. **Simuler puis déployer** :
   ```powershell
   nas-deploy deploy recettes --dry-run
   nas-deploy deploy recettes
   ```
   Pipeline : test (`npm test`), build, contrôle de l'image (aucun `.env` ni `.db` dedans), smoke test local, envoi, sauvegarde SQLite en ligne, bascule derrière `GET /healthz`. `nas-deploy rollback recettes` revient en arrière.
4. **Accès en local, sans certificat** : sur le portable, `ssh -L 8090:127.0.0.1:8090 admin@<nas>` puis `http://127.0.0.1:8090` (contexte sécurisé : hors-ligne et installation en app fonctionnent). Sur l'iPhone, `http://<ip-du-nas>:8090` fonctionne mais sans service worker, hors-ligne ni écran maintenu allumé (Safari les réserve au HTTPS). Le HTTPS n'est nécessaire que pour ces trois fonctions.

Particularités : le conteneur tourne sous votre compte NAS (`run.user: "nas-account"`, comme Filmo) à cause des ACL Synology ; les données vivent dans `/<volume>/docker/recettes/data` (base + `backups/` quotidiens de l'app, en plus des sauvegardes de la plateforme). Pas de changement du code de nas-deploy nécessaire.

Sur le NAS, HTTPS : *Panneau de configuration → Portail de connexion → Avancé → Proxy inversé* (nom d'hôte HTTPS → `localhost:8090`) avec un certificat Let's Encrypt, ou Tailscale (`tailscale serve --bg 8090`).

---

# Alternative : docker compose sur un NAS ou un serveur

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
