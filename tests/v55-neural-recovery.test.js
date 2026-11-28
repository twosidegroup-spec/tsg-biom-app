/* TSG BIOM v55 — THE REMEDY-PATH REPAIR (AUDIT-v54.md, Defects 1–3).

   What v55 does (Chairman's order 2026-11-24, "Build v55 with
   all three fixes"): the v54 model swap itself was proven
   sound by the deep audit — bytes, load, bar and scoring all
   clean. What was broken was the remedy path AROUND it:

   FIX 1 (Defect 1, the serious one): every pre-v54 profile
   woke up with a stale neural bank (banked by the retired
   model), and the "Neural Scan" the app prescribes for
   exactly those profiles could dead-end: the banking guard's
   neural leg is uncheckable on a stale bank, so a genuine
   owner whose EDCC leg alone is under 0.32 was refused with
   "This palm does not match this profile" and NO way
   forward — the v53 re-registration offer was gated on the
   wallet-open recovery flag, which the Neural Scan entry
   never set. v55: a Neural Scan launched for a profile whose
   bank is stale at launch (B.palmnetNeedsScan true) is
   recovery-eligible for that profile (recoveryVia
   'neural'), so a guard refusal inside it offers the same
   typed-REPLACE re-registration as the wallet-open path —
   with offer text that states the true reason (the stored
   bank belongs to the previous model and cannot be
   checked). The refusal wording itself is honest in the
   same case: it no longer claims a checked mismatch when
   the neural leg could not run. The guard does NOT change
   (bars, legs, verdicts identical), a different person's
   palm is still refused, ordinary top-ups (Add Angles,
   Re-scan, Neural Scan on a CURRENT-stamp bank) gain NO
   recovery offer, and every non-recovery entry still clears
   the recovery state.

   FIX 2 (Defect 2): the v53 re-registration confirmation
   panel and its Logs event counted the PalmNet bank through
   the staleness-judging reader, so a stale bank's real
   embeddings were stated as zero. They now count the
   STORED bank via B.storedPalmnetCount. Display and
   accountability only; scoring is untouched.

   FIX 3 (Defect 3): the model loader never parsed the
   manifest's modelId, so a mixed update could run a model
   under the wrong bar and stamps. Both load paths (worker
   and main-thread fallback) now refuse a manifest whose
   modelId names a different model than the running build
   (PALMNET_EXPECTED_MODEL_ID = B.PALMNET_MODEL_ID): no
   session is created, PalmNet fails soft to EDCC-only with
   the mismatch in its status note. A manifest with NO
   modelId loads exactly as before. (The already-shipped
   v53 page cannot be patched retroactively — this protects
   from v55 onward; the v53 mix window was transient and
   fail-safe.)

   Migration 'v55' is a PURE ADOPTION: stores open
   byte-identical (v38-migration.test.js carries the chain
   section; this suite pins the two-stamp store too).

   All numbers here are RIG numbers; the phone is the
   verdict. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function info(msg) { console.log('  ..  ' + msg); }

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const bioSrc = fs.readFileSync(path.join(__dirname, '..', 'biometrics.js'), 'utf8');

/* ---------------- fixture machinery (v49 family, as v54) ------- */
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
const candA = probesFor(PALM_A, 9000);
const candB = probesFor(PALM_B, 9500);
check('FIXTURE the same-palm cosine clears the bar and the stranger does not',
  B.palmnetCosine(embA, embA2) >= B.PALMNET_THRESHOLD && B.palmnetCosine(embA, embB) < B.PALMNET_THRESHOLD);

/* The profiles of the audit's Defect 1: the owner's palm is A.
   profThin is the Chairman's case — the EDCC bank does NOT
   hold palm A (thin/failing bank), and the neural bank holds
   palm A but was stamped by the retired model, so the guard
   cannot check it. profCurrent is the same owner fully
   current. profStaleGoodEdcc has a stale neural bank but a
   working EDCC bank. */
