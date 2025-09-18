// ==UserScript==
// @name        MTurk Queue 
// @version      1.8
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

  // persistent memory of assignments already in JSONBin
  let knownAssignments = new Set();
  let initialized = false;

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

  async function saveQueue(newQueue) {
    const existing = await fetchExistingBin();

    // keep only active assignmentIds
    const activeIds = new Set(newQueue.map(h => h.assignmentId));
    const merged = existing.filter(r => activeIds.has(r.assignmentId));

    // add new ones
    for (const row of newQueue) {
      if (!merged.find(r => r.assignmentId === row.assignmentId)) {
        merged.push(row);
      }
    }

    GM_xmlhttpRequest({
      method: "PUT",
      url: BIN_URL,
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": API_KEY
      },
      data: JSON.stringify({ record: merged }),
      onload: r => console.log("[MTurk→JSONBin] ✅ Updated queue:", merged.length, "rows"),
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

})();
