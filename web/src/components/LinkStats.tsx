import { copyText } from "../tauri";
import { useEffect, useState } from "preact/hooks";
import { api, publicBase } from "../api";
import { AreaChart, Bars } from "./Chart";
import { Kpi, RangePicker } from "./Overview";

export function LinkStats({ code, onBack, toast }: { code: string; onBack: () => void; toast: (m: string) => void }) {
  const [range, setRange] = useState("30d");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.stats(code, range).then(setData).finally(() => setLoading(false));
  }, [code, range]);

  const shortUrl = `${publicBase()}/${code}`;
  function copy() { copyText(shortUrl).then(() => toast("Copiado")).catch(() => toast("No se pudo copiar")); }

  if (loading && !data) return <div class="empty"><span class="spin" /></div>;
  const t = data?.totals ?? {};
  const link = data?.link ?? {};

  return (
    <div class="grid" style="gap:18px">
      <div class="row">
        <button class="btn ghost sm" onClick={onBack}>← Links</button>
        <div>
          <div class="row">
            <span class="code-pill">{code}</span>
            <a href={shortUrl} target="_blank" rel="noreferrer">{shortUrl}</a>
            <button class="btn sm ghost" onClick={copy}>⧉</button>
          </div>
          <div class="muted trunc" style="margin-top:4px;max-width:520px">→ {link.target_url}</div>
        </div>
        <div class="spacer" />
        <RangePicker range={range} set={setRange} />
      </div>

      <div class="grid kpis">
        <Kpi label="Clicks" num={t.clicks} sub={range} />
        <Kpi label="Visitantes únicos" num={t.uniques} />
        <Kpi label="Bots" num={t.bots} />
      </div>

      <div class="card">
        <h3>Clicks en el tiempo</h3>
        <AreaChart data={data?.timeseries ?? []} />
      </div>

      <div class="grid two">
        <div class="card"><h3>Países</h3><Bars data={data?.countries ?? []} empty="Sin geo aún" /></div>
        <div class="card"><h3>Ciudades</h3><Bars data={data?.cities ?? []} empty="Sin datos" /></div>
      </div>

      <div class="grid two">
        <div class="card"><h3>Referrers</h3><Bars data={data?.referrers ?? []} empty="Directo / sin referrer" /></div>
        <div class="card"><h3>Dispositivos</h3><Bars data={data?.devices ?? []} /></div>
      </div>

      <div class="grid two">
        <div class="card"><h3>Navegadores</h3><Bars data={data?.browsers ?? []} /></div>
        <div class="card"><h3>Sistemas operativos</h3><Bars data={data?.os ?? []} /></div>
      </div>
    </div>
  );
}
