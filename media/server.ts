// shrt-media: guarda, valida y comprime capturas y videos. Solo acepta tráfico del Worker.
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";

const DATA = process.env.DATA_DIR || "/data";
const SECRET = process.env.MEDIA_SECRET || "";
if (SECRET.length < 32) { console.error("MEDIA_SECRET ausente o corto"); process.exit(1); }

const env = (k: string, d: number) => Number(process.env[k] || d);
const MB = 1024 * 1024;
const DAY = 86400;
const MAX_IMAGE = env("MAX_IMAGE_MB", 15) * MB;
const MAX_VIDEO = env("MAX_VIDEO_MB", 95) * MB;
const MAX_DISK = env("MAX_DISK_GB", 20) * 1024 * MB;
const IMAGE_TTL = env("IMAGE_TTL_DAYS", 30) * DAY;
const VIDEO_TTL = env("VIDEO_TTL_DAYS", 7) * DAY;
const MAX_DURATION = env("MAX_VIDEO_SECONDS", 600);
const IP_UPLOADS = env("IP_UPLOADS_PER_HOUR", 30);
const IP_BYTES = env("IP_MB_PER_HOUR", 400) * MB;
const ALL_UPLOADS = env("GLOBAL_UPLOADS_PER_HOUR", 400);
const MAX_QUEUE = env("MAX_VIDEO_QUEUE", 8);
const MAX_PIXELS_SIDE = 16384;

mkdirSync(DATA, { recursive: true });

type Kind = "image" | "video";
interface Meta {
  code: string; kind: Kind; ext: string; status: "ready" | "processing" | "failed";
  w: number; h: number; duration?: number; size: number; created: number; expires: number;
}

const now = () => Math.floor(Date.now() / 1000);
const validCode = (c: string) => /^[0-9A-Za-z]{4,32}$/.test(c);
const metaPath = (c: string) => join(DATA, `${c}.json`);
const json = (d: unknown, status = 200) => Response.json(d, { status });

function authorized(req: Request): boolean {
  const a = Buffer.from(req.headers.get("x-shrt-origin") || "");
  const b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

// El tipo se decide por el contenido, nunca por lo que declare el cliente.
function sniff(b: Uint8Array): { kind: Kind; ext: string } | null {
  const s = (o: number, t: string) => [...t].every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b.length < 16) return null;
  if (b[0] === 0x89 && s(1, "PNG")) return { kind: "image", ext: "png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", ext: "jpg" };
  if (s(0, "GIF8")) return { kind: "image", ext: "gif" };
  if (s(0, "RIFF") && s(8, "WEBP")) return { kind: "image", ext: "webp" };
  if (s(4, "ftyp")) return { kind: "video", ext: "mp4" };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: "video", ext: "mp4" };
  return null;
}

async function run(cmd: string[], ms: number): Promise<{ ok: boolean; out: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const t = setTimeout(() => p.kill(9), ms);
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  clearTimeout(t);
  return { ok: code === 0, out };
}

async function probe(path: string, format: string) {
  const r = await run(["ffprobe", "-v", "error", "-f", format, "-show_entries",
    "stream=codec_type,width,height:format=duration", "-of", "json", path], 30_000);
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.out);
    const v = (j.streams || []).find((x: any) => x.codec_type === "video");
    if (!v?.width || !v?.height) return null;
    return { w: Number(v.width), h: Number(v.height), duration: Number(j.format?.duration || 0) };
  } catch { return null; }
}

const IMAGE_DEMUXER: Record<string, string> = { png: "png_pipe", jpg: "jpeg_pipe", gif: "gif", webp: "webp_pipe" };
const save = (m: Meta) => Bun.write(metaPath(m.code), JSON.stringify(m));
async function load(code: string): Promise<Meta | null> {
  const f = Bun.file(metaPath(code));
  return (await f.exists()) ? f.json() : null;
}

function remove(code: string) {
  for (const n of readdirSync(DATA)) {
    if (n.startsWith(`${code}.`) || n.startsWith(`${code}_`)) try { unlinkSync(join(DATA, n)); } catch {}
  }
}

