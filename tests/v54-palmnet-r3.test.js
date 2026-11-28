/* TSG BIOM v54 — PalmNet ROUND 3 MODEL SWAP + MODEL STAMPING.

   What v54 does (Chairman's order 2026-11-24: integrate the
   Round 3 current best now; Round 3 training keeps running in
   the background to its own stop rule):
   - The in-app PalmNet model is the Round 3 trainer's selected
     best checkpoint, snapshotted at epoch 12 while training
     continued: clean EVAL EER 0.001167% (reproduced through the
     trainer's own evaluation path with abs diff 0.0), Rank-1
     100%, PyTorch <-> ONNX parity max abs diff 1.07e-06. The
     full record is
     ~/workspace/palmnet-bench/round3/integration-v54/measurement.md
     and the snapshot lives beside it.
   - The neural bar is THIS model's own EER threshold on the
     same protocol that produced the Round 1 bar: 0.5895
     (replaces 0.5773). The EDCC bar (0.32) is untouched, as are
     the fusion OR rule, the banking guard bars, the strict
     money margins, the v51 hand gate, the v53 frame rule,
     diagnosis panel and owner recovery — their suites pin them.
   - MODEL STAMPING, the correctness core: embeddings from
     different models are NOT comparable, so every bank written
     from v54 on is stamped 'palmnet-r3-ep12'
     (B.PALMNET_MODEL_ID). At read time a bank stamped by any
     other model — including every 'palmnet-v1' bank and any
     unstamped bank — counts as NO NEURAL EVIDENCE: the profile
     verifies EDCC-only, shows "Neural scan needed", and a
     Neural Scan re-banks it under the current model through
     the existing guarded top-up flow. The banking guard, the
     strict-money impostor-max, 1:N identify and the Field Test
     neural leg all read banks through the same function, so
     the one staleness judgement covers them all; this suite
     pins each of those paths.
   - Field Test records gain rec.neuralModel (extra field; the
     pinned CSV columns never change).
   - Migration 'v54' is a PURE ADOPTION: staleness is judged
     at read time, stored banks are never rewritten — a v53
     store carrying a Round-1-stamped bank opens byte-identical
     (v38-migration.test.js) and the bank still reads stale
     afterwards (pinned here).
   All numbers here are RIG numbers; the phone is the verdict. */
'use strict';
const fs = require('fs');
const os = require('os');
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

/* ---------------- the shipped model IS the measured snapshot --- */
const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'models', 'palmnet', 'manifest.json'), 'utf8'));
const joined = man.parts.map(function (p) { return fs.readFileSync(path.join(__dirname, '..', 'models', 'palmnet', p), 'utf8'); }).join('');
const modelBytes = Buffer.from(joined, 'base64');
const modelSha = crypto.createHash('sha256').update(modelBytes).digest('hex');
check('MODEL the shipped parts reassemble to the manifest bytes + SHA-256',
  modelBytes.length === man.bytes && modelSha === man.sha256, man.bytes + ' bytes');
check('MODEL the manifest names the running model id and bar',
  man.modelId === 'palmnet-r3-ep12' && man.modelId === B.PALMNET_MODEL_ID && man.neuralThreshold === B.PALMNET_THRESHOLD,
  man.modelId + ' @ ' + man.neuralThreshold);
const snapOnnx = path.join(os.homedir(), 'workspace', 'palmnet-bench', 'round3', 'integration-v54', 'palmnet_r3_snapshot.onnx');
/* v65 named pin change: the shipped artefact is the TSGP
   container, not the ONNX file. The chain of custody is the
   manifest's recorded source hash — it must equal the Round 3
   snapshot ONNX exactly, and the container's weights are proven
   a byte-exact repack of that ONNX's tensors by the converter
   (max diff 0.0) + the parity gate (tests/v65-tsg-engine). */
const srcHash = ((man.note || '').match(/SHA-256 ([0-9a-f]{64})/) || [])[1];
if (fs.existsSync(snapOnnx)) {
  const snapSha = crypto.createHash('sha256').update(fs.readFileSync(snapOnnx)).digest('hex');
  check('MODEL the shipped container records the Round 3 snapshot ONNX as its source (hash equal)', snapSha === srcHash, snapSha.slice(0, 16) + '…');
} else {
  info('snapshot ONNX not on this machine — hash-vs-snapshot check skipped (manifest self-check above still ran)');
}
const measureMd = path.join(os.homedir(), 'workspace', 'palmnet-bench', 'round3', 'integration-v54', 'measurement.md');
if (fs.existsSync(measureMd)) {
  const md = fs.readFileSync(measureMd, 'utf8');
  check('MODEL the measurement record carries this bar, this model id and this model hash',
    md.indexOf('0.5895') !== -1 && md.indexOf('palmnet-r3-ep12') !== -1 && md.indexOf(srcHash) !== -1);
} else {
  info('measurement.md not on this machine — record cross-check skipped');
}

