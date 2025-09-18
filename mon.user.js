// ==UserScript==
// @name        MTurk Queue 
// @version      1.4
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

  const BIN_ID = "68c89a4fd0ea881f407f25c0";   // your JSONBin Bin ID
  const API_KEY = "$2a$10$tGWSdPOsZbt7ecxcUqPwaOPrtBrw84TrZQDZtPvWN5Hpm595sHtUm";
  const BIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

  // --- Helpers ---
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
    try {
      const existing = await fetchExistingBin();
      const merged = [...existing];

      for (const row of queue) {
        // avoid duplicates by assignmentId (unique per HIT accept)
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
        onload: r => console.log("[MTurk→JSONBin] ✅ Saved merged queue:", merged.length, "rows"),
        onerror: e => console.error("[MTurk→JSONBin] ❌ Error:", e)
      });
    } catch (err) {
      console.error("[MTurk→JSONBin] ❌ Save error:", err);
    }
  }

  function annotateDuplicates(queue) {
    const groups = {};
    for (const hit of queue) {
      const key = `${hit.requester}|${hit.title}|${hit.reward}|${hit.url}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(hit);
    }
    for (const key in groups) {
      const group = groups[key];
      if (group.length > 1) {
        group[0].title = `${group[0].title} ([${group.length} times])`;
      }
    }
    return Object.values(groups).flat();
  }

  // --- Scraper ---
  function scrapeQueue() {
    const el = document.querySelector("[data-react-class*='TaskQueueTable']");
    if (!el) return;

    try {
      const props = JSON.parse(decodeEntities(el.getAttribute("data-react-props")));
      if (!props.bodyData || !Array.isArray(props.bodyData)) return;

      const queue = props.bodyData.map(hit => ({
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

      const annotated = annotateDuplicates(queue);
      console.log("[MTurk→JSONBin] Scraped queue:", annotated);
      saveQueue(annotated);

    } catch (err) {
      console.error("[MTurk→JSONBin] ❌ Scrape failed:", err);
    }
  }

  // run every 10s
  setInterval(scrapeQueue, 10000);
  scrapeQueue();
})();
