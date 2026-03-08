(() => {
  if (typeof window === "undefined") return;
  if (typeof window.fetch !== "function") return;
  if (typeof window.DOMParser !== "function") return;
  if (!window.history || typeof window.history.pushState !== "function") return;
  const modules = window.BfangFastNavModules && typeof window.BfangFastNavModules === "object"
    ? window.BfangFastNavModules
    : {};
  if (typeof modules.createCore !== "function" || typeof modules.createCommentsLoader !== "function") {
    return;
  }

  const commentsLoader = modules.createCommentsLoader({
    ensureScriptLoaded: (src) => core.ensureScriptLoaded(src)
  });
  const core = modules.createCore({
    setupCommentsScriptLoader: commentsLoader.setupCommentsScriptLoader
  });
  core.init();
})();
