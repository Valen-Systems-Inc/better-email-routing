import { buildThreadListFilter } from "./thread-filters.js";
import { parseRawEmail } from "./email-parser.js";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8"
};

export default {
  async fetch(request, env) {
    return handleHttp(request, env);
  },

  async email(message, env) {
    return handleEmail(message, env);
  }
};

async function handleEmail(message, env) {
  const inboxAddress = String(env.INBOX_ADDRESS || "inbox@example.com").toLowerCase();
  const toAddress = String(message.to || "").toLowerCase();

  if (toAddress !== inboxAddress) {
    message.setReject("Unknown recipient");
    return;
  }

  const maxRawSize = Number(env.MAX_RAW_SIZE || 2000000);
  if (message.rawSize > maxRawSize) {
    message.setReject("Message exceeds this inbox storage limit");
    return;
  }

  const raw = await new Response(message.raw).text();
  const parsed = parseRawEmail(raw);
  const now = new Date().toISOString();
  const subject = parsed.subject || "(no subject)";
  const record = {
    id: crypto.randomUUID(),
    direction: "inbound",
    from: normalizeEmailAddress(message.from || parsed.from),
    to: [normalizeEmailAddress(message.to || parsed.to)],
    cc: parseAddressList(parsed.cc),
    bcc: [],
    replyTo: normalizeEmailAddress(parsed.replyTo),
    subject,
    normalizedSubject: normalizeSubject(subject),
    messageId: parsed.messageId,
    inReplyTo: parsed.inReplyTo,
    referencesHeader: parsed.referencesHeader,
    dateHeader: parsed.dateHeader,
    receivedAt: now,
    sentAt: "",
    snippet: makeSnippet(parsed.text || stripHtml(parsed.html)),
    textBody: trimForStorage(parsed.text),
    htmlBody: trimForStorage(parsed.html),
    attachments: parsed.attachments,
    rawSize: message.rawSize,
    readAt: "",
    cloudflareStatus: null,
    createdAt: now
  };

  await storeMessage(env, record);
}

async function handleHttp(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return json({ ok: true }, 204);
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({ ok: true, service: "better-email-routing-inbox" });
  }

  if (!(await isAuthorized(request, env))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/threads") {
    return listThreads(env, url);
  }

  const threadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)$/);
  if (request.method === "GET" && threadMatch) {
    return getThread(env, decodeURIComponent(threadMatch[1]));
  }

  const readMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/read$/);
  if (request.method === "PATCH" && readMatch) {
    const body = await request.json().catch(() => ({}));
    return setThreadReadState(env, decodeURIComponent(readMatch[1]), body.read !== false);
  }

  const archiveMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/archive$/);
  if (request.method === "PATCH" && archiveMatch) {
    const body = await request.json().catch(() => ({}));
    return setThreadArchiveState(env, decodeURIComponent(archiveMatch[1]), body.archived !== false);
  }

  const trashMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/trash$/);
  if (request.method === "PATCH" && trashMatch) {
    const body = await request.json().catch(() => ({}));
    return setThreadTrashState(env, decodeURIComponent(trashMatch[1]), body.trashed !== false);
  }

  if (request.method === "DELETE" && threadMatch) {
    return deleteThread(env, decodeURIComponent(threadMatch[1]));
  }

  if (request.method === "POST" && url.pathname === "/api/sent") {
    const body = await request.json().catch(() => null);
    if (!body) {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    return recordSent(env, body);
  }

  return json({ ok: false, error: "Not found" }, 404);
}

