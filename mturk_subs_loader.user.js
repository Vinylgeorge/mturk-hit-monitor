// ==UserScript==
// @name         MTurk SUBS
// @namespace    Violentmonkey Scripts
// @version      3.1
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

  const RETRY_INTERVAL_MS = 1200;
  const ATTEMPT_THROTTLE_MS = 8000;
  const CANONICAL_TASKS_URL = "https://worker.mturk.com/tasks/";
  const TASKS_URL_NO_SLASH = "https://worker.mturk.com/tasks";
  let lastAttempt = 0;
  let intervalId = null;
  let observer = null;

  function now() { return Date.now(); }
  function setupGlobalCloseWatcher() {
    const shouldCloseNow = () => {
      const text = ((document.body && document.body.innerText) || "").toLowerCase();
      const hasSubmitted = text.includes("hit submitted");
      const noMoreHits = text.includes("there are no more of these hits available");
      const seeOtherHits = text.includes("see other hits available to you below");
      const hitNoLongerAvailable = text.includes("this hit is no longer available");
      const hitCannotBeReturned = text.includes("this hit cannot be returned");
      const noLongerInQueue = text.includes("this hit is no longer in your hits queue");
      if (hasSubmitted || noMoreHits || seeOtherHits || hitNoLongerAvailable || hitCannotBeReturned || noLongerInQueue) return true;

      const alertNodes = Array.from(document.querySelectorAll('div[data-react-class*="alert/Alert"]'));
      for (const node of alertNodes) {
        const props = (node.getAttribute("data-react-props") || "").toLowerCase();
        if (
          props.includes("hit submitted") ||
          props.includes("there are no more of these hits available") ||
          props.includes("see other hits available to you below") ||
          props.includes("this hit is no longer available") ||
          props.includes("this hit cannot be returned") ||
          props.includes("this hit is no longer in your hits queue")
        ) {
          return true;
        }
      }
      return false;
    };

    const tryClose = () => {
      if (shouldCloseNow()) {
        console.log("[MTurk AutoClose] Global close watcher detected submit/unavailable alert — closing tab...");
        try { window.close(); } catch (_) {}
      }
    };

    tryClose();
    const mo = new MutationObserver(tryClose);
    if (document.documentElement) {
      mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }
    const iv = setInterval(tryClose, 1200);
    setTimeout(() => {
      try { mo.disconnect(); } catch (_) {}
      clearInterval(iv);
    }, 30000);
  }
  setupGlobalCloseWatcher();

  function isExactAllowedUrl() {
    return location.href === CANONICAL_TASKS_URL;
  }
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

  // ------------------------------------------------
  // 0) STRICT SINGLE INSTANCE LOCK
  // ------------------------------------------------
  function enforceSingleInstance() {
    const KEY = "AB2_MTURK_SUBS_SINGLE_INSTANCE";
    const HEARTBEAT_MS = 2500;
    const STALE_MS = 10000;
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

    function readState() {
      try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { return null; }
    }
    function writeState() {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          id,
          t: Date.now(),
          url: normalizeUrl(location.href)
        }));
      } catch (_) {}
    }

    const active = readState();
    if (active && active.id !== id && Date.now() - Number(active.t || 0) < STALE_MS) {
      console.log("[mturk-auto] another instance is active, skipping this tab");
      if (location.href === CANONICAL_TASKS_URL) {
        location.replace(TASKS_URL_NO_SLASH);
      }
      return false;
    }

    writeState();
    const hb = setInterval(() => {
      const current = readState();
      if (current && current.id && current.id !== id && Date.now() - Number(current.t || 0) < STALE_MS) {
        clearInterval(hb);
        return;
      }
      writeState();
    }, HEARTBEAT_MS);

    window.addEventListener("beforeunload", () => {
      try {
        const current = readState();
        if (current && current.id === id) localStorage.removeItem(KEY);
      } catch (_) {}
      clearInterval(hb);
    });
    return true;
  }

  if (!isExactAllowedUrl()) return;
  if (!enforceSingleInstance()) return;

  // ------------------------------------------------
  // 1) TAB LIMITER (same as your version)
  // ------------------------------------------------
  function AB2softTabLimiter() {
    const MAX_TABS = 3;              // allow any 3 tabs total
    const STORAGE_KEY = "AB2_TAB_TRACKER";
    const CHECK_DELAY = 1500;        // wait 1.5 s before enforcing (stabilization)
    const STALE_AGE = 8000;          // remove tabs not updated in 8 s
    const tabId = Date.now() + Math.random().toString(16).slice(2);

    const getTabs = () => {
      try {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        const now = Date.now();
        for (const [id, rec] of Object.entries(all)) {
          if (!rec || now - rec.time > STALE_AGE) delete all[id];
        }
        return all;
      } catch { return {}; }
    };
    const saveTabs = (obj) => localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    const cleanup = () => { const t = getTabs(); delete t[tabId]; saveTabs(t); };

    const tabs = getTabs();
    tabs[tabId] = { url: location.href, time: Date.now() };
    saveTabs(tabs);
    window.addEventListener("beforeunload", cleanup);

    setInterval(() => {
      const t = getTabs();
      if (t[tabId]) { t[tabId].time = Date.now(); saveTabs(t); }
    }, 3000);

    setTimeout(() => {
      const allTabs = Object.keys(getTabs());
      if (allTabs.length > MAX_TABS) {
        console.log("AB2soft: closing extra tab →", location.href);
        try { window.close(); } catch (_) {}
      }
    }, CHECK_DELAY);
  }

  // run once when script starts
  AB2softTabLimiter();

  // ------------------------------------------------
  // 2) AUTO CLOSE “NO MORE HITs AVAILABLE” PAGE
  // ------------------------------------------------
  function hasNoMoreHitsSignal() {
    const bodyText = ((document.body && document.body.innerText) || "").toLowerCase();
    if (
      bodyText.includes("there are no more of these hits available") ||
      bodyText.includes("browse all available hits")
    ) {
      return true;
    }

    const alertNodes = Array.from(document.querySelectorAll('div[data-react-class*="alert/Alert"]'));
    for (const node of alertNodes) {
      const txt = (node.textContent || "").toLowerCase();
      const props = (node.getAttribute("data-react-props") || "").toLowerCase();
      if (
        txt.includes("there are no more of these hits available") ||
        props.includes("there are no more of these hits available") ||
        props.includes("browse") && props.includes("all available hits")
      ) {
        return true;
      }
    }
    return false;
  }

  function AB2softAutoCloseEmptyHit() {
    const checkInterval = setInterval(() => {
      if (hasNoMoreHitsSignal()) {
        console.log("🚫 No more HITs available — closing tab...");
        clearInterval(checkInterval);
        window.close();
      }
    }, 1000);
    setTimeout(() => clearInterval(checkInterval), 20000);
  }
  AB2softAutoCloseEmptyHit();

  // ------------------------------------------------
  // 3) COOKIE GUARD (prevents cookie-too-large loops)
  // ------------------------------------------------
  let cookieGuardStarted = false;
  function AB2softCookieGuard(options = {}) {
    const isMTurkHost = location.hostname.includes("mturk.com");
    if (!isMTurkHost) return { removed: 0, reason: "non-mturk-host" };

    const aggressive = !!options.aggressive;
    const reason = options.reason || "normal-scan";

    const MAX_COOKIE_VALUE = aggressive ? 1200 : 1800;
    const MAX_COOKIE_HEADER = aggressive ? 5500 : 6800;
    const MAX_COOKIE_COUNT = aggressive ? 22 : 30;
    const PROTECTED_PREFIXES = [
      "session-id",
      "session-id-time",
      "session-token",
      "ubid-",
      "at-main",
      "sess-at-",
      "x-main",
      "frc",
      "map-",
      "sst-",
      "regstatus",
      "i18n-prefs",
      "lc-",
      "skin"
    ];
    const PROTECTED_EXACT_NAMES = new Set([
      "csm-hit"
    ]);

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
          if (domain) {
            document.cookie = `${name}=; expires=${expires}; path=${path}; domain=${domain}`;
          } else {
            document.cookie = `${name}=; expires=${expires}; path=${path}`;
          }
        }
      }
    }

    function runSinglePass(forceDropNonEssential = false) {
      const before = parseCookies();
      if (!before.length) return { removed: 0, beforeCount: 0, afterCount: 0 };
      const beforeHeaderBytes = (document.cookie || "").length;
      let removed = 0;

      // First pass: drop oversized cookies (or all non-essential in aggressive mode)
      for (const { name, value } of before) {
        if (isProtectedCookie(name)) continue;
        if (forceDropNonEssential || value.length > MAX_COOKIE_VALUE) {
          clearCookieEverywhere(name);
          removed += 1;
        }
      }

      // Second pass: if total header still too large, drop all remaining non-essential.
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

      const afterHeaderBytes = (document.cookie || "").length;
      console.log("[AB2softCookieGuard]", {
        reason,
        aggressive,
        beforeCount: before.length,
        afterCount: current.length,
        beforeHeaderBytes,
        afterHeaderBytes,
        removed,
        protectedPrefixes: PROTECTED_PREFIXES.length
      });
      return { removed, beforeCount: before.length, afterCount: current.length };
    }

    const stats = runSinglePass(aggressive);
    if (aggressive) {
      // Some cookies can reappear immediately; do one more quick pass.
      setTimeout(() => runSinglePass(true), 350);
    }

    if (!cookieGuardStarted) {
      cookieGuardStarted = true;
      setInterval(() => AB2softCookieGuard({ reason: "interval-scan" }), 45000);
      window.addEventListener("focus", () => AB2softCookieGuard({ reason: "window-focus" }));
      window.addEventListener("pageshow", () => AB2softCookieGuard({ reason: "pageshow" }));
    }

    return stats;
  }

  AB2softCookieGuard();

  // ------------------------------------------------
  // 4) FIND & SUBMIT CAPTCHA / CONTINUE FOR ERROR PAGES
  // ------------------------------------------------
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
    if (prim) return prim;
    return null;
  }

  // Optional style from your code (button, not used right now)
  const style = document.createElement("style");
  style.textContent = `
    #mturkQueueBtn {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #2c3e50;
      color: #fff;
      font-size: 14px;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      z-index: 99999;
      box-shadow: 0 3px 8px rgba(0,0,0,0.3);
      font-family: sans-serif;
    }
    #mturkQueueBtn:hover {
      background: #34495e;
    }
  `;
  document.head.appendChild(style);

  function synthClick(el) {
    try {
      el.focus && el.focus();
      const types = ['mouseover','pointerover','mousemove','mousedown','pointerdown','mouseup','pointerup','click'];
      for (const t of types) {
        try {
          const ev = new MouseEvent(t, { bubbles: true, cancelable: true, view: window });
          el.dispatchEvent(ev);
        } catch (e) {}
      }
      try { el.click(); } catch (e) {}
      console.log('[mturk-auto] synthClick dispatched');
      return true;
    } catch (e) {
      console.warn('[mturk-auto] synthClick error', e);
      return false;
    }
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
        const txt = await resp.text();
        console.log('[mturk-auto] fetchSubmitForm GET status', resp.status);
        if (/Your HITs Queue/i.test(txt) || resp.status === 302 || resp.status === 200) return true;
      } else {
        const resp = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          body: new URLSearchParams(data)
        });
        const txt = await resp.text();
        console.log('[mturk-auto] fetchSubmitForm POST status', resp.status);
        if (/Your HITs Queue/i.test(txt) || resp.status === 302 || resp.status === 200) return true;
      }
    } catch (e) {
      console.warn('[mturk-auto] fetchSubmitForm error', e);
    }
    return false;
  }

  async function attemptOnce() {
    if (now() - lastAttempt < ATTEMPT_THROTTLE_MS) return;
    lastAttempt = now();

    const form = findValidateForm();
    const btn = findContinueButton(form);
    if (!form && !btn) {
      console.log('[mturk-auto] no form/button found yet');
      return;
    }

    console.log('[mturk-auto] found', { hasForm: !!form, hasButton: !!btn });

    if (btn) {
      try {
        synthClick(btn);
      } catch (e) { console.warn('[mturk-auto] click error', e); }
    }

    if (form) {
      try {
        try {
          form.submit();
          console.log('[mturk-auto] form.submit() called');
          return;
        } catch (e) {
          console.warn('[mturk-auto] form.submit() error', e);
        }

        const ok = await fetchSubmitForm(form);
        if (ok) {
          console.log('[mturk-auto] fetchSubmitForm likely succeeded');
          return;
        }
      } catch (e) {
        console.warn('[mturk-auto] form handling error', e);
      }
    }
  }

  function startWatching() {
    attemptOnce();

    try {
      observer = new MutationObserver(() => {
        attemptOnce();
      });
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });
    } catch (e) {
      console.warn('[mturk-auto] observer failed', e);
    }

    intervalId = setInterval(() => {
      if (!location.pathname.includes('/errors')) {
        clearInterval(intervalId);
        if (observer) try { observer.disconnect(); } catch (e) {}
        return;
      }
      attemptOnce();
    }, RETRY_INTERVAL_MS);

    window.addEventListener('beforeunload', () => {
      if (observer) try { observer.disconnect(); } catch (e) {}
      if (intervalId) clearInterval(intervalId);
    });
  }

  if (
    location.pathname.includes('/errors') ||
    document.querySelector('form[action*="/errors/validateCaptcha"], input[name="amzn"], input[name="amzn-r"]')
  ) {
    setTimeout(() => startWatching(), 300);
  }

  // ------------------------------------------------
  // 5) AUTO FIX 400 / 404 (autoFix404)
  // ------------------------------------------------
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

    function redirectToQueueOnce(reason) {
      try {
        const key = "AB2_404_FIX_USED";
        if (sessionStorage.getItem(key) === location.href) {
          console.log("[AB2softAutoFix404] Already tried fix for this URL, skipping");
          return;
        }
        sessionStorage.setItem(key, location.href);
      } catch (_) {}

      console.log("[AB2softAutoFix404] Redirecting to queue due to:", reason);
      if (!sameNormalizedUrl(location.href, CANONICAL_TASKS_URL)) {
        location.assign(CANONICAL_TASKS_URL);
      }
    }

    if (!isWorker) return;

    if (isCookieTooLarge) {
      console.log("[AB2softAutoFix404] Detected 400 / cookie too large, running aggressive cookie cleanup...");
      AB2softCookieGuard({ aggressive: true, reason: "cookie-too-large-400" });
      setTimeout(() => {
        redirectToQueueOnce("cookie-too-large");
      }, 900);
      return;
    }

    if (looks404) {
      // Typical worker 404 on project / task pages
      if (/\/projects\/|\/tasks\/|\/errors\//.test(location.pathname)) {
        redirectToQueueOnce("mturk-404");
      }
    }
  }

  // Run autoFix404 after DOM is ready a bit
  setTimeout(AB2softAutoFix404, 1200);

  // ------------------------------------------------
  // 6) PASSIVE ISSUE DETECTOR (no popup keepalive)
  // ------------------------------------------------
  function setupIssueDetector() {
    if (!location.hostname.includes("mturk.com")) return;

    const reported = new Set();
    const reportOnce = (key, message) => {
      if (reported.has(key)) return;
      reported.add(key);
      console.warn("[MTurk Detector]", message);
    };

    function scanIssues() {
      const bodyText = (document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : "";
      const form = findValidateForm();
      const continueBtn = findContinueButton(form);
      const captchaLike =
        !!form ||
        !!document.querySelector('iframe[src*="captcha"], img[src*="captcha"], input[name="amzn"], input[name="amzn-r"]');

      if (captchaLike) {
        reportOnce("captcha", "Captcha/validation challenge detected.");
      }
      if (continueBtn) {
        reportOnce("continue", "Continue button/action detected.");
      }
      if (bodyText.includes("there are no more of these hits available")) {
        reportOnce("no-more-hits", "No more HITs available page detected.");
      }
      if (bodyText.includes("400 bad request") && bodyText.includes("request header or cookie too large")) {
        reportOnce("cookie-too-large", "400 error: request header or cookie too large.");
      }
      if (
        bodyText.includes("404") ||
        bodyText.includes("page not found") ||
        location.pathname.includes("/errors/404")
      ) {
        reportOnce("404", "404/page-not-found condition detected.");
      }
    }

    scanIssues();

    const issueObserver = new MutationObserver(() => scanIssues());
    if (document.documentElement) {
      issueObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    const issueInterval = setInterval(scanIssues, 3000);
    window.addEventListener("beforeunload", () => {
      try { issueObserver.disconnect(); } catch (_) {}
      clearInterval(issueInterval);
    });
  }
  //setupIssueDetector();

  // ------------------------------------------------
  // 7) BACKGROUND WORKER POPUP PING (every 3-5 min)
  // ------------------------------------------------
  function scheduleBackgroundWorkerPing() {
    if (!location.hostname.includes("mturk.com")) return;
    const MIN_MS = 180000; // 3 min
    const MAX_MS = 300000; // 5 min
    let stopped = false;

    const run = () => {
      if (stopped) return;
      const delay = Math.floor(Math.random() * (MAX_MS - MIN_MS + 1)) + MIN_MS;
      setTimeout(() => {
        if (stopped) return;
        try {
          if (sameNormalizedUrl(location.href, CANONICAL_TASKS_URL)) {
            run();
            return;
          }
          const w = window.open(
            CANONICAL_TASKS_URL,
            "mturkBackgroundPing",
            "noopener,noreferrer,width=120,height=120,left=0,top=0"
          );
          if (w) {
            try { w.blur(); } catch (_) {}
            try { window.focus(); } catch (_) {}
            setTimeout(() => {
              try { w.close(); } catch (_) {}
            }, 5000);
          }
        } catch (_) {}
        run();
      }, delay);
    };

    run();
    window.addEventListener("beforeunload", () => {
      stopped = true;
    });
  }
  //scheduleBackgroundWorkerPing();

  // ------------------------------------------------
  // 8) AUTO CLOSE TAB WHEN “HIT SUBMITTED” (separate function)
  // ------------------------------------------------
  function setupAutoCloseOnSubmit() {
    function closeIfSubmitted() {
      const text = (document.body && document.body.innerText) ? document.body.innerText : "";
      const hasSubmitted = text.includes("HIT Submitted");
      const noMoreHits = hasNoMoreHitsSignal();
      const hitNoLongerAvailable = text.includes("This HIT is no longer available");
      const hitCannotBeReturned = text.includes("This HIT cannot be returned");
      const noLongerInQueue = text.includes("This HIT is no longer in your HITs queue");
      if (hasSubmitted || noMoreHits || hitNoLongerAvailable || hitCannotBeReturned || noLongerInQueue) {
        console.log("[MTurk AutoClose] Submit/No-more-HITs detected — closing tab...");
        window.close();
      }
    }

    const observer = new MutationObserver(closeIfSubmitted);
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('load', closeIfSubmitted);
  }
  setupAutoCloseOnSubmit();

  console.log("✅ AB2soft MTurk Helper loaded (TabLimiter + CookieGuard + AutoFix404 + AutoClose)");
})();
