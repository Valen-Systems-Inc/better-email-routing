const assert = require("node:assert/strict");
const test = require("node:test");

const {
  planMailboxTransition
} = require("./mailbox-state.js");

test("changing mailboxes clears selected thread and resets list scroll", () => {
  const next = planMailboxTransition({
    currentMailbox: "inbox",
    nextMailbox: "all",
    selectedThreadId: "th_hashgraph"
  });

  assert.deepEqual(next, {
    mailbox: "all",
    selectedThreadId: "",
    resetThreadScroll: true
  });
});

test("reselecting the current mailbox preserves selected thread and scroll", () => {
  const next = planMailboxTransition({
    currentMailbox: "all",
    nextMailbox: "all",
    selectedThreadId: "th_hashgraph"
  });

  assert.deepEqual(next, {
    mailbox: "all",
    selectedThreadId: "th_hashgraph",
    resetThreadScroll: false
  });
});
