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
  selectedThreadIds: new Set(),
  activeFilter: "all",
  replyAll: false,
  search: "",
  searchTimer: null,
  setup: null,
  oauthPollTimer: null,
  updateDownloadUrl: ""
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
  triageStats: document.querySelector("#triageStats"),
  quickFilters: document.querySelector("#quickFilters"),
  bulkToolbar: document.querySelector("#bulkToolbar"),
  selectVisibleThreads: document.querySelector("#selectVisibleThreads"),
  selectionCount: document.querySelector("#selectionCount"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  threadList: document.querySelector("#threadList"),
  messageColumn: document.querySelector(".message-column"),
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
  replyAllButton: document.querySelector("#replyAllButton"),
  replyCcPreview: document.querySelector("#replyCcPreview"),
  replyCcRow: document.querySelector("#replyCcRow"),
  replyCc: document.querySelector("#replyCc"),
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
  fillTestButton: document.querySelector("#fillTestButton"),
  setupButton: document.querySelector("#setupButton"),
  updateButton: document.querySelector("#updateButton"),
  setupModal: document.querySelector("#setupModal"),
  closeSetupButton: document.querySelector("#closeSetupButton"),
  setupForm: document.querySelector("#setupForm"),
  setupSteps: document.querySelector("#setupSteps"),
  setupPath: document.querySelector("#setupPath"),
  setupSaveStatus: document.querySelector("#setupSaveStatus"),
  setupDefaultFrom: document.querySelector("#setupDefaultFrom"),
  setupDefaultFromLabel: document.querySelector("#setupDefaultFromLabel"),
  setupDefaultTo: document.querySelector("#setupDefaultTo"),
  setupAccountId: document.querySelector("#setupAccountId"),
  setupApiToken: document.querySelector("#setupApiToken"),
  setupApiTokenHint: document.querySelector("#setupApiTokenHint"),
  setupMailboxWorkerUrl: document.querySelector("#setupMailboxWorkerUrl"),
  setupMailboxApiSecret: document.querySelector("#setupMailboxApiSecret"),
  setupMailboxSecretHint: document.querySelector("#setupMailboxSecretHint"),
  keysFileInput: document.querySelector("#keysFileInput"),
  uploadKeysButton: document.querySelector("#uploadKeysButton"),
  connectCloudflareButton: document.querySelector("#connectCloudflareButton"),
  disconnectCloudflareButton: document.querySelector("#disconnectCloudflareButton"),
  cloudflareConnectStatus: document.querySelector("#cloudflareConnectStatus"),
  setupAccountSelectRow: document.querySelector("#setupAccountSelectRow"),
  setupAccountSelect: document.querySelector("#setupAccountSelect"),
  cloudflareOauthLink: document.querySelector("#cloudflareOauthLink")
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
  elements.from.addEventListener("change", handleSenderChange);
  elements.replyAllButton.addEventListener("click", toggleReplyAll);
  elements.selectVisibleThreads.addEventListener("change", toggleSelectVisibleThreads);
  elements.clearSelectionButton.addEventListener("click", clearSelectedThreads);
  elements.quickFilters.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => setQuickFilter(button.dataset.filter));
  });
  document.querySelectorAll("[data-bulk-action]").forEach((button) => {
    button.addEventListener("click", () => runBulkAction(button.dataset.bulkAction));
  });
  elements.toggleCcButton.addEventListener("click", toggleCc);
  elements.fillTestButton.addEventListener("click", fillTestNote);
  elements.setupButton.addEventListener("click", openSetup);
  elements.updateButton.addEventListener("click", handleUpdateButton);
  elements.closeSetupButton.addEventListener("click", closeSetup);
  elements.setupForm.addEventListener("submit", saveSetup);
  elements.uploadKeysButton.addEventListener("click", () => elements.keysFileInput.click());
  elements.keysFileInput.addEventListener("change", uploadKeysFile);
  elements.connectCloudflareButton.addEventListener("click", connectCloudflare);
  elements.disconnectCloudflareButton.addEventListener("click", disconnectCloudflare);
  elements.setupAccountSelect.addEventListener("change", () => {
    elements.setupAccountId.value = elements.setupAccountSelect.value;
  });
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

