// ==UserScript==
// @name        MTurk Queue → JSONBin (Save Only, /tasks)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/tasks
// @grant       GM_xmlhttpRequest
// ==/UserScript==

(function() {
  'use strict';

  const binId = "68c89a4fd0ea881f407f25c0";   // ✅ your Bin ID
  const apiKey = "$2a$10$tGWSdPOsZbt7ecxcUqPwaOPrtBrw84TrZQDZtPvWN5Hpm595sHtUm"; // ✅ your API key
  const putUrl = `https://api.jsonbin.io/v3/b/${binId}`;

  // Decode HTML entities (fix &amp; → &)
  function decodeEntities(str) {
    const txt = document.createElement("textarea");
    txt.innerHTML = str;
    return txt.value;
  }

  // Save queue (overwrite each time)
  function saveQueueToJsonBin(queue) {
    GM_xmlhttpRequest({
      method: "PUT",
      url: putUrl,
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": apiKey
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
  setInterval(scrapeQueue, 10000);
  scrapeQueue();

})();
