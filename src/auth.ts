import type { Env } from "./types";

// Auth admin: acepta `Authorization: Bearer <token>` o `x-admin-token: <token>`.
// Comparación en tiempo constante para evitar timing attacks.
export function isAuthorized(request: Request, env: Env): boolean {
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : null;
  const provided = bearer ?? request.headers.get("x-admin-token") ?? "";
  return timingSafeEqual(provided, env.ADMIN_TOKEN);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
