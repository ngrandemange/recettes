#!/usr/bin/env bash
# Déploiement sur Fly.io en une commande : ./deploy.sh <nom-unique-de-l-app>
# Le mot de passe et la clé API sont saisis ici (masqués) : jamais dans le chat ni dans l'historique du shell.
set -euo pipefail
APP="${1:?Usage: ./deploy.sh <nom-unique-de-l-app>}"
command -v fly >/dev/null || { echo "Installez flyctl d'abord : https://fly.io/docs/flyctl/install/"; exit 1; }
fly auth whoami >/dev/null 2>&1 || fly auth login
if ! fly apps list 2>/dev/null | awk '{print $1}' | grep -qx "$APP"; then
  fly launch --no-deploy --copy-config --name "$APP" --region cdg --yes
fi
fly volumes list -a "$APP" 2>/dev/null | grep -q recettes_data || fly volumes create recettes_data --size 1 --region cdg -a "$APP" --yes
read -rsp "Mot de passe de l'application : " PASS; echo
[ -n "$PASS" ] || { echo "Mot de passe obligatoire (sinon l'app serait publique)."; exit 1; }
read -rsp "Clé API Anthropic (Entrée pour ignorer, l'import sera désactivé) : " KEY; echo
fly secrets set -a "$APP" --stage APP_PASSWORD="$PASS" ${KEY:+ANTHROPIC_API_KEY="$KEY"}
fly deploy -a "$APP"
echo "✅ https://$APP.fly.dev — ouvrez-le sur l'iPhone puis Partager → Sur l'écran d'accueil."
