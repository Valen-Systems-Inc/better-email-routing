import PostalMime from "postal-mime";

export async function parseRawEmail(raw) {
  const parsed = await new PostalMime().parse(raw);
  const headers = new Map((parsed.headers || []).map((header) => [header.key, header.value]));

  return {
    from: formatAddress(parsed.from) || getHeader(headers, "from"),
    to: formatAddressList(parsed.to) || getHeader(headers, "to"),
    cc: formatAddressList(parsed.cc) || getHeader(headers, "cc"),
    replyTo: formatAddress(parsed.replyTo) || getHeader(headers, "reply-to"),
    subject: String(parsed.subject || "").trim(),
    messageId: normalizeMessageId(parsed.messageId || getHeader(headers, "message-id")),
    inReplyTo: formatMessageIdList(parsed.inReplyTo || getHeader(headers, "in-reply-to")),
    referencesHeader: formatMessageIdList(parsed.references || getHeader(headers, "references")),
    dateHeader: getHeader(headers, "date"),
    text: String(parsed.text || "").trim(),
    html: String(parsed.html || "").trim(),
    attachments: normalizeAttachments(parsed.attachments || [])
  };
}

function getHeader(headers, name) {
  return headers.get(String(name).toLowerCase()) || "";
}

function formatAddress(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (value.address) {
    return value.name ? `${value.name} <${value.address}>` : value.address;
  }
  return "";
}

function formatAddressList(value) {
  if (!value) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(formatAddress).filter(Boolean).join(", ");
  }
  return formatAddress(value);
}

function normalizeAttachments(attachments) {
  return attachments.map((attachment, index) => {
    const contentId = String(attachment.contentId || "").replace(/^<|>$/g, "");
    const filename = String(attachment.filename || contentId || `attachment-${index + 1}`).trim();
    return {
      filename,
      contentType: String(attachment.mimeType || attachment.contentType || "application/octet-stream").trim(),
      disposition: String(attachment.disposition || "attachment").toLowerCase(),
      contentId,
      size: byteLength(attachment.content)
    };
  });
}

function byteLength(content) {
  if (!content) {
    return 0;
  }
  if (content instanceof ArrayBuffer) {
    return content.byteLength;
  }
  if (ArrayBuffer.isView(content)) {
    return content.byteLength;
  }
  return new TextEncoder().encode(String(content)).byteLength;
}

function formatMessageIdList(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeMessageId).filter(Boolean).join(" ");
  }
  return String(value || "").match(/<[^>]+>/g)?.join(" ") || String(value || "").trim();
}

function normalizeMessageId(value) {
  const ids = String(value || "").match(/<[^>]+>/g);
  return ids ? ids[0] : String(value || "").trim();
}
