/* TSG BIOM v85 — PHASE 2: RELIABILITY (overnight programme,
   Phase 2; the TSG-BIO-2843 failure, 2026-11-28 01:50–01:55).

   The failure: a fresh enrolment banked in 2,380 ms, passed the
   topup banking guard twice, then matched NOTHING ever again —
   and its records carried no per-stage evidence, so the
   presentation story is unprovable. v85 closes the provable
   part of the gap:

   1. ENROLMENT SELF-CHECK: after a NEW enrolment banks (only
      there — never topup, never re-registration), the wizard
      runs the REAL streamVerifyPalm against the just-banked
      profile with the PLAIN fused verdict (no strictMoney: the
      question is "can this bank match this palm at all", not
      "may money move"). Pass completes the enrolment; fail
      offers on-the-spot re-capture through the existing capture
      machinery (duplicate guard included) or keeps the profile
      WITH the bankHealth mark; skip/cancel completes the
      enrolment, marked. Nothing is deleted, ever.
   2. WITHIN-BURST HOLDOUT: at banking time, one non-picked
      usable burst frame is scored against the banked templates
      through the verify paths themselves (verifyPalmprintRois
      + palmnetScoreProfile, fused at the frozen bars). Recorded
      in the enrolment's log/measured text; unchecked (no spare
      frame) is NO signal.
   3. WEAK-BANK GUIDANCE: the bankHealth mark (the ONE additive
      optional person field; the v85 migration materialises
      nothing) + the holdout signal feed DISPLAY-ONLY prompts
      (My Account / Registry) guiding to Strengthen. No matcher,
      guard or verdict path reads the mark.

   The self-check scan record rides the frozen schema: kind
   'verify' (an existing SYNC_SCAN_KINDS member) with the
   marker in the result field's value space ('Self-Check
   Verified' / 'Self-Check Denied') — pinned behaviourally
   below via B.syncScanRecord's output shape.

   Frozen, untouched: EDCC 0.32, PalmNet 0.5895, the strict
   two-frame + margin rule, the banking guard's rule, the
   enrolment quality gates, the block system, the v81 consent
   tapFrame sites, the scan-record schema fields, the v74/v83
   timer spans. */
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

/* ---------------- version coherence + migration ---------------- */
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v95 (v86 named pin change: Phase-3 loyalty; the v85 migration checks below stay historical)',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v95' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v95'") !== -1 &&
  htmlSrc.indexOf('<meta name="biom-build" content="v95">') !== -1 &&
  htmlSrc.indexOf('TSG Biom · App v95 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v95' &&
  B.BIOM_DATA_VERSIONS.length === 59);
check('MIGRATION v85 is a pure adoption: a v84 store (with and without a bankHealth mark) opens byte-identical at v85 — the step materialises nothing',
  (function () {
    const before = JSON.stringify({ people: [
      { id: 'TSG-BIO-1', name: 'Plain', wallet: { balance: 5, statement: [], linkedAccounts: [] } },
      { id: 'TSG-BIO-2', name: 'Marked', bankHealth: { weak: true, reason: 'self-check-failed', ts: 1 }, wallet: { balance: 0, statement: [], linkedAccounts: [] } }
    ], logs: [], transactions: [], meta: [] });
    const mig = B.migrateBiomData(JSON.parse(before), 'v84', 'v85');
    return mig.appliedSteps.join(',') === 'v85' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
  })());
check('MIGRATION the v85 step is declared a pure adoption in biometrics.js',
  bioSrc.indexOf("'v85': function (snap) { return snap; }") !== -1);

/* ---------------- frozen bars + guard ---------------- */
check('FREEZE the shipped bars are untouched (EDCC 0.32 / PalmNet 0.5895) and the strict money margins stand',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895 &&
  B.MONEY_MARGIN_EDCC === 0.10 && B.MONEY_MARGIN_NEURAL === 0.15);
check('FREEZE the banking guard never reads the bankHealth mark, and neither does the packed verify path',
  sliceBetween(bioSrc, 'function bankingGuardCheck', 'function enrolmentDuplicateVerdict').indexOf('bankHealth') === -1 &&
  sliceBetween(bioSrc, 'function verifyPackedProbes', 'function verifyPalmprintProfile').indexOf('bankHealth') === -1 &&
  sliceBetween(bioSrc, 'function fusePalmVerifyResults', '/* ================= TSG Palm Engine').indexOf('bankHealth') === -1);

/* ---------------- holdout: behaviour on synthetic palms ---------------- */
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const S = B.PALMPRINT_ROI_SIZE;
/* The palmprint.test.js renderer family (128-space creases,
   k-scaled into the ROI). Fixture variation is brightness +
   light noise only: what is under test here is the holdout
   MECHANICS (non-picked frame, fused verdict at the bars,
   weak signal), not shift tolerance — that is the palmprint
   suite's calibration job. */
