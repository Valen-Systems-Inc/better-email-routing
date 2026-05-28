(function initLayoutMetrics(globalScope) {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function calculateLayoutMetrics(input) {
    const viewportWidth = Number(input.viewportWidth || 0);
    const viewportHeight = Number(input.viewportHeight || 0);
    const topbarHeight = Number(input.topbarHeight || 0);
    const appPad = Number(input.appPad || 24);
    const panelGap = Number(input.panelGap || 18);
    const narrow = viewportWidth <= 820;
    const safeHeight = Math.max(360, viewportHeight);

    if (narrow) {
      return {
        narrow: true,
        windowHeight: `${Math.round(safeHeight)}px`,
        mailboxHeight: "auto",
        threadListMax: `${Math.round(clamp(safeHeight * 0.42, 260, 440))}px`,
        messagePaneMin: `${Math.round(clamp(safeHeight * 0.64, 420, 640))}px`,
        composerMax: "none"
      };
    }

    const mailboxHeight = Math.max(420, safeHeight - topbarHeight - (appPad * 2) - panelGap);

    return {
      narrow: false,
      windowHeight: `${Math.round(safeHeight)}px`,
      mailboxHeight: `${Math.round(mailboxHeight)}px`,
      threadListMax: "none",
      messagePaneMin: "0px",
      composerMax: `${Math.round(mailboxHeight)}px`
    };
  }

  const api = { calculateLayoutMetrics };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.BetterEmailRoutingLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
