/* TSG BIOM v80 — THE GAP FIXES, APP LEG (the Chairman's
   "fix this" order, 2026-11-27: close the two honest gaps
   v79 filed).

   GAP 1 — IMPERSONATION (CROSS-MATCH) EVIDENCE. Pins:
   - the reporting bands: CROSS_REPORT_EDCC = 0.28 (above every
     large-sample impostor score measured on this engine —
     bench max 0.1116 clean / 0.1133 cross-session, app fixture
     max ~0.15 — and below the frozen 0.32 bar);
     CROSS_REPORT_NEURAL = PALMNET_THRESHOLD − MONEY_MARGIN_NEURAL
     = 0.4395 (above the bench impostor p95 of 0.3056, below the
     frozen 0.5895 bar);
   - syncScanRecord's pair discipline: a pair rides only with a
     valid other-identity id AND an in-band score; below-band,
     self-id, missing-half and absent inputs all leave the
     record byte-identical to v79;
   - the wiring: both denied noteScan surfaces carry the cross
     fields from the outcome's diag; the verify stream computes
     per-system argmax tops (impostorTopFor /
     neuralImpostorTopFor) and attaches them to the diagnosis
     ONLY when the fused verdict against the claimed identity
     failed; the identify stream's denied diagnosis carries the
     per-system argmax over its candidates.

   GAP 2 — DUPLICATE-PALM ENROLMENT GUARD. Pins:
   - the gate fixtures against the shipped guard the enrolment
     path runs (B.bankingGuardCheck, the v49 decision): the
     SAME palm re-captured passes the guard against the
     existing profile (= the enrolment refusal fires); a
     DIFFERENT palm fails it (= enrolment proceeds); the same
     palm on the OTHER hand fails it through the hand gate
     (= the two-hands-two-identities enrolment proceeds); a
     legacy bank is uncheckable (= proceeds, honestly);
   - the wiring: runPalmCapture runs the guard after burst
     selection and BEFORE enroll.palm is banked, builds its
     the would-be-banked burst picks (Seat 1 fix), refuses with
     the duplicate copy + the enrol sync record naming the
     matched profile, and the topup (same-identity) path is
     untouched — its own guard call is the only other one.

   Plus: version coherence at v80, the v80 step as a pure
   adoption, and the frozen bars.

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
function finish() {
  console.log(fail === 0 ? 'ALL V80 GAP-FIX TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
}

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

/* ---------- version coherence + identity migration -------------- */
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v95',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v95' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v95'") !== -1 &&
  htmlSrc.indexOf('<meta name="biom-build" content="v95">') !== -1 &&
  htmlSrc.indexOf('TSG Biom · App v95 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v95' &&
  B.BIOM_DATA_VERSIONS.length === 59);
check('MIGRATION the v80 step is a pure adoption: a v79 store opens byte-identical at v80', (function () {
  const before = JSON.stringify({ people: [{ id: 'TSG-BIO-1', name: 'Gate', wallet: { balance: 5, statement: [], linkedAccounts: [] } }], logs: [], transactions: [], meta: [{ k: 'syncBlockedIds', v: 1 }] });
  const mig = B.migrateBiomData(JSON.parse(before), 'v79', 'v80');
  return mig.appliedSteps.join(',') === 'v80' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
})());
check('FREEZE the shipped bars are untouched (EDCC 0.32 / PalmNet 0.5895) and the strict money margins stand',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895 &&
  B.MONEY_MARGIN_EDCC === 0.10 && B.MONEY_MARGIN_NEURAL === 0.15);

/* ---------- Gap 1: the reporting bands --------------------------- */
check('BAND the EDCC reporting band is 0.28 — above the bench impostor maximum (0.1133 cross-session) and the app fixture maximum (~0.15), below the frozen bar',
  B.CROSS_REPORT_EDCC === 0.28 && B.CROSS_REPORT_EDCC > 0.1133 && B.CROSS_REPORT_EDCC > 0.15 && B.CROSS_REPORT_EDCC < B.PALMPRINT_THRESHOLD);
check('BAND the PalmNet reporting band is the bar minus the money margin (0.4395) — above the bench impostor p95 (0.3056), below the frozen bar',
  Math.abs(B.CROSS_REPORT_NEURAL - 0.4395) < 1e-9 && B.CROSS_REPORT_NEURAL === B.PALMNET_THRESHOLD - B.MONEY_MARGIN_NEURAL &&
  B.CROSS_REPORT_NEURAL > 0.3056 && B.CROSS_REPORT_NEURAL < B.PALMNET_THRESHOLD);

