// ==UserScript==
// @name         Smart Auto Payment Scheduler
// @namespace    Violentmonkey Scripts
// @version      2.4
// @description  Automatically change MTurk payment schedule based on date & earnings; allows manual override via keyboard (1→3d, 2→7d, 3→14d, 4→30d)
// @match        https://worker.mturk.com/payment_schedule*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  const page = location.pathname;
  const today = new Date();
  const date = today.getDate();
  const earnings = parseFloat(localStorage.getItem("mturk_current_earnings") || "10");
  const log = (msg) => console.log(`[AB2soft] ${msg}`);

  // --------------------------
  // PAGE 1: /payment_schedule
  // --------------------------
  if (page === "/payment_schedule") {
    console.clear();
    log(`📅 Date: ${date}, 💵 Earnings: $${earnings}`);

    setTimeout(() => {
      const bankOpt = document.querySelector("#GDS");
      const giftOpt = document.querySelector("#GCSharp");
      const updateBtn = document.querySelector("input[type='submit'][value='Update']");
      const radios = document.querySelectorAll("input[name='disbursement_schedule_form[frequency]']");
      if (!bankOpt || !giftOpt || !updateBtn || !radios.length) {
        log("⚠️ Missing expected form elements!");
        return;
      }

      // --- Prefer bank ---
      const hasBank = !!document.querySelector("a[href*='/direct_deposit']");
      if (hasBank) {
        bankOpt.checked = true;
        bankOpt.dispatchEvent(new Event("change", { bubbles: true }));
        log("🏦 Bank account selected");
      } else {
        giftOpt.checked = true;
        giftOpt.dispatchEvent(new Event("change", { bubbles: true }));
        log("🎁 Gift card selected");
      }

      const current = Array.from(radios).find(r => r.checked)?.value;
      let newValue = null;

      // --------------------------
      // Rule A: Date 1–17 and earnings < 20
      // --------------------------
      if (date >= 1 && date <= 17 && earnings < 20) {
        newValue = "14";
        log("📆 Rule A → Setting 14-day transfer (early period, low earnings)");
      }

      // --------------------------
      // Rule B: Earnings >= 20
      // --------------------------
      else if (earnings >= 20) {
        if (current === "3") {
          log("✅ Already 3-day cycle (no change).");
        } else {
          newValue = "3";
          log("💰 Rule B → Setting 3-day transfer (high earnings)");
        }
      }

      // --------------------------
      // Rule C: Other dates (>17) and earnings < 20
      // --------------------------
      else if (date > 17 && earnings < 20) {
        log("⌨️ Rule C → Manual mode active: Press 1→3d, 2→7d, 3→14d, 4→30d");

        document.addEventListener("keydown", (e) => {
          const keyMap = { "1": "3", "2": "7", "3": "14", "4": "30" };
          if (keyMap[e.key]) {
            newValue = keyMap[e.key];
            const target = Array.from(radios).find(r => r.value === newValue);
            if (target) {
              target.checked = true;
              target.dispatchEvent(new Event("change", { bubbles: true }));
              log(`🎯 Manual override → ${newValue}-day transfer selected`);
              setTimeout(() => {
                const form = updateBtn.closest("form");
                if (form) {
                  log("🚀 Submitting manual update …");
                  form.submit();
                }
              }, 1000);
            }
          }
        });
        return; // Wait for user input
      }

      // --------------------------
      // Apply the detected rule (if any)
      // --------------------------
      if (newValue && newValue !== current) {
        const target = Array.from(radios).find(r => r.value === newValue);
        if (target) {
          target.checked = true;
          target.dispatchEvent(new Event("change", { bubbles: true }));
          log(`✅ Frequency set → ${newValue} days`);
          const form = updateBtn.closest("form");
          if (form) {
            setTimeout(() => {
              log(`🚀 Submitting update (${newValue}-day)`);
              form.submit();
            }, 1500);
          }
        }
      } else {
        log("✅ No change needed.");
      }
    }, 1500);
  }

  // --------------------------
  // PAGE 2: /payment_schedule/submit
  // --------------------------
  else if (page === "/payment_schedule/submit") {
    setTimeout(() => {
      const confirmBtn = document.querySelector("a.btn.btn-primary[href*='/payment_schedule/confirm']");
      if (confirmBtn) {
        log("🔘 Clicking Confirm …");
        confirmBtn.click();
      } else {
        log("⚠️ Confirm button not found.");
      }
    }, 2000);
  }

  // --------------------------
  // PAGE 3: /payment_schedule/confirm
  // --------------------------
  else if (page.startsWith("/payment_schedule/confirm")) {
    log("🎉 Payment schedule confirmed successfully!");
  }
})();
