// ==UserScript==
// @name         AB2soft MTurk Smart Transfer Cycle Manager
// @namespace    AB2soft
// @version      4.0
// @match        https://worker.mturk.com/earnings*
// @match        https://worker.mturk.com/payment_schedule*
// @match        https://worker.mturk.com/payment_schedule/submit*
// @match        https://worker.mturk.com/payment_schedule/confirm*

// @grant        none
// @updateURL    https://github.com/Vinylgeorge/mturk-hit-monitor/raw/refs/heads/main/Pay_schedule.user.js
// @downloadURL  https://github.com/Vinylgeorge/mturk-hit-monitor/raw/refs/heads/main/Pay_schedule.user.js

// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    debug: true,
    autoClickUpdate: true,
    autoClickConfirm: true,
    returnToEarningsDelay: 2000,

    cycleMap: {
      3: 7,
      7: 14,
      14: 30,
      30: 14
    },

    fallbackMap: {
      30: [14, 7, 3],
      14: [7, 3],
      7: [3],
      3: []
    }
  };

  function log(...args) {
    if (CONFIG.debug) console.log('[AB2soft]', ...args);
  }

  function qs(s) {
    return document.querySelector(s);
  }

  function formatYMD(d) {
    return d.toISOString().slice(0, 10);
  }

  function tomorrow() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(0,0,0,0);
    return d;
  }

  function parseMoney(t) {
    const m = t.match(/\$([\d.]+)/);
    return m ? parseFloat(m[1]) : 0;
  }

  function parseDate(t) {
    const m = t.match(/\b([A-Z][a-z]{2} \d{1,2}, \d{4})\b/);
    return m ? new Date(m[1]) : null;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function sameMonth(a, b) {
    return a.getMonth() === b.getMonth();
  }

  function isTomorrow(date) {
    return formatYMD(date) === formatYMD(tomorrow());
  }

  function getEarnings() {
    return parseMoney(qs('.current-earnings h2')?.textContent || '');
  }

  function getTransferDate() {
    return parseDate(qs('.current-earnings strong')?.textContent || '');
  }

  function getCycle() {
    return parseInt(qs('input[name="disbursement_schedule_form[frequency]"]:checked')?.value);
  }

  function setCycle(v) {
    const el = qs(`input[value="${v}"]`);
    if (!el) return false;
    el.click();
    return true;
  }

  function selectBank() {
    const el = qs('input[value="GDS"]');
    if (el) el.click();
  }

  function clickUpdate() {
    selectBank();
    const btn = qs('input[value="Update"]');
    if (btn) btn.click();
  }

  function clickConfirm() {
    const btn = qs("a[href*='confirm']");
    if (btn) btn.click();
  }

  function isLastCycle(date, cycle) {
    return !sameMonth(addDays(date, cycle), date);
  }

  function fallbackCycle(cycle, date) {
    const list = CONFIG.fallbackMap[cycle] || [];
    for (let c of list) {
      if (sameMonth(addDays(date, c), date)) return c;
    }
    return null;
  }

  // ------------------ Earnings Page ------------------
  if (location.pathname.startsWith('/earnings')) {

    const earnings = getEarnings();
    const date = getTransferDate();

    log("Earnings:", earnings, "Date:", date);

    if (!date || !isTomorrow(date)) {
      log("Skip - not tomorrow");
      return;
    }

    if (earnings >= 20) {
      log("No change needed");
      return;
    }

    localStorage.setItem("ab2_run", JSON.stringify({
      earnings,
      date: formatYMD(date)
    }));

    setTimeout(() => {
      location.href = "/payment_schedule";
    }, 1000);
  }

  // ------------------ Payment Page ------------------
  if (location.pathname === "/payment_schedule") {

    const data = JSON.parse(localStorage.getItem("ab2_run") || "{}");
    if (!data.date) return;

    const earnings = data.earnings;
    const transferDate = new Date(data.date);
    const cycle = getCycle();

    const last = isLastCycle(transferDate, cycle);

    log("Cycle:", cycle, "Last:", last);

    if (earnings >= 8 && last) {
      log("Allow transfer");
      return;
    }

    if (earnings < 20 && !last) {
      const next = CONFIG.cycleMap[cycle];
      setCycle(next);
      clickUpdate();
      return;
    }

    if (earnings < 8 && last) {
      const fb = fallbackCycle(cycle, transferDate);
      if (fb) {
        setCycle(fb);
        clickUpdate();
      }
      return;
    }
  }

  // ------------------ Submit Page ------------------
  if (location.pathname.startsWith("/payment_schedule/submit")) {
    setTimeout(clickConfirm, 1500);
  }

  // ------------------ Confirm Page ------------------
// ------------------ Submit Page ------------------
if (location.pathname.startsWith("/payment_schedule/submit")) {
  log("✅ Update submitted successfully");

  setTimeout(() => {
    location.href = "/earnings";
  }, 2000);
}

})();