function roiImage(creases, seed, opts) {
  opts = opts || {};
  const k = 128 / S, rnd = lcg(seed), noiseAmp = opts.noiseAmp != null ? opts.noiseAmp : 4;
  const noise = [];
  for (let i = 0; i < S * S; i++) noise.push((rnd() - 0.5) * noiseAmp);
  const bright = opts.bright || 0;
  const g = new Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = x * k, py = y * k;
    let v = 172 + Math.sin(px * 0.045 + 1.7) * 9 + Math.cos(py * 0.06 + 0.4) * 7 + bright;
    for (const c of creases) {
      if (c.vert) { const lx = c.a * py + c.b + Math.sin(py * c.f + c.p) * c.amp; const d = Math.abs(px - lx); if (d < 3) v -= (3 - d) * 30; }
      else { const ly = c.a * px + c.b + Math.sin(px * c.f + c.p) * c.amp; const d = Math.abs(py - ly); if (d < 3) v -= (3 - d) * 30; }
    }
    g[y * S + x] = Math.max(0, Math.min(255, Math.round(v + noise[y * S + x])));
  }
  return g;
}
const PALM_A = [{ a: 0.22, b: 26, f: 0.05, p: 1, amp: 3 }, { a: -0.35, b: 92, f: 0.04, p: 3, amp: 4 }, { a: 0.04, b: 62, f: 0.06, p: 5, amp: 3 }, { a: 0.55, b: 18, f: 0.05, p: 2, amp: 3, vert: true }];
const PALM_B = [{ a: 0.48, b: 12, f: 0.06, p: 4, amp: 4 }, { a: -0.12, b: 78, f: 0.05, p: 0, amp: 3 }, { a: 0.30, b: 44, f: 0.04, p: 2, amp: 5 }, { a: 0.30, b: 40, f: 0.06, p: 1, amp: 3, vert: true }];
function burstFrames(creases, seedBase, n) {
  const frames = [];
  for (let i = 0; i < n; i++) {
    const roi = roiImage(creases, seedBase + i * 7, { bright: (i % 3) - 1 });
    frames.push({ openness: 2.0, sharpness: 50 + i, roi: roi, code: B.palmprintEncode(roi, S, S), hand: 'left' }); // openness on the PALM_OPEN_MIN (1.65) ratio scale
  }
  return frames;
}
(function () {
  const frames = burstFrames(PALM_A, 1000, 9);
  const sel = B.selectPalmprintBurstCodes(frames);
  check('HOLDOUT fixture burst banks 3 picks', !!sel && sel.codes.length === 3 && sel.picks.length === 3);
  const profile = { v: 4, format: B.PALMPRINT_FORMAT, codes: sel.codes, hand: 'left' };
  const hold = B.burstHoldoutFrame(frames, sel);
  check('HOLDOUT the holdout frame is a usable burst frame that is NOT one of the picks',
    !!hold && sel.picks.indexOf(hold.index) === -1 && !!hold.roi);
  const hc = B.burstHoldoutCheck(hold, profile, []);
  check('HOLDOUT a same-palm holdout is checked and verifies at the frozen bars (fused verdict, EDCC leg)',
    hc.checked === true && hc.verified === true && typeof hc.edccScore === 'number' && hc.edccScore >= B.PALMPRINT_THRESHOLD && hc.frameIndex === hold.index,
    JSON.stringify(hc));
  check('HOLDOUT a verifying holdout is NOT a weak-bank signal', B.bankWeakFromHoldout(hc) === false);
  const framesB = burstFrames(PALM_B, 5000, 9);
  const holdB = B.burstHoldoutFrame(framesB, sel);
  const hcB = B.burstHoldoutCheck(holdB, profile, []);
  check('HOLDOUT a different palm\u2019s holdout is checked, does NOT verify, and IS the weak-bank signal (threshold = the frozen bars, via the fused verdict)',
    hcB.checked === true && hcB.verified === false && B.bankWeakFromHoldout(hcB) === true,
    JSON.stringify(hcB));
  check('HOLDOUT no spare frame => unchecked => NO signal (absence of evidence is never a weakness claim)',
    B.burstHoldoutFrame(frames.slice(0, 3), { codes: sel.codes, picks: [0, 1, 2] }) === null &&
    B.burstHoldoutCheck(null, profile, []).checked === false &&
    B.bankWeakFromHoldout(B.burstHoldoutCheck(null, profile, [])) === false &&
    B.bankWeakFromHoldout(null) === false);
  check('HOLDOUT the check is the fused verify judgement itself (verifyPalmprintRois + palmnetScoreProfile + fusePalmVerifyResults in biometrics.js)',
    sliceBetween(bioSrc, 'function burstHoldoutCheck', 'function bankWeakFromHoldout').indexOf('verifyPalmprintRois(profile, [holdout.roi])') !== -1 &&
    sliceBetween(bioSrc, 'function burstHoldoutCheck', 'function bankWeakFromHoldout').indexOf('palmnetScoreProfile(profile,') !== -1 &&
    sliceBetween(bioSrc, 'function burstHoldoutCheck', 'function bankWeakFromHoldout').indexOf('fusePalmVerifyResults(') !== -1);
})();

