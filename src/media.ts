import type { Env, LinkRow } from "./types";
import { json, RESERVED } from "./types";
import { genCode } from "./shortcode";
import { isAuthorized } from "./auth";

const MAX_BODY = 95 * 1024 * 1024;

export interface MediaMeta {
  code: string; kind: "image" | "video"; ext: string; status: "ready" | "processing" | "failed";
  w: number; h: number; duration?: number; size: number; created: number; expires: number;
}

function origin(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-shrt-origin", env.MEDIA_SECRET);
  return fetch(`${env.MEDIA_ORIGIN}${path}`, { ...init, headers });
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function freeCode(env: Env): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const c = genCode(5 + Math.floor(attempt / 3));
    if (RESERVED.has(c)) continue;
    if (!(await env.DB.prepare("SELECT 1 FROM links WHERE code = ?").bind(c).first())) return c;
  }
  throw new Error("code_generation_failed");
}

export function mediaUrls(env: Env, code: string, ext: string) {
  const base = `https://${env.BASE_HOST}`;
  return { url: `${base}/${code}`, direct_url: `${base}/m/${code}.${ext}` };
}

// POST /api/media: subida anónima. Los límites reales se aplican en el servicio de medios.
export async function uploadMedia(request: Request, env: Env): Promise<Response> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY) return json({ error: "too_large" }, 413);
  if (!request.body) return json({ error: "empty" }, 400);
  const code = await freeCode(env);
  const res = await origin(env, `/upload?code=${code}`, {
    method: "POST",
    body: request.body,
    headers: {
      "x-client-ip": request.headers.get("cf-connecting-ip") || "unknown",
      "content-type": "application/octet-stream",
    },
  });
  const data = (await res.json().catch(() => ({ error: "origin_error" }))) as any;
  if (!res.ok) return json(data, res.status);

  const meta = data as MediaMeta;
  const deleteKey = genCode(32);
  const urls = mediaUrls(env, code, meta.ext);
  await env.DB.prepare(
    `INSERT INTO links (code, target_url, title, created_at, expires_at, active, kind, media_ext, delete_hash)
     VALUES (?,?,?,?,?,1,?,?,?)`,
  ).bind(code, urls.direct_url, meta.kind === "video" ? "Video" : "Captura", meta.created, meta.expires,
    meta.kind, meta.ext, await sha256(deleteKey)).run();

  return json({ code, ...urls, kind: meta.kind, status: meta.status, ext: meta.ext,
    expires_at: meta.expires, w: meta.w, h: meta.h, delete_key: deleteKey }, 201);
}

export async function mediaStatus(env: Env, code: string): Promise<Response> {
  const res = await origin(env, `/meta/${code}`);
  if (!res.ok) return json({ error: "not_found" }, 404);
  const m = (await res.json()) as MediaMeta;
  return json({ code, status: m.status, kind: m.kind, w: m.w, h: m.h, expires_at: m.expires });
}

export async function removeMediaFiles(env: Env, code: string): Promise<void> {
  await origin(env, `/media/${code}`, { method: "DELETE" });
}

export async function deleteMedia(request: Request, env: Env, code: string): Promise<Response> {
  const link = await env.DB.prepare("SELECT delete_hash, kind FROM links WHERE code = ?")
    .bind(code).first<{ delete_hash: string | null; kind: string }>();
  if (!link || link.kind === "link") return json({ error: "not_found" }, 404);
  const key = request.headers.get("x-delete-key") || "";
  const owns = key.length > 0 && link.delete_hash === (await sha256(key));
  if (!owns && !isAuthorized(request, env)) return json({ error: "forbidden" }, 403);
  await removeMediaFiles(env, code);
  await env.DB.prepare("DELETE FROM links WHERE code = ?").bind(code).run();
  return json({ deleted: code });
}