const encA = B.palmnetEmbeddingToBase64(embA);
const bankR1ofA = { v: 1, dim: 256, model: 'palmnet-v1', embeddings: [encA] };
const bankCurrentOfA = B.palmnetBankFromEmbeddings([embA]);
const profThin = { v: 4, format: 'packed96', codes: burstB.codes, neural: bankR1ofA };
const profStaleGoodEdcc = { v: 4, format: 'packed96', codes: burstA.codes, neural: bankR1ofA };
const profCurrent = { v: 4, format: 'packed96', codes: burstA.codes, neural: bankCurrentOfA };

/* ---------------- FIX 1: the dead-end, reproduced -------------- */
const gDead = B.bankingGuardCheck(profThin, { edccProbes: candA, neuralEmbeddings: [embA2] });
check('FIX1 the audit dead-end reproduces at the guard: the owner\'s own palm is REFUSED on a stale-bank profile',
  gDead.status === 'fail' && gDead.edccChecked === true && gDead.neuralChecked === false,
  JSON.stringify({ s: gDead.status, e: gDead.edccChecked, n: gDead.neuralChecked }));
check('FIX1 the guard itself did not move: a DIFFERENT palm on a current bank is still refused, checked on both legs',
  (function () {
    const g = B.bankingGuardCheck(profCurrent, { edccProbes: candB, neuralEmbeddings: [embB] });
    return g.status === 'fail' && g.edccChecked === true && g.neuralChecked === true;
  })());
check('FIX1 the launch condition is exactly the staleness state: needsScan true for stale banks, false for a current bank',
  B.palmnetNeedsScan(profThin) === true && B.palmnetNeedsScan(profStaleGoodEdcc) === true &&
  B.palmnetNeedsScan(profCurrent) === false);

/* ---------------- FIX 1: the grant (source) -------------------- */
const openTopupSrc = appSrc.slice(appSrc.indexOf('function openTopup'), appSrc.indexOf('function startTopupCamera'));
check('FIX1 the grant fires only for a Neural Scan launch on a needs-scan (stale) bank',
  openTopupSrc.indexOf("var neuralStaleGrant = topupMode === 'neural' && B.palmnetNeedsScan(person.palmProfile);") !== -1 &&
  openTopupSrc.indexOf("if (neuralStaleGrant) { recoveryPersonId = personId; recoveryVia = 'neural'; }") !== -1);
check('FIX1 the grant is the ONLY new recovery grant: one direct assignment, plus the v53 wallet ternary (unchanged)',
  (appSrc.match(/recoveryPersonId = personId; recoveryVia = 'neural';/g) || []).length === 1 &&
  appSrc.indexOf('recoveryPersonId = viaRecovery ? personId : null;') !== -1 &&
  appSrc.indexOf("function openRecoveryTopup(personId) { openTopup(personId, 'angles', true); }") !== -1);
check('FIX1 Add Angles / Re-scan gain no grant: the grant expression requires the neural mode, and the v53 clear still runs first',
  openTopupSrc.indexOf('recoveryPersonId = viaRecovery ? personId : null;') !== -1 &&
  openTopupSrc.indexOf('var neuralStaleGrant') > openTopupSrc.indexOf('recoveryPersonId = viaRecovery ? personId : null;'));
check('FIX1 the launch tells the owner the truth up front when the stored bank is stale (notice + who-panel)',
  openTopupSrc.indexOf('the safety check cannot compare this capture against it') !== -1 &&
  openTopupSrc.indexOf('they were banked by the previous model') !== -1 &&
  openTopupSrc.indexOf('B.palmnetBankStale(person.palmProfile)') !== -1);

/* ---------------- FIX 1: refusal + offer (source) -------------- */
check('FIX1 the re-registration offer gate is unchanged (refusal inside a recovery capture, this profile only)',
  appSrc.indexOf('if (recoveryPersonId && recoveryPersonId === person.id)') !== -1 &&
  appSrc.indexOf('id="topReregOpen"') !== -1);
check('FIX1 the offer on the neural path states the true reason (previous model, cannot be checked, restores full verify)',
  appSrc.indexOf("recoveryVia === 'neural'") !== -1 &&
  appSrc.indexOf('stored PalmNet bank was banked by the previous model, so the neural check cannot run on it at all') !== -1 &&
  appSrc.indexOf('which restores full verify') !== -1);