function diskUsed(): number {
  let total = 0;
  for (const n of readdirSync(DATA)) try { total += statSync(join(DATA, n)).size; } catch {}
  return total;
}

// Límites en memoria por hora: suficientes para un solo contenedor.
const hits = new Map<string, { until: number; count: number; bytes: number }>();
let global = { until: 0, count: 0 };
function limited(ip: string, bytes: number): boolean {
  const t = now();
  if (global.until < t) global = { until: t + 3600, count: 0 };
  let h = hits.get(ip);
  if (!h || h.until < t) { h = { until: t + 3600, count: 0, bytes: 0 }; hits.set(ip, h); }
  if (h.count >= IP_UPLOADS || h.bytes + bytes > IP_BYTES || global.count >= ALL_UPLOADS) return true;
  h.count++; h.bytes += bytes; global.count++;
  return false;
}

// La VM tiene 2 núcleos: se comprime un video a la vez.
const queue: Meta[] = [];
let busy = false;
async function pump() {
  if (busy) return;
  const m = queue.shift();
  if (!m) return;
  busy = true;
  try { await transcode(m); }
  catch (e) { console.error("transcode", m.code, e); m.status = "failed"; await save(m); }
  busy = false;
  void pump();
}

async function transcode(m: Meta) {
  const src = join(DATA, `${m.code}_src`);
  const out = join(DATA, `${m.code}.mp4`);
  const tmp = join(DATA, `${m.code}_out.mp4`);
  const scale = "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";
  const r = await run(["nice", "-n", "15", "ffmpeg", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file",
    "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-vf", `${scale},fps=30`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p", "-threads", "2",
    "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", tmp], 20 * 60_000);
  try { unlinkSync(src); } catch {}
  if (!r.ok) { try { unlinkSync(tmp); } catch {} m.status = "failed"; await save(m); return; }
  await run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file", "-ss", "0.3", "-i", tmp,
    "-frames:v", "1", "-q:v", "3", join(DATA, `${m.code}.jpg`)], 60_000);
  await Bun.write(out, Bun.file(tmp));
  unlinkSync(tmp);
  const p = await probe(out, "mp4");
  if (p) { m.w = p.w; m.h = p.h; m.duration = p.duration; }
  m.size = statSync(out).size;
  m.status = "ready";
  await save(m);
}

async function upload(req: Request, url: URL): Promise<Response> {
  const code = url.searchParams.get("code") || "";
  if (!validCode(code)) return json({ error: "invalid_code" }, 400);
  const body = new Uint8Array(await req.arrayBuffer());
  const type = sniff(body);
  if (!type) return json({ error: "unsupported_type" }, 415);
  if (body.length > (type.kind === "image" ? MAX_IMAGE : MAX_VIDEO)) return json({ error: "too_large" }, 413);
  if (limited(req.headers.get("x-client-ip") || "unknown", body.length)) return json({ error: "rate_limited" }, 429);
  if (diskUsed() + body.length > MAX_DISK) return json({ error: "storage_full" }, 507);
  if (type.kind === "video" && queue.length >= MAX_QUEUE) return json({ error: "busy" }, 503);

  const created = now();
  if (type.kind === "video") {
    const src = join(DATA, `${code}_src`);
    await Bun.write(src, body);
    const p = await probe(src, type.ext === "mp4" && body[0] === 0x1a ? "matroska" : "mov,mp4,m4a,3gp,3g2,mj2");
    if (!p || p.duration > MAX_DURATION) { unlinkSync(src); return json({ error: p ? "too_long" : "invalid_media" }, 415); }
    const m: Meta = { code, kind: "video", ext: "mp4", status: "processing", w: p.w, h: p.h, duration: p.duration,
      size: body.length, created, expires: created + VIDEO_TTL };
    await save(m);
    queue.push(m);
    void pump();
    return json(m, 201);
  }

  const raw = join(DATA, `${code}_raw`);
  await Bun.write(raw, body);
  const p = await probe(raw, IMAGE_DEMUXER[type.ext]);
  if (!p || p.w > MAX_PIXELS_SIDE || p.h > MAX_PIXELS_SIDE) { unlinkSync(raw); return json({ error: "invalid_media" }, 415); }
  const final = join(DATA, `${code}.${type.ext}`);
  // Quita metadatos (por ejemplo GPS) en los formatos donde no cambia el resultado visible.
  let stripped = false;
  if (type.ext === "jpg" || type.ext === "png") {
    const tmp = join(DATA, `${code}_clean.${type.ext}`);
    const args = type.ext === "jpg" ? ["-q:v", "2"] : [];
    const r = await run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file",
      "-f", IMAGE_DEMUXER[type.ext], "-i", raw, "-map_metadata", "-1", "-frames:v", "1", ...args, tmp], 30_000);
    if (r.ok) { await Bun.write(final, Bun.file(tmp)); unlinkSync(tmp); stripped = true; }
  }
  if (!stripped) await Bun.write(final, Bun.file(raw));
  unlinkSync(raw);
  const m: Meta = { code, kind: "image", ext: type.ext, status: "ready", w: p.w, h: p.h,
    size: statSync(final).size, created, expires: created + IMAGE_TTL };
  await save(m);
  return json(m, 201);
}

