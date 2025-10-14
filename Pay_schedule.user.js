// ==UserScript==
// @name         🔒 Payment Scheduler
// @namespace    ab2soft.mturk
// @version      2.3
// @description  payment schedule changer
// @match        https://worker.mturk.com/payment_schedule
// @match        https://worker.mturk.com/payment_schedule/submit*
// @match        https://worker.mturk.com/payment_schedule/confirm*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const FREQUENCIES = ["3", "7", "14", "30"];
  const STORAGE_KEY = "AB2soft_LastFrequency";

  function getNext() {
    const last = localStorage.getItem(STORAGE_KEY);
    if (!last || !FREQUENCIES.includes(last)) return "3";
    return FREQUENCIES[(FREQUENCIES.indexOf(last) + 1) % FREQUENCIES.length];
  }

  function waitFor(sel, cb, interval = 250, timeout = 10000) {
    const start = Date.now();
    const t = setInterval(() => {
      const el = document.querySelector(sel);
      if (el) { clearInterval(t); cb(el); }
      else if (Date.now() - start > timeout) clearInterval(t);
    }, interval);
  }

  function banner(msg) {
    const d = document.createElement('div');
    d.textContent = msg;
    Object.assign(d.style, {
      position: 'fixed', right: '16px', bottom: '16px',
      background: 'rgba(0,128,0,.9)', color: '#fff',
      padding: '10px 14px', borderRadius: '8px',
      fontFamily: 'system-ui,Arial', fontSize: '14px',
      zIndex: 2147483647
    });
    document.body.appendChild(d);
  }

  // --- STEP 1: Main setup page ---
  if (location.pathname === "/payment_schedule") {
    const nextFreq = getNext();
    waitFor("#GDS", () => {
      const bank = document.querySelector("#GDS");
      if (bank) bank.checked = true;

      const freq = document.querySelector(`input[name='disbursement_schedule_form[frequency]'][value='${nextFreq}']`);
      if (freq) freq.checked = true;

      localStorage.setItem(STORAGE_KEY, nextFreq);

      const updateBtn = document.querySelector("input[type='submit'][value='Update']");
      if (updateBtn) {
        setTimeout(() => {
          updateBtn.click();
        }, 800);
      }
    });
  }

  // --- STEP 2: Confirmation/submit page ---
  if (location.pathname.startsWith("/payment_schedule/submit") ||
      location.pathname.startsWith("/payment_schedule/confirm")) {

    waitFor("a.btn.btn-primary", () => {
      // find confirm link that points to /confirm
      const confirmBtn = Array.from(document.querySelectorAll("a.btn.btn-primary"))
        .find(a => /confirm/.test(a.href));
      if (confirmBtn) {
        setTimeout(() => {
          confirmBtn.click();

          setTimeout(() => window.close(), 3000);
        }, 1000);
      } else {
        console.log("[AB2soft] Confirm button not found");
      }
    });
  }
})();