async function handleUpdateButton() {
  if (state.updateDownloadUrl) {
    await openExternalUrl(state.updateDownloadUrl);
    return;
  }

  elements.updateButton.disabled = true;
  const originalLabel = elements.updateButton.textContent;
  elements.updateButton.textContent = "Checking...";

  try {
    const result = await apiGet("/api/update/check");
    if (result.updateAvailable && result.downloadUrl) {
      state.updateDownloadUrl = result.downloadUrl;
      elements.updateButton.textContent = "Download update";
      showToast(`Version ${result.latestVersion} is ready.`);
      setService("Update available", `Current ${result.currentVersion}, latest ${result.latestVersion}`);
      return;
    }

    const version = result.currentVersion || (state.config && state.config.version) || "";
    elements.updateButton.textContent = "Up to date";
    showToast(version ? `You are on ${version}.` : "You are on the latest version.");
    window.setTimeout(() => {
      if (!state.updateDownloadUrl) {
        elements.updateButton.textContent = originalLabel;
      }
    }, 1800);
  } catch (error) {
    elements.updateButton.textContent = originalLabel;
    showToast(error.message, "error");
  } finally {
    elements.updateButton.disabled = false;
  }
}

async function loadConfig() {
  const config = await apiGet("/api/config");
  state.config = config;

  populateSenderOptions(config.senderProfiles || [], config.defaultFrom || "");
  elements.to.value = config.defaultTo || "";
  elements.inboxAddress.textContent = config.inbox && config.inbox.address ? config.inbox.address : "Cloudflare mail";

  setService(
    config.inbox && config.inbox.enabled ? (config.hasToken ? "Ready" : "Inbox ready") : "Setup incomplete",
    senderServiceMeta(config)
  );

  loadSetupStatus({ silent: true });
  if (config.inbox && config.inbox.enabled) {
    checkInboxHealth();
  }
}

async function loadSetupStatus(options = {}) {
  try {
    const status = await apiGet("/api/setup/status");
    state.setup = status;
    renderSetupStatus(status);
    populateSetupForm(status);
    return status;
  } catch (error) {
    if (!options.silent) {
      setSetupStatus(error.message, "error");
    }
    return null;
  }
}

async function openSetup() {
  elements.setupModal.hidden = false;
  setSetupStatus("Loading setup...", "");
  const status = await loadSetupStatus();
  if (status && status.oauth && status.oauth.connected) {
    loadCloudflareAccounts().catch(() => null);
  }
  setSetupStatus(status ? "" : "Could not load setup.", status ? "" : "error");
  window.setTimeout(() => elements.setupDefaultFrom.focus(), 0);
}

function closeSetup() {
  elements.setupModal.hidden = true;
  stopOAuthPoll();
  setSetupStatus("", "");
}

function populateSetupForm(status) {
  const form = status && status.form ? status.form : {};
  elements.setupDefaultFrom.value = form.defaultFrom || "";
  elements.setupDefaultFromLabel.value = form.defaultFromLabel || "";
  elements.setupDefaultTo.value = form.defaultTo || "";
  elements.setupAccountId.value = form.accountId || "";
  elements.setupMailboxWorkerUrl.value = form.mailboxWorkerUrl || "";
  elements.setupApiToken.value = "";
  elements.setupMailboxApiSecret.value = "";
  elements.setupApiTokenHint.textContent = form.hasCloudflareApiToken ? "Token is already saved. Leave blank to keep it." : "Optional fallback. Connect Cloudflare above when this app build supports it.";
  elements.setupMailboxSecretHint.textContent = form.hasMailboxApiSecret ? "Secret is already saved. Leave blank to keep it." : "Use the same secret configured on your mailbox Worker.";
}

function renderSetupStatus(status) {
  const steps = Array.isArray(status && status.steps) ? status.steps : [];
  elements.setupSteps.innerHTML = steps.map((step) => `
    <div class="setup-step ${escapeHtml(step.state)}">
      <span class="setup-step-state">${escapeHtml(setupStateLabel(step.state))}</span>
      <strong>${escapeHtml(step.label)}</strong>
      <p>${escapeHtml(step.detail)}</p>
    </div>
  `).join("");
  elements.setupPath.textContent = status && status.configPath ? `Local config: ${status.configPath}` : "";
  if (status && status.docs && status.docs.cloudflareOauth) {
    elements.cloudflareOauthLink.href = status.docs.cloudflareOauth;
  }
  renderCloudflareConnect(status && status.oauth || {});
}

