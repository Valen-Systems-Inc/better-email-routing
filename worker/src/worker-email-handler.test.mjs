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
