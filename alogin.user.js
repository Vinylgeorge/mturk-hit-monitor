// ==UserScript==
// @name         Auto_login
// @version      1.2
// @match        https://www.amazon.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const SID = '62';
    const USER_KEY = `login_user_${SID}`;
    const PASS_KEY = `login_pass_${SID}`;

    function askAndStoreCredentialsIfMissing() {
        let username = localStorage.getItem(USER_KEY);
        let password = localStorage.getItem(PASS_KEY);

        if (username && password) {
            return { username, password };
        }

        username = prompt(
            'Enter Amazon username/email (saved for future auto login):',
            username || ''
        );

        if (!username) {
            console.log('Username not provided. Auto login skipped.');
            return null;
        }

        password = prompt('Enter Amazon password (saved for future auto login):', '');
        if (!password) {
            console.log('Password not provided. Auto login skipped.');
            return null;
        }

        username = username.trim();
        localStorage.setItem(USER_KEY, username);
        localStorage.setItem(PASS_KEY, password);
        console.log(`Credentials saved for SID ${SID}.`);

        return { username, password };
    }

    function typeLikeHuman(element, text, baseDelay = 200) {
        return new Promise((resolve) => {
            element.focus();
            element.value = '';
            let index = 0;

            function step() {
                if (index < text.length) {
                    element.value += text.charAt(index);
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                    element.dispatchEvent(new Event('keyup', { bubbles: true }));
                    index++;
                    setTimeout(step, baseDelay + Math.random() * 100);
                } else {
                    element.dispatchEvent(new Event('change', { bubbles: true }));
                    resolve();
                }
            }

            step();
        });
    }

    async function runAutoLogin() {
        const credentials = askAndStoreCredentialsIfMissing();
        if (!credentials) return;

        const emailInput = document.querySelector('input[type="email"], input[name="email"], #ap_email');
        const passwordInput = document.querySelector('input[type="password"], #ap_password');

        if (emailInput && !document.querySelector('input[type="password"]')) {
            console.log('Typing email...');
            await typeLikeHuman(emailInput, credentials.username, 250);
            setTimeout(() => {
                const continueBtn = document.querySelector('#continue, input[id="continue"], input[type="submit"]');
                if (continueBtn) {
                    console.log('Clicking Continue');
                    continueBtn.click();
                }
            }, 1000);
            return;
        }

        if (passwordInput && !emailInput) {
            console.log('Typing password...');
            await typeLikeHuman(passwordInput, credentials.password, 300);
            setTimeout(() => {
                const signInBtn = document.querySelector('#signInSubmit, input[id="signInSubmit"], input[type="submit"]');
                if (signInBtn) {
                    console.log('Clicking Sign In');
                    signInBtn.click();
                }
            }, 1200);
            return;
        }

        if (emailInput && passwordInput) {
            console.log('Single-step login...');
            await typeLikeHuman(emailInput, credentials.username, 250);
            await new Promise((r) => setTimeout(r, 800));
            await typeLikeHuman(passwordInput, credentials.password, 300);
            setTimeout(() => {
                const submitBtn = document.querySelector('input[type="submit"], button[type="submit"]');
                if (submitBtn) submitBtn.click();
            }, 1000);
        }
    }

    setTimeout(runAutoLogin, 2000);

    let lastHref = location.href;
    setInterval(() => {
        if (location.href !== lastHref) {
            lastHref = location.href;
            setTimeout(runAutoLogin, 1500);
        }
    }, 1000);
})();