const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp4: "video/mp4",
};

function serve(req: Request, name: string): Response {
  const m = name.match(/^([0-9A-Za-z]{4,32})\.(png|jpg|gif|webp|mp4)$/);
  if (!m) return json({ error: "not_found" }, 404);
  const path = join(DATA, name);
  let size = 0;
  try { size = statSync(path).size; } catch { return json({ error: "not_found" }, 404); }
  const headers: Record<string, string> = {
    "content-type": TYPES[m[2]], "accept-ranges": "bytes", "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox", "cache-control": "public, max-age=3600",
  };
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(Bun.file(path).slice(start, end + 1), { status: 206, headers: {
      ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(Bun.file(path), { headers: { ...headers, "content-length": String(size) } });
}

async function sweep() {
  const t = now();
  for (const n of readdirSync(DATA)) {
    if (!n.endsWith(".json")) continue;
    const code = n.slice(0, -5);
    try { const m = await load(code); if (m && m.expires < t) remove(code); } catch {}
  }
  // Un fallo a medio escribir no debe dejar temporales para siempre.
  for (const n of readdirSync(DATA)) {
    if (!/_(raw|clean|out|src)/.test(n)) continue;
    try { if (t - statSync(join(DATA, n)).mtimeMs / 1000 > 3 * 3600) unlinkSync(join(DATA, n)); } catch {}
  }
  for (const [ip, h] of hits) if (h.until < t) hits.delete(ip);
}
await sweep();
setInterval(() => void sweep(), 3600_000);

// Si el contenedor se reinició con videos a medias, se marcan como fallidos.
for (const n of readdirSync(DATA)) {
  if (!n.endsWith(".json")) continue;
  const m = await load(n.slice(0, -5));
  if (m?.status === "processing") { m.status = "failed"; await save(m); }
}

Bun.serve({
  port: 8790,
  maxRequestBodySize: 100 * MB,
  idleTimeout: 120,
  error(e) { console.error(e); return json({ error: "server_error" }, 500); },
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return json({ ok: true });
    if (!authorized(req)) return json({ error: "forbidden" }, 403);
    if (url.pathname === "/upload" && req.method === "POST") return upload(req, url);
    let m = url.pathname.match(/^\/meta\/([0-9A-Za-z]{4,32})$/);
    if (m && req.method === "GET") {
      const meta = await load(m[1]);
      return meta && meta.expires >= now() ? json(meta) : json({ error: "not_found" }, 404);
    }
    if (m === null && (m = url.pathname.match(/^\/media\/([0-9A-Za-z]{4,32})$/)) && req.method === "DELETE") {
      remove(m[1]);
      return json({ deleted: m[1] });
    }
    if (url.pathname.startsWith("/file/") && (req.method === "GET" || req.method === "HEAD")) {
      return serve(req, url.pathname.slice(6));
    }
    return json({ error: "not_found" }, 404);
  },
});
console.log("shrt-media :8790");