// GET /m/<code>.<ext>: archivo directo, con soporte de Range para video.
export async function serveFile(request: Request, env: Env, name: string): Promise<Response> {
  if (!/^[0-9A-Za-z_-]{1,64}\.(png|jpg|gif|webp|mp4)$/.test(name)) return new Response("not found", { status: 404 });
  const headers: Record<string, string> = {};
  const range = request.headers.get("range");
  if (range) headers.range = range;
  const res = await origin(env, `/file/${name}`, { method: request.method, headers });
  return new Response(res.body, { status: res.status, headers: res.headers });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function expiresText(ts: number): string {
  const days = Math.max(0, Math.ceil((ts - Date.now() / 1000) / 86400));
  return days <= 1 ? "Se borra en menos de un día" : `Se borra en ${days} días`;
}

// Misma página para personas y crawlers: los meta tags arman la tarjeta y el cuerpo es el visor.
export async function mediaPage(link: LinkRow, env: Env, status404: () => Response): Promise<Response> {
  const res = await origin(env, `/meta/${link.code}`);
  if (!res.ok) return status404();
  const m = (await res.json()) as MediaMeta;
  const { url, direct_url } = mediaUrls(env, link.code, m.ext);
  const isVideo = m.kind === "video";
  const poster = `https://${env.BASE_HOST}/m/${link.code}.jpg`;
  const title = isVideo ? "Video en shrt" : "Captura en shrt";
  const size = `<meta property="og:image:width" content="${m.w}"><meta property="og:image:height" content="${m.h}">`;
  const tags = isVideo
    ? `<meta property="og:type" content="video.other">
  <meta property="og:image" content="${poster}">${size}
  <meta property="og:video" content="${direct_url}">
  <meta property="og:video:secure_url" content="${direct_url}">
  <meta property="og:video:type" content="video/mp4">
  <meta property="og:video:width" content="${m.w}">
  <meta property="og:video:height" content="${m.h}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${poster}">`
    : `<meta property="og:type" content="website">
  <meta property="og:image" content="${direct_url}">
  <meta property="og:image:secure_url" content="${direct_url}">${size}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${direct_url}">`;

  const media = m.status === "failed"
    ? `<p class="state">No se pudo procesar este video.</p>`
    : m.status === "processing"
      ? `<p class="state">Procesando el video…</p><script>setTimeout(()=>location.reload(),4000)</script>`
      : isVideo
        ? `<video src="${direct_url}" poster="${poster}" controls autoplay muted playsinline></video>`
        : `<a href="${direct_url}"><img src="${direct_url}" alt="Captura compartida" width="${m.w}" height="${m.h}"></a>`;

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<meta name="theme-color" content="#7aa2f7">
<meta property="og:site_name" content="${esc(env.BASE_HOST)}">
<meta property="og:title" content="${title}">
<meta property="og:url" content="${url}">
<meta name="twitter:title" content="${title}">
${tags}
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:flex;flex-direction:column;background:#0b0d12;color:#e6e8ee;font:15px system-ui,sans-serif}
main{flex:1;display:grid;place-items:center;padding:16px;min-height:0}
img,video{display:block;max-width:100%;max-height:calc(100dvh - 96px);width:auto;height:auto;border-radius:10px;box-shadow:0 12px 50px #0008}
footer{display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;padding:14px 16px;color:#8b90a0;font-size:13px}
a.b,button{font:inherit;font-weight:600;color:#e6e8ee;background:#1e2330;border:1px solid #2c3346;border-radius:9px;padding:8px 14px;cursor:pointer;text-decoration:none}
button{background:#7aa2f7;color:#0b0d12;border-color:transparent}.state{color:#8b90a0}
</style></head>
<body><main>${media}</main>
<footer><button onclick="navigator.clipboard.writeText(location.href);this.textContent='Copiado'">Copiar link</button>
<a class="b" href="${direct_url}" download>Descargar</a><span>${expiresText(m.expires)}</span></footer>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60",
    "x-content-type-options": "nosniff" } });
}
