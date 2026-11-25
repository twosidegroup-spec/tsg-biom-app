/* TSG BIOM v49 — banking guard, tightened money scans, freeze-proofing.

   Ordered 2026-11-24 after AUDIT-addmoney-v48.md. The audit found
   the Add Money credit gate itself fails closed, but two routes
   let an unregistered palm (the owner's brother) pass once:
   (c) Add Angles / Neural Scan / legacy Re-scan banked ANY live
   palm into a profile with no same-person check, and (a) the
   plain fused operating point (EER bar x max-fusion x mirror
   twin x 1-snap multi-frame) admits cross-person passes. The
   Chairman also reported the site freezing ("the site stuck
   then nothing works").

   Proven here:
   - GUARD (B.bankingGuardCheck, the pure decision app.js runs
     before any top-up merge): the same palm passes and a
     different palm is refused, for EDCC-only, neural-decides and
     dual-bank profiles, under the same OR rule as verification;
     the legacy re-bank case honestly reports 'uncheckable'.
     Also pinned: WITHOUT the guard, the v43 merge banks the
     wrong palm (the audit's mechanism) — the guard is the only
     thing standing between that behaviour and the profile.
   - MONEY STRICT RULE: the two-frame gate (B.createMoneyScanGate)
     counts DISTINCT analysed frames per target; the margin rule
     (B.moneyMarginCheck) passes clear wins, fails ambiguous
     ones, is vacuous with no other profile, and requires EVERY
     accepting system to clear its margin. The margin constants
     are pinned to their benchmark basis.
   - FREEZE-PROOFING: B.withTimeout — the single bound app.js
     routes the previously unbounded waits through — functionally
     simulated against a promise that never settles (wedged
     worker / camera / storage), a slow promise and a failing
     promise; plus source pins that each concrete path is
     actually bounded in the shipped app.js and that the bounds
     that already existed (PalmProc 4 s, Match 5 s / 20 s,
     PalmNet worker 45 s, embed race 6 s, DB.open 2.5 s) remain.
   - WIRING pins on the shipped sources: the guard runs before
     both merges in runTopupCapture with the exact refusal
     message; the strict option reaches the money-moving call
     sites and NOT the Send receiver identification; the
     terminal field record carries the strict outcome as extra
     fields; versions are v49 / shell v49; 'v49' is a pure
     adoption step in the migration chain.
   v50 amendment (2026-11-24, the Chairman's correction): the
   strict option's call sites went from five to THREE — wallet
   open (both routes) no longer carries it, because opening a
   wallet is a login, not a money movement, and the rule blocked
   the owner opening his own wallet. The pins below now assert
   exactly three strict sites and that both wallet-open routes
   are plain; the version pins take the coherence form (the
   living current-version pins live in v38-migration and the
   v50 suite), as the v48 suite's did at the v49 bump.
   All numbers here are RIG numbers; the phone is the verdict. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function info(msg) { console.log('  ..  ' + msg); }

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

/* ---------------- fixture machinery (v41/v45 renderer family) -- */
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const S = B.PALMPRINT_ROI_SIZE;
function roiImage(creases, seed, size, noiseAmp) {
  const rnd = lcg(seed); const noise = [];
  for (let i = 0; i < size * size; i++) noise.push((rnd() - 0.5) * noiseAmp);
  const g = new Array(size * size); const k = 128 / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x * k, py = y * k;
    let v = 172 + Math.sin(px * 0.045 + 1.7) * 9 + Math.cos(py * 0.06 + 0.4) * 7;
    for (const c of creases) {
      if (c.vert) { const lx = c.a * py + c.b + Math.sin(py * c.f + c.p) * c.amp; const d = Math.abs(px - lx); if (d < 3) v -= (3 - d) * 30; }
      else { const ly = c.a * px + c.b + Math.sin(px * c.f + c.p) * c.amp; const d = Math.abs(py - ly); if (d < 3) v -= (3 - d) * 30; }
    }
    g[y * size + x] = Math.max(0, Math.min(255, Math.round(v + noise[y * size + x])));
  }
  return g;
}
const PALM_A = [{ a: 0.22, b: 26, f: 0.05, p: 1, amp: 3 }, { a: -0.35, b: 92, f: 0.04, p: 3, amp: 4 }, { a: 0.04, b: 62, f: 0.06, p: 5, amp: 3 }, { a: 0.55, b: 18, f: 0.05, p: 2, amp: 3, vert: true }];
const PALM_B = [{ a: -0.05, b: 38, f: 0.04, p: 2, amp: 5 }, { a: 0.18, b: 55, f: 0.07, p: 1, amp: 3 }, { a: -0.5, b: 118, f: 0.05, p: 4, amp: 4 }, { a: 0.85, b: 4, f: 0.04, p: 3, amp: 4, vert: true }];
function framesFor(creases, seed0) {
  const frames = [];
  for (let i = 0; i < 9; i++) {
    const roi = roiImage(creases, seed0 + i * 13, S, 10);
    frames.push({ openness: 2.0, code: B.palmprintEncode(roi, S, S), codeM: null, roi: roi, sharpness: 400 + i * 10, poseTag: null, poseDesc: null });
  }
  return frames;
}
function probesFor(creases, seed0) {
  return B.palmprintPackedCandidates(framesFor(creases, seed0)).list.map(function (c) { return c.words; });
}
/* Synthetic PalmNet embeddings with controlled cosines: embA2 is
   embA seen again (cosine ~0.77, inside the bench genuine band —
   p05 0.7414); embB is an unrelated palm (cosine ~0.03, the bench
   impostor median 0.0337). */
