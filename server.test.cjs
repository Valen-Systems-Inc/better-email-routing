const assert = require("node:assert/strict");
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