/* ---------------- the bar -------------------------------------- */
check('BAR the neural bar is the Round 3 model\'s measured EER threshold 0.5895', B.PALMNET_THRESHOLD === 0.5895, String(B.PALMNET_THRESHOLD));
check('BAR the EDCC bar is untouched at 0.32', B.PALMPRINT_THRESHOLD === 0.32, String(B.PALMPRINT_THRESHOLD));
check('BAR the running model id is palmnet-r3-ep12 (the snapshot\'s best epoch)', B.PALMNET_MODEL_ID === 'palmnet-r3-ep12', B.PALMNET_MODEL_ID);
check('BAR the derivation is recorded in the code (measurement path + LAB-DERIVED framing kept)',
  bioSrc.indexOf('integration-v54/measurement.md') !== -1 && bioSrc.indexOf('LAB-DERIVED STARTING POINT') !== -1);

/* ---------------- fixture machinery (v49 family) --------------- */
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
const embA = embFrom(11, null, 0);        // the owner's embedding under ANY model, as fixture vectors
const embA2 = embFrom(12, embA, 0.92);    // same palm again: cosine ~0.77 — clears the 0.5895 bar
const embB = embFrom(13, null, 0);        // an unrelated palm: cosine ~0.03
const burstA = B.selectPalmprintBurstCodes(framesFor(PALM_A, 5000));
const burstB = B.selectPalmprintBurstCodes(framesFor(PALM_B, 6000));
const candA = probesFor(PALM_A, 9000);
const candB = probesFor(PALM_B, 9500);
info('fixture cosines: A-A2 ' + B.palmnetCosine(embA, embA2).toFixed(3) + ' (bar 0.5895), A-B ' + B.palmnetCosine(embA, embB).toFixed(3));
check('FIXTURE the same-palm cosine clears the new bar and the stranger does not',
  B.palmnetCosine(embA, embA2) >= B.PALMNET_THRESHOLD && B.palmnetCosine(embA, embB) < B.PALMNET_THRESHOLD);

/* Banks of the three vintages over the SAME fixture embeddings:
   the vectors are identical — only the stamp differs — so any
   behavioural difference below is the staleness rule itself. */
const encA = B.palmnetEmbeddingToBase64(embA);
const bankCurrent = B.palmnetBankFromEmbeddings([embA]);
const bankR1 = { v: 1, dim: 256, model: 'palmnet-v1', embeddings: [encA] };
const bankUnstamped = { v: 1, dim: 256, embeddings: [encA] };
const profCurrent = { v: 4, format: 'packed96', codes: burstA.codes, neural: bankCurrent };
const profR1 = { v: 4, format: 'packed96', codes: burstA.codes, neural: bankR1 };
const profUnstamped = { v: 4, format: 'packed96', codes: burstA.codes, neural: bankUnstamped };

/* ---------------- stamping on write ---------------------------- */
check('STAMP a bank written now carries the current model id',
  !!bankCurrent && bankCurrent.model === 'palmnet-r3-ep12' && bankCurrent.model === B.PALMNET_MODEL_ID);
check('STAMP the stamp reader reports each vintage honestly (metadata is readable; evidence is judged separately)',
  B.palmnetProfileModelId(profCurrent) === 'palmnet-r3-ep12' && B.palmnetProfileModelId(profR1) === 'palmnet-v1' &&
  B.palmnetProfileModelId(profUnstamped) === null && B.palmnetProfileModelId({}) === null);

/* ---------------- staleness: no neural evidence ---------------- */
check('STALE a Round-1-stamped bank yields NO banked embeddings at read time',
  B.palmnetProfileEmbeddings(profR1) === null);
check('STALE an unstamped bank yields NO banked embeddings at read time',
  B.palmnetProfileEmbeddings(profUnstamped) === null);
check('STALE a Round-1 bank scores NOTHING (null, not a low score) even for the identical palm',
  B.palmnetScoreProfile(profR1, [embA2]) === null && B.palmnetScoreProfile(profR1, [embA]) === null);
check('STALE an unstamped bank scores NOTHING',
  B.palmnetScoreProfile(profUnstamped, [embA]) === null);
check('STALE stale-bank profiles read as needing a neural scan (Registry / My Account state)',
  B.palmnetProfileSane(profR1) === false && B.palmnetNeedsScan(profR1) === true &&
  B.palmnetProfileSane(profUnstamped) === false && B.palmnetNeedsScan(profUnstamped) === true);
check('STALE the stored bank itself is untouched by the read (no rewrite, no re-stamp)',
  profR1.neural === bankR1 && bankR1.model === 'palmnet-v1' && bankR1.embeddings[0] === encA &&
  profUnstamped.neural === bankUnstamped && !('model' in bankUnstamped));

