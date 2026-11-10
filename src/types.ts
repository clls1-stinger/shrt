export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN: string;
  BASE_HOST: string;
  MEDIA_ORIGIN: string;
  MEDIA_SECRET: string;
}

export interface LinkRow {
  id: number;
  code: string;
  target_url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  created_at: number;
  expires_at: number | null;
  active: number;
  kind: string;
  media_ext: string | null;
  delete_hash: string | null;
}

export const RESERVED = new Set([
  "", "api", "admin", "login", "assets", "favicon.ico", "favicon.svg",
  "m", "robots.txt", "manifest.webmanifest", "sw.js", "index.html", "_app",
]);

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}
