const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const publicRoot = __dirname;

test("setup surface includes a keys.env upload control", () => {
  const html = fs.readFileSync(path.join(publicRoot, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(publicRoot, "app.js"), "utf8");

  assert.match(html, /id="uploadKeysButton"[^>]*>Upload keys<\/button>/);
  assert.match(html, /id="keysFileInput"[^>]*type="file"/);
  assert.match(app, /\/api\/setup\/import-keys/);
});