/* ---------- Gap 1: syncScanRecord pair discipline ---------------- */
check('CROSS an in-band pair rides the record (both systems)', (function () {
  const rec = B.syncScanRecord({ kind: 'money-auth', biomId: 'TSG-BIO-SELF', result: 'Denied',
    crossEdccId: 'TSG-BIO-OTHER', crossEdccScore: 0.29, crossNeuralId: 'TSG-BIO-OTHER', crossNeuralScore: 0.5 });
  return rec.crossEdccId === 'TSG-BIO-OTHER' && rec.crossEdccScore === 0.29 && rec.crossNeuralId === 'TSG-BIO-OTHER' && rec.crossNeuralScore === 0.5;
})());
check('CROSS a below-band score stays off the record (ordinary no-match noise)', (function () {
  const rec = B.syncScanRecord({ kind: 'money-auth', biomId: 'TSG-BIO-SELF', result: 'Denied',
    crossEdccId: 'TSG-BIO-OTHER', crossEdccScore: 0.2, crossNeuralId: 'TSG-BIO-OTHER', crossNeuralScore: 0.3 });
  return !('crossEdccId' in rec) && !('crossNeuralId' in rec);
})());
check('CROSS the two systems report independently (EDCC in band, PalmNet below)', (function () {
  const rec = B.syncScanRecord({ kind: 'verify', biomId: 'TSG-BIO-SELF', result: 'Denied',
    crossEdccId: 'TSG-BIO-OTHER', crossEdccScore: 0.31, crossNeuralId: 'TSG-BIO-OTHER', crossNeuralScore: 0.1 });
  return rec.crossEdccId === 'TSG-BIO-OTHER' && !('crossNeuralId' in rec);
})());
check('CROSS a self-match is never a cross event (id equal to the record biomId is dropped)', (function () {
  const rec = B.syncScanRecord({ kind: 'money-auth', biomId: 'TSG-BIO-SELF', result: 'Denied',
    crossEdccId: 'TSG-BIO-SELF', crossEdccScore: 0.31, crossNeuralId: 'TSG-BIO-SELF', crossNeuralScore: 0.9 });
  return !('crossEdccId' in rec) && !('crossNeuralId' in rec);
})());
check('CROSS a half-pair (id without score, score without id) rides nothing', (function () {
  const a = B.syncScanRecord({ kind: 'money-auth', biomId: '', result: 'Denied', crossEdccId: 'TSG-BIO-OTHER' });
  const b = B.syncScanRecord({ kind: 'money-auth', biomId: '', result: 'Denied', crossNeuralScore: 0.9 });
  return !('crossEdccId' in a) && !('crossNeuralId' in b);
})());
check('CROSS an anonymous wallet denial can still name the other identity (biomId stays empty — the v53 discipline holds)', (function () {
  const rec = B.syncScanRecord({ kind: 'money-auth', biomId: '', result: 'Denied', crossNeuralId: 'TSG-BIO-OTHER', crossNeuralScore: 0.55 });
  return rec.biomId === '' && rec.crossNeuralId === 'TSG-BIO-OTHER';
})());
check('CROSS a record with no cross inputs is byte-identical to the v79 shape', (function () {
  const rec = B.syncScanRecord({ kind: 'money-auth', biomId: 'TSG-BIO-1', result: 'Denied', edccScore: 0.1, palmnetScore: 0.2 });
  return JSON.stringify(Object.keys(rec).sort()) === JSON.stringify(['biomId', 'edccScore', 'hand', 'kind', 'palmnetScore', 'profileName', 'result']);
})());

/* ---------- Gap 1: wiring pins ----------------------------------- */
check('WIRE the verify stream computes per-system argmax tops alongside the scalar maxima',
  appSrc.indexOf('function impostorTopFor(rois, probeHand)') !== -1 &&
  appSrc.indexOf('function neuralImpostorTopFor(rois, probeHand)') !== -1 &&
  appSrc.indexOf('function impostorMaxFor(rois, probeHand)') !== -1);
