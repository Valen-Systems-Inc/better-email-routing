import assert from "node:assert/strict";
import { test } from "node:test";

import { buildThreadListFilter, normalizeMailbox } from "./thread-filters.js";

test("normalizes unknown mailbox names to inbox", () => {
  assert.equal(normalizeMailbox("whatever"), "inbox");
  assert.equal(normalizeMailbox("TRASH"), "trash");
});

test("inbox hides archived, trashed, and outbound-only threads", () => {
  const filter = buildThreadListFilter({ mailbox: "inbox", query: "" });

  assert.match(filter.where, /trashed_at = ''/);
  assert.match(filter.where, /archived_at = ''/);
  assert.match(filter.where, /direction = 'inbound'/);
  assert.deepEqual(filter.params, []);
});

test("sent finds threads that contain outbound mail", () => {
  const filter = buildThreadListFilter({ mailbox: "sent", query: "" });

  assert.match(filter.where, /trashed_at = ''/);
  assert.match(filter.where, /direction = 'outbound'/);
});

test("search applies one bound query across subject, participants, and snippets", () => {
  const filter = buildThreadListFilter({ mailbox: "all", query: "Valen" });

  assert.match(filter.where, /LOWER\(t\.normalized_subject\) LIKE \?/);
  assert.match(filter.where, /LOWER\(t\.participants_json\) LIKE \?/);
  assert.match(filter.where, /LOWER\(search\.snippet\) LIKE \?/);
  assert.deepEqual(filter.params, ["%valen%", "%valen%", "%valen%"]);
});
