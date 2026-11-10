import type { Env, LinkRow } from "./types";
import { isSocialBot, parseUA, refererDomain } from "./ua";
import { visitorHash, dayKey } from "./shortcode";
import { ogPage, notFoundPage } from "./og";
import { mediaPage } from "./media";

// Maneja GET /<code>: resuelve, registra el click (async) y redirige.
export async function handleRedirect(
  code: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const link = await env.DB.prepare(
    "SELECT * FROM links WHERE code = ? LIMIT 1",
  ).bind(code).first<LinkRow>();

  if (!link || link.active === 0) return notFoundPage(env.BASE_HOST);

  const now = Math.floor(Date.now() / 1000);
  if (link.expires_at && link.expires_at < now) return notFoundPage(env.BASE_HOST);

  const ua = request.headers.get("user-agent") || "";
  const shortUrl = `https://${env.BASE_HOST}/${code}`;

  // El click se persiste fuera del path crítico para no añadir latencia al redirect.
  ctx.waitUntil(logClick(link, request, env, now, ua));

  if (link.kind !== "link") return mediaPage(link, env, () => notFoundPage(env.BASE_HOST));

  // Crawlers sociales: servir la tarjeta OG en vez de redirigir.
  if (isSocialBot(ua)) {
    return new Response(ogPage(link, shortUrl), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  }

  return Response.redirect(link.target_url, 302);
}

async function logClick(
  link: LinkRow,
  request: Request,
  env: Env,
  now: number,
  ua: string,
): Promise<void> {
  try {
    const cf = (request as any).cf || {};
    const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
    const referer = request.headers.get("referer");
    const info = parseUA(ua);
    const vhash = await visitorHash(ip, ua, dayKey(now));

    await env.DB.prepare(
      `INSERT INTO clicks
        (link_id, ts, visitor_hash, country, city, region, referer, referer_domain, ua, browser, os, device, is_bot)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      link.id,
      now,
      vhash,
      cf.country || null,
      cf.city || null,
      cf.region || null,
      referer || null,
      refererDomain(referer),
      ua.slice(0, 512),
      info.browser,
      info.os,
      info.device,
      info.isBot ? 1 : 0,
    ).run();
  } catch (e) {
    // Nunca romper la redirección por un fallo de telemetría.
    console.error("logClick error", e);
  }
}