check('WIRE the verify denied path attaches the tops to the diagnosis only when the claimed verdict failed', (function () {
  const seg = appSrc.slice(appSrc.indexOf('var rejDiag = {'), appSrc.indexOf('var measured = ', appSrc.indexOf('var rejDiag = {')));
  return seg.indexOf('if (!fused.verified)') !== -1 && seg.indexOf('rejDiag.crossEdccId = impTop.id') !== -1 && seg.indexOf('rejDiag.crossNeuralId = nImpTop.id') !== -1;
})());
check('WIRE the identify denied diagnosis carries the per-system argmax over its candidates',
  appSrc.indexOf('crossEdccId: bestPerson ? bestPerson.id : null') !== -1 &&
  appSrc.indexOf('crossNeuralId: bestNeuralPerson ? bestNeuralPerson.id : null') !== -1);
check('WIRE both denied noteScan surfaces forward the cross fields from the diagnosis', (function () {
  const term = appSrc.indexOf("crossEdccId: out.diag ? out.diag.crossEdccId : null");
  const wallet = appSrc.indexOf('crossEdccId: out.diag.crossEdccId || null');
  return term !== -1 && wallet !== -1;
})());
check('WIRE the spoof records carry no cross fields (a detector conviction is not a cross-match)',
  appSrc.indexOf("result: 'Spoof / Screen Replay Detected', fieldTest: fieldModeOn() });") !== -1 &&
  appSrc.indexOf("result: 'Spoof / Screen Replay Detected', fieldTest: fieldModeOn(),\n          cross") === -1);

/* ---------- Gap 2: the guard gate fixtures ------------------------
   The enrolment path's decision IS B.bankingGuardCheck over the
   capture's candidates (pinned by the wiring checks below), so
   the fixtures judge that shipped decision on the v49 fixture
   family: synthetic palms A and B with controlled separation. */
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
    frames.push({ openness: 2.0, code: B.palmprintEncode(roi, S, S), codeM: null, roi: roi, sharpness: 400 + i * 10, poseTag: null, poseDesc: null, hand: 'left' });
  }
  return frames;
}
function probesFor(creases, seed0) {
  return B.palmprintPackedCandidates(framesFor(creases, seed0)).list.map(function (c) { return c.words; });
}
const burstA = B.selectPalmprintBurstCodes(framesFor(PALM_A, 5000));
const existingProfile = { v: 4, format: 'packed96', codes: burstA.codes, hand: 'left' };
const candA = probesFor(PALM_A, 9000);   // the SAME palm, re-captured fresh
const candB = probesFor(PALM_B, 9500);   // a DIFFERENT palm

let g = B.bankingGuardCheck(existingProfile, { edccProbes: candA, neuralEmbeddings: [], hand: 'left' });
check('GATE same palm re-captured => guard PASS against the existing profile (the enrolment refusal fires)',
  g.status === 'pass' && g.edccChecked === true && g.edccScore >= B.PALMPRINT_THRESHOLD, 'score ' + (g.edccScore && g.edccScore.toFixed(3)));
g = B.bankingGuardCheck(existingProfile, { edccProbes: candB, neuralEmbeddings: [], hand: 'left' });
check('GATE a genuinely different palm => guard FAIL (the new enrolment proceeds — no false refusal)',
  g.status === 'fail' && g.edccChecked === true && g.edccScore < B.PALMPRINT_THRESHOLD, 'score ' + (g.edccScore && g.edccScore.toFixed(3)));
g = B.bankingGuardCheck(existingProfile, { edccProbes: candA, neuralEmbeddings: [], hand: 'right' });
check('GATE the same palm on the OTHER hand => guard FAIL via the hand gate (two-hands-two-identities enrolment proceeds)',
  g.status === 'fail' && g.handGate === true);
g = B.bankingGuardCheck({ v: 3, format: 'legacy', codes: [], legacyCodes: ['AAAA'], rescanNeeded: true }, { edccProbes: candA, neuralEmbeddings: [], hand: 'left' });
check('GATE a legacy bank the matchers cannot score => UNCHECKABLE (enrolment proceeds; the guard never fakes a comparison)',
  g.status === 'uncheckable' && g.edccChecked === false);

