const MAILBOX_META = {
  inbox: { title: "Inbox", empty: "No inbox mail yet." },
  sent: { title: "Sent", empty: "No sent threads yet." },
  all: { title: "All Mail", empty: "No mail yet." },
  archive: { title: "Archive", empty: "No archived mail." },
  trash: { title: "Trash", empty: "Trash is empty." }
};

const state = {
  activeView: "mailbox",
  mailbox: "inbox",
  config: null,
  counts: {},
  threads: [],
  selectedThreadId: "",
  selectedThread: null,
  selectedMessages: [],
  search: "",
  searchTimer: null
};

const elements = {
  appShell: document.querySelector(".app-shell"),
  topbar: document.querySelector(".topbar"),
  mailboxButtons: document.querySelectorAll("[data-mailbox]"),
  composeButton: document.querySelector("[data-view='compose']"),
  viewPanels: document.querySelectorAll("[data-view-panel]"),
  countBadges: document.querySelectorAll("[data-count]"),
  pageTitle: document.querySelector("#pageTitle"),
  pageSubtitle: document.querySelector("#pageSubtitle"),
  refreshButton: document.querySelector("#refreshButton"),
  searchInput: document.querySelector("#searchInput"),
  clearSearchButton: document.querySelector("#clearSearchButton"),
  mailboxStatus: document.querySelector("#mailboxStatus"),
  inboxAddress: document.querySelector("#inboxAddress"),
  threadStatus: document.querySelector("#threadStatus"),
  threadList: document.querySelector("#threadList"),
  threadSubject: document.querySelector("#threadSubject"),
  threadMeta: document.querySelector("#threadMeta"),
  threadActions: document.querySelector("#threadActions"),
  markButton: document.querySelector("#markButton"),
  archiveButton: document.querySelector("#archiveButton"),
  deleteButton: document.querySelector("#deleteButton"),
  restoreButton: document.querySelector("#restoreButton"),
  permanentDeleteButton: document.querySelector("#permanentDeleteButton"),
  threadMessages: document.querySelector("#threadMessages"),
  replyForm: document.querySelector("#replyForm"),
  replyRecipient: document.querySelector("#replyRecipient"),
  replyText: document.querySelector("#replyText"),
  replyButton: document.querySelector("#replyButton"),
  replyStatus: document.querySelector("#replyStatus"),
  composer: document.querySelector("#composer"),
  from: document.querySelector("#from"),
  to: document.querySelector("#to"),
  cc: document.querySelector("#cc"),
  bcc: document.querySelector("#bcc"),
  subject: document.querySelector("#subject"),
  text: document.querySelector("#text"),
  ccRow: document.querySelector("#ccRow"),
  sendButton: document.querySelector("#sendButton"),
  sendStatus: document.querySelector("#sendStatus"),
  serviceState: document.querySelector("#serviceState"),
  serviceMeta: document.querySelector("#serviceMeta"),
  toggleCcButton: document.querySelector("#toggleCcButton"),
  fillTestButton: document.querySelector("#fillTestButton")
};

boot();

function boot() {
  installWindowSizing();
  elements.mailboxButtons.forEach((button) => {
    button.addEventListener("click", () => setMailbox(button.dataset.mailbox));
  });
  elements.composeButton.addEventListener("click", () => setView("compose"));
  elements.refreshButton.addEventListener("click", () => loadMailbox({ preserveSelection: true }));
  elements.clearSearchButton.addEventListener("click", clearSearch);
  elements.searchInput.addEventListener("input", handleSearchInput);
  elements.composer.addEventListener("submit", sendDraft);
  elements.replyForm.addEventListener("submit", sendReply);
  elements.toggleCcButton.addEventListener("click", toggleCc);
  elements.fillTestButton.addEventListener("click", fillTestNote);
  elements.markButton.addEventListener("click", toggleReadState);
  elements.archiveButton.addEventListener("click", toggleArchive);
  elements.deleteButton.addEventListener("click", moveToTrash);
  elements.restoreButton.addEventListener("click", restoreThread);
  elements.permanentDeleteButton.addEventListener("click", permanentlyDeleteThread);

  setMailbox("inbox", { skipLoad: true });
  Promise.all([loadConfig(), loadMailbox()]).catch((error) => {
    setService("Offline", error.message);
  });
}

