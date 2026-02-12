// ==UserScript==
// @name         MTurk Subs Loader (Protected)
// @namespace    Violentmonkey Scripts
// @version      1.1
// @description  Protected loader for mturk_subs.user.js
// @match        https://worker.mturk.com/*
// @match        https://www.mturk.com/*
// @match        https://*.mturk.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @connect      raw.githubusercontent.com
// @connect      github.com
// @connect      api.github.com
// ==/UserScript==

(async function () {
  "use strict";

  async function getWorkerId() {
    try {
      const html = document.documentElement.innerHTML;
      const patterns = [
        /"workerId"\s*:\s*"([^"]+)"/i,
        /"worker_id"\s*:\s*"([^"]+)"/i,
        /workerId=([A-Za-z0-9]+)/i,
        /worker_id=([A-Za-z0-9]+)/i
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (m && m[1]) return m[1];
      }
    } catch (_) {}
    return "UNKNOWN_WORKER";
  }

  const MASTER_KEY = "AB2soft::SubsLoader::PermanentKey";

  async function encryptToken(plain, workerId) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const base = await crypto.subtle.importKey(
      "raw",
      enc.encode(MASTER_KEY + "::" + workerId),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const aesKey = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"]
    );
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, enc.encode(plain));
    const toB64 = bytes => btoa(String.fromCharCode(...bytes));
    return { s: toB64(salt), i: toB64(iv), c: toB64(new Uint8Array(cipher)) };
  }

  async function decryptToken(payload, workerId) {
    const dec = new TextDecoder();
    const enc = new TextEncoder();
    const fromB64 = b64 => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    const base = await crypto.subtle.importKey(
      "raw",
      enc.encode(MASTER_KEY + "::" + workerId),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const aesKey = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: fromB64(payload.s), iterations: 120000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(payload.i) },
      aesKey,
      fromB64(payload.c)
    );
    return dec.decode(plain);
  }

  function xorText(text, key) {
    let out = "";
    for (let idx = 0; idx < text.length; idx++) {
      out += String.fromCharCode(text.charCodeAt(idx) ^ key.charCodeAt(idx % key.length));
    }
    return out;
  }

  function rotAlphaNum(input) {
    return input.replace(/[A-Za-z0-9]/g, ch => {
      if (ch >= "0" && ch <= "9") return String.fromCharCode((ch.charCodeAt(0) - 48 + 7) % 10 + 48);
      if (ch >= "A" && ch <= "Z") return String.fromCharCode((ch.charCodeAt(0) - 65 + 23) % 26 + 65);
      return String.fromCharCode((ch.charCodeAt(0) - 97 + 23) % 26 + 97);
    });
  }

  async function authorize() {
    const workerId = await getWorkerId();
    const authKey = "AB2_SUBS_AUTH::" + workerId;
    const saved = await GM.getValue(authKey, null);
    if (saved) {
      try {
        const value = await decryptToken(saved, workerId);
        if (value === "OK") return true;
      } catch (_) {}
    }

    const input = prompt("Enter AB2soft access code:");
    if (!input) return false;

    const k = "mK7pX2";
    const hidden = ",\t\x05 \n}_{_\x05D";
    const code1 = xorText(hidden, k);
    const code2 = rotAlphaNum("DE5SUR5357");
    if (input !== code1 && input !== code2) {
      alert("Access denied!");
      return false;
    }

    const token = await encryptToken("OK", workerId);
    await GM.setValue(authKey, token);
    return true;
  }

  function requestTextWithRetry(url, maxAttempts = 5) {
    let attempt = 0;
    return new Promise((resolve, reject) => {
      function run() {
        attempt += 1;
        GM_xmlhttpRequest({
          method: "GET",
          url,
          nocache: true,
          timeout: 20000,
          onload: function (res) {
            const retryable = res.status === 429 || res.status === 503;
            if (retryable && attempt < maxAttempts) {
              const waitMs = Math.min(1500 * Math.pow(2, attempt - 1), 12000) + Math.floor(Math.random() * 300);
              setTimeout(run, waitMs);
              return;
            }
            if (res.status === 200 && res.responseText) {
              resolve(res.responseText);
              return;
            }
            reject(new Error("HTTP " + res.status + " at " + url + " (attempt " + attempt + ")"));
          },
          onerror: function () {
            if (attempt < maxAttempts) {
              const waitMs = Math.min(1500 * Math.pow(2, attempt - 1), 12000) + Math.floor(Math.random() * 300);
              setTimeout(run, waitMs);
              return;
            }
            reject(new Error("Network error at " + url));
          },
          ontimeout: function () {
            if (attempt < maxAttempts) {
              const waitMs = Math.min(1500 * Math.pow(2, attempt - 1), 12000) + Math.floor(Math.random() * 300);
              setTimeout(run, waitMs);
              return;
            }
            reject(new Error("Timed out at " + url));
          }
        });
      }
      run();
    });
  }

  const PAYLOAD_URLS = [
    "https://aqua-theo-29.tiiny.site/protected/mturk_subs.enc.json"
  ];
  const PAYLOAD_PASS_KEY = "AB2_SUBS_PAYLOAD_PASSWORD";

  async function fetchEncryptedPayload() {
    const errors = [];
    for (const url of PAYLOAD_URLS) {
      try {
        const body = await requestTextWithRetry(url);
        const trimmed = body.trim();
        if (!trimmed || trimmed[0] === "<") {
          throw new Error("URL returned HTML, not JSON: " + url);
        }
        return JSON.parse(trimmed);
      } catch (e) {
        errors.push(e && e.message ? e.message : String(e));
      }
    }
    throw new Error(errors.join(" | "));
  }

  function b64ToBytes(b64) {
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function joinBytes(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  async function decryptEncPayload(payload, password) {
    if (!payload || payload.alg !== "AES-256-GCM" || payload.kdf !== "PBKDF2-SHA256") {
      throw new Error("Invalid payload format.");
    }
    const iter = Number(payload.iter || 120000);
    const salt = b64ToBytes(payload.salt);
    const iv = b64ToBytes(payload.iv);
    const tag = b64ToBytes(payload.tag);
    const data = b64ToBytes(payload.data);
    const cipherWithTag = joinBytes(data, tag);

    const baseKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const aesKey = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      aesKey,
      cipherWithTag
    );
    return new TextDecoder().decode(plainBuf);
  }

  async function getPayloadPassword() {
    const cached = await GM.getValue(PAYLOAD_PASS_KEY, "");
    if (cached) return cached;
    const input = prompt("Enter mturk_subs.enc.json password:");
    if (!input) throw new Error("No decryption password entered.");
    await GM.setValue(PAYLOAD_PASS_KEY, input);
    return input;
  }

  try {
    const ok = await authorize();
    if (!ok) return;
    const payload = await fetchEncryptedPayload();
    let password = await getPayloadPassword();
    let sourceCode;
    try {
      sourceCode = await decryptEncPayload(payload, password);
    } catch (_) {
      await GM.setValue(PAYLOAD_PASS_KEY, "");
      password = prompt("Wrong password. Re-enter mturk_subs.enc.json password:");
      if (!password) throw new Error("No decryption password entered.");
      await GM.setValue(PAYLOAD_PASS_KEY, password);
      sourceCode = await decryptEncPayload(payload, password);
    }
    eval(sourceCode);
  } catch (e) {
    alert("MTurk Subs Loader error: " + (e && e.message ? e.message : e));
  }
})();