/* ---------------- the EDCC leg still verifies ------------------ */
const edccPass = { verified: true, similarity: 0.41, reason: 'rig pass' };
const fusedStale = B.fusePalmVerifyResults(edccPass, B.palmnetScoreProfile(profR1, [embA2]));
check('STALE with no neural evidence the EDCC verdict stands alone (acceptedBy edcc)',
  fusedStale.verified === true && fusedStale.acceptedBy === 'edcc' && fusedStale.neuralScore === null);
const edccReal = B.verifyPalmprintProfile(profR1, candA);
check('STALE the EDCC leg of a stale-bank profile still verifies its own palm',
  edccReal.verified === true, 'similarity ' + (edccReal.similarity && edccReal.similarity.toFixed(3)));

/* ---------------- current bank scores normally ----------------- */
const curScore = B.palmnetScoreProfile(profCurrent, [embA2]);
check('CURRENT a current-stamp bank scores the same palm above the bar',
  typeof curScore === 'number' && curScore >= B.PALMNET_THRESHOLD, 'score ' + (curScore && curScore.toFixed(3)));
const fusedNeural = B.fusePalmVerifyResults({ verified: false, similarity: 0.1, reason: 'rig fail' }, curScore);
check('CURRENT the fusion accepts on the neural leg alone (acceptedBy palmnet) at the new bar',
  fusedNeural.verified === true && fusedNeural.acceptedBy === 'palmnet' && fusedNeural.neuralThreshold === 0.5895);
check('CURRENT a current-stamp profile does not need a neural scan',
  B.palmnetProfileSane(profCurrent) === true && B.palmnetNeedsScan(profCurrent) === false);
check('CURRENT a stranger stays below the bar on a current bank',
  B.palmnetScoreProfile(profCurrent, [embB]) < B.PALMNET_THRESHOLD);

/* ---------------- re-bank replaces the stamp ------------------- */
const rebank = B.mergePalmnetEmbeddings(bankR1, [embB]);
check('REBANK merging into a stale bank banks under the CURRENT stamp',
  rebank.changed === true && !!rebank.neural && rebank.neural.model === B.PALMNET_MODEL_ID);
check('REBANK the stale embeddings are NOT carried into the new bank (only the fresh capture is in it)',
  rebank.total === 1 && rebank.added === 1 &&
  B.palmnetScoreProfile({ neural: rebank.neural }, [embB]) > 0.99 &&
  B.palmnetScoreProfile({ neural: rebank.neural }, [embA]) < B.PALMNET_THRESHOLD);
const rebankDup = B.mergePalmnetEmbeddings(bankR1, [embFrom(14, embA, 0.995)]);
check('REBANK a near-duplicate of a STALE embedding is still banked (stale vectors do not dedupe-block the re-bank)',
  rebankDup.changed === true && rebankDup.added === 1 && rebankDup.total === 1);
const rebankUnstamped = B.mergePalmnetEmbeddings(bankUnstamped, [embB]);
check('REBANK an unstamped bank re-banks the same way (ignored, then current-stamped)',
  rebankUnstamped.changed === true && rebankUnstamped.total === 1 && rebankUnstamped.neural.model === B.PALMNET_MODEL_ID);
const noBank = B.mergePalmnetEmbeddings(bankR1, []);
check('REBANK a capture that banks nothing leaves the stale bank object as-is (still stale, still stored)',
  noBank.changed === false && noBank.neural === bankR1 && B.palmnetProfileEmbeddings({ neural: noBank.neural }) === null);

/* ---------------- the banking guard applies staleness ---------- */
let g = B.bankingGuardCheck(profR1, { edccProbes: [], neuralEmbeddings: [embA2] });
check('GUARD stale bank + neural-only capture of the SAME palm => uncheckable (the neural leg ignores the stale bank)',
  g.status === 'uncheckable' && g.neuralChecked === false && g.edccChecked === false, JSON.stringify({ s: g.status, via: g.via }));
g = B.bankingGuardCheck(profR1, { edccProbes: candA, neuralEmbeddings: [] });
check('GUARD stale bank + the same palm\'s EDCC capture => pass via edcc (the EDCC leg judges)',
  g.status === 'pass' && g.via === 'edcc' && g.edccChecked === true, 'score ' + (g.edccScore && g.edccScore.toFixed(3)));
g = B.bankingGuardCheck(profR1, { edccProbes: candB, neuralEmbeddings: [embA2] });
check('GUARD stale bank + a DIFFERENT palm => fail on the EDCC evidence; the stale neural bank adds nothing',
  g.status === 'fail' && g.neuralChecked === false, JSON.stringify({ s: g.status, n: g.neuralChecked }));
