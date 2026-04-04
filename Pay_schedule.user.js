// ==UserScript==
// @name         AB2soft MTurk Payment Cycle Manager
// @namespace    AB2soft
// @version      9.
// @match        https://worker.mturk.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://github.com/Vinylgeorge/mturk-hit-monitor/raw/refs/heads/main/Pay_schedule.user.js
// @downloadURL  https://github.com/Vinylgeorge/mturk-hit-monitor/raw/refs/heads/main/Pay_schedule.user.js
// ==/UserScript==



(function () {
  'use strict';

  const CONFIG = {
    debug: true,
    autoOpenPaymentSchedule: true,
    autoClickUpdate: true,
    redirectDelayMs: 1200,
    submitDelayMs: 1400,
    submitRetryDelayMs: 2200,
    maxSubmitAttempts: 2,
    confirmDelayMs: 500,
    confirmRetryDelayMs: 2200,
    maxConfirmAttempts: 2,
    afterSubmitDelayMs: 6500,
    homeRedirectDelayMs: 500,

    stateKey: 'ab2soft_dynamic_state_v93',
    workflowKey: 'ab2soft_dynamic_workflow_v93',
    slabMemoryKey: 'ab2soft_dynamic_slab_memory_v93'
  };

  const SLABS = {
    S20_PLUS: 'S20_PLUS',
    S8_TO_19: 'S8_TO_19',
    S3_TO_7: 'S3_TO_7',
    S0_TO_3: 'S0_TO_3'
  };

  const RULES = {
    R1_DO_NOTHING_20: 'R1_DO_NOTHING_20',
    R_DYNAMIC_FORCE: 'R_DYNAMIC_FORCE',
    R_DYNAMIC_DO_NOTHING: 'R_DYNAMIC_DO_NOTHING'
  };

  function log(...args) {
    if (CONFIG.debug) console.log('[AB2soft]', ...args);
  }

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function showBanner(message, color = '#1565c0') {
    const id = 'ab2soft-cycle-banner';
    let el = document.getElementById(id);

    if (!el) {
      el = document.createElement('div');
      el.id = id;
      Object.assign(el.style, {
        position: 'fixed',
        top: '16px',
        right: '16px',
        zIndex: '999999',
        maxWidth: '540px',
        padding: '12px 16px',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,.22)',
        color: '#fff',
        fontSize: '14px',
        fontWeight: '700',
        lineHeight: '1.45',
        wordBreak: 'break-word'
      });
      document.body.appendChild(el);
    }

    el.style.background = color;
    el.textContent = message;
    log(message);
  }

  function saveJSON(key, obj) {
    localStorage.setItem(key, JSON.stringify(obj));
    log('saveJSON', key, obj);
  }

  function loadJSON(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  function removeKey(key) {
    localStorage.removeItem(key);
    log('removeKey', key);
  }

  function saveState(obj) {
    saveJSON(CONFIG.stateKey, obj);
  }

  function loadState() {
    return loadJSON(CONFIG.stateKey);
  }

  function clearState() {
    removeKey(CONFIG.stateKey);
  }

  function saveWorkflow(obj) {
    saveJSON(CONFIG.workflowKey, obj);
  }

  function loadWorkflow() {
    return loadJSON(CONFIG.workflowKey);
  }

  function clearWorkflow() {
    removeKey(CONFIG.workflowKey);
  }

  function saveSlabMemory(obj) {
    saveJSON(CONFIG.slabMemoryKey, obj);
  }

  function loadSlabMemory() {
    return loadJSON(CONFIG.slabMemoryKey);
  }

  function getPDTDate() {
    const now = new Date();
    const pdtString = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    const pdt = new Date(pdtString);
    pdt.setHours(0, 0, 0, 0);
    return pdt;
  }

  function today() {
    return getPDTDate();
  }

  function getTomorrowPDT() {
    const d = getPDTDate();
    d.setDate(d.getDate() + 1);
    return d;
  }

  function formatYMD(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }

  function parseMoney(text) {
    if (!text) return 0;
    const m = text.match(/\$([\d,]+(?:\.\d+)?)/);
    return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
  }

  function parseDate(text) {
    if (!text) return null;

    const m = text.match(/\b([A-Z][a-z]{2}\s+\d{1,2}(?:,\s*\d{4})?)\b/);
    if (!m) return null;

    let raw = m[1].replace(/\s+/g, ' ').trim();
    if (!/,/.test(raw)) {
      raw = `${raw}, ${today().getFullYear()}`;
    }

    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function getBoundary5thForCurrentCycle(baseDate) {
    const d = new Date(baseDate);
    const day = d.getDate();

    if (day >= 6) {
      return new Date(d.getFullYear(), d.getMonth() + 1, 5);
    }
    return new Date(d.getFullYear(), d.getMonth(), 5);
  }

  function daysToLastDate(baseDate) {
    const boundary = getBoundary5thForCurrentCycle(baseDate);
    return Math.floor((boundary.getTime() - baseDate.getTime()) / 86400000);
  }

  function getCyclePeriodId(baseDate) {
    const d = new Date(baseDate);
    const year = d.getFullYear();
    const month = d.getMonth();
    const day = d.getDate();

    const startYear = day >= 6 ? year : (month === 0 ? year - 1 : year);
    const startMonth = day >= 6 ? month : (month === 0 ? 11 : month - 1);

    return `${startYear}-${String(startMonth + 1).padStart(2, '0')}`;
  }

  function getWindow(baseDate) {
    const day = baseDate.getDate();
    if (day >= 6 && day <= 20) return 'A';
    if (day >= 21 && day <= 26) return 'B';
    return 'C';
  }

  function getEarningSlab(earnings) {
    if (earnings >= 20) return SLABS.S20_PLUS;
    if (earnings >= 8) return SLABS.S8_TO_19;
    if (earnings > 3 && earnings <= 7.99) return SLABS.S3_TO_7;
    return SLABS.S0_TO_3;
  }

  function isOneDayBeforeTransfer(transferDate) {
    return formatYMD(transferDate) === formatYMD(getTomorrowPDT());
  }

  function isEarningsPage() {
    return location.pathname.startsWith('/earnings');
  }

  function isPaymentSchedulePage() {
    return location.pathname === '/payment_schedule' || location.pathname.startsWith('/payment_schedule?');
  }

  function isSubmitPage() {
    return location.pathname.startsWith('/payment_schedule/submit');
  }

  function isHomePage() {
    return location.pathname === '/';
  }

  function getEarnings() {
    return parseMoney(qs('.current-earnings h2')?.textContent || document.body.innerText || '');
  }

  function getTransferDate() {
    const strongText = qs('.current-earnings strong')?.textContent || '';
    const bodyText = document.body.innerText || '';
    return parseDate(strongText) || parseDate(bodyText);
  }

  function getSelectedCycle() {
    const el = qs('input[name="disbursement_schedule_form[frequency]"]:checked');
    return el ? parseInt(el.value, 10) : null;
  }

  function setSelectedCycle(days) {
    const el = qs(`input[name="disbursement_schedule_form[frequency]"][value="${days}"]`);
    if (!el) return false;

    el.checked = true;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.click();
    return true;
  }

  function selectBankAccount() {
    const bank = qs('input[name="disbursement_schedule_form[executor_type_name]"][value="GDS"]');
    if (!bank) return false;

    bank.checked = true;
    bank.dispatchEvent(new Event('input', { bubbles: true }));
    bank.dispatchEvent(new Event('change', { bubbles: true }));
    bank.click();
    return true;
  }

  function clickUpdate() {
    const bankOk = selectBankAccount();
    if (!bankOk) {
      log('Bank account option not found.');
      return false;
    }

    const btn =
      qs('form input[type="submit"][value="Update"]') ||
      qs('input[type="submit"][value="Update"]');

    if (!btn) {
      log('Update button not found.');
      return false;
    }

    btn.click();
    return true;
  }

  function submitUpdateWithRetry(attempt = 1) {
    const clicked = clickUpdate();
    if (!clicked) {
      showBanner('Could not click Update.', '#c62828');
      return;
    }

    if (attempt >= CONFIG.maxSubmitAttempts) return;

    setTimeout(() => {
      if (isPaymentSchedulePage()) {
        showBanner(`Update did not submit. Retrying (${attempt + 1}/${CONFIG.maxSubmitAttempts})...`, '#ef6c00');
        submitUpdateWithRetry(attempt + 1);
      }
    }, CONFIG.submitRetryDelayMs);
  }

  function getConfirmButton() {
    return (
      qs('a[data-method="put"][href*="/payment_schedule/confirm"]') ||
      qs('a.btn.btn-primary[href*="/payment_schedule/confirm"]') ||
      qs('a[href*="/payment_schedule/confirm"]')
    );
  }

  function clickConfirm() {
    const btn = getConfirmButton();
    if (!btn) {
      log('Confirm button not found on submit page.');
      return false;
    }
    btn.click();
    return true;
  }

  function confirmWithRetry(attempt = 1) {
    const clicked = clickConfirm();
    if (!clicked) {
      if (attempt === 1) {
        showBanner('Confirm button not found on submit page.', '#c62828');
      }
      return;
    }

    if (attempt >= CONFIG.maxConfirmAttempts) return;

    setTimeout(() => {
      if (isSubmitPage()) {
        showBanner(`Confirm did not complete. Retrying (${attempt + 1}/${CONFIG.maxConfirmAttempts})...`, '#ef6c00');
        confirmWithRetry(attempt + 1);
      }
    }, CONFIG.confirmRetryDelayMs);
  }

  function buildContext(earnings, transferDate) {
    const baseDate = today();
    return {
      today: baseDate,
      todayYMD: formatYMD(baseDate),
      earnings,
      transferDate,
      transferDateYMD: formatYMD(transferDate),
      isOneDayBeforeTransfer: isOneDayBeforeTransfer(transferDate),
      periodId: getCyclePeriodId(baseDate),
      window: getWindow(baseDate),
      slab: getEarningSlab(earnings),
      lastDate: daysToLastDate(baseDate)
    };
  }

  function completeSlabTrigger(ctx, ruleId, reason) {
    saveSlabMemory({
      periodId: ctx.periodId,
      slab: ctx.slab,
      ruleId,
      completedOn: ctx.todayYMD,
      reason
    });
    clearWorkflow();
  }

  function shouldStartNewTrigger(ctx) {
    const mem = loadSlabMemory();
    if (!mem) return true;
    if (mem.periodId !== ctx.periodId) return true;
    return mem.slab !== ctx.slab;
  }

  function startWorkflowForRule(ctx, ruleId, targetCycle, reason) {
    saveWorkflow({
      active: true,
      periodId: ctx.periodId,
      slab: ctx.slab,
      ruleId,
      targetCycle,
      step: 'START',
      createdOn: ctx.todayYMD,
      reason
    });
  }

  function evaluateCandidateCycle(ctx, cycle) {
    let score = 0;
    const reasons = [];

    if (ctx.window === 'A') {
      if (cycle === 14) {
        score += 100;
        reasons.push('window A prefers 14');
      } else if (cycle === 7) {
        score += 40;
      } else if (cycle === 3) {
        score += 20;
      }
    }

    if (ctx.window === 'B') {
      if (cycle === 7) {
        score += 100;
        reasons.push('window B prefers 7');
      } else if (cycle === 3) {
        score += 50;
      } else if (cycle === 14) {
        score += 20;
      }
    }

    if (ctx.window === 'C') {
      if (ctx.earnings <= 3) {
        if (cycle === 14) {
          score += 100;
          reasons.push('low earnings late window prefer 14');
        } else if (cycle === 7) {
          score += 50;
        } else if (cycle === 3) {
          score += 20;
        }
      } else if (ctx.earnings > 3 && ctx.earnings <= 7.99) {
        if (ctx.lastDate >= 7) {
          if (cycle === 7) {
            score += 100;
            reasons.push('mid earnings, enough days, prefer 7');
          } else if (cycle === 3) {
            score += 45;
          } else if (cycle === 14) {
            score += 20;
          }
        } else if (ctx.lastDate >= 3 && ctx.lastDate < 7) {
          if (cycle === 3) {
            score += 100;
            reasons.push('mid earnings, tighter boundary, prefer 3');
          } else if (cycle === 7) {
            score += 40;
          } else if (cycle === 14) {
            score += 10;
          }
        } else if (ctx.lastDate < 3) {
          if (cycle === 3) {
            score += 100;
            reasons.push('mid earnings, very late boundary, still prefer 3');
          } else if (cycle === 7) {
            score += 25;
          } else if (cycle === 14) {
            score += 0;
          }
        }
      } else if (ctx.earnings >= 8 && ctx.earnings < 20) {
        if (ctx.lastDate >= 3) {
          if (cycle === 3) {
            score += 100;
            reasons.push('high mid earnings late window prefer 3');
          } else if (cycle === 7) {
            score += 35;
          } else if (cycle === 14) {
            score += 10;
          }
        }
      }
    }

    return { cycle, score, reasons };
  }

  function chooseDynamicTargetCycle(ctx) {
    const candidates = [3, 7, 14];
    const ranked = candidates
      .map(cycle => evaluateCandidateCycle(ctx, cycle))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score <= 0) return null;

    return {
      targetCycle: best.cycle,
      reason: best.reasons.join(', ')
    };
  }

  function decideRule(ctx) {
    if (ctx.earnings >= 20 && ctx.isOneDayBeforeTransfer) {
      return {
        type: 'DO_NOTHING',
        ruleId: RULES.R1_DO_NOTHING_20,
        reason: 'earnings >= 20 and today is one day before transfer date'
      };
    }

    if (ctx.window === 'C' && ctx.earnings >= 8 && ctx.earnings < 20 && ctx.lastDate < 3) {
      return {
        type: 'DO_NOTHING',
        ruleId: RULES.R_DYNAMIC_DO_NOTHING,
        reason: 'window C, earnings >= 8 and < 20, lastDate < 3'
      };
    }

    const best = chooseDynamicTargetCycle(ctx);
    if (!best) {
      return { type: 'NO_ACTION', reason: 'no dynamic target found' };
    }

    return {
      type: 'TARGET_CYCLE',
      ruleId: RULES.R_DYNAMIC_FORCE,
      targetCycle: best.targetCycle,
      reason: `dynamic choice -> ${best.targetCycle} days (${best.reason})`
    };
  }

  function nextCycleTargetFromWorkflow(selectedCycle, wf) {
    const target = wf.targetCycle;

    if (target === 14) {
      if (wf.step === 'START') {
        if (selectedCycle === 14) {
          return { nextCycle: 7, nextStep: 'AFTER_INTERMEDIATE', note: 'force bounce 14 -> 7' };
        }
        return { nextCycle: 14, nextStep: 'AFTER_FINAL', note: 'set directly to 14' };
      }
      if (wf.step === 'AFTER_INTERMEDIATE') {
        return { nextCycle: 14, nextStep: 'AFTER_FINAL', note: 'bounce return 7 -> 14' };
      }
    }

    if (target === 7) {
      if (wf.step === 'START') {
        if (selectedCycle === 7) {
          return { nextCycle: 3, nextStep: 'AFTER_INTERMEDIATE', note: 'force bounce 7 -> 3' };
        }
        return { nextCycle: 7, nextStep: 'AFTER_FINAL', note: 'set directly to 7' };
      }
      if (wf.step === 'AFTER_INTERMEDIATE') {
        return { nextCycle: 7, nextStep: 'AFTER_FINAL', note: 'bounce return 3 -> 7' };
      }
    }

    if (target === 3) {
      if (wf.step === 'START') {
        if (selectedCycle === 3) {
          return { nextCycle: 7, nextStep: 'AFTER_INTERMEDIATE', note: 'force bounce 3 -> 7' };
        }
        return { nextCycle: 3, nextStep: 'AFTER_FINAL', note: 'set directly to 3' };
      }
      if (wf.step === 'AFTER_INTERMEDIATE') {
        return { nextCycle: 3, nextStep: 'AFTER_FINAL', note: 'bounce return 7 -> 3' };
      }
    }

    return null;
  }

  function handleEarningsPage() {
    const state = loadState();
    const earnings = getEarnings();
    const transferDate = getTransferDate();

    log('Earnings page', { state, earnings, transferDate });

    if (!transferDate) {
      showBanner('Could not detect transfer date.', '#c62828');
      return;
    }

    if (state && state.phase === 'VERIFY_ON_EARNINGS') {
      const newTransferDate = getTransferDate();
      const oldTransferDate = state.originalTransferDate ? new Date(state.originalTransferDate + 'T00:00:00') : null;

      if (oldTransferDate && newTransferDate && formatYMD(oldTransferDate) !== formatYMD(newTransferDate)) {
        showBanner(
          `Verified: transfer date changed from ${formatYMD(oldTransferDate)} to ${formatYMD(newTransferDate)}.`,
          '#2e7d32'
        );
      } else {
        showBanner('Returned to earnings page after submit.', '#2e7d32');
      }

      clearState();
    }

    const ctx = buildContext(earnings, transferDate);
    const wf = loadWorkflow();

    if (wf && wf.active && wf.periodId === ctx.periodId) {
      if (wf.step === 'AFTER_FINAL') {
        completeSlabTrigger(ctx, wf.ruleId, 'workflow complete');
        showBanner(`Completed workflow for slab ${ctx.slab}.`, '#2e7d32');
        return;
      }

      saveState({
        phase: 'OPEN_PAYMENT_SCHEDULE',
        workflowContinuation: true,
        originalTransferDate: ctx.transferDateYMD,
        mustReturnToEarnings: true
      });

      showBanner(`Continuing workflow: ${wf.ruleId}`, '#ef6c00');

      if (CONFIG.autoOpenPaymentSchedule) {
        setTimeout(() => {
          location.href = '/payment_schedule';
        }, CONFIG.redirectDelayMs);
      }
      return;
    }

    if (!shouldStartNewTrigger(ctx)) {
      showBanner(`No action: slab ${ctx.slab} already handled for current cycle period.`, '#6c757d');
      return;
    }

    const decision = decideRule(ctx);

    if (decision.type === 'NO_ACTION') {
      showBanner('No condition matched. No action taken.', '#6c757d');
      return;
    }

    if (decision.type === 'DO_NOTHING') {
      completeSlabTrigger(ctx, decision.ruleId, decision.reason);
      showBanner(`Do nothing: ${decision.reason}`, '#2e7d32');
      return;
    }

    if (decision.type === 'TARGET_CYCLE') {
      startWorkflowForRule(ctx, decision.ruleId, decision.targetCycle, decision.reason);

      saveState({
        phase: 'OPEN_PAYMENT_SCHEDULE',
        workflowContinuation: false,
        originalTransferDate: ctx.transferDateYMD,
        mustReturnToEarnings: true
      });

      showBanner(`Opening payment schedule: ${decision.reason}`, '#ef6c00');

      if (CONFIG.autoOpenPaymentSchedule) {
        setTimeout(() => {
          location.href = '/payment_schedule';
        }, CONFIG.redirectDelayMs);
      }
    }
  }

  function handlePaymentSchedulePage() {
    const state = loadState();
    const wf = loadWorkflow();

    if (!state || !wf || !wf.active) {
      showBanner('No active workflow. Nothing to do.', '#6c757d');
      return;
    }

    const selectedCycle = getSelectedCycle();
    if (!selectedCycle) {
      showBanner('Could not detect selected cycle.', '#c62828');
      return;
    }

    const move = nextCycleTargetFromWorkflow(selectedCycle, wf);
    if (!move) {
      showBanner('Could not determine next workflow cycle step.', '#c62828');
      return;
    }

    log('Workflow move', { selectedCycle, wf, move });

    if (move.nextCycle === selectedCycle) {
      wf.step = 'AFTER_FINAL';
      saveWorkflow(wf);
      showBanner(`Cycle already ${selectedCycle}. Returning to earnings...`, '#2e7d32');
      saveState({
        ...state,
        phase: 'VERIFY_ON_EARNINGS',
        mustReturnToEarnings: true
      });
      setTimeout(() => {
        location.href = '/earnings';
      }, CONFIG.homeRedirectDelayMs);
      return;
    }

    const ok = setSelectedCycle(move.nextCycle);
    if (!ok) {
      showBanner(`Failed to change cycle from ${selectedCycle} to ${move.nextCycle}.`, '#c62828');
      return;
    }

    wf.step = move.nextStep;
    wf.lastMove = {
      from: selectedCycle,
      to: move.nextCycle,
      note: move.note,
      on: formatYMD(today())
    };
    saveWorkflow(wf);

    showBanner(`Changing cycle ${selectedCycle} → ${move.nextCycle} and submitting...`, '#1565c0');

    saveState({
      ...state,
      phase: 'SUBMITTED',
      previousCycle: selectedCycle,
      nextCycle: move.nextCycle,
      mustReturnToEarnings: true
    });

    if (CONFIG.autoClickUpdate) {
      setTimeout(() => {
        submitUpdateWithRetry(1);
      }, CONFIG.submitDelayMs);
    }
  }

  function handleSubmitPage() {
    const state = loadState();
    if (!state) {
      showBanner('Submit page reached, but no saved state found.', '#6c757d');
      return;
    }

    saveState({
      ...state,
      phase: 'VERIFY_ON_EARNINGS',
      mustReturnToEarnings: true
    });

    showBanner('Submit page reached. Clicking Confirm...', '#1565c0');

    setTimeout(() => {
      confirmWithRetry(1);
    }, CONFIG.confirmDelayMs);

    setTimeout(() => {
      showBanner('Redirecting to earnings for verification...', '#1565c0');
      location.href = '/earnings';
    }, CONFIG.afterSubmitDelayMs);
  }

  function handleHomePage() {
    const state = loadState();
    log('Home page reached', state);

    if (!state) return;

    if (
      state.phase === 'SUBMITTED' ||
      state.phase === 'VERIFY_ON_EARNINGS' ||
      state.mustReturnToEarnings
    ) {
      showBanner('Home page reached after submit. Redirecting to earnings...', '#1565c0');
      setTimeout(() => {
        location.href = '/earnings';
      }, CONFIG.homeRedirectDelayMs);
    }
  }

  function init() {
    try {
      if (isEarningsPage()) {
        handleEarningsPage();
      } else if (isPaymentSchedulePage()) {
        handlePaymentSchedulePage();
      } else if (isSubmitPage()) {
        handleSubmitPage();
      } else if (isHomePage()) {
        handleHomePage();
      }
    } catch (err) {
      console.error('[AB2soft] Script error:', err);
      showBanner(`Script error: ${err.message}`, '#c62828');
    }
  }

  init();
})();