async function loadConfig() {
  const config = await apiGet("/api/config");
  state.config = config;

  elements.from.value = config.defaultFrom || "";
  elements.to.value = config.defaultTo || "";
  elements.inboxAddress.textContent = config.inbox && config.inbox.address ? config.inbox.address : "Cloudflare mail";

  setService(
    config.hasToken && config.inbox && config.inbox.enabled ? "Ready" : "Setup incomplete",
    `Account ${config.accountId || "not set"}`
  );

  checkInboxHealth();
}

async function loadMailbox(options = {}) {
  if (state.activeView !== "mailbox") {
    return;
  }

  elements.threadStatus.textContent = "Loading";
  const params = new URLSearchParams({ box: state.mailbox });
  if (state.search) {
    params.set("q", state.search);
  }

  try {
    const result = await apiGet(`/api/inbox/threads?${params.toString()}`);
    state.counts = result.counts || {};
    state.threads = result.threads || [];
    renderCounts();
    elements.pageSubtitle.textContent = state.search ? `Search: ${state.search}` : mailboxSubtitle();
    renderThreadList();
    if (options.resetThreadScroll) {
      resetThreadListScroll();
    }
    queueWindowSizing();

    const stillExists = state.threads.some((thread) => thread.threadId === state.selectedThreadId);
    if (options.preserveSelection && stillExists) {
      await selectThread(state.selectedThreadId, { markRead: false, skipListRender: true });
      return;
    }

    clearThread();
  } catch (error) {
    elements.threadStatus.textContent = "Offline";
    elements.threadList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    clearThread();
  }
}

async function selectThread(threadId, options = {}) {
  state.selectedThreadId = threadId;
  const result = await apiGet(`/api/inbox/threads/${encodeURIComponent(threadId)}`);
  state.selectedThread = result.thread;
  state.selectedMessages = result.messages || [];
  renderThread();

  if (options.markRead !== false && Number(state.selectedThread.unreadCount || 0) > 0) {
    await apiPatch(`/api/inbox/threads/${encodeURIComponent(threadId)}/read`, { read: true }).catch(() => null);
    state.selectedThread.unreadCount = 0;
    state.threads = state.threads.map((thread) => (
      thread.threadId === threadId ? { ...thread, unreadCount: 0 } : thread
    ));
    renderCounts();
  }

  if (!options.skipListRender) {
    renderThreadList();
  }
}

function clearThread() {
  state.selectedThreadId = "";
  state.selectedThread = null;
  state.selectedMessages = [];
  renderThread();
  queueWindowSizing();
}

async function sendDraft(event) {
  event.preventDefault();
  setSendStatus("Sending...", "");
  elements.sendButton.disabled = true;

  try {
    const result = await apiPost("/api/send", {
      from: elements.from.value,
      to: elements.to.value,
      cc: elements.cc.value,
      bcc: elements.bcc.value,
      subject: elements.subject.value,
      text: elements.text.value
    });

    setSendStatus(`Sent. ${deliveryCounts(result.cloudflare && result.cloudflare.result)}`, "success");
    elements.subject.value = "";
    elements.text.value = "";
    setMailbox("sent");
    queueWindowSizing();
  } catch (error) {
    setSendStatus(error.message, "error");
  } finally {
    elements.sendButton.disabled = false;
  }
}

async function sendReply(event) {
  event.preventDefault();

  if (!state.selectedThread || !state.selectedMessages.length) {
    setReplyStatus("Select a thread first.", "error");
    return;
  }

  const text = elements.replyText.value.trim();
  const recipient = replyRecipient();
  if (!text || !recipient) {
    setReplyStatus(!text ? "Reply is empty." : "No reply recipient found.", "error");
    return;
  }

  const lastMessage = state.selectedMessages[state.selectedMessages.length - 1] || {};
  const references = [lastMessage.references, lastMessage.messageId].filter(Boolean).join(" ");
  elements.replyButton.disabled = true;
  setReplyStatus("Sending...", "");

  try {
    await apiPost("/api/send", {
      from: elements.from.value,
      to: recipient,
      subject: replySubject(state.selectedThread.subject),
      text,
      threadId: state.selectedThread.threadId,
      inReplyTo: lastMessage.messageId || "",
      references
    });

    elements.replyText.value = "";
    setReplyStatus("Sent.", "success");
    await selectThread(state.selectedThread.threadId, { markRead: false });
    await loadMailbox({ preserveSelection: true });
    queueWindowSizing();
  } catch (error) {
    setReplyStatus(error.message, "error");
  } finally {
    elements.replyButton.disabled = false;
  }
}