const profNeuralDecides = { v: 4, format: 'packed96', codes: burstB.codes, neural: bankCurrent };
g = B.bankingGuardCheck(profNeuralDecides, { edccProbes: candA, neuralEmbeddings: [embA2] });
check('GUARD current bank + matching neural capture (EDCC side checked, fails) => pass via palmnet at the new bar',
  g.status === 'pass' && g.via === 'palmnet' && g.edccChecked === true && g.neuralScore >= B.PALMNET_THRESHOLD, 'score ' + (g.neuralScore && g.neuralScore.toFixed(3)));

/* ---------------- strict-money impostor-max staleness ---------- */
/* The app's neuralImpostorMaxFor is a max over palmnetScoreProfile
   of every OTHER profile; the sharpest case: an impostor profile
   whose stale bank holds the owner's exact embedding. If the
   staleness rule leaked, the "impostor max" would read 1.0. */
const impostorStale = { v: 4, format: 'packed96', codes: burstB.codes, neural: { v: 1, dim: 256, model: 'palmnet-v1', embeddings: [encA] } };
check('STRICT a stale impostor bank contributes NO neural impostor score (null, never 1.0)',
  B.palmnetScoreProfile(impostorStale, [embA]) === null);
check('STRICT the app impostor-max is built on the staleness-judging reader (source)',
  appSrc.indexOf('neuralImpostorMaxFor') !== -1 && appSrc.indexOf('B.palmnetScoreProfile(p.palmProfile') !== -1);
check('STRICT the app 1:N identify banks come from the same reader (source)',
  appSrc.indexOf('B.palmnetProfileEmbeddings(p.palmProfile)') !== -1);

/* ---------------- Field Test records carry the model id -------- */
check('FIELDTEST the terminal record builder stamps the running model id (source)',
  appSrc.indexOf('rec.neuralModel = B.PALMNET_MODEL_ID') !== -1);
(function () {
  const rec = { ts: 1700000000000, biomId: 'TSG-BIO-1', camera: 'Back', lighting: 'Room light',
    genuineScore: 0.41, impostorMax: 0.2, liveness: 'live', spoofTag: '', result: 'Accepted',
    neuralScore: 0.77, neuralImpostorMax: 0.1, acceptedBy: 'palmnet', neuralModel: B.PALMNET_MODEL_ID };
  const csv = B.fieldTestCsv([rec]);
  const lines = csv.trim().split('\n');
  check('FIELDTEST the CSV keeps its pinned nine columns even for a neuralModel-carrying record',
    lines.length === 2 &&
    lines[0] === 'timestamp,biom_id,camera,lighting,genuine_score,impostor_max_score,liveness,spoof_tag,result' &&
    lines[1].split(',').length === 9, lines[0]);
})();

/* ---------------- migration: adoption + read-time staleness ---- */
(function () {
  const store = { people: [{ id: 'TSG-BIO-1', name: 'Rig', limits: { perTx: 1000, daily: 5000 }, loyaltyPoints: 9,
    wallet: { balance: 450, statement: [{ kind: 'add', amount: 450, ref: 'DEMO-1' }], linkedAccounts: [{ id: 'a1', type: 'bKash', label: 'Rig bKash' }] },
    palmProfile: { v: 4, format: 'packed96', hand: 'left', codes: burstA.codes, neural: { v: 1, dim: 256, model: 'palmnet-v1', embeddings: [encA] } } }],
    logs: [], transactions: [], meta: [] };
  const before = JSON.stringify(store);
  const mig = B.migrateBiomData(JSON.parse(before), 'v53', 'v54');
  check('MIGRATION a wallet-and-stale-bank v53 store opens under v54 byte-identical',
    mig.appliedSteps.indexOf('v54') !== -1 && mig.changed === false && JSON.stringify(mig.snapshot) === before);
  const prof = mig.snapshot.people[0].palmProfile;
  check('MIGRATION after the adoption the Round-1 bank STILL reads as no neural evidence (staleness is read-time)',
    B.palmnetProfileEmbeddings(prof) === null && B.palmnetScoreProfile(prof, [embA]) === null && B.palmnetNeedsScan(prof) === true &&
    prof.neural.model === 'palmnet-v1');
})();

/* ---------------- versions -------------------------------------- */
// v55: the three absolute pins below were converted to the
// version-coherence form (the v48/v49/v50/v51/v52/v53 pattern)
// when v55 shipped — v54 remains IN the chain as an adoption
// step; the living current-version pins are in v38-migration
// + the v55 suite. The v54 proofs in this suite are unchanged.
check('VERSION app data version and shell version agree', (function () {
  const dv = (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1];
  const sv = (swSrc.match(/tsg-biom-shell-(v\d+)/) || [])[1];
  return !!dv && dv === sv;
})());
check('VERSION v54 remains in the chain as an adoption step', B.BIOM_DATA_VERSIONS.indexOf('v54') !== -1);

console.log(fail === 0 ? 'ALL v54 PALMNET-R3 TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
