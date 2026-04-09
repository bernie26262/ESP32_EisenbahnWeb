(function () {
  function activateTab(name) {
    const buttons = document.querySelectorAll(".tab-btn[data-tab]");
    const panels = document.querySelectorAll(".tab-panel[data-tab-panel]");

    buttons.forEach((btn) => {
      const active = (btn.getAttribute("data-tab") === name);
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    panels.forEach((panel) => {
      const active = (panel.getAttribute("data-tab-panel") === name);
      panel.classList.toggle("active", active);
      panel.setAttribute("aria-hidden", active ? "false" : "true");
    });

    try {
      history.replaceState(null, "", "#" + name);
    } catch (_) {}
  }

  function initialTab() {
    const hash = String(location.hash || "").replace(/^#/, "");
    if (hash === "weichen" || hash === "bahnhoefe" || hash === "bloecke" || hash === "debug") {
      return hash;
    }
    return "weichen";
  }

  function bindTabs() {
    const buttons = document.querySelectorAll(".tab-btn[data-tab]");
    if (!buttons.length) return;

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        activateTab(btn.getAttribute("data-tab"));
      });
    });

    activateTab(initialTab());

    window.addEventListener("hashchange", () => {
      activateTab(initialTab());
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindTabs, { once: true });
  } else {
    bindTabs();
  }
})();