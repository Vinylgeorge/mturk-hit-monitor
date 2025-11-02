// ==UserScript==
// @name         Smart Auto Payment Scheduler
// @namespace    Violentmonkey Scripts
// @version      2.5
// @description  Always allows manual 1–4 key override; auto-chooses cycle based on date & earnings; shows floating status banner
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

  // ---- Banner ----
  function showBanner(text, color = "#ff9800") {
    let banner = document.getElementById("ab2softBanner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "ab2softBanner";
      Object.assign(banner.style, {
        position: "fixed",
        top: "15px",
        right: "15px",
        background: color,
        color: "#fff",
        padding: "10px 16px",
        borderRadius: "8px",
        fontFamily: "Segoe UI, sans-serif",
        fontSize: "14px",
        zIndex: "999999",
        boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
        cursor: "move",
      });
      document.body.appendChild(banner);

      // make draggable
      let offsetX = 0, offsetY = 0, dragging = false;
      banner.addEventListener("mousedown", (e) => {
        dragging = true;
        offsetX = e.clientX - banner.offsetLeft;
        offsetY = e.clientY - banner.offsetTop;
      });
      document.addEventListener("mouseup", () => dragging = false);
      document.addEventListener("mousemove", (e) => {
        if (dragging) {
          banner.style.left = e.clientX - offsetX + "px";
          banner.style.top = e.clientY - offsetY + "px";
          banner.style.right = "auto";
        }
      });
    }
    banner.textContent = `⚙️ ${text}`;
    banner.style.background = color;
  }

  function hideBanner(delay = 4000) {
    const banner = document.getElementById("ab2softBanner");
    if (banner) setTimeout(() => banner.remove(), delay);
  }

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
      (hasBank ? bankOpt : giftOpt).checked = true;
      (hasBank ? bankOpt : giftOpt).dispatchEvent(new Event("change", { bubbles: true }));
      log(hasBank ? "🏦 Bank selected" : "🎁 Gift card selected");

      const current = Array.from(radios).find(r => r.checked)?.value;
      let newValue = null;

      // ---------- AUTO RULES ----------
      if (date >= 1 && date <= 17 && earnings < 20) {
        newValue = "14";
        showBanner("Auto Mode: 14-day (early, low earnings)", "#2196f3");
        log("📆 Auto: 14-day transfer");
      } else if (earnings >= 20) {
        if (current === "3") {
          showBanner("Already 3-day cycle — No change", "#4caf50");
          log("✅ Already 3-day — no change");
          return;
        } else {
          newValue = "3";
          showBanner("Auto Mode: 3-day (high earnings)", "#4caf50");
          log("💰 Auto: 3-day transfer");
        }
      } else {
        showBanner("Manual Mode Active — Press 1→3d, 2→7d, 3→14d, 4→30d", "#ff5722");
        log("⌨️ Manual: waiting for keypress (1–4)");
      }

      // ---------- MANUAL MODE ALWAYS ACTIVE ----------
      document.addEventListener("keydown", (e) => {
        const keyMap = { "1": "3", "2": "7", "3": "14", "4": "30" };
        if (keyMap[e.key]) {
          const val = keyMap[e.key];
          const target = Array.from(radios).find(r => r.value === val);
          if (target) {
            target.checked = true;
            target.dispatchEvent(new Event("change", { bubbles: true }));
            showBanner(`Manual Override → ${val}-day selected`, "#9c27b0");
            log(`🎯 Manual override → ${val}-day`);
            setTimeout(() => {
              const form = updateBtn.closest("form");
              if (form) {
                form.submit();
                hideBanner();
              }
            }, 1000);
          }
        }
      });

      // ---------- AUTO SUBMIT ----------
      if (newValue && newValue !== current) {
        const target = Array.from(radios).find(r => r.value === newValue);
        if (target) {
          target.checked = true;
          target.dispatchEvent(new Event("change", { bubbles: true }));
          log(`✅ Frequency set → ${newValue} days`);
          const form = updateBtn.closest("form");
          if (form) {
            setTimeout(() => {
              form.submit();
              hideBanner();
            }, 1500);
          }
        }
      }
    }, 1500);
  }

  // --------------------------
  // PAGE 2: /payment_schedule/submit
  // --------------------------
  else if (page === "/payment_schedule/submit") {
    showBanner("Confirming payment schedule…", "#607d8b");
    setTimeout(() => {
      const confirmBtn = document.querySelector("a.btn.btn-primary[href*='/payment_schedule/confirm']");
      if (confirmBtn) {
        confirmBtn.click();
        hideBanner();
      } else {
        log("⚠️ Confirm button not found.");
      }
    }, 2000);
  }

  // --------------------------
  // PAGE 3: /payment_schedule/confirm
  // --------------------------
  else if (page.startsWith("/payment_schedule/confirm")) {
    showBanner("✅ Payment schedule confirmed!", "#4caf50");
    hideBanner();
    log("🎉 Payment schedule confirmed successfully!");
  }
})();