async function saveSetup(event) {
  event.preventDefault();
  setSetupStatus("Saving setup...", "");

  try {
    const result = await apiPost("/api/setup/config", {
      defaultFrom: elements.setupDefaultFrom.value,
      defaultFromLabel: elements.setupDefaultFromLabel.value,
      defaultTo: elements.setupDefaultTo.value,
      accountId: elements.setupAccountId.value,
      cloudflareApiToken: elements.setupApiToken.value,
      mailboxWorkerUrl: elements.setupMailboxWorkerUrl.value,
      mailboxApiSecret: elements.setupMailboxApiSecret.value
    });

    state.setup = result;
    renderSetupStatus(result);
    populateSetupForm(result);
    await loadConfig();
    setSetupStatus("Saved. This computer can use those settings now.", "success");
    showToast("Setup saved.");
  } catch (error) {
    setSetupStatus(error.message, "error");
  }
}

async function uploadKeysFile() {
  const file = elements.keysFileInput.files && elements.keysFileInput.files[0];
  elements.keysFileInput.value = "";
  if (!file) {
    return;
  }

  setSetupStatus(`Importing ${file.name || "keys.env"}...`, "");
  elements.uploadKeysButton.disabled = true;

  try {
    const envText = await file.text();
    const result = await apiPost("/api/setup/import-keys", {
      envText,
      fileName: file.name || "keys.env"
    });

    state.setup = result;
    renderSetupStatus(result);
    populateSetupForm(result);
    await loadConfig();
    await loadMailbox({ preserveSelection: true });
    const sendReady = state.config && state.config.hasToken;
    setSetupStatus(
      sendReady
        ? "Keys imported. Sending and inbox settings are stored on this computer."
        : "Keys imported. Inbox is ready; add CLOUDFLARE_API_TOKEN to enable sending.",
      sendReady ? "success" : "error"
    );
    showToast("keys.env imported.");
  } catch (error) {
    setSetupStatus(error.message, "error");
  } finally {
    elements.uploadKeysButton.disabled = false;
  }
}

function setupStateLabel(stateName) {
  return {
    ready: "Ready",
    missing: "Needed",
    planned: "Soon",
    available: "Ready"
  }[stateName] || "Check";
}

function setSetupStatus(message, type) {
  elements.setupSaveStatus.textContent = message;
  elements.setupSaveStatus.className = `send-status ${type || ""}`.trim();
}

function renderCloudflareConnect(oauth) {
  const available = Boolean(oauth && oauth.available);
  const connected = Boolean(oauth && oauth.connected);
  elements.connectCloudflareButton.disabled = !available || connected;
  elements.disconnectCloudflareButton.hidden = !connected;

  if (connected) {
    const expiry = oauth.expiresAt ? ` Token expires ${formatSetupDate(oauth.expiresAt)}.` : "";
    elements.cloudflareConnectStatus.textContent = `Connected to Cloudflare.${expiry}`;
    return;
  }

  if (available) {
    elements.cloudflareConnectStatus.textContent = `Ready to open Cloudflare login. Redirect URI: ${oauth.redirectUri || "http://127.0.0.1:8899/api/oauth/callback"}`;
    return;
  }

  elements.cloudflareConnectStatus.textContent = "This app build does not include a Cloudflare OAuth client ID yet. Use the API token fallback or build with CLOUDFLARE_OAUTH_CLIENT_ID.";
}

async function connectCloudflare() {
  setSetupStatus("Opening Cloudflare login...", "");
  elements.connectCloudflareButton.disabled = true;

  try {
    const result = await apiPost("/api/oauth/start", {});
    await openExternalUrl(result.authUrl);
    setSetupStatus("Finish approval in Cloudflare. This app will update when the callback arrives.", "");
    startOAuthPoll();
  } catch (error) {
    setSetupStatus(error.message, "error");
    const oauth = state.setup && state.setup.oauth || {};
    elements.connectCloudflareButton.disabled = !oauth.available || oauth.connected;
  }
}

async function openExternalUrl(url) {
  const targetUrl = String(url || "").trim();
  if (!targetUrl) {
    return;
  }

  try {
    await apiPost("/api/open-external", { url: targetUrl });
    return;
  } catch (error) {
    console.warn("Server-side URL opener failed; trying browser opener.", error);
  }

  const opener = window.__TAURI__ && window.__TAURI__.opener;
  if (opener && typeof opener.openUrl === "function") {
    await opener.openUrl(targetUrl);
    return;
  }

  window.open(targetUrl, "_blank", "noopener");
}

