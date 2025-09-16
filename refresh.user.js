// ==UserScript==
// @name        MTurk Queue
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/tasks
// @grant       none
// ==/UserScript==

(function() {
  function checkHits() {
    fetch(window.location.href, {cache: "no-store"})
      .then(res => res.text())
      .then(html => {
        let parser = new DOMParser();
        let doc = parser.parseFromString(html, "text/html");

        let header = doc.querySelector("h1.m-b-0");
        if (header) {
          let match = header.innerText.match(/\((\d+)\)/);
          if (match) {
            let count = parseInt(match[1], 10);
            console.log("HITs in queue:", count);

            if (count > 0) {
              location.reload();
            }
          }
        }
      })
      .catch(err => console.error("Check failed:", err));
  }

  setInterval(checkHits, 3000);
})();
