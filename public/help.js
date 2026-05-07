// Copyright (c) 2026 Kyhle Öhlinger. Licensed under the MIT License.
// Metis help page — nav scroll-highlight logic.
(function () {
  "use strict";

  const mainEl   = document.querySelector(".main");
  const navLinks = Array.from(document.querySelectorAll(".nav-item[href^=\"#\"]"));
  const sections = navLinks.map(a => document.querySelector(a.getAttribute("href")));

  function updateActive() {
    const scrollY = mainEl.scrollTop;
    let current = sections[0];
    sections.forEach(function (s) {
      if (s && s.offsetTop - 60 <= scrollY) { current = s; }
    });
    navLinks.forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("href") === "#" + (current ? current.id : ""));
    });
  }

  mainEl.addEventListener("scroll", updateActive, { passive: true });

  navLinks.forEach(function (a) {
    a.addEventListener("click", function (e) {
      var target = document.querySelector(a.getAttribute("href"));
      if (target) {
        e.preventDefault();
        mainEl.scrollTo({ top: target.offsetTop - 24, behavior: "smooth" });
      }
    });
  });
}());