async function disconnectCloudflare() {
  stopOAuthPoll();
  setSetupStatus("Disconnecting Cloudflare...", "");
  elements.disconnectCloudflareButton.disabled = true;

  try {
    const result = await apiPost("/api/oauth/disconnect", {});
    state.setup = { ...state.setup, oauth: result.oauth };
    renderSetupStatus(state.setup);
    clearCloudflareAccountOptions();
    await loadConfig();
    setSetupStatus("Cloudflare login removed from this computer.", "success");
  } catch (error) {
    setSetupStatus(error.message, "error");
  } finally {
    elements.disconnectCloudflareButton.disabled = false;
  }
}

function startOAuthPoll() {
  stopOAuthPoll();
  let attempts = 0;
  state.oauthPollTimer = window.setInterval(async () => {
    attempts += 1;
    const status = await loadSetupStatus({ silent: true });
    if (status && status.oauth && status.oauth.connected) {
      stopOAuthPoll();
      await loadCloudflareAccounts().catch(() => null);
      await loadConfig();
      setSetupStatus("Cloudflare connected. Save setup after confirming the sender and Worker fields.", "success");
      showToast("Cloudflare connected.");
      return;
    }

    if (attempts >= 60) {
      stopOAuthPoll();
      setSetupStatus("Cloudflare login did not finish. Try Connect again.", "error");
    }
  }, 2000);
}

function stopOAuthPoll() {
  if (state.oauthPollTimer) {
    window.clearInterval(state.oauthPollTimer);
    state.oauthPollTimer = null;
  }
}

async function loadCloudflareAccounts() {
  const result = await apiGet("/api/cloudflare/accounts");
  renderCloudflareAccountOptions(result.accounts || []);
}

function renderCloudflareAccountOptions(accounts) {
  const list = Array.isArray(accounts) ? accounts : [];
  if (!list.length) {
    clearCloudflareAccountOptions();
    return;
  }

  elements.setupAccountSelectRow.hidden = false;
  elements.setupAccountSelect.innerHTML = list.map((account) => `
    <option value="${escapeHtml(account.id)}">${escapeHtml(account.name || account.id)}</option>
  `).join("");

  const currentAccount = elements.setupAccountId.value.trim();
  const selected = list.find((account) => account.id === currentAccount) || list[0];
  elements.setupAccountSelect.value = selected.id;
  if (!currentAccount || list.length === 1) {
    elements.setupAccountId.value = selected.id;
  }
}

function clearCloudflareAccountOptions() {
  elements.setupAccountSelectRow.hidden = true;
  elements.setupAccountSelect.innerHTML = "";
}

function formatSetupDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "later";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
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
    reconcileSelectedThreads();
    renderCounts();
    elements.pageSubtitle.textContent = state.search ? `Search: ${state.search}` : mailboxSubtitle();
    renderTriage();
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
  state.replyAll = false;
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
  state.replyAll = false;
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
      cc: state.replyAll ? elements.replyCc.value : "",
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
  if (transition.resetThreadScroll) {
    state.selectedThreadIds.clear();
    state.activeFilter = "all";
  }
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

function populateSenderOptions(profiles, defaultFromAddress) {
  const senders = normalizeSenderProfiles(profiles, defaultFromAddress);

  if (elements.from.tagName === "SELECT") {
    elements.from.innerHTML = senders.map((profile) => `
      <option value="${escapeHtml(profile.from)}" data-has-token="${profile.hasToken ? "true" : "false"}">${escapeHtml(profile.label || profile.from)}</option>
    `).join("");
  }

  elements.from.value = senders.some((profile) => profile.from === defaultFromAddress)
    ? defaultFromAddress
    : senders[0] && senders[0].from || "";
  updateSendAvailability();
}

function normalizeSenderProfiles(profiles, defaultFromAddress) {
  const known = new Map();
  const add = (profile) => {
    const from = String(profile && profile.from || "").trim();
    if (!from) {
      return;
    }
    known.set(from.toLowerCase(), {
      from,
      label: String(profile.label || from).trim(),
      hasToken: Boolean(profile.hasToken)
    });
  };

  if (defaultFromAddress) {
    add({ from: defaultFromAddress, label: defaultFromAddress });
  }
  (Array.isArray(profiles) ? profiles : []).forEach(add);

  return [...known.values()];
}

