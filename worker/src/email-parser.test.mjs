import assert from "node:assert/strict";
import test from "node:test";

import { parseRawEmail } from "./email-parser.js";

test("parses rich HTML email and attachment metadata from multipart raw mail", async () => {
  const raw = [
    "From: Sender <sender@example.com>",
    "To: Inbox <inbox@example.com>",
    "Subject: =?UTF-8?Q?Styled_invoice?=",
    "Message-ID: <styled-1@example.com>",
    "Content-Type: multipart/mixed; boundary=\"mixed-boundary\"",
    "",
    "--mixed-boundary",
    "Content-Type: multipart/alternative; boundary=\"alt-boundary\"",
    "",
    "--alt-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Plain fallback",
    "--alt-boundary",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<html><body><style>.button{background:#0f6f63;color:#fff}</style><a class=\"button\" href=\"https://example.com/pay\">Pay now</a></body></html>",
    "--alt-boundary--",
    "--mixed-boundary",
    "Content-Type: application/pdf; name=\"invoice.pdf\"",
    "Content-Transfer-Encoding: base64",
    "Content-Disposition: attachment; filename=\"invoice.pdf\"",
    "",
    "SGVsbG8=",
    "--mixed-boundary--"
  ].join("\r\n");

  const parsed = await parseRawEmail(raw);

  assert.equal(parsed.subject, "Styled invoice");
  assert.equal(parsed.text, "Plain fallback");
  assert.match(parsed.html, /class="button"/);
  assert.deepEqual(parsed.attachments, [
    {
      filename: "invoice.pdf",
      contentType: "application/pdf",
      disposition: "attachment",
      contentId: "",
      size: 5
    }
  ]);
});

test("surfaces inline image parts as attachment metadata", async () => {
  const raw = [
    "From: Sender <sender@example.com>",
    "To: Inbox <inbox@example.com>",
    "Subject: Inline image",
    "Content-Type: multipart/related; boundary=\"related-boundary\"",
    "",
    "--related-boundary",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<img src=\"cid:logo-image\">",
    "--related-boundary",
    "Content-Type: image/png; name=\"logo.png\"",
    "Content-Transfer-Encoding: base64",
    "Content-ID: <logo-image>",
    "Content-Disposition: inline; filename=\"logo.png\"",
    "",
    "iVBORw0KGgo=",
    "--related-boundary--"
  ].join("\r\n");

  const parsed = await parseRawEmail(raw);

  assert.equal(parsed.html, "<img src=\"cid:logo-image\">");
  assert.deepEqual(parsed.attachments, [
    {
      filename: "logo.png",
      contentType: "image/png",
      disposition: "inline",
      contentId: "logo-image",
      size: 8
    }
  ]);
});
