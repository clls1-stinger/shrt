# shrt 🔗 — acortador de links en `shrt.emky.com.mx`

Acortador self-hosted sobre **Cloudflare Workers + D1**, con:

- **Redirect en el edge**: `shrt.emky.com.mx/<code>` → destino (302), latencia mínima global.
- **Previews sociales (Open Graph)**: los crawlers (Facebook, Twitter/X, WhatsApp, Discord, Slack, LinkedIn, Telegram…) reciben una tarjeta con `og:title/description/image` por link.
- **Telemetría estándar de industria**: clicks, visitantes únicos (hash IP+UA por día, sin PII cruda), serie temporal, geo (país/ciudad vía `request.cf`), referrers, dispositivos, navegadores, SO, bot vs humano.
- **Dashboard Preact** (`/admin`): KPIs, gráfica de área, breakdowns y CRUD de links. Privado por **admin token**.
- **App de escritorio Tauri** (`clipper/`): vigila el portapapeles, detecta links, los acorta solo y destella el cursor como señal.

## Capturas y grabaciones
La app de escritorio sube tus capturas nuevas y deja el link copiado. Al pegarlo en Discord, Facebook, WhatsApp, Telegram, X o Slack aparece la imagen o el video.

- Las imágenes se borran a los 30 días y los videos a los 7.
- Los videos se comprimen a 720p en el servidor.
- La subida es anónima, con límites de tamaño y de frecuencia.
- La subida automática viene apagada hasta que aceptes activarla.
- Cualquiera con el link puede ver el archivo.

Instalador de Windows: sección Releases. El token de administrador nunca va en el binario; solo hace falta para acortar links y ver estadísticas.

El servicio de medios está en `media/` y corre con Docker. Copia `media/.env.example` a `media/.env` y define sus valores.

## Stack
Cloudflare Workers · D1 (SQLite) · TypeScript · Preact + Vite · wrangler.

## Estructura
```
src/            Worker (router, redirect, OG, API admin, analytics, UA parser)
migrations/     esquema D1 (links, clicks)
web/            dashboard Preact (Vite → web/dist, servido como assets del Worker)
clipper/        app Tauri (clipboard watcher + auto-shorten + flash cursor)
```

## Desarrollo local
```bash
npm install
npm run web:build                       # compila el dashboard
npx wrangler d1 migrations apply shrt --local
npx wrangler dev --local                # http://localhost:8787
```
El admin token local vive en `.dev.vars` (`ADMIN_TOKEN=…`).

## Deploy a producción (requiere auth con permisos Workers + D1)
El token del MCP cloudflare es DNS-only. Para deploy, autenticarse con un token
con scopes **Workers Scripts:Edit, D1:Edit, Workers Routes:Edit, Account:Read**, o vía OAuth:
```bash
npx wrangler login                      # OAuth en el navegador (da todos los scopes)

# 1. crear la D1 y copiar el database_id a wrangler.jsonc
npx wrangler d1 create shrt
#    → editar "database_id" en wrangler.jsonc

# 2. migrar la base remota
npm run db:migrate

# 3. setear el admin token como secret
npx wrangler secret put ADMIN_TOKEN

# 4. deploy (compila web + sube Worker + crea el custom domain shrt.emky.com.mx)
npm run deploy
```
`scripts/deploy.sh` automatiza pasos 1-4.

## API
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET    | `/<code>`               | — | redirect (o tarjeta OG para bots) |
| GET    | `/api/health`           | — | healthcheck |
| POST   | `/api/links`            | ✓ | crear `{url, code?, title?, description?, image?}` |
| GET    | `/api/links`            | ✓ | listar con conteo de clicks |
| GET    | `/api/links/:code`      | ✓ | detalle |
| PATCH  | `/api/links/:code`      | ✓ | editar |
| DELETE | `/api/links/:code`      | ✓ | borrar |
| GET    | `/api/links/:code/stats?range=7d` | ✓ | stats del link |
| GET    | `/api/overview?range=30d` | ✓ | stats globales |

Auth: header `Authorization: Bearer <ADMIN_TOKEN>` o `x-admin-token: <ADMIN_TOKEN>`.
Rangos: `24h`, `7d`, `30d`, `90d`, `all`.