/* ---------------- the bankHealth mark ---------------- */
check('MARK personBankWeak reads exactly the one additive field, absent/false shapes are not weak',
  B.personBankWeak({ bankHealth: { weak: true, reason: 'self-check-failed', ts: 1 } }) === true &&
  B.personBankWeak({}) === false && B.personBankWeak({ bankHealth: { weak: false } }) === false &&
  B.personBankWeak({ bankHealth: null }) === false && B.personBankWeak(null) === false);
check('MARK finishEnrollment writes the mark only when the self-check left one, and the topup merge retires it',
  appSrc.indexOf('if (enrollBankWeak) person.bankHealth = enrollBankWeak;') !== -1 &&
  appSrc.indexOf('if (updated.bankHealth) delete updated.bankHealth;') !== -1);

/* ---------------- self-check wiring (app.js) ---------------- */
const scBlock = sliceBetween(appSrc, 'v85: enrolment self-check', 'function runPalmCapture()');
const bankFn = sliceBetween(appSrc, 'function bankCapturedPalm()', "$('palmCapture').addEventListener");
check('SELFCHECK the self-check is begun exactly once, from bankCapturedPalm (new-enrolment banking), and the enrolment completes only through finishEnrolSelfCheck',
  (appSrc.match(/beginEnrolSelfCheck\(\)/g) || []).length === 2 && // definition + the one call
  bankFn.indexOf('beginEnrolSelfCheck();') !== -1 &&
  scBlock.slice(scBlock.indexOf('function finishEnrolSelfCheck()')).indexOf("advanceFrom('palm');") !== -1);
check('SELFCHECK the topup and re-registration flows never touch the self-check (new enrolments only)',
  sliceBetween(appSrc, 'function runTopupCapture', '/* ---------------- v53 owner re-registration').indexOf('SelfCheck') === -1 &&
  sliceBetween(appSrc, 'v53 owner re-registration', '/* ---------------- Registry').indexOf('SelfCheck') === -1);
check('SELFCHECK the confirmation runs the REAL streamVerifyPalm with the PLAIN verdict — no strictMoney option is passed (the block\u2019s only strictMoney mention is the comment stating it is NOT applied)',
  scBlock.indexOf("streamVerifyPalm($('palmVideo'), $('palmStatus'), probe, [], null, function () {}, control)") !== -1 &&
  scBlock.indexOf('strictMoney:') === -1 && scBlock.indexOf('strictMoney is NOT') !== -1 &&
  scBlock.indexOf('var probe = { id: \'\', name: enroll.details ? enroll.details.name : \'\', palmProfile: enroll.palm };') !== -1);
check('SELFCHECK pass completes the enrolment and clears any weak mark (the fresh-presentation evidence wins over the holdout)',
  sliceBetween(scBlock, 'var verified = !!(out.r && out.r.verified);', 'function skipEnrolSelfCheck').indexOf('enrollBankWeak = null;') !== -1 &&
  sliceBetween(scBlock, 'var verified = !!(out.r && out.r.verified);', 'function skipEnrolSelfCheck').indexOf('finishEnrolSelfCheck();') !== -1);
check('SELFCHECK fail marks self-check-failed and offers re-capture / keep — it never silently keeps an unmarked bank and never deletes anything',
  scBlock.indexOf("enrollBankWeak = { weak: true, reason: 'self-check-failed', ts: Date.now() };") !== -1 &&
  scBlock.indexOf("renderSelfCheck('failed')") !== -1 &&
  scBlock.indexOf('id="selfCheckRecapture"') !== -1 && scBlock.indexOf('id="selfCheckKeep"') !== -1 &&
  scBlock.indexOf('DB.del') === -1 && scBlock.indexOf('deletePerson') === -1 && scBlock.indexOf('wipeBiomData') === -1);
