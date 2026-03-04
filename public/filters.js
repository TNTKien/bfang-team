(() => {
  const FILTER_FORM_SELECTOR = ".filter-form--advanced";
  const FILTER_BOUND_ATTR = "data-filter-bound";
  const stateOrder = ["none", "include", "exclude"];

  const updateButtonState = (button, state) => {
    if (!button) return;
    button.dataset.state = state;
    button.classList.remove("is-include", "is-exclude");
    if (state === "include") {
      button.classList.add("is-include");
    }
    if (state === "exclude") {
      button.classList.add("is-exclude");
    }
  };

  const bindFilterForm = (filterForm) => {
    if (!(filterForm instanceof HTMLFormElement)) return;
    if (filterForm.getAttribute(FILTER_BOUND_ATTR) === "1") {
      return;
    }

    const hiddenContainer = filterForm.querySelector("[data-filter-hidden]");
    const buttons = Array.from(filterForm.querySelectorAll(".filter-option--toggle"));
    if (!buttons.length) {
      filterForm.setAttribute(FILTER_BOUND_ATTR, "1");
      return;
    }

    const hiddenInputsByGenre = new Map();

    const ensureHiddenInput = (genreId) => {
      if (!hiddenContainer) return null;
      const safeGenreId = (genreId || "").toString().trim();
      if (!safeGenreId) return null;

      const existing = hiddenInputsByGenre.get(safeGenreId);
      if (existing && existing.isConnected) {
        return existing;
      }

      const input = document.createElement("input");
      input.type = "hidden";
      input.value = safeGenreId;
      hiddenInputsByGenre.set(safeGenreId, input);
      hiddenContainer.appendChild(input);
      return input;
    };

    const removeHiddenInput = (genreId) => {
      const safeGenreId = (genreId || "").toString().trim();
      if (!safeGenreId) return;
      const input = hiddenInputsByGenre.get(safeGenreId);
      if (!input) return;
      if (input.isConnected) {
        input.remove();
      }
      hiddenInputsByGenre.delete(safeGenreId);
    };

    const syncHiddenInputs = () => {
      if (!hiddenContainer) return;

      const activeGenres = new Set();
      buttons.forEach((button) => {
        const state = button.dataset.state || "none";
        const genreId = (button.dataset.genre || "").toString().trim();
        if (!genreId) return;

        if (state === "include" || state === "exclude") {
          const input = ensureHiddenInput(genreId);
          if (!input) return;
          input.name = state;
          input.value = genreId;
          activeGenres.add(genreId);
          return;
        }

        removeHiddenInput(genreId);
      });

      Array.from(hiddenInputsByGenre.keys()).forEach((genreId) => {
        if (activeGenres.has(genreId)) return;
        removeHiddenInput(genreId);
      });
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const current = button.dataset.state || "none";
        const index = stateOrder.indexOf(current);
        const next = stateOrder[(index + 1) % stateOrder.length];
        updateButtonState(button, next);
        syncHiddenInputs();
      });
    });

    syncHiddenInputs();
    filterForm.setAttribute(FILTER_BOUND_ATTR, "1");
  };

  const initFilters = (root) => {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll(FILTER_FORM_SELECTOR).forEach((form) => {
      bindFilterForm(form);
    });
  };

  window.BfangFilters = window.BfangFilters || {};
  window.BfangFilters.init = initFilters;

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        initFilters(document);
      },
      { once: true }
    );
  } else {
    initFilters(document);
  }

  window.addEventListener("bfang:pagechange", () => {
    initFilters(document);
  });
})();