check('FIX1 the wallet-path offer text is the v53 text, untouched',
  appSrc.indexOf('those stored templates are the ones that are failing') !== -1);
check('FIX1 the re-registration log names the path that led there (neural wording present, owner-recovery wording — v60 pin change: was "wallet recovery path" while the entry hung off wallet-open scans; the entry moved to My Account at v60 and the log line follows it)',
  (function () {
    const bank = appSrc.slice(appSrc.indexOf('function bankReRegistration'), appSrc.indexOf('function wireRereg'));
    return bank.indexOf("recoveryVia === 'neural'") !== -1 &&
      bank.indexOf('could not check the capture') !== -1 &&
      bank.indexOf('an Add Angles top-up in the owner recovery path') !== -1 &&
      bank.indexOf("result: 'Owner Re-registration'") !== -1;
  })());
check('FIX1 recovery state (id + via) is cleared on completion and on Back, as v53 cleared the id',
  appSrc.indexOf('recoveryPersonId = null;\n        recoveryVia = null;') !== -1 &&
  appSrc.indexOf("recoveryPersonId = null; recoveryVia = null; reregPerson = null;") !== -1);

/* ---------------- FIX 1 (d): the refusal wording --------------- */
function wordingBranch(guard, profile) {
  // The app's exact branch condition (app.js, guard-fail path).
  return !guard.handGate && !guard.neuralChecked && B.palmnetBankStale(profile);
}
check('FIX1(d) the stale predicate itself: stored-but-unscorable bank => stale; current bank / no bank => not stale',
  B.palmnetBankStale(profThin) === true && B.palmnetBankStale(profStaleGoodEdcc) === true &&
  B.palmnetBankStale(profCurrent) === false && B.palmnetBankStale({ v: 4, format: 'packed96', codes: burstA.codes }) === false &&
  B.palmnetBankStale(null) === false);
check('FIX1(d) the owner\'s refused capture on a stale bank takes the UNCHECKABLE wording, not the mismatch claim',
  wordingBranch(gDead, profThin) === true);
check('FIX1(d) a checked refusal on a current bank keeps the v49 wording (branch false: the neural leg RAN)',
  (function () {
    const g = B.bankingGuardCheck(profCurrent, { edccProbes: candB, neuralEmbeddings: [embB] });
    return g.status === 'fail' && wordingBranch(g, profCurrent) === false;
  })());
check('FIX1(d) a hand-gate refusal keeps the v49 wording even on a stale bank (the gate is a true mismatch)',
  (function () {
    const profHand = { v: 4, format: 'packed96', codes: burstB.codes, hand: 'left', neural: bankR1ofA };
    const g = B.bankingGuardCheck(profHand, { edccProbes: candA, neuralEmbeddings: [embA2], hand: 'right' });
    return g.status === 'fail' && g.handGate === true && wordingBranch(g, profHand) === false;
  })());
check('FIX1(d) both wordings exist in the app, the uncheckable one naming what could not run and why',
  appSrc.indexOf('This capture could not be confirmed for this profile — nothing was added.') !== -1 &&
  appSrc.indexOf('the PalmNet check could not run: the neural bank stored for this profile was banked by the previous model') !== -1 &&
  appSrc.indexOf('This palm does not match this profile — nothing was added') !== -1 &&
  appSrc.indexOf('var refusalStaleUncheckable = !guard.handGate && !guard.neuralChecked && B.palmnetBankStale(person.palmProfile);') !== -1);

/* ---------------- FIX 1 (a): completing the remedy ------------- */
check('FIX1(a) completing the re-registration restores neural verify under the current stamp',
  (function () {
    // The re-registration bank build, app-shaped: fresh bank
    // from the owner's capture embeddings, stamped current.
    const newBank = B.palmnetBankFromEmbeddings([embA2]);
    const fixed = { v: 4, format: 'packed96', codes: burstA.codes, neural: newBank };
    const score = B.palmnetScoreProfile(fixed, [embA]);
    const g = B.bankingGuardCheck(fixed, { edccProbes: candB, neuralEmbeddings: [embA2] });
    return !!newBank && newBank.model === B.PALMNET_MODEL_ID &&
      typeof score === 'number' && score >= B.PALMNET_THRESHOLD &&
      B.palmnetNeedsScan(fixed) === false && B.palmnetBankStale(fixed) === false &&
      g.status === 'pass' && g.via === 'palmnet';
  })());