function unit(v) { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)); return v.map((x) => x / n); }
function embFrom(seed, base, mix) {
  const rnd = lcg(seed); const v = [];
  for (let i = 0; i < 256; i++) { const r = rnd() * 2 - 1; v.push(base ? base[i] * mix + r * (1 - mix) : r); }
  return unit(v);
}
const embA = embFrom(11, null, 0);
const embA2 = embFrom(12, embA, 0.92);
const embB = embFrom(13, null, 0);

const burstA = B.selectPalmprintBurstCodes(framesFor(PALM_A, 5000));
const burstB = B.selectPalmprintBurstCodes(framesFor(PALM_B, 6000));
const profileEdcc = { v: 4, format: 'packed96', codes: burstA.codes };
const profileDual = { v: 4, format: 'packed96', codes: burstA.codes, neural: B.palmnetBankFromEmbeddings([embA]) };
const profileNeuralDecides = { v: 4, format: 'packed96', codes: burstB.codes, neural: B.palmnetBankFromEmbeddings([embA]) };
const profileLegacy = { v: 3, format: 'legacy', codes: [], legacyCodes: ['AAAA'], rescanNeeded: true };
const candA = probesFor(PALM_A, 9000);
const candB = probesFor(PALM_B, 9500);

check('FIXTURE burst banking produced 3 templates per palm', burstA.codes.length === 3 && burstB.codes.length === 3);
check('FIXTURE candidates exist for both palms', candA.length >= 1 && candB.length >= 1, 'A=' + candA.length + ' B=' + candB.length);
info('fixture cosines: A-A2 ' + B.palmnetCosine(embA, embA2).toFixed(3) + ', A-B ' + B.palmnetCosine(embA, embB).toFixed(3));

/* ---------------- GUARD: same palm passes, different refused --- */
let g = B.bankingGuardCheck(profileEdcc, { edccProbes: candA, neuralEmbeddings: [] });
check('GUARD EDCC-only profile + same palm => pass via edcc', g.status === 'pass' && g.via === 'edcc' && g.edccChecked === true, 'score ' + (g.edccScore && g.edccScore.toFixed(3)));
check('GUARD EDCC-only profile: the passing score is at/above the standing 0.32 bar', g.edccScore >= B.PALMPRINT_THRESHOLD, String(g.edccScore));
g = B.bankingGuardCheck(profileEdcc, { edccProbes: candB, neuralEmbeddings: [] });
check('GUARD EDCC-only profile + DIFFERENT palm => fail (merge refused)', g.status === 'fail' && g.edccChecked === true && g.via === null, 'score ' + (g.edccScore && g.edccScore.toFixed(3)));
check('GUARD the refused palm scored below the bar', g.edccScore < B.PALMPRINT_THRESHOLD, String(g.edccScore));
g = B.bankingGuardCheck(profileEdcc, { edccProbes: candA, neuralEmbeddings: [embB] });
check('GUARD EDCC-only profile never consults the neural side (no bank)', g.status === 'pass' && g.neuralChecked === false);

