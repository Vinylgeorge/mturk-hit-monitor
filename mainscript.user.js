// ==UserScript==
// @name        MTurk Queue → JSONBin (merged workerIds)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/tasks
// @grant       GM_xmlhttpRequest
// @grant       GM_xmlhttp
// @version     1.0
// ==/UserScript==

(function() {
  'use strict';

  // ----- CONFIG -----
  const BIN_ID = "68c89a4fd0ea881f407f25c0";   // your JSONBin bin
  const API_KEY = "$2a$10$tGWSdPOsZbt7ecxcUqPwaOPrtBrw84TrZQDZtPvWN5Hpm595sHtUm"; // or ""
  const BIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;
  const UPDATE_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;
  // ------------------

  function scrapeQueue() {
    const rows = document.querySelectorAll("table tbody tr");
    const record = [];

    rows.forEach(row => {
      const requesterName = row.querySelector("td:nth-child(1)")?.innerText.trim() || "Unknown";
      const hitTitle      = row.querySelector("td:nth-child(2)")?.innerText.trim() || "Untitled";
      const rewardText    = row.querySelector("td:nth-child(3)")?.innerText.replace("$","").trim();
      const rewardValue   = parseFloat(rewardText) || 0;
      const workerId      = row.querySelector("td:nth-child(4)")?.innerText.trim() || "";
      const timeRemaining = row.querySelector("td:nth-child(5)")?.innerText.trim() || "";
      const acceptedAt    = row.querySelector("td:nth-child(6)")?.innerText.trim() || "";
      const hitUrl        = row.querySelector("td:nth-child(2) a")?.href || "#";

      // Convert "Xm Ys" to seconds
      let timeLeft = null;
      if (timeRemaining) {
        const parts = timeRemaining.split(" ");
        let m = 0, s = 0;
        if (parts[0]) m = parseInt(parts[0]) || 0;
        if (parts[1]) s = parseInt(parts[1]) || 0;
        timeLeft = m * 60 + s;
      }

      // ---- MERGE LOGIC ----
      const key = `${requesterName}|${hitTitle}|${rewardValue}|${hitUrl}`;
      let existing = record.find(r =>
        `${r.requester}|${r.title}|${r.reward}|${r.url}` === key
      );

      if (existing) {
        if (!Array.isArray(existing.workerId)) {
          existing.workerId = existing.workerId ? [existing.workerId] : [];
        }
        if (workerId && !existing.workerId.includes(workerId)) {
          existing.workerId.push(workerId);
        }
        if (acceptedAt && new Date(acceptedAt) > new Date(existing.acceptedAt || 0)) {
          existing.acceptedAt = acceptedAt;
        }
        if (timeLeft != null) {
          existing.timeRemainingSeconds = timeLeft;
        }
      } else {
        record.push({
          requester: requesterName,
          title: hitTitle,
          reward: rewardValue,
          workerId: workerId ? [workerId] : [],
          timeRemainingSeconds: timeLeft,
          acceptedAt: acceptedAt,
          url: hitUrl
        });
      }
    });

    return record;
  }

  function pushToJsonBin(record) {
    const headers = {
      "Content-Type": "application/json"
    };
    if (API_KEY) headers["X-Master-Key"] = API_KEY;

    GM_xmlhttpRequest({
      method: "PUT",
      url: UPDATE_URL,
      headers,
      data: JSON.stringify(record),
      onload: res => {
        if (res.status >= 200 && res.status < 300) {
          console.log("✅ Queue updated in JSONBin", res.responseText);
        } else {
          console.error("❌ Failed to update JSONBin", res.status, res.responseText);
        }
      },
      onerror: err => console.error("❌ Error updating JSONBin", err)
    });
  }

  function run() {
    const record = scrapeQueue();
    if (record.length > 0) {
      pushToJsonBin(record);
    } else {
      console.log("ℹ️ No hits found in queue.");
    }
  }

  // Run every 15 seconds
  setInterval(run, 15000);
  // Run once on load
  run();

})();