check('SELFCHECK re-capture reuses the existing capture machinery: it only clears the in-memory bank and re-arms Scan Palm (runPalmCapture + duplicate guard run again untouched)',
  sliceBetween(scBlock, 'function recaptureEnrolPalm()', 'function finishEnrolSelfCheck()').indexOf('enroll.palm = null;') !== -1 &&
  sliceBetween(scBlock, 'function recaptureEnrolPalm()', 'function finishEnrolSelfCheck()').indexOf("$('palmCapture').disabled = false;") !== -1 &&
  sliceBetween(scBlock, 'function recaptureEnrolPalm()', 'function finishEnrolSelfCheck()').indexOf('DB.') === -1);
check('SELFCHECK skip keeps the profile and marks self-check-skipped; cancel (out.stopped) completes the enrolment the same way — never wedged, never un-banked',
  scBlock.indexOf("enrollBankWeak = { weak: true, reason: 'self-check-skipped', ts: Date.now() };") !== -1 &&
  sliceBetween(scBlock, 'if (out.stopped) {', 'var verified =').indexOf("reason: 'self-check-skipped'") !== -1 &&
  sliceBetween(scBlock, 'if (out.stopped) {', 'var verified =').indexOf('finishEnrolSelfCheck();') !== -1 &&
  scBlock.indexOf('enrollControl = control;') !== -1);
check('SELFCHECK the panel states exist in the page and the renderer (offered / checking / passed / failed) with the plain failure wording',
  htmlSrc.indexOf('id="palmSelfCheck"') !== -1 &&
  scBlock.indexOf("renderSelfCheck('offered')") !== -1 && scBlock.indexOf("renderSelfCheck('checking')") !== -1 &&
  scBlock.indexOf("renderSelfCheck('passed')") !== -1 && scBlock.indexOf('did not match') !== -1 &&
  scBlock.indexOf('One more scan — confirm your palm works') !== -1);

/* ---------------- self-check recording: frozen schema ---------------- */
check('RECORD the self-check scan record rides kind verify + the result value space, written only when a scan actually ran (never for skip/stop)',
  appSrc.indexOf("Sync.noteScan({ kind: 'verify', profileName: person.name, biomId: person.id, hand: B.palmProfileHand(person.palmProfile), edccScore: sc.edcc, palmnetScore: sc.neural, result: sc.verified ? 'Self-Check Verified' : 'Self-Check Denied' });") !== -1 &&
  appSrc.indexOf('if (sc && sc.ran && !sc.stopped) {') !== -1);
check('RECORD B.syncScanRecord emits the self-check record with EXACTLY the frozen field set (marker in result only)',
  (function () {
    const rec = B.syncScanRecord({ kind: 'verify', profileName: 'Gate', biomId: 'TSG-BIO-9', hand: 'left', edccScore: 0.5, palmnetScore: null, result: 'Self-Check Verified' });
    if (!rec) return false;
    const keys = Object.keys(rec).sort().join(',');
    return keys === 'biomId,edccScore,hand,kind,palmnetScore,profileName,result' && rec.result === 'Self-Check Verified';
  })());
check('RECORD the enrolment log row carries the holdout + self-check evidence in the existing measured field',
  appSrc.indexOf("measured: 'Enrolment banked. ' + holdoutMeasuredText(scHoldout) + ' Enrolment self-check: ' + scText") !== -1 &&
  bankFn.indexOf('holdoutMeasuredText(enrollHoldout)') !== -1 &&
  bankFn.indexOf('B.burstHoldoutFrame(res.results, sel)') !== -1 &&
  bankFn.indexOf('B.burstHoldoutCheck(holdoutFrame, enroll.palm,') !== -1);

/* ---------------- weak-bank guidance: display-only ---------------- */
check('GUIDANCE the My Account prompt and the Registry line are the mark\u2019s only app readers, both gated on the still-thin bank, both routing to Strengthen',
  sliceBetween(appSrc, 'function renderAccount()', "$('acBack')").indexOf('B.personBankWeak(me) && B.palmBankThin(me.palmProfile)') !== -1 &&
  sliceBetween(appSrc, 'function showRegistryDetail', "$('registrySearch')").indexOf('B.personBankWeak(p) && B.palmBankThin(p.palmProfile)') !== -1 &&
  (appSrc.match(/B\.personBankWeak\(/g) || []).length === 2); // two CALL sites (comments name the function without a call)
check('GUIDANCE no verdict path reads the mark: streamVerifyPalm, streamIdentifyPalm and the enrolment capture contain no bankHealth reference',
  sliceBetween(appSrc, 'function streamVerifyPalm', 'function streamIdentifyPalm').indexOf('bankHealth') === -1 &&
  sliceBetween(appSrc, 'function streamIdentifyPalm', 'function grabVideoFrameInto').indexOf('bankHealth') === -1 &&
  sliceBetween(appSrc, 'function runPalmCapture()', '/* ---------------- Terminal').indexOf('bankHealth') === -1);

console.log(fail === 0 ? 'ALL V85 RELIABILITY TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
