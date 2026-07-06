const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const packageRoot = __dirname;
const publicRoot = path.join(packageRoot, "public");
let runtimeOptions = {};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function createServer(options = {}) {
  runtimeOptions = { ...runtimeOptions, ...options };
  ensureDataRoot();

  return http.createServer(async (req, res) => {
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
}

function startServer(options = {}) {
  runtimeOptions = { ...runtimeOptions, ...options };
  ensureDataRoot();
  const config = readRuntimeConfig();
  const host = options.host || config.host || "127.0.0.1";
  const port = options.port ?? config.port ?? 8899;
  const server = createServer(options);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      const url = `http://${host}:${resolvedPort}`;
      console.log(`Better Email Routing is running at ${url}`);
      resolve({ server, url, host, port: resolvedPort });
    });
  });
}

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
    sendJson(res, 200, configResponse());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/setup/status") {
    sendJson(res, 200, setupStatusResponse());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/setup/config") {
    const body = await readJson(req);
    const saved = writeSetupConfig(body);
    sendJson(res, saved.ok ? 200 : 400, saved.ok ? setupStatusResponse() : saved);
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

function configResponse() {
  const config = readRuntimeConfig();
  return {
    ok: true,
    defaultFrom: config.defaultFrom,
    defaultTo: config.defaultTo,
    accountId: redact(config.accountId),
    hasToken: config.senderProfiles.some((profile) => Boolean(profile.accountId && profile.apiToken)),
    senderProfiles: config.senderProfiles.map((profile) => ({
      from: profile.from,
      label: profile.label,
      accountId: redact(profile.accountId),
      hasToken: Boolean(profile.apiToken)
    })),
    fromAddresses: config.senderProfiles.map((profile) => profile.from),
    inbox: {
      enabled: Boolean(config.mailboxWorkerUrl && config.mailboxApiSecret),
      address: config.defaultFrom
    }
  };
}

function setupStatusResponse() {
  const runtime = getRuntime();
  const config = readRuntimeConfig();
  const fromReady = isEmail(config.defaultFrom);
  const tokenReady = config.senderProfiles.some((profile) => Boolean(profile.from && profile.accountId && profile.apiToken));
  const workerReady = Boolean(config.mailboxWorkerUrl && config.mailboxApiSecret);
  const cloudflareReady = Boolean(fromReady && tokenReady);

  return {
    ok: true,
    appHome: runtime.appHome,
    configPath: runtime.configPath,
    configured: Boolean(cloudflareReady && workerReady),
    form: {
      defaultFrom: config.defaultFrom,
      defaultTo: config.defaultTo,
      defaultFromLabel: config.defaultFromLabel,
      accountId: config.accountId,
      mailboxWorkerUrl: config.mailboxWorkerUrl,
      hasCloudflareApiToken: Boolean(config.apiToken),
      hasMailboxApiSecret: Boolean(config.mailboxApiSecret)
    },
    steps: [
      {
        id: "local-config",
        label: "Local app config",
        state: runtime.configExists ? "ready" : "missing",
        detail: runtime.configExists ? "Settings are stored outside the app bundle." : "Save setup once to create the local config file."
      },
      {
        id: "sender",
        label: "Cloudflare sender",
        state: cloudflareReady ? "ready" : "missing",
        detail: cloudflareReady ? `${config.senderProfiles.length} sender profile${config.senderProfiles.length === 1 ? "" : "s"} configured.` : "Add a sender address, account ID, and Email Service API token."
      },
      {
        id: "mailbox-worker",
        label: "Mailbox Worker",
        state: workerReady ? "ready" : "missing",
        detail: workerReady ? "Inbox API is connected." : "Add the deployed Worker URL and mailbox API secret to read local mail."
      },
      {
        id: "oauth",
        label: "Connect Cloudflare",
        state: "planned",
        detail: "A guided OAuth setup can replace manual tokens in a future release."
      }
    ],
    docs: {
      cloudflareOauth: "https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/",
      cloudflareEmailService: "https://developers.cloudflare.com/email-service/"
    }
  };
}

