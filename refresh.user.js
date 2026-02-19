// ==UserScript==
// @name         AB2soft - MTurkErrors
// @namespace    Violentmonkey Scripts
// @version      22
// @match        https://worker.mturk.com/*
// @match        https://www.mturk.com/*
// @match        https://*.mturk.com/*
// @match        https://www.amazon.com/*
// @match        https://*.amazon.com/*
// @match        https://opfcaptcha.amazon.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/mturk-hit-monitor/refs/heads/main/refresh.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/mturk-hit-monitor/refs/heads/main/refresh.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* =========================================================
     CONSTANTS + HEARTBEAT
     - Heartbeat on ANY worker.mturk.com/tasks* page
     - Exact tasks/ page remains protected (no logic)
  ========================================================= */
  const SKIP_EXACT = "https://worker.mturk.com/tasks/";
  const AMAZON_SIGNIN_PREFIX = "https://www.amazon.com/ap/signin";
  const TASKS_HEARTBEAT_KEY = "AB2_TASKS_HEARTBEAT_V2";

  function setLS(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function getLS(k) { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } }

  function isWorkerTasksAny() {
    try {
      return (location.hostname === "worker.mturk.com" && (location.pathname || "").startsWith("/tasks"));
    } catch (_) {
      return false;
    }
  }

  function markTasksHeartbeat() {
    const beat = () => setLS(TASKS_HEARTBEAT_KEY, String(Date.now()));
    beat();
    setInterval(beat, 5000);
  }

  function tasksTabExistsRecently(maxAgeMs) {
    const v = getLS(TASKS_HEARTBEAT_KEY);
    const t = parseInt(v, 10);
    if (!t || isNaN(t)) return false;
    return (Date.now() - t) <= maxAgeMs;
  }

  function isAmazonSigninPage() {
    return (location.href || "").startsWith(AMAZON_SIGNIN_PREFIX);
  }

  // ✅ Heartbeat on any /tasks* page (fix for tasks detection)
  if (isWorkerTasksAny()) {
    markTasksHeartbeat();
  }

  /* =========================================================
     CORE CONTROL FLAGS
  ========================================================= */
  const RETRY_INTERVAL_MS = 1200;
  const ATTEMPT_THROTTLE_MS = 4000;
  const MAX_RUNTIME_MS = 45000;
  const START_DELAY_MS = 200;

  let lastAttempt = 0;
  let intervalId = null;
  let observer = null;
  let hardStopTimer = null;
  let stopped = false;
  let closeTriggered = false;

  function now() { return Date.now(); }

  function stopAll(reason) {
    if (stopped) return;
    stopped = true;
    try { if (observer) observer.disconnect(); } catch (_) {}
    try { if (intervalId) clearInterval(intervalId); } catch (_) {}
    try { if (hardStopTimer) clearTimeout(hardStopTimer); } catch (_) {}
    console.log("[AB2soft] Stopped:", reason);
  }

  window.addEventListener("beforeunload", () => stopAll("beforeunload"));

  function silentClose(reason) {
    if (closeTriggered) return;
    closeTriggered = true;

    console.log("[AB2soft] Closing tab:", reason);
    stopAll("closing");

    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      try { window.close(); } catch (_) {}
      if (tries >= 8) {
        clearInterval(iv);
        try { location.replace("about:blank"); } catch (_) {}
        try { window.open("about:blank", "_self"); } catch (_) {}
        try { window.close(); } catch (_) {}
      }
    }, 200);
  }

  /* =========================================================
     HARD PROTECT: exact tasks/ page does nothing except heartbeat
  ========================================================= */
  if (location.href === SKIP_EXACT) {
    return;
  }

  /* =========================================================
     FLOW FLAGS
  ========================================================= */
  const CAPTCHA_FLOW_KEY = "AB2_CAPTCHA_FLOW_V1";
  const LOGIN_FLOW_KEY   = "AB2_AMZN_SIGNIN_FLOW_V1";
  const POSTLOGIN_KEY    = "AB2_POSTLOGIN_V1";

  function setSS(k, v) { try { sessionStorage.setItem(k, v); } catch (_) {} }
  function getSS(k) { try { return sessionStorage.getItem(k) || ""; } catch (_) { return ""; } }
  function delSS(k) { try { sessionStorage.removeItem(k); } catch (_) {} }

  function markCaptchaFlow() { setSS(CAPTCHA_FLOW_KEY, "1"); }
  function isCaptchaFlow() { return getSS(CAPTCHA_FLOW_KEY) === "1"; }
  function clearCaptchaFlow() { delSS(CAPTCHA_FLOW_KEY); }

  function markLoginFlow() { setSS(LOGIN_FLOW_KEY, "1"); }
  function isLoginFlow() { return getSS(LOGIN_FLOW_KEY) === "1"; }
  function clearLoginFlow() { delSS(LOGIN_FLOW_KEY); }

  function markPostLogin() { setSS(POSTLOGIN_KEY, String(Date.now())); }
  function isPostLoginRecent(maxAgeMs) {
    const v = getSS(POSTLOGIN_KEY);
    const t = parseInt(v, 10);
    if (!t || isNaN(t)) return false;
    return (Date.now() - t) <= maxAgeMs;
  }
  function clearPostLogin() { delSS(POSTLOGIN_KEY); }

  /* =========================================================
     PROTECT "/tasks" (no slash) when USER opened it manually.
     Only auto-close/redirect "/tasks" when it's auto-flow.
  ========================================================= */
  function isTasksNoSlash() {
    try { return location.hostname === "worker.mturk.com" && (location.pathname || "") === "/tasks"; }
    catch (_) { return false; }
  }

  function referrerLooksAutoFlow() {
    const r = (document.referrer || "").toLowerCase();
    if (!r) return false;
    if (r.indexOf("amazon.com/ap/signin") !== -1) return true;
    if (r.indexOf("/errors") !== -1) return true;
    if (r.indexOf("validatecaptcha") !== -1) return true;
    if (r.indexOf("opfcaptcha") !== -1) return true;
    return false;
  }

  function isLikelyAutoTasksNoSlash() {
    if (isLoginFlow()) return true;
    if (isCaptchaFlow()) return true;
    if (isPostLoginRecent(120000)) return true;
    if (referrerLooksAutoFlow()) return true;
    return false;
  }

  // ✅ If user manually opened /tasks, do NOT close/redirect it
  if (isTasksNoSlash() && !isLikelyAutoTasksNoSlash()) {
    console.log("[AB2soft] /tasks opened manually -> protected (will not auto-close)");
    return;
  }

  /* =========================================================
     AUTO-CLOSE SIGNALS (legacy kept)
  ========================================================= */
  function setupAutoCloseSignals() {
    const closePhrases = [
      "hit submitted",
      "there are no more of these hits available",
      "see other hits available to you below",
      "this hit is no longer available",
      "this hit cannot be returned",
      "this hit is no longer in your hits queue",
      "your hit submission was not successful"
    ];

    const shouldClose = () => {
      const bodyText = ((document.body && document.body.innerText) || "").toLowerCase();
      for (const p of closePhrases) {
        if (bodyText.includes(p)) return true;
      }

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
        silentClose("close-signal");
      }
    };

    tryClose();

    const mo = new MutationObserver(tryClose);
    try { mo.observe(document.documentElement || document.body, { childList: true, subtree: true, characterData: true }); } catch (_) {}

    const iv = setInterval(tryClose, 1200);

    setTimeout(() => {
      try { mo.disconnect(); } catch (_) {}
      try { clearInterval(iv); } catch (_) {}
    }, 30000);
  }
  setupAutoCloseSignals();

  /* =========================================================
     Queue count parser (NEW)
  ========================================================= */
  function getQueueCountFromPage() {
    const title = (document.title || "");
    let m = title.match(/Your HITs Queue\s*\((\d+)\)/i);
    if (m) return parseInt(m[1], 10);

    const body = ((document.body && document.body.innerText) || "");
    m = body.match(/Your HITs Queue\s*\((\d+)\)/i);
    if (m) return parseInt(m[1], 10);

    return -1; // unknown
  }

  function isQueueEmptyZero() {
    return getQueueCountFromPage() === 0;
  }

  /* =========================================================
     ALWAYS-HANDLE QUEUE RESULT PAGE
     If "/tasks" OR "Your HITs Queue" text:
       - only act if auto-flow
       - If tasks* exists -> close this tab
       - else -> navigate to tasks/
     EXTRA RULE:
       - If auto-flow "/tasks" and queue is 0 and main exists -> close it
  ========================================================= */
  function isTasksQueuePage() {
    try {
      if (location.hostname !== "worker.mturk.com") return false;

      const p = (location.pathname || "");
      if (p === "/tasks") return true;

      const title = (document.title || "");
      if (title.indexOf("Your HITs Queue") !== -1) return true;

      const body = ((document.body && document.body.innerText) || "");
      if (body.indexOf("Your HITs Queue") !== -1) return true;

      return false;
    } catch (_) {
      return false;
    }
  }

  function handleQueuePageNow(where) {
    if (!isTasksQueuePage()) return false;

    // If "/tasks" is user-manual, do nothing
    if (isTasksNoSlash() && !isLikelyAutoTasksNoSlash()) return false;

    // ✅ NEW: auto-flow "/tasks" and queue is 0 -> close if main exists
    if (isTasksNoSlash() && isLikelyAutoTasksNoSlash() && isQueueEmptyZero()) {
      if (tasksTabExistsRecently(25000)) {
        silentClose("auto /tasks queue=0 -> close (main exists) [" + where + "]");
        return true;
      }
      // if main doesn't exist, fall through to allow becoming main
    }

    // If main exists, close this queue tab
    if (tasksTabExistsRecently(25000)) {
      silentClose("queue-page: tasks tab exists [" + where + "]");
      return true;
    }

    // Else make this tab become the main tasks/ tab
    console.log("[AB2soft] Queue page found but no tasks/ tab detected. Going to tasks/ ... [" + where + "]");
    try { location.assign(SKIP_EXACT); } catch (_) {}
    return true;
  }

  if (handleQueuePageNow("page-load")) return;

  /* =========================================================
     Post-login close when "Your HITs Queue" text found (kept)
  ========================================================= */
  function hasYourHitsQueueText() {
    const t = ((document.body && document.body.innerText) || "");
    return t.indexOf("Your HITs Queue") !== -1;
  }

  function postLoginCloseCheck(where) {
    if (!isPostLoginRecent(120000)) return false;
    if (hasYourHitsQueueText()) {
      clearPostLogin();
      silentClose("post-login: Your HITs Queue found [" + where + "]");
      return true;
    }
    return false;
  }

  if (postLoginCloseCheck("page-load")) return;

  /* =========================================================
     Error/Captcha Page Detection
  ========================================================= */
  function isErrorLikePage() {
    if (location.pathname.includes("/errors")) return true;

    if (document.querySelector('form[action*="/errors/validateCaptcha"], input[name="amzn"], input[name="amzn-r"], input[name="field-keywords"]')) {
      return true;
    }

    const title = (document.title || "").toLowerCase();
    if (title.includes("server busy")) return true;

    const t = ((document.body && document.body.innerText) || "").toLowerCase();
    if (t.includes("server busy") && t.includes("continue shopping")) return true;

    if (document.querySelector('iframe[src*="captcha"], img[src*="captcha"]')) return true;

    return false;
  }

  /* =========================================================
     AMAZON SIGN-IN FLOW RULE
  ========================================================= */
  if (isAmazonSigninPage()) markLoginFlow();

  function handleAmazonSigninCleared(where) {
    if (!isLoginFlow()) return false;
    if (isAmazonSigninPage()) return false;

    clearLoginFlow();
    markPostLogin();

    if (tasksTabExistsRecently(25000)) {
      silentClose("amazon-login-cleared (tasks-tab-exists) [" + where + "]");
      return true;
    }

    console.log("[AB2soft] Amazon login cleared; no tasks tab detected. Navigating to tasks/ ... [" + where + "]");
    try { location.assign(SKIP_EXACT); } catch (_) {}
    return true;
  }

  if (handleAmazonSigninCleared("page-load")) return;

  /* =========================================================
     CAPTCHA CLEARED => CLOSE RESULT PAGE
  ========================================================= */
  if (isCaptchaFlow() && !isErrorLikePage()) {
    clearCaptchaFlow();
    silentClose("captcha-cleared-result (page-load)");
    return;
  }

  /* =========================================================
     validateCaptcha form + continue button
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
      for (const tt of types) {
        try { el.dispatchEvent(new MouseEvent(tt, { bubbles: true, cancelable: true, view: window })); } catch (_) {}
      }
      try { el.click(); } catch (_) {}
      return true;
    } catch (_) {
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
     Attempt Logic
  ========================================================= */
  function attemptOnce() {
    if (stopped) return;

    if (handleQueuePageNow("attemptOnce")) return;
    if (handleAmazonSigninCleared("attemptOnce")) return;
    if (postLoginCloseCheck("attemptOnce")) return;

    if (location.href === SKIP_EXACT) {
      stopAll("navigated-to-skip-url");
      return;
    }

    if (isCaptchaFlow() && !isErrorLikePage()) {
      clearCaptchaFlow();
      silentClose("captcha-cleared-result");
      return;
    }

    if (now() - lastAttempt < ATTEMPT_THROTTLE_MS) return;
    lastAttempt = now();

    if (!isErrorLikePage()) {
      stopAll("page-not-error-anymore");
      return;
    }

    const form = findValidateForm();
    const btn = findContinueButton(form);

    if (!form && !btn) return;

    const validateUrl = buildValidateUrl(form);
    if (validateUrl && redirectOnce(validateUrl)) {
      stopAll("redirected-validate");
      return;
    }

    try {
      if (btn) {
        synthClick(btn);
        console.log("[AB2soft] Continue clicked");
        return;
      }
      if (form) {
        try { form.submit(); } catch (_) {}
        console.log("[AB2soft] Form submitted");
        return;
      }
    } catch (_) {}
  }

  /* =========================================================
     Start Watching (only when error-like)
  ========================================================= */
  function startWatching() {
    if (stopped) return;

    if (handleQueuePageNow("startWatching")) return;
    if (handleAmazonSigninCleared("startWatching")) return;
    if (postLoginCloseCheck("startWatching")) return;

    if (!isErrorLikePage()) return;

    markCaptchaFlow();
    console.log("[AB2soft] Watching started (error-like page detected)");

    hardStopTimer = setTimeout(() => stopAll("max-runtime-reached"), MAX_RUNTIME_MS);

    attemptOnce();

    try {
      observer = new MutationObserver(() => attemptOnce());
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    } catch (_) {}

    intervalId = setInterval(() => {
      if (handleQueuePageNow("interval")) return;
      if (handleAmazonSigninCleared("interval")) return;
      if (postLoginCloseCheck("interval")) return;

      if (!isErrorLikePage()) {
        if (isCaptchaFlow()) {
          clearCaptchaFlow();
          silentClose("captcha-cleared-result (interval)");
          return;
        }
        stopAll("interval-detected-resolved");
        return;
      }

      attemptOnce();
    }, RETRY_INTERVAL_MS);
  }

  setTimeout(startWatching, START_DELAY_MS);

  console.log("✅ AB2soft MTurkErrors loaded (auto /tasks empty-queue close + manual /tasks protected + main tasks/ safe)");
})();
