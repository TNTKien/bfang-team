(() => {
  if (typeof window === "undefined") return;

  window.BfangAuthModules = window.BfangAuthModules || {};

  window.BfangAuthModules.createUi = ({ authProviderEnabled, getPreferredAuthProvider, signInWithProvider, signOut }) => {
    const consumeAuthLoginIntentFromUrl = () => {
      try {
        const currentUrl = new URL(window.location.href);
        const authValue = (currentUrl.searchParams.get("auth") || "").toString().trim().toLowerCase();
        const loginValue = (currentUrl.searchParams.get("login") || "").toString().trim().toLowerCase();
        const shouldOpen =
          authValue === "login" ||
          loginValue === "1" ||
          loginValue === "true" ||
          loginValue === "login";

        if (!shouldOpen) {
          return false;
        }

        currentUrl.searchParams.delete("auth");
        currentUrl.searchParams.delete("login");
        const nextUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}` || "/";

        if (window.history && typeof window.history.replaceState === "function") {
          window.history.replaceState(window.history.state || null, document.title, nextUrl);
        }

        return true;
      } catch (_err) {
        return false;
      }
    };

    const ensureAuthLoginDialog = () => {
      const existing = document.querySelector("[data-auth-login-dialog]");
      if (existing) return existing;

      const dialog = document.createElement("dialog");
      dialog.className = "modal auth-login-popup";
      dialog.setAttribute("data-auth-login-dialog", "");
      dialog.setAttribute("aria-label", "Chọn phương thức đăng nhập");
      dialog.innerHTML = `
        <div class="modal-card auth-login-popup__card">
          <div class="modal-head">
            <h2 class="modal-title">Đăng nhập</h2>
            <button class="modal-close" type="button" data-auth-login-close aria-label="Đóng">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12" />
                <path d="M18 6l-12 12" />
              </svg>
            </button>
          </div>
          <p class="modal-body">Chọn phương thức đăng nhập.</p>
          <div class="auth-login-popup__providers">
            <button
              class="button button--ghost auth-login-popup__provider auth-login-popup__provider--google"
              type="button"
              data-auth-login-provider="google"
            >
              <img class="auth-login-popup__provider-icon-image" src="/images/google.svg" alt="" aria-hidden="true" />
              <span>Google</span>
            </button>
            <button
              class="button button--ghost auth-login-popup__provider auth-login-popup__provider--discord"
              type="button"
              data-auth-login-provider="discord"
            >
              <img class="auth-login-popup__provider-icon-image" src="/images/discord.svg" alt="" aria-hidden="true" />
              <span>Discord</span>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(dialog);

      const googleBtn = dialog.querySelector("[data-auth-login-provider='google']");
      const discordBtn = dialog.querySelector("[data-auth-login-provider='discord']");
      if (googleBtn) googleBtn.hidden = !authProviderEnabled.google;
      if (discordBtn) discordBtn.hidden = !authProviderEnabled.discord;

      return dialog;
    };

    const loginProviderDialog = ensureAuthLoginDialog();
    const supportsLoginProviderDialog =
      Boolean(loginProviderDialog) && typeof loginProviderDialog.showModal === "function";
    const shouldAutoOpenLoginDialogFromUrl = consumeAuthLoginIntentFromUrl();

    const closeLoginProviderDialog = () => {
      if (!supportsLoginProviderDialog || !loginProviderDialog || !loginProviderDialog.open) return;
      loginProviderDialog.close();
    };

    const closeAuthMenus = () => {
      document.querySelectorAll("[data-auth-menu]").forEach((menu) => {
        menu.hidden = true;
      });
      document.querySelectorAll("[data-auth-menu-toggle]").forEach((toggle) => {
        toggle.setAttribute("aria-expanded", "false");
      });
      closeLoginProviderDialog();
    };

    const headerNavToggle = document.querySelector("[data-header-nav-toggle]");
    const headerNav = document.getElementById("site-nav-links");

    const setKomaSliceBackground = (sliceLink) => {
      if (!(sliceLink instanceof HTMLElement)) return;
      if (sliceLink.dataset.bgReady === "1") return;
      const source = (sliceLink.getAttribute("data-bg") || "").toString().trim();
      if (!source) return;
      const escapedSource = source.replace(/"/g, '\\"');
      sliceLink.style.backgroundImage = `url("${escapedSource}"), var(--koma-placeholder-image)`;
      sliceLink.dataset.bgReady = "1";
      sliceLink.removeAttribute("data-bg");
      sliceLink.classList.add("is-bg-ready");
    };

    const initKomaStreamMouseDrag = () => {
      document.querySelectorAll(".koma-stream-ranking-list").forEach((stream) => {
        if (!(stream instanceof HTMLElement) || stream.dataset.komaDragReady === "1") return;
        stream.dataset.komaDragReady = "1";

        let activePointerId = null;
        let startClientX = 0;
        let startScrollLeft = 0;
        let dragging = false;
        let suppressClickUntil = 0;
        const dragThreshold = 8;

        const handlePointerMove = (event) => {
          if (activePointerId == null || event.pointerId !== activePointerId) return;

          const deltaX = event.clientX - startClientX;
          if (!dragging && Math.abs(deltaX) > dragThreshold) {
            dragging = true;
            stream.classList.add("is-dragging");
          }

          if (!dragging) return;
          event.preventDefault();
          stream.scrollLeft = startScrollLeft - deltaX;
        };

        const endDrag = (event) => {
          if (activePointerId == null || event.pointerId !== activePointerId) return;

          const deltaX = event.clientX - startClientX;
          if (dragging && Math.abs(deltaX) > dragThreshold) {
            suppressClickUntil = Date.now() + 180;
          }

          stream.classList.remove("is-dragging");
          activePointerId = null;
          startClientX = 0;
          startScrollLeft = 0;
          dragging = false;
        };

        stream.addEventListener("pointerdown", (event) => {
          if (event.pointerType !== "mouse" || event.button !== 0) return;
          activePointerId = event.pointerId;
          startClientX = event.clientX;
          startScrollLeft = stream.scrollLeft;
          dragging = false;
        });

        window.addEventListener("pointermove", handlePointerMove, { passive: false });
        window.addEventListener("pointerup", endDrag);
        window.addEventListener("pointercancel", endDrag);

        stream.addEventListener("dragstart", (event) => {
          event.preventDefault();
        });

        stream.addEventListener(
          "click",
          (event) => {
            if (Date.now() > suppressClickUntil) return;
            suppressClickUntil = 0;
            event.preventDefault();
            event.stopPropagation();
          },
          true
        );
      });
    };

    const initKomaInfiniteLoop = () => {
      document.querySelectorAll(".koma-stream-ranking-list").forEach((stream) => {
        if (!(stream instanceof HTMLElement) || stream.dataset.komaLoopReady === "1") return;

        const originalBlocks = Array.from(stream.querySelectorAll(":scope > .koma-stream-ranking-list-block"));
        if (originalBlocks.length < 2) return;

        stream.dataset.komaLoopReady = "1";
        stream.classList.add("is-loop-ready");

        const createLoopClone = (block) => {
          const clone = block.cloneNode(true);
          clone.setAttribute("aria-hidden", "true");
          return clone;
        };

        for (let index = originalBlocks.length - 1; index >= 0; index -= 1) {
          stream.insertBefore(createLoopClone(originalBlocks[index]), stream.firstChild);
        }

        originalBlocks.forEach((block) => {
          stream.appendChild(createLoopClone(block));
        });

        let segmentStart = 0;
        let segmentWidth = 0;

        const updateLoopMetrics = () => {
          const firstOriginal = originalBlocks[0];
          const lastOriginal = originalBlocks[originalBlocks.length - 1];
          if (!firstOriginal || !lastOriginal) return;
          segmentStart = firstOriginal.offsetLeft;
          segmentWidth = Math.max(lastOriginal.offsetLeft + lastOriginal.offsetWidth - segmentStart, 1);
        };

        const normalizeLoopPosition = () => {
          if (!segmentWidth) return;

          const minScroll = segmentStart;
          const maxScroll = segmentStart + segmentWidth;
          let nextScrollLeft = stream.scrollLeft;

          while (nextScrollLeft < minScroll) {
            nextScrollLeft += segmentWidth;
          }
          while (nextScrollLeft >= maxScroll) {
            nextScrollLeft -= segmentWidth;
          }

          if (nextScrollLeft !== stream.scrollLeft) {
            stream.scrollLeft = nextScrollLeft;
          }
        };

        let loopRafId = 0;
        const queueNormalizeLoopPosition = () => {
          if (loopRafId) return;
          loopRafId = window.requestAnimationFrame(() => {
            loopRafId = 0;
            normalizeLoopPosition();
          });
        };

        updateLoopMetrics();
        stream.scrollLeft = segmentStart;
        normalizeLoopPosition();

        stream.addEventListener("scroll", queueNormalizeLoopPosition, { passive: true });
        window.addEventListener(
          "resize",
          () => {
            const previousOffset = stream.scrollLeft - segmentStart;
            updateLoopMetrics();
            stream.scrollLeft = segmentStart + previousOffset;
            normalizeLoopPosition();
          },
          { passive: true }
        );
      });
    };

    const initKomaSliceLazyBackgrounds = () => {
      document.querySelectorAll(".koma-stream-ranking-list").forEach((stream) => {
        if (!(stream instanceof HTMLElement) || stream.dataset.komaLazyReady === "1") return;
        stream.dataset.komaLazyReady = "1";

        let rafId = 0;

        const loadVisibleSlices = () => {
          rafId = 0;
          const streamRect = stream.getBoundingClientRect();
          if (!streamRect.width || !streamRect.height) return;
          const preloadDistance = 180;

          stream.querySelectorAll("a[data-bg]").forEach((sliceLink) => {
            if (!(sliceLink instanceof HTMLElement)) return;
            const sliceRect = sliceLink.getBoundingClientRect();
            const isWithinRange =
              sliceRect.right >= streamRect.left - preloadDistance &&
              sliceRect.left <= streamRect.right + preloadDistance;
            if (!isWithinRange) return;
            setKomaSliceBackground(sliceLink);
          });
        };

        const queueLoadVisibleSlices = () => {
          if (rafId) return;
          rafId = window.requestAnimationFrame(loadVisibleSlices);
        };

        queueLoadVisibleSlices();
        stream.addEventListener("scroll", queueLoadVisibleSlices, { passive: true });
        window.addEventListener("resize", queueLoadVisibleSlices, { passive: true });
      });
    };

    const scheduleNonCriticalTask = (callback) => {
      if (typeof callback !== "function") return;
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(
          () => {
            callback();
          },
          { timeout: 1200 }
        );
        return;
      }
      window.setTimeout(callback, 220);
    };

    const bootstrapKomaStreams = () => {
      initKomaInfiniteLoop();
      initKomaSliceLazyBackgrounds();
      initKomaStreamMouseDrag();
    };

    const initKomaStreamsDeferred = () => {
      const streams = Array.from(document.querySelectorAll(".koma-stream-ranking-list")).filter(
        (stream) => stream instanceof HTMLElement
      );
      if (!streams.length) return;

      const fallbackBootstrap = () => {
        scheduleNonCriticalTask(bootstrapKomaStreams);
      };

      const watchVisibility = () => {
        if (!("IntersectionObserver" in window)) {
          fallbackBootstrap();
          return;
        }

        let didTrigger = false;

        const observer = new IntersectionObserver(
          (entries) => {
            const shouldBootstrap = entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0);
            if (!shouldBootstrap) return;
            didTrigger = true;
            observer.disconnect();
            fallbackBootstrap();
          },
          {
            root: null,
            rootMargin: "320px 0px 320px 0px",
            threshold: 0.01
          }
        );

        streams.forEach((stream) => {
          observer.observe(stream);
        });

        window.setTimeout(() => {
          if (didTrigger) return;
          observer.disconnect();
          fallbackBootstrap();
        }, 1800);
      };

      if (document.readyState === "complete") {
        watchVisibility();
      } else {
        window.addEventListener("load", watchVisibility, { once: true });
      }

      window.addEventListener(
        "pageshow",
        () => {
          fallbackBootstrap();
        },
        { once: true }
      );
    };

    const setHeaderNavOpen = (open) => {
      if (!headerNav || !headerNavToggle) return;
      const shouldOpen = Boolean(open);
      headerNav.classList.toggle("hidden", !shouldOpen);
      headerNavToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    };

    const closeHeaderNav = () => {
      setHeaderNavOpen(false);
    };

    if (headerNav && headerNavToggle) {
      const initialOpen = !headerNav.classList.contains("hidden");
      headerNavToggle.setAttribute("aria-expanded", initialOpen ? "true" : "false");
    }

    initKomaStreamsDeferred();
    window.addEventListener("bfang:pagechange", () => {
      bootstrapKomaStreams();
    });

    const openLoginProviderDialog = ({ silent } = {}) => {
      const shouldSilenceAlert = Boolean(silent);

      if (!authProviderEnabled.google && !authProviderEnabled.discord) {
        if (!shouldSilenceAlert) {
          window.alert("Đăng nhập OAuth chưa được cấu hình.");
        }
        return;
      }

      if (!supportsLoginProviderDialog || !loginProviderDialog) {
        signInWithProvider(getPreferredAuthProvider() || "google").catch(() => {
          window.alert("Không thể mở đăng nhập. Vui lòng thử lại.");
        });
        return;
      }

      closeAuthMenus();
      loginProviderDialog.showModal();
      const firstOption = loginProviderDialog.querySelector("[data-auth-login-provider]:not([hidden])");
      if (firstOption && typeof firstOption.focus === "function") {
        firstOption.focus();
      }
    };

    const signIn = async () => {
      openLoginProviderDialog();
    };

    const confirmLogout = async () => {
      const payload = {
        title: "Đăng xuất?",
        body: "Bạn sẽ cần đăng nhập lại để tiếp tục bình luận và đồng bộ dữ liệu.",
        confirmText: "Đăng xuất",
        confirmVariant: "danger",
        fallbackText: "Bạn có chắc muốn đăng xuất không?"
      };

      if (window.BfangConfirm && typeof window.BfangConfirm.confirm === "function") {
        return window.BfangConfirm.confirm(payload);
      }

      return window.confirm(payload.fallbackText);
    };

    if (supportsLoginProviderDialog && loginProviderDialog) {
      const loginDialogCloseBtn = loginProviderDialog.querySelector("[data-auth-login-close]");
      if (loginDialogCloseBtn) {
        loginDialogCloseBtn.addEventListener("click", () => {
          closeLoginProviderDialog();
        });
      }

      loginProviderDialog.addEventListener("click", (event) => {
        if (event.target === loginProviderDialog) {
          closeLoginProviderDialog();
        }
      });

      loginProviderDialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeLoginProviderDialog();
      });
    }

    document.addEventListener("click", async (event) => {
      const headerToggle = event.target.closest("[data-header-nav-toggle]");
      if (headerToggle && headerNav) {
        event.preventDefault();
        const willOpen = headerNav.classList.contains("hidden");
        closeAuthMenus();
        setHeaderNavOpen(willOpen);
        return;
      }

      const headerNavLink = event.target.closest("#site-nav-links a");
      if (headerNavLink) {
        closeAuthMenus();
        closeHeaderNav();
        return;
      }

      const authMenuNavLink = event.target.closest("[data-auth-menu] a[href]");
      if (authMenuNavLink) {
        closeAuthMenus();
        closeHeaderNav();
        return;
      }

      const toggle = event.target.closest("[data-auth-menu-toggle]");
      if (toggle) {
        const container = toggle.closest("[data-auth-profile]") || toggle.parentElement;
        const menu = container ? container.querySelector("[data-auth-menu]") : null;
        if (!menu) return;
        const willOpen = menu.hidden;
        closeHeaderNav();
        closeAuthMenus();
        if (willOpen) {
          menu.hidden = false;
          toggle.setAttribute("aria-expanded", "true");
        }
        return;
      }

      const loginProviderBtn = event.target.closest("[data-auth-login-provider]");
      if (loginProviderBtn) {
        event.preventDefault();
        closeAuthMenus();
        const requestedProvider =
          loginProviderBtn && loginProviderBtn.getAttribute
            ? loginProviderBtn.getAttribute("data-auth-login-provider") || ""
            : "";
        signInWithProvider(requestedProvider || getPreferredAuthProvider() || "google").catch(() => {
          window.alert("Không thể mở đăng nhập. Vui lòng thử lại.");
        });
        return;
      }

      const loginBtn = event.target.closest("[data-auth-login]");
      if (loginBtn) {
        event.preventDefault();
        openLoginProviderDialog();
        return;
      }

      const logoutBtn = event.target.closest("[data-auth-logout]");
      if (logoutBtn) {
        event.preventDefault();
        closeAuthMenus();
        const ok = await confirmLogout();
        if (!ok) return;
        signOut().catch(() => {
          window.alert("Không thể đăng xuất. Vui lòng thử lại.");
        });
        return;
      }

      if (
        !event.target.closest("[data-auth-menu]") &&
        !event.target.closest("[data-auth-menu-toggle]") &&
        !event.target.closest("[data-auth-login-dialog]")
      ) {
        closeAuthMenus();
      }

      if (!event.target.closest("#site-nav-links") && !event.target.closest("[data-header-nav-toggle]")) {
        closeHeaderNav();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeAuthMenus();
        closeHeaderNav();
      }
    });

    return {
      signIn,
      openLoginProviderDialog,
      shouldAutoOpenLoginDialogFromUrl
    };
  };
})();
