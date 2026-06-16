(function attachMessageBodyState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.BetterEmailMessageBodyState = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function createMessageBodyState() {
  const oldMissingBodyText = "This older email was received before raw-source storage was enabled, so this inbox only has its headers. Cloudflare hands the raw message to the receiving Worker at delivery time; because the old Worker dropped that body, the app cannot reconstruct it afterward.";
  const parserMissingBodyText = "This email has stored raw source, but the display parser did not extract a body yet. Fix the parser or run a reprocess job from the stored source instead of editing this message by hand.";
  const unknownRawSourceText = "This email body was not extracted yet. Refresh after the inbox repair job reprocesses the stored raw message.";

  function getMessageBodyState(message) {
    const html = String(message && message.html || "").trim();
    if (html) {
      return { kind: "html", html };
    }

    const text = String(message && message.text || "").trim();
    if (text) {
      return { kind: "text", text };
    }

    const snippet = String(message && message.snippet || "").trim();
    if (snippet) {
      return { kind: "text", text: snippet };
    }

    if (Number(message && message.rawSize || 0) > 0) {
      return {
        kind: "missing",
        text: missingBodyText(message)
      };
    }

    return { kind: "text", text: "" };
  }

  return {
    getMessageBodyState
  };

  function missingBodyText(message) {
    if (message && message.hasRawSource === true) {
      return parserMissingBodyText;
    }
    if (message && message.hasRawSource === false) {
      return oldMissingBodyText;
    }
    return unknownRawSourceText;
  }
});
