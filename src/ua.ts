// Parser ligero de User-Agent (sin dependencias) + detección de crawlers sociales.

// Crawlers que renderizan tarjetas de preview: a estos NO se les redirige,
// se les sirve el HTML con Open Graph para que armen la tarjeta.
const SOCIAL_BOTS = [
  "facebookexternalhit", "facebookcatalog", "facebot",
  "twitterbot", "linkedinbot", "slackbot", "slack-imgproxy",
  "discordbot", "telegrambot", "whatsapp", "pinterest",
  "redditbot", "applebot", "vkshare", "skypeuripreview",
  "embedly", "iframely", "nuzzel", "bitlybot", "flipboard",
  "tumblr", "qwantify", "mastodon", "bluesky", "snapchat",
  "googlebot", "bingbot", "w3c_validator", "developers.google.com",
];

// Bots genéricos (se cuentan como bot en analytics pero sí se redirigen).
const GENERIC_BOTS = [
  "bot", "crawler", "spider", "crawl", "slurp", "headless",
  "python-requests", "curl", "wget", "axios", "go-http", "java/",
  "ahrefs", "semrush", "mj12", "dotbot", "uptime", "monitor",
];

export function isSocialBot(ua: string): boolean {
  const u = ua.toLowerCase();
  return SOCIAL_BOTS.some((b) => u.includes(b));
}

export interface UAInfo {
  browser: string;
  os: string;
  device: "desktop" | "mobile" | "tablet" | "bot";
  isBot: boolean;
}

export function parseUA(ua: string): UAInfo {
  const u = (ua || "").toLowerCase();

  const isBot =
    isSocialBot(ua) || GENERIC_BOTS.some((b) => u.includes(b)) || u.trim() === "";

  // OS
  let os = "Unknown";
  if (u.includes("windows")) os = "Windows";
  else if (u.includes("android")) os = "Android";
  else if (u.includes("iphone") || u.includes("ipad") || u.includes("ipod")) os = "iOS";
  else if (u.includes("mac os x") || u.includes("macintosh")) os = "macOS";
  else if (u.includes("cros")) os = "ChromeOS";
  else if (u.includes("linux")) os = "Linux";

  // Browser (orden importa: Edge/Brave/Opera antes que Chrome)
  let browser = "Unknown";
  if (u.includes("edg/") || u.includes("edga") || u.includes("edgios")) browser = "Edge";
  else if (u.includes("opr/") || u.includes("opera")) browser = "Opera";
  else if (u.includes("samsungbrowser")) browser = "Samsung Internet";
  else if (u.includes("firefox") || u.includes("fxios")) browser = "Firefox";
  else if (u.includes("chrome") || u.includes("crios")) browser = "Chrome";
  else if (u.includes("safari")) browser = "Safari";

  // Device
  let device: UAInfo["device"] = "desktop";
  if (isBot) device = "bot";
  else if (u.includes("ipad") || (u.includes("tablet") && !u.includes("mobile"))) device = "tablet";
  else if (u.includes("mobile") || u.includes("iphone") || u.includes("android")) device = "mobile";

  return { browser, os, device, isBot };
}

export function refererDomain(referer: string | null): string | null {
  if (!referer) return null;
  try {
    const h = new URL(referer).hostname.replace(/^www\./, "");
    return h || null;
  } catch {
    return null;
  }
}