/* ---------------- FIX 2: stored-bank counts -------------------- */
const staleThree = { v: 4, format: 'packed96', codes: burstA.codes, neural: { v: 1, dim: 256, model: 'palmnet-v1', embeddings: [encA, encA, encA] } };
check('FIX2 storedPalmnetCount counts what is STORED, the judging reader counts what is SCORABLE — the audit gap, closed',
  B.storedPalmnetCount(staleThree) === 3 && (B.palmnetProfileEmbeddings(staleThree) || []).length === 0 &&
  B.storedPalmnetCount(profCurrent) === 1 && (B.palmnetProfileEmbeddings(profCurrent) || []).length === 1 &&
  B.storedPalmnetCount({}) === 0 && B.storedPalmnetCount(null) === 0 &&
  B.storedPalmnetCount({ neural: { embeddings: [encA, encA] } }) === 2);
check('FIX2 the confirmation panel and the re-registration log both use the stored count (source)',
  (function () {
    const confirm = appSrc.slice(appSrc.indexOf('function openReregConfirm'), appSrc.indexOf('function reregFail'));
    const bank = appSrc.slice(appSrc.indexOf('function bankReRegistration'), appSrc.indexOf('function wireRereg'));
    return confirm.indexOf('B.storedPalmnetCount(fresh.palmProfile)') !== -1 &&
      bank.indexOf('B.storedPalmnetCount(person.palmProfile)') !== -1 &&
      appSrc.indexOf('palmnetProfileEmbeddings(fresh.palmProfile)') === -1 &&
      (appSrc.match(/B\.storedPalmnetCount\(/g) || []).length === 2;
  })());
check('FIX2 scoring callers keep the judging reader (verify + identify untouched)',
  appSrc.indexOf('var neuralBanked = B.palmnetProfileEmbeddings(person.palmProfile);') !== -1 &&
  appSrc.indexOf('var bank = B.palmnetProfileEmbeddings(p.palmProfile);') !== -1);

/* ---------------- FIX 3: the loader refuses a wrong model ------ */
check('FIX3 the expected id is the one named constant, shared with the bank stamps',
  appSrc.indexOf('var PALMNET_EXPECTED_MODEL_ID = B.PALMNET_MODEL_ID;') !== -1 &&
  B.PALMNET_MODEL_ID === 'palmnet-r3-ep12' && B.PALMNET_THRESHOLD === 0.5895 && B.PALMPRINT_THRESHOLD === 0.32);
check('FIX3 both load paths check the manifest modelId, and the worker receives the expected id (source)',
  (function () {
    const worker = appSrc.slice(appSrc.indexOf('function palmnetWorkerMain()'), appSrc.indexOf('var PALMNET_EXPECTED_MODEL_ID'));
    const fetchBytes = appSrc.slice(appSrc.indexOf('fetchModelContainer: function'), appSrc.indexOf('initMainThread: function'));
    return worker.indexOf('function loadModel(manifestUrl, expectedModelId, expectedWeightsSha256, expectedWeightsBytes, expectedProgramSha256)') !== -1 &&
      worker.indexOf('man.modelId !== expectedModelId') !== -1 &&
      worker.indexOf('PalmNet model mismatch') !== -1 &&
      appSrc.indexOf('expectedModelId: PALMNET_EXPECTED_MODEL_ID') !== -1 &&
      /* v64 (Seat 2 H-5): the worker also receives the code-pinned
         hash + byte length, not only the model id. v65: the pins
         are the TSGP container's weights hash/bytes + program hash. */
      appSrc.indexOf('expectedWeightsSha256: PALMNET_EXPECTED_SHA256') !== -1 &&
      appSrc.indexOf('expectedWeightsBytes: PALMNET_EXPECTED_BYTES') !== -1 &&
      appSrc.indexOf('expectedProgramSha256: PALMNET_EXPECTED_PROGRAM_SHA256') !== -1 &&
      fetchBytes.indexOf('man.modelId !== PALMNET_EXPECTED_MODEL_ID') !== -1 &&
      fetchBytes.indexOf('PalmNet model mismatch') !== -1;
  })());
check('FIX3 the shipped manifest names the running model (the match case is the live one)',
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'models', 'palmnet', 'manifest.json'), 'utf8')).modelId === B.PALMNET_MODEL_ID);

