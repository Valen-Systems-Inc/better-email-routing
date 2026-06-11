(function attachMailboxState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.BetterEmailMailboxState = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function createMailboxState() {
  function planMailboxTransition({ currentMailbox, nextMailbox, selectedThreadId }) {
    const mailboxChanged = String(currentMailbox || "") !== String(nextMailbox || "");
    return {
      mailbox: nextMailbox,
      selectedThreadId: mailboxChanged ? "" : String(selectedThreadId || ""),
      resetThreadScroll: mailboxChanged
    };
  }

  return {
    planMailboxTransition
  };
});
