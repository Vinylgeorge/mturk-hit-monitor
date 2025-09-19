// ==UserScript==
// @name         MTurk Errors — Auto Continue (robust)
// @namespace    Violentmonkey Scripts
// @version      1.2
// @match        https://worker.mturk.com/errors/*
// @match        https://www.mturk.com/errors/*
// @match        https://worker.mturk.com/*
// @match        https://www.mturk.com/*
// @match        https://*.mturk.com/errors/*
// @match        https://*.mturk.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.github.com/Vinylgeorge/mturk-hit-monitor/raw/refs/heads/main/refresh.user.js
// @downloadURL  https://raw.github.com/Vinylgeorge/mturk-hit-monitor/raw/refs/heads/main/refresh.user.js

// ==/UserScript==

(function () {
  'use strict';

  const RETRY_INTERVAL_MS = 1200;
  const ATTEMPT_THROTTLE_MS = 8000;
  let lastAttempt = 0;
  let intervalId = null;
  let observer = null;

  function now() { return Date.now(); }

  function findValidateForm() {
    // prefer explicit validateCaptcha form
    const f1 = document.querySelector('form[action*="/errors/validateCaptcha"]');
    if (f1) return f1;

    // fallback: any form that contains hidden inputs like "amzn" or "amzn-r"
    const forms = Array.from(document.querySelectorAll('form'));
    for (const f of forms) {
      const hasAmzn = !!f.querySelector('input[name="amzn"], input[name="amzn-r"], input[name="field-keywords"]');
      if (hasAmzn) return f;
    }
    return null;
  }

  function findContinueButton(form) {
    // search inside form then in document
    const candidates = Array.from((form ? form.querySelectorAll('button, input[type="submit"], a') : document.querySelectorAll('button, input[type="submit"], a')));
    for (const el of candidates) {
      const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase();
      if (!text) continue;
      if (text.includes('continue') || text.includes('continue shopping')) return el;
    }
    // try generic primary button inside Amazon UI structure
    const prim = document.querySelector('.a-button .a-button-text, .a-button-primary .a-button-text, .a-button-inner button');
    if (prim) return prim;
    return null;
  }

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
      // collect inputs
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
        // attempt POST
        const resp = await fetch(url, { method: 'POST', credentials: 'include', cache: 'no-store', body: new URLSearchParams(data) });
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

    // if form exists try native submit
    if (form) {
      try {
        // try form.submit first
        try {
          form.submit();
          console.log('[mturk-auto] form.submit() called');
          return;
        } catch (e) {
          console.warn('[mturk-auto] form.submit() error', e);
        }

        // fallback to fetch-based submit for GET forms
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
    // immediate attempt
    attemptOnce();

    // mutation observer
    try {
      observer = new MutationObserver(() => {
        attemptOnce();
      });
      observer.observe(document.documentElement || document.body, { childList: true, subtree: true, attributes: true });
    } catch (e) {
      console.warn('[mturk-auto] observer failed', e);
    }

    // interval fallback
    intervalId = setInterval(() => {
      if (!location.pathname.includes('/errors')) {
        clearInterval(intervalId);
        if (observer) try { observer.disconnect(); } catch (e) {}
        return;
      }
      attemptOnce();
    }, RETRY_INTERVAL_MS);

    // stop on unload
    window.addEventListener('beforeunload', () => {
      if (observer) try { observer.disconnect(); } catch (e) {}
      if (intervalId) clearInterval(intervalId);
    });
  }

  // Only run watcher if we are on an errors page OR if the DOM contains hints of captcha/validate form
  if (location.pathname.includes('/errors') || document.querySelector('form[action*="/errors/validateCaptcha"], input[name="amzn"], input[name="amzn-r"]')) {
    // small delay to let page scripts run
    setTimeout(() => startWatching(), 300);
  }
 const TASKS_URL = "https://worker.mturk.com/tasks";

  // store a handle to the tab
  let tabId = GM_getValue("mturkTasksTabId", null);

  // If we're on the tasks page, save this tab's id
  if (window.location.href.startsWith(TASKS_URL)) {
    // use window.name as a unique ID
    if (!window.name) {
      window.name = "mturkTasksKeeper_" + Date.now();
    }
    GM_setValue("mturkTasksTabId", window.name);
    console.log("[MTurk AutoKeeper] Registered tasks tab:", window.name);
    return; // nothing else to do if already on /tasks
  }

  // Watchdog: ensure /tasks is open
  setInterval(() => {
    const currentTabId = GM_getValue("mturkTasksTabId", null);

    // If no tasks tab recorded, open one
    if (!currentTabId) {
      GM_openInTab(TASKS_URL, { active: false, insert: true });
      console.log("[MTurk AutoKeeper] Tasks tab opened.");
    }
  }, 10000); // check every 10s
})();
