// ==UserScript==
// @name         AB2soft Auto-Submit (Only MLDataGatherer)
// @namespace    Violentmonkey Scripts
// @version      2.0
// @description  Auto-submits MTurk HITs only if requester is MLDataGatherer
// @match        https://worker.mturk.com/projects/*/tasks/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  console.log("⚙️ AB2soft Auto-Submit script started...");

  const TARGET_REQUESTER = "MLDataGatherer"; // ✅ Only this requester will be processed

  // Function to extract requester name
  function getRequesterName() {
    const link = document.querySelector("a[href*='/requesters/']");
    if (!link) return null;
    return link.textContent.trim();
  }

  // Function to auto-submit
  function trySubmit() {
    const submitBtn = document.querySelector("button[type='submit'], input[type='submit']");
    const form = document.querySelector("form[action*='/submit']");

    if (submitBtn) {
      console.log("✅ Found submit button — clicking...");
      submitBtn.click();
      clearInterval(submitCheck);
    } else if (form) {
      console.log("✅ Found form — submitting...");
      form.submit();
      clearInterval(submitCheck);
    }
  }

  // Step 1: Wait until requester name appears
  const requesterCheck = setInterval(() => {
    const name = getRequesterName();
    if (name) {
      console.log("🧩 Requester detected:", name);
      clearInterval(requesterCheck);

      // Step 2: Process only if it matches MLDataGatherer
      if (name === TARGET_REQUESTER) {
        console.log(`✅ Requester matched (${TARGET_REQUESTER}) — starting auto-submit`);
        const submitCheck = setInterval(trySubmit, 1000);
        setTimeout(() => clearInterval(submitCheck), 45000);
      } else {
        console.log(`⛔ Requester '${name}' does not match target '${TARGET_REQUESTER}' — ignoring.`);
      }
    }
  }, 1000);

  // Safety stop after 15s if requester never detected
  setTimeout(() => clearInterval(requesterCheck), 15000);
})();
