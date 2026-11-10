import { useEffect, useState } from "preact/hooks";
import { api, setTauriCreds } from "../api";
import { invoke, listen, type ClipperConfig } from "../tauri";

type BoolKey = "screenshots" | "clip_images" | "enabled" | "replace_clipboard" | "flash" | "notify" | "autostart";
interface Hist { original: string; short: string; ts: number; }

const OPTIONS: { key: BoolKey; label: string; hint: string; windowsOnly?: boolean }[] = [
  { key: "screenshots", label: "Subir capturas y grabaciones nuevas", hint: "Vigila tus carpetas de capturas y copia el link al terminar." },
  { key: "clip_images", label: "Subir también imágenes copiadas", hint: "Sube cualquier imagen que copies, aunque no sea una captura. Úsalo con cuidado." },
  { key: "enabled", label: "Acortar links copiados", hint: "Requiere token de administrador." },
  { key: "replace_clipboard", label: "Dejar el link corto en el portapapeles", hint: "Listo para pegar con Ctrl+V." },
  { key: "notify", label: "Mostrar notificación", hint: "Avisa cuando termina cada subida." },
  { key: "flash", label: "Destellar el cursor", hint: "Señal visual al copiar el link." },
  { key: "autostart", label: "Iniciar con Windows", hint: "La app queda en la bandeja del sistema.", windowsOnly: true },
];

export function Settings({ toast, onAuth }: { toast: (m: string, err?: boolean) => void; onAuth: (ok: boolean) => void }) {
  const [cfg, setCfg] = useState<ClipperConfig | null>(null);
  const [platform, setPlatform] = useState("");
  const [token, setToken] = useState("");
  const [base, setBase] = useState("");
  const [hist, setHist] = useState<Hist[]>([]);

  const loadHist = () => invoke("get_history").then(setHist).catch(() => {});

  useEffect(() => {
    invoke("get_config").then((c: ClipperConfig) => { setCfg(c); setBase(c.base); setToken(c.token); }).catch(() => {});
    invoke("platform").then(setPlatform).catch(() => {});
    loadHist();
    const un = listen("shortened", () => loadHist());
    return () => { un.then((f) => f()); };
  }, []);

  async function persist(next: ClipperConfig) {
    setCfg(next);
    await invoke("save_config", { config: next });
  }

  async function connect(e: Event) {
    e.preventDefault();
    if (!cfg) return;
    const next = { ...cfg, base: base.trim().replace(/\/$/, "") || cfg.base, token: token.trim() };
    await persist(next);
    setTauriCreds(next.base, next.token);
    if (!next.token) { onAuth(false); toast("Token eliminado"); return; }
    try { await api.listLinks(); onAuth(true); toast("Conectado"); }
    catch { onAuth(false); toast("No pude conectar o el token es inválido", true); }
  }

  if (!cfg) return <div class="empty"><span class="spin" /></div>;

  return (
    <div class="grid two">
      <div class="card">
        <h3>Automatización</h3>
        {OPTIONS.filter((o) => !o.windowsOnly || platform === "windows").map((o) => (
          <label class="setting">
            <input type="checkbox" checked={!!cfg[o.key]} onChange={() => persist({ ...cfg, [o.key]: !cfg[o.key] })} />
            <span>{o.label}<small>{o.hint}</small></span>
          </label>
        ))}
      </div>
      <div class="grid" style="align-content:start">
        <form class="card" onSubmit={connect}>
          <h3>Servidor</h3>
          <div class="field">
            <label for="server">Dirección</label>
            <input id="server" class="input" value={base} onInput={(e) => setBase((e.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <label for="token">Token de administrador (opcional)</label>
            <input id="token" class="input" type="password" autoComplete="off" value={token}
              onInput={(e) => setToken((e.target as HTMLInputElement).value)} />
          </div>
          <p class="muted" style="font-size:13px;margin:0 0 14px">Subir capturas no necesita token. Solo hace falta para acortar links y ver estadísticas.</p>
          <button class="btn primary">Guardar</button>
        </form>
        <div class="card">
          <h3>Links acortados en esta sesión</h3>
          {!hist.length && <p class="muted" style="margin:0">Todavía ninguno.</p>}
          {hist.map((h) => (
            <div style="padding:6px 0;border-bottom:1px solid var(--border)">
              <a href={h.short} target="_blank" rel="noreferrer">{h.short}</a>
              <div class="muted trunc" style="max-width:100%;font-size:13px">{h.original}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
