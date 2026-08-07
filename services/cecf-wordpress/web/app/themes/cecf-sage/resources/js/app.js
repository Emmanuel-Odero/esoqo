/**
 * Desktop dropdown nav + mobile drawer interactivity — ported from the
 * design template's own vanilla JS. The one deliberate behaviour change:
 * the template's top-level dropdown toggles (`role="button"`) had
 * `href="#/route"` purely so the SPA router had *something* to bind to;
 * ours carry the item's real permalink (App\Support\Nav\CecfMenuWalker),
 * but still preventDefault() on click and act as pure open/close toggles —
 * matching `role="button"` semantics (a screen reader announces "button",
 * not "link"), same as the template intended. The dropdown's own child
 * links navigate normally; nothing here needs a client-side router
 * anymore now that every page has a real URL.
 */
(function () {
  function closeDesktopDropdowns() {
    document.querySelectorAll('nav.main > div').forEach(function (d) {
      d.classList.remove('open');
    });
  }

  document.querySelectorAll('nav.main > div').forEach(function (d) {
    var toggle = d.querySelector(':scope > a');
    if (!toggle) return;

    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      var wasOpen = d.classList.contains('open');
      closeDesktopDropdowns();
      if (!wasOpen) d.classList.add('open');
    });
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('nav.main')) closeDesktopDropdowns();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeDesktopDropdowns();
      closeMobileNav();
    }
  });

  var mnav = document.getElementById('mnav');
  var mscrim = document.getElementById('mscrim');
  var burger = document.getElementById('burger');
  var mclose = document.getElementById('mclose');

  function openMobileNav() {
    mnav.classList.add('on');
    mscrim.classList.add('on');
    mnav.setAttribute('aria-hidden', 'false');
    burger.setAttribute('aria-expanded', 'true');
  }

  function closeMobileNav() {
    if (!mnav) return;
    mnav.classList.remove('on');
    mscrim.classList.remove('on');
    mnav.setAttribute('aria-hidden', 'true');
    if (burger) burger.setAttribute('aria-expanded', 'false');
  }

  if (burger && mnav) {
    burger.addEventListener('click', function () {
      mnav.classList.contains('on') ? closeMobileNav() : openMobileNav();
    });
  }

  if (mscrim) mscrim.addEventListener('click', closeMobileNav);
  if (mclose) mclose.addEventListener('click', closeMobileNav);

  document.querySelectorAll('.mgrp > button').forEach(function (button) {
    button.addEventListener('click', function () {
      var group = button.parentElement;
      var isOpen = group.classList.toggle('open');
      button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  });
})();
