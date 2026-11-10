import type { LinkRow } from "./types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// HTML con meta tags Open Graph / Twitter que los crawlers sociales leen para
// armar la tarjeta de preview. Incluye redirect (meta + JS) por si lo abre un humano.
export function ogPage(link: LinkRow, shortUrl: string): string {
  let destHost = "";
  try { destHost = new URL(link.target_url).hostname.replace(/^www\./, ""); } catch {}

  const title = link.title || destHost || "shrt.emky.com.mx";
  const desc = link.description || `Redirigiendo a ${destHost}`;
  const image = link.image_url || "";
  const url = esc(shortUrl);
  const target = esc(link.target_url);

  const imageTags = image
    ? `<meta property="og:image" content="${esc(image)}">
  <meta name="twitter:image" content="${esc(image)}">
  <meta name="twitter:card" content="summary_large_image">`
    : `<meta name="twitter:card" content="summary">`;

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <link rel="canonical" href="${target}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="shrt.emky.com.mx">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url}">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  ${imageTags}
  <meta http-equiv="refresh" content="0; url=${target}">
  <script>location.replace(${JSON.stringify(link.target_url)});</script>
</head>
<body style="background:#0b0d12;color:#e6e8ee;font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
  <p>Redirigiendo a <a style="color:#7aa2f7" href="${target}">${esc(destHost)}</a>…</p>
</body>
</html>`;
}

export function notFoundPage(host: string): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Link no encontrado</title></head>
<body style="background:#0b0d12;color:#e6e8ee;font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
<div><h1 style="font-size:3rem;margin:0">404</h1>
<p style="opacity:.7">Este link corto no existe o expiró.</p>
<a style="color:#7aa2f7" href="https://${esc(host)}/admin">Ir al panel</a></div></body></html>`;
  return new Response(html, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
}
