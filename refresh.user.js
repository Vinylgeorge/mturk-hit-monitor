// ==UserScript==
// @name         AB2soft - MTurk Errors Auto Continue/Captcha
// @namespace    ab2soft.mturk
// @version      1.0
// @description  On /errors pages: tries to click Continue and/or submit validateCaptcha form.
// @match        https://worker.mturk.com/errors/*
// @match        https://www.mturk.com/errors/*
// @match        https://*.mturk.com/errors/*
// @match        https://*.amazon.com/errors/*
// @grant        none
// @run-at       document-idle
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
      (form ? form.querySelectorAll('button, input[type="submit"], a')
            : document.querySelectorAll('button, input[type="submit"], a'))
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

  function synthClick(el) {
    try {
      el.focus && el.focus();
      const types = ['mouseover','pointerover','mousemove','mousedown','pointerdown','mouseup','pointerup','click'];
      for (const t of types) {
        try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch {}
      }
      try { el.click(); } catch {}
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
        return resp.status === 200 || resp.status === 302;
      } else {
        const resp = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          body: new URLSearchParams(data)
        });
        return resp.status === 200 || resp.status === 302;
      }
    } catch (e) {
      console.warn('[mturk-auto] fetchSubmitForm error', e);
      return false;
    }
  }

  async function attemptOnce() {
    if (now() - lastAttempt < ATTEMPT_THROTTLE_MS) return;
    lastAttempt = now();

    const form = findValidateForm();
    const btn = findContinueButton(form);

    if (!form && !btn) return;

    if (btn) {
      try { synthClick(btn); } catch (e) { console.warn('[mturk-auto] click error', e); }
    }

    if (form) {
      try {
        try {
          form.submit();
          return;
        } catch (e) {
          console.warn('[mturk-auto] form.submit() error', e);
        }
        await fetchSubmitForm(form);
      } catch (e) {
        console.warn('[mturk-auto] form handling error', e);
      }
    }
  }

  function startWatching() {
    attemptOnce();

    try {
      observer = new MutationObserver(() => attemptOnce());
      observer.observe(document.documentElement || document.body, { childList: true, subtree: true, attributes: true });
    } catch (e) {
      console.warn('[mturk-auto] observer failed', e);
    }

    intervalId = setInterval(() => attemptOnce(), RETRY_INTERVAL_MS);

    window.addEventListener('beforeunload', () => {
      if (observer) try { observer.disconnect(); } catch {}
      if (intervalId) clearInterval(intervalId);
    });
  }

  if (location.pathname.includes('/errors')) {
    setTimeout(startWatching, 300);
  }
})();
