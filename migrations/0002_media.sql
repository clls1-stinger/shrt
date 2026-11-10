-- Capturas y videos: comparten tabla, códigos y analítica con los links.
ALTER TABLE links ADD COLUMN kind TEXT NOT NULL DEFAULT 'link';
ALTER TABLE links ADD COLUMN media_ext TEXT;
ALTER TABLE links ADD COLUMN delete_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_links_kind ON links(kind);
