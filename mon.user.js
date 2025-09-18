// ==UserScript==
// @name        MTurk Queue 
// @version      1.0
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/tasks
// @grant       GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/mturk-hit-monitor/refs/heads/main/mon.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/mturk-hit-monitor/refs/heads/main/mon.user.js

// ==/UserScript==

(function() {
  'use strict';
 function schedulePageReload() {
    // random between 40 and 130 seconds
    const min = 10, max = 20;
    const delay = Math.floor(Math.random() * (max - min + 1) + min) * 1000;

    console.log(`[AutoRefresh] Page will reload in ${delay / 1000}s`);

    setTimeout(() => {
      location.reload();
    }, delay);
  }

  // start the first timer
  schedulePageReload();
  // 🔧 CONFIG
  const BIN_ID = "68cb027aae596e708ff224df";   // your Bin ID
  const API_KEY = "$2a$10$5Xu0r2zBDI4WoeenpLIlV.7L5UO/QpjY4mgnUPNreMOt6AydK.gZG"; // your API key
  const BIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;
  const REFRESH_INTERVAL_MS = 10000;

  // Decode HTML entities
  function decodeEntities(str) {
    const txt = document.createElement("textarea");
    txt.innerHTML = str;
    return txt.value;
  }

  // Save queue (overwrite each time)
  function saveQueueToJsonBin(queue) {
    GM_xmlhttpRequest({
      method: "PUT",
      url: BIN_URL,
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": API_KEY
      },
      data: JSON.stringify({ record: queue }),
      onload: r => console.log("[MTurk→JSONBin] ✅ Queue saved:", queue),
      onerror: e => console.error("[MTurk→JSONBin] ❌ Error saving queue:", e)
    });
  }

  // Extract queue from React props
  function scrapeQueue() {
    const el = document.querySelector("[data-react-class*='TaskQueueTable']");
    if (!el) return;

    try {
      const props = JSON.parse(decodeEntities(el.getAttribute("data-react-props")));
      const queue = (props.bodyData || []).map(hit => ({
        assignmentId: hit.assignment_id,
        hitId: hit.task_id,
        workerId: hit.question.value.match(/workerId=([^&]+)/)?.[1] || "",
        requester: hit.project?.requester_name || "Unknown",
        title: hit.project?.title || "N/A",
        reward: hit.project?.monetary_reward?.amount_in_dollars || 0,
        timeRemainingSeconds: hit.time_to_deadline_in_seconds,
        acceptedAt: hit.accepted_at,
        deadline: hit.deadline,
        url: decodeEntities(hit.question.value)
      }));

      console.log("[MTurk→JSONBin] Scraped queue", queue);
      saveQueueToJsonBin(queue);

    } catch (err) {
      console.error("[MTurk→JSONBin] ❌ Failed to scrape:", err);
    }
  }

  // Run every 10s
  setInterval(scrapeQueue, REFRESH_INTERVAL_MS);
  scrapeQueue();

})();
