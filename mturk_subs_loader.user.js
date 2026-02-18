// ==UserScript==
// @name         MTurk SUBS2 
// @namespace    Violentmonkey Scripts
// @version      4.2
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
     YOUR RULES (updated):
     A) ONLY ONE specific tasks/ URL is allowed:
        - If another tab opens EXACT tasks/ again -> immediately change it to tasks (no slash)
          so it won't disturb the main tasks/ tab.
     B) Main tasks/ tab:
        - NOTHING else should run there (no close watcher, etc.)
        - Never kill it.
     C) All other tabs:
        - Global MAX 3 tabs total (tasks/ included in counting)
        - If overflow starts from https://worker.mturk.com/projects/, force tab #2 to https://worker.mturk.com/tasks
        - Any tab beyond 3 closes silently without disturbing kept tabs
        - If HIT expired/unavailable/submitted -> close that tab
        - Other logics run as usual (cookie guard, captcha continue on errors, autoFix 400/404)
  ========================================================= */

  const TASKS_SLASH = "https://worker.mturk.com/tasks/";
  const TASKS_NOSLASH = "https://worker.mturk.com/tasks";
  const isTasksSlash = (location.href === TASKS_SLASH);

  function now() { return Date.now(); }

  // ---------------------------------------------------------
  // A) ONLY ONE tasks/ TAB OWNER
  //    If not owner -> redirect THIS tab to tasks (no slash)
  // ---------------------------------------------------------
  (function enforceSingleTasksSlash() {
    if (!isTasksSlash) return;

    const KEY = "AB2_TASKS_SLASH_OWNER_V1";
    const STALE_MS = 12000;
    const HEARTBEAT_MS = 3000;
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

    function read() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { return null; } }
    function write() { try { localStorage.setItem(KEY, JSON.stringify({ id, t: now() })); } catch (_) {} }

    const cur = read();
    if (cur && cur.id && cur.id !== id && (now() - Number(cur.t || 0) < STALE_MS)) {
      // Another tasks/ owner exists -> convert THIS duplicate tasks/ tab to tasks (no slash)
      try { location.replace(TASKS_NOSLASH); } catch (_) {}
      return;
    }

    // Become the owner
    write();

    const hb = setInterval(() => {
      const c = read();
      if (c && c.id && c.id !== id && (now() - Number(c.t || 0) < STALE_MS)) {
        // Lost ownership to a newer tab somehow -> convert this tab to tasks (no slash)
        clearInterval(hb);
        try { location.replace(TASKS_NOSLASH); } catch (_) {}
        return;
      }
      write();
    }, HEARTBEAT_MS);

    window.addEventListener("beforeunload", () => {
      try {
        const c = read();
        if (c && c.id === id) localStorage.removeItem(KEY);
      } catch (_) {}
      try { clearInterval(hb); } catch (_) {}
    });
  })();

  // If we were a duplicate tasks/ tab, we already redirected; stop this run.
  if (isTasksSlash && location.href !== TASKS_SLASH) return;

  // ---------------------------------------------------------
  // 0) GLOBAL TAB REGISTRY (Max3 + stale cleanup)
  // ---------------------------------------------------------
  const MAX_TABS = 3;
  const TRACK_KEY = "AB2_GLOBAL_TABS_V4";
  const CMD_KEY_PREFIX = "AB2_TAB_CMD_V1_";
  const HEARTBEAT_MS = 2000;
  const STALE_MS = 12000;

  const tabId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const ownCmdKey = `${CMD_KEY_PREFIX}${tabId}`;
  let lastCmdId = "";

  function safeJSONParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }
  function readTracker() { return safeJSONParse(localStorage.getItem(TRACK_KEY) || "{}") || {}; }
  function writeTracker(m) { try { localStorage.setItem(TRACK_KEY, JSON.stringify(m)); } catch (_) {} }
  function toURL(urlLike) { try { return new URL(urlLike, location.origin); } catch (_) { return null; } }
  function isTasksSlashUrl(urlLike) {
    const u = toURL(urlLike);
    return !!u && u.origin === "https://worker.mturk.com" && u.pathname === "/tasks/";
  }
  function isTasksNoSlashUrl(urlLike) {
    const u = toURL(urlLike);
    return !!u && u.origin === "https://worker.mturk.com" && u.pathname === "/tasks";
  }
  function isProjectsUrl(urlLike) {
    const u = toURL(urlLike);
    return !!u && u.origin === "https://worker.mturk.com" && u.pathname.startsWith("/projects/");
  }
  function sortedTabs(tr) {
    return Object.entries(tr || {}).sort((a, b) => {
      const ta = Number(a[1] && (a[1].born || a[1].t || 0)) || 0;
      const tb = Number(b[1] && (b[1].born || b[1].t || 0)) || 0;
      return ta - tb;
    });
  }

  function cleanupStale(tr) {
    const out = tr || {};
    const t = now();
    for (const [id, rec] of Object.entries(out)) {
      if (!rec || !rec.t || (t - rec.t > STALE_MS)) delete out[id];
    }
    return out;
  }

  function silentClose(reason) {
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

  function sendTabCommand(targetId, action, extra = {}) {
    const cmd = { id: `${Date.now()}_${Math.random().toString(16).slice(2)}`, targetId, action, ...extra };
    if (targetId === tabId) {
      runTabCommand(cmd);
      return;
    }
    try { localStorage.setItem(`${CMD_KEY_PREFIX}${targetId}`, JSON.stringify(cmd)); } catch (_) {}
  }

  function runTabCommand(cmd) {
    if (!cmd || cmd.targetId !== tabId || !cmd.id || cmd.id === lastCmdId) return;
    lastCmdId = cmd.id;

    if (cmd.action === "redirect_tasks_noslash") {
      if (!isTasksSlashUrl(location.href) && !isTasksNoSlashUrl(location.href)) {
        try { location.replace(TASKS_NOSLASH); } catch (_) {}
      }
      return;
    }

    if (cmd.action === "close_silent") {
      if (!isTasksSlashUrl(location.href)) silentClose(String(cmd.reason || "remote-close"));
    }
  }

  function checkOwnCommand() {
    try {
      const cmd = safeJSONParse(localStorage.getItem(ownCmdKey) || "null");
      runTabCommand(cmd);
    } catch (_) {}
  }

  function enforceTabPolicy() {
    let state = cleanupStale(readTracker());
    const stamp = now();

    for (const rec of Object.values(state)) {
      if (!rec) continue;
      if (!rec.born) rec.born = Number(rec.t || stamp) || stamp;
    }
    writeTracker(state);

    const ordered = sortedTabs(state);
    if (ordered.length <= MAX_TABS) return;

    // If overflow is caused while on /projects/, force tab #2 to become /tasks.
    if (isProjectsUrl(location.href)) {
      const second = ordered[1];
      if (second) {
        const [sid, srec] = second;
        if (!isTasksSlashUrl(srec.url) && !isTasksNoSlashUrl(srec.url)) {
          sendTabCommand(sid, "redirect_tasks_noslash");
        }
      }
    }

    const keep = new Set();
    const main = ordered.find(([, rec]) => isTasksSlashUrl(rec.url));
    const secondTasks = ordered.find(([, rec]) => isTasksNoSlashUrl(rec.url));

    if (main) keep.add(main[0]);
    if (secondTasks) keep.add(secondTasks[0]);

    for (const [id] of ordered) {
      if (keep.size >= MAX_TABS) break;
      keep.add(id);
    }

    for (const [id] of ordered) {
      if (keep.has(id)) continue;
      if (id === tabId) {
        silentClose(`max-tabs-exceeded count=${ordered.length} max=${MAX_TABS}`);
        return;
      }
      sendTabCommand(id, "close_silent", { reason: `max-tabs-exceeded count=${ordered.length} max=${MAX_TABS}` });
    }
  }

  window.addEventListener("storage", (e) => {
    if (e.key === ownCmdKey) {
      runTabCommand(safeJSONParse(e.newValue || "null"));
    }
  });

  // Register this tab (including tasks/)
  let tr = cleanupStale(readTracker());
  tr[tabId] = {
    url: location.href,
    t: now(),
    born: now(),
    isTasksSlash: isTasksSlashUrl(location.href) ? 1 : 0,
    isTasksNoSlash: isTasksNoSlashUrl(location.href) ? 1 : 0,
    isProjects: isProjectsUrl(location.href) ? 1 : 0
  };
  writeTracker(tr);
  enforceTabPolicy();

  // Heartbeat + cleanup
  const hb = setInterval(() => {
    checkOwnCommand();
    let t2 = cleanupStale(readTracker());
    if (!t2[tabId]) {
      t2[tabId] = {
        url: location.href,
        t: now(),
        born: now(),
        isTasksSlash: isTasksSlashUrl(location.href) ? 1 : 0,
        isTasksNoSlash: isTasksNoSlashUrl(location.href) ? 1 : 0,
        isProjects: isProjectsUrl(location.href) ? 1 : 0
      };
    }
    t2[tabId].t = now();
    t2[tabId].born = Number(t2[tabId].born || t2[tabId].t || now()) || now();
    t2[tabId].url = location.href;
    t2[tabId].isTasksSlash = isTasksSlashUrl(location.href) ? 1 : 0;
    t2[tabId].isTasksNoSlash = isTasksNoSlashUrl(location.href) ? 1 : 0;
    t2[tabId].isProjects = isProjectsUrl(location.href) ? 1 : 0;
    writeTracker(t2);
    enforceTabPolicy();
  }, HEARTBEAT_MS);

  window.addEventListener("beforeunload", () => {
    try { clearInterval(hb); } catch (_) {}
    try {
      let t3 = cleanupStale(readTracker());
      delete t3[tabId];
      writeTracker(t3);
    } catch (_) {}
    try { localStorage.removeItem(ownCmdKey); } catch (_) {}
  });

  // ✅ NOTHING else should run on main tasks/ tab
  if (isTasksSlash) return;

  /* =========================================================
     2) CLOSE IF HIT EXPIRED / UNAVAILABLE / OUT OF QUEUE / SUBMITTED
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
      "this hit has expired",
      "hit has expired",
      "expired",
      "no longer available to you"
    ];
    for (const p of phrases) if (text.includes(p)) return true;

    const alertNodes = Array.from(document.querySelectorAll('div[data-react-class*="alert/Alert"]'));
    for (const node of alertNodes) {
      const props = (node.getAttribute("data-react-props") || "").toLowerCase();
      for (const p of phrases) if (props.includes(p)) return true;
    }
    return false;
  }

  function setupCloseExpiredWatcher() {
    const tryClose = () => { if (shouldCloseExpired()) silentClose("expired/unavailable/submitted"); };
    tryClose();

    const mo = new MutationObserver(tryClose);
    try { mo.observe(document.documentElement || document.body, { childList: true, subtree: true, characterData: true }); } catch (_) {}
    const iv = setInterval(tryClose, 1200);

    setTimeout(() => {
      try { mo.disconnect(); } catch (_) {}
      try { clearInterval(iv); } catch (_) {}
    }, 120000);
  }
  setupCloseExpiredWatcher();

  /* =========================================================
     3) OTHER LOGICS "AS USUAL"
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
  function sameNormalizedUrl(a, b) { return normalizeUrl(a) === normalizeUrl(b); }

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
      observer.observe(document.documentElement || document.body, { childList: true, subtree: true, attributes: true });
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

      if (!sameNormalizedUrl(location.href, TASKS_SLASH)) location.assign(TASKS_SLASH);
    }

    if (!isWorker) return;

    if (isCookieTooLarge) {
      AB2softCookieGuard({ aggressive: true, reason: "cookie-too-large-400" });
      setTimeout(() => redirectToQueueOnce(), 900);
      return;
    }

    if (looks404) {
      if (/\/projects\/|\/tasks\/|\/errors\//.test(location.pathname)) redirectToQueueOnce();
    }
  }
  setTimeout(AB2softAutoFix404, 1200);

  console.log("✅ AB2soft MTurk SUBS loaded (ONLY 1x tasks/ allowed | tasks/ protected | Max3 | expired close | idle 1min close)");
})();
