import { useEffect, useRef, useState } from "preact/hooks";
import { deleteMedia, uploadMedia, waitForMedia, type MediaItem } from "../api";
import { copyText, invoke, isTauri, listen, type ClipperConfig } from "../tauri";

const STORE = "shrt_media";
const MAX_RECORD_SECONDS = 300;

function readLocal(): MediaItem[] {
  try { return JSON.parse(localStorage.getItem(STORE) || "[]"); } catch { return []; }
}
function writeLocal(items: MediaItem[]) {
  try { localStorage.setItem(STORE, JSON.stringify(items.slice(0, 200))); } catch {}
}

function timeLeft(ts: number): string {
  const days = Math.ceil((ts - Date.now() / 1000) / 86400);
  return days <= 1 ? "Caduca hoy" : `Caduca en ${days} días`;
}

const FORMATS: [string, (i: MediaItem) => string][] = [
  ["Directo", (i) => i.direct_url],
  ["Markdown", (i) => `![captura](${i.direct_url})`],
  ["BBCode", (i) => `[img]${i.direct_url}[/img]`],
  ["HTML", (i) => `<img src="${i.direct_url}" alt="captura">`],
];

export function Media({ toast }: { toast: (m: string, err?: boolean) => void }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState("");
  const [over, setOver] = useState(false);
  const [cfg, setCfg] = useState<ClipperConfig | null>(null);
  const [platform, setPlatform] = useState("web");
  const [mode, setMode] = useState("r");
  const [seconds, setSeconds] = useState<number | null>(null);
  const [confirming, setConfirming] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    if (isTauri) { try { setItems(await invoke("get_media")); } catch {} }
    else setItems(readLocal());
  }

  useEffect(() => {
    load();
    if (!isTauri) return;
    invoke("get_config").then(setCfg).catch(() => {});
    invoke("platform").then(setPlatform).catch(() => {});
    const un = listen("media", () => load());
    return () => { un.then((f) => f()); };
  }, []);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const file = [...(e.clipboardData?.files || [])][0];
      if (file) void send(file);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  async function copy(text: string, label = "Link copiado") {
    try { await copyText(text); toast(label); }
    catch { toast("No se pudo copiar", true); }
  }

  async function send(blob: Blob) {
    setBusy("Subiendo…");
    try {
      const item = await uploadMedia(blob);
      if (item.status === "processing") {
        setBusy("Comprimiendo el video…");
        item.status = await waitForMedia(item.code);
        if (item.status === "failed") throw new Error("No se pudo procesar el video");
      }
      if (isTauri) await invoke("media_done", { item });
      else {
        writeLocal([item, ...readLocal()]);
        await navigator.clipboard.writeText(item.url).catch(() => {});
        toast("Subido. Link copiado");
      }
      await load();
    } catch (e: any) {
      toast(e.message || "No se pudo subir", true);
    } finally {
      setBusy("");
    }
  }

  async function remove(item: MediaItem) {
    setConfirming("");
    try {
      await deleteMedia(item);
      if (isTauri) await invoke("forget_media", { code: item.code });
      else writeLocal(readLocal().filter((i) => i.code !== item.code));
      await load();
      toast("Borrado");
    } catch (e: any) { toast(e.message, true); }
  }

  async function startBrowserRecording() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    } catch { return; }
    const type = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_500_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setSeconds(null);
      void send(new Blob(chunks, { type: rec.mimeType }));
    };
    stream.getVideoTracks()[0].onended = () => { if (rec.state !== "inactive") rec.stop(); };
    rec.start(1000);
    recorder.current = rec;
    setSeconds(0);
  }

  useEffect(() => {
    if (seconds === null) return;
    if (seconds >= MAX_RECORD_SECONDS) { recorder.current?.stop(); return; }
    const t = setTimeout(() => setSeconds((s) => (s === null ? s : s + 1)), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  async function record() {
    if (recorder.current) { recorder.current.stop(); return; }
    if (platform === "linux") {
      try {
        await invoke("start_record", { mode });
        toast("Graba con Spectacle. Al terminar se sube solo");
      } catch (e: any) { toast(String(e), true); }
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) { toast("Este navegador no permite grabar la pantalla", true); return; }
    await startBrowserRecording();
  }

  async function capture() {
    try { await invoke("start_capture"); } catch (e: any) { toast(String(e), true); }
  }

  async function onboard(enable: boolean) {
    if (!cfg) return;
    const next = { ...cfg, onboarded: true, screenshots: enable };
    setCfg(next);
    await invoke("save_config", { config: next });
    if (enable) toast("Listo. Tus capturas se subirán solas");
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer?.files[0];
    if (file) void send(file);
  }

  const clock = seconds === null ? "" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div class="grid">
      {isTauri && cfg && !cfg.onboarded && (
        <div class="note">
          <div class="grow">
            <b>¿Subir tus capturas automáticamente?</b>
            <span>Cada captura nueva se sube y su link queda copiado. Cualquiera con el link puede verla, así que revisa qué capturas.</span>
          </div>
          <div class="actions">
            <button class="btn ghost" onClick={() => onboard(false)}>Ahora no</button>
            <button class="btn primary" onClick={() => onboard(true)}>Activar</button>
          </div>
        </div>
      )}

      <div class={`drop ${over ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)} onDrop={drop}>
        <div class="grow">
          <h2>{busy || "Comparte una captura o un video"}</h2>
          <p>{busy ? "El link se copiará cuando termine." : "Arrastra un archivo aquí o pégalo con Ctrl+V. Imágenes hasta 15 MB, videos hasta 95 MB."}</p>
        </div>
        <div class="actions">
          {busy && <span class="spin" />}
          {isTauri && <button class="btn primary" disabled={!!busy} onClick={capture}>Capturar</button>}
          {platform === "linux" && (
            <div class="seg" role="group" aria-label="Qué grabar">
              {[["r", "Región"], ["s", "Pantalla"], ["w", "Ventana"]].map(([k, label]) => (
                <button class={mode === k ? "on" : ""} aria-pressed={mode === k} onClick={() => setMode(k)}>{label}</button>
              ))}
            </div>
          )}
          <button class={`btn rec ${seconds !== null ? "live" : ""}`} disabled={!!busy} onClick={record}>
            {seconds !== null ? `Detener ${clock}` : "Grabar"}
          </button>
          <button class="btn" disabled={!!busy} onClick={() => fileInput.current?.click()}>Elegir archivo</button>
          <input ref={fileInput} type="file" accept="image/*,video/*" hidden
            onChange={(e) => {
              const input = e.target as HTMLInputElement;
              if (input.files?.[0]) void send(input.files[0]);
              input.value = "";
            }} />
        </div>
      </div>

      {!items.length && <div class="empty">Tus capturas y videos aparecerán aquí.</div>}
      <div class="gallery">
        {items.map((i) => (
          <div class="tile">
            <a class="thumb" href={i.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${i.code}`}>
              <img src={i.kind === "video" ? `${i.direct_url.replace(/\.mp4$/, ".jpg")}` : i.direct_url} alt="" loading="lazy" />
              {i.kind === "video" && <span class="badge">Video</span>}
            </a>
            <div class="tile-body">
              <div class="tile-meta">
                <span class="code-pill">{i.code}</span>
                <span class="muted">{timeLeft(i.expires_at)}</span>
              </div>
              <div class="actions">
                <button class="btn primary sm" onClick={() => copy(i.url)}>Copiar link</button>
                {confirming === i.code
                  ? <button class="btn danger sm" onClick={() => remove(i)} onBlur={() => setConfirming("")}>¿Borrar el link?</button>
                  : <button class="btn ghost danger sm" onClick={() => setConfirming(i.code)}>Borrar</button>}
              </div>
              <div class="formats">
                {FORMATS.filter(([label]) => i.kind === "image" || label === "Directo").map(([label, make]) => (
                  <button onClick={() => copy(make(i), `${label} copiado`)}>{label}</button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
