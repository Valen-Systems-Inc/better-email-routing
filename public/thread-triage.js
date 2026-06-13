(function attachThreadTriage(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.BetterEmailTriage = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function createThreadTriage() {
  const FILTERS = new Set(["all", "unread", "needsReply", "awaiting", "attachments"]);

  function normalizeFilter(value) {
    const filter = String(value || "all").trim();
    return FILTERS.has(filter) ? filter : "all";
  }

  function classifyThread(thread) {
    const latest = thread && thread.latestMessage || {};
    const attachments = Array.isArray(latest.attachments) ? latest.attachments : [];
    const latestDirection = String(latest.direction || "");
    return {
      unread: Number(thread && thread.unreadCount || 0) > 0,
      needsReply: latestDirection === "inbound",
      awaiting: latestDirection === "outbound",
      attachments: attachments.length > 0
    };
  }

  function filterThreads(threads, filterName) {
    const filter = normalizeFilter(filterName);
    const list = Array.isArray(threads) ? threads : [];
    if (filter === "all") {
      return list;
    }
    return list.filter((thread) => Boolean(classifyThread(thread)[filter]));
  }

  function summarizeThreads(threads) {
    const summary = {
      all: 0,
      unread: 0,
      needsReply: 0,
      awaiting: 0,
      attachments: 0
    };
    for (const thread of Array.isArray(threads) ? threads : []) {
      const traits = classifyThread(thread);
      summary.all += 1;
      if (traits.unread) summary.unread += 1;
      if (traits.needsReply) summary.needsReply += 1;
      if (traits.awaiting) summary.awaiting += 1;
      if (traits.attachments) summary.attachments += 1;
    }
    return summary;
  }

  function buildReplyAllRecipients(messages, currentUserEmails) {
    const source = [...(Array.isArray(messages) ? messages : [])]
      .reverse()
      .find((message) => message && message.direction === "inbound" && (message.replyTo || message.from));
    if (!source) {
      return { to: "", cc: [] };
    }

    const to = source.replyTo || source.from || "";
    const toEmail = extractEmailAddress(to).toLowerCase();
    const ownEmails = new Set(splitRecipients(currentUserEmails)
      .map((entry) => extractEmailAddress(entry).toLowerCase())
      .filter(Boolean));
    const seen = new Set([toEmail, ...ownEmails].filter(Boolean));
    const cc = [];

    for (const recipient of [...splitRecipients(source.to), ...splitRecipients(source.cc)]) {
      const email = extractEmailAddress(recipient);
      const key = email.toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      cc.push(recipient);
    }

    return { to, cc };
  }

  function splitRecipients(value) {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.flatMap(splitRecipients);
    }
    return String(value)
      .split(/[;\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function extractEmailAddress(value) {
    const text = String(value || "").trim();
    const bracketed = text.match(/<([^>]+)>/);
    return (bracketed ? bracketed[1] : text).trim();
  }

  return {
    buildReplyAllRecipients,
    classifyThread,
    extractEmailAddress,
    filterThreads,
    normalizeFilter,
    summarizeThreads
  };
});
