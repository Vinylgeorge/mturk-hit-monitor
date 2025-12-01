// ==UserScript==
// @name         MTurk Errors
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
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/mturk-hit-monitor/refs/heads/main/refresh.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/mturk-hit-monitor/refs/heads/main/refresh.user.js
// ==/UserScript==

(function () {
  'use strict';

  const RETRY_INTERVAL_MS = 1200;
  const ATTEMPT_THROTTLE_MS = 8000;
  let lastAttempt = 0;
  let intervalId = null;
  let observer = null;

  function now() { return Date.now(); }

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
  function AB2softAutoCloseEmptyHit() {
    const checkInterval = setInterval(() => {
      const alertBox = document.querySelector('div[data-react-class*="alert/Alert"]');
      if (!alertBox) return;

      const text = alertBox.textContent?.trim() || "";
      if (text.includes("There are no more of these HITs available")) {
        console.log("🚫 No more HITs available — closing tab...");
        clearInterval(checkInterval);
        window.close();
      }
    }, 1000);
    setTimeout(() => clearInterval(checkInterval), 20000);
  }
  AB2softAutoCloseEmptyHit();

  // ------------------------------------------------
  // 3) COOKIE GUARD (prevents cookie growth)
  // ------------------------------------------------
  function AB2softCookieGuard() {
    const MAX_COOKIE_VALUE = 3500; // per-cookie value cap (bytes/characters)
    const WHITELIST_PREFIXES = [
      "session-id",
      "session-token",
      "ubid-",
      "at-main",
      "x-main",
      "mturk-",
      "i18n-prefs",
      "lc-",
      "skin"
    ];

    function getBaseDomain() {
      const parts = location.hostname.split('.');
      if (parts.length >= 2) {
        return parts.slice(-2).join('.');
      }
      return location.hostname;
    }

    const baseDomain = getBaseDomain();

    function isWhitelisted(name) {
      const lower = name.toLowerCase();
      return WHITELIST_PREFIXES.some(prefix => lower.startsWith(prefix));
    }

    function clearCookie(name) {
      const expires = "Thu, 01 Jan 1970 00:00:00 GMT";
      // Try both with and without domain
      document.cookie = `${name}=; expires=${expires}; path=/; domain=.${baseDomain}`;
      document.cookie = `${name}=; expires=${expires}; path=/`;
    }

    function scanAndClean() {
      const raw = document.cookie || "";
      if (!raw) return;
      raw.split(/;\s*/).forEach(pair => {
        if (!pair) return;
        const [namePart, ...rest] = pair.split('=');
        if (!namePart) return;
        const name = namePart.trim();
        const value = rest.join('=');

        if (!value) return;
        if (isWhitelisted(name)) return;

        if (value.length > MAX_COOKIE_VALUE) {
          console.log("[AB2softCookieGuard] Deleting big cookie:", name, "len:", value.length);
          clearCookie(name);
        }
      });
    }

    // Run on load
    scanAndClean();

    // Run periodically (in case new tasks / pages cause cookie growth)
    setInterval(scanAndClean, 180000); // every 3 minutes

    // Extra: run whenever we land on queue / tasks / project pages (new tasks)
    if (/\/tasks|\/projects|\/worker\.mturk\.com\/?$/.test(location.pathname + location.search)) {
      scanAndClean();
    }
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
      location.assign("https://worker.mturk.com/tasks");
    }

    if (!isWorker) return;

    if (isCookieTooLarge) {
      console.log("[AB2softAutoFix404] Detected 400 / cookie too large, cleaning cookies...");
      AB2softCookieGuard(); // re-run cookie cleanup aggressively
      setTimeout(() => {
        redirectToQueueOnce("cookie-too-large");
      }, 1500);
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
  // 6) PERIODIC POPUP PING (keep session alive)
  // ------------------------------------------------
  function scheduleMTurkPopup() {
    const min = 240, max = 300;
    const delay = Math.floor(Math.random() * (max - min + 1) + min) * 1000;

    setTimeout(() => {
      const w = window.open(
        "https://worker.mturk.com",
        "mturkPopup",
        "width=100,height=100,left=50,top=50"
      );
      if (w) {
        w.blur();
        window.focus();
        setTimeout(() => {
          try { w.close(); } catch {}
        }, 5000);
      }
      scheduleMTurkPopup();
    }, delay);
  }
  scheduleMTurkPopup();

  // ------------------------------------------------
  // 7) AUTO CLOSE TAB WHEN “HIT SUBMITTED” (separate function)
  // ------------------------------------------------
  function setupAutoCloseOnSubmit() {
    function closeIfSubmitted() {
      if (document.body && document.body.innerText.includes("HIT Submitted")) {
        console.log("[MTurk AutoClose] HIT Submitted detected — closing tab...");
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
