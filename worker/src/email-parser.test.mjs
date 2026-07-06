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

test("falls back to raw text when vendor MIME omits the header-body separator", async () => {
  const raw = [
    "From: Namecheap <mailserviceemailout1.namecheap.com>",
    "To: Inbox <inbox@example.com>",
    "Subject: Requested Authorization Code",
    "Content-Type: text/plain; charset=utf-8",
    "Authorization code: 123456"
  ].join("\r\n");

  const parsed = await parseRawEmail(raw);

  assert.equal(parsed.subject, "Requested Authorization Code");
  assert.equal(parsed.text, "Authorization code: 123456");
});

test("falls back inside malformed multipart text parts", async () => {
  const raw = [
    "From: Cloudflare <bounces@cf-bounce.notify.cloudflare.com>",
    "To: Inbox <inbox@example.com>",
    "Subject: [Cloudflare]: Verify Email Routing address",
    "Content-Type: multipart/alternative; boundary=\"cf-boundary\"",
    "",
    "--cf-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "Click the verification link to finish setting up Email Routing.",
    "--cf-boundary--"
  ].join("\r\n");

  const parsed = await parseRawEmail(raw);

  assert.equal(parsed.subject, "[Cloudflare]: Verify Email Routing address");
  assert.equal(parsed.text, "Click the verification link to finish setting up Email Routing.");
});

test("multipart/report DSN with no text part still yields a readable body", async () => {
  const raw = [
    "From: bounces@cf-bounce.example.us",
    "To: inbox@example.com",
    "Subject: Delivery Status Notification",
    "Content-Type: multipart/report; report-type=delivery-status; boundary=\"B\"",
    "",
    "--B",
    "Content-Type: message/delivery-status",
    "",
    "Reporting-MTA: dns; cf-bounce.example.us",
    "Action: failed",
    "Status: 5.1.1",
    "Diagnostic-Code: smtp; 550 5.1.1 user unknown",
    "--B",
    "Content-Type: message/rfc822",
    "",
    "Subject: original",
    "",
    "orig body",
    "--B--"
  ].join("\n");

  const parsed = await parseRawEmail(raw);
  assert.ok(parsed.text.length > 0, "DSN body must not be blank");
  assert.match(parsed.text, /5\.1\.1/);
  assert.match(parsed.text, /Delivery failed/);
});