g = B.bankingGuardCheck(profileNeuralDecides, { edccProbes: candA, neuralEmbeddings: [embA2] });
check('GUARD neural-decides profile: EDCC side checked and failed, neural side passes => pass via palmnet',
  g.status === 'pass' && g.via === 'palmnet' && g.edccChecked === true && g.neuralChecked === true,
  'edcc ' + (g.edccScore && g.edccScore.toFixed(3)) + ' neural ' + (g.neuralScore && g.neuralScore.toFixed(3)));
check('GUARD the neural pass is at/above the standing PalmNet bar', g.neuralScore >= B.PALMNET_THRESHOLD, String(g.neuralScore));

g = B.bankingGuardCheck(profileDual, { edccProbes: candA, neuralEmbeddings: [embA2] });
check('GUARD dual-bank + same palm on both systems => pass via both', g.status === 'pass' && g.via === 'both');
g = B.bankingGuardCheck(profileDual, { edccProbes: candA, neuralEmbeddings: [embB] });
check('GUARD dual-bank: EDCC pass alone suffices (OR rule)', g.status === 'pass' && g.via === 'edcc' && g.neuralChecked === true);
g = B.bankingGuardCheck(profileDual, { edccProbes: candB, neuralEmbeddings: [embA2] });
check('GUARD dual-bank: neural pass alone suffices (OR rule)', g.status === 'pass' && g.via === 'palmnet' && g.edccChecked === true);
g = B.bankingGuardCheck(profileDual, { edccProbes: candB, neuralEmbeddings: [embB] });
check('GUARD dual-bank + different palm on both systems => fail', g.status === 'fail' && g.edccChecked === true && g.neuralChecked === true);

g = B.bankingGuardCheck(profileLegacy, { edccProbes: candA, neuralEmbeddings: [embA2] });
check('GUARD legacy profile => uncheckable (archived codes cannot be scored — stated, never faked)',
  g.status === 'uncheckable' && g.edccChecked === false && g.neuralChecked === false);
g = B.bankingGuardCheck(profileEdcc, { edccProbes: [], neuralEmbeddings: [] });
check('GUARD a session with no candidates => uncheckable, not a pass', g.status === 'uncheckable');
g = B.bankingGuardCheck(null, { edccProbes: candA, neuralEmbeddings: [embA2] });
check('GUARD no profile => uncheckable, not a pass', g.status === 'uncheckable');

/* The audit's mechanism, pinned so the reason for the guard is
   never forgotten: left to itself, the v43 merge BANKS the wrong
   palm into the profile (changed === true). The guard is what
   stops app.js from ever calling it in that case. */
const mergeWrong = B.mergePalmprintProfileCodes(profileEdcc, framesFor(PALM_B, 9500));
check('AUDIT MECHANISM pinned: the unguarded merge banks a different palm (changed)',
  !!mergeWrong && mergeWrong.changed === true && (mergeWrong.added + mergeWrong.replaced) > 0,
  mergeWrong ? 'added ' + mergeWrong.added + ' replaced ' + mergeWrong.replaced : 'null');

/* ---------------- MONEY: two-frame gate ------------------------ */
const gate = B.createMoneyScanGate();
check('GATE no frames noted => not confirmed', gate.confirmed('target') === false && gate.verifiedFrames('target') === 0);
check('GATE one verified frame => still not confirmed (the 1-snap win is not enough for money)',
  gate.noteVerified('target', 3) === 1 && gate.confirmed('target') === false);
check('GATE the same frame noted again (neural landing re-takes it) does not double-count',
  gate.noteVerified('target', 3) === 1 && gate.confirmed('target') === false);
