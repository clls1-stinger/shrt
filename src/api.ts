import type { Env, LinkRow } from "./types";
import { json } from "./types";
import { isAuthorized } from "./auth";
import { genCode, isValidCode } from "./shortcode";
import { RESERVED } from "./types";
import { parseRange, linkStats, overview } from "./analytics";
import { fetchMeta } from "./meta";
import { uploadMedia, mediaStatus, deleteMedia, removeMediaFiles } from "./media";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-admin-token,x-delete-key",
};

export async function handleApi(
  request: Request, env: Env, _ctx: ExecutionContext, url: URL,
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const path = url.pathname.replace(/\/+$/, ""); // sin trailing slash
  const method = request.method;

  // Endpoint público de salud (monitoreo / Homarr).
  if (path === "/api/health") return withCors(json({ ok: true, service: "shrt" }));

  // Capturas y videos: subida anónima con límites, y borrado con la llave de quien subió.
  if (path === "/api/media" && method === "POST") return withCors(await uploadMedia(request, env));
  const media = path.match(/^\/api\/media\/([0-9A-Za-z_-]{1,64})(\/status)?$/);
  if (media) {
    if (media[2] && method === "GET") return withCors(await mediaStatus(env, media[1]));
    if (!media[2] && method === "DELETE") return withCors(await deleteMedia(request, env, media[1]));
    return withCors(json({ error: "method_not_allowed" }, 405));
  }

  // Todo lo demás requiere admin token.
  if (!isAuthorized(request, env)) {
    return withCors(json({ error: "unauthorized" }, 401));
  }

  // /api/overview
  if (path === "/api/overview" && method === "GET") {
    const data = await overview(env, parseRange(url.searchParams.get("range")));
    return withCors(json(data));
  }

  // /api/links
  if (path === "/api/links") {
    if (method === "GET") return withCors(await listLinks(env));
    if (method === "POST") return withCors(await createLink(request, env));
    return withCors(json({ error: "method_not_allowed" }, 405));
  }

  // /api/links/:code  y  /api/links/:code/stats
  const m = path.match(/^\/api\/links\/([0-9A-Za-z_-]{1,64})(\/stats)?$/);
  if (m) {
    const code = m[1];
    const isStats = !!m[2];
    if (isStats && method === "GET") return withCors(await getStats(env, code, url));
    if (!isStats && method === "GET") return withCors(await getLink(env, code));
    if (!isStats && method === "PATCH") return withCors(await updateLink(request, env, code));
    if (!isStats && method === "DELETE") return withCors(await deleteLink(env, code));
  }

  return withCors(json({ error: "not_found" }, 404));
}

function withCors(res: Response): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
}

async function listLinks(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT l.*,
            COUNT(c.id) AS clicks,
            COUNT(DISTINCT c.visitor_hash) AS uniques,
            MAX(c.ts) AS last_click
       FROM links l LEFT JOIN clicks c ON c.link_id = l.id
      GROUP BY l.id
      ORDER BY l.created_at DESC`,
  ).all();
  return json({ links: rows.results ?? [] });
}

async function createLink(request: Request, env: Env): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const target = String(body.url ?? body.target_url ?? "").trim();
  if (!/^https?:\/\/.+/i.test(target)) return json({ error: "invalid_url" }, 400);

  let title = body.title ? String(body.title).slice(0, 200) : null;
  let description = body.description ? String(body.description).slice(0, 400) : null;
  let image_url = body.image ?? body.image_url ? String(body.image ?? body.image_url).slice(0, 500) : null;
  const expires_at = body.expires_at ? Number(body.expires_at) : null;
  const now = Math.floor(Date.now() / 1000);

  let code = body.code ? String(body.code).trim() : "";
  if (code) {
    if (!isValidCode(code) || RESERVED.has(code)) return json({ error: "invalid_code" }, 400);
    const exists = await env.DB.prepare("SELECT 1 FROM links WHERE code = ?").bind(code).first();
    if (exists) return json({ error: "code_taken" }, 409);
  }

  // Sin alias → generar con reintentos crecientes ante colisión.
  for (let attempt = 0; attempt < 8 && !code; attempt++) {
    const candidate = genCode(5 + Math.floor(attempt / 3));
    if (RESERVED.has(candidate)) continue;
    const exists = await env.DB.prepare("SELECT 1 FROM links WHERE code = ?").bind(candidate).first();
    if (!exists) code = candidate;
  }
  if (!code) return json({ error: "code_generation_failed" }, 500);

  // Auto-preview: si falta metadata, la traemos del sitio destino (og:*, <title>…).
  // Se puede desactivar con `"preview": false`.
  if (body.preview !== false && (!title || !description || !image_url)) {
    const meta = await fetchMeta(target);
    title = title ?? (meta.title ? meta.title.slice(0, 200) : null);
    description = description ?? (meta.description ? meta.description.slice(0, 400) : null);
    image_url = image_url ?? (meta.image ? meta.image.slice(0, 500) : null);
  }

  await env.DB.prepare(
    `INSERT INTO links (code, target_url, title, description, image_url, created_at, expires_at, active)
     VALUES (?,?,?,?,?,?,?,1)`,
  ).bind(code, target, title, description, image_url, now, expires_at).run();

  return json({
    code,
    short_url: `https://${env.BASE_HOST}/${code}`,
    target_url: target,
    title, description, image_url, created_at: now,
  }, 201);
}

async function getLink(env: Env, code: string): Promise<Response> {
  const link = await env.DB.prepare("SELECT * FROM links WHERE code = ?").bind(code).first<LinkRow>();
  if (!link) return json({ error: "not_found" }, 404);
  return json({ ...link, short_url: `https://${env.BASE_HOST}/${code}` });
}

async function updateLink(request: Request, env: Env, code: string): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const fields: string[] = [];
  const binds: unknown[] = [];
  const map: Record<string, any> = {
    target_url: body.url ?? body.target_url,
    title: body.title,
    description: body.description,
    image_url: body.image ?? body.image_url,
    active: body.active,
    expires_at: body.expires_at,
  };
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    binds.push(v);
  }
  if (!fields.length) return json({ error: "no_fields" }, 400);

  binds.push(code);
  const res = await env.DB.prepare(
    `UPDATE links SET ${fields.join(", ")} WHERE code = ?`,
  ).bind(...binds).run();
  if (!res.meta.changes) return json({ error: "not_found" }, 404);
  return getLink(env, code);
}

async function deleteLink(env: Env, code: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT kind FROM links WHERE code = ?").bind(code).first<{ kind: string }>();
  if (row && row.kind !== "link") await removeMediaFiles(env, code);
  const res = await env.DB.prepare("DELETE FROM links WHERE code = ?").bind(code).run();
  if (!res.meta.changes) return json({ error: "not_found" }, 404);
  return json({ deleted: code });
}

async function getStats(env: Env, code: string, url: URL): Promise<Response> {
  const link = await env.DB.prepare("SELECT id, code, target_url, title, created_at FROM links WHERE code = ?")
    .bind(code).first<{ id: number }>();
  if (!link) return json({ error: "not_found" }, 404);
  const data = await linkStats(env, link.id, parseRange(url.searchParams.get("range")));
  return json({ link, ...data });
}
