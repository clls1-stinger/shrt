import { useEffect, useState } from "preact/hooks";
import { api, publicBase, type Link } from "../api";

export function LinksList({
  onOpen, onCreate, toast,
}: { onOpen: (code: string) => void; onCreate: () => void; toast: (m: string) => void }) {
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");

  function load() {
    setLoading(true);
    api.listLinks().then((d) => setLinks(d.links)).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function del(code: string) {
    if (!confirm(`¿Borrar /${code}? Se eliminan también sus stats.`)) return;
    await api.deleteLink(code);
    toast("Link borrado");
    load();
  }

  function copy(code: string) {
    const url = `${publicBase()}/${code}`;
    navigator.clipboard.writeText(url);
    toast(`Copiado: ${url}`);
  }

  const filtered = links.filter((l) => (kind === "all" || (l.kind || "link") === kind) && (
    !q || l.code.includes(q) || l.target_url.toLowerCase().includes(q.toLowerCase()) ||
    (l.title || "").toLowerCase().includes(q.toLowerCase())));

  return (
    <div class="grid" style="gap:16px">
      <div class="row">
        <input class="input" style="max-width:280px" placeholder="Buscar code, destino o título…"
          value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <div class="seg" role="group" aria-label="Filtrar por tipo">
          {[["all", "Todo"], ["link", "Links"], ["image", "Capturas"], ["video", "Videos"]].map(([k, label]) => (
            <button class={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
          ))}
        </div>
        <div class="spacer" />
        <button class="btn primary" onClick={onCreate}>+ Nuevo link</button>
      </div>

      <div class="card table-wrap" style="padding:6px">
        {loading ? <div class="empty"><span class="spin" /></div> : (
          <table class="table">
            <thead>
              <tr><th>Code</th><th>Destino</th><th style="text-align:right">Clicks</th>
                <th style="text-align:right">Únicos</th><th>Creado</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr>
                  <td><span class="code-pill" onClick={() => onOpen(l.code)} style="cursor:pointer">{l.code}</span></td>
                  <td class="trunc"><a href={l.target_url} target="_blank" rel="noreferrer">{l.title || l.target_url}</a></td>
                  <td style="text-align:right;font-weight:700">{(l.clicks ?? 0).toLocaleString()}</td>
                  <td style="text-align:right" class="muted">{(l.uniques ?? 0).toLocaleString()}</td>
                  <td class="muted">{new Date(l.created_at * 1000).toLocaleDateString()}</td>
                  <td>
                    <div class="row" style="justify-content:flex-end">
                      <button class="btn sm ghost" title="Copiar" aria-label={`Copiar ${l.code}`} onClick={() => copy(l.code)}>⧉</button>
                      <button class="btn sm ghost" title="Estadísticas" aria-label={`Estadísticas de ${l.code}`} onClick={() => onOpen(l.code)}>📊</button>
                      <button class="btn sm ghost danger" title="Borrar" aria-label={`Borrar ${l.code}`} onClick={() => del(l.code)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={6} class="empty">Nada coincide con este filtro.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