async function listThreads(env, url) {
  const filter = buildThreadListFilter({
    mailbox: url.searchParams.get("box"),
    query: url.searchParams.get("q")
  });
  const statement = env.INBOX_DB.prepare(
    `SELECT
       t.thread_id, t.subject, t.normalized_subject, t.participants_json,
       t.latest_at, t.created_at, t.updated_at, t.unread_count,
       t.archived_at, t.trashed_at,
       EXISTS (
         SELECT 1 FROM messages inbound
         WHERE inbound.thread_id = t.thread_id
         AND inbound.direction = 'inbound'
       ) AS has_inbound,
       EXISTS (
         SELECT 1 FROM messages outbound
         WHERE outbound.thread_id = t.thread_id
         AND outbound.direction = 'outbound'
       ) AS has_outbound,
       m.id AS latest_message_id, m.direction AS latest_direction,
       m.from_addr AS latest_from, m.to_addrs AS latest_to,
       m.snippet AS latest_snippet, m.attachments_json AS latest_attachments_json,
       m.created_at AS latest_created_at
     FROM threads t
     LEFT JOIN messages m ON m.id = (
       SELECT id FROM messages
       WHERE thread_id = t.thread_id
       ORDER BY created_at DESC
       LIMIT 1
     )
     ${filter.where}
     ORDER BY t.latest_at DESC
     LIMIT 100`
  );
  const [result, counts] = await Promise.all([
    bindStatement(statement, filter.params).all(),
    getMailboxCounts(env)
  ]);

  return json({
    ok: true,
    mailbox: filter.mailbox,
    query: filter.query,
    counts,
    threads: (result.results || []).map((row) => ({
      threadId: row.thread_id,
      subject: row.subject,
      normalizedSubject: row.normalized_subject,
      participants: safeJson(row.participants_json, []),
      latestAt: row.latest_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
      trashedAt: row.trashed_at,
      folder: folderForThread(row),
      unreadCount: row.unread_count,
      latestMessage: row.latest_message_id ? {
        id: row.latest_message_id,
        direction: row.latest_direction,
        from: row.latest_from,
        to: safeJson(row.latest_to, []),
        snippet: row.latest_snippet,
        attachments: safeJson(row.latest_attachments_json, []),
        createdAt: row.latest_created_at
      } : null
    }))
  });
}

async function getThread(env, threadId) {
  const thread = await env.INBOX_DB.prepare(
    "SELECT * FROM threads WHERE thread_id = ?"
  ).bind(threadId).first();

  if (!thread) {
    return json({ ok: false, error: "Thread not found" }, 404);
  }

  const result = await env.INBOX_DB.prepare(
    `SELECT * FROM messages
     WHERE thread_id = ?
     ORDER BY created_at ASC`
  ).bind(threadId).all();

  const messages = result.results || [];
  const folder = folderForThread({
    ...thread,
    has_inbound: messages.some((message) => message.direction === "inbound") ? 1 : 0,
    has_outbound: messages.some((message) => message.direction === "outbound") ? 1 : 0
  });

  return json({
    ok: true,
    thread: {
      threadId: thread.thread_id,
      subject: thread.subject,
      normalizedSubject: thread.normalized_subject,
      participants: safeJson(thread.participants_json, []),
      latestAt: thread.latest_at,
      createdAt: thread.created_at,
      updatedAt: thread.updated_at,
      archivedAt: thread.archived_at,
      trashedAt: thread.trashed_at,
      folder,
      unreadCount: thread.unread_count
    },
    messages: messages.map(formatMessage)
  });
}

async function setThreadReadState(env, threadId, read) {
  const now = new Date().toISOString();
  if (read) {
    await env.INBOX_DB.batch([
      env.INBOX_DB.prepare(
        "UPDATE messages SET read_at = ? WHERE thread_id = ? AND direction = 'inbound' AND (read_at IS NULL OR read_at = '')"
      ).bind(now, threadId),
      env.INBOX_DB.prepare(
        "UPDATE threads SET unread_count = 0, updated_at = ? WHERE thread_id = ?"
      ).bind(now, threadId)
    ]);
    return json({ ok: true, read: true });
  }

  const inbound = await env.INBOX_DB.prepare(
    "SELECT COUNT(*) AS count FROM messages WHERE thread_id = ? AND direction = 'inbound'"
  ).bind(threadId).first();
  const unreadCount = Number(inbound && inbound.count || 0);
  await env.INBOX_DB.batch([
    env.INBOX_DB.prepare(
      "UPDATE messages SET read_at = '' WHERE thread_id = ? AND direction = 'inbound'"
    ).bind(threadId),
    env.INBOX_DB.prepare(
      "UPDATE threads SET unread_count = ?, updated_at = ? WHERE thread_id = ?"
    ).bind(unreadCount, now, threadId)
  ]);

  return json({ ok: true, read: false, unreadCount });
}

async function setThreadArchiveState(env, threadId, archived) {
  const now = new Date().toISOString();
  const archivedAt = archived ? now : "";
  await env.INBOX_DB.prepare(
    `UPDATE threads
     SET archived_at = ?, trashed_at = '', updated_at = ?
     WHERE thread_id = ?`
  ).bind(archivedAt, now, threadId).run();

  return json({ ok: true, archived, archivedAt });
}

async function setThreadTrashState(env, threadId, trashed) {
  const now = new Date().toISOString();
  const trashedAt = trashed ? now : "";
  await env.INBOX_DB.prepare(
    `UPDATE threads
     SET trashed_at = ?, archived_at = '', updated_at = ?
     WHERE thread_id = ?`
  ).bind(trashedAt, now, threadId).run();

  return json({ ok: true, trashed, trashedAt });
}

