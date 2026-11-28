/* TSG BIOM v86 — OVERNIGHT PHASE 3: LOYALTY SYSTEM (Phase A
   Step 8.1 app-side half, CD-5 ratified model).

   What v86 builds, WITHOUT the Chairman's unmade D3 decisions
   (point BDT value, expiry, tiers, merchant funding rate,
   per-day visit cap — invented NOWHERE in this build):
   1. An append-only loyalty EVENT LEDGER on the person record;
      the balance is computed from the events by one shared rule
      (B.loyaltyBalance); person.loyaltyPoints is a cached
      display value recomputed on every append.
   2. The v86 migration (the release's ONE shape change): a
      person with loyaltyPoints > 0 and no events gains exactly
      ONE deterministic opening-balance event; everyone and
      everything else is byte-identical.
   3. ONE config object (LOYALTY_CONFIG) holding the shipped
      earn parameters + the streak milestone; offers ship EMPTY.
   4. A Palm Loyalty statement surface on My Account (balance,
      recent events, streak + freeze, offers empty state) and
      the Desk card reworded to factual mechanics — no surface
      quotes a point value or an expiry, because none is set.
   5. Weekly streaks computed from earn events, with the
      earnable streak freeze (max one held, auto-consumed on one
      missed week, never sold). NO milestone bonus points.
   The v59 D6 ordering is FROZEN behaviour: points are credited
   only where they are credited today — after a verified visit
   scan and after a payment record exists; refused/failed
   payments earn nothing (mirrored below for all four sites). */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const bioSrc = fs.readFileSync(path.join(__dirname, '..', 'biometrics.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function sliceBetween(src, a, b) {
  const i = src.indexOf(a); if (i === -1) return '';
  const j = src.indexOf(b, i + a.length); if (j === -1) return '';
  return src.slice(i, j);
}
const WEEK = 604800000;
const NOW = 200 * WEEK + 3 * 86400000; // inside week 200

/* ---------------- version coherence ---------------- */
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v91',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v91' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v91'") !== -1 &&
  htmlSrc.indexOf('<meta name="biom-build" content="v91">') !== -1 &&
  htmlSrc.indexOf('TSG Biom · App v91 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v91' &&
  B.BIOM_DATA_VERSIONS.length === 55);

/* ---------------- ledger: balance is computed ---------------- */
check('LEDGER balance is the signed sum over events (earn +, redeem -, adjust signed)',
  B.loyaltyBalance([
    { type: 'earn', points: 5 }, { type: 'earn', points: 12 },
    { type: 'redeem', points: 3 }, { type: 'adjust', points: -2 }, { type: 'adjust', points: 4 }
  ]) === 16 &&
  B.loyaltyBalance([]) === 0 && B.loyaltyBalance(null) === 0 &&
  B.loyaltyBalance([{ type: 'earn', points: 'x' }, null, { type: 'earn', points: 7 }]) === 7);
check('LEDGER append recomputes the cache from the events on every append',
  (function () {
    const p = { id: 'TSG-BIO-9', loyaltyPoints: 999 }; // stale cache on purpose
    const e1 = B.loyaltyAppendEvent(p, { eventId: 'a', biomId: p.id, type: 'earn', points: 5, reason: 'visit', ts: 1 });
    if (!e1 || p.loyaltyPoints !== 5) return false;
    B.loyaltyAppendEvent(p, { eventId: 'b', biomId: p.id, type: 'earn', points: 10, reason: 'payment', refIntentId: 'BIOM-PAY-1', ts: 2 });
    if (p.loyaltyPoints !== 15 || p.loyaltyEvents.length !== 2) return false;
    if (p.loyaltyEvents[1].refIntentId !== 'BIOM-PAY-1') return false;
    B.loyaltyAppendEvent(p, { eventId: 'c', biomId: p.id, type: 'redeem', points: 4, reason: 'adjust', ts: 3 });
    return p.loyaltyPoints === 11 && p.loyaltyEvents.length === 3;
  })());
check('LEDGER append-only: appending never edits or deletes an existing event',
  (function () {
    const p = { id: 'TSG-BIO-9', loyaltyPoints: 0 };
    B.loyaltyAppendEvent(p, { eventId: 'a', biomId: p.id, type: 'earn', points: 5, reason: 'visit', ts: 1 });
    const before = JSON.stringify(p.loyaltyEvents);
    B.loyaltyAppendEvent(p, { eventId: 'b', biomId: p.id, type: 'adjust', points: -5, reason: 'adjust', ts: 2 });
    return JSON.stringify(p.loyaltyEvents.slice(0, 1)) === before && p.loyaltyEvents.length === 2 && p.loyaltyPoints === 0;
  })());
check('LEDGER malformed events are refused (no entry, no cache movement)',
  (function () {
    const p = { id: 'TSG-BIO-9', loyaltyPoints: 3 };
    return B.loyaltyAppendEvent(p, { type: 'gift', points: 5 }) === null &&
      B.loyaltyAppendEvent(p, { type: 'earn', points: 'x' }) === null &&
      B.loyaltyAppendEvent(p, null) === null &&
      p.loyaltyPoints === 3 && !Array.isArray(p.loyaltyEvents);
  })());
check('LEDGER no app code path edits or deletes a loyalty event (push-only writes)',
  appSrc.indexOf('loyaltyEvents.splice') === -1 && appSrc.indexOf('loyaltyEvents.pop') === -1 &&
  appSrc.indexOf('loyaltyEvents.shift') === -1 && bioSrc.indexOf('loyaltyEvents.splice') === -1 &&
  (bioSrc.match(/loyaltyEvents\.push/g) || []).length === 1 &&
  appSrc.indexOf('.loyaltyEvents =') === -1 && bioSrc.indexOf('np.loyaltyEvents = [loyaltyOpeningEvent(p)]') !== -1);
check('LEDGER events carry no palm data (shape is id/type/points/reason/refs/ts only)',
  (function () {
    const p = { id: 'TSG-BIO-9', loyaltyPoints: 0 };
    const ev = B.loyaltyAppendEvent(p, { eventId: 'a', biomId: p.id, type: 'earn', points: 5, reason: 'visit', scanRef: 'scan-x', ts: 1, palmProfile: 'MUST-NOT-CARRY', codes: [1, 2] });
    const keys = Object.keys(ev).sort().join(',');
    return keys === 'biomId,eventId,points,reason,scanRef,ts,type';
  })());

/* ---------------- migration: the one shape change ---------------- */
function fixture() {
  return {
    people: [
      { id: 'TSG-BIO-1', name: 'Rich', loyaltyPoints: 137, enrolledAt: 111, wallet: { balance: 5, statement: [{ note: 'x', amount: 5 }], linkedAccounts: [] }, palmProfile: { codes: ['AA'] } },
      { id: 'TSG-BIO-2', name: 'Zero', loyaltyPoints: 0, enrolledAt: 222, wallet: { balance: 0, statement: [], linkedAccounts: [] } },
      { id: 'TSG-BIO-3', name: 'Absent', enrolledAt: 333, wallet: { balance: 0, statement: [], linkedAccounts: [] } },
      { id: 'TSG-BIO-4', name: 'HasEvents', loyaltyPoints: 20, loyaltyEvents: [{ eventId: 'e1', biomId: 'TSG-BIO-4', type: 'earn', points: 20, reason: 'visit', ts: 5 }], wallet: { balance: 0, statement: [], linkedAccounts: [] } }
    ],
    logs: [{ id: 'L1', kind: 'scan' }],
    transactions: [{ id: 'T1', amount: 50 }],
    meta: [{ key: 'sync', v: 1 }]
  };
}
check('MIGRATION v86 writes exactly ONE opening event, only for a positive balance with no events',
  (function () {
    const mig = B.migrateBiomData(fixture(), 'v85', 'v86');
    if (mig.appliedSteps.join(',') !== 'v86') return false;
    const p1 = mig.snapshot.people[0];
    if (!Array.isArray(p1.loyaltyEvents) || p1.loyaltyEvents.length !== 1) return false;
    const ev = p1.loyaltyEvents[0];
    if (ev.type !== 'earn' || ev.reason !== 'opening' || ev.points !== 137 || ev.biomId !== 'TSG-BIO-1') return false;
    if (ev.eventId !== 'loy-opening-TSG-BIO-1' || ev.ts !== 111) return false;
    return !('loyaltyEvents' in mig.snapshot.people[1]) && !('loyaltyEvents' in mig.snapshot.people[2]) &&
      mig.snapshot.people[3].loyaltyEvents.length === 1 && mig.snapshot.people[3].loyaltyEvents[0].eventId === 'e1';
  })());
check('MIGRATION opening event is written exactly once (re-running the step changes nothing)',
  (function () {
    const once = B.migrateBiomData(fixture(), 'v85', 'v86').snapshot;
    const twice = B.migrateBiomData(JSON.parse(JSON.stringify(once)), 'v85', 'v86');
    return twice.changed === false && JSON.stringify(twice.snapshot) === JSON.stringify(once) &&
      twice.snapshot.people[0].loyaltyEvents.length === 1;
  })());
check('MIGRATION banks/wallets/statements/transactions/logs/meta are byte-identical apart from the ledger addition',
  (function () {
    const f = fixture();
    const mig = B.migrateBiomData(f, 'v85', 'v86');
    const strip = function (snap) {
      const c = JSON.parse(JSON.stringify(snap));
      c.people.forEach(function (p) { delete p.loyaltyEvents; });
      return JSON.stringify(c);
    };
    return strip(mig.snapshot) === strip(f) && mig.snapshot.people[0].loyaltyPoints === 137 &&
      B.loyaltyBalance(mig.snapshot.people[0].loyaltyEvents) === 137;
  })());
check('MIGRATION a store with no positive balances opens byte-identical at v86',
  (function () {
    const f = fixture();
    f.people[0].loyaltyPoints = 0; f.people[3].loyaltyPoints = 0;
    const before = JSON.stringify(f);
    const mig = B.migrateBiomData(JSON.parse(before), 'v85', 'v86');
    return mig.changed === false && JSON.stringify(mig.snapshot) === before;
  })());

/* ---------------- config: one object, shipped values ---------------- */
check('CONFIG LOYALTY_CONFIG holds the shipped earn parameters and the streak milestone; offers ship EMPTY',
  appSrc.indexOf('var LOYALTY_CONFIG = {') !== -1 &&
  /visitPoints: 5/.test(sliceBetween(appSrc, 'var LOYALTY_CONFIG = {', '};')) &&
  /paymentEarnDivisor: 10/.test(sliceBetween(appSrc, 'var LOYALTY_CONFIG = {', '};')) &&
  /streakMilestoneWeeks: 4/.test(sliceBetween(appSrc, 'var LOYALTY_CONFIG = {', '};')) &&
  /offers: \[\]/.test(sliceBetween(appSrc, 'var LOYALTY_CONFIG = {', '};')));
check('CONFIG the config comment records the D3 line (value/expiry/tiers/funding/cap absent by design)',
  sliceBetween(appSrc, 'Palm Loyalty (v86)', 'var LOYALTY_CONFIG').indexOf('ABSENT BY DESIGN') !== -1);
check('CONFIG no loyalty number is hard-coded at an earn call site (divisor and visit points come from the config)',
  appSrc.indexOf('Math.floor(tx.amount / 10)') === -1 &&
  appSrc.indexOf('Math.floor(executedAmount / 10)') === -1 &&
  appSrc.indexOf('loyaltyPoints || 0) + 5') === -1 &&
  (appSrc.match(/Math\.floor\([a-zA-Z.]+ \/ LOYALTY_CONFIG\.paymentEarnDivisor\)/g) || []).length === 3 &&
  appSrc.indexOf("loyaltyEarn(person, LOYALTY_CONFIG.visitPoints, 'visit'") !== -1);

/* ---------------- the earn path: one function, four sites, D6 order ---------------- */
check('EARN all four earn sites route through the ONE earn function',
  (appSrc.match(/loyaltyEarn\(/g) || []).length === 5 && // definition + 4 call sites
  appSrc.indexOf('function loyaltyEarn(person, points, reason, opts)') !== -1 &&
  (appSrc.match(/B\.loyaltyAppendEvent/g) || []).length >= 1 &&
  appSrc.indexOf('loyaltyPoints = (') === -1);
check('EARN the earn function appends via B.loyaltyAppendEvent and nothing else moves the cache in app.js',
  sliceBetween(appSrc, 'function loyaltyEarn(', '\n  }').indexOf('B.loyaltyAppendEvent(person, ev)') !== -1);
(function d6() {
  const term = sliceBetween(appSrc, 'function runTermScan(', "$('termScan').addEventListener");
  const txWrite = term.indexOf("return DB.put('transactions', tx).then(function () {");
  const termPayEarn = term.indexOf("loyaltyEarn(person, payPts, 'payment', { refIntentId: tx.id })");
  const visitEarn = term.indexOf("loyaltyEarn(person, LOYALTY_CONFIG.visitPoints, 'visit'");
  check('D6 terminal: visit earn stays gated to no-amount verified scans; payment earn sits INSIDE the transaction-write callback, keyed to the created tx',
    visitEarn !== -1 && term.slice(Math.max(0, visitEarn - 400), visitEarn).indexOf('if (!(amount > 0))') !== -1 &&
    txWrite !== -1 && termPayEarn > txWrite &&
    term.indexOf('Math.floor(tx.amount / LOYALTY_CONFIG.paymentEarnDivisor)') !== -1);
  const refusals = ['Biom Pay not created: this person has no linked', 'per-transaction limit', 'daily limit'];
  check('D6 terminal: no refusal branch carries an earn (the only earns are the two pinned sites)',
    refusals.every(function (m) { return term.indexOf(m) !== -1; }) &&
    (term.match(/loyaltyEarn\(/g) || []).length === 2);
  const wallet = sliceBetween(appSrc, 'var createWalletPay = function ()', 'var settleDemoPay');
  check('D6 wallet: the earn sits inside the transaction-write callback, from the created amount',
    wallet.indexOf("DB.put('transactions', tx)") !== -1 &&
    wallet.indexOf("loyaltyEarn(fresh, payPts, 'payment', { refIntentId: tx.id })") > wallet.indexOf("DB.put('transactions', tx)") &&
    wallet.indexOf('Math.floor(tx.amount / LOYALTY_CONFIG.paymentEarnDivisor)') !== -1);
  const bk = sliceBetween(appSrc, "return DB.put('transactions', rec).then(function () {", 'bkashReturnMessage(');
  check('D6 bKash return: the earn follows the recorded payment, from the EXECUTED amount',
    bk.indexOf("loyaltyEarn(person, pts, 'payment', { refIntentId: rec.id })") !== -1 &&
    bk.indexOf('Math.floor(executedAmount / LOYALTY_CONFIG.paymentEarnDivisor)') !== -1);
  check('D6 bKash return: an already-recorded payment is never credited twice (the idempotent branch returns before the earn)',
    appSrc.indexOf('it has not been credited twice') !== -1 &&
    appSrc.indexOf('it has not been credited twice') < appSrc.indexOf("loyaltyEarn(person, pts, 'payment'"));
})();

/* ---------------- streaks ---------------- */
function earnAt(weekOffsetDays, reason) {
  return { eventId: 'e' + weekOffsetDays + Math.random(), biomId: 'X', type: 'earn', points: 5, reason: reason || 'visit', ts: NOW - weekOffsetDays * 86400000 };
}
check('STREAK consecutive weeks count; the in-progress week extends but never breaks',
  (function () {
    const evs = [earnAt(0), earnAt(7), earnAt(14)]; // this week, last week, week before
    const s = B.loyaltyStreak(evs, NOW, 4);
    return s.weeks === 3 && s.activeThisWeek === true && s.freezesHeld === 0;
  })());
check('STREAK a fully missed week with no freeze breaks the streak',
  (function () {
    const evs = [earnAt(21), earnAt(28)]; // weeks -3 and -4; weeks -2,-1 missed, this week open
    const s = B.loyaltyStreak(evs, NOW, 4);
    return s.weeks === 0;
  })());
check('STREAK the opening event is not palm activity and never starts a streak',
  (function () {
    const s = B.loyaltyStreak([{ eventId: 'o', biomId: 'X', type: 'earn', points: 500, reason: 'opening', ts: NOW }], NOW, 4);
    return s.weeks === 0 && s.activeThisWeek === false;
  })());
check('STREAK reaching the milestone earns ONE freeze (max one held, even across a second milestone)',
  (function () {
    const evs = [];
    for (let w = 0; w < 8; w++) evs.push(earnAt(w * 7)); // 8 consecutive weeks ending this week
    const s = B.loyaltyStreak(evs, NOW, 4);
    return s.weeks === 8 && s.freezesEarned === 1 && s.freezesHeld === 1;
  })());
check('STREAK a held freeze is consumed to cover exactly one missed week and the streak survives',
  (function () {
    const evs = [];
    for (let w = 2; w < 6; w++) evs.push(earnAt(w * 7)); // weeks -5..-2: 4 in a row -> freeze earned
    // week -1 missed (freeze covers it), this week active again
    evs.push(earnAt(0));
    const s = B.loyaltyStreak(evs, NOW, 4);
    return s.freezesUsed === 1 && s.freezesHeld === 0 && s.weeks === 5;
  })());
check('STREAK two missed weeks defeat one freeze (streak breaks on the second gap)',
  (function () {
    const evs = [];
    for (let w = 3; w < 7; w++) evs.push(earnAt(w * 7)); // weeks -6..-3 -> freeze earned
    evs.push(earnAt(0)); // weeks -2 and -1 missed: freeze covers -2, -1 breaks it; this week restarts at 1
    const s = B.loyaltyStreak(evs, NOW, 4);
    return s.freezesUsed === 1 && s.weeks === 1;
  })());
check('STREAK state is computed from events — no streak counter field is stored anywhere',
  appSrc.indexOf('streakWeeks =') === -1 && bioSrc.indexOf('streakWeeks') === -1 &&
  appSrc.indexOf('person.streak') === -1 && bioSrc.indexOf('person.streak') === -1);
check('STREAK no milestone BONUS POINTS exist (the freeze is the only milestone reward; no purchasable freeze anywhere)',
  appSrc.indexOf('bonus') === -1 || appSrc.toLowerCase().indexOf('bonus points') === -1 &&
  !/buy|purchase|price/i.test(sliceBetween(appSrc, 'function loyaltySectionHTML', '\n  }')));

/* ---------------- surfaces ---------------- */
check('SURFACE My Account carries the Palm Loyalty card and renderAccount fills it from loyaltySectionHTML',
  htmlSrc.indexOf('id="acLoyaltyCard"') !== -1 && htmlSrc.indexOf('id="acLoyaltyBody"') !== -1 &&
  appSrc.indexOf("$('acLoyaltyBody').innerHTML = loyaltySectionHTML(me)") !== -1);
check('SURFACE the section shows balance, statement rows with signed direction, streak + freeze, and the offers empty state',
  (function () {
    const sec = sliceBetween(appSrc, 'function loyaltySectionHTML(me)', '\n  }');
    return sec.indexOf('Points balance:') !== -1 && sec.indexOf('Points statement') !== -1 &&
      sec.indexOf('Weekly palm streak:') !== -1 && sec.indexOf('Streak freeze:') !== -1 &&
      sec.indexOf('No merchant offers yet — offers appear here when a shop funds one.') !== -1 &&
      sec.indexOf('B.loyaltyStreak(events, Date.now(), LOYALTY_CONFIG.streakMilestoneWeeks)') !== -1 &&
      sec.indexOf('LOYALTY_CONFIG.offers') !== -1;
  })());
check('SURFACE offers render from config data when a merchant funds one (title/merchant/text, escaped)',
  sliceBetween(appSrc, 'function loyaltySectionHTML(me)', '\n  }').indexOf('esc(o.title') !== -1);
check('SURFACE displays read the computed balance (wallet chip, account line, registry lines)',
  appSrc.indexOf("loyaltyBalanceOf(me).toLocaleString() + ' pts'") !== -1 &&
  appSrc.indexOf("'<b>Loyalty points:</b> ' + loyaltyBalanceOf(me)") !== -1 &&
  appSrc.indexOf('loyaltyBalanceOf(p).toLocaleString()') !== -1);
check('SURFACE the Desk card no longer quotes the earn rate — factual mechanics + a pointer to the statement',
  htmlSrc.indexOf('1 point per BDT 10 paid, 5 points for a visit scan') === -1 &&
  htmlSrc.indexOf('Every earn is recorded in the customer') !== -1);
check('SURFACE NO surface quotes a point BDT value or an expiry (D3 undecided — absence asserted)',
  (function () {
    const loyaltyCopy = sliceBetween(appSrc, 'function loyaltySectionHTML(me)', '\n  }') +
      sliceBetween(htmlSrc, 'Palm Loyalty — LIVE', '</p>');
    return !/worth\s+BDT/i.test(loyaltyCopy) && !/=\s*BDT/i.test(loyaltyCopy) &&
      !/expir/i.test(loyaltyCopy) && !/BDT\s*0\.\d/i.test(loyaltyCopy) &&
      !/1 point = /i.test(loyaltyCopy) && !/tier/i.test(loyaltyCopy);
  })());
check('SURFACE how-it-works addresses value honestly (v90 plain words: shops announce what points can be used for; nothing promised)',
  sliceBetween(appSrc, 'function loyaltySectionHTML(me)', '\n  }').indexOf('Shops will announce what the points can be used for.') !== -1);
check('SURFACE no redemption UI exists (redeem is structural only — value undecided)',
  appSrc.indexOf('redeemPoints') === -1 && htmlSrc.indexOf('Redeem') === -1 &&
  sliceBetween(appSrc, 'function loyaltySectionHTML(me)', '\n  }').indexOf('redeem') === -1);

/* ---------------- frozen ---------------- */
check('FROZEN EDCC 0.32 / PalmNet 0.5895 literals and counts unchanged in biometrics.js',
  (bioSrc.match(/0\.32/g) || []).length === 15 && (bioSrc.match(/0\.5895/g) || []).length >= 8 &&
  bioSrc.indexOf('PALMNET_THRESHOLD = 0.5895') !== -1 || bioSrc.indexOf('0.5895') !== -1);
check('FROZEN v81 consent: Research.tapFrame occurrence count unchanged (3)',
  (appSrc.match(/Research\.tapFrame/g) || []).length === 3);
check('FROZEN the loyalty code touches no scan path (no loyalty reference inside the verify/identify streams)',
  sliceBetween(appSrc, 'function streamVerifyPalm', 'function streamIdentifyPalm').indexOf('loyalty') === -1 &&
  sliceBetween(bioSrc, 'function verifyPalmprintProfile', 'function palmprintProbePacked').indexOf('loyalty') === -1);

console.log(fail === 0 ? 'ALL V86 LOYALTY TESTS PASSED (' + pass + ')' : fail + ' FAILURE(S) of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
