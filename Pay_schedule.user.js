// ==UserScript==
// @name         AB2soft MTurk Payment Cycle Manager
// @namespace    AB2soft
// @version      5.2
// @description  Final merged logic with trigger-lock, cycle updates, bank selection, submit redirect, and earnings-page return
// @match        https://worker.mturk.com/earnings*
// @match        https://worker.mturk.com/payment_schedule*
// @match        https://worker.mturk.com/payment_schedule/submit*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    debug: true,
    autoOpenPaymentSchedule: true,
    autoClickUpdate: true,
    redirectDelayMs: 1200,
    submitDelayMs: 1500,
    afterSubmitDelayMs: 1800,

    stateKey: 'ab2soft_cycle_manager_v5_state',
    lockKey: 'ab2soft_cycle_manager_v5_lock',
    caseHistoryKey: 'ab2soft_cycle_manager_v5_case_history',

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
    DAY_BEFORE: 'day_before_transfer'
  };

  const SINGLE_TRIGGER_CASES = new Set([3, 4, 5, 6]);

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

  function formatYMD(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }

  function today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function todayYMD() {
    return formatYMD(today());
  }

  function tomorrow() {
    const d = today();
    d.setDate(d.getDate() + 1);
    return d;
  }

  function addDays(baseDate, days) {
    const d = new Date(baseDate);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d;
  }

  function sameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  function isOneDayBeforeTransfer(transferDate) {
    return formatYMD(transferDate) === formatYMD(tomorrow());
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

  // Monthly cycle boundary: 5th of next month
  function getBoundary5thOfNextMonth(baseDate) {
    return new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 5);
  }

  function daysUntilMonthlyCycleLastDate(fromDate) {
    const boundary = getBoundary5thOfNextMonth(fromDate);
    const diffMs = boundary.getTime() - fromDate.getTime();
    return Math.floor(diffMs / 86400000);
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
    if (caseId != null && SINGLE_TRIGGER_CASES.has(caseId) && hasCaseTriggeredOnce(caseId)) {
      return true;
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
      daysToLastDate: daysUntilMonthlyCycleLastDate(today())
    };
  }

  function evaluateCaseWithLock(current) {
    const lockState = loadTriggerLock();

    // 1. earnings >=20 and one day before transfer date -> do nothing
    if (current.earnings >= 20 && current.isOneDayBeforeTransfer) {
      clearTriggerLock();
      return { action: 'do_nothing', caseId: 1, reason: 'earnings >= 20 and one day before transfer date' };
    }

    // 2. earnings >=20 and not one day before transfer date -> set cycle 3
    if (current.earnings >= 20 && !current.isOneDayBeforeTransfer) {
      clearTriggerLock();
      return { action: 'set_cycle_3', caseId: 2, reason: 'earnings >= 20 and not one day before transfer date' };
    }

    // 5. earning >=8 and one day before transfer date and <3 days to last date -> do nothing
    if (current.earnings >= 8 && current.isOneDayBeforeTransfer && current.daysToLastDate < 3) {
      const factorKey = FACTORS.LT3;
      if (shouldBlockRetrigger(lockState, { ...current, factorKey }, 5)) {
        return { action: 'blocked_repeat', caseId: 5, reason: 'case 5 already triggered once' };
      }
      markCaseTriggeredOnce(5);
      saveTriggerLock(5, factorKey, current.transferDateYMD, current.earnings);
      return { action: 'do_nothing', caseId: 5, reason: 'earnings >= 8, one day before transfer, <3 days left' };
    }

    // 6. earning <8 and one day before transfer date and <3 days to last date -> increase one step
    if (current.earnings < 8 && current.isOneDayBeforeTransfer && current.daysToLastDate < 3) {
      const factorKey = FACTORS.LT3;
      if (shouldBlockRetrigger(lockState, { ...current, factorKey }, 6)) {
        return { action: 'blocked_repeat', caseId: 6, reason: 'case 6 already triggered once' };
      }
      markCaseTriggeredOnce(6);
      saveTriggerLock(6, factorKey, current.transferDateYMD, current.earnings);
      return { action: 'increase_one_step', caseId: 6, reason: 'earnings < 8, one day before transfer, <3 days left' };
    }

    // 3. earnings <20 and one day before transfer date and >=7 days left -> one step down, then validate within 5th
    if (current.earnings < 20 && current.isOneDayBeforeTransfer && current.daysToLastDate >= 7) {
      const factorKey = FACTORS.DAY_BEFORE;
      if (shouldBlockRetrigger(lockState, { ...current, factorKey }, 3)) {
        return { action: 'blocked_repeat', caseId: 3, reason: 'case 3 already triggered once' };
      }
      markCaseTriggeredOnce(3);
      saveTriggerLock(3, factorKey, current.transferDateYMD, current.earnings);
      return { action: 'decrease_one_step_then_validate_5th', caseId: 3, reason: 'earnings < 20, one day before, >=7 days left' };
    }

    // 4. earnings <20 and not one day before transfer date and <7 days left -> set cycle 3
    if (current.earnings < 20 && !current.isOneDayBeforeTransfer && current.daysToLastDate < 7) {
      const factorKey = FACTORS.LT7;
      if (shouldBlockRetrigger(lockState, { ...current, factorKey }, 4)) {
        return { action: 'blocked_repeat', caseId: 4, reason: 'case 4 already triggered once' };
      }
      markCaseTriggeredOnce(4);
      saveTriggerLock(4, factorKey, current.transferDateYMD, current.earnings);
      return { action: 'set_cycle_3', caseId: 4, reason: 'earnings < 20, not one day before, <7 days left' };
    }

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

    // Return verification after submit
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
      savedOn: todayYMD()
    }, `Opening payment schedule: ${decision.reason}`);
  }

  function handlePaymentSchedulePage() {
    const state = loadState();
    if (!state) {
      showBanner('No saved action. Nothing to do.', '#6c757d');
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
      targetCycle = 3;
    } else if (state.action === 'increase_one_step') {
      targetCycle = CONFIG.upCycleMap[selectedCycle] || selectedCycle;
    } else if (state.action === 'decrease_one_step_then_validate_5th') {
      const oneStepDown = CONFIG.downCycleMap[selectedCycle] || selectedCycle;

      if (state.earnings >= 8) {
        if (staysWithin5thOfNextMonth(transferDate, oneStepDown)) {
          targetCycle = oneStepDown;
        } else {
          targetCycle = getMaxValidLowerCycleWithinBoundary(selectedCycle, transferDate);
        }
      } else {
        targetCycle = oneStepDown;
      }
    }

    if (targetCycle == null) {
      showBanner('No target cycle determined.', '#c62828');
      return;
    }

    if (state.earnings >= 8 && !staysWithin5thOfNextMonth(transferDate, targetCycle)) {
      const corrected = getMaxValidLowerCycleWithinBoundary(selectedCycle, transferDate);
      if (corrected != null) {
        targetCycle = corrected;
      }
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
      nextCycle: targetCycle
    });

    if (CONFIG.autoClickUpdate) {
      setTimeout(() => {
        const clicked = clickUpdate();
        if (!clicked) {
          showBanner('Could not click Update.', '#c62828');
        }
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

    showBanner('Submit complete. Redirecting to earnings page...', '#2e7d32');

    saveState({
      ...state,
      phase: 'verify_on_earnings'
    });

    setTimeout(() => {
      location.href = '/earnings';
    }, CONFIG.afterSubmitDelayMs);
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
