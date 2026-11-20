#!/usr/bin/env bash
# Create .env on first run (with a valid Fernet secret), start the stack, wait for health.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  cp .env.example .env
  secret=$(python3 -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())")
  pw=$(python3 -c "import secrets;print(secrets.token_urlsafe(18))")
  sed -i.bak -e "s|^LANGFLOW_SECRET_KEY=.*|LANGFLOW_SECRET_KEY=$secret|" -e "s|^LANGFLOW_SUPERUSER_PASSWORD=.*|LANGFLOW_SUPERUSER_PASSWORD=$pw|" .env
  rm -f .env.bak
  echo "wrote .env"
fi
docker compose up -d
printf 'waiting for Langflow'
for _ in $(seq 1 100); do
  if curl -sf http://localhost:7860/health_check >/dev/null; then echo ' ok'; exit 0; fi
  printf '.'; sleep 3
done
echo ' timed out'; docker compose logs --tail 50 langflow; exit 1
