const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getMessageBodyState
} = require("./message-body-state.js");

test("reports captured-empty messages instead of rendering a blank body", () => {
  const state = getMessageBodyState({
    text: "",
    html: "",
    snippet: "",
    rawSize: 18402,
    hasRawSource: false
  });

  assert.deepEqual(state, {
    kind: "missing",
    text: "This older email was received before raw-source storage was enabled, so this inbox only has its headers. Cloudflare hands the raw message to the receiving Worker at delivery time; because the old Worker dropped that body, the app cannot reconstruct it afterward."
  });
});

test("points future parser misses back to stored raw source", () => {
  const state = getMessageBodyState({
    text: "",
    html: "",
    snippet: "",
    rawSize: 18402,
    hasRawSource: true
  });

  assert.deepEqual(state, {
    kind: "missing",
    text: "This email has stored raw source, but the display parser did not extract a body yet. Fix the parser or run a reprocess job from the stored source instead of editing this message by hand."
  });
});

test("treats unknown raw-source status as repairable instead of unrecoverable", () => {
  const state = getMessageBodyState({
    text: "",
    html: "",
    snippet: "",
    rawSize: 18402
  });

  assert.deepEqual(state, {
    kind: "missing",
    text: "This email body was not extracted yet. Refresh after the inbox repair job reprocesses the stored raw message."
  });
});

test("prefers rich html when available", () => {
  const state = getMessageBodyState({
    text: "Plain fallback",
    html: "<p>Rich body</p>",
    snippet: "Rich body",
    rawSize: 18402
  });

  assert.deepEqual(state, {
    kind: "html",
    html: "<p>Rich body</p>"
  });
});

test("falls back to text and snippet bodies", () => {
  assert.deepEqual(getMessageBodyState({ text: "Hello", html: "", snippet: "", rawSize: 5 }), {
    kind: "text",
    text: "Hello"
  });
  assert.deepEqual(getMessageBodyState({ text: "", html: "", snippet: "Preview", rawSize: 5 }), {
    kind: "text",
    text: "Preview"
  });
});
