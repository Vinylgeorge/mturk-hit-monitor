// ==UserScript==
// @name         MTurk SUBS 
// @namespace    Violentmonkey Scripts
// @version      3.7
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
     ✅ IMPORTANT RULE YOU SAID:
     - tasks/ and tasks are DIFFERENT
     - NOTHING should work ONLY on EXACT tasks/ (with trailing slash)
     - tasks (no slash) should behave like other pages (all logics run)
     - NEVER kill tasks/ tab (we don't run there at all)
  ========================================================= */
  const TASKS_SLASH = "https://worker.mturk.com/tasks/";
  const TASKS_NOSLASH = "https://worker.mturk.com/tasks"; // treated like other pages
  if (location.href === TASKS_SLASH) return;

  const RETRY_INTERVAL_MS = 1200;
  const ATTEMPT_THROTTLE_MS = 8000;

  let lastAttempt = 0;
  let intervalId = null;
  let observer = null;

  function now() { return Date.now(); }

  /* =========================================================
     0) GLOBAL MAX 3 "OTHER" TABS (everything except tasks/)
        + CLOSE DUPLICATE SAME REQUESTER/PROJECT
     - tasks/ is excluded because script doesn't run there.
     - tasks (no slash) IS INCLUDED in counting and logic.
  ========================================================= */
  (function AB2softTabControl() {
    const MAX_TABS = 3;                              // ✅ max tabs total (excluding tasks/ only)
    const TRACK_KEY = "AB2_TAB_TRACKER_V2";          // global registry for this script
    const OWNER_PREFIX = "AB2_OWNER_SIG:";           // per requester/project owner lock
    const HEARTBEAT_MS = 2000;
    const STALE_MS = 9000;

    const tabId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

    function safeJSONParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }
    function readTracker() { return safeJSONParse(localStorage.getItem(TRACK_KEY) || "{}") || {}; }
    function writeTracker(m) { try { localStorage.setItem(TRACK_KEY, JSON.stringify(m)); } catch (_) {} }
    function isAlive(t) { return (now() - Number(t || 0)) < STALE_MS; }

     function cleanupStale(tr) {
      const out = tr || {};
      const t = now();
      for (const [id, rec] of Object.entries(out)) {
        if (!rec || !rec.t || (t - rec.t > STALE_MS)) delete out[id];
      }
      return out;
    }

    function quietClose(reason) {
      console.log("[AB2soft] close/disarm:", reason, location.href);
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

    // ----- signature detection for "same requester/project"
    function signatureFromUrl() {
      try {
        const u = new URL(location.href);

        // /projects/<PROJECT_ID>/...
        const pm = u.pathname.match(/\/projects\/([^/]+)/i);
        if (pm && pm[1]) return `project:${pm[1]}`;

        // requesterId in params
        const sp = u.searchParams;
        const rid =
          sp.get("requesterId") || sp.get("requester_id") || sp.get("reqId") ||
          sp.get("requester");
        if (rid) return `requester:${rid}`;

        // requesterId pattern anywhere in URL
        const rm = u.href.match(/A[0-9A-Z]{12,15}/);
        if (rm && rm[0]) return `requester:${rm[0]}`;

        return null;
      } catch (_) { return null; }
    }

    function signatureFromDom() {
      try {
        const a = document.querySelector('a[href*="/projects/"]');
        if (a) {
          const href = a.getAttribute("href") || "";
          const m = href.match(/\/projects\/([^/]+)/i);
          if (m && m[1]) return `project:${m[1]}`;
        }

        const nodes = Array.from(document.querySelectorAll("[data-react-props]"));
        for (const n of nodes) {
          const p = (n.getAttribute("data-react-props") || "");
          if (p.length < 10) continue;

          const pm = p.match(/\/projects\/([^/"]+)/i);
          if (pm && pm[1]) return `project:${pm[1]}`;

          const rm = p.match(/requester(?:Id|_id)"\s*:\s*"([^"]+)"/i);
          if (rm && rm[1]) return `requester:${rm[1]}`;
        }

        const body = (document.body && document.body.innerText) ? document.body.innerText : "";
        const m2 = body.match(/A[0-9A-Z]{12,15}/);
        if (m2 && m2[0]) return `requester:${m2[0]}`;

        return null;
      } catch (_) { return null; }
    }

    // 1) Register this tab (counts tasks (no slash) too)
    let tr = cleanupStale(readTracker());
    tr[tabId] = { url: location.href, t: now() };
    writeTracker(tr);

    // 2) Enforce MAX_TABS: newest tab closes itself
    tr = cleanupStale(readTracker());
    const count = Object.keys(tr).length;
    if (count > MAX_TABS) {
      quietClose(`max-tabs-exceeded count=${count} max=${MAX_TABS}`);
      return;
    }

    // 3) Dedupe same requester/project: newest tab closes itself
    function tryDedupe() {
      const sig = signatureFromUrl() || signatureFromDom();
      if (!sig) return false;

      const ownerKey = OWNER_PREFIX + sig;
      const curOwner = safeJSONParse(localStorage.getItem(ownerKey) || "null");
      if (curOwner && curOwner.id && curOwner.id !== tabId && isAlive(curOwner.t)) {
        quietClose(`duplicate-same-sig sig=${sig} owner=${curOwner.id}`);
        return true;
      }

      // claim ownership
      try { localStorage.setItem(ownerKey, JSON.stringify({ id: tabId, t: now(), url: location.href })); } catch (_) {}
      return true;
    }

    tryDedupe();
    const start = now();
    const sigIv = setInterval(() => {
      if (tryDedupe()) { clearInterval(sigIv); return; }
      if (now() - start > 2500) clearInterval(sigIv);
    }, 200);

    // 4) Heartbeat + cleanup
    const hb = setInterval(() => {
      let t2 = cleanupStale(readTracker());
      if (!t2[tabId]) t2[tabId] = { url: location.href, t: now() };
      t2[tabId].t = now();
      t2[tabId].url = location.href;
      writeTracker(t2);

      // refresh owner only if we can quickly detect a sig from URL
      const sig = signatureFromUrl();
      if (sig) {
        const ownerKey = OWNER_PREFIX + sig;
        const cur = safeJSONParse(localStorage.getItem(ownerKey) || "null");
        if (cur && cur.id === tabId) {
          try { localStorage.setItem(ownerKey, JSON.stringify({ id: tabId, t: now(), url: location.href })); } catch (_) {}
        }
      }
    }, HEARTBEAT_MS);

    window.addEventListener("beforeunload", () => {
      try { clearInterval(hb); } catch (_) {}
      try { clearInterval(sigIv); } catch (_) {}

      try {
        let t3 = cleanupStale(readTracker());
        delete t3[tabId];
        writeTracker(t3);
      } catch (_) {}
    });
  })();

  /* =========================================================
     1) GLOBAL CLOSE WATCHER (submit/unavailable signals)
  ========================================================= */
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
        ) return true;
      }
      return false;
    };

    const tryClose = () => {
      if (shouldCloseNow()) {
        console.log("[MTurk AutoClose] detected submit/unavailable - closing tab...");
        try { window.close(); } catch (_) {}
        setTimeout(() => { try { location.replace("about:blank"); } catch (_) {} }, 400);
      }
    };

    tryClose();
    const mo = new MutationObserver(tryClose);
    if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const iv = setInterval(tryClose, 1200);

    setTimeout(() => {
      try { mo.disconnect(); } catch (_) {}
      clearInterval(iv);
    }, 30000);
  }
  setupGlobalCloseWatcher();

  /* =========================================================
     2) AUTO CLOSE “NO MORE HITs AVAILABLE” PAGE
  ========================================================= */
  function hasNoMoreHitsSignal() {
    const bodyText = ((document.body && document.body.innerText) || "").toLowerCase();
    if (bodyText.includes("there are no more of these hits available") || bodyText.includes("browse all available hits")) return true;

    const alertNodes = Array.from(document.querySelectorAll('div[data-react-class*="alert/Alert"]'));
    for (const node of alertNodes) {
      const txt = (node.textContent || "").toLowerCase();
      const props = (node.getAttribute("data-react-props") || "").toLowerCase();
      if (
        txt.includes("there are no more of these hits available") ||
        props.includes("there are no more of these hits available") ||
        (props.includes("browse") && props.includes("all available hits"))
      ) return true;
    }
    return false;
  }

  function AB2softAutoCloseEmptyHit() {
    const checkInterval = setInterval(() => {
      if (hasNoMoreHitsSignal()) {
        console.log("🚫 No more HITs available — closing tab...");
        clearInterval(checkInterval);
        try { window.close(); } catch (_) {}
        setTimeout(() => { try { location.replace("about:blank"); } catch (_) {} }, 400);
      }
    }, 1000);
    setTimeout(() => clearInterval(checkInterval), 20000);
  }
  AB2softAutoCloseEmptyHit();

  /* =========================================================
     3) COOKIE GUARD (prevents cookie-too-large loops)
  ========================================================= */
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
      const beforeHeaderBytes = (document.cookie || "").length;
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

      const afterHeaderBytes = (document.cookie || "").length;
      console.log("[AB2softCookieGuard]", { reason, aggressive, beforeCount: before.length, afterCount: current.length, beforeHeaderBytes, afterHeaderBytes, removed });
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

  /* =========================================================
     4) CAPTCHA / ERROR AUTO CONTINUE (only on /errors pages)
  ========================================================= */
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
        if (resp.status === 302 || resp.status === 200) return true;
      } else {
        const resp = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          body: new URLSearchParams(data)
        });
        if (resp.status === 302 || resp.status === 200) return true;
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

    if (btn) {
      try { synthClick(btn); } catch (_) {}
    }

    if (form) {
      try {
        try { form.submit(); return; } catch (_) {}
        const ok = await fetchSubmitForm(form);
        if (ok) return;
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

  /* =========================================================
     5) AUTO FIX 400 / 404 → redirect to /tasks/
     (This runs on all pages except /tasks/ itself)
  ========================================================= */
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
        if (sessionStorage.getItem(key) === location.href) return;
        sessionStorage.setItem(key, location.href);
      } catch (_) {}

      console.log("[AB2softAutoFix404] Redirecting to queue due to:", reason);
      if (!sameNormalizedUrl(location.href, TASKS_SLASH)) {
        location.assign(TASKS_SLASH);
      }
    }

    if (!isWorker) return;

    if (isCookieTooLarge) {
      AB2softCookieGuard({ aggressive: true, reason: "cookie-too-large-400" });
      setTimeout(() => redirectToQueueOnce("cookie-too-large"), 900);
      return;
    }

    if (looks404) {
      if (/\/projects\/|\/tasks\/|\/errors\//.test(location.pathname)) {
        redirectToQueueOnce("mturk-404");
      }
    }
  }
  setTimeout(AB2softAutoFix404, 1200);

  /* =========================================================
     6) AUTO CLOSE TAB WHEN “HIT SUBMITTED” (extra safety)
  ========================================================= */
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
        try { window.close(); } catch (_) {}
        setTimeout(() => { try { location.replace("about:blank"); } catch (_) {} }, 400);
      }
    }

    const ob = new MutationObserver(closeIfSubmitted);
    if (document.body) ob.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('load', closeIfSubmitted);
  }
  setupAutoCloseOnSubmit();

  console.log("✅ AB2soft MTurk SUBS loaded (SKIP only tasks/ | tasks allowed | Max3 tabs | Same requester dedupe | CookieGuard | AutoFix404 | AutoClose)");
})();