/* ---------------- (g) migration purity, both stamps ------------ */
(function () {
  const store = { people: [
    { id: 'TSG-BIO-1', name: 'Stale', limits: { perTx: 1000, daily: 5000 }, loyaltyPoints: 9,
      wallet: { balance: 450, statement: [{ kind: 'add', amount: 450, ref: 'DEMO-1' }], linkedAccounts: [{ id: 'a1', type: 'bKash', label: 'S bKash' }] },
      palmProfile: { v: 4, format: 'packed96', hand: 'left', codes: ['QUJD'], neural: { v: 1, dim: 256, model: 'palmnet-v1', embeddings: ['QUJD', 'REVG'] } } },
    { id: 'TSG-BIO-2', name: 'Current', limits: { perTx: 1000, daily: 5000 }, loyaltyPoints: 3,
      wallet: { balance: 10, statement: [], linkedAccounts: [] },
      palmProfile: { v: 4, format: 'packed96', hand: 'right', codes: ['R0hJ'], neural: { v: 1, dim: 256, model: 'palmnet-r3-ep12', embeddings: ['SktM'] } } }],
    logs: [], transactions: [], meta: [] };
  const before = JSON.stringify(store);
  const mig = B.migrateBiomData(JSON.parse(before), 'v54', 'v55');
  check('MIGRATION v54->v55 is a pure adoption for a two-stamp store (byte-identical, both stamps survive)',
    mig.appliedSteps.indexOf('v55') !== -1 && mig.changed === false && JSON.stringify(mig.snapshot) === before &&
    mig.snapshot.people[0].palmProfile.neural.model === 'palmnet-v1' &&
    mig.snapshot.people[1].palmProfile.neural.model === 'palmnet-r3-ep12');
})();

/* ---------------- versions ------------------------------------- */
// v56: the three absolute pins below were converted to the
// version-coherence form (the v48/v49/v50/v51/v52/v54 pattern)
// when v56 shipped — v55 remains IN the chain as an adoption
// step; the living current-version pins are in v38-migration
// + the v56 suite. The v55 proofs in this suite are unchanged.
check('VERSION app data version and shell version agree', (function () {
  const dv = (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1];
  const sv = (swSrc.match(/tsg-biom-shell-(v\d+)/) || [])[1];
  return !!dv && dv === sv;
})());
check('VERSION v55 remains in the chain as an adoption step', B.BIOM_DATA_VERSIONS.indexOf('v55') !== -1);

/* ---------------- FIX 3: the worker loader, run for real ------- */
/* The shipped palmnetWorkerMain, extracted from app.js and run
   in Node with stubbed fetch / postMessage and the REAL TSG Palm
   Engine (assembled exactly as the app assembles it): the match
   case must reach engine creation, a manifest naming another
   model must be refused BEFORE any part fetch, and a manifest
   with no modelId must load exactly as pre-v55 code did.
   (v65 rework: the loader speaks the TSGP container protocol —
   manifest -> program (hash-pinned) -> weight parts (hash-
   pinned) -> engine.load. The rig program is a minimal valid
   TSGP program whose single tensor is exactly the fake weights'
   length, so engine.load accepts it.) */
