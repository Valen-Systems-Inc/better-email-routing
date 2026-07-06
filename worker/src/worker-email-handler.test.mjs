import assert from "node:assert/strict";
import test from "node:test";

import { handleEmail } from "./index.js";

test("email handler awaits MIME parsing before storing the inbound message", async () => {
  const env = {
    INBOX_ADDRESS: "inbox@example.com",
    INBOX_DB: createDbStub()
  };
  const message = {
    to: "inbox@example.com",
    from: "sender@example.com",
    rawSize: 300,
    raw: new Blob([
      [
        "From: Sender <sender@example.com>",
        "To: Inbox <inbox@example.com>",
        "Subject: Async parser body",
        "Message-ID: <async-parser@example.com>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "This body should be stored."
      ].join("\r\n")
    ])
  };

  await handleEmail(message, env);

  assert.equal(env.INBOX_DB.messageInsert.subject, "Async parser body");
  assert.equal(env.INBOX_DB.messageInsert.textBody, "This body should be stored.");
  assert.match(env.INBOX_DB.messageInsert.rawSource, /This body should be stored\./);
});

test("email handler stores the inbox copy before forwarding a configured safety copy", async () => {
  const env = {
    INBOX_ADDRESS: "inbox@example.com",
    FORWARD_COPY_TO: "archive@example.com",
    INBOX_DB: createDbStub()
  };
  const forwarded = [];
  const message = {
    to: "inbox@example.com",
    from: "sender@example.com",
    rawSize: 300,
    raw: new Blob([
      [
        "From: Sender <sender@example.com>",
        "To: Inbox <inbox@example.com>",
        "Subject: Store before forward",
        "Message-ID: <store-before-forward@example.com>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "This body should be stored, then forwarded."
      ].join("\r\n")
    ]),
    async forward(to, headers) {
      assert.equal(env.INBOX_DB.messageInsert.subject, "Store before forward");
      forwarded.push({
        to,
        originalRecipient: headers.get("X-Original-Recipient"),
        mailboxMessageId: headers.get("X-Better-Email-Routing-Message-Id")
      });
    }
  };

  await handleEmail(message, env);

  assert.deepEqual(forwarded, [
    {
      to: "archive@example.com",
      originalRecipient: "inbox@example.com",
      mailboxMessageId: env.INBOX_DB.messageInsert.id
    }
  ]);
});

test("email handler skips forwarding when no safety copy destination is configured", async () => {
  const env = {
    INBOX_ADDRESS: "inbox@example.com",
    INBOX_DB: createDbStub()
  };
  let forwarded = false;
  const message = {
    to: "inbox@example.com",
    from: "sender@example.com",
    rawSize: 300,
    raw: new Blob([
      [
        "From: Sender <sender@example.com>",
        "To: Inbox <inbox@example.com>",
        "Subject: No forward",
        "Message-ID: <no-forward@example.com>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "This body should only be stored."
      ].join("\r\n")
    ]),
    async forward() {
      forwarded = true;
    }
  };

  await handleEmail(message, env);

  assert.equal(env.INBOX_DB.messageInsert.subject, "No forward");
  assert.equal(forwarded, false);
});

test("email handler skips a safety copy that points back to the same mailbox", async () => {
  const env = {
    INBOX_ADDRESS: "inbox@example.com",
    FORWARD_COPY_TO: "Inbox <inbox@example.com>",
    INBOX_DB: createDbStub()
  };
  let forwarded = false;
  const message = {
    to: "inbox@example.com",
    from: "sender@example.com",
    rawSize: 300,
    raw: new Blob([
      [
        "From: Sender <sender@example.com>",
        "To: Inbox <inbox@example.com>",
        "Subject: Self forward guard",
        "Message-ID: <self-forward-guard@example.com>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "This body should be stored without forwarding to itself."
      ].join("\r\n")
    ]),
    async forward() {
      forwarded = true;
    }
  };

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(message);
  try {
    await handleEmail(message, env);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(env.INBOX_DB.messageInsert.subject, "Self forward guard");
  assert.equal(forwarded, false);
  assert.deepEqual(warnings, [
    "FORWARD_COPY_TO matches the inbound mailbox address; skipping safety copy"
  ]);
});

function createDbStub() {
  const db = {
    messageInsert: null,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              return null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              if (sql.includes("INSERT OR IGNORE INTO messages")) {
                db.messageInsert = {
                  id: params[0],
                  subject: params[8],
                  textBody: params[17],
                  htmlBody: params[18],
                  rawSource: params[21]
                };
              }
              return { success: true };
            }
          };
        }
      };
    },
    async batch(statements) {
      for (const statement of statements) {
        await statement.run();
      }
      return [];
    }
  };
  return db;
}
