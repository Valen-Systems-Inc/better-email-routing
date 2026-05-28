const assert = require("node:assert/strict");
const { test } = require("node:test");

const { calculateLayoutMetrics } = require("./layout-metrics.js");

test("desktop metrics give the mailbox a measured fixed pane height", () => {
  const metrics = calculateLayoutMetrics({
    viewportWidth: 1280,
    viewportHeight: 900,
    topbarHeight: 94,
    appPad: 24,
    panelGap: 18
  });

  assert.equal(metrics.narrow, false);
  assert.equal(metrics.windowHeight, "900px");
  assert.equal(metrics.mailboxHeight, "740px");
  assert.equal(metrics.threadListMax, "none");
  assert.equal(metrics.composerMax, "740px");
});

test("narrow metrics let the document scroll and cap the thread list", () => {
  const metrics = calculateLayoutMetrics({
    viewportWidth: 390,
    viewportHeight: 844,
    topbarHeight: 146,
    appPad: 20,
    panelGap: 18
  });

  assert.equal(metrics.narrow, true);
  assert.equal(metrics.windowHeight, "844px");
  assert.equal(metrics.mailboxHeight, "auto");
  assert.equal(metrics.threadListMax, "354px");
  assert.equal(metrics.messagePaneMin, "540px");
  assert.equal(metrics.composerMax, "none");
});
