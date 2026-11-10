// Cliente del API admin.
// Web: same-origin + token en localStorage. Tauri: base+token del config Rust.
import { isTauri } from "./tauri";

const TOKEN_KEY = "shrt_admin_token";

let tauriBase = "https://shrt.emky.com.mx";
let tauriToken = "";

// La app de escritorio inyecta aquí las credenciales del config (get_config).
export function setTauriCreds(base: string, token: string): void {
  if (base) tauriBase = base.replace(/\/$/, "");
  tauriToken = token;
}

export function publicBase(): string {
  return isTauri ? tauriBase : location.origin;
}

function apiBase(): string {
  return isTauri ? tauriBase : "";
}

export function getToken(): string {
  return isTauri ? tauriToken : localStorage.getItem(TOKEN_KEY) ?? "";
}
export function setToken(t: string): void {
  if (isTauri) tauriToken = t;
  else localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken(): void {
  if (isTauri) tauriToken = "";
  else localStorage.removeItem(TOKEN_KEY);
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${apiBase()}/api${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getToken()}`,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `http_${res.status}`);
  return data as T;
}

export interface Link {
  id: number; code: string; target_url: string; title: string | null;
  description: string | null; image_url: string | null; created_at: number;
  expires_at: number | null; active: number;
  kind?: string; media_ext?: string | null;
  clicks?: number; uniques?: number; last_click?: number | null; short_url?: string;
}

export interface MediaItem {
  code: string; url: string; direct_url: string; kind: "image" | "video"; status: string;
  expires_at: number; delete_key: string; ts: number;
}

const UPLOAD_ERRORS: Record<string, string> = {
  unsupported_type: "Solo se aceptan imágenes y videos",
  invalid_media: "El archivo está dañado o no se puede leer",
  too_large: "El archivo es demasiado grande (imagen 15 MB, video 95 MB)",
  too_long: "El video dura más de 10 minutos",
  rate_limited: "Demasiadas subidas. Intenta en un rato",
  storage_full: "El servidor no tiene espacio ahora",
  busy: "Hay muchos videos en cola. Intenta en un momento",
};

export async function uploadMedia(blob: Blob): Promise<MediaItem> {
  const res = await fetch(`${publicBase()}/api/media`, { method: "POST", body: blob });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(UPLOAD_ERRORS[data.error] || "No se pudo subir el archivo");
  return { ...data, ts: Math.floor(Date.now() / 1000) };
}

export async function waitForMedia(code: string): Promise<string> {
  for (let i = 0; i < 300; i++) {
    const res = await fetch(`${publicBase()}/api/media/${code}/status`);
    const data: any = await res.json().catch(() => ({}));
    if (data.status && data.status !== "processing") return data.status;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return "failed";
}

export async function deleteMedia(item: MediaItem): Promise<void> {
  const res = await fetch(`${publicBase()}/api/media/${item.code}`, {
    method: "DELETE", headers: { "x-delete-key": item.delete_key },
  });
  if (!res.ok && res.status !== 404) throw new Error("No se pudo borrar");
}

export interface Bucket { k: string; v: number; u?: number; }

export const api = {
  health: () => req<{ ok: boolean }>("/health"),
  overview: (range: string) =>
    req<{ totals: any; timeseries: Bucket[]; topLinks: any[]; countries: Bucket[]; referrers: Bucket[] }>(
      `/overview?range=${range}`,
    ),
  listLinks: () => req<{ links: Link[] }>("/links"),
  createLink: (body: Record<string, unknown>) =>
    req<Link>("/links", { method: "POST", body: JSON.stringify(body) }),
  deleteLink: (code: string) => req<{ deleted: string }>(`/links/${code}`, { method: "DELETE" }),
  updateLink: (code: string, body: Record<string, unknown>) =>
    req<Link>(`/links/${code}`, { method: "PATCH", body: JSON.stringify(body) }),
  stats: (code: string, range: string) =>
    req<any>(`/links/${code}/stats?range=${range}`),
};
