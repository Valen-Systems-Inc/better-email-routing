ALTER TABLE threads ADD COLUMN archived_at TEXT NOT NULL DEFAULT '';
ALTER TABLE threads ADD COLUMN trashed_at TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_threads_archive
  ON threads(archived_at, latest_at DESC);

CREATE INDEX IF NOT EXISTS idx_threads_trash
  ON threads(trashed_at, latest_at DESC);
