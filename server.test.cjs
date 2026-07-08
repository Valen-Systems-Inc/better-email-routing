const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createServer } = require("./server.js");

test("open-external API opens http URLs through the server-side opener", async () => {
  const opened = [];
  const server = createServer({
    openExternalUrl: async (url) => opened.push(url)
  });
  const address = await listen(server);

  try {
    const response = await request(address, "/api/open-external", {
      method: "POST",
      body: { url: "https://downloads.valen-systems.com/better-email-routing/latest.json" }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.deepEqual(opened, ["https://downloads.valen-systems.com/better-email-routing/latest.json"]);
  } finally {
    await close(server);
  }
});

test("open-external API rejects non-web URLs", async () => {
  const opened = [];
  const server = createServer({
    openExternalUrl: async (url) => opened.push(url)
  });
  const address = await listen(server);

  try {
    const response = await request(address, "/api/open-external", {
      method: "POST",
      body: { url: "file:///Users/williamvalenrobinson/.ssh/id_rsa" }
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.deepEqual(opened, []);
  } finally {
    await close(server);
  }
});

test("setup import accepts an inbox-only keys.env", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-mail-keys-"));
  const server = createServer({ homeDir });
  const address = await listen(server);

  try {
    const response = await request(address, "/api/setup/import-keys", {
      method: "POST",
      body: {
        envText: [
          "DEFAULT_FROM=gianni@masterflowplumbing.us",
          "DEFAULT_FROM_LABEL=Gianni - Masterflow Plumbing",
          "DEFAULT_TO=masterflowplumbing2024@gmail.com",
          "CLOUDFLARE_ACCOUNT_ID=f3c8cc51d06b88d2dc0f3ff25f5aeacf",
          "MAILBOX_WORKER_URL=https://masterflow-mailbox.example.workers.dev",
          "MAILBOX_API_SECRET=mailbox_test_secret"
        ].join("\n")
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.configured, true);
    assert.equal(response.body.form.defaultFrom, "gianni@masterflowplumbing.us");
    assert.equal(response.body.form.accountId, "f3c8cc51d06b88d2dc0f3ff25f5aeacf");
    assert.equal(response.body.form.mailboxWorkerUrl, "https://masterflow-mailbox.example.workers.dev");
    assert.equal(response.body.form.hasCloudflareApiToken, false);
    assert.equal(response.body.form.hasMailboxApiSecret, true);

    const savedEnv = fs.readFileSync(path.join(homeDir, ".env"), "utf8");
    assert.match(savedEnv, /DEFAULT_FROM=gianni@masterflowplumbing\.us/);
    assert.match(savedEnv, /MAILBOX_WORKER_URL=https:\/\/masterflow-mailbox\.example\.workers\.dev/);
    assert.match(savedEnv, /MAILBOX_API_SECRET=mailbox_test_secret/);
  } finally {
    await close(server);
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("setup import preserves multiple sender profiles from keys.env", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-mail-senders-"));
  const server = createServer({ homeDir });
  const address = await listen(server);

  try {
    const response = await request(address, "/api/setup/import-keys", {
      method: "POST",
      body: {
        envText: [
          "DEFAULT_FROM=gianni@masterflowplumbing.us",
          "DEFAULT_FROM_LABEL=gianni@masterflowplumbing.us",
          "DEFAULT_TO=masterflowplumbing2024@gmail.com",
          "CLOUDFLARE_ACCOUNT_ID=f3c8cc51d06b88d2dc0f3ff25f5aeacf",
          "CLOUDFLARE_API_TOKEN=cf_test_masterflow_send",
          "MAILBOX_WORKER_URL=https://masterflow-mailbox.example.workers.dev",
          "MAILBOX_API_SECRET=mailbox_test_secret",
          "SENDER_PROFILE_1_FROM=gianni@masterflowplumbing.us",
          "SENDER_PROFILE_1_LABEL=gianni@masterflowplumbing.us",
          "SENDER_PROFILE_2_FROM=sales@masterflowplumbing.us",
          "SENDER_PROFILE_2_LABEL=sales@masterflowplumbing.us",
          "SENDER_PROFILE_3_FROM=info@masterflowplumbing.us",
          "SENDER_PROFILE_3_LABEL=info@masterflowplumbing.us"
        ].join("\n")
      }
    });
    const config = await request(address, "/api/config");

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.deepEqual(
      config.body.senderProfiles.map((profile) => profile.from),
      [
        "gianni@masterflowplumbing.us",
        "sales@masterflowplumbing.us",
        "info@masterflowplumbing.us"
      ]
    );
    assert.deepEqual(
      config.body.senderProfiles.map((profile) => profile.label),
      [
        "gianni@masterflowplumbing.us",
        "sales@masterflowplumbing.us",
        "info@masterflowplumbing.us"
      ]
    );
    assert.equal(config.body.senderProfiles.every((profile) => profile.hasToken), true);
    assert.equal(
      config.body.senderProfiles.every((profile) => profile.accountId === "f3c8cc...eacf"),
      true
    );

    const savedEnv = fs.readFileSync(path.join(homeDir, ".env"), "utf8");
    assert.match(savedEnv, /SENDER_PROFILE_2_FROM=sales@masterflowplumbing\.us/);
    assert.match(savedEnv, /SENDER_PROFILE_3_FROM=info@masterflowplumbing\.us/);
  } finally {
    await close(server);
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("runtime config builds senders from SENDER_ADDRESSES", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-mail-sender-addresses-"));
  fs.writeFileSync(path.join(homeDir, ".env"), [
    "DEFAULT_FROM=gianni@masterflowplumbing.us",
    "DEFAULT_TO=masterflowplumbing2024@gmail.com",
    "CLOUDFLARE_ACCOUNT_ID=f3c8cc51d06b88d2dc0f3ff25f5aeacf",
    "CLOUDFLARE_API_TOKEN=cf_test_masterflow_send",
    "MAILBOX_WORKER_URL=https://masterflow-mailbox.example.workers.dev",
    "MAILBOX_API_SECRET=mailbox_test_secret",
    "SENDER_ADDRESSES=gianni@masterflowplumbing.us,sales@masterflowplumbing.us,info@masterflowplumbing.us,billing@masterflowplumbing.us,william@masterflowplumbing.us"
  ].join("\n"));
  const server = createServer({ homeDir });
  const address = await listen(server);

  try {
    const config = await request(address, "/api/config");

    assert.equal(config.status, 200);
    assert.deepEqual(
      config.body.senderProfiles.map((profile) => profile.from),
      [
        "gianni@masterflowplumbing.us",
        "sales@masterflowplumbing.us",
        "info@masterflowplumbing.us",
        "billing@masterflowplumbing.us",
        "william@masterflowplumbing.us"
      ]
    );
    assert.equal(config.body.senderProfiles.every((profile) => profile.hasToken), true);
  } finally {
    await close(server);
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("saving setup preserves imported sender profiles", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-mail-preserve-senders-"));
  const server = createServer({ homeDir });
  const address = await listen(server);

  try {
    await request(address, "/api/setup/import-keys", {
      method: "POST",
      body: {
        envText: [
          "DEFAULT_FROM=gianni@masterflowplumbing.us",
          "DEFAULT_FROM_LABEL=gianni@masterflowplumbing.us",
          "DEFAULT_TO=masterflowplumbing2024@gmail.com",
          "CLOUDFLARE_ACCOUNT_ID=f3c8cc51d06b88d2dc0f3ff25f5aeacf",
          "CLOUDFLARE_API_TOKEN=cf_test_masterflow_send",
          "MAILBOX_WORKER_URL=https://masterflow-mailbox.example.workers.dev",
          "MAILBOX_API_SECRET=mailbox_test_secret",
          "SENDER_PROFILE_1_FROM=gianni@masterflowplumbing.us",
          "SENDER_PROFILE_2_FROM=sales@masterflowplumbing.us",
          "SENDER_PROFILE_3_FROM=info@masterflowplumbing.us"
        ].join("\n")
      }
    });

    const saveResponse = await request(address, "/api/setup/config", {
      method: "POST",
      body: {
        defaultFrom: "gianni@masterflowplumbing.us",
        defaultFromLabel: "Gianni",
        defaultTo: "masterflowplumbing2024@gmail.com",
        accountId: "f3c8cc51d06b88d2dc0f3ff25f5aeacf",
        mailboxWorkerUrl: "https://masterflow-mailbox.example.workers.dev",
        mailboxApiSecret: ""
      }
    });
    const config = await request(address, "/api/config");

    assert.equal(saveResponse.status, 200);
    assert.deepEqual(
      config.body.senderProfiles.map((profile) => profile.from),
      [
        "gianni@masterflowplumbing.us",
        "sales@masterflowplumbing.us",
        "info@masterflowplumbing.us"
      ]
    );
    assert.equal(config.body.senderProfiles.every((profile) => profile.hasToken), true);
  } finally {
    await close(server);
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("send clearly reports a missing shared Email Service token", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-mail-missing-send-token-"));
  fs.writeFileSync(path.join(homeDir, ".env"), [
    "DEFAULT_FROM=gianni@masterflowplumbing.us",
    "DEFAULT_TO=masterflowplumbing2024@gmail.com",
    "CLOUDFLARE_ACCOUNT_ID=f3c8cc51d06b88d2dc0f3ff25f5aeacf",
    "MAILBOX_WORKER_URL=https://masterflow-mailbox.example.workers.dev",
    "MAILBOX_API_SECRET=mailbox_test_secret",
    "SENDER_ADDRESSES=gianni@masterflowplumbing.us,sales@masterflowplumbing.us"
  ].join("\n"));
  const server = createServer({ homeDir });
  const address = await listen(server);

  try {
    const response = await request(address, "/api/send", {
      method: "POST",
      body: {
        from: "sales@masterflowplumbing.us",
        to: "masterflowplumbing2024@gmail.com",
        subject: "Missing token test",
        text: "This should not send without a token."
      }
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.match(response.body.error, /CLOUDFLARE_API_TOKEN/);
    assert.match(response.body.error, /sales@masterflowplumbing\.us/);
  } finally {
    await close(server);
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("setup import rejects keys.env files that cannot power the inbox", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-mail-keys-"));
  const server = createServer({ homeDir });
  const address = await listen(server);

  try {
    const response = await request(address, "/api/setup/import-keys", {
      method: "POST",
      body: {
        envText: [
          "DEFAULT_FROM=gianni@masterflowplumbing.us",
          "CLOUDFLARE_ACCOUNT_ID=f3c8cc51d06b88d2dc0f3ff25f5aeacf",
          "CLOUDFLARE_API_TOKEN=cf_test_masterflow_send"
        ].join("\n")
      }
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.match(response.body.error, /MAILBOX_WORKER_URL/);
  } finally {
    await close(server);
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function request(baseUrl, path, options = {}) {
  const body = options.body ? JSON.stringify(options.body) : "";
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body || undefined
  });

  return {
    status: response.status,
    body: await response.json()
  };
}
