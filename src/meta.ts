// Auto-genera la preview social: visita la URL destino y extrae sus meta tags
// (og:*, twitter:*, <title>, meta description). Usado al crear un link cuando
// el admin/clipper no especifica title/description/image.

export interface Meta {
  title?: string;
  description?: string;
  image?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&nbsp;/g, " ")
    .trim();
}

function metaTag(html: string, prop: string): string | undefined {
  // content antes o después del property/name
  const a = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*?content=["']([^"']*)["']`, "i");
  const b = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${prop}["']`, "i");
  const m = html.match(a) || html.match(b);
  const v = m?.[1]?.trim();
  return v ? decodeEntities(v) : undefined;
}

export async function fetchMeta(target: string): Promise<Meta> {
  try {
    const res = await fetch(target, {
      headers: {
        // UA de navegador para que el sitio no devuelva una versión vacía
        "user-agent":
          "Mozilla/5.0 (compatible; shrt-link-preview/1.0; +https://shrt.emky.com.mx)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      cf: { cacheTtl: 600, cacheEverything: true },
    });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.includes("text/html")) return {};

    // Con leer el <head> basta; cortamos para no traer páginas enormes.
    const html = (await res.text()).slice(0, 120000);

    const title =
      metaTag(html, "og:title") ||
      metaTag(html, "twitter:title") ||
      decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "");

    const description =
      metaTag(html, "og:description") ||
      metaTag(html, "twitter:description") ||
      metaTag(html, "description");

    let image = metaTag(html, "og:image") || metaTag(html, "twitter:image");
    if (image) {
      try {
        image = new URL(image, target).toString(); // resuelve rutas relativas
      } catch {
        image = undefined;
      }
    }

    return {
      title: title || undefined,
      description: description || undefined,
      image: image || undefined,
    };
  } catch {
    return {}; // jamás romper la creación por un fallo del scrape
  }
}