async function toggleReadState() {
  if (!state.selectedThread) {
    return;
  }

  const unread = Number(state.selectedThread.unreadCount || 0) > 0;
  const nextReadState = unread;
  await updateThread(`/read`, { read: nextReadState }, nextReadState ? "Marked read." : "Marked unread.");
}

async function toggleArchive() {
  if (!state.selectedThread) {
    return;
  }

  const archived = state.selectedThread.folder !== "archive";
  await updateThread(`/archive`, { archived }, archived ? "Archived." : "Moved to Inbox.");
}

async function moveToTrash() {
  await updateThread(`/trash`, { trashed: true }, "Moved to Trash.");
}

async function restoreThread() {
  await updateThread(`/trash`, { trashed: false }, "Restored.");
}

async function permanentlyDeleteThread() {
  if (!state.selectedThread) {
    return;
  }

  const subject = state.selectedThread.subject || "this thread";
  if (!window.confirm(`Delete "${subject}" forever?`)) {
    return;
  }

  await apiDelete(`/api/inbox/threads/${encodeURIComponent(state.selectedThread.threadId)}`);
  showToast("Deleted forever.");
  await loadMailbox();
}

async function updateThread(actionPath, payload, message) {
  if (!state.selectedThread) {
    return;
  }

  await apiPatch(`/api/inbox/threads/${encodeURIComponent(state.selectedThread.threadId)}${actionPath}`, payload);
  showToast(message);
  await loadMailbox();
}

function setMailbox(mailbox, options = {}) {
  state.activeView = "mailbox";
  const nextMailbox = MAILBOX_META[mailbox] ? mailbox : "inbox";
  const transition = planMailboxTransition(nextMailbox);
  state.mailbox = transition.mailbox;
  state.selectedThreadId = transition.selectedThreadId;
  state.selectedThread = transition.selectedThreadId ? state.selectedThread : null;
  state.selectedMessages = transition.selectedThreadId ? state.selectedMessages : [];
  elements.viewPanels.forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== "mailbox";
  });
  elements.mailboxButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mailbox === state.mailbox);
  });
  elements.composeButton.classList.remove("active");
  elements.searchInput.disabled = false;
  elements.refreshButton.hidden = false;

  const meta = MAILBOX_META[state.mailbox];
  elements.pageTitle.textContent = meta.title;
  elements.pageSubtitle.textContent = state.search ? `Search: ${state.search}` : mailboxSubtitle();

  if (!options.skipLoad) {
    loadMailbox({ resetThreadScroll: transition.resetThreadScroll });
  }
  queueWindowSizing();
}

function planMailboxTransition(nextMailbox) {
  const stateApi = window.BetterEmailMailboxState;
  if (!stateApi || !stateApi.planMailboxTransition) {
    const mailboxChanged = state.mailbox !== nextMailbox;
    return {
      mailbox: nextMailbox,
      selectedThreadId: mailboxChanged ? "" : state.selectedThreadId,
      resetThreadScroll: mailboxChanged
    };
  }

  return stateApi.planMailboxTransition({
    currentMailbox: state.mailbox,
    nextMailbox,
    selectedThreadId: state.selectedThreadId
  });
}

function resetThreadListScroll() {
  if (elements.threadList) {
    elements.threadList.scrollTop = 0;
  }
}

function setView(view) {
  state.activeView = view;
  elements.viewPanels.forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== view;
  });
  elements.mailboxButtons.forEach((button) => button.classList.remove("active"));
  elements.composeButton.classList.toggle("active", view === "compose");
  elements.searchInput.disabled = true;
  elements.refreshButton.hidden = true;

  elements.pageTitle.textContent = "Compose";
  elements.pageSubtitle.textContent = elements.from.value || "inbox@example.com";
  elements.subject.focus();
  queueWindowSizing();
}

