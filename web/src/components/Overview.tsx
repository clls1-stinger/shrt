import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { AreaChart, Bars } from "./Chart";

const RANGES = ["24h", "7d", "30d", "90d", "all"];

export function Overview({ onOpen }: { onOpen: (code: string) => void }) {
  const [range, setRange] = useState("30d");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.overview(range).then(setData).finally(() => setLoading(false));
  }, [range]);

  if (loading && !data) return <div class="empty"><span class="spin" /></div>;
  const t = data?.totals ?? {};

  return (
    <div class="grid" style="gap:18px">
      <div class="row">
        <h3 style="margin:0;color:var(--muted)">Resumen global</h3>
        <div class="spacer" />
        <RangePicker range={range} set={setRange} />
      </div>

      <div class="grid kpis">
        <Kpi label="Links" num={t.links} />
        <Kpi label="Clicks" num={t.clicks} sub={`${range}`} />
        <Kpi label="Visitantes únicos" num={t.uniques} />
        <Kpi label="Bots" num={t.bots} sub={pct(t.bots, t.clicks)} />
      </div>

      <div class="card">
        <h3>Clicks en el tiempo</h3>
        <AreaChart data={data?.timeseries ?? []} />
      </div>

      <div class="grid two">
        <div class="card">
          <h3>Top links</h3>
          <table class="table">
            <thead><tr><th>Code</th><th>Destino</th><th style="text-align:right">Clicks</th></tr></thead>
            <tbody>
              {(data?.topLinks ?? []).map((l: any) => (
                <tr>
                  <td><a class="code-pill" onClick={() => onOpen(l.code)} style="cursor:pointer">{l.code}</a></td>
                  <td class="trunc muted">{l.title || l.target_url}</td>
                  <td style="text-align:right;font-weight:700">{(l.v ?? 0).toLocaleString()}</td>
                </tr>
              ))}
              {!(data?.topLinks ?? []).length && <tr><td colSpan={3} class="empty">Aún no hay clicks</td></tr>}
            </tbody>
          </table>
        </div>
        <div class="card">
          <h3>Países</h3>
          <Bars data={data?.countries ?? []} empty="Sin geo aún" />
        </div>
      </div>

      <div class="card">
        <h3>Referrers</h3>
        <Bars data={data?.referrers ?? []} empty="Tráfico directo / sin referrer" />
      </div>
    </div>
  );
}

export function Kpi({ label, num, sub }: { label: string; num?: number; sub?: string }) {
  return (
    <div class="card kpi">
      <div class="label">{label}</div>
      <div class="num">{(num ?? 0).toLocaleString()}</div>
      {sub && <div class="sub">{sub}</div>}
    </div>
  );
}

export function RangePicker({ range, set }: { range: string; set: (r: string) => void }) {
  return (
    <div class="tabs">
      {RANGES.map((r) => (
        <button class={`tab ${r === range ? "active" : ""}`} onClick={() => set(r)}>{r}</button>
      ))}
    </div>
  );
}

function pct(a = 0, b = 0): string {
  if (!b) return "0%";
  return `${Math.round((a / b) * 100)}% del total`;
}
