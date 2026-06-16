import assert from "node:assert/strict";
import test from "node:test";

import worker from "./index.js";

test("private reprocess endpoint repairs empty display bodies from stored raw source", async () => {
  const env = {
    MAILBOX_API_SECRET: "secret",
    INBOX_DB: createDbStub([
      {
        id: "msg_1",
        thread_id: "th_namecheap",
        raw_source: [
          "From: Namecheap <mailserviceemailout1.namecheap.com>",
          "To: Inbox <inbox@example.com>",
          "Subject: Requested Authorization Code",
          "Content-Type: text/plain; charset=utf-8",
          "Authorization code: 123456"
        ].join("\r\n")
      }
    ])
  };

  const response = await worker.fetch(new Request("https://worker.example/api/reprocess/raw-bodies", {
    method: "POST",
    headers: {
      authorization: "Bearer secret",
      "content-type": "application/json"
    },
    body: JSON.stringify({ threadId: "th_namecheap" })
  }), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    scanned: 1,
    updated: 1,
    skipped: 0
  });
  assert.deepEqual(env.INBOX_DB.updates, [
    {
      snippet: "Authorization code: 123456",
      textBody: "Authorization code: 123456",
      htmlBody: "",
      attachmentsJson: "[]",
      id: "msg_1"
    }
  ]);
});

function createDbStub(rows) {
  const db = {
    updates: [],
    prepare(sql) {
      return {
        bind: (...params) => ({
          all: async () => {
            if (!sql.includes("SELECT id, thread_id, raw_source")) {
              return { results: [] };
            }
            return { results: rows.filter((row) => !params[0] || row.thread_id === params[0]) };
          },
          run: async () => {
            if (/UPDATE messages\s+SET/.test(sql)) {
              db.updates.push({
                snippet: params[0],
                textBody: params[1],
                htmlBody: params[2],
                attachmentsJson: params[3],
                id: params[4]
              });
            }
            return { success: true };
          }
        })
      };
    }
  };
  return db;
}
