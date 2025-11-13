// ==UserScript==
// @name         AB2soft MTurk Auto Random + AutoSubmit
// @namespace    AB2soft
// @version      1.0
// @description  Automatically fills random answers and submits the HIT
// @author       AB2soft
// @match        https://worker.mturk.com/projects/*/tasks/*
// @match        https://worker.mturk.com/*task*
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    console.log("AB2soft Auto-Random + Auto-Submit Loaded");

    // Pick 1 random item from list
    function randomPick(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    // Random filling function
    function fillRandomInside(doc) {
        if (!doc) return;

        // ---- Random Radio Buttons ----
        let radios = doc.querySelectorAll("input[type='radio']");
        if (radios.length > 0) {
            let pick = randomPick([...radios]);
            pick.checked = true;
            pick.click();
            console.log("AB2soft → Random radio selected");
        }

        // ---- Random Checkboxes ----
        let checks = doc.querySelectorAll("input[type='checkbox']");
        if (checks.length > 0) {
            // Pick random number of checkboxes
            let count = Math.floor(Math.random() * checks.length);
            for (let i = 0; i < count; i++) {
                let c = randomPick([...checks]);
                c.checked = true;
                c.click();
            }
            console.log("AB2soft → Random checkboxes selected (" + count + ")");
        }

        // ---- Random Dropdown ----
        let selects = doc.querySelectorAll("select");
        selects.forEach(sel => {
            if (sel.options.length > 1) {
                let idx = Math.floor(Math.random() * sel.options.length);
                sel.selectedIndex = idx;
                sel.dispatchEvent(new Event("change"));
                console.log("AB2soft → Random dropdown index " + idx);
            }
        });

        // ---- Random Text Inputs ----
        let inputs = doc.querySelectorAll("input[type='text']");
        inputs.forEach(inp => {
            inp.value = "ok";
            inp.dispatchEvent(new Event("input"));
        });

        // ---- Random Textareas ----
        let texts = doc.querySelectorAll("textarea");
        texts.forEach(t => {
            t.value = "done";
            t.dispatchEvent(new Event("input"));
        });
    }

    // Auto-submit process
    function trySubmit() {
        console.log("AB2soft → Filling random answers…");

        // Fill main doc
        fillRandomInside(document);

        // Fill iframe doc if exists
        let iframe = document.querySelector("iframe");
        if (iframe && iframe.contentDocument) {
            fillRandomInside(iframe.contentDocument);

            // Try submit inside iframe
            let btn2 = iframe.contentDocument.querySelector("button[type='submit'], input[type='submit']");
            if (btn2) {
                console.log("AB2soft → Submit clicked (iframe)");
                btn2.click();
                return;
            }
        }

        // Try submit on main doc
        let btn1 = document.querySelector("button[type='submit'], input[type='submit']");
        if (btn1) {
            console.log("AB2soft → Submit clicked (main)");
            btn1.click();
            return;
        }

        console.log("AB2soft → Waiting for submit button…");
        setTimeout(trySubmit, 700); // keep retrying
    }

    // Start when page is loaded
    window.addEventListener("load", () => {
        console.log("AB2soft → HIT detected. Starting automation…");
        setTimeout(trySubmit, 1500);
    });

})();
