import type { Bucket } from "../api";

// Gráfico de área SVG sin dependencias para la serie temporal de clicks.
export function AreaChart({ data, height = 180 }: { data: Bucket[]; height?: number }) {
  if (!data.length) return <div class="empty">Sin datos en el rango</div>;
  const w = 760;
  const h = height;
  const pad = 24;
  const max = Math.max(1, ...data.map((d) => d.v));
  const n = data.length;
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, n - 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);

  const pts = data.map((d, i) => `${x(i)},${y(d.v)}`);
  const line = `M${pts.join(" L")}`;
  const area = `M${x(0)},${h - pad} L${pts.join(" L")} L${x(n - 1)},${h - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" preserveAspectRatio="none" style="display:block">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(122,162,247,0.42)" />
          <stop offset="100%" stop-color="rgba(122,162,247,0)" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line x1={pad} x2={w - pad} y1={pad + f * (h - pad * 2)} y2={pad + f * (h - pad * 2)}
          stroke="#232838" stroke-width="1" />
      ))}
      <path d={area} fill="url(#g)" />
      <path d={line} fill="none" stroke="#7aa2f7" stroke-width="2.5" stroke-linejoin="round" />
      {data.map((d, i) => (
        <circle cx={x(i)} cy={y(d.v)} r="2.5" fill="#7aa2f7">
          <title>{`${d.k}: ${d.v}`}</title>
        </circle>
      ))}
    </svg>
  );
}

// Lista tipo "barra de progreso" para breakdowns (países, referrers, devices...).
export function Bars({ data, empty = "Sin datos" }: { data: Bucket[]; empty?: string }) {
  if (!data.length) return <div class="empty">{empty}</div>;
  const max = Math.max(1, ...data.map((d) => d.v));
  return (
    <div class="bars">
      {data.map((d) => (
        <div class="bar-row">
          <div class="bar-track" style={`width:${(d.v / max) * 100}%`} />
          <span class="bar-label">{d.k || "—"}</span>
          <span class="bar-val">{d.v.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
