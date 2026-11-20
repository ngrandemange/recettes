-- SQLite (migrable vers PostgreSQL : types simples, JSON en TEXT -> JSONB)
CREATE TABLE IF NOT EXISTS recipes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL,                -- Plat, Entrée, Dessert...
  difficulty  INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  prep_min    INTEGER NOT NULL DEFAULT 0,
  cook_min    INTEGER NOT NULL DEFAULT 0,
  rest_min    INTEGER NOT NULL DEFAULT 0,
  servings    INTEGER NOT NULL DEFAULT 4,
  photo_path  TEXT,
  source_url  TEXT,                         -- traçabilité de l'import
  source_kind TEXT,                         -- 'manual' | 'url' | 'photo'
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ingredients (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL, qty REAL, unit TEXT, name TEXT NOT NULL,
  PRIMARY KEY (recipe_id, pos)
);
CREATE TABLE IF NOT EXISTS steps (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL, text TEXT NOT NULL,
  temp_c INTEGER, timer_min INTEGER, kind TEXT CHECK (kind IN ('cuisson','repos')),
  PRIMARY KEY (recipe_id, pos)
);
-- Étiquettes : régimes, méthodes, tags (table unique, facettes par "facet")
CREATE TABLE IF NOT EXISTS recipe_labels (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  facet TEXT NOT NULL CHECK (facet IN ('diet','method','tag')),
  label TEXT NOT NULL,
  PRIMARY KEY (recipe_id, facet, label)
);
CREATE INDEX IF NOT EXISTS idx_labels ON recipe_labels(facet, label);
CREATE TABLE IF NOT EXISTS favorites (recipe_id TEXT PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS import_cache (url TEXT PRIMARY KEY, result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