function handleSenderChange() {
  if (state.activeView === "compose") {
    elements.pageSubtitle.textContent = elements.from.value || "inbox@example.com";
  }
  updateSendAvailability();
  if (state.selectedThread) {
    renderThread();
  }
}

function selectedSenderProfile() {
  const selected = String(elements.from.value || "").trim().toLowerCase();
  const profiles = state.config && Array.isArray(state.config.senderProfiles) ? state.config.senderProfiles : [];
  return profiles.find((profile) => String(profile.from || "").trim().toLowerCase() === selected) || null;
}

function updateSendAvailability() {
  const profile = selectedSenderProfile();
  if (!profile || profile.hasToken) {
    elements.sendButton.disabled = false;
    if (/token missing/i.test(elements.sendStatus.textContent || "")) {
      setSendStatus("", "");
    }
    return;
  }

  elements.sendButton.disabled = false;
  setSendStatus(`Send token missing for ${profile.from}. Upload keys.env with CLOUDFLARE_API_TOKEN before sending.`, "error");
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

function renderTriage() {
  const summary = summarizeThreads(state.threads);
  elements.triageStats.innerHTML = [
    ["Needs reply", summary.needsReply],
    ["Awaiting", summary.awaiting],
    ["Files", summary.attachments]
  ].map(([label, value]) => `
    <button class="triage-card" type="button" data-filter-card="${filterForStat(label)}">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </button>
  `).join("");

  elements.triageStats.querySelectorAll("[data-filter-card]").forEach((button) => {
    button.addEventListener("click", () => setQuickFilter(button.dataset.filterCard));
  });
  elements.quickFilters.querySelectorAll("[data-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.activeFilter);
    const count = summary[button.dataset.filter] ?? summary.all;
    button.textContent = `${filterLabel(button.dataset.filter)} ${count}`;
  });
  renderBulkToolbar();
}

function renderThreadList() {
  const meta = MAILBOX_META[state.mailbox];
  const visibleThreads = visibleThreadList();
  const filtered = visibleThreads.length !== state.threads.length;
  elements.threadStatus.textContent = `${visibleThreads.length} ${visibleThreads.length === 1 ? "thread" : "threads"}${filtered ? " shown" : ""}`;

  if (!visibleThreads.length) {
    elements.threadList.innerHTML = `<div class="empty-state">${escapeHtml(meta.empty)}</div>`;
    renderBulkToolbar();
    return;
  }

  elements.threadList.innerHTML = visibleThreads.map((thread) => {
    const latest = thread.latestMessage || {};
    const date = new Date(thread.latestAt || latest.createdAt || thread.updatedAt);
    const active = thread.threadId === state.selectedThreadId ? " active" : "";
    const selected = state.selectedThreadIds.has(thread.threadId) ? " selected" : "";
    const unreadClass = Number(thread.unreadCount || 0) > 0 ? " unread" : "";
    const sender = latest.direction === "outbound" ? `To: ${(latest.to || []).join(", ")}` : latest.from;
    const badge = state.mailbox === "all" ? thread.folder : "";
    const attachmentCount = Array.isArray(latest.attachments) ? latest.attachments.length : 0;

    return `
      <div class="thread-item${active}${selected}${unreadClass}" data-thread-row="${escapeHtml(thread.threadId)}">
        <label class="thread-check" aria-label="Select thread">
          <input type="checkbox" data-select-thread="${escapeHtml(thread.threadId)}" ${state.selectedThreadIds.has(thread.threadId) ? "checked" : ""}>
        </label>
        <button class="thread-open" type="button" data-thread-id="${escapeHtml(thread.threadId)}">
          <span class="thread-row">
            <strong>${escapeHtml(thread.subject || "(no subject)")}</strong>
            <time>${escapeHtml(formatDate(date))}</time>
          </span>
          <span class="thread-sender">${escapeHtml(sender || "")}</span>
          <span class="thread-preview">${escapeHtml(latest.snippet || "")}</span>
          <span class="thread-tags">
            ${attachmentCount ? `<span class="thread-attachment">${attachmentCount} ${attachmentCount === 1 ? "file" : "files"}</span>` : ""}
            ${Number(thread.unreadCount || 0) > 0 ? `<span class="thread-unread">${Number(thread.unreadCount)} unread</span>` : ""}
            ${badge ? `<span class="thread-folder">${escapeHtml(badge)}</span>` : ""}
          </span>
        </button>
      </div>
    `;
  }).join("");

  elements.threadList.querySelectorAll("[data-thread-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectThread(button.dataset.threadId).catch((error) => showToast(error.message, "error"));
    });
  });
  elements.threadList.querySelectorAll("[data-select-thread]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => toggleThreadSelection(checkbox.dataset.selectThread, checkbox.checked));
  });
  renderBulkToolbar();
  queueWindowSizing();
}

