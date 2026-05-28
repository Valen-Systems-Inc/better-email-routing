const MAILBOXES = new Set(["inbox", "sent", "all", "archive", "trash"]);

export function normalizeMailbox(value) {
  const mailbox = String(value || "inbox").trim().toLowerCase();
  return MAILBOXES.has(mailbox) ? mailbox : "inbox";
}

export function buildThreadListFilter({ mailbox = "inbox", query = "" } = {}) {
  const normalizedMailbox = normalizeMailbox(mailbox);
  const clauses = [];
  const params = [];

  if (normalizedMailbox === "trash") {
    clauses.push("t.trashed_at != ''");
  } else {
    clauses.push("t.trashed_at = ''");
  }

  if (normalizedMailbox === "inbox") {
    clauses.push("t.archived_at = ''");
    clauses.push(`EXISTS (
       SELECT 1 FROM messages inbound
       WHERE inbound.thread_id = t.thread_id
       AND inbound.direction = 'inbound'
     )`);
  }

  if (normalizedMailbox === "sent") {
    clauses.push(`EXISTS (
       SELECT 1 FROM messages outbound
       WHERE outbound.thread_id = t.thread_id
       AND outbound.direction = 'outbound'
     )`);
  }

  if (normalizedMailbox === "archive") {
    clauses.push("t.archived_at != ''");
  }

  const search = String(query || "").trim().toLowerCase();
  if (search) {
    const like = `%${search}%`;
    clauses.push(`(
       LOWER(t.normalized_subject) LIKE ?
       OR LOWER(t.participants_json) LIKE ?
       OR EXISTS (
         SELECT 1 FROM messages search
         WHERE search.thread_id = t.thread_id
         AND LOWER(search.snippet) LIKE ?
       )
     )`);
    params.push(like, like, like);
  }

  return {
    mailbox: normalizedMailbox,
    query: search,
    where: clauses.length ? `WHERE ${clauses.join("\n       AND ")}` : "",
    params
  };
}
