import { useState } from "preact/hooks";
import { api } from "../api";

export function CreateLink({
  onClose, onDone, toast,
}: { onClose: () => void; onDone: () => void; toast: (m: string) => void }) {
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [adv, setAdv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: Event) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const link = await api.createLink({ url, code: code || undefined, title, description, image });
      navigator.clipboard.writeText(link.short_url || `${location.origin}/${link.code}`);
      toast(`Creado y copiado: /${link.code}`);
      onDone();
    } catch (e: any) {
      setErr(errMsg(e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="overlay" onClick={onClose}>
      <form class="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Nuevo link corto</h2>
        <div class="field">
          <label>URL destino *</label>
          <input class="input" required type="url" placeholder="https://ejemplo.com/articulo-largo"
            value={url} autoFocus onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />
        </div>
        <div class="field">
          <label>Alias personalizado (opcional)</label>
          <input class="input" placeholder="dejar vacío = code aleatorio (ej. a4Kp9)"
            value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
        </div>

        <button type="button" class="btn ghost sm" onClick={() => setAdv(!adv)} style="margin-bottom:6px">
          {adv ? "− " : "+ "}Preview social (Open Graph)
        </button>
        <p class="muted" style="font-size:12px;margin:0 0 12px">
          Si lo dejas vacío, la preview se <b>autogenera</b> leyendo los meta tags del sitio destino.
        </p>
        {adv && (
          <div style="border-left:2px solid var(--border);padding-left:14px;margin-bottom:8px">
            <div class="field">
              <label>Título de la tarjeta</label>
              <input class="input" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
            </div>
            <div class="field">
              <label>Descripción</label>
              <input class="input" value={description} onInput={(e) => setDescription((e.target as HTMLInputElement).value)} />
            </div>
            <div class="field">
              <label>Imagen (URL)</label>
              <input class="input" placeholder="https://…/cover.jpg" value={image}
                onInput={(e) => setImage((e.target as HTMLInputElement).value)} />
            </div>
          </div>
        )}

        {err && <p style="color:var(--red);margin:0 0 12px">{err}</p>}
        <div class="row" style="justify-content:flex-end;margin-top:8px">
          <button type="button" class="btn ghost" onClick={onClose}>Cancelar</button>
          <button class="btn primary" disabled={busy}>{busy ? <span class="spin" /> : "Crear y copiar"}</button>
        </div>
      </form>
    </div>
  );
}

function errMsg(code: string): string {
  const m: Record<string, string> = {
    invalid_url: "La URL debe empezar con http:// o https://",
    code_taken: "Ese alias ya está usado",
    invalid_code: "Alias inválido (usa letras, números, - o _)",
  };
  return m[code] || `Error: ${code}`;
}
