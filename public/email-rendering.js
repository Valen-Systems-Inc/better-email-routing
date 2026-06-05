(function attachEmailRendering(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.BetterEmailRendering = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function createEmailRendering() {
  function buildSafeEmailDocument(html) {
    const body = sanitizeEmailHtml(html);
    return [
      "<!doctype html>",
      "<html>",
      "<head>",
      "<meta charset=\"utf-8\">",
      "<base target=\"_blank\">",
      "<style>",
      "html,body{margin:0;padding:0;background:#fff;color:#1f2522;font-family:Arial,sans-serif;}",
      "body{overflow:auto;}",
      "img{max-width:100%;height:auto;}",
      "table{max-width:100%;}",
      "a{color:#255c99;}",
      "</style>",
      "</head>",
      "<body>",
      body,
      "</body>",
      "</html>"
    ].join("");
  }

  function sanitizeEmailHtml(html) {
    const value = String(html || "");
    if (typeof DOMParser === "undefined") {
      return sanitizeEmailHtmlString(value);
    }

    const document = new DOMParser().parseFromString(value, "text/html");
    document.querySelectorAll("script, iframe, object, embed, form, meta[http-equiv='refresh']").forEach((node) => {
      node.remove();
    });

    document.querySelectorAll("*").forEach((node) => {
      [...node.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const content = String(attribute.value || "").trim();
        if (name.startsWith("on") || name === "srcdoc") {
          node.removeAttribute(attribute.name);
          return;
        }
        if ((name === "href" || name === "src") && /^javascript:/i.test(content)) {
          node.removeAttribute(attribute.name);
        }
      });
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });

    return document.body.innerHTML;
  }

  function sanitizeEmailHtmlString(html) {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
      .replace(/<object[\s\S]*?<\/object>/gi, "")
      .replace(/<embed[\s\S]*?>/gi, "")
      .replace(/<form[\s\S]*?<\/form>/gi, "")
      .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s+(href|src)\s*=\s*("|')javascript:[\s\S]*?\2/gi, "");
  }

  function formatAttachmentSize(bytes) {
    const size = Number(bytes || 0);
    if (size < 1024) {
      return `${size} B`;
    }
    if (size < 1024 * 1024) {
      return `${formatNumber(size / 1024)} KB`;
    }
    return `${formatNumber(size / 1024 / 1024)} MB`;
  }

  function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  }

  return {
    buildSafeEmailDocument,
    formatAttachmentSize
  };
});
