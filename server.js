const http = require("http");
const fs = require("fs");
const path = require("path");
const { createHash, randomBytes, randomUUID } = require("crypto");
const packageInfo = require("./package.json");

const packageRoot = __dirname;
const publicRoot = path.join(packageRoot, "public");
const defaultUpdateManifestUrl = "https://downloads.valen-systems.com/better-email-routing/latest.json";
let runtimeOptions = {};
const oauthSessions = new Map();

const cloudflareOAuth = {
  authUrl: "https://dash.cloudflare.com/oauth2/auth",
  tokenUrl: "https://dash.cloudflare.com/oauth2/token",
  revokeUrl: "https://dash.cloudflare.com/oauth2/revoke",
  userInfoUrl: "https://dash.cloudflare.com/oauth2/userinfo"
};

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

  if (req.method === "POST" && url.pathname === "/api/oauth/start") {
    const result = startCloudflareOAuth(req);
    sendJson(res, result.ok ? 200 : 400, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/oauth/callback") {
    await handleCloudflareOAuthCallback(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/oauth/status") {
    sendJson(res, 200, { ok: true, oauth: oauthStatusResponse() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/oauth/disconnect") {
    const result = disconnectCloudflareOAuth();
    sendJson(res, result.ok ? 200 : 500, result.ok ? { ok: true, oauth: oauthStatusResponse() } : result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cloudflare/accounts") {
    const result = await listConnectedCloudflareAccounts();
    sendJson(res, result.ok ? 200 : result.status || 500, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/update/check") {
    const result = await checkForUpdate();
    sendJson(res, result.ok ? 200 : result.status || 502, result);
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
    await refreshOAuthTokenIfNeeded().catch(() => null);
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
  const oauth = oauthStatusResponse();
  return {
    ok: true,
    defaultFrom: config.defaultFrom,
    defaultTo: config.defaultTo,
    version: packageInfo.version,
    updateManifestUrl: config.updateManifestUrl,
    accountId: redact(config.accountId),
    hasToken: config.senderProfiles.some((profile) => Boolean(profile.accountId && profile.apiToken)),
    senderProfiles: config.senderProfiles.map((profile) => ({
      from: profile.from,
      label: profile.label,
      accountId: redact(profile.accountId),
      hasToken: Boolean(profile.apiToken)
    })),
    fromAddresses: config.senderProfiles.map((profile) => profile.from),
    oauth,
    inbox: {
      enabled: Boolean(config.mailboxWorkerUrl && config.mailboxApiSecret),
      address: config.defaultFrom
    }
  };
}

async function checkForUpdate() {
  const config = readRuntimeConfig();
  const manifestUrl = config.updateManifestUrl || defaultUpdateManifestUrl;
  let response;

  try {
    response = await fetch(manifestUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: `Could not reach the update manifest: ${error.message}`
    };
  }

  const manifest = await response.json().catch(() => null);
  if (!response.ok || !manifest || typeof manifest !== "object") {
    return {
      ok: false,
      status: response.status || 502,
      error: `Update manifest returned HTTP ${response.status}.`
    };
  }

  const latestVersion = String(manifest.version || "").trim();
  const currentVersion = String(packageInfo.version || "0.0.0").trim();
  const downloadUrl = String(
    manifest.downloadUrl ||
    manifest.dmgUrl ||
    manifest.files && manifest.files.dmg ||
    ""
  ).trim();

  return {
    ok: true,
    currentVersion,
    latestVersion,
    updateAvailable: Boolean(latestVersion && compareVersions(latestVersion, currentVersion) > 0),
    downloadUrl,
    manifestUrl,
    releaseDate: manifest.releaseDate || "",
    releaseNotes: Array.isArray(manifest.releaseNotes) ? manifest.releaseNotes : [],
    platform: manifest.platform || "macOS Apple Silicon"
  };
}

function compareVersions(left, right) {
  const leftParts = String(left || "").split(/[.-]/).map(versionPartValue);
  const rightParts = String(right || "").split(/[.-]/).map(versionPartValue);
  const max = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < max; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
}

function versionPartValue(value) {
  const parsed = Number.parseInt(String(value || "0").replace(/^\D+/, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function setupStatusResponse() {
  const runtime = getRuntime();
  const config = readRuntimeConfig();
  const oauth = oauthStatusResponse();
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
    oauth,
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
        detail: cloudflareReady ? `${config.senderProfiles.length} sender profile${config.senderProfiles.length === 1 ? "" : "s"} configured.` : "Connect Cloudflare, or add a sender address, account ID, and Email Service API token."
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
        state: oauth.connected ? "ready" : oauth.available ? "available" : "missing",
        detail: oauth.connected ? `Connected with OAuth${oauth.expiresAt ? ` until ${oauth.expiresAt}` : ""}.` : oauth.available ? "This build can open Cloudflare login and store the returned token locally." : "This build needs a Cloudflare OAuth client ID before login can be used."
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
  const fallbackToken = env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_OAUTH_ACCESS_TOKEN || "";
  addSenderProfile(profiles, {
    from: env.DEFAULT_FROM,
    label: env.DEFAULT_FROM_LABEL || env.DEFAULT_FROM,
    accountId: env.CLOUDFLARE_ACCOUNT_ID || "",
    apiToken: fallbackToken
  });

  for (let index = 1; index <= 20; index += 1) {
    const prefix = `SENDER_PROFILE_${index}_`;
    addSenderProfile(profiles, {
      from: env[`${prefix}FROM`],
      label: env[`${prefix}LABEL`] || env[`${prefix}FROM`],
      accountId: env[`${prefix}CLOUDFLARE_ACCOUNT_ID`] || env[`${prefix}ACCOUNT_ID`] || "",
      apiToken: env[`${prefix}CLOUDFLARE_API_TOKEN`] || env[`${prefix}API_TOKEN`] || fallbackToken
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
  const oauthAccessToken = env.CLOUDFLARE_OAUTH_ACCESS_TOKEN || "";
  return {
    host: env.HOST || "127.0.0.1",
    port: Number(env.PORT || 8899),
    accountId: env.CLOUDFLARE_ACCOUNT_ID || "",
    apiToken: env.CLOUDFLARE_API_TOKEN || oauthAccessToken,
    oauth: {
      clientId: env.CLOUDFLARE_OAUTH_CLIENT_ID || "",
      redirectUri: normalizeBaseUrl(env.CLOUDFLARE_OAUTH_REDIRECT_URI || ""),
      scopes: parseSpaceList(env.CLOUDFLARE_OAUTH_SCOPES || ""),
      accessToken: oauthAccessToken,
      refreshToken: env.CLOUDFLARE_OAUTH_REFRESH_TOKEN || "",
      expiresAt: env.CLOUDFLARE_OAUTH_EXPIRES_AT || "",
      tokenType: env.CLOUDFLARE_OAUTH_TOKEN_TYPE || "Bearer"
    },
    defaultFrom,
    defaultFromLabel: env.DEFAULT_FROM_LABEL || defaultFrom,
    defaultTo: env.DEFAULT_TO || "",
    mailboxWorkerUrl: normalizeBaseUrl(env.MAILBOX_WORKER_URL || ""),
    mailboxApiSecret: env.MAILBOX_API_SECRET || "",
    updateManifestUrl: env.BETTER_EMAIL_ROUTING_UPDATE_MANIFEST_URL || defaultUpdateManifestUrl,
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

  writeEnvFile(runtime.configPath, next);
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

function startCloudflareOAuth(req) {
  const config = readRuntimeConfig();
  if (!config.oauth.clientId) {
    return {
      ok: false,
      error: "Cloudflare OAuth is not configured in this app build. Add CLOUDFLARE_OAUTH_CLIENT_ID to the local config or release build."
    };
  }

  pruneOauthSessions();
  const state = base64Url(randomBytes(24));
  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const redirectUri = oauthRedirectUri(req, config);

  oauthSessions.set(state, {
    clientId: config.oauth.clientId,
    codeVerifier,
    redirectUri,
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  const authUrl = new URL(cloudflareOAuth.authUrl);
  authUrl.searchParams.set("client_id", config.oauth.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  if (config.oauth.scopes.length) {
    authUrl.searchParams.set("scope", config.oauth.scopes.join(" "));
  }

  return {
    ok: true,
    authUrl: authUrl.toString(),
    redirectUri,
    expiresIn: 600
  };
}

async function handleCloudflareOAuthCallback(req, res, url) {
  const providerError = url.searchParams.get("error");
  if (providerError) {
    sendHtml(res, 400, oauthCallbackPage(
      "Cloudflare connection canceled",
      url.searchParams.get("error_description") || providerError
    ));
    return;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const session = state ? oauthSessions.get(state) : null;
  if (!code || !session || session.expiresAt <= Date.now()) {
    sendHtml(res, 400, oauthCallbackPage(
      "Cloudflare connection expired",
      "Return to Better Email Routing and start Cloudflare login again."
    ));
    return;
  }

  oauthSessions.delete(state);

  try {
    const token = await exchangeOAuthCode(code, session);
    const accounts = await fetchCloudflareAccounts(token.access_token).catch(() => []);
    writeOAuthTokenConfig(token, accounts);
    sendHtml(res, 200, oauthCallbackPage(
      "Cloudflare connected",
      "You can return to Better Email Routing. This tab can be closed."
    ));
  } catch (error) {
    sendHtml(res, 502, oauthCallbackPage(
      "Cloudflare connection failed",
      error.message
    ));
  }
}

async function exchangeOAuthCode(code, session) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: session.clientId,
    code,
    redirect_uri: session.redirectUri,
    code_verifier: session.codeVerifier
  });

  const response = await fetch(cloudflareOAuth.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const token = await response.json().catch(() => ({}));

  if (!response.ok || token.error || !token.access_token) {
    throw new Error(token.error_description || token.error || "Cloudflare did not return an OAuth access token.");
  }

  return token;
}

async function refreshOAuthTokenIfNeeded() {
  const config = readRuntimeConfig();
  if (!config.oauth.clientId || !config.oauth.refreshToken) {
    return null;
  }

  const expiresAt = Date.parse(config.oauth.expiresAt || "");
  if (config.oauth.accessToken && (!Number.isFinite(expiresAt) || expiresAt - Date.now() > 2 * 60 * 1000)) {
    return config.oauth.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.oauth.clientId,
    refresh_token: config.oauth.refreshToken
  });

  const response = await fetch(cloudflareOAuth.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const token = await response.json().catch(() => ({}));

  if (!response.ok || token.error || !token.access_token) {
    throw new Error(token.error_description || token.error || "Cloudflare OAuth token refresh failed.");
  }

  if (!token.refresh_token) {
    token.refresh_token = config.oauth.refreshToken;
  }
  writeOAuthTokenConfig(token);
  return token.access_token;
}

function writeOAuthTokenConfig(token, accounts = []) {
  if (!token || !token.access_token) {
    throw new Error("Cloudflare OAuth token response was missing access_token.");
  }

  const runtime = getRuntime();
  const current = readRuntimeEnv();
  const next = readEnvFile(runtime.configPath);
  const expiresIn = Number(token.expires_in || 0);
  const scopes = token.scope || current.CLOUDFLARE_OAUTH_SCOPES || "";
  const clientId = current.CLOUDFLARE_OAUTH_CLIENT_ID || "";
  const redirectUri = current.CLOUDFLARE_OAUTH_REDIRECT_URI || "";

  setIfPresent(next, "CLOUDFLARE_OAUTH_ACCESS_TOKEN", token.access_token);
  setIfPresent(next, "CLOUDFLARE_OAUTH_REFRESH_TOKEN", token.refresh_token || current.CLOUDFLARE_OAUTH_REFRESH_TOKEN || "");
  setIfPresent(next, "CLOUDFLARE_OAUTH_TOKEN_TYPE", token.token_type || "Bearer");
  setIfPresent(next, "CLOUDFLARE_OAUTH_SCOPES", scopes);
  if (clientId) {
    setIfPresent(next, "CLOUDFLARE_OAUTH_CLIENT_ID", clientId);
  }
  if (redirectUri) {
    setIfPresent(next, "CLOUDFLARE_OAUTH_REDIRECT_URI", redirectUri);
  }
  if (expiresIn > 0) {
    setIfPresent(next, "CLOUDFLARE_OAUTH_EXPIRES_AT", new Date(Date.now() + expiresIn * 1000).toISOString());
  }
  if (!next.CLOUDFLARE_ACCOUNT_ID && Array.isArray(accounts) && accounts.length === 1 && accounts[0].id) {
    setIfPresent(next, "CLOUDFLARE_ACCOUNT_ID", accounts[0].id);
  }

  writeEnvFile(runtime.configPath, next);
  ensureDataRoot();
  return { ok: true };
}

function disconnectCloudflareOAuth() {
  const runtime = getRuntime();
  const next = readEnvFile(runtime.configPath);
  delete next.CLOUDFLARE_OAUTH_ACCESS_TOKEN;
  delete next.CLOUDFLARE_OAUTH_REFRESH_TOKEN;
  delete next.CLOUDFLARE_OAUTH_EXPIRES_AT;
  delete next.CLOUDFLARE_OAUTH_TOKEN_TYPE;
  writeEnvFile(runtime.configPath, next);
  return { ok: true };
}

function oauthStatusResponse() {
  const config = readRuntimeConfig();
  const hasStoredToken = Boolean(config.oauth.accessToken || config.oauth.refreshToken);
  return {
    available: Boolean(config.oauth.clientId),
    connected: hasStoredToken,
    clientId: redact(config.oauth.clientId),
    redirectUri: config.oauth.redirectUri || "http://127.0.0.1:8899/api/oauth/callback",
    expiresAt: config.oauth.expiresAt,
    hasRefreshToken: Boolean(config.oauth.refreshToken),
    scopes: config.oauth.scopes,
    accountId: redact(config.accountId)
  };
}

async function listConnectedCloudflareAccounts() {
  await refreshOAuthTokenIfNeeded().catch(() => null);
  const config = readRuntimeConfig();
  const token = config.oauth.accessToken || config.apiToken;
  if (!token) {
    return { ok: false, status: 401, error: "Connect Cloudflare or add a local API token first." };
  }

  try {
    const accounts = await fetchCloudflareAccounts(token);
    return { ok: true, accounts };
  } catch (error) {
    return { ok: false, status: 502, error: error.message };
  }
}

async function fetchCloudflareAccounts(token) {
  if (!token) {
    return [];
  }

  const response = await fetch("https://api.cloudflare.com/client/v4/accounts", {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const message = body.errors && body.errors[0] && body.errors[0].message;
    throw new Error(message || "Cloudflare account lookup failed.");
  }

  return (Array.isArray(body.result) ? body.result : []).map((account) => ({
    id: account.id,
    name: account.name || account.id
  })).filter((account) => account.id);
}

function oauthRedirectUri(req, config = readRuntimeConfig()) {
  if (config.oauth.redirectUri) {
    return config.oauth.redirectUri;
  }

  const host = String(req.headers.host || "");
  const port = host.includes(":") ? host.split(":").pop() : String(config.port || 8899);
  return `http://127.0.0.1:${port || 8899}/api/oauth/callback`;
}

function pruneOauthSessions() {
  const now = Date.now();
  for (const [state, session] of oauthSessions.entries()) {
    if (!session || session.expiresAt <= now) {
      oauthSessions.delete(state);
    }
  }
}

function oauthCallbackPage(title, detail) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fbfbfd; color: #1d1d1f; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(560px, calc(100vw - 40px)); padding: 28px; border: 1px solid #d2d2d7; border-radius: 18px; background: #fff; box-shadow: 0 18px 44px rgba(29, 29, 31, 0.12); }
      h1 { margin: 0 0 10px; font-size: 24px; }
      p { margin: 0; color: #6e6e73; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(detail)}</p>
    </main>
  </body>
</html>`;
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8"
  });
  res.end(html);
}

function setIfPresent(target, key, value) {
  if (value === undefined) {
    return;
  }
  target[key] = String(value || "");
}

function writeEnvFile(filePath, values) {
  const output = [
    "# Better Email Routing local config",
    "# Stored on this computer. Do not commit this file.",
    ...Object.keys(values)
      .filter((key) => values[key] !== "")
      .sort()
      .map((key) => `${key}=${quoteEnv(values[key])}`),
    ""
  ].join("\n");

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, output, { mode: 0o600 });
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

function parseSpaceList(value) {
  return String(value || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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
