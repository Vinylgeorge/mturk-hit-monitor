// ==UserScript==
// @name         MTurk Errors — Auto Continue (robust)
// @namespace    Violentmonkey Scripts
// @version      2.0
// @match        https://worker.mturk.com/errors/*
// @match        https://www.mturk.com/errors/*
// @match        https://worker.mturk.com/*
// @match        https://www.mturk.com/*
// @match        https://*.mturk.com/errors/*
// @match        https://*.mturk.com/*
// @grant       none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/mturk-hit-monitor/refs/heads/main/refresh.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/mturk-hit-monitor/refs/heads/main/refresh.user.js


// ==/UserScript==

(function () {
  'use strict';

  function findValidateForm() {
    const f1 = document.querySelector('form[action*="/errors/validateCaptcha"]');
    if (f1) return f1;
    const forms = Array.from(document.querySelectorAll('form'));
    for (const f of forms) {
      if (f.querySelector('input[name="amzn"], input[name="amzn-r"]')) return f;
    }
    return null;
  }

  function findContinueButton(form) {
    const candidates = Array.from(
      (form ? form.querySelectorAll('button, input[type="submit"], a') : document.querySelectorAll('button, input[type="submit"], a'))
    );
    for (const el of candidates) {
      const text = (el.innerText || el.value || '').trim().toLowerCase();
      if (text.includes('continue')) return el;
    }
    const prim = document.querySelector('.a-button .a-button-text, .a-button-primary .a-button-text, .a-button-inner button');
    return prim || null;
  }

  function synthClick(el) {
    try {
      el.focus && el.focus();
      el.click();
      console.log('[mturk-auto] clicked continue');
    } catch (e) {
      console.warn('[mturk-auto] synthClick error', e);
    }
  }

  function attemptOnce() {
    const form = findValidateForm();
    const btn = findContinueButton(form);

    if (!form && !btn) {
      console.log('[mturk-auto] nothing to click');
      return;
    }

    if (btn) synthClick(btn);
    if (form) {
      try {
        form.submit();
        console.log('[mturk-auto] form.submit() called');
      } catch (e) {
        console.warn('[mturk-auto] form.submit error', e);
      }
    }
  }

  // 👉 Only fire when the tab becomes visible
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && location.pathname.includes('/errors')) {
      console.log('[mturk-auto] tab visible -> attempt');
      attemptOnce();
    }
  });

  // Optional: first check if page is already visible when loaded
  if (!document.hidden && location.pathname.includes('/errors')) {
    setTimeout(attemptOnce, 500);
  }
function scheduleMTurkPopup() {
  const min = 300, max = 330;
  const delay = Math.floor(Math.random() * (max - min + 1) + min) * 1000;

  setTimeout(() => {
    const w = window.open(
      "https://worker.mturk.com/tasks",
      "mturkPopup",
      "width=100,height=100,left=50,top=50"
    );
    if (w) {
      // Blur so it won't steal focus
      w.blur();
      window.focus();
      // auto-close after 5s (optional, remove if not needed)
      setTimeout(() => {
        try { w.close(); } catch {}
      }, 5000);
    }
    scheduleMTurkPopup(); // schedule next popup
  }, delay);
}

// Start the popup loop
scheduleMTurkPopup();
})();