function visibleThreadList() {
  const triageApi = window.BetterEmailTriage;
  if (triageApi && triageApi.filterThreads) {
    return triageApi.filterThreads(state.threads, state.activeFilter);
  }
  return state.threads;
}

function summarizeThreads(threads) {
  const triageApi = window.BetterEmailTriage;
  if (triageApi && triageApi.summarizeThreads) {
    return triageApi.summarizeThreads(threads);
  }
  return {
    all: Array.isArray(threads) ? threads.length : 0,
    unread: 0,
    needsReply: 0,
    awaiting: 0,
    attachments: 0
  };
}

function setQuickFilter(filter) {
  const triageApi = window.BetterEmailTriage;
  state.activeFilter = triageApi && triageApi.normalizeFilter ? triageApi.normalizeFilter(filter) : filter || "all";
  state.selectedThreadIds.clear();
  renderTriage();
  renderThreadList();
  resetThreadListScroll();
}

function filterLabel(filter) {
  return {
    all: "All",
    unread: "Unread",
    needsReply: "Needs reply",
    awaiting: "Awaiting",
    attachments: "Files"
  }[filter] || "All";
}

function filterForStat(label) {
  return {
    "Needs reply": "needsReply",
    Awaiting: "awaiting",
    Files: "attachments"
  }[label] || "all";
}

function toggleThreadSelection(threadId, selected) {
  if (!threadId) {
    return;
  }
  if (selected) {
    state.selectedThreadIds.add(threadId);
  } else {
    state.selectedThreadIds.delete(threadId);
  }
  renderBulkToolbar();
  renderThreadListSelection();
}

function renderThreadListSelection() {
  elements.threadList.querySelectorAll("[data-thread-row]").forEach((row) => {
    row.classList.toggle("selected", state.selectedThreadIds.has(row.dataset.threadRow));
  });
}

function toggleSelectVisibleThreads() {
  const visibleIds = visibleThreadList().map((thread) => thread.threadId);
  if (elements.selectVisibleThreads.checked) {
    visibleIds.forEach((threadId) => state.selectedThreadIds.add(threadId));
  } else {
    visibleIds.forEach((threadId) => state.selectedThreadIds.delete(threadId));
  }
  renderThreadList();
}

function clearSelectedThreads() {
  state.selectedThreadIds.clear();
  renderThreadList();
}

function reconcileSelectedThreads() {
  const available = new Set(state.threads.map((thread) => thread.threadId));
  state.selectedThreadIds = new Set([...state.selectedThreadIds].filter((threadId) => available.has(threadId)));
}

function renderBulkToolbar() {
  const visibleIds = visibleThreadList().map((thread) => thread.threadId);
  const selectedVisible = visibleIds.filter((threadId) => state.selectedThreadIds.has(threadId));
  const selectedCount = state.selectedThreadIds.size;
  elements.selectionCount.textContent = `${selectedCount} selected`;
  elements.bulkToolbar.hidden = !visibleIds.length && !selectedCount;
  elements.selectVisibleThreads.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  elements.selectVisibleThreads.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
}