async function deleteThread(env, threadId) {
  await env.INBOX_DB.batch([
    env.INBOX_DB.prepare("DELETE FROM messages WHERE thread_id = ?").bind(threadId),
    env.INBOX_DB.prepare("DELETE FROM threads WHERE thread_id = ?").bind(threadId)
  ]);

  return json({ ok: true, deleted: true });
}

async function recordSent(env, body) {
  const now = new Date().toISOString();
  const subject = String(body.subject || "").trim();
  const from = normalizeEmailAddress(body.from);
  const to = parseAddressList(body.to);

  if (!from || !to.length || !subject || !String(body.text || body.html || "").trim()) {
    return json({ ok: false, error: "from, to, subject, and body are required" }, 400);
  }

  const record = {
    id: crypto.randomUUID(),
    direction: "outbound",
    from,
    to,
    cc: parseAddressList(body.cc),
    bcc: parseAddressList(body.bcc),
    replyTo: normalizeEmailAddress(body.replyTo || body.reply_to),
    subject,
    normalizedSubject: normalizeSubject(subject),
    messageId: String(body.messageId || "").trim() || `<${crypto.randomUUID()}@better-email-routing.local>`,
    inReplyTo: String(body.inReplyTo || "").trim(),
    referencesHeader: String(body.references || body.referencesHeader || "").trim(),
    dateHeader: "",
    receivedAt: "",
    sentAt: now,
    snippet: makeSnippet(body.text || stripHtml(body.html || "")),
    textBody: trimForStorage(body.text || ""),
    htmlBody: trimForStorage(body.html || ""),
    attachments: normalizeAttachmentMetadata(body.attachments),
    rawSize: 0,
    readAt: now,
    cloudflareStatus: body.cloudflare || null,
    createdAt: now,
    requestedThreadId: String(body.threadId || "").trim()
  };

  await storeMessage(env, record);
  return json({ ok: true, message: formatMessageForRecord(record) });
}

