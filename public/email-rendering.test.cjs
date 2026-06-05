const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSafeEmailDocument,
  formatAttachmentSize
} = require("./email-rendering.js");

test("safe email document keeps styled markup but removes executable content", () => {
  const source = `
    <style>.button{background:#0f6f63;color:#fff}</style>
    <script>alert("nope")</script>
    <a class="button" href="https://example.com/pay" onclick="steal()">Pay now</a>
    <a href="javascript:alert(1)">Bad link</a>
  `;

  const document = buildSafeEmailDocument(source);

  assert.match(document, /<base target="_blank">/);
  assert.match(document, /\.button\{background:#0f6f63;color:#fff\}/);
  assert.match(document, /Pay now/);
  assert.doesNotMatch(document, /<script/i);
  assert.doesNotMatch(document, /onclick/i);
  assert.doesNotMatch(document, /javascript:/i);
});

test("attachment sizes are formatted for compact message chips", () => {
  assert.equal(formatAttachmentSize(0), "0 B");
  assert.equal(formatAttachmentSize(512), "512 B");
  assert.equal(formatAttachmentSize(1536), "1.5 KB");
  assert.equal(formatAttachmentSize(1048576), "1 MB");
});
