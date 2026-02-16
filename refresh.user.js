// ==UserScript==
// @name         AB2soft - MTurkErrors
// @namespace    Violentmonkey Scripts
// @version      16
// @match        https://worker.mturk.com/*
// @match        https://www.mturk.com/*
// @match        https://*.mturk.com/*
// @match        https://*.amazon.com/*
// @match        https://opfcaptcha.amazon.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // 🚫 HARD BLOCK: skip ONLY when URL is EXACTLY tasks/ (with trailing slash)
  const SKIP_EXACT = "https://worker.mturk.com/tasks/";
  if (location.href === SKIP_EXACT) return;

  /* =========================================================
     Tunables (kept close to your earlier behavior)
  ========================================================= */
  const RETRY_INTERVAL_MS = 1200;        // periodic retry (like earlier)
  const ATTEMPT_THROTTLE_MS = 4000;      // throttle attempts (like earlier)
  const MAX_RUNTIME_MS = 45000;          // auto-stop after 45s (prevents forever watchers)
  const START_DELAY_MS = 200;            // small delay so React can mount

  let lastAttempt = 0;
  let intervalId = null;
  let observer = null;
  let hardStopTimer = null;
  let stopped = false;

  function now() { return Date.now(); }

  function stopAll(reason) {
    if (stopped) return;
    stopped = true;
    try { if (observer) observer.disconnect(); } catch (_) {}
    try { if (intervalId) clearInterval(intervalId); } catch (_) {}
    try { if (hardStopTimer) clearTimeout(hardStopTimer); } catch (_) {}
    console.log("[AB2soft] Stopped:", reason);
  }

  // Ensure everything stops when tab closes / navigates away
  window.addEventListener("beforeunload", () => stopAll("beforeunload"));

  /* =========================================================
     0) Detect “close tab” conditions (from your earlier helper style)
        - This is OPTIONAL but you asked not to miss earlier logic.
        - It runs only for a short time window and then stops itself.
  ========================================================= */
  function setupAutoCloseSignals() {
    const closePhrases = [
      "hit submitted",
      "there are no more of these hits available",
      "see other hits available to you below",
      "this hit is no longer available",
      "this hit cannot be returned",
      "this hit is no longer in your hits queue",
      "your hit submission was not successful" // you requested this
    ];

    const shouldClose = () => {
      const bodyText = ((document.body && document.body.innerText) || "").toLowerCase();
      for (const p of closePhrases) {
        if (bodyText.includes(p)) return true;
      }

      // React alert props (MTurk uses data-react-props)
      const alertNodes = Array.from(document.querySelectorAll('div[data-react-class*="alert/Alert"]'));
      for (const node of alertNodes) {
        const props = (node.getAttribute("data-react-props") || "").toLowerCase();
        for (const p of closePhrases) {
          if (props.includes(p)) return true;
        }
      }
      return false;
    };

    const tryClose = () => {
      if (shouldClose()) {
        console.log("[AB2soft] Close-signal detected — closing tab...");
        try { window.close(); } catch (_) {}
      }
    };

    tryClose();

    const mo = new MutationObserver(tryClose);
    try {
      mo.observe(document.documentElement || document.body, { childList: true, subtree: true, characterData: true });
    } catch (_) {}

    const iv = setInterval(tryClose, 1200);

    // Don’t keep this forever
    setTimeout(() => {
      try { mo.disconnect(); } catch (_) {}
      try { clearInterval(iv); } catch (_) {}
    }, 30000);
  }
  setupAutoCloseSignals();

  /* =========================================================
     1) Error/Captcha Page Detection (more robust, like earlier)
  ========================================================= */
  function isErrorLikePage() {
    // Classic MTurk errors routes
    if (location.pathname.includes("/errors")) return true;

    // Validate captcha form or inputs
    if (document.querySelector('form[action*="/errors/validateCaptcha"], input[name="amzn"], input[name="amzn-r"], input[name="field-keywords"]')) {
      return true;
    }

    // Amazon “Server Busy / Continue shopping”
    const title = (document.title || "").toLowerCase();
    if (title.includes("server busy")) return true;

    const t = ((document.body && document.body.innerText) || "").toLowerCase();
    if (t.includes("server busy") && t.includes("continue shopping")) return true;

    // Sometimes captcha-like resources show up first
    if (document.querySelector('iframe[src*="captcha"], img[src*="captcha"]')) return true;

    return false;
  }

  /* =========================================================
     2) Find validateCaptcha form + continue button (earlier robust)
  ========================================================= */
  function findValidateForm() {
    const f1 = document.querySelector('form[action*="/errors/validateCaptcha"]');
    if (f1) return f1;

    const forms = Array.from(document.querySelectorAll("form"));
    for (const f of forms) {
      const hasAmzn = !!f.querySelector('input[name="amzn"], input[name="amzn-r"], input[name="field-keywords"]');
      if (hasAmzn) return f;
    }
    return null;
  }

  function buildValidateUrl(form) {
    if (!form) return null;

    const action = form.getAttribute("action") || "/errors/validateCaptcha";
    const url = new URL(action, location.origin);

    const amzn  = form.querySelector('input[name="amzn"]')?.value;
    const amznr = form.querySelector('input[name="amzn-r"]')?.value;
    const fk    = form.querySelector('input[name="field-keywords"]')?.value;

    if (!amzn || !amznr) return null;

    url.searchParams.set("amzn", amzn);
    url.searchParams.set("amzn-r", amznr);
    if (fk) url.searchParams.set("field-keywords", fk);

    return url.toString();
  }

  function findContinueButton(form) {
    const candidates = Array.from(
      (form ? form.querySelectorAll('button, input[type="submit"], a') :
              document.querySelectorAll('button, input[type="submit"], a'))
    );

    for (const el of candidates) {
      const text = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().toLowerCase();
      if (!text) continue;
      if (text.includes("continue") || text.includes("continue shopping")) return el;
    }

    // Amazon UI primary button patterns (earlier style)
    const prim = document.querySelector(
      '.a-button .a-button-text, .a-button-primary .a-button-text, .a-button-inner button'
    );
    return prim || null;
  }

  function synthClick(el) {
    try {
      if (!el) return false;
      el.focus && el.focus();
      const types = ["mouseover","pointerover","mousemove","mousedown","pointerdown","mouseup","pointerup","click"];
      for (const t of types) {
        try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch (_) {}
      }
      try { el.click(); } catch (_) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  function redirectOnce(url) {
    const key = "AB2_VALIDATE_LAST";
    try {
      if (sessionStorage.getItem(key) === url) return false;
      sessionStorage.setItem(key, url);
    } catch (_) {}

    console.log("[AB2soft] Redirecting →", url);
    location.assign(url);
    return true;
  }

  /* =========================================================
     3) Attempt Logic (same strategy as earlier)
        - Throttled
        - Tries best method (direct redirect)
        - Falls back to click/submit
  ========================================================= */
  function attemptOnce() {
    if (stopped) return;

    // If we navigated to tasks/ after something, still enforce skip
    if (location.href === SKIP_EXACT) {
      stopAll("navigated-to-skip-url");
      return;
    }

    if (now() - lastAttempt < ATTEMPT_THROTTLE_MS) return;
    lastAttempt = now();

    // If page no longer looks like error/captcha, stop watching
    if (!isErrorLikePage()) {
      stopAll("page-not-error-anymore");
      return;
    }

    const form = findValidateForm();
    const btn = findContinueButton(form);

    if (!form && !btn) {
      // keep watching; page may render late
      return;
    }

    // ⭐ BEST: Direct redirect using hidden fields
    const validateUrl = buildValidateUrl(form);
    if (validateUrl && redirectOnce(validateUrl)) {
      // navigation will happen; stop watchers cleanly
      stopAll("redirected-validate");
      return;
    }

    // Fallback: click continue / submit
    try {
      if (btn) {
        synthClick(btn);
        console.log("[AB2soft] Continue clicked");
        // do NOT stop immediately: sometimes click triggers async render; keep watching a bit
        return;
      }
      if (form) {
        try { form.submit(); } catch (_) { /* ignore */ }
        console.log("[AB2soft] Form submitted");
        return;
      }
    } catch (e) {
      // keep watching
    }
  }

  /* =========================================================
     4) Start Watching (like earlier) — but only when needed
        - Observer + interval
        - Hard timeout to prevent forever background usage
  ========================================================= */
  function startWatching() {
    if (stopped) return;

    // If not an error page now, do nothing (no watchers)
    if (!isErrorLikePage()) return;

    console.log("[AB2soft] Watching started (error-like page detected)");

    // Hard stop (safety)
    hardStopTimer = setTimeout(() => stopAll("max-runtime-reached"), MAX_RUNTIME_MS);

    // First attempt immediately
    attemptOnce();

    // Mutation observer (captures late DOM / React)
    try {
      observer = new MutationObserver(() => attemptOnce());
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    } catch (_) {}

    // Periodic retry
    intervalId = setInterval(() => {
      // Stop if page is no longer error-like
      if (!isErrorLikePage()) {
        stopAll("interval-detected-resolved");
        return;
      }
      attemptOnce();
    }, RETRY_INTERVAL_MS);
  }

  // ✅ “Whenever new tab opens” → this code runs on page load of that tab
  // We delay a tiny bit so late-loaded elements appear, but we still watch like earlier.
  setTimeout(startWatching, START_DELAY_MS);

  console.log("✅ AB2soft MTurkErrors loaded (Full watch + AutoStop + Skip only tasks/)");
})();
