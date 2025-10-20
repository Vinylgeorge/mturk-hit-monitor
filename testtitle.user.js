// ==UserScript==
// @name         the taskTitle submited
// @namespace    Violentmonkey Scripts
// @version      1.0
// @description  the taskTitle
// @match        https://worker.mturk.com/projects/*/tasks/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  console.log("⚙️ AB2soft Auto-Submit (Redux) active...");

  function waitForStore() {
    if (typeof window.require === "function" && typeof window.store !== "undefined") {
      try {
        const actions = window.require("actions/assignedTaskActions");
        const publish = actions.updateAssignedTaskSubmitForm;

        if (typeof publish === "function") {
          console.log("✅ Dispatching internal submit action...");
          window.store.dispatch(publish({
            action: window.location.pathname + "/submit",
            method: "POST",
            newTab: false
          }));

          // Then trigger actual submission
          const submitBtn = document.querySelector('button[type="submit"], input[type="submit"]');
          if (submitBtn) {
            console.log("✅ Clicking submit button...");
            submitBtn.click();
          } else {
            console.warn("⚠️ Submit button not found — fallback: submit any form");
            const form = document.querySelector('form[action*="/submit"]');
            if (form) form.submit();
          }
          clearInterval(checkInterval);
        }
      } catch (e) {
        console.error("❌ Error during dispatch:", e);
      }
    }
  }

  const checkInterval = setInterval(waitForStore, 1000);
  setTimeout(() => clearInterval(checkInterval), 30000);
})();
