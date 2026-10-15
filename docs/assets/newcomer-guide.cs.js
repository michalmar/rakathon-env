/* Document-specific chapter numbering and Czech controls; shared runtime stays unchanged. */
(() => {
  "use strict";
  const root = document.documentElement;
  const chapters = Array.from(document.querySelectorAll("main > .chapter"));
  if (chapters[0]?.id === "ch-offer") {
    chapters.forEach((chapter, index) => {
      const number = String(index).padStart(2, "0");
      chapter.dataset.sectionNumber = number;
      const heading = chapter.querySelector(":scope > .chapter-label");
      if (heading) heading.dataset.sectionNumber = number;
    });
  }
  const colors = { blue: "modrá", orange: "oranžová", green: "zelená" };
  const text = (selector, value) => {
    document.querySelectorAll(selector).forEach(node => {
      if (node.textContent !== value) node.textContent = value;
    });
  };
  const attribute = (node, name, value) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };

  function localize() {
    text('[data-action="clear-read"]', "Smazat značky");
    text('[data-action="toggle-slides"]', root.dataset.view === "slides" ? "Čtení" : "Prezentace");
    text('[data-action="toggle-animations"]', "Animace");
    text('[data-slide="prev"]', "Zpět");
    text('[data-slide="next"]', "Další");
    text('[data-slide="index"]', "Obsah");
    text(".slide-index h2", "Přejít na snímek");
    text(".index-close, .doc-dialog-close, [data-lb='close']", "Zavřít");
    text("[data-lb='reset']", "Obnovit");
    const theme = root.dataset.theme === "dark" ? "světlý" : "tmavý";
    text('[data-action="toggle-theme"]', theme === "světlý" ? "Světlý" : "Tmavý");
    text('[data-action="toggle-accent"]', `Barva: ${colors[root.dataset.accent]}`);
    document.querySelectorAll('[data-action="toggle-theme"]').forEach(node =>
      attribute(node, "aria-label", `Přepnout na ${theme} režim`));
    document.querySelectorAll('[data-action="toggle-accent"]').forEach(node =>
      attribute(node, "aria-label", `Barva: ${colors[root.dataset.accent]}. Změnit barvu`));
    document.querySelectorAll('[data-action="toggle-animations"]').forEach(node =>
      attribute(node, "aria-label", node.disabled ?
        "Animace vypnuty: předvolba omezení pohybu" : "Zobrazovat body postupně"));
    document.querySelectorAll(".slide-nav").forEach(node =>
      attribute(node, "aria-label", "Navigace prezentace"));
    document.querySelectorAll(".slide-index").forEach(node =>
      attribute(node, "aria-label", "Obsah prezentace"));
    document.querySelectorAll("[data-lb='in']").forEach(node =>
      attribute(node, "aria-label", "Přiblížit"));
    document.querySelectorAll("[data-lb='out']").forEach(node =>
      attribute(node, "aria-label", "Oddálit"));
    document.querySelectorAll('[aria-roledescription="slide"]').forEach(node => {
      attribute(node, "aria-roledescription", "snímek");
    });
    document.querySelectorAll('.slide-content[aria-label], .chapter-label[aria-label]').forEach(node => {
      const label = node.getAttribute("aria-label");
      attribute(node, "aria-label", label.replace(/^(\d+) of (\d+):/, "$1 z $2:"));
    });
    const progress = document.querySelector(".slide-progress");
    if (progress?.textContent.includes("Full screen unavailable")) {
      progress.textContent = progress.textContent.replace("Full screen unavailable", "Režim celé obrazovky není dostupný");
    }
  }

  localize();
  const observer = new MutationObserver(localize);
  observer.observe(document.body, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ["aria-label", "aria-roledescription", "disabled"],
  });
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-accent", "data-view"] });
})();
