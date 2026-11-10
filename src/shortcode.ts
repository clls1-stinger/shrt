// Generación de short-codes base62 cortos + validación.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function genCode(len = 5): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 62];
  return out;
}

// Alias válido: 1-64 chars de [0-9A-Za-z_-]
export function isValidCode(code: string): boolean {
  return /^[0-9A-Za-z_-]{1,64}$/.test(code);
}

// sha256(ip + ua + YYYY-MM-DD) → hex. Unique visitors por día sin persistir IP cruda.
export async function visitorHash(ip: string, ua: string, dayKey: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}|${ua}|${dayKey}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export function dayKey(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toISOString().slice(0, 10);
}
