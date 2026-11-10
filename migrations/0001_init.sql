-- shrt :: esquema inicial
-- links: cada URL acortada + metadata para previews sociales (OG)
CREATE TABLE IF NOT EXISTS links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    NOT NULL UNIQUE,
  target_url   TEXT    NOT NULL,
  title        TEXT,
  description  TEXT,
  image_url    TEXT,
  created_at   INTEGER NOT NULL,      -- unix epoch (s)
  expires_at   INTEGER,               -- unix epoch (s) | NULL = sin expiración
  active       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_links_code ON links(code);
CREATE INDEX IF NOT EXISTS idx_links_created ON links(created_at);

-- clicks: un evento por visita. Telemetría estándar de la industria.
CREATE TABLE IF NOT EXISTS clicks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id        INTEGER NOT NULL,
  ts             INTEGER NOT NULL,    -- unix epoch (s)
  visitor_hash   TEXT,                -- sha256(ip+ua+dia) → unique visitors sin guardar PII cruda
  country        TEXT,
  city           TEXT,
  region         TEXT,
  referer        TEXT,
  referer_domain TEXT,
  ua             TEXT,
  browser        TEXT,
  os             TEXT,
  device         TEXT,                -- desktop | mobile | tablet | bot
  is_bot         INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_clicks_link ON clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_ts   ON clicks(ts);
CREATE INDEX IF NOT EXISTS idx_clicks_link_ts ON clicks(link_id, ts);
