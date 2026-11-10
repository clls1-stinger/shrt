#!/usr/bin/env bash
# Deploy de shrt a Cloudflare. Requiere auth con scopes Workers + D1 (wrangler login o token).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ 1/4 asegurando base D1 'shrt'…"
if ! npx wrangler d1 info shrt >/dev/null 2>&1; then
  OUT=$(npx wrangler d1 create shrt)
  echo "$OUT"
  ID=$(echo "$OUT" | grep -oE '"database_id": "[^"]+"' | head -1 | cut -d'"' -f4)
  if [ -n "${ID:-}" ]; then
    sed -i "s/REPLACE_WITH_D1_ID/$ID/" wrangler.jsonc
    echo "  database_id inyectado en wrangler.jsonc: $ID"
  else
    echo "  ⚠ No pude extraer el id automáticamente. Pégalo a mano en wrangler.jsonc y re-corre."
    exit 1
  fi
fi

echo "▸ 2/4 aplicando migraciones a D1 remota…"
npx wrangler d1 migrations apply shrt --remote

echo "▸ 3/4 admin token (secret)…"
if [ -n "${ADMIN_TOKEN:-}" ]; then
  echo "$ADMIN_TOKEN" | npx wrangler secret put ADMIN_TOKEN
else
  echo "  Define ADMIN_TOKEN en el entorno o córrelo manual: npx wrangler secret put ADMIN_TOKEN"
fi

echo "▸ 4/4 build + deploy…"
npm run deploy

echo "✅ Listo. Verifica: curl -s https://shrt.emky.com.mx/api/health"
