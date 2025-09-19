// ==UserScript==
// @name        MTurk Queue 
// @version      2.0
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/tasks
// @grant       GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/mturk-hit-monitor/refs/heads/main/mon.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/mturk-hit-monitor/refs/heads/main/mon.user.js

// ==/UserScript==
(function() {
  'use strict';

  const BIN_ID = "68cb027aae596e708ff224df";   // your Bin ID
  const API_KEY = "$2a$10$5Xu0r2zBDI4WoeenpLIlV.7L5UO/QpjY4mgnUPNreMOt6AydK.gZG";
  const PUT_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

  function decodeEntities(str) {
    const txt = document.createElement("textarea");
    txt.innerHTML = str;
    return txt.value;
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

  function saveQueue(queue) {
    GM_xmlhttpRequest({
      method: "PUT",
      url: PUT_URL,
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": API_KEY
      },
      data: JSON.stringify({ record: queue }),
      onload: r => console.log("[MTurk→JSONBin] ✅ Saved:", queue.length, "rows"),
      onerror: e => console.error("[MTurk→JSONBin] ❌ Error:", e)
    });
  }

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
      console.log("[MTurk→JSONBin] Annotated queue:", annotated);
      saveQueue(annotated);

    } catch (err) {
      console.error("[MTurk→JSONBin] ❌ Scrape failed:", err);
    }
  }

  setInterval(scrapeQueue, 10000); // every 10s
  scrapeQueue();

})();
