# Hébergement (Fly.io, ~2-3 €/mois, volume persistant pour SQLite)

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