/* ---------- Gap 2: the REFUSAL standard (Seat 3 fix) -------------
   The enrolment refusal demands more than the guard's fused-OR
   pass: both-agree when both systems can check, else a margin
   above the bar on the single checking system. Synthetic
   embeddings with controlled cosines (the v49 recipe): embA2 is
   embA seen again (~0.77, inside the bench genuine band), embMid
   sits between the PalmNet bar and the refusal margin, embB is
   an unrelated palm (~0.03). */
function unitV(v) { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)); return v.map((x) => x / n); }
function embFrom(seed, base, mix) {
  const rnd = lcg(seed); const v = [];
  for (let i = 0; i < 256; i++) { const r = rnd() * 2 - 1; v.push(base ? base[i] * mix + r * (1 - mix) : r); }
  return unitV(v);
}
const embA = embFrom(11, null, 0);
const embA2 = embFrom(12, embA, 0.92);
const embMid = embFrom(14, embA, 0.89); // cosine ~0.68: above the bar, below the refusal margin
const embB = embFrom(13, null, 0);
function framesNoisy(creases, seed0, noiseAmp) {
  const frames = [];
  for (let i = 0; i < 9; i++) {
    const roi = roiImage(creases, seed0 + i * 13, S, noiseAmp);
    frames.push({ openness: 2.0, code: B.palmprintEncode(roi, S, S), codeM: null, roi: roi, sharpness: 400 + i * 10, poseTag: null, poseDesc: null, hand: 'left' });
  }
  return frames;
}
const candANoisy = B.palmprintPackedCandidates(framesNoisy(PALM_A, 9000, 30)).list.map(function (c) { return c.words; });
const dualProfile = { v: 4, format: 'packed96', codes: burstA.codes, hand: 'left', neural: B.palmnetBankFromEmbeddings([embA]) };
const neuralBankProfileB = { v: 4, format: 'packed96', codes: B.selectPalmprintBurstCodes(framesFor(PALM_B, 6000)).codes, hand: 'left', neural: B.palmnetBankFromEmbeddings([embA]) };

let v = B.enrolmentDuplicateVerdict(dualProfile, { edccProbes: candA, neuralEmbeddings: [embA2], hand: 'left' });
check('VERDICT both systems checkable and BOTH pass => REFUSE (basis both-agree)',
  v.refuse === true && v.basis === 'both-agree' && v.guard.via === 'both',
  'edcc ' + (v.guard.edccScore && v.guard.edccScore.toFixed(3)) + ' neural ' + (v.guard.neuralScore && v.guard.neuralScore.toFixed(3)));
v = B.enrolmentDuplicateVerdict(dualProfile, { edccProbes: candA, neuralEmbeddings: [embB], hand: 'left' });
check('VERDICT both checkable, EDCC passes but PalmNet FAILS => NO refuse (a single leg is not refusal-grade)',
  v.refuse === false && v.basis === 'below-refusal-standard' && v.guard.status === 'pass' && v.guard.via === 'edcc');
v = B.enrolmentDuplicateVerdict(neuralBankProfileB, { edccProbes: candA, neuralEmbeddings: [embA2], hand: 'left' });
check('VERDICT both checkable, PalmNet passes but EDCC FAILS => NO refuse (every measured false accept came through one leg alone)',
  v.refuse === false && v.basis === 'below-refusal-standard' && v.guard.status === 'pass' && v.guard.via === 'palmnet');
v = B.enrolmentDuplicateVerdict(dualProfile, { edccProbes: [], neuralEmbeddings: [embA2], hand: 'left' });
check('VERDICT only PalmNet checkable, score above the refusal margin (bar + 0.15) => REFUSE (basis neural-margin)',
  v.refuse === true && v.basis === 'neural-margin' && v.guard.edccChecked === false && v.guard.neuralScore >= B.PALMNET_THRESHOLD + B.ENROL_REFUSAL_MARGIN_NEURAL,
  'neural ' + (v.guard.neuralScore && v.guard.neuralScore.toFixed(3)));
v = B.enrolmentDuplicateVerdict(dualProfile, { edccProbes: [], neuralEmbeddings: [embMid], hand: 'left' });
check('VERDICT only PalmNet checkable, score above the bar but BELOW the refusal margin => NO refuse',
  v.refuse === false && v.basis === 'below-refusal-standard' && v.guard.status === 'pass' &&
  v.guard.neuralScore >= B.PALMNET_THRESHOLD && v.guard.neuralScore < B.PALMNET_THRESHOLD + B.ENROL_REFUSAL_MARGIN_NEURAL,
  'neural ' + (v.guard.neuralScore && v.guard.neuralScore.toFixed(3)));
