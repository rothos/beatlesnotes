/* Notes on … — index pages: read check marks, glossary filter. */
(function () {
  "use strict";
  if (window.PN) {
    document.querySelectorAll("li[data-slug]").forEach((li) => {
      if (li.dataset.slug && PN.isRead(li.dataset.slug)) li.classList.add("is-read");
    });
  }
  const q = document.getElementById("gl-q");
  if (q) {
    const entries = [...document.querySelectorAll(".gl-entry")];
    q.addEventListener("input", () => {
      const v = q.value.trim().toLowerCase();
      entries.forEach((e) => { e.hidden = v && !e.textContent.toLowerCase().includes(v); });
    });
  }
})();
