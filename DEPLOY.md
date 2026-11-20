# Hébergement (Fly.io, ~2-3 €/mois, volume persistant pour SQLite)

Prérequis : un compte Fly.io et `flyctl` installé (`brew install flyctl`), puis `fly auth login`.

```bash
fly launch --no-deploy --copy-config --name <votre-nom-unique>   # reprend fly.toml
fly volumes create recettes_data --size 1 --region cdg
fly secrets set APP_PASSWORD='<mot de passe long>' ANTHROPIC_API_KEY='sk-ant-…'
fly deploy
```
Ouvrir `https://<votre-nom>.fly.dev` sur l'iPhone : Safari demande le mot de passe (identifiant : n'importe lequel).
Ajouter à l'écran d'accueil : Partager → « Sur l'écran d'accueil ».

- **Sauvegarde** : `fly ssh sftp get /data/recettes.db` ; ou `fly volumes snapshots list` (snapshots quotidiens).
- **Coûts API** : l'import est limité à 30/heure/IP (`IMPORTS_PER_HOUR`). Fixez aussi une limite de dépense dans la console Anthropic.
- **Une seule machine** : SQLite sur volume = ne pas passer à plusieurs instances (passer à PostgreSQL le moment venu).
- Alternatives : le `Dockerfile` convient aussi à Render, Railway ou un VPS (monter un disque sur `/data`).
- Sans `APP_PASSWORD`, l'accès est public : à ne jamais faire avec une clé API configurée.
