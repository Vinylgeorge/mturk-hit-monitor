// ==UserScript==
// @name         AB2soft MTurk Payment Cycle Manager
// @namespace    AB2soft
// @version      7.2
// @description  MTurk payment cycle manager with case-3 bounce logic, boundary reruns, forced earnings verification, and conditional set-to-3 rule
// @match        https://worker.mturk.com/earnings*
// @match        https://worker.mturk.com/payment_schedule*
// @match        https://worker.mturk.com/payment_schedule/submit*
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
    submitDelayMs: 1500,
    submitRetryDelayMs: 2200,
    maxSubmitAttempts: 2,
    confirmDelayMs: 500,
    confirmRetryDelayMs: 2200,
    maxConfirmAttempts: 2,
    afterSubmitDelayMs: 6500,

    stateKey: 'ab2soft_cycle_manager_v69_state',
    lockKey: 'ab2soft_cycle_manager_v69_lock',
    caseHistoryKey: 'ab2soft_cycle_manager_v69_case_history',
    case3BounceKey: 'ab2soft_cycle_manager_v69_case3_bounce',

    downCycleMap: {
      30: 14,
      14: 7,
      7: 3,
      3: 3
    },

    upCycleMap: {
      3: 7,
      7: 14,
      14: 30,
      30: 30
    },

    lowerCycleCandidates: {
      30: [14, 7, 3],
      14: [7, 3],
      7: [3],
      3: [3]
    }
  };

  const FACTORS = {
    LT7: 'lt7days',
    LT3: 'lt3days',
    DAY_BEFORE: 'day_before_transfer',
    BOUNDARY_ZONE: 'boundary_zone',
    CASE3_BOUNCE: 'case3_bounce'
  };

  // Case 3 removed from single-trigger set because it may need 2-step bounce: 3 -> 7 -> 3
  const SINGLE_TRIGGER_CASES = new Set([4, 5, 6]);

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
        maxWidth: '460px',
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

  function saveState(obj) {
    localStorage.setItem(CONFIG.stateKey, JSON.stringify(obj));
  }

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.stateKey) || 'null');
    } catch {
      return null;
    }
  }

  function clearState() {
    localStorage.removeItem(CONFIG.stateKey);
  }

  function loadCaseHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(CONFIG.caseHistoryKey) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.filter((v) => Number.isInteger(v));
    } catch {
      return [];
    }
  }

  function saveCaseHistory(cases) {
    localStorage.setItem(CONFIG.caseHistoryKey, JSON.stringify(cases));
  }

  function hasCaseTriggeredOnce(caseId) {
    return loadCaseHistory().includes(caseId);
  }

  function markCaseTriggeredOnce(caseId) {
    if (!SINGLE_TRIGGER_CASES.has(caseId)) return;
    const history = loadCaseHistory();
    if (history.includes(caseId)) return;
    history.push(caseId);
    saveCaseHistory(history);
    log('Case marked as triggered once:', caseId, history);
  }

  function saveTriggerLock(caseId, factorKey, transferDateYMD, earnings) {
    const state = {
      caseId,
      factorKey,
      transferDate: transferDateYMD,
      earningsAtTrigger: earnings,
      triggeredOn: todayYMD(),
      locked: true
    };
    localStorage.setItem(CONFIG.lockKey, JSON.stringify(state));
    log('Trigger lock saved:', state);
  }

  function loadTriggerLock() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.lockKey) || 'null');
    } catch {
      return null;
    }
  }

  function clearTriggerLock() {
    localStorage.removeItem(CONFIG.lockKey);
    log('Trigger lock cleared');
  }

  function saveCase3Bounce(data) {
    localStorage.setItem(CONFIG.case3BounceKey, JSON.stringify(data));
    log('Case 3 bounce saved:', data);
  }

  function loadCase3Bounce() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.case3BounceKey) || 'null');
    } catch {
      return null;
    }
  }

  function clearCase3Bounce() {
    localStorage.removeItem(CONFIG.case3BounceKey);
    log('Case 3 bounce cleared');
  }

  function getPDTDate() {
    const now = new Date();
    const pdtString = now.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles'
    });

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
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }

  function todayYMD() {
    return formatYMD(today());
  }

  function addDays(baseDate, days) {
    const d = new Date(baseDate);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d;
  }

  function daysBetween(fromDate, toDate) {
    const a = new Date(fromDate);
    const b = new Date(toDate);
    a.setHours(0, 0, 0, 0);
    b.setHours(0, 0, 0, 0);
    return Math.floor((b.getTime() - a.getTime()) / 86400000);
  }

  function parseMoney(text) {
    if (!text) return 0;
    const m = text.match(/\$([\d,]+(?:\.\d+)?)/);
    return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
  }

  function parseDate(text) {
    if (!text) return null;
    const m = text.match(/\b([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\b/);
    if (!m) return null;
    const d = new Date(m[1]);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function getBoundary5thOfNextMonth(baseDate) {
    return new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 5);
  }

  function getBoundary5thOfNextMonthFromToday() {
    return getBoundary5thOfNextMonth(today());
  }

  function daysUntilMonthlyCycleLastDate(fromDate) {
    const boundary = getBoundary5thOfNextMonth(fromDate);
    const diffMs = boundary.getTime() - fromDate.getTime();
    return Math.floor(diffMs / 86400000);
  }

  function isOneDayBeforeTransfer(transferDate) {
    return formatYMD(transferDate) === formatYMD(getTomorrowPDT());
  }

  function isTransferDateBeyondBoundary(transferDate) {
    const boundary = getBoundary5thOfNextMonthFromToday();
    return transferDate.getTime() > boundary.getTime();
  }

  function staysWithin5thOfNextMonth(transferDate, cycleDays) {
    const nextDate = addDays(transferDate, cycleDays);
    const boundary = getBoundary5thOfNextMonth(transferDate);
    return nextDate.getTime() <= boundary.getTime();
  }

  function getMaxValidLowerCycleWithinBoundary(currentCycle, transferDate) {
    const candidates = CONFIG.lowerCycleCandidates[currentCycle] || [currentCycle];
    for (const cycle of candidates) {
      if (staysWithin5thOfNextMonth(transferDate, cycle)) {
        return cycle;
      }
    }
    return null;
  }

  function shouldBlockRetrigger(lockState, current, caseId = null) {
    if (caseId != null && SINGLE_TRIGGER_CASES.has(caseId)) {
      return hasCaseTriggeredOnce(caseId);
    }

    if (caseId === 7) {
      return !isTransferDateBeyondBoundary(current.transferDate);
    }

    if (caseId === 3) {
      return false;
    }

    if (!lockState || !lockState.locked) return false;

    if (current.earnings >= 20) return false;
    if (current.isOneDayBeforeTransfer) return false;

    return lockState.factorKey === current.factorKey;
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

  function getEarnings() {
    return parseMoney(qs('.current-earnings h2')?.textContent || '');
  }

  function getTransferDate() {
    return parseDate(qs('.current-earnings strong')?.textContent || '');
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

  function confirmWithRetry(caseId, attempt = 1) {
    const clicked = clickConfirm();
    if (!clicked) {
      if (attempt === 1) {
        showBanner('Confirm button not found on submit page.', '#c62828');
      }
      return;
    }

    if (SINGLE_TRIGGER_CASES.has(caseId)) {
      markCaseTriggeredOnce(caseId);
    }

    if (attempt >= CONFIG.maxConfirmAttempts) return;

    setTimeout(() => {
      if (isSubmitPage()) {
        showBanner(`Confirm did not complete. Retrying (${attempt + 1}/${CONFIG.maxConfirmAttempts})...`, '#ef6c00');
        confirmWithRetry(caseId, attempt + 1);
      }
    }, CONFIG.confirmRetryDelayMs);
  }

  function openPaymentScheduleWithState(state, message) {
    saveState(state);
    showBanner(message, '#ef6c00');

    if (CONFIG.autoOpenPaymentSchedule) {
      setTimeout(() => {
        location.href = '/payment_schedule';
      }, CONFIG.redirectDelayMs);
    }
  }

  function buildContext(earnings, transferDate) {
    return {
      earnings,
      transferDate,
      transferDateYMD: formatYMD(transferDate),
      isOneDayBeforeTransfer: isOneDayBeforeTransfer(transferDate),
      daysToLastDate: daysUntilMonthlyCycleLastDate(today()),
      daysUntilTransfer: daysBetween(today(), transferDate)
    };
  }

  function getDecreaseOrReverseCycle(currentCycle) {
    if (currentCycle === 30) return 14;
    if (currentCycle === 14) return 7;
    if (currentCycle === 7) return 3;
    if (currentCycle === 3) return 7;
    return currentCycle;
  }

  function getIncreaseOrReverseCycle(currentCycle) {
    if (currentCycle === 3) return 7;
    if (currentCycle === 7) return 14;
    if (currentCycle === 14) return 30;
    if (currentCycle === 30) return 14;
    return currentCycle;
  }

  function getSetCycle3OrReverse(currentCycle, caseId = null) {
    if (caseId === 2) return 3;
    if (currentCycle !== 3) return 3;
    return 7;
  }

  function getBoundaryCorrectionTargetCycle(currentCycle) {
    if (currentCycle === 30) return 14;
    if (currentCycle === 14) return 7;
    if (currentCycle === 7) return 3;
    if (currentCycle === 3) return 7;
    return currentCycle;
  }

  function evaluateCaseWithLock(current) {
    const lockState = loadTriggerLock();
    const case3Bounce = loadCase3Bounce();

    if (
      case3Bounce &&
      case3Bounce.active &&
      current.earnings < 20 &&
      current.isOneDayBeforeTransfer &&
      current.daysToLastDate >= 7
    ) {
      saveTriggerLock(3, FACTORS.CASE3_BOUNCE, current.transferDateYMD, current.earnings);
      return {
        action: 'case3_bounce_back_to_3',
        caseId: 3,
        reason: 'case 3 bounce-back: returning cycle from 7 to 3'
      };
    }

    if (
      current.earnings >= 8 &&
      current.daysToLastDate > 3 &&
      isTransferDateBeyondBoundary(current.transferDate)
    ) {
      const factorKey = FACTORS.BOUNDARY_ZONE;
      if (shouldBlockRetrigger(lockState, { ...current, factorKey }, 7)) {
        return { action: 'blocked_repeat', caseId: 7, reason: 'boundary-zone correction already satisfied' };
      }
      saveTriggerLock(7, factorKey, current.transferDateYMD, current.earnings);
      return {
        action: 'reduce_cycle_to_boundary',
        caseId: 7,
        reason: 'earnings >= 8, more than 3 days remain, and transfer date is beyond the 5th boundary'
      };
    }

    if (current.earnings >= 20 && current.isOneDayBeforeTransfer) {
      clearTriggerLock();
      clearCase3Bounce();
      return { action: 'do_nothing', caseId: 1, reason: 'earnings >= 20 and one day before transfer date' };
    }

    if (current.earnings >= 20 && !current.isOneDayBeforeTransfer) {
      clearTriggerLock();
      clearCase3Bounce();
      return {
        action: 'set_cycle_3',
        caseId: 2,
        reason: 'earnings >= 20 and not one day before transfer date',
        daysUntilTransfer: current.daysUntilTransfer
      };
    }

    if (current.earnings >= 8 && current.isOneDayBeforeTransfer && current.daysToLastDate < 3) {
      const factorKey = FACTORS.LT3;
      if (shouldBlockRetrigger(lockState, { ...current, factorKey }, 5)) {
        return { action: 'blocked_repeat', caseId: 5, reason: 'case 5 already triggered once' };
      }
      markCaseTriggeredOnce(5);
      saveTriggerLock(5, factorKey, current.transferDateYMD, current.earnings);
      clearCase3Bounce();
      return { action: 'do_nothing', caseId: 5, reason: 'earnings >= 8, one day before transfer, <3 days left' };
    }

    if (current.earnings < 8 && current.isOneDayBeforeTransfer && current.daysToLastDate < 3) {
      const factorKey = FACTORS.LT3;
      if (shouldBlockRetrigger(lockState, { ...current, factorKey }, 6)) {
        return { action: 'blocked_repeat', caseId: 6, reason: 'case 6 already triggered once' };
      }
      saveTriggerLock(6, factorKey, current.transferDateYMD, current.earnings);
      clearCase3Bounce();
      return { action: 'increase_one_step', caseId: 6, reason: 'earnings < 8, one day before transfer, <3 days left' };
    }

    if (current.earnings < 20 && current.isOneDayBeforeTransfer && current.daysToLastDate >= 7) {
      const factorKey = FACTORS.DAY_BEFORE;
      if (shouldBlockRetrigger(lockState, { ...current, factorKey }, 3)) {
        return { action: 'blocked_repeat', caseId: 3, reason: 'case 3 blocked' };
      }
      saveTriggerLock(3, factorKey, current.transferDateYMD, current.earnings);
      return { action: 'decrease_one_step_then_validate_5th', caseId: 3, reason: 'earnings < 20, one day before, >=7 days left' };
    }

    if (current.earnings < 20 && !current.isOneDayBeforeTransfer && current.daysToLastDate < 7) {
      const factorKey = FACTORS.LT7;
      if (shouldBlockRetrigger(lockState, { ...current, factorKey }, 4)) {
        return { action: 'blocked_repeat', caseId: 4, reason: 'case 4 already triggered once' };
      }
      saveTriggerLock(4, factorKey, current.transferDateYMD, current.earnings);
      clearCase3Bounce();
      return {
        action: 'set_cycle_3',
        caseId: 4,
        reason: 'earnings < 20, not one day before, <7 days left',
        daysUntilTransfer: current.daysUntilTransfer
      };
    }

    clearCase3Bounce();
    return { action: 'no_match', caseId: null, reason: 'no matching condition' };
  }

  function handleEarningsPage() {
    const state = loadState();
    const earnings = getEarnings();
    const transferDate = getTransferDate();

    log('Earnings page', { state, earnings, transferDate });

    if (!transferDate) {
      showBanner('Could not detect transfer date.', '#c62828');
      clearState();
      return;
    }

    if (state && state.phase === 'verify_on_earnings') {
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
      return;
    }

    const current = buildContext(earnings, transferDate);
    const decision = evaluateCaseWithLock(current);

    log('Decision:', decision);

    if (decision.action === 'blocked_repeat') {
      showBanner(`Skipped: ${decision.reason}`, '#6c757d');
      return;
    }

    if (decision.action === 'no_match') {
      showBanner('No condition matched. No action taken.', '#6c757d');
      return;
    }

    if (decision.action === 'do_nothing') {
      showBanner(`Do nothing: ${decision.reason}`, '#2e7d32');
      return;
    }

    openPaymentScheduleWithState({
      phase: 'open_payment_schedule',
      caseId: decision.caseId,
      action: decision.action,
      reason: decision.reason,
      earnings,
      originalTransferDate: formatYMD(transferDate),
      savedOn: todayYMD(),
      mustReturnToEarnings: true,
      daysUntilTransfer: current.daysUntilTransfer
    }, `Opening payment schedule: ${decision.reason}`);
  }

  function handlePaymentSchedulePage() {
    const state = loadState();
    if (!state) {
      showBanner('No saved action. Nothing to do.', '#6c757d');
      return;
    }

    if (state.phase === 'verify_on_earnings') {
      showBanner('Verification phase active. Skipping payment schedule action.', '#6c757d');
      return;
    }

    const selectedCycle = getSelectedCycle();
    if (!selectedCycle) {
      showBanner('Could not detect selected cycle.', '#c62828');
      return;
    }

    const transferDate = state.originalTransferDate
      ? new Date(state.originalTransferDate + 'T00:00:00')
      : null;

    log('Payment schedule page', { state, selectedCycle, transferDate });

    let targetCycle = null;

    if (state.action === 'set_cycle_3') {
      if (typeof state.daysUntilTransfer === 'number' && state.daysUntilTransfer > 3) {
        targetCycle = getSetCycle3OrReverse(selectedCycle, state.caseId);
      } else {
        showBanner('Skipped forcing cycle 3 because transfer date is 3 days away or less.', '#6c757d');
        return;
      }
    } else if (state.action === 'increase_one_step') {
      targetCycle = getIncreaseOrReverseCycle(selectedCycle);
    } else if (state.action === 'case3_bounce_back_to_3') {
      targetCycle = 3;
    } else if (state.action === 'decrease_one_step_then_validate_5th') {
      if (state.caseId === 3 && selectedCycle === 3) {
        targetCycle = 7;
        saveCase3Bounce({
          active: true,
          startedOn: todayYMD(),
          originalTransferDate: state.originalTransferDate
        });
      } else {
        const proposed = getDecreaseOrReverseCycle(selectedCycle);

        if (state.earnings >= 8) {
          if (staysWithin5thOfNextMonth(transferDate, proposed)) {
            targetCycle = proposed;
          } else {
            targetCycle = getMaxValidLowerCycleWithinBoundary(selectedCycle, transferDate);
            if (targetCycle == null) {
              targetCycle = proposed;
            }
          }
        } else {
          targetCycle = proposed;
        }
      }
    } else if (state.action === 'reduce_cycle_to_boundary') {
      targetCycle = getBoundaryCorrectionTargetCycle(selectedCycle);
    }

    if (state.action === 'case3_bounce_back_to_3' && targetCycle === 3) {
      clearCase3Bounce();
    }

    if (targetCycle == null) {
      showBanner('No target cycle determined.', '#c62828');
      return;
    }

    if (targetCycle === selectedCycle) {
      showBanner(`Cycle already ${selectedCycle}. Submitting current selection...`, '#1565c0');
    } else {
      const ok = setSelectedCycle(targetCycle);
      if (!ok) {
        showBanner(`Failed to change cycle from ${selectedCycle} to ${targetCycle}.`, '#c62828');
        return;
      }
      showBanner(`Changing cycle ${selectedCycle} → ${targetCycle} and submitting...`, '#1565c0');
    }

    saveState({
      ...state,
      phase: 'submitted',
      previousCycle: selectedCycle,
      nextCycle: targetCycle,
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

    log('Submit page', state);

    saveState({
      ...state,
      phase: 'verify_on_earnings'
    });

    showBanner('Submit page reached. Clicking Confirm...', '#1565c0');
;

    setTimeout(
      () => location.assign("https://worker.mturk.com/earnings/"),
      2500
    );
  }

  function init() {
    try {
      if (isEarningsPage()) {
        handleEarningsPage();
      } else if (isPaymentSchedulePage()) {
        handlePaymentSchedulePage();
      } else if (isSubmitPage()) {
        handleSubmitPage();
      }
    } catch (err) {
      console.error('[AB2soft] Script error:', err);
      showBanner(`Script error: ${err.message}`, '#c62828');
    }
  }

  init();
})();