function handleSearchInput() {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(() => {
    state.search = elements.searchInput.value.trim();
    elements.clearSearchButton.hidden = !state.search;
    elements.pageSubtitle.textContent = state.search ? `Search: ${state.search}` : mailboxSubtitle();
    loadMailbox();
  }, 180);
}

function clearSearch() {
  elements.searchInput.value = "";
  state.search = "";
  elements.clearSearchButton.hidden = true;
  elements.pageSubtitle.textContent = mailboxSubtitle();
  loadMailbox();
}

function renderCounts() {
  elements.countBadges.forEach((badge) => {
    const key = badge.dataset.count;
    badge.textContent = String(state.counts[key] || 0);
  });
}

function renderThreadList() {
  const meta = MAILBOX_META[state.mailbox];
  elements.threadStatus.textContent = `${state.threads.length} ${state.threads.length === 1 ? "thread" : "threads"}`;

  if (!state.threads.length) {
    elements.threadList.innerHTML = `<div class="empty-state">${escapeHtml(meta.empty)}</div>`;
    return;
  }

  elements.threadList.innerHTML = state.threads.map((thread) => {
    const latest = thread.latestMessage || {};
    const date = new Date(thread.latestAt || latest.createdAt || thread.updatedAt);
    const active = thread.threadId === state.selectedThreadId ? " active" : "";
    const unreadClass = Number(thread.unreadCount || 0) > 0 ? " unread" : "";
    const sender = latest.direction === "outbound" ? `To: ${(latest.to || []).join(", ")}` : latest.from;
    const badge = state.mailbox === "all" ? thread.folder : "";
    const attachmentCount = Array.isArray(latest.attachments) ? latest.attachments.length : 0;

    return `
      <button class="thread-item${active}${unreadClass}" type="button" data-thread-id="${escapeHtml(thread.threadId)}">
        <span class="thread-row">
          <strong>${escapeHtml(thread.subject || "(no subject)")}</strong>
          <time>${escapeHtml(formatDate(date))}</time>
        </span>
        <span class="thread-sender">${escapeHtml(sender || "")}</span>
        <span class="thread-preview">${escapeHtml(latest.snippet || "")}</span>
        ${attachmentCount ? `<span class="thread-attachment">${attachmentCount} ${attachmentCount === 1 ? "file" : "files"}</span>` : ""}
        ${badge ? `<span class="thread-folder">${escapeHtml(badge)}</span>` : ""}
      </button>
    `;
  }).join("");

  elements.threadList.querySelectorAll("[data-thread-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectThread(button.dataset.threadId).catch((error) => showToast(error.message, "error"));
    });
  });
  queueWindowSizing();
}

function renderThread() {
  if (!state.selectedThread) {
    elements.threadSubject.textContent = "No thread selected";
    elements.threadMeta.textContent = "";
    elements.threadActions.hidden = true;
    elements.threadMessages.innerHTML = '<div class="empty-state">Select a thread to read it.</div>';
    elements.replyForm.hidden = true;
    queueWindowSizing();
    return;
  }

  const participants = (state.selectedThread.participants || []).join(", ");
  const recipient = replyRecipient();
  elements.threadSubject.textContent = state.selectedThread.subject || "(no subject)";
  elements.threadMeta.textContent = participants;
  elements.threadActions.hidden = false;
  elements.replyForm.hidden = state.mailbox === "trash";
  elements.replyRecipient.textContent = recipient ? `To: ${recipient}` : "";

  const isTrash = state.selectedThread.folder === "trash" || state.mailbox === "trash";
  const isArchive = state.selectedThread.folder === "archive" || state.mailbox === "archive";
  const isUnread = Number(state.selectedThread.unreadCount || 0) > 0;
  elements.markButton.textContent = isUnread ? "Read" : "Unread";
  elements.archiveButton.textContent = isArchive ? "Move to Inbox" : "Archive";
  elements.archiveButton.hidden = isTrash;
  elements.deleteButton.hidden = isTrash;
  elements.restoreButton.hidden = !isTrash;
  elements.permanentDeleteButton.hidden = !isTrash;

  elements.threadMessages.innerHTML = state.selectedMessages.map((message) => {
    const date = new Date(message.createdAt || message.receivedAt || message.sentAt);
    const isOutbound = message.direction === "outbound";
    const toLine = Array.isArray(message.to) && message.to.length ? `To: ${message.to.join(", ")}` : "";
    const ccLine = Array.isArray(message.cc) && message.cc.length ? `Cc: ${message.cc.join(", ")}` : "";
    const bodyState = getMessageBodyState(message);
    const richClass = bodyState.kind === "html" ? " has-rich-body" : "";

    return `
      <article class="message-bubble ${isOutbound ? "outbound" : "inbound"}${richClass}">
        <div class="message-meta">
          <strong>${escapeHtml(isOutbound ? "You" : message.from || "Unknown")}</strong>
          <span>${escapeHtml(formatDate(date))}</span>
        </div>
        ${toLine ? `<div class="message-to">${escapeHtml(toLine)}</div>` : ""}
        ${ccLine ? `<div class="message-to">${escapeHtml(ccLine)}</div>` : ""}
        ${renderMessageBody(message, bodyState)}
        ${renderAttachments(message.attachments)}
      </article>
    `;
  }).join("");
  queueWindowSizing();
}

