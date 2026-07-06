const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const root = __dirname;
const publicRoot = path.join(root, "public");
const dataRoot = path.join(root, "data");
const historyPath = path.join(dataRoot, "sent.json");

loadEnv(path.join(root, ".env"));

const port = Number(process.env.PORT || 8899);
const host = process.env.HOST || "127.0.0.1";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const apiToken = process.env.CLOUDFLARE_API_TOKEN || "";
const defaultFrom = process.env.DEFAULT_FROM || "inbox@example.com";
const defaultTo = process.env.DEFAULT_TO || "";
const mailboxWorkerUrl = normalizeBaseUrl(process.env.MAILBOX_WORKER_URL || "");
const mailboxApiSecret = process.env.MAILBOX_API_SECRET || "";
const senderProfiles = buildSenderProfiles();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

fs.mkdirSync(dataRoot, { recursive: true });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: "Server error", detail: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Better Email Routing is running at http://${host}:${port}`);
});

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (!isSameOrigin(req)) {
    sendJson(res, 403, { ok: false, error: "Cross-origin requests are blocked" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      ok: true,
      defaultFrom,
      defaultTo,
      accountId: redact(accountId),
      hasToken: senderProfiles.some((profile) => Boolean(profile.accountId && profile.apiToken)),
      senderProfiles: senderProfiles.map((profile) => ({
        from: profile.from,
        label: profile.label,
        accountId: redact(profile.accountId),
        hasToken: Boolean(profile.apiToken)
      })),
      fromAddresses: senderProfiles.map((profile) => profile.from),
      inbox: {
        enabled: Boolean(mailboxWorkerUrl && mailboxApiSecret),
        address: defaultFrom
      }
    });
    return;
  }

  if (url.pathname.startsWith("/api/inbox")) {
    await handleInboxApi(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/history") {
    sendJson(res, 200, { ok: true, messages: readHistory() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/send") {
    const body = await readJson(req);
    const draft = normalizeDraft(body);
    const validation = validateDraft(draft);

    if (!validation.ok) {
      sendJson(res, 400, validation);
      return;
    }

    const result = await sendWithCloudflare(draft);
    const record = {
      id: randomUUID(),
      sentAt: new Date().toISOString(),
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      from: draft.from,
      subject: draft.subject,
      text: draft.text,
      threadId: draft.threadId,
      cloudflare: result.body,
      httpStatus: result.status
    };

    appendHistory(record);
    const inboxRecord = result.ok ? await recordSentInMailbox(draft, result.body).catch((error) => ({
      ok: false,
      error: error.message
    })) : null;

    sendJson(res, result.status >= 200 && result.status < 300 ? 200 : result.status, {
      ok: result.ok,
      message: result.ok ? "Accepted by Cloudflare Email Service" : "Cloudflare rejected the send",
      record,
      inboxRecord,
      cloudflare: result.body
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "API route not found" });
}

function normalizeDraft(body) {
  const text = String(body.text || "").trim();
  const html = String(body.html || "").trim() || textToHtml(text);

  return {
    to: parseAddressList(body.to),
    cc: parseAddressList(body.cc),
    bcc: parseAddressList(body.bcc),
    from: String(body.from || defaultFrom).trim(),
    reply_to: String(body.reply_to || body.replyTo || "").trim(),
    subject: String(body.subject || "").trim(),
    text,
    html,
    threadId: String(body.threadId || "").trim(),
    inReplyTo: String(body.inReplyTo || "").trim(),
    references: String(body.references || "").trim()
  };
}

function validateDraft(draft) {
  const recipients = [...draft.to, ...draft.cc, ...draft.bcc];

  if (!draft.from) {
    return { ok: false, error: "A sender address is required" };
  }

  if (!isEmail(draft.from)) {
    return { ok: false, error: "Sender address is not valid" };
  }

  const profile = findSenderProfile(draft.from);
  if (!profile) {
    return { ok: false, error: `Sender address is not configured in .env: ${draft.from}` };
  }

  if (!profile.accountId || !profile.apiToken) {
    return { ok: false, error: `Cloudflare credentials are missing for ${draft.from}` };
  }

  if (draft.reply_to && !isEmail(draft.reply_to)) {
    return { ok: false, error: "Reply-to address is not valid" };
  }

  if (recipients.length === 0) {
    return { ok: false, error: "At least one recipient is required" };
  }

  if (recipients.length > 50) {
    return { ok: false, error: "Cloudflare allows up to 50 combined recipients" };
  }

  const badRecipient = recipients.find((email) => !isEmail(email));
  if (badRecipient) {
    return { ok: false, error: `Recipient address is not valid: ${badRecipient}` };
  }

  if (!draft.subject) {
    return { ok: false, error: "A subject is required" };
  }

  if (!draft.text && !draft.html) {
    return { ok: false, error: "A message body is required" };
  }

  return { ok: true };
}

async function sendWithCloudflare(draft) {
  const profile = findSenderProfile(draft.from);
  const payload = {
    to: collapseAddressList(draft.to),
    from: draft.from,
    subject: draft.subject,
    html: draft.html,
    text: draft.text
  };

  if (draft.cc.length) {
    payload.cc = collapseAddressList(draft.cc);
  }

  if (draft.bcc.length) {
    payload.bcc = collapseAddressList(draft.bcc);
  }

  if (draft.reply_to) {
    payload.reply_to = draft.reply_to;
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${profile.accountId}/email/sending/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${profile.apiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const body = await response.json().catch(() => ({
    success: false,
    errors: [{ message: "Cloudflare returned a non-JSON response" }]
  }));

  return {
    ok: response.ok && body.success !== false,
    status: response.status,
    body
  };
}

function buildSenderProfiles() {
  const profiles = [];
  addSenderProfile(profiles, {
    from: defaultFrom,
    label: process.env.DEFAULT_FROM_LABEL || defaultFrom,
    accountId,
    apiToken
  });

  for (let index = 1; index <= 20; index += 1) {
    const prefix = `SENDER_PROFILE_${index}_`;
    addSenderProfile(profiles, {
      from: process.env[`${prefix}FROM`],
      label: process.env[`${prefix}LABEL`] || process.env[`${prefix}FROM`],
      accountId: process.env[`${prefix}CLOUDFLARE_ACCOUNT_ID`] || process.env[`${prefix}ACCOUNT_ID`] || "",
      apiToken: process.env[`${prefix}CLOUDFLARE_API_TOKEN`] || process.env[`${prefix}API_TOKEN`] || ""
    });
  }

  return profiles;
}

function addSenderProfile(profiles, profile) {
  const from = String(profile.from || "").trim();
  if (!from) {
    return;
  }

  const normalized = from.toLowerCase();
  const nextProfile = {
    from,
    label: String(profile.label || from).trim(),
    accountId: String(profile.accountId || "").trim(),
    apiToken: String(profile.apiToken || "").trim()
  };
  const existingIndex = profiles.findIndex((item) => item.from.toLowerCase() === normalized);
  if (existingIndex >= 0) {
    profiles[existingIndex] = nextProfile;
    return;
  }

  profiles.push(nextProfile);
}

function findSenderProfile(from) {
  const normalized = String(from || "").trim().toLowerCase();
  return senderProfiles.find((profile) => profile.from.toLowerCase() === normalized) || null;
}

async function handleInboxApi(req, res, url) {
  const workerPath = url.pathname.replace(/^\/api\/inbox/, "/api");

  if (req.method === "GET" && workerPath === "/api/health") {
    const result = await callMailboxWorker("/api/health", { auth: false });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "GET" && workerPath === "/api/threads") {
    const result = await callMailboxWorker(`/api/threads${url.search}`);
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "GET" && /^\/api\/threads\/[^/]+$/.test(workerPath)) {
    const result = await callMailboxWorker(workerPath);
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "POST" && workerPath === "/api/reprocess/raw-bodies") {
    const body = await readJson(req);
    const result = await callMailboxWorker(workerPath, { method: "POST", body });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "PATCH" && /^\/api\/threads\/[^/]+\/(read|archive|trash)$/.test(workerPath)) {
    const body = await readJson(req);
    const result = await callMailboxWorker(workerPath, { method: "PATCH", body });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "DELETE" && /^\/api\/threads\/[^/]+$/.test(workerPath)) {
    const result = await callMailboxWorker(workerPath, { method: "DELETE" });
    sendJson(res, result.status, result.body);
    return;
  }

  sendJson(res, 404, { ok: false, error: "Inbox route not found" });
}

async function recordSentInMailbox(draft, cloudflare) {
  if (!mailboxWorkerUrl || !mailboxApiSecret) {
    return { ok: false, skipped: true, error: "Inbox Worker is not configured" };
  }

  const result = await callMailboxWorker("/api/sent", {
    method: "POST",
    body: {
      threadId: draft.threadId,
      from: draft.from,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      reply_to: draft.reply_to,
      subject: draft.subject,
      text: draft.text,
      html: draft.html,
      inReplyTo: draft.inReplyTo,
      references: draft.references,
      cloudflare
    }
  });

  return result.body;
}

async function callMailboxWorker(workerPath, options = {}) {
  if (!mailboxWorkerUrl) {
    return { status: 503, body: { ok: false, error: "MAILBOX_WORKER_URL is not configured in .env" } };
  }

  const needsAuth = options.auth !== false;
  if (needsAuth && !mailboxApiSecret) {
    return { status: 503, body: { ok: false, error: "MAILBOX_API_SECRET is not configured in .env" } };
  }

  const headers = {
    Accept: "application/json"
  };
  if (needsAuth) {
    headers.Authorization = `Bearer ${mailboxApiSecret}`;
  }
  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${mailboxWorkerUrl}${workerPath}`, {
    method: options.method || (options.body ? "POST" : "GET"),
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json().catch(() => ({
    ok: false,
    error: "Mailbox Worker returned a non-JSON response"
  }));

  return { status: response.status, body };
}

function serveStatic(req, res, url) {
  if (url.pathname === "/favicon.ico") {
    res.writeHead(204, { "cache-control": "no-store" });
    res.end();
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const decoded = decodeURIComponent(requested);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicRoot, normalized);

  if (!filePath.startsWith(publicRoot)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "cache-control": "no-store",
      "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream"
    });
    res.end(data);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        req.destroy(new Error("Request body is too large"));
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON request body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(data, null, 2));
}

function parseAddressList(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(parseAddressList);
  }

  return String(value)
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function collapseAddressList(addresses) {
  return addresses.length === 1 ? addresses[0] : addresses;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function textToHtml(value) {
  return String(value || "")
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(historyPath, "utf8"));
  } catch (error) {
    return [];
  }
}

function appendHistory(record) {
  const history = readHistory();
  history.unshift(record);
  fs.writeFileSync(historyPath, JSON.stringify(history.slice(0, 100), null, 2));
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function redact(value) {
  if (!value) {
    return "";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    return originUrl.host === req.headers.host;
  } catch (error) {
    return false;
  }
}