function normalizeDraft(body) {
  const config = readRuntimeConfig();
  const text = String(body.text || "").trim();
  const html = String(body.html || "").trim() || textToHtml(text);

  return {
    to: parseAddressList(body.to),
    cc: parseAddressList(body.cc),
    bcc: parseAddressList(body.bcc),
    from: String(body.from || config.defaultFrom).trim(),
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
  const profile = findSenderProfile(draft.from);

  if (!draft.from) {
    return { ok: false, error: "A sender address is required" };
  }

  if (!isEmail(draft.from)) {
    return { ok: false, error: "Sender address is not valid" };
  }

  if (!profile) {
    return { ok: false, error: `Sender address is not configured locally: ${draft.from}` };
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

function buildSenderProfiles(env) {
  const profiles = [];
  addSenderProfile(profiles, {
    from: env.DEFAULT_FROM,
    label: env.DEFAULT_FROM_LABEL || env.DEFAULT_FROM,
    accountId: env.CLOUDFLARE_ACCOUNT_ID || "",
    apiToken: env.CLOUDFLARE_API_TOKEN || ""
  });

  for (let index = 1; index <= 20; index += 1) {
    const prefix = `SENDER_PROFILE_${index}_`;
    addSenderProfile(profiles, {
      from: env[`${prefix}FROM`],
      label: env[`${prefix}LABEL`] || env[`${prefix}FROM`],
      accountId: env[`${prefix}CLOUDFLARE_ACCOUNT_ID`] || env[`${prefix}ACCOUNT_ID`] || "",
      apiToken: env[`${prefix}CLOUDFLARE_API_TOKEN`] || env[`${prefix}API_TOKEN`] || ""
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
  const config = readRuntimeConfig();
  const normalized = String(from || "").trim().toLowerCase();
  return config.senderProfiles.find((profile) => profile.from.toLowerCase() === normalized) || null;
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
  const config = readRuntimeConfig();
  if (!config.mailboxWorkerUrl || !config.mailboxApiSecret) {
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
  const config = readRuntimeConfig();
  if (!config.mailboxWorkerUrl) {
    return { status: 503, body: { ok: false, error: "MAILBOX_WORKER_URL is not configured locally" } };
  }

  const needsAuth = options.auth !== false;
  if (needsAuth && !config.mailboxApiSecret) {
    return { status: 503, body: { ok: false, error: "MAILBOX_API_SECRET is not configured locally" } };
  }

  const headers = {
    Accept: "application/json"
  };
  if (needsAuth) {
    headers.Authorization = `Bearer ${config.mailboxApiSecret}`;
  }
  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${config.mailboxWorkerUrl}${workerPath}`, {
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
  const runtime = getRuntime();
  try {
    return JSON.parse(fs.readFileSync(runtime.historyPath, "utf8"));
  } catch (error) {
    return [];
  }
}

function appendHistory(record) {
  const runtime = getRuntime();
  ensureDataRoot();
  const history = readHistory();
  history.unshift(record);
  fs.writeFileSync(runtime.historyPath, JSON.stringify(history.slice(0, 100), null, 2));
}

function getRuntime() {
  const appHome = resolveAppHome();
  return {
    appHome,
    configPath: path.join(appHome, ".env"),
    configExists: fs.existsSync(path.join(appHome, ".env")),
    dataRoot: path.join(appHome, "data"),
    historyPath: path.join(appHome, "data", "sent.json")
  };
}

function resolveAppHome() {
  return path.resolve(runtimeOptions.homeDir || process.env.BETTER_EMAIL_ROUTING_HOME || packageRoot);
}

function ensureDataRoot() {
  const runtime = getRuntime();
  fs.mkdirSync(runtime.dataRoot, { recursive: true });
}

function readRuntimeEnv() {
  const runtime = getRuntime();
  return {
    ...readEnvFile(path.join(packageRoot, ".env")),
    ...readEnvFile(runtime.configPath),
    ...process.env
  };
}

function readRuntimeConfig() {
  const env = readRuntimeEnv();
  const defaultFrom = env.DEFAULT_FROM || "inbox@example.com";
  return {
    host: env.HOST || "127.0.0.1",
    port: Number(env.PORT || 8899),
    accountId: env.CLOUDFLARE_ACCOUNT_ID || "",
    apiToken: env.CLOUDFLARE_API_TOKEN || "",
    defaultFrom,
    defaultFromLabel: env.DEFAULT_FROM_LABEL || defaultFrom,
    defaultTo: env.DEFAULT_TO || "",
    mailboxWorkerUrl: normalizeBaseUrl(env.MAILBOX_WORKER_URL || ""),
    mailboxApiSecret: env.MAILBOX_API_SECRET || "",
    senderProfiles: buildSenderProfiles(env)
  };
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const env = {};
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
    env[key] = value;
  }
  return env;
}

function writeSetupConfig(body) {
  const runtime = getRuntime();
  const current = readRuntimeEnv();
  const next = readEnvFile(runtime.configPath);
  const values = normalizeSetupInput(body);
  const validation = validateSetupInput(values);

  if (!validation.ok) {
    return validation;
  }

  setIfPresent(next, "DEFAULT_FROM", values.defaultFrom);
  setIfPresent(next, "DEFAULT_FROM_LABEL", values.defaultFromLabel);
  setIfPresent(next, "DEFAULT_TO", values.defaultTo);
  setIfPresent(next, "CLOUDFLARE_ACCOUNT_ID", values.accountId);
  setIfPresent(next, "MAILBOX_WORKER_URL", values.mailboxWorkerUrl);
  setIfPresent(next, "MAILBOX_API_SECRET", values.mailboxApiSecret || current.MAILBOX_API_SECRET || "");
  setIfPresent(next, "CLOUDFLARE_API_TOKEN", values.cloudflareApiToken || current.CLOUDFLARE_API_TOKEN || "");

  const output = [
    "# Better Email Routing local config",
    "# Stored on this computer. Do not commit this file.",
    ...Object.keys(next)
      .filter((key) => next[key] !== "")
      .sort()
      .map((key) => `${key}=${quoteEnv(next[key])}`),
    ""
  ].join("\n");

  fs.mkdirSync(runtime.appHome, { recursive: true });
  fs.writeFileSync(runtime.configPath, output, { mode: 0o600 });
  ensureDataRoot();
  return { ok: true };
}

function normalizeSetupInput(body) {
  return {
    defaultFrom: String(body.defaultFrom || "").trim(),
    defaultFromLabel: String(body.defaultFromLabel || "").trim(),
    defaultTo: String(body.defaultTo || "").trim(),
    accountId: String(body.accountId || "").trim(),
    cloudflareApiToken: String(body.cloudflareApiToken || "").trim(),
    mailboxWorkerUrl: normalizeBaseUrl(body.mailboxWorkerUrl || ""),
    mailboxApiSecret: String(body.mailboxApiSecret || "").trim()
  };
}

function validateSetupInput(values) {
  if (!values.defaultFrom || !isEmail(values.defaultFrom)) {
    return { ok: false, error: "Use a valid sender email address." };
  }

  const badDefaultTo = parseAddressList(values.defaultTo).find((email) => !isEmail(email));
  if (badDefaultTo) {
    return { ok: false, error: `Default recipient is not valid: ${badDefaultTo}` };
  }

  if (values.accountId && !/^[a-f0-9]{32}$/i.test(values.accountId)) {
    return { ok: false, error: "Cloudflare account ID should be the 32-character account ID." };
  }

  if (values.mailboxWorkerUrl) {
    try {
      const parsed = new URL(values.mailboxWorkerUrl);
      if (!/^https?:$/.test(parsed.protocol)) {
        return { ok: false, error: "Mailbox Worker URL must start with http:// or https://." };
      }
    } catch (error) {
      return { ok: false, error: "Mailbox Worker URL is not valid." };
    }
  }

  return { ok: true };
}

function setIfPresent(target, key, value) {
  if (value === undefined) {
    return;
  }
  target[key] = String(value || "");
}

function quoteEnv(value) {
  const raw = String(value || "");
  if (!raw || /^[A-Za-z0-9_@/:.,+=-]+$/.test(raw)) {
    return raw;
  }
  return JSON.stringify(raw);
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

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  createServer,
  startServer,
  readRuntimeConfig,
  readRuntimeEnv,
  setupStatusResponse,
  writeSetupConfig
};