check('GATE a second DISTINCT frame confirms', gate.noteVerified('target', 4) === 2 && gate.confirmed('target') === true);
check('GATE targets are independent (identify: one key per candidate)',
  gate.confirmed('other') === false && gate.noteVerified('other', 3) === 1 && gate.confirmed('other') === false && gate.confirmed('target') === true);
check('GATE a non-frame note (undefined index) is ignored', gate.noteVerified('target', undefined) === 2);

/* ---------------- MONEY: margin rule --------------------------- */
check('MARGIN constants are the ordered values', B.MONEY_MARGIN_EDCC === 0.10 && B.MONEY_MARGIN_NEURAL === 0.15 && B.MONEY_CONFIRM_FRAMES === 2);
check('MARGIN basis sanity: neural 0.15 sits under the bench worst-case separation (tilt 0.80: genuine p05 0.4334 - impostor p95 0.2544 = 0.179)',
  B.MONEY_MARGIN_NEURAL < (0.4334 - 0.2544) && B.MONEY_MARGIN_NEURAL > 0);
check('MARGIN basis sanity: EDCC 0.10 sits well under the app fixture separation (genuine ~0.50 - impostor max ~0.15 = ~0.35)',
  B.MONEY_MARGIN_EDCC < 0.35 && B.MONEY_MARGIN_EDCC > 0);

let mc = B.moneyMarginCheck({ verified: true, acceptedBy: 'edcc', similarity: 0.50, neuralScore: null }, 0.15, null);
check('MARGIN EDCC clear win passes (0.50 vs impostor-max 0.15, gap 0.35)', mc.pass === true && mc.edcc.gap >= 0.35 - 1e-9 && mc.edcc.vacuous === false);
mc = B.moneyMarginCheck({ verified: true, acceptedBy: 'edcc', similarity: 0.34, neuralScore: null }, 0.30, null);
check('MARGIN EDCC marginal win FAILS (0.34 vs 0.30, gap 0.04 < 0.10) — the incident shape', mc.pass === false && mc.blockers.join(',') === 'edcc');
mc = B.moneyMarginCheck({ verified: true, acceptedBy: 'edcc', similarity: 0.50, neuralScore: null }, null, null);
check('MARGIN single-profile device: no other profile => vacuously satisfied', mc.pass === true && mc.edcc.vacuous === true);
mc = B.moneyMarginCheck({ verified: true, acceptedBy: 'palmnet', similarity: null, neuralScore: 0.80 }, null, 0.30);
check('MARGIN PalmNet clear win passes (0.80 vs 0.30, gap 0.50)', mc.pass === true && mc.palmnet.gap >= 0.5 - 1e-9);
mc = B.moneyMarginCheck({ verified: true, acceptedBy: 'palmnet', similarity: null, neuralScore: 0.60 }, null, 0.52);
check('MARGIN PalmNet near-bar win FAILS (0.60 vs 0.52, gap 0.08 < 0.15)', mc.pass === false && mc.blockers.join(',') === 'palmnet');
mc = B.moneyMarginCheck({ verified: true, acceptedBy: 'both', similarity: 0.55, neuralScore: 0.62 }, 0.20, 0.55);
check('MARGIN accepted by both: EVERY accepting system must clear (EDCC clears, PalmNet gap 0.07 fails) => overall fail',
  mc.pass === false && mc.edcc.pass === true && mc.palmnet.pass === false && mc.blockers.join(',') === 'palmnet');
mc = B.moneyMarginCheck({ verified: true, acceptedBy: 'both', similarity: 0.55, neuralScore: 0.85 }, 0.20, 0.30);
check('MARGIN accepted by both, both clear => pass', mc.pass === true);
mc = B.moneyMarginCheck({ verified: false, acceptedBy: null, similarity: 0.10, neuralScore: null }, 0.05, 0.05);
check('MARGIN a non-verified result is never passed (fail closed)', mc.pass === false && mc.applied === false);
/* The fused-decision integration: a real fusePalmVerifyResults
   output feeds the margin check unchanged. */
