CREATE TABLE IF NOT EXISTS threads (
  thread_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  normalized_subject TEXT NOT NULL,
  participants_json TEXT NOT NULL,
  latest_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  unread_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_addr TEXT NOT NULL,
  to_addrs TEXT NOT NULL,
  cc_addrs TEXT NOT NULL DEFAULT '[]',
  bcc_addrs TEXT NOT NULL DEFAULT '[]',
  reply_to TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  normalized_subject TEXT NOT NULL,
  message_id TEXT,
  in_reply_to TEXT,
  references_header TEXT,
  date_header TEXT,
  received_at TEXT,
  sent_at TEXT,
  snippet TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  raw_size INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  cloudflare_status_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(thread_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_message_id
  ON messages(message_id)
  WHERE message_id IS NOT NULL AND message_id != '';

CREATE INDEX IF NOT EXISTS idx_messages_thread_time
  ON messages(thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_threads_latest
  ON threads(latest_at DESC);

