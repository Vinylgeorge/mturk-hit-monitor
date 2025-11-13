// ==UserScript==
// @name         AB2soft – FULL Auto HIT Loop (Random → Submit → Accept Next)
// @namespace    ab2soft.mturk
// @version      3.0
// @description  Auto-random answer inside SageMaker iframe, auto-submit, then auto-accept Next HIT.
// @match        https://bxcb.public-workforce.us-west-2.sagemaker.aws/work*
// @match        https://*.sagemaker.aws/work*
// @match        https://worker.mturk.com/tasks/*
// @match        https://worker.mturk.com/projects/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /********************************************************************
   *  PART 1 — INSIDE IFRAME: RANDOM ANSWERS + AUTO SUBMIT
   ********************************************************************/
  if (location.href.includes("sagemaker.aws/work")) {

    const params = new URLSearchParams(window.location.search);
    const assignmentId = params.get('assignmentId');

    if (!assignmentId || assignmentId === 'ASSIGNMENT_ID_NOT_AVAILABLE') {
      console.log("[AB2soft] Preview detected – stopping.");
      return;
    }

    function rand(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    const wait = ms => new Promise(r => setTimeout(r, ms));

    function randomizeRadios() {
      const radios = [...document.querySelectorAll('input[type="radio"]')]
        .filter(r => !r.disabled);

      const groups = new Map();
      radios.forEach(r => {
        const name = r.name || "__ab2";
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(r);
      });

      groups.forEach(group => {
        const pick = group[rand(0, group.length - 1)];
        pick.click();
      });
    }

    function randomizeSelects() {
      const selects = [...document.querySelectorAll("select")];
      selects.forEach(sel => {
        const opts = [...sel.options].filter(o => o.value && !o.disabled);
        if (opts.length === 0) return;
        const pick = opts[rand(0, opts.length - 1)];
        sel.value = pick.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    function findSubmit() {
      const btns = [...document.querySelectorAll("button,input[type=submit],input[type=button]")];
      const keys = ["submit", "done", "finish", "continue", "next", "complete"];
      for (const b of btns) {
        const txt = (b.textContent || b.value || "").toLowerCase();
        if (keys.some(k => txt.includes(k))) return b;
      }
      return btns.pop();
    }

    async function run() {
      console.log("[AB2soft] Starting automation inside iframe…");

      await wait(rand(2000, 5000));
      randomizeRadios();
      randomizeSelects();

      await wait(rand(1000, 3000));
      const btn = findSubmit();
      if (btn) {
        console.log("[AB2soft] Clicking SUBMIT…");
        btn.click();
      }
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
      run();
    } else {
      window.addEventListener("DOMContentLoaded", run);
    }

    // Backup in case UI loads late
    setTimeout(run, 8000);
  }

  /********************************************************************
   *  PART 2 — OUTSIDE IFRAME: AUTO ACCEPT NEXT HIT 
   ********************************************************************/
  if (location.href.includes("worker.mturk.com")) {

    const wait = ms => new Promise(r => setTimeout(r, ms));

    async function autoAcceptNext() {

      // 1. Look for "Accept & Work" button
      let acceptBtn = document.querySelector("button[type='submit'].btn-primary, button.btn-accept, form[action*='accept'] button");
      if (!acceptBtn) {
        // Check MTurk's confirmation pages
        acceptBtn = [...document.querySelectorAll("button, a")].find(b =>
          (b.textContent || "").toLowerCase().includes("accept")
        );
      }

      if (acceptBtn) {
        console.log("[AB2soft] Accept button detected. Auto-clicking…");
        await wait(1500);
        acceptBtn.click();
        return;
      }

      // 2. If already working, MTurk will redirect automatically
      console.log("[AB2soft] No Accept button found (maybe already inside HIT).");

    }

    // Run after MTurk auto-redirects post-submit
    setTimeout(autoAcceptNext, 2000);
  }

})();