const fusedIncident = B.fusePalmVerifyResults({ ok: true, verified: false, similarity: 0.21, threshold: 0.32, reason: 'below' }, 0.59);
check('MARGIN integration: fused neural-only accept at 0.59 vs impostor-max 0.50 fails the margin (gap 0.09)',
  fusedIncident.verified === true && fusedIncident.acceptedBy === 'palmnet' &&
  B.moneyMarginCheck(fusedIncident, 0.10, 0.50).pass === false);

/* ---------------- FREEZE: the shared bound, simulated ---------- */
function freezeChecks() {
  const never = new Promise(function () { /* never settles: a wedged worker / camera / storage request */ });
  const t0 = Date.now();
  return B.withTimeout(never, 40).then(function () {
    check('FREEZE a promise that never settles must reject, not resolve', false);
    return null;
  }, function (e) {
    check('FREEZE a promise that never settles rejects with ETIMEOUT inside the bound',
      e && e.code === 'ETIMEOUT' && (Date.now() - t0) < 2000, (Date.now() - t0) + ' ms');
    return null;
  }).then(function () {
    // Slow but healthy: resolves with its own value under a generous bound.
    return B.withTimeout(new Promise(function (res) { setTimeout(function () { res('landed'); }, 10); }), 1000);
  }).then(function (v) {
    check('FREEZE a slow-but-healthy promise resolves with its value', v === 'landed');
    // A failing operation propagates its OWN error, not a timeout.
    return B.withTimeout(Promise.reject(new Error('storage unavailable')), 1000).then(function () { return 'resolved'; }, function (e) { return e.message; });
  }).then(function (msg) {
    check('FREEZE a failing promise propagates its own error', msg === 'storage unavailable');
    // The boot-chain recovery shape: a bounded read that times out
    // degrades to the caller's fallback instead of freezing boot.
    return B.withTimeout(never, 30).catch(function () { return 'localStorage fallback'; });
  }).then(function (v) {
    check('FREEZE a timed-out read degrades to the caller fallback (the DB.open pattern)', v === 'localStorage fallback');
    // A late settlement after the timeout is ignored — the caller
    // already recovered; the outcome stays the timeout's.
    let lateResolve;
    const late = new Promise(function (res) { lateResolve = res; });
    return B.withTimeout(late, 20).then(function () { return 'resolved'; }, function (e) { return e.code; }).then(function (code) {
      lateResolve('too late');
      return new Promise(function (res) { setTimeout(function () { res(code); }, 30); });
    });
  }).then(function (code) {
    check('FREEZE a late settlement after the timeout changes nothing', code === 'ETIMEOUT');
  });
}

