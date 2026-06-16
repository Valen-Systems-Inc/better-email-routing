import PostalMime from "postal-mime";

export async function parseRawEmail(raw) {
  const parsed = await new PostalMime().parse(raw);
  const headers = new Map((parsed.headers || []).map((header) => [header.key, header.value]));
  const fallback = !String(parsed.text || "").trim() && !String(parsed.html || "").trim()
    ? extractRawBodies(raw)
    : { text: "", html: "" };

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
    text: String(parsed.text || fallback.text || "").trim(),
    html: String(parsed.html || fallback.html || "").trim(),
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

function extractRawBodies(raw) {
  return parseMimeEntity(String(raw || ""), 0);
}

function parseMimeEntity(source, depth) {
  if (depth > 12) {
    return { text: "", html: "" };
  }

  const { headers, body } = splitHeaderBody(source);
  const contentType = getMimeHeader(headers, "content-type").toLowerCase();
  const disposition = getMimeHeader(headers, "content-disposition").toLowerCase();

  if (/attachment/i.test(disposition)) {
    return { text: "", html: "" };
  }

  const boundary = getHeaderParameter(contentType, "boundary");
  if (boundary && contentType.includes("multipart/")) {
    return splitMultipartBody(body, boundary)
      .map((part) => parseMimeEntity(part, depth + 1))
      .reduce(mergeBodies, { text: "", html: "" });
  }

  const decoded = cleanDecodedBody(decodeTransferBody(
    body,
    getMimeHeader(headers, "content-transfer-encoding")
  ));

  if (!decoded) {
    return { text: "", html: "" };
  }

  if (contentType.includes("text/html") || (!contentType && looksLikeHtml(decoded))) {
    return { text: "", html: decoded };
  }

  if (!contentType || contentType.includes("text/plain") || contentType.startsWith("text/")) {
    return { text: decoded, html: "" };
  }

  return { text: "", html: "" };
}

function splitHeaderBody(source) {
  const normalized = String(source || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blankMatch = normalized.match(/\n[ \t]*\n/);
  if (blankMatch && typeof blankMatch.index === "number") {
    const separatorStart = blankMatch.index;
    const separatorEnd = separatorStart + blankMatch[0].length;
    return {
      headers: parseHeaderBlock(normalized.slice(0, separatorStart)),
      body: normalized.slice(separatorEnd)
    };
  }

  const lines = normalized.split("\n");
  let bodyIndex = lines.length;
  let sawHeader = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      bodyIndex = index + 1;
      break;
    }
    if (/^[A-Za-z0-9!#$%&'*+\-.^_`|~]+:/.test(line)) {
      sawHeader = true;
      continue;
    }
    if (/^[ \t]/.test(line) && sawHeader) {
      continue;
    }
    bodyIndex = index;
    break;
  }

  return {
    headers: parseHeaderBlock(lines.slice(0, bodyIndex).join("\n")),
    body: lines.slice(bodyIndex).join("\n")
  };
}

function parseHeaderBlock(block) {
  const headers = new Map();
  let current = "";
  String(block || "").split("\n").forEach((line) => {
    if (/^[ \t]/.test(line) && current) {
      headers.set(current, `${headers.get(current)} ${line.trim()}`.trim());
      return;
    }
    const match = line.match(/^([A-Za-z0-9!#$%&'*+\-.^_`|~]+):\s*(.*)$/);
    if (!match) {
      return;
    }
    current = match[1].toLowerCase();
    headers.set(current, match[2].trim());
  });
  return headers;
}

function getMimeHeader(headers, name) {
  return String(headers.get(String(name || "").toLowerCase()) || "");
}

function getHeaderParameter(headerValue, name) {
  const target = String(name || "").toLowerCase();
  const parts = String(headerValue || "").split(";");
  for (const part of parts.slice(1)) {
    const match = part.match(/^\s*([^=]+)=\s*("?)(.*?)\2\s*$/);
    if (match && match[1].trim().toLowerCase() === target) {
      return match[3];
    }
  }
  return "";
}

function splitMultipartBody(body, boundary) {
  const parts = [];
  const lines = String(body || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const delimiter = `--${boundary}`;
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === delimiter || trimmed === `${delimiter}--`) {
      if (current) {
        parts.push(current.join("\n"));
      }
      current = trimmed.endsWith("--") ? null : [];
      if (trimmed.endsWith("--")) {
        break;
      }
      continue;
    }
    if (current) {
      current.push(line);
    }
  }

  if (current && current.length) {
    parts.push(current.join("\n"));
  }

  return parts;
}

function mergeBodies(left, right) {
  return {
    text: left.text || right.text || "",
    html: left.html || right.html || ""
  };
}

function decodeTransferBody(body, encoding) {
  const value = String(body || "");
  const normalizedEncoding = String(encoding || "").trim().toLowerCase();
  if (normalizedEncoding === "base64") {
    return decodeBase64Text(value);
  }
  if (normalizedEncoding === "quoted-printable") {
    return decodeQuotedPrintable(value);
  }
  return value;
}

function decodeBase64Text(value) {
  try {
    const binary = atob(String(value || "").replace(/\s+/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch (error) {
    return String(value || "");
  }
}

function decodeQuotedPrintable(value) {
  const normalized = String(value || "").replace(/=\n/g, "");
  const bytes = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const hex = normalized.slice(index + 1, index + 3);
    if (char === "=" && /^[0-9A-F]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16));
      index += 2;
      continue;
    }
    bytes.push(char.charCodeAt(0));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function cleanDecodedBody(value) {
  return String(value || "")
    .split(/\n/)
    .filter((line) => !/^--[A-Za-z0-9'()+_,\-./:=?]+--?\s*$/.test(line.trim()))
    .join("\n")
    .trim();
}

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ""));
}
