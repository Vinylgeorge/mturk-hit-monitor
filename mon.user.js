// ==UserScript==
// @name        MTurk Queue 
// @version      1.6
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

 const BIN_ID = "68cb027aae596e708ff224df";   // your JSONBin Bin ID
  const API_KEY = "$2a$10$5Xu0r2zBDI4WoeenpLIlV.7L5UO/QpjY4mgnUPNreMOt6AydK.gZG";
  const BIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;
  const CHECK_INTERVAL_MS = 10000;

  // local cache of known assignmentIds
  let knownAssignments = new Set();

  function decodeEntities(str) {
    const txt = document.createElement("textarea");
    txt.innerHTML = str;
    return txt.value;
  }

  async function fetchExistingBin() {
    try {
      const headers = API_KEY ? { "X-Master-Key": API_KEY } : {};
      const res = await fetch(BIN_URL, { headers, cache: "no-store" });
      if (!res.ok) return [];
      const js = await res.json();
      let hits = js?.record ?? js;
      if (hits && hits.record) hits = hits.record;
      return Array.isArray(hits) ? hits : [];
    } catch (err) {
      console.error("[MTurk→JSONBin] ❌ Could not fetch existing bin:", err);
      return [];
    }
  }

  async function saveQueue(queue) {
    GM_xmlhttpRequest({
      method: "PUT",
      url: BIN_URL,
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": API_KEY
      },
      data: JSON.stringify({ record: queue }),
      onload: r => console.log("[MTurk→JSONBin] ✅ Saved queue:", queue.length, "rows"),
      onerror: e => console.error("[MTurk→JSONBin] ❌ Error:", e)
    });
  }

  function scrapeQueue() {
    const el = document.querySelector("[data-react-class*='TaskQueueTable']");
    if (!el) return [];

    try {
      const props = JSON.parse(decodeEntities(el.getAttribute("data-react-props")));
      if (!props.bodyData || !Array.isArray(props.bodyData)) return [];

      return props.bodyData.map(hit => ({
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
    } catch (err) {
      console.error("[MTurk→JSONBin] ❌ Scrape failed:", err);
      return [];
    }
  }

  async function runOnce() {
    const queue = scrapeQueue();
    if (queue.length === 0) return;

    // find new assignmentIds compared to what we already know
    const newOnes = queue.filter(hit => !knownAssignments.has(hit.assignmentId));

    if (newOnes.length > 0) {
      console.log("[MTurk→JSONBin] ✨ New work detected:", newOnes.map(h=>h.assignmentId));
      // update local cache
      queue.forEach(hit => knownAssignments.add(hit.assignmentId));

      // fetch current bin, merge, then save
      const existing = await fetchExistingBin();
      const merged = [...existing];
      for (const row of newOnes) {
        if (!merged.find(r => r.assignmentId === row.assignmentId)) {
          merged.push(row);
        }
      }
      saveQueue(merged);
    } else {
      console.log("[MTurk→JSONBin] No new work — skipping API call.");
    }
  }

  // run every 10s
  setInterval(runOnce, CHECK_INTERVAL_MS);
  runOnce();

})();