v = B.enrolmentDuplicateVerdict(existingProfile, { edccProbes: candANoisy, neuralEmbeddings: [], hand: 'left' });
check('VERDICT only EDCC checkable, degraded same palm above the bar but BELOW the refusal margin (bar + 0.10) => NO refuse',
  v.refuse === false && v.basis === 'below-refusal-standard' && v.guard.status === 'pass' &&
  v.guard.edccScore >= B.PALMPRINT_THRESHOLD && v.guard.edccScore < B.PALMPRINT_THRESHOLD + B.ENROL_REFUSAL_MARGIN_EDCC,
  'edcc ' + (v.guard.edccScore && v.guard.edccScore.toFixed(3)));
v = B.enrolmentDuplicateVerdict(existingProfile, { edccProbes: candA, neuralEmbeddings: [], hand: 'left' });
check('VERDICT only EDCC checkable, clean same palm above the refusal margin => REFUSE (basis edcc-margin)',
  v.refuse === true && v.basis === 'edcc-margin' && v.guard.edccScore >= B.PALMPRINT_THRESHOLD + B.ENROL_REFUSAL_MARGIN_EDCC,
  'edcc ' + (v.guard.edccScore && v.guard.edccScore.toFixed(3)));

/* ---------- Gap 2: wiring pins ----------------------------------- */
check('WIRE the enrolment guard runs inside runPalmCapture, after burst selection and before banking', (function () {
  const cap = appSrc.slice(appSrc.indexOf('function runPalmCapture()'), appSrc.indexOf("$('palmCapture').addEventListener('click', runPalmCapture);"));
  const iSel = cap.indexOf('B.selectPalmprintBurstCodes(res.results)');
  const iGuard = cap.indexOf('B.enrolmentDuplicateVerdict(');
  const iBank = cap.indexOf('enroll.palm = { v: 4');
  return iSel !== -1 && iGuard > iSel && iBank > iGuard && cap.indexOf('function bankCapturedPalm()') !== -1;
})());
check('WIRE the enrolment guard judges the exact material that would be banked (Seat 1 fix): sel.codes as EDCC probes and one shared embeddings promise over the picked frames',
  appSrc.indexOf('edccProbes: sel.codes') !== -1 &&
  appSrc.indexOf('var bankEmbedsPromise = PalmNet.embedRois(pickRois);') !== -1 &&
  (appSrc.match(/bankEmbedsPromise\.then/g) || []).length === 2 &&
  (appSrc.match(/B\.palmprintPackedCandidates\(res\.results\)\.list\.map/g) || []).length === 1);
check('WIRE the guard has exactly two app call sites — bankingGuardCheck for topup (same identity), enrolmentDuplicateVerdict for enrolment (new identity)',
  (appSrc.match(/B\.bankingGuardCheck\(/g) || []).length === 1 &&
  (appSrc.match(/B\.enrolmentDuplicateVerdict\(/g) || []).length === 1);
check('WIRE the refusal stores nothing and does not advance: copy, log and sync record all name the matched profile', (function () {
  const cap = appSrc.slice(appSrc.indexOf('function runPalmCapture()'), appSrc.indexOf("$('palmCapture').addEventListener('click', runPalmCapture);"));
  return cap.indexOf('This palm is already registered on this device') !== -1 &&
    cap.indexOf("result: 'Enrolment Refused — Duplicate Palm'") !== -1 &&
    cap.indexOf("Sync.noteScan({ kind: 'enrol', profileName: '', biomId: dup.id") !== -1 &&
    cap.indexOf("DB.put('logs'") !== -1;
})());
check('WIRE the refusal path never assigns enroll.palm (the only assignment lives inside bankCapturedPalm)', (function () {
  const cap = appSrc.slice(appSrc.indexOf('function runPalmCapture()'), appSrc.indexOf("$('palmCapture').addEventListener('click', runPalmCapture);"));
  const assigns = cap.match(/enroll\.palm = \{ v: 4/g) || [];
  const fnStart = cap.indexOf('function bankCapturedPalm()');
  const assignAt = cap.indexOf('enroll.palm = { v: 4');
  return assigns.length === 1 && assignAt > fnStart;
})());

finish();