function runWorkerScenario(manifest, partText) {
  const workerSrc = appSrc.slice(appSrc.indexOf('function palmnetWorkerMain()'), appSrc.indexOf('var PalmNet = {'));
  const messages = [];
  let partFetches = 0;
  const fetchStub = function (url) {
    if (String(url).indexOf('manifest.json') !== -1) {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(manifest); } });
    }
    if (String(url).indexOf('program.json') !== -1) {
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(fakeProgramText); } });
    }
    partFetches++;
    return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(partText); } });
  };
  const factory = new Function('fetch', 'atob', 'crypto', 'palmnetPreprocessRoi', 'PALMNET_INPUT_SIZE', 'postMessage', 'B', 'createTsgPalmEngine', 'TextEncoder', 'self',
    workerSrc + '\nreturn palmnetWorkerMain;');
  const main = factory(fetchStub, function (s) { return Buffer.from(s, 'base64').toString('binary'); },
    crypto.webcrypto, B.palmnetPreprocessRoi, B.PALMNET_INPUT_SIZE,
    function (m) { messages.push(m); }, B, B.createTsgPalmEngine, TextEncoder, globalThis);
  main();
  return Promise.resolve().then(function () {
    globalThis.onmessage({ data: { type: 'init', manifestUrl: 'https://rig.invalid/models/palmnet/manifest.json', expectedModelId: 'palmnet-r3-ep12', expectedSha256: fakeSha, expectedBytes: fakeBytes.length, expectedProgramSha256: fakeProgSha } });
    return new Promise(function (resolve) { setTimeout(resolve, 400); });
  }).then(function () { return { messages: messages, partFetches: partFetches }; });
}
const fakeBytes = Buffer.from('v55-rig-model-bytes!'); // 20 bytes = 5 float32
const fakeSha = crypto.createHash('sha256').update(fakeBytes).digest('hex');
const fakePart = fakeBytes.toString('base64');
const fakeProgramText = JSON.stringify({ format: 'tsg-palm-engine-program', containerVersion: 1, inputs: [{ name: 'image', dims: ['batch', 3, 128, 128] }], outputs: ['embedding'], weights: { file: 'weights.bin', dtype: 'float32-le', totalFloats: fakeBytes.length / 4, tensors: { w: { offset: 0, length: fakeBytes.length / 4, dtype: 'f32' } } }, nodes: [] });
const fakeProgSha = crypto.createHash('sha256').update(Buffer.from(fakeProgramText, 'utf8')).digest('hex');
function manifestWith(modelId) {
  const m = { format: 'tsg-palm-engine-container', programFile: 'program.json', parts: ['p0'], weightsBytes: fakeBytes.length, weightsSha256: fakeSha, programSha256: fakeProgSha, bytes: fakeBytes.length, sha256: fakeSha };
  if (modelId !== undefined) m.modelId = modelId;
  return m;
}
runWorkerScenario(manifestWith('palmnet-r3-ep12'), fakePart).then(function (r) {
  check('FIX3 worker loader: a manifest naming the RUNNING model loads (engine created, ready posted)',
    r.messages.some(function (m) { return m.type === 'ready'; }) && r.partFetches === 1,
    JSON.stringify(r.messages.map(function (m) { return m.type; })));
  return runWorkerScenario(manifestWith('palmnet-v1'), fakePart);
}).then(function (r) {
  check('FIX3 worker loader: a manifest naming a DIFFERENT model is refused — error posted, mismatch named, NO part fetched, NO session',
    r.messages.length === 1 && r.messages[0].type === 'error' && /model mismatch/.test(r.messages[0].message || '') &&
    /palmnet-v1/.test(r.messages[0].message || '') && r.partFetches === 0,
    r.messages[0] ? r.messages[0].message : 'no message');
  return runWorkerScenario(manifestWith(undefined), fakePart);
}).then(function (r) {
  check('FIX3 worker loader: a manifest with NO modelId loads exactly as before (older manifests stay loadable)',
    r.messages.some(function (m) { return m.type === 'ready'; }) && r.partFetches === 1);
  info('rig only: synthetic palm fixtures and a stubbed model load. The phone verdict — his Neural Scan on Sajid/Samir completing, or offering re-registration — is the real-world proof, and it has not been claimed here.');
  console.log(fail === 0 ? 'ALL v55 NEURAL-RECOVERY TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
}).catch(function (e) {
  console.log('FAIL  worker-loader harness threw: ' + (e && e.message ? e.message : e));
  console.log('1 FAILURES (harness), ' + pass + ' passed');
  process.exit(1);
});
