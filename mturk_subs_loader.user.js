// ==UserScript==
// @name         MTurk SUBS (AB2soft - tasks/ protected + Max3 + Close Expired + Idle 1min)
// @namespace    Violentmonkey Scripts
// @version      3.9
// @match        https://worker.mturk.com/errors/*
// @match        https://www.mturk.com/errors/*
// @match        https://worker.mturk.com/*
// @match        https://www.mturk.com/*
// @match        https://*.mturk.com/errors/*
// @match        https://*.mturk.com/*
// @match        https://*.amazon.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/mturk-hit-monitor/refs/heads/main/mturk_subs_loader.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/mturk-hit-monitor/refs/heads/main/mturk_subs_loader.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* =========================================================
     YOUR RULES (final):
     1) MAIN working tab = EXACT https://worker.mturk.com/tasks/
        - NOTHING should work there (no closers, no cookie guard, nothing)
        - also: do NOT kill it
     2) All OTHER tabs:
        - Global MAX 3 tabs total (tasks/ included in counting, but never killed)
        - Extra tabs close silently
        - If HIT is expired/unavailable -> close that tab
        - If tab is IDLE for 1 minute -> close that tab
  ========================================================= */

  const TASKS_SLASH = "https://worker.mturk.com/tasks/";
  const isMainTasks = (location.href === TASKS_SLASH);

  // ---------------------------------------------------------
  // 0) GLOBAL TAB REGISTRY (used for Max3 + stale cleanup)
  // ---------------------------------------------------------
  const MAX_TABS = 3;
  const TRACK_KEY = "AB2_GLOBAL_TABS_V3";
  const HEARTBEAT_MS = 2000;
  const STALE_MS = 12000;

  const tabId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  function now() { return Date.now(); }
  function safeJSONParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }
  function readTracker() { return safeJSONParse(localStorage.getItem(TRACK_KEY) || "{}") || {}; }
  function writeTracker(m) { try { localStorage.setItem(TRACK_KEY, JSON.stringify(m)); } catch (_) {} }

  function cleanupStale(tr) {
    const out = tr || {};
    const t = now();
    for (const [id, rec] of Object.entries(out)) {
      if (!rec || !rec.t || (t - rec.t > STALE_MS)) delete out[id];
    }
    return out;
  }

  function silentClose(reason) {
    // close without disturbing current window; fallback to about:blank if blocked
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      try { window.close(); } catch (_) {}
      if (tries >= 6) {
        clearInterval(iv);
        try { location.replace("about:blank"); } catch (_) {}
      }
    }, 200);
  }

  // Register THIS tab (including tasks/)
  let tr = cleanupStale(readTracker());
  tr[tabId] = { url: location.href, t: now(), isTasksSlash: isMainTasks ? 1 : 0 };
  writeTracker(tr);

  // Enforce max tabs: if >3, close ONLY non-main tabs
  tr = cleanupStale(readTracker());
  const count = Object.keys(tr).length;
  if (count > MAX_TABS && !isMainTasks) {
    silentClose(`max-tabs-exceeded count=${count} max=${MAX_TABS}`);
    return;
  }

  // Heartbeat
  const hb = setInterval(() => {
    let t2 = cleanupStale(readTracker());
    if (!t2[tabId]) t2[tabId] = { url: location.href, t: now(), isTasksSlash: isMainTasks ? 1 : 0 };
    t2[tabId].t = now();
    t2[tabId].url = location.href;
    t2[tabId].isTasksSlash = isMainTasks ? 1 : 0;
    writeTracker(t2);
  }, HEARTBEAT_MS);

  window.addEventListener("beforeunload", () => {
    try { clearInterval(hb); } catch (_) {}
    try {
      let t3 = cleanupStale(readTracker());
      delete t3[tabId];
      writeTracker(t3);
    } catch (_) {}
  });

  // ✅ Nothing should run on main tasks/ tab
  if (isMainTasks) return;

  /* =========================================================
     1) IDLE CLOSE (1 minute) for non-main tabs
     - "Idle" = no user interaction (mouse/keyboard/scroll/touch)
     - after 60s idle -> close silently
  ========================================================= */
  const IDLE_MS = 60000;
  let lastActive = now();

  function markActive() { lastActive = now(); }

  ["mousemove","mousedown","keydown","scroll","touchstart","wheel","pointerdown"].forEach(evt => {
    window.addEventListener(evt, markActive, { passive: true, capture: true });
  });
  window.addEventListener("focus", markActive);
  window.addEventListener("visibilitychange", () => { if (!document.hidden) markActive(); });

  setInterval(() => {
    if (now() - lastActive > IDLE_MS) {
      silentClose("idle>60s");
    }
  }, 5000);

  /* =========================================================
     2) CLOSE IF HIT EXPIRED / UNAVAILABLE / OUT OF QUEUE
     - includes your previous phrases + stronger expired wording
  ========================================================= */
  function shouldCloseExpired() {
    const text = ((document.body && document.body.innerText) || "").toLowerCase();

    const phrases = [
      "hit submitted",
      "there are no more of these hits available",
      "see other hits available to you below",
      "this hit is no longer available",
      "this hit cannot be returned",
      "this hit is no longer in your hits queue",
      "expired",                          // catch generic “expired”
      "this hit has expired",             // common wording
      "you have exceeded",                // sometimes appears with blocks/errors
      "no longer available to you"
    ];

    for (const p of phrases) {
      if (text.includes(p)) return true;
    }

    // react alert props check
    const alertNodes = Array.from(document.querySelectorAll('div[data-react-class*="alert/Alert"]'));
    for (const node of alertNodes) {
      const props = (node.getAttribute("data-react-props") || "").toLowerCase();
      for (const p of phrases) {
        if (props.includes(p)) return true;
      }
    }
    return false;
  }

  function setupCloseExpiredWatcher() {
    const tryClose = () => {
      if (shouldCloseExpired()) {
        silentClose("expired/unavailable/submitted");
      }
    };

    tryClose();
    const mo = new MutationObserver(tryClose);
    try {
      mo.observe(document.documentElement || document.body, { childList: true, subtree: true, characterData: true });
    } catch (_) {}

    const iv = setInterval(tryClose, 1200);

    // keep watcher up to 2 minutes
    setTimeout(() => {
      try { mo.disconnect(); } catch (_) {}
      try { clearInterval(iv); } catch (_) {}
    }, 120000);
  }
  setupCloseExpiredWatcher();

  /* =========================================================
     3) KEEP YOUR OTHER LOGICS "AS USUAL" (unchanged behavior)
     - CookieGuard
     - Captcha validate auto-continue (only /errors)
     - AutoFix 400/404 redirect to tasks/
  ========================================================= */

  const RETRY_INTERVAL_MS = 1200;
  const ATTEMPT_THROTTLE_MS = 8000;
  let lastAttempt = 0;
  let intervalId = null;
  let observer = null;

  function normalizeUrl(urlLike) {
    try {
      const u = new URL(urlLike, location.origin);
      let p = u.pathname.replace(/\/{2,}/g, "/");
      if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
      return `${u.origin}${p}${u.search}`;
    } catch (_) {
      return String(urlLike || "");
    }
  }
  function sameNormalizedUrl(a, b) {
    return normalizeUrl(a) === normalizeUrl(b);
  }

  // --------------------------
  // Cookie guard
  // --------------------------
  let cookieGuardStarted = false;
  function AB2softCookieGuard(options = {}) {
    const isMTurkHost = location.hostname.includes("mturk.com");
    if (!isMTurkHost) return { removed: 0, reason: "non-mturk-host" };

    const aggressive = !!options.aggressive;
    const MAX_COOKIE_VALUE = aggressive ? 1200 : 1800;
    const MAX_COOKIE_HEADER = aggressive ? 5500 : 6800;
    const MAX_COOKIE_COUNT = aggressive ? 22 : 30;

    const PROTECTED_PREFIXES = [
      "session-id","session-id-time","session-token","ubid-","at-main","sess-at-","x-main","frc",
      "map-","sst-","regstatus","i18n-prefs","lc-","skin"
    ];
    const PROTECTED_EXACT_NAMES = new Set(["csm-hit"]);

    function getBaseDomain() {
      const parts = location.hostname.split(".");
      return parts.length >= 2 ? parts.slice(-2).join(".") : location.hostname;
    }

    function parseCookies() {
      const raw = document.cookie || "";
      const pairs = raw ? raw.split(/;\s*/) : [];
      const out = [];
      for (const pair of pairs) {
        if (!pair) continue;
        const [namePart, ...rest] = pair.split("=");
        if (!namePart) continue;
        const name = namePart.trim();
        const value = rest.join("=");
        if (!name) continue;
        out.push({ name, value });
      }
      return out;
    }

    function isProtectedCookie(name) {
      const lower = name.toLowerCase();
      if (PROTECTED_EXACT_NAMES.has(lower)) return true;
      return PROTECTED_PREFIXES.some(prefix => lower.startsWith(prefix));
    }

    function clearCookieEverywhere(name) {
      const expires = "Thu, 01 Jan 1970 00:00:00 GMT";
      const baseDomain = getBaseDomain();
      const hostname = location.hostname;
      const paths = ["/", location.pathname || "/"];
      const domains = [`.${baseDomain}`, hostname, ""];
      for (const path of paths) {
        for (const domain of domains) {
          if (domain) document.cookie = `${name}=; expires=${expires}; path=${path}; domain=${domain}`;
          else document.cookie = `${name}=; expires=${expires}; path=${path}`;
        }
      }
    }

    function runSinglePass(forceDropNonEssential = false) {
      const before = parseCookies();
      if (!before.length) return { removed: 0, beforeCount: 0, afterCount: 0 };
      let removed = 0;

      for (const { name, value } of before) {
        if (isProtectedCookie(name)) continue;
        if (forceDropNonEssential || value.length > MAX_COOKIE_VALUE) {
          clearCookieEverywhere(name);
          removed += 1;
        }
      }

      let current = parseCookies();
      const headerLen = (document.cookie || "").length;
      if (headerLen > MAX_COOKIE_HEADER || current.length > MAX_COOKIE_COUNT) {
        for (const { name } of current) {
          if (isProtectedCookie(name)) continue;
          clearCookieEverywhere(name);
          removed += 1;
        }
        current = parseCookies();
      }

      return { removed, beforeCount: before.length, afterCount: current.length };
    }

    const stats = runSinglePass(aggressive);
    if (aggressive) setTimeout(() => runSinglePass(true), 350);

    if (!cookieGuardStarted) {
      cookieGuardStarted = true;
      setInterval(() => AB2softCookieGuard({ reason: "interval-scan" }), 45000);
      window.addEventListener("focus", () => AB2softCookieGuard({ reason: "window-focus" }));
      window.addEventListener("pageshow", () => AB2softCookieGuard({ reason: "pageshow" }));
    }
    return stats;
  }
  AB2softCookieGuard();

  // --------------------------
  // Captcha/errors auto continue (only /errors)
  // --------------------------
  function findValidateForm() {
    const f1 = document.querySelector('form[action*="/errors/validateCaptcha"]');
    if (f1) return f1;

    const forms = Array.from(document.querySelectorAll('form'));
    for (const f of forms) {
      const hasAmzn = !!f.querySelector('input[name="amzn"], input[name="amzn-r"], input[name="field-keywords"]');
      if (hasAmzn) return f;
    }
    return null;
  }

  function findContinueButton(form) {
    const candidates = Array.from(
      (form ? form.querySelectorAll('button, input[type="submit"], a') :
        document.querySelectorAll('button, input[type="submit"], a'))
    );
    for (const el of candidates) {
      const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase();
      if (!text) continue;
      if (text.includes('continue') || text.includes('continue shopping')) return el;
    }
    const prim = document.querySelector('.a-button .a-button-text, .a-button-primary .a-button-text, .a-button-inner button');
    return prim || null;
  }

  function synthClick(el) {
    try {
      el.focus && el.focus();
      const types = ['mouseover','pointerover','mousemove','mousedown','pointerdown','mouseup','pointerup','click'];
      for (const t of types) {
        try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch (_) {}
      }
      try { el.click(); } catch (_) {}
      return true;
    } catch (_) { return false; }
  }

  async function fetchSubmitForm(form) {
    try {
      if (!form) return false;
      const method = (form.getAttribute('method') || 'GET').toUpperCase();
      const action = form.getAttribute('action') || location.pathname;

      const data = {};
      Array.from(form.querySelectorAll('input[name]')).forEach(i => {
        const n = i.getAttribute('name');
        const v = i.value || i.getAttribute('value') || '';
        if (n) data[n] = v;
      });

      const url = action.startsWith('http') ? action : (location.origin + action);
      if (method === 'GET') {
        const qs = new URLSearchParams(data).toString();
        const full = url + (url.indexOf('?') === -1 ? '?' + qs : '&' + qs);
        const resp = await fetch(full, { method: 'GET', credentials: 'include', cache: 'no-store' });
        return (resp.status === 302 || resp.status === 200);
      } else {
        const resp = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          body: new URLSearchParams(data)
        });
        return (resp.status === 302 || resp.status === 200);
      }
    } catch (_) {}
    return false;
  }

  async function attemptOnce() {
    if (now() - lastAttempt < ATTEMPT_THROTTLE_MS) return;
    lastAttempt = now();

    const form = findValidateForm();
    const btn = findContinueButton(form);
    if (!form && !btn) return;

    if (btn) { try { synthClick(btn); } catch (_) {} }
    if (form) {
      try {
        try { form.submit(); return; } catch (_) {}
        await fetchSubmitForm(form);
      } catch (_) {}
    }
  }

  function startWatching() {
    attemptOnce();
    try {
      observer = new MutationObserver(() => { attemptOnce(); });
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });
    } catch (_) {}

    intervalId = setInterval(() => {
      if (!location.pathname.includes('/errors')) {
        clearInterval(intervalId);
        if (observer) try { observer.disconnect(); } catch (_) {}
        return;
      }
      attemptOnce();
    }, RETRY_INTERVAL_MS);

    window.addEventListener('beforeunload', () => {
      if (observer) try { observer.disconnect(); } catch (_) {}
      if (intervalId) clearInterval(intervalId);
    });
  }

  if (
    location.pathname.includes('/errors') ||
    document.querySelector('form[action*="/errors/validateCaptcha"], input[name="amzn"], input[name="amzn-r"]')
  ) {
    setTimeout(() => startWatching(), 300);
  }

  // --------------------------
  // AutoFix 400/404 -> redirect to tasks/
  // --------------------------
  function AB2softAutoFix404() {
    const bodyText = (document.body && document.body.innerText) ? document.body.innerText : "";
    const lower = bodyText.toLowerCase();

    const isCookieTooLarge =
      lower.includes("400 bad request") &&
      lower.includes("request header or cookie too large");

    const looks404 =
      lower.includes("404") ||
      lower.includes("page not found") ||
      lower.includes("looking for something") ||
      location.pathname.includes("/errors/404");

    const isWorker = location.hostname.includes("mturk.com");

    function redirectToQueueOnce() {
      try {
        const key = "AB2_404_FIX_USED";
        if (sessionStorage.getItem(key) === location.href) return;
        sessionStorage.setItem(key, location.href);
      } catch (_) {}

      if (!sameNormalizedUrl(location.href, TASKS_SLASH)) {
        location.assign(TASKS_SLASH);
      }
    }

    if (!isWorker) return;

    if (isCookieTooLarge) {
      AB2softCookieGuard({ aggressive: true, reason: "cookie-too-large-400" });
      setTimeout(() => redirectToQueueOnce(), 900);
      return;
    }

    if (looks404) {
      if (/\/projects\/|\/tasks\/|\/errors\//.test(location.pathname)) {
        redirectToQueueOnce();
      }
    }
  }
  setTimeout(AB2softAutoFix404, 1200);

  console.log("✅ AB2soft MTurk SUBS loaded (tasks/ protected | Max3 | expired close | idle 1min close)");
})();
