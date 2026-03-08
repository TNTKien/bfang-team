(() => {
  if (typeof window === "undefined") return;

  window.BfangFastNavModules = window.BfangFastNavModules || {};

  window.BfangFastNavModules.createCommentsLoader = ({ ensureScriptLoaded }) => {
    let disposeCommentsScriptLoader = null;

    const setupCommentsScriptLoader = () => {
      if (typeof disposeCommentsScriptLoader === "function") {
        disposeCommentsScriptLoader();
        disposeCommentsScriptLoader = null;
      }

      const commentsRoot = document.querySelector("#comments");
      if (!commentsRoot) return;

      const scriptSrc =
        (commentsRoot.getAttribute("data-comment-script-src") || "").toString().trim() || "/comments.js";
      const isLazyCommentsSection = commentsRoot.getAttribute("data-comment-lazy") === "1";

      let loaded = false;
      let observer = null;

      const cleanup = () => {
        document.removeEventListener("focusin", onIntent, true);
        document.removeEventListener("pointerdown", onIntent, true);
        document.removeEventListener("keydown", onIntent, true);
        if (observer) {
          observer.disconnect();
          observer = null;
        }
      };

      const loadCommentsScript = () => {
        if (loaded) return;
        loaded = true;
        cleanup();
        commentsRoot.setAttribute("data-comment-auto-hydrate", "1");
        ensureScriptLoaded(scriptSrc).then(() => {
          if (window.BfangComments && typeof window.BfangComments.refresh === "function") {
            window.BfangComments.refresh();
          }
          if (window.BfangAuth && typeof window.BfangAuth.refreshUi === "function") {
            window.BfangAuth.refreshUi().catch(() => null);
          }
        });
      };

      const onIntent = (event) => {
        const target = event && event.target;
        if (!target || !target.closest) return;
        if (target.closest("#comments")) {
          loadCommentsScript();
        }
      };

      document.addEventListener("focusin", onIntent, true);
      document.addEventListener("pointerdown", onIntent, true);
      document.addEventListener("keydown", onIntent, true);

      if (typeof IntersectionObserver === "function") {
        observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              loadCommentsScript();
            });
          },
          {
            root: null,
            rootMargin: isLazyCommentsSection ? "320px 0px" : "1100px 0px",
            threshold: 0.01
          }
        );
        observer.observe(commentsRoot);
      } else {
        window.setTimeout(() => {
          loadCommentsScript();
        }, 1200);
      }

      disposeCommentsScriptLoader = cleanup;
    };

    return {
      setupCommentsScriptLoader
    };
  };
})();