async function runBulkAction(action) {
  const threadIds = [...state.selectedThreadIds];
  if (!threadIds.length) {
    showToast("Select at least one thread first.", "error");
    return;
  }

  const tasks = {
    read: (threadId) => apiPatch(`/api/inbox/threads/${encodeURIComponent(threadId)}/read`, { read: true }),
    unread: (threadId) => apiPatch(`/api/inbox/threads/${encodeURIComponent(threadId)}/read`, { read: false }),
    archive: (threadId) => apiPatch(`/api/inbox/threads/${encodeURIComponent(threadId)}/archive`, { archived: true }),
    trash: (threadId) => apiPatch(`/api/inbox/threads/${encodeURIComponent(threadId)}/trash`, { trashed: true })
  };

  const task = tasks[action];
  if (!task) {
    return;
  }

  try {
    await Promise.all(threadIds.map(task));
    showToast(`${bulkActionLabel(action)} ${threadIds.length} ${threadIds.length === 1 ? "thread" : "threads"}.`);
    state.selectedThreadIds.clear();
    await loadMailbox();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function bulkActionLabel(action) {
  return {
    read: "Marked read",
    unread: "Marked unread",
    archive: "Archived",
    trash: "Moved to Trash"
  }[action] || "Updated";
}

function renderThread() {
  if (!state.selectedThread) {
    elements.appShell.classList.remove("has-thread");
    elements.messageColumn.hidden = true;
    elements.threadSubject.textContent = "No thread selected";
    elements.threadMeta.textContent = "";
    elements.threadActions.hidden = true;
    elements.threadMessages.innerHTML = '<div class="empty-state">Select a thread to read it.</div>';
    elements.replyForm.hidden = true;
    queueWindowSizing();
    return;
  }

  elements.appShell.classList.add("has-thread");
  elements.messageColumn.hidden = false;
  const participants = (state.selectedThread.participants || []).join(", ");
  const recipient = replyRecipient();
  const replyAll = replyAllRecipients();
  elements.threadSubject.textContent = state.selectedThread.subject || "(no subject)";
  elements.threadMeta.textContent = participants;
  elements.threadActions.hidden = false;
  elements.replyForm.hidden = state.mailbox === "trash";
  elements.replyRecipient.textContent = recipient ? `To: ${recipient}` : "";
  elements.replyAllButton.classList.toggle("active", state.replyAll);
  elements.replyAllButton.textContent = state.replyAll ? "Reply" : "Reply all";
  elements.replyCcRow.hidden = !state.replyAll || !replyAll.cc.length;
  elements.replyCc.value = state.replyAll ? replyAll.cc.join(", ") : "";
  elements.replyCcPreview.textContent = state.replyAll && replyAll.cc.length ? `Cc: ${replyAll.cc.join(", ")}` : "";

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

function senderServiceMeta(config) {
  const profiles = Array.isArray(config.senderProfiles) ? config.senderProfiles : [];
  const accounts = new Set(profiles.map((profile) => profile.accountId).filter(Boolean));
  const ready = profiles.filter((profile) => profile.hasToken).length;
  if (profiles.length > 1) {
    if (ready === 0) {
      return `${profiles.length} senders, send token missing`;
    }
    if (ready < profiles.length) {
      return `${ready}/${profiles.length} senders ready`;
    }
    return `${profiles.length} senders, ${accounts.size || 1} account${accounts.size === 1 ? "" : "s"}`;
  }
  if (profiles.length === 1 && !ready) {
    return `Account ${config.accountId || "not set"}, send token missing`;
  }
  return `Account ${config.accountId || "not set"}`;
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

function toggleReplyAll() {
  state.replyAll = !state.replyAll;
  renderThread();
}

function replyRecipient() {
  const currentUserEmails = ownSenderAddresses();
  const inbound = [...state.selectedMessages].reverse().find((message) => (
    message.direction === "inbound" && (message.replyTo || message.from)
  ));

  if (inbound) {
    return inbound.replyTo || inbound.from;
  }

  return (state.selectedThread && state.selectedThread.participants || []).find((email) => (
    !currentUserEmails.has(String(email || "").toLowerCase())
  )) || "";
}

function replyAllRecipients() {
  const triageApi = window.BetterEmailTriage;
  const currentUserEmails = [...ownSenderAddresses()];
  if (triageApi && triageApi.buildReplyAllRecipients) {
    return triageApi.buildReplyAllRecipients(state.selectedMessages, currentUserEmails);
  }
  return { to: replyRecipient(), cc: [] };
}

function ownSenderAddresses() {
  return new Set([
    state.config && state.config.defaultFrom,
    state.config && state.config.inbox && state.config.inbox.address,
    elements.from.value,
    ...((state.config && state.config.senderProfiles || []).map((profile) => profile.from))
  ].filter(Boolean).map((email) => String(email).toLowerCase()));
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