function getMessageBodyState(message) {
  const bodyApi = window.BetterEmailMessageBodyState;
  if (bodyApi && bodyApi.getMessageBodyState) {
    return bodyApi.getMessageBodyState(message);
  }
  if (message.html) {
    return { kind: "html", html: message.html };
  }
  return { kind: "text", text: message.text || stripHtml(message.html) || message.snippet || "" };
}

function renderMessageBody(message, bodyState) {
  if (bodyState.kind === "html" && window.BetterEmailRendering) {
    const document = window.BetterEmailRendering.buildSafeEmailDocument(bodyState.html);
    return `
      <div class="message-body rich-email-body">
        <iframe
          class="email-frame"
          title="${escapeHtml(message.subject || "Email message")}"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerpolicy="no-referrer"
          srcdoc="${escapeHtml(document)}"></iframe>
      </div>
    `;
  }

  if (bodyState.kind === "missing") {
    return `
      <div class="missing-body-box">
        <p>${escapeHtml(bodyState.text)}</p>
      </div>
    `;
  }

  return `<p class="message-text">${escapeHtml(bodyState.text || "")}</p>`;
}

function renderAttachments(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) {
    return "";
  }

  return `
    <div class="attachment-strip" aria-label="Attachments">
      ${attachments.map((attachment) => `
        <span class="attachment-chip">
          <span class="attachment-name">${escapeHtml(attachment.filename || "attachment")}</span>
          <span class="attachment-meta">${escapeHtml(attachment.contentType || "file")} - ${escapeHtml(formatAttachmentSize(attachment.size))}</span>
        </span>
      `).join("")}
    </div>
  `;
}

function formatAttachmentSize(size) {
  if (window.BetterEmailRendering && window.BetterEmailRendering.formatAttachmentSize) {
    return window.BetterEmailRendering.formatAttachmentSize(size);
  }
  return `${Number(size || 0)} B`;
}

function installWindowSizing() {
  const update = () => {
    const layoutApi = window.BetterEmailRoutingLayout;
    if (!layoutApi || !layoutApi.calculateLayoutMetrics) {
      return;
    }

    const rootStyle = getComputedStyle(document.documentElement);
    const appPad = parseFloat(rootStyle.getPropertyValue("--app-pad")) || 24;
    const metrics = layoutApi.calculateLayoutMetrics({
      viewportWidth: window.visualViewport ? window.visualViewport.width : window.innerWidth,
      viewportHeight: window.visualViewport ? window.visualViewport.height : window.innerHeight,
      topbarHeight: elements.topbar ? elements.topbar.offsetHeight : 0,
      appPad,
      panelGap: 18
    });

    document.documentElement.style.setProperty("--window-height", metrics.windowHeight);
    document.documentElement.style.setProperty("--mailbox-height", metrics.mailboxHeight);
    document.documentElement.style.setProperty("--thread-list-max", metrics.threadListMax);
    document.documentElement.style.setProperty("--message-pane-min", metrics.messagePaneMin);
    document.documentElement.style.setProperty("--composer-max", metrics.composerMax);
    elements.appShell.classList.toggle("is-narrow", metrics.narrow);
  };

  const resizeObserver = new ResizeObserver(() => queueWindowSizing());
  if (elements.topbar) {
    resizeObserver.observe(elements.topbar);
  }

  window.addEventListener("resize", queueWindowSizing, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", queueWindowSizing, { passive: true });
    window.visualViewport.addEventListener("scroll", queueWindowSizing, { passive: true });
  }

  installWindowSizing.update = update;
  queueWindowSizing();
}

