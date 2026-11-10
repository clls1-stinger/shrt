import type { Env } from "./types";
import { RESERVED } from "./types";
import { handleApi } from "./api";
import { handleRedirect } from "./redirect";
import { serveFile } from "./media";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // API admin + health.
    if (path.startsWith("/api/")) return handleApi(request, env, ctx, url);

    // Archivos directos de capturas y videos.
    if (path.startsWith("/m/") && (request.method === "GET" || request.method === "HEAD")) {
      return serveFile(request, env, path.slice(3));
    }

    // SPA del dashboard: root y /admin sirven el index.html compilado.
    if (path === "/" || path === "/admin" || path.startsWith("/admin/")) {
      return serveSPA(request, env, url);
    }

    // /<code> → redirección. Solo GET/HEAD.
    const code = path.slice(1);
    if (!RESERVED.has(code) && /^[0-9A-Za-z_-]{1,64}$/.test(code)) {
      if (request.method === "GET" || request.method === "HEAD") {
        return handleRedirect(code, request, env, ctx, url);
      }
    }

    // Cualquier otra cosa (assets sueltos) la intenta el binding ASSETS.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// Sirve index.html del bundle para que el router cliente de Preact maneje /admin.
function serveSPA(_request: Request, env: Env, url: URL): Promise<Response> {
  return env.ASSETS.fetch(new Request(new URL("/", url).toString()));
}
