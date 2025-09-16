// ==UserScript==
// @name        MTurk Queue Auto Refresh
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/tasks
// @match       https://*.amazon.com/errors/*
// @grant       none
// ==/UserScript==

(function() {

  // 🔸 Function: Check for HITs in queue
  function checkHits() {
    fetch("https://worker.mturk.com/tasks", {cache: "no-store"})
      .then(res => res.text())
      .then(html => {
        let parser = new DOMParser();
        let doc = parser.parseFromString(html, "text/html");

        let header = doc.querySelector("h1.m-b-0"); // Your HITs Queue (N)
        if (header) {
          let match = header.innerText.match(/\((\d+)\)/);
          if (match) {
            let count = parseInt(match[1], 10);
            console.log("HITs in queue:", count);

            if (count > 0) {
              console.log("🚨 HITs found! Refreshing...");
              location.reload();
            }
          }
        }
      })
      .catch(err => console.error("Check failed:", err));
  }

  // 🔸 Function: Handle captcha/server busy page
  function handleCaptcha() {
    let button = document.querySelector("button.a-button-text");
    if (button && button.innerText.includes("Continue")) {
      console.log("⚠️ Captcha page detected → Auto-clicking Continue...");
      button.click();
    }
  }

  // 🔹 Decide which mode based on page
  if (location.href.includes("/tasks")) {
    // We're on the queue page → run HIT checker every 3s
    setInterval(checkHits, 3000);
  } else if (location.href.include
