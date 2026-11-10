import type { Env } from "./types";

export interface RangeSpec { since: number; bucket: "hour" | "day"; fmt: string; }

export function parseRange(range: string | null): RangeSpec {
  const now = Math.floor(Date.now() / 1000);
  switch (range) {
    case "24h": return { since: now - 86400, bucket: "hour", fmt: "%Y-%m-%dT%H:00" };
    case "7d":  return { since: now - 7 * 86400, bucket: "day", fmt: "%Y-%m-%d" };
    case "90d": return { since: now - 90 * 86400, bucket: "day", fmt: "%Y-%m-%d" };
    case "all": return { since: 0, bucket: "day", fmt: "%Y-%m-%d" };
    case "30d":
    default:    return { since: now - 30 * 86400, bucket: "day", fmt: "%Y-%m-%d" };
  }
}

interface Bucket { k: string; v: number; u?: number; }

async function groupBy(
  env: Env, col: string, where: string, binds: unknown[], limit = 12,
): Promise<Bucket[]> {
  const rows = await env.DB.prepare(
    `SELECT COALESCE(${col}, '—') AS k, COUNT(*) AS v
       FROM clicks WHERE ${where}
      GROUP BY k ORDER BY v DESC LIMIT ?`,
  ).bind(...binds, limit).all<Bucket>();
  return rows.results ?? [];
}

// Stats por link individual.
export async function linkStats(env: Env, linkId: number, r: RangeSpec) {
  const where = "link_id = ? AND ts >= ?";
  const b = [linkId, r.since];

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS clicks,
            COUNT(DISTINCT visitor_hash) AS uniques,
            SUM(is_bot) AS bots
       FROM clicks WHERE ${where}`,
  ).bind(...b).first<{ clicks: number; uniques: number; bots: number }>();

  const series = await env.DB.prepare(
    `SELECT strftime('${r.fmt}', ts, 'unixepoch') AS k,
            COUNT(*) AS v,
            COUNT(DISTINCT visitor_hash) AS u
       FROM clicks WHERE ${where}
      GROUP BY k ORDER BY k ASC`,
  ).bind(...b).all<Bucket>();

  const [referrers, countries, cities, devices, browsers, os] = await Promise.all([
    groupBy(env, "referer_domain", where, b),
    groupBy(env, "country", where, b),
    groupBy(env, "city", where, b),
    groupBy(env, "device", where, b, 6),
    groupBy(env, "browser", where, b),
    groupBy(env, "os", where, b),
  ]);

  return {
    totals: { clicks: totals?.clicks ?? 0, uniques: totals?.uniques ?? 0, bots: totals?.bots ?? 0 },
    timeseries: series.results ?? [],
    referrers, countries, cities, devices, browsers, os,
  };
}

// Stats globales (overview de todos los links).
export async function overview(env: Env, r: RangeSpec) {
  const where = "ts >= ?";
  const b = [r.since];

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS clicks,
            COUNT(DISTINCT visitor_hash) AS uniques,
            SUM(is_bot) AS bots
       FROM clicks WHERE ${where}`,
  ).bind(...b).first<{ clicks: number; uniques: number; bots: number }>();

  const linkCount = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM links",
  ).first<{ n: number }>();

  const series = await env.DB.prepare(
    `SELECT strftime('${r.fmt}', ts, 'unixepoch') AS k, COUNT(*) AS v
       FROM clicks WHERE ${where} GROUP BY k ORDER BY k ASC`,
  ).bind(...b).all<Bucket>();

  const topLinks = await env.DB.prepare(
    `SELECT l.code, l.target_url, l.title, COUNT(c.id) AS v
       FROM links l LEFT JOIN clicks c ON c.link_id = l.id AND c.ts >= ?
      GROUP BY l.id ORDER BY v DESC LIMIT 10`,
  ).bind(r.since).all();

  const [countries, referrers] = await Promise.all([
    groupBy(env, "country", where, b),
    groupBy(env, "referer_domain", where, b),
  ]);

  return {
    totals: {
      links: linkCount?.n ?? 0,
      clicks: totals?.clicks ?? 0,
      uniques: totals?.uniques ?? 0,
      bots: totals?.bots ?? 0,
    },
    timeseries: series.results ?? [],
    topLinks: topLinks.results ?? [],
    countries, referrers,
  };
}