function queueWindowSizing() {
  window.cancelAnimationFrame(queueWindowSizing.frame);
  queueWindowSizing.frame = window.requestAnimationFrame(() => {
    if (installWindowSizing.update) {
      installWindowSizing.update();
    }
  });
}

function toggleCc() {
  elements.ccRow.hidden = !elements.ccRow.hidden;
  if (!elements.ccRow.hidden) {
    elements.cc.focus();
  }
}

function fillTestNote() {
  elements.subject.value = "Programming feedback";
  elements.text.value = "Hey - you suck at pogramming";
  elements.text.focus();
}

function mailboxSubtitle() {
  const address = state.config && state.config.inbox ? state.config.inbox.address : "inbox@example.com";
  const count = state.counts[state.mailbox];
  return Number.isFinite(Number(count)) ? `${address} - ${count} ${Number(count) === 1 ? "thread" : "threads"}` : address;
}

function deliveryCounts(result) {
  if (!result) {
    return "Cloudflare accepted the request.";
  }

  const delivered = Array.isArray(result.delivered) ? result.delivered.length : 0;
  const queued = Array.isArray(result.queued) ? result.queued.length : 0;
  const bounced = Array.isArray(result.permanent_bounces) ? result.permanent_bounces.length : 0;

  if (!delivered && !queued && !bounced) {
    return "Cloudflare returned no delivery counters.";
  }

  return `${delivered} delivered, ${queued} queued, ${bounced} bounced.`;
}

async function checkInboxHealth() {
  try {
    await apiGet("/api/inbox/health");
  } catch (error) {
    setService("Inbox offline", error.message);
  }
}

function setService(title, detail) {
  elements.serviceState.textContent = title;
  elements.serviceMeta.textContent = detail;
}

function setSendStatus(message, type) {
  elements.sendStatus.textContent = message;
  elements.sendStatus.className = `send-status ${type || ""}`.trim();
}

function setReplyStatus(message, type) {
  elements.replyStatus.textContent = message;
  elements.replyStatus.className = `send-status ${type || ""}`.trim();
}

function showToast(message, type = "") {
  elements.mailboxStatus.textContent = message;
  elements.mailboxStatus.className = `toast ${type} show`.trim();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.mailboxStatus.className = "toast";
  }, 2200);
}

async function apiGet(path) {
  const response = await fetch(path, {
    headers: { Accept: "application/json" }
  });
  return parseApiResponse(response);
}

async function apiPost(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return parseApiResponse(response);
}

async function apiPatch(path, payload) {
  const response = await fetch(path, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
  return parseApiResponse(response);
}

async function apiDelete(path) {
  const response = await fetch(path, {
    method: "DELETE",
    headers: { Accept: "application/json" }
  });
  return parseApiResponse(response);
}

async function parseApiResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || body.message || `Request failed with HTTP ${response.status}`);
  }

  return body;
}

function formatDate(date) {
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function replyRecipient() {
  const defaultFrom = (state.config && state.config.defaultFrom || elements.from.value || "").toLowerCase();
  const inbound = [...state.selectedMessages].reverse().find((message) => (
    message.direction === "inbound" && (message.replyTo || message.from)
  ));

  if (inbound) {
    return inbound.replyTo || inbound.from;
  }

  return (state.selectedThread && state.selectedThread.participants || []).find((email) => email.toLowerCase() !== defaultFrom) || "";
}

function replySubject(subject) {
  const value = String(subject || "(no subject)").trim();
  return /^re:/i.test(value) ? value : `Re: ${value}`;
}

function stripHtml(value) {
  const container = document.createElement("div");
  container.innerHTML = String(value || "");
  return container.textContent || container.innerText || "";
}
