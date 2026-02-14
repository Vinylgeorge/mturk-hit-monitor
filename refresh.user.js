// ==UserScript==
// @name         AB2soft - MTurk Errors
// @namespace    ab2soft.mturk
// @version      10
// @match        https://worker.mturk.com/errors/*
// @match        https://www.mturk.com/errors/*
// @match        https://*.mturk.com/errors/*
// @match        https://*.amazon.com/errors/*
// @match        https://worker.mturk.com/*
// @match        https://www.mturk.com/*
// @match        https://*.mturk.com/*
// @match        https://opfcaptcha.amazon.com/*
// @match        https://*.amazon.com/*
// ==UserScript==



(function () {
  'use strict';

  const RETRY_INTERVAL_MS = 1000;
  const ATTEMPT_THROTTLE_MS = 4000;

  let lastAttempt = 0;
  let intervalId = null;
  let observer = null;

  function now() { return Date.now(); }

  /* --------------------------------------------------
     Detect error / server busy page
  -------------------------------------------------- */
  function isErrorLikePage() {
    if (location.pathname.includes('/errors')) return true;

    if (document.querySelector(
      'form[action*="/errors/validateCaptcha"], input[name="amzn"]'
    )) return true;

    const t = (document.body?.innerText || "").toLowerCase();
    if (t.includes("server busy") && t.includes("continue shopping"))
      return true;

    return false;
  }

  /* --------------------------------------------------
     Build validateCaptcha redirect URL
  -------------------------------------------------- */
  function buildValidateUrl(form) {
    if (!form) return null;

    const action = form.getAttribute('action') || '/errors/validateCaptcha';
    const url = new URL(action, location.origin);

    const amzn  = form.querySelector('input[name="amzn"]')?.value;
    const amznr = form.querySelector('input[name="amzn-r"]')?.value;
    const fk    = form.querySelector('input[name="field-keywords"]')?.value;

    if (!amzn || !amznr) return null;

    url.searchParams.set('amzn', amzn);
    url.searchParams.set('amzn-r', amznr);
    if (fk) url.searchParams.set('field-keywords', fk);

    return url.toString();
  }

  function redirectOnce(url) {
    const key = "AB2_VALIDATE_LAST";

    try {
      if (sessionStorage.getItem(key) === url) return false;
      sessionStorage.setItem(key, url);
    } catch {}

    console.log("[AB2soft] Redirecting →", url);
    location.assign(url);
    return true;
  }

  function findForm() {
    return document.querySelector(
      'form[action*="/errors/validateCaptcha"]'
    );
  }

  function findButton() {
    return document.querySelector(
      'form[action*="/errors/validateCaptcha"] button[type="submit"]'
    );
  }

  /* --------------------------------------------------
     Main attempt logic
  -------------------------------------------------- */
  function attemptOnce() {

    if (now() - lastAttempt < ATTEMPT_THROTTLE_MS) return;
    lastAttempt = now();

    const form = findForm();
    const btn  = findButton();

    if (!form && !btn) return;

    // ⭐ BEST METHOD — direct redirect
    const validateUrl = buildValidateUrl(form);
    if (validateUrl && redirectOnce(validateUrl)) return;

    // fallback submit
    try {
      if (btn) {
        btn.click();
        console.log("[AB2soft] Button clicked");
        return;
      }

      if (form) {
        form.submit();
        console.log("[AB2soft] Form submitted");
        return;
      }
    } catch (e) {
      console.log("[AB2soft] fallback failed", e);
    }
  }

  /* --------------------------------------------------
     Watch DOM changes
  -------------------------------------------------- */
  function startWatching() {

    attemptOnce();

    observer = new MutationObserver(() => attemptOnce());

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    intervalId = setInterval(() => {
      if (!isErrorLikePage()) {
        clearInterval(intervalId);
        observer.disconnect();
        return;
      }
      attemptOnce();
    }, RETRY_INTERVAL_MS);
  }

  if (isErrorLikePage()) {
    setTimeout(startWatching, 200);
  }

  console.log("✅ AB2soft AutoContinue loaded (No KeepAlive)")=
})();
