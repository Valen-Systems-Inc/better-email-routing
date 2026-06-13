const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildReplyAllRecipients,
  classifyThread,
  filterThreads,
  normalizeFilter,
  summarizeThreads
} = require("./thread-triage.js");

test("classifies threads for inbox-zero style triage filters", () => {
  assert.deepEqual(classifyThread({
    unreadCount: 2,
    latestMessage: {
      direction: "inbound",
      attachments: [{ filename: "invoice.pdf" }]
    }
  }), {
    unread: true,
    needsReply: true,
    awaiting: false,
    attachments: true
  });

  assert.deepEqual(classifyThread({
    unreadCount: 0,
    latestMessage: {
      direction: "outbound",
      attachments: []
    }
  }), {
    unread: false,
    needsReply: false,
    awaiting: true,
    attachments: false
  });
});

test("filters thread lists by quick triage mode", () => {
  const threads = [
    { threadId: "a", unreadCount: 1, latestMessage: { direction: "inbound", attachments: [] } },
    { threadId: "b", unreadCount: 0, latestMessage: { direction: "outbound", attachments: [] } },
    { threadId: "c", unreadCount: 0, latestMessage: { direction: "inbound", attachments: [{ filename: "one.pdf" }] } }
  ];

  assert.equal(normalizeFilter("nonsense"), "all");
  assert.deepEqual(filterThreads(threads, "unread").map((thread) => thread.threadId), ["a"]);
  assert.deepEqual(filterThreads(threads, "awaiting").map((thread) => thread.threadId), ["b"]);
  assert.deepEqual(filterThreads(threads, "attachments").map((thread) => thread.threadId), ["c"]);
  assert.deepEqual(summarizeThreads(threads), {
    all: 3,
    unread: 1,
    needsReply: 2,
    awaiting: 1,
    attachments: 1
  });
});

test("builds reply-all recipients while excluding the current mailbox", () => {
  const result = buildReplyAllRecipients([
    {
      direction: "inbound",
      from: "Sender <sender@example.com>",
      replyTo: "",
      to: ["Inbox <inbox@example.com>", "Ops <ops@example.com>"],
      cc: ["Sender <sender@example.com>", "Team <team@example.com>", "inbox@example.com"]
    }
  ], ["inbox@example.com"]);

  assert.deepEqual(result, {
    to: "Sender <sender@example.com>",
    cc: ["Ops <ops@example.com>", "Team <team@example.com>"]
  });
});