async function storeMessage(env, record) {
  const threadId = record.requestedThreadId || await resolveThreadId(env, record);
  const existing = await env.INBOX_DB.prepare(
    "SELECT participants_json, unread_count FROM threads WHERE thread_id = ?"
  ).bind(threadId).first();

  const participants = mergeParticipants(
    safeJson(existing && existing.participants_json, []),
    [record.from, ...record.to, ...record.cc, ...record.bcc].filter(Boolean)
  );
  const unreadCount = record.direction === "inbound"
    ? Number(existing && existing.unread_count || 0) + 1
    : Number(existing && existing.unread_count || 0);
  const latestAt = record.receivedAt || record.sentAt || record.createdAt;

  const statements = [
    env.INBOX_DB.prepare(
      `INSERT INTO threads (
         thread_id, subject, normalized_subject, participants_json,
         latest_at, created_at, updated_at, unread_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         subject = excluded.subject,
         normalized_subject = excluded.normalized_subject,
         participants_json = excluded.participants_json,
         latest_at = excluded.latest_at,
         updated_at = excluded.updated_at,
         unread_count = excluded.unread_count`
    ).bind(
      threadId,
      record.subject,
      record.normalizedSubject,
      JSON.stringify(participants),
      latestAt,
      record.createdAt,
      record.createdAt,
      unreadCount
    ),
    env.INBOX_DB.prepare(
      `INSERT OR IGNORE INTO messages (
         id, thread_id, direction, from_addr, to_addrs, cc_addrs, bcc_addrs,
         reply_to, subject, normalized_subject, message_id, in_reply_to,
         references_header, date_header, received_at, sent_at, snippet,
         text_body, html_body, attachments_json, raw_size, read_at, cloudflare_status_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      record.id,
      threadId,
      record.direction,
      record.from,
      JSON.stringify(record.to),
      JSON.stringify(record.cc),
      JSON.stringify(record.bcc),
      record.replyTo,
      record.subject,
      record.normalizedSubject,
      record.messageId,
      record.inReplyTo,
      record.referencesHeader,
      record.dateHeader,
      record.receivedAt,
      record.sentAt,
      record.snippet,
      record.textBody,
      record.htmlBody,
      JSON.stringify(normalizeAttachmentMetadata(record.attachments)),
      record.rawSize,
      record.readAt,
      record.cloudflareStatus ? JSON.stringify(record.cloudflareStatus) : "",
      record.createdAt
    )
  ];

  if (record.direction === "inbound") {
    statements.push(
      env.INBOX_DB.prepare(
        "UPDATE threads SET archived_at = '', trashed_at = '' WHERE thread_id = ?"
      ).bind(threadId)
    );
  }

  await env.INBOX_DB.batch(statements);
}

async function resolveThreadId(env, record) {
  const referencedIds = [
    ...extractMessageIds(record.inReplyTo),
    ...extractMessageIds(record.referencesHeader)
  ].reverse().slice(0, 20);

  for (const messageId of referencedIds) {
    const existing = await env.INBOX_DB.prepare(
      "SELECT thread_id FROM messages WHERE message_id = ? LIMIT 1"
    ).bind(messageId).first();
    if (existing && existing.thread_id) {
      return existing.thread_id;
    }
  }

  const otherParty = record.direction === "inbound"
    ? record.from
    : (record.to[0] || "");
  const basis = `${record.normalizedSubject}|${otherParty.toLowerCase()}`;
  return `th_${await sha256Short(basis)}`;
}

function normalizeEmailAddress(value) {
  const match = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

function normalizeAttachmentMetadata(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((attachment) => ({
    filename: String(attachment.filename || "attachment").slice(0, 180),
    contentType: String(attachment.contentType || "application/octet-stream").slice(0, 120),
    disposition: String(attachment.disposition || "attachment").slice(0, 24),
    contentId: String(attachment.contentId || "").slice(0, 180),
    size: Math.max(0, Number(attachment.size || 0))
  })).slice(0, 40);
}

function parseAddressList(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(parseAddressList);
  }
  return String(value)
    .split(/[,;\n]/)
    .map(normalizeEmailAddress)
    .filter(Boolean);
}

function normalizeSubject(subject) {
  return String(subject || "(no subject)")
    .replace(/^\s*(re|fw|fwd):\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeMessageId(value) {
  const ids = extractMessageIds(value);
  return ids[0] || "";
}

function extractMessageIds(value) {
  return String(value || "").match(/<[^>]+>/g) || [];
}

function makeSnippet(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function trimForStorage(value) {
  return String(value || "").slice(0, 200000);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function mergeParticipants(existing, next) {
  const seen = new Set();
  return [...existing, ...next]
    .map(normalizeEmailAddress)
    .filter((email) => {
      if (!email || seen.has(email)) {
        return false;
      }
      seen.add(email);
      return true;
    })
    .slice(0, 40);
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch (error) {
    return fallback;
  }
}

function bindStatement(statement, params) {
  return params.length ? statement.bind(...params) : statement;
}

async function getMailboxCounts(env) {
  const mailboxes = ["inbox", "sent", "all", "archive", "trash"];
  const entries = await Promise.all(mailboxes.map(async (mailbox) => {
    const filter = buildThreadListFilter({ mailbox, query: "" });
    const row = await bindStatement(
      env.INBOX_DB.prepare(`SELECT COUNT(*) AS count FROM threads t ${filter.where}`),
      filter.params
    ).first();
    return [mailbox, Number(row && row.count || 0)];
  }));
  return Object.fromEntries(entries);
}

function folderForThread(row) {
  if (row.trashed_at) {
    return "trash";
  }
  if (row.archived_at) {
    return "archive";
  }
  if (!Number(row.has_inbound || 0) && Number(row.has_outbound || 0)) {
    return "sent";
  }
  return "inbox";
}

function formatMessage(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    direction: row.direction,
    from: row.from_addr,
    to: safeJson(row.to_addrs, []),
    cc: safeJson(row.cc_addrs, []),
    bcc: safeJson(row.bcc_addrs, []),
    replyTo: row.reply_to,
    subject: row.subject,
    messageId: row.message_id,
    inReplyTo: row.in_reply_to,
    references: row.references_header,
    dateHeader: row.date_header,
    receivedAt: row.received_at,
    sentAt: row.sent_at,
    snippet: row.snippet,
    text: row.text_body,
    html: row.html_body,
    attachments: safeJson(row.attachments_json, []),
    rawSize: row.raw_size,
    readAt: row.read_at,
    cloudflare: safeJson(row.cloudflare_status_json, null),
    createdAt: row.created_at
  };
}

function formatMessageForRecord(record) {
  return {
    id: record.id,
    direction: record.direction,
    from: record.from,
    to: record.to,
    cc: record.cc,
    bcc: record.bcc,
    subject: record.subject,
    snippet: record.snippet,
    text: record.textBody,
    html: record.htmlBody,
    attachments: normalizeAttachmentMetadata(record.attachments),
    createdAt: record.createdAt
  };
}

async function sha256Short(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

async function isAuthorized(request, env) {
  const secret = env.MAILBOX_API_SECRET || "";
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!secret || !token) {
    return false;
  }
  return timingSafeEqual(token, secret);
}

async function timingSafeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < leftBytes.length; i += 1) {
    diff |= leftBytes[i] ^ rightBytes[i];
  }
  return diff === 0;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS
  });
}