/* ---------------- FREEZE + WIRING: source pins ----------------- */
function wiringChecks() {
  check('FREEZE DB.put runs its IndexedDB request under the bound', appSrc.indexOf('B.withTimeout(new Promise(function (resolve, reject) {\n        var tx = self.db.transaction(store, \'readwrite\');') !== -1);
  check('FREEZE DB.all runs its IndexedDB request under the bound', appSrc.indexOf('B.withTimeout(new Promise(function (resolve, reject) {\n        var req = self.db.transaction(store, \'readonly\')') !== -1);
  check('FREEZE the DB bound is 8 s', appSrc.indexOf('var DB_OP_TIMEOUT_MS = 8000;') !== -1);
  check('FREEZE Cam.start runs under the bound and supersedes on timeout',
    appSrc.indexOf('B.withTimeout(p, CAM_START_TIMEOUT_MS)') !== -1 && appSrc.indexOf("e.code === 'ETIMEOUT'") !== -1 && appSrc.indexOf('Cam._token++;') !== -1);
  check('FREEZE the camera bound is 12 s', appSrc.indexOf('var CAM_START_TIMEOUT_MS = 12000;') !== -1);
  check('FREEZE PalmNet main-thread load is bounded (script 20 s, whole chain 60 s)',
    appSrc.indexOf('}), 20000);') !== -1 && appSrc.indexOf('}), 60000);') !== -1);
  check('FREEZE the terminal log write can no longer gate the verdict card', appSrc.indexOf("method: method, measured: measured, result: result }).catch(function () { return null; })") !== -1);
  check('FREEZE the walletAct camera restarter surfaces failures like every other start',
    appSrc.indexOf("camRestarters.walletAct = function () {") !== -1 && appSrc.indexOf("$('wScanStatus').textContent = 'Camera blocked.'; });") !== -1);
  check('FREEZE pre-existing bounds intact: PalmProc frame timeout + rebuild (4 s)', appSrc.indexOf('}, 4000);') !== -1);
  check('FREEZE pre-existing bounds intact: Match worker timeouts (5 s / 20 s)',
    appSrc.indexOf('}, 5000);') !== -1 && (appSrc.match(/\}, 20000\);/g) || []).length >= 2);
  check('FREEZE pre-existing bounds intact: PalmNet worker init (45 s) and embed race (6 s)',
    appSrc.indexOf('}, 45000);') !== -1 && appSrc.indexOf('waitMs(6000)') !== -1);
  check('FREEZE pre-existing bound intact: DB.open settles to the fallback (2.5 s)', appSrc.indexOf('setTimeout(function () { settle(true); }, 2500);') !== -1);

  /* Guard wiring: inside runTopupCapture, the guard is consulted
     BEFORE both merges, and the refusal copy is the exact ordered
     message. */
  const topupStart = appSrc.indexOf('function runTopupCapture()');
  const topupEnd = appSrc.indexOf("$('topStart')", topupStart);
  const topupSrc = appSrc.slice(topupStart, topupEnd);
  const iGuard = topupSrc.indexOf('B.bankingGuardCheck(');
  const iMergeEdcc = topupSrc.indexOf('B.mergePalmprintProfileCodes(');
  const iMergeNeural = topupSrc.indexOf('B.mergePalmnetEmbeddings(');
  check('WIRING the guard runs in runTopupCapture before BOTH merges',
    iGuard !== -1 && iMergeEdcc !== -1 && iMergeNeural !== -1 && iGuard < iMergeEdcc && iGuard < iMergeNeural);
  check('WIRING the refusal message is the exact ordered wording',
    topupSrc.indexOf('This palm does not match this profile — nothing was added') !== -1);
  check('WIRING the refusal is logged and banks nothing (no DB.put of a person on the fail path)',
    topupSrc.indexOf("result: 'Banking Refused — Palm Mismatch'") !== -1);
  check('WIRING guard candidates come from the session itself (packed candidates + neural candidate ROIs)',
    topupSrc.indexOf('B.palmprintPackedCandidates(res.results)') !== -1 && topupSrc.indexOf('neuralCandidateRois(res.results)') !== -1);
  check('WIRING the legacy re-bank limitation is stated in the flow copy',
    appSrc.indexOf('this re-scan cannot check the presented palm against them') !== -1);

  /* Strict wiring: exactly the THREE money-moving call sites
     carry the option (v50 correction — wallet open is a login
     and runs plain, both routes); the Send receiver
     identification stays plain. */
  check('WIRING the strict refusal message is the exact ordered wording',
    appSrc.indexOf("var MONEY_STRICT_FAIL_MSG = 'Matched, but not clearly enough to authorise money — please scan again';") !== -1);
  const strictSites = (appSrc.match(/\{ strictMoney: true \}\)/g) || []).length;
  /* v63 PIN CHANGE (named openly): the Chairman's 2026-11-25
     10:47 order adds a fourth money-moving call site — the
     wallet's own Biom Pay (choose a partner store, enter the
     amount, scan your own palm), mirroring the terminal
     payment. The rule's intent is unchanged: the strict option
     rides ONLY on money-moving scans, and the set is exactly
     the four named below. */
  check('WIRING exactly four money-moving call sites pass the strict option (terminal Biom Pay, Add Money, Send authorise, wallet Biom Pay — v63 named pin change)',
    strictSites === 4, 'found ' + strictSites);
  const recvStart = appSrc.indexOf("$('wSendScanReceiver')");
  const recvSlice = appSrc.slice(recvStart, appSrc.indexOf('function renderSendConfirm()', recvStart));
  check('WIRING the Send RECEIVER identification stays a plain scan (identifying a person moves no money)',
    recvSlice.indexOf('streamIdentifyPalm') !== -1 && recvSlice.indexOf('strictMoney') === -1);
  /* v60 PIN CHANGE (named openly): the two checks that stood
     here pinned the wallet-open routes as plain scans with no
     strict flag (the v50 correction). At v60 those routes are
     REMOVED — wallet entry is not a scan at all (the
     Chairman's order, 2026-11-25: "entering our own wallet no
     need scan"). The invariant survives in stronger form:
     entry runs no scan, so no strict flag can ride on one,
     and the strict sites remain exactly the three above. */
  check('WIRING v60: wallet entry runs NO scan — both wallet-open scan routes are gone entirely',
    appSrc.indexOf("$('walletOpenScan')") === -1 && appSrc.indexOf('function openWalletForPerson') === -1 &&
    appSrc.indexOf("syncKind: 'wallet-open'") === -1);
  check('WIRING v60: entry resolves by profile, not by palm (resolveWalletEntry + the tap-to-open picker)',
    appSrc.indexOf('function resolveWalletEntry(people)') !== -1 && appSrc.indexOf('function openWalletDirect(personId)') !== -1 &&
    appSrc.indexOf('data-open-wallet') !== -1);
  check('WIRING both streams accept the strict option and consult the gate',
    appSrc.indexOf('function streamVerifyPalm(video, statusEl, person, people, swapCamera, fieldRec, control, opts)') !== -1 &&
    appSrc.indexOf('function streamIdentifyPalm(video, statusEl, people, swapCamera, control, opts)') !== -1 &&
    (appSrc.match(/moneyGate\.confirmed\(/g) || []).length >= 2);
  check('WIRING the margin check runs where the impostor-maxima are known (verifiedOut + identify win)',
    (appSrc.match(/B\.moneyMarginCheck\(/g) || []).length >= 2);
  check('WIRING the terminal field record carries the strict outcome as extra fields (plain verdict untouched)',
    appSrc.indexOf('rec.strictMoney = true;') !== -1 && appSrc.indexOf('rec.strictPass = neural.strictPass === true;') !== -1 && appSrc.indexOf('rec.strictBlock = neural.strictBlock || null;') !== -1);
  check('WIRING money result panels carry the strict sentence',
    appSrc.indexOf('Money authorisation rule applied: the match was confirmed on ') !== -1 &&
    appSrc.indexOf('did NOT beat every other enrolled palm by the money margin') !== -1);

  check('VERSION versions: app data version and shell version agree and sit in the chain (v50-era form of this pin)',
    (function () {
      const dv = (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1];
      const sv = (swSrc.match(/tsg-biom-shell-(v\d+)/) || [])[1];
      return !!dv && dv === sv && B.BIOM_DATA_VERSIONS.indexOf(dv) !== -1 && B.BIOM_DATA_VERSIONS.indexOf('v49') !== -1;
    })());
  check('MIGRATION v49 remains in the chain as an adoption step', B.BIOM_DATA_VERSIONS.indexOf('v49') !== -1);
  const store49 = {
    people: [{ id: 'TSG-BIO-1', name: 'Rig', wallet: { balance: 450, statement: [{ kind: 'add', amount: 450 }], linkedAccounts: [{ id: 'a1' }] }, palmProfile: { v: 4, format: 'packed96', codes: ['QUJD'], neural: { v: 1, dim: 256, model: 'palmnet-v1', embeddings: ['QUJD'] } } }],
    logs: [{ ts: 1 }], transactions: [{ id: 'BIOM-PAY-1' }], meta: []
  };
  const store49Before = JSON.stringify(store49);
  const mig49 = B.migrateBiomData(store49, 'v48', 'v49');
  check('MIGRATION v48->v49 is a pure adoption (wallet + neural store byte-identical)',
    mig49.appliedSteps.join(',') === 'v49' && mig49.changed === false && JSON.stringify(mig49.snapshot) === store49Before);
}

Promise.resolve().then(freezeChecks).then(wiringChecks).then(function () {
  console.log(fail === 0 ? 'ALL v49 GUARD/MONEY/FREEZE TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
});
