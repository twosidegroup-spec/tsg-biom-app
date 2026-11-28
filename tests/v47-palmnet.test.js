/* TSG BIOM v47 — PalmNet neural matcher: pure logic + wiring pins.

   Proven here (all in biometrics.js, the shipping pure layer):
   - The accept threshold is the running model's PalmNet-Bench
     EVAL clean EER threshold, with its source stated in the
     code. (v54: the Round 3 model's bar, 0.5895 — the Round 1
     model's 0.5773 derivation this suite originally pinned is
     recorded in git history and in the v54 measurement.)
   - palmnetPreprocessRoi replicates the bench eval preprocessing
     (128x128 grayscale -> /255 -> 3 channels -> ImageNet
     MEAN/STD normalisation), at the native size and from the
     app's 96x96 ROI; the worker bundle source
     (palmnetPreprocessSource) evaluates to the SAME function —
     the worker runs this code, not a copy.
   - The embedding codec round-trips; cosine behaves; banking
     dedupes and caps; fixture enrolment + matching accepts a
     genuine probe and rejects an impostor at the derived bar.
   - THE FUSED DECISION: EDCC at its untouched 0.32 bar OR
     PalmNet at its bar; no neural evidence => the EDCC verdict
     stands alone (the v46 behaviour, bit-for-bit).
   - Legacy fallback: a packed96 profile without a neural bank
     is EDCC-only and reports "Neural scan needed"; corrupt
     neural data is ignored, never thrown on.
   - Field Test records carry the per-system neural scores and
     the fused FAR; the CSV export keeps its pinned v18 columns.
   - Fail-soft wiring in app.js: the PalmNet runtime state
     machine, the bounded embed wait, the model manifest +
     SHA-256 check, the Registry Neural Scan action, enrolment
     banking — and the service worker shell does NOT precache
     the model, so an install can never fail on it.
   The ONNX-level parity against the Python pipeline (real model,
   real ROIs) lives in tests/v47-parity.test.js. All numbers here
   are RIG numbers; the phone is the verdict. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= eps; }

/* ---------- threshold + provenance ---------- */
check('THRESHOLD PalmNet accept bar is the bench EER threshold 0.5895 (v54: Round 3 model)', B.PALMNET_THRESHOLD === 0.5895, String(B.PALMNET_THRESHOLD));
const bioSrc = fs.readFileSync(path.join(__dirname, '..', 'biometrics.js'), 'utf8');
check('THRESHOLD source is stated in the code (integration-v54 measurement, EVAL clean)',
  bioSrc.indexOf('integration-v54/measurement.md') !== -1 && bioSrc.indexOf('0.5895') !== -1 && bioSrc.indexOf('42,840') !== -1);
check('THRESHOLD is labelled a lab-derived starting point, not a phone threshold',
  bioSrc.indexOf('LAB-DERIVED STARTING POINT') !== -1);
check('EDCC bar untouched at 0.32', B.PALMPRINT_THRESHOLD === 0.32);
check('MODEL contract constants: 128 input, 256-d embedding', B.PALMNET_INPUT_SIZE === 128 && B.PALMNET_EMBED_DIM === 256);
check('NORMALISATION constants are the bench ImageNet MEAN/STD',
  B.PALMNET_MEAN.join(',') === '0.485,0.456,0.406' && B.PALMNET_STD.join(',') === '0.229,0.224,0.225');

/* ---------- preprocessing ---------- */
const N128 = 128 * 128;
const flat = new Array(N128).fill(128);
const flatOut = B.palmnetPreprocessRoi(flat, 128);
check('PREPROCESS output is 3x128x128 float32', flatOut instanceof Float32Array && flatOut.length === 3 * N128);
check('PREPROCESS flat patch: channel 0 value is (128/255 - 0.485)/0.229',
  approx(flatOut[0], (128 / 255 - 0.485) / 0.229, 1e-6), String(flatOut[0]));
check('PREPROCESS flat patch: channel 1 uses MEAN/STD of channel 1',
  approx(flatOut[N128], (128 / 255 - 0.456) / 0.224, 1e-6), String(flatOut[N128]));
check('PREPROCESS flat patch: channel 2 uses MEAN/STD of channel 2',
  approx(flatOut[2 * N128 + 999], (128 / 255 - 0.406) / 0.225, 1e-6), String(flatOut[2 * N128 + 999]));
const ramp = new Array(N128);
for (let i = 0; i < N128; i++) ramp[i] = i % 256;
const rampOut = B.palmnetPreprocessRoi(ramp, 128);
check('PREPROCESS planar layout: pixel i feeds all three channel planes',
  approx(rampOut[5], (5 / 255 - 0.485) / 0.229, 1e-6) && approx(rampOut[N128 + 5], (5 / 255 - 0.456) / 0.224, 1e-6) &&
  approx(rampOut[2 * N128 + 5], (5 / 255 - 0.406) / 0.225, 1e-6));
const roi96 = new Array(96 * 96);
for (let i = 0; i < roi96.length; i++) roi96[i] = (i * 7) % 256;
const out96 = B.palmnetPreprocessRoi(roi96, 96);
check('PREPROCESS 96x96 ROI resamples to the 128 contract', out96 instanceof Float32Array && out96.length === 3 * N128 &&
  Array.prototype.every.call(out96, function (v) { return isFinite(v); }));
check('PREPROCESS rejects wrong lengths and null', B.palmnetPreprocessRoi([1, 2, 3], 96) === null && B.palmnetPreprocessRoi(null, 96) === null &&
  B.palmnetPreprocessRoi(roi96, 0) === null);
/* The worker bundle IS this implementation: evaluate the shipped
   source bundle in a fresh context and compare outputs exactly. */
const wctx = {};
vm.createContext(wctx);
vm.runInContext(B.palmnetPreprocessSource(), wctx);
const wOut = wctx.palmnetPreprocessRoi(roi96, 96);
let wSame = wOut && wOut.length === out96.length;
if (wSame) for (let i = 0; i < out96.length; i++) { if (wOut[i] !== out96[i]) { wSame = false; break; } }
check('WORKER preprocess bundle produces byte-identical tensors', wSame === true);

/* ---------- embedding codec + cosine ---------- */
function basis(idx) { const v = new Float32Array(256); v[idx] = 1; return v; }
function mixCos(a, b, cos) {
  const s = Math.sqrt(1 - cos * cos);
  const out = new Float32Array(256);
  for (let i = 0; i < 256; i++) out[i] = cos * a[i] + s * b[i];
  return out;
}
const e1 = basis(0), e2 = basis(1), e3 = basis(2), e4 = basis(3);
const b64e1 = B.palmnetEmbeddingToBase64(e1);
const back1 = B.palmnetEmbeddingFromBase64(b64e1);
check('CODEC round-trips an embedding', !!back1 && approx(B.palmnetCosine(e1, back1), 1, 1e-6));
check('CODEC stored form is 1024 bytes of float32 (1368 base64 chars)', typeof b64e1 === 'string' && b64e1.length === 1368, String(b64e1 && b64e1.length));
check('COSINE identical = 1, orthogonal = 0, opposite = -1',
  approx(B.palmnetCosine(e1, e1), 1, 1e-6) && approx(B.palmnetCosine(e1, e2), 0, 1e-6) &&
  approx(B.palmnetCosine(e1, mixCos(e1, e2, -1)), -1, 1e-6));
check('COSINE controlled mix lands on the requested cosine', approx(B.palmnetCosine(e1, mixCos(e1, e2, 0.62)), 0.62, 1e-6));
check('SANE rejects wrong dimension, NaN and the zero vector',
  !B.palmnetEmbeddingSane(new Float32Array(255)) && !B.palmnetEmbeddingSane(new Float32Array(256)) &&
  !B.palmnetEmbeddingSane(Array.from({ length: 256 }, function (_, i) { return i === 7 ? NaN : 0.1; })) &&
  B.palmnetEmbeddingSane(e1));
check('CODEC rejects garbage and wrong-length payloads',
  B.palmnetEmbeddingFromBase64('!!!not-base64!!!') === null && B.palmnetEmbeddingFromBase64('QUJD') === null &&
  B.palmnetEmbeddingFromBase64('') === null && B.palmnetEmbeddingToBase64(new Float32Array(256)) === null);

/* ---------- banking: enrolment fixtures, dedupe, cap ---------- */
const embA1 = e1;
const embA2 = mixCos(e1, e2, 0.95); // a second capture of the same palm
const bank = B.palmnetBankFromEmbeddings([embA1, embA2]);
check('BANK builds a current-stamp palmnet bank from enrolment embeddings',
  !!bank && bank.v === 1 && bank.dim === 256 && bank.model === B.PALMNET_MODEL_ID && bank.embeddings.length === 2);
const many = [];
for (let i = 0; i < 8; i++) many.push(basis(i));
const bankCapped = B.palmnetBankFromEmbeddings(many);
check('BANK caps at PALMNET_PROFILE_MAX_EMBEDDINGS', bankCapped.embeddings.length === B.PALMNET_PROFILE_MAX_EMBEDDINGS,
  String(bankCapped.embeddings.length));
const dupMerge = B.mergePalmnetEmbeddings(bank, [mixCos(e1, e3, 0.999)]);
check('MERGE skips a near-duplicate candidate (cosine >= dedupe bar)',
  dupMerge.changed === false && dupMerge.added === 0 && dupMerge.skipped === 1 && dupMerge.neural === bank);
const addMerge = B.mergePalmnetEmbeddings(bank, [e3]);
check('MERGE adds a diverse candidate', addMerge.changed === true && addMerge.added === 1 && addMerge.total === 3 &&
  B.palmnetProfileEmbeddings({ neural: addMerge.neural }).length === 3);
const fullMerge = B.mergePalmnetEmbeddings(bankCapped, [basis(200)]);
check('MERGE respects the cap on a full bank', fullMerge.changed === false && fullMerge.total === B.PALMNET_PROFILE_MAX_EMBEDDINGS);
check('BANK of nothing / garbage is null', B.palmnetBankFromEmbeddings([]) === null &&
  B.palmnetBankFromEmbeddings([new Float32Array(256)]) === null && B.palmnetBankFromEmbeddings(null) === null);

/* ---------- profile states: banked, needs-scan, legacy, corrupt ---------- */
const profileBanked = { v: 4, format: 'packed96', codes: ['R0hJ'], neural: bank };
const profilePlain = { v: 4, format: 'packed96', codes: ['R0hJ'] };
const profileLegacy = { v: 4, format: 'legacy', codes: [], legacyCodes: ['QUJD'], rescanNeeded: true };
const profileCorrupt = { v: 4, format: 'packed96', codes: ['R0hJ'], neural: { v: 1, dim: 256, embeddings: ['!!!', 'QUJD'] } };
check('PROFILE with a bank is neural-sane and does not need a scan',
  B.palmnetProfileSane(profileBanked) === true && B.palmnetNeedsScan(profileBanked) === false);
check('PROFILE packed96 without a bank needs a neural scan (EDCC-only until then)',
  B.palmnetProfileSane(profilePlain) === false && B.palmnetNeedsScan(profilePlain) === true);
check('PROFILE legacy needs a palm re-scan, NOT a neural scan',
  B.palmnetNeedsScan(profileLegacy) === false && B.palmnetProfileSane(profileLegacy) === false);
check('PROFILE corrupt neural payload is ignored, never thrown on',
  B.palmnetProfileSane(profileCorrupt) === false && B.palmnetNeedsScan(profileCorrupt) === true &&
  B.palmnetScoreProfile(profileCorrupt, [e1]) === null);

/* ---------- matching on fixture embeddings ---------- */
const genuineProbe = mixCos(e1, e3, 0.85);
const tiltProbe = mixCos(e1, e3, 0.62);   // the rescue band: EDCC fails tilt, neural at 0.62 clears the 0.5895 bar
const belowProbe = mixCos(e1, e3, 0.50);
const impostorProbe = e4;
check('SCORE genuine probe vs bank is its best cosine', approx(B.palmnetScoreProfile(profileBanked, [genuineProbe]), 0.85, 1e-5),
  String(B.palmnetScoreProfile(profileBanked, [genuineProbe])));
check('SCORE mirror-twin probe set takes the max over probes',
  approx(B.palmnetScoreProfile(profileBanked, [impostorProbe, genuineProbe]), 0.85, 1e-5));
check('SCORE impostor probe is ~0', approx(B.palmnetScoreProfile(profileBanked, [impostorProbe]), 0, 1e-6));
check('SCORE with no bank or no probes is null (no evidence, never a zero)',
  B.palmnetScoreProfile(profilePlain, [genuineProbe]) === null && B.palmnetScoreProfile(profileBanked, []) === null &&
  B.palmnetScoreProfile(profileBanked, null) === null);

/* ---------- THE FUSED DECISION ---------- */
function edcc(sim) {
  return { ok: true, verified: sim >= B.PALMPRINT_THRESHOLD, similarity: sim, threshold: B.PALMPRINT_THRESHOLD,
    reason: sim >= B.PALMPRINT_THRESHOLD ? 'Palmprint matched.' : 'Palmprint similarity below the threshold.' };
}
let f = B.fusePalmVerifyResults(edcc(0.20), B.palmnetScoreProfile(profileBanked, [genuineProbe]));
check('FUSION neural rescues an EDCC fail (acceptedBy palmnet, EDCC score reported unchanged)',
  f.verified === true && f.acceptedBy === 'palmnet' && f.similarity === 0.20 && f.threshold === 0.32 &&
  approx(f.neuralScore, 0.85, 1e-5) && f.neuralThreshold === 0.5895);
f = B.fusePalmVerifyResults(edcc(0.20), B.palmnetScoreProfile(profileBanked, [tiltProbe]));
check('FUSION the tilt band (neural 0.62) accepts where EDCC cannot', f.verified === true && f.acceptedBy === 'palmnet');
f = B.fusePalmVerifyResults(edcc(0.20), B.palmnetScoreProfile(profileBanked, [belowProbe]));
check('FUSION neural below its bar (0.50) does NOT accept', f.verified === false && f.acceptedBy === null);
f = B.fusePalmVerifyResults(edcc(0.20), B.palmnetScoreProfile(profileBanked, [impostorProbe]));
check('FUSION impostor rejected by both systems', f.verified === false && f.acceptedBy === null && approx(f.neuralScore, 0, 1e-6));
f = B.fusePalmVerifyResults(edcc(0.50), null);
check('FUSION no neural evidence: the EDCC verdict stands alone (v46 behaviour)',
  f.verified === true && f.acceptedBy === 'edcc' && f.neuralScore === null);
f = B.fusePalmVerifyResults(edcc(0.20), null);
check('FUSION no neural evidence: an EDCC fail stays a fail', f.verified === false && f.acceptedBy === null && f.neuralScore === null);
f = B.fusePalmVerifyResults(edcc(0.50), 0.90);
check('FUSION both systems over their bars: acceptedBy both', f.verified === true && f.acceptedBy === 'both');
f = B.fusePalmVerifyResults(edcc(0.20), B.PALMNET_THRESHOLD);
check('FUSION a neural score exactly AT the threshold accepts (>= rule)', f.verified === true && f.acceptedBy === 'palmnet');
f = B.fusePalmVerifyResults(edcc(0.20), B.PALMNET_THRESHOLD - 0.0001);
check('FUSION a neural score a hair below the threshold rejects', f.verified === false);
const edccShift = Object.assign(edcc(0.50), { shiftLog: [{ dx: 0, dy: 0, score: 0.5 }] });
f = B.fusePalmVerifyResults(edccShift, null);
check('FUSION carries the Field Test exhaustive shift log through', Array.isArray(f.shiftLog) && f.shiftLog.length === 1);

/* ---------- Field Test: fused records, pinned CSV ---------- */
const ftRecs = [
  { ts: 1, biomId: 'A', camera: 'front', lighting: '', genuineScore: 0.20, impostorMax: 0.10, liveness: 'pass', spoofTag: 'real_hand', result: 'verified', neuralScore: 0.85, neuralImpostorMax: 0.61, acceptedBy: 'palmnet' },
  { ts: 2, biomId: 'B', camera: 'front', lighting: '', genuineScore: 0.50, impostorMax: 0.10, liveness: 'pass', spoofTag: 'real_hand', result: 'verified', neuralScore: 0.90, neuralImpostorMax: 0.20, acceptedBy: 'both' }
];
const ftStats = B.fieldTestStats(ftRecs);
check('FIELDTEST GAR follows the FUSED verdict (result field)', ftStats.genuine.gar === 100 && ftStats.genuine.attempts === 2);
check('FIELDTEST FAR counts a neural impostor crossing its own bar', ftStats.impostor.falseAccepts === 1 && ftStats.impostor.far === 50,
  'falseAccepts=' + ftStats.impostor.falseAccepts);
const ftCsv = B.fieldTestCsv(ftRecs);
check('FIELDTEST CSV keeps the pinned v18 header even for neural records',
  ftCsv.split('\n')[0] === 'timestamp,biom_id,camera,lighting,genuine_score,impostor_max_score,liveness,spoof_tag,result');
check('FIELDTEST CSV rows keep nine cells', ftCsv.trim().split('\n')[1].split(',').length === 9);

/* ---------- fail-soft + wiring pins (app.js / sw.js) ---------- */
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
check('APP PalmNet runtime exists with an explicit state machine',
  appSrc.indexOf('var PalmNet = {') !== -1 && appSrc.indexOf("state: 'idle'") !== -1 && appSrc.indexOf("self.state = 'failed'") !== -1);
check('APP fail-soft note is honest and EDCC-only', appSrc.indexOf('PalmNet neural matcher unavailable') !== -1 && appSrc.indexOf('EDCC only') !== -1);
check('APP embed wait is bounded (a hung runtime cannot stall a scan)', appSrc.indexOf('waitMs(6000)') !== -1);
check('APP worker preprocessing is assembled from biometrics (single implementation)',
  appSrc.indexOf('B.palmnetPreprocessSource()') !== -1);
check('APP model loads from the in-repo manifest with a SHA-256 check',
  appSrc.indexOf('models/palmnet/manifest.json') !== -1 && appSrc.indexOf('model hash mismatch') !== -1);
check('APP runtime is the TSG Palm Engine shipped inside biometrics.js (v65 named pin change: ONNX Runtime Web removed entirely — TSG-ONLY programme; the v64 vendored-copy pin is superseded)',
  appSrc.indexOf('B.palmEngineSource()') !== -1 &&
  appSrc.indexOf('vendor/onnxruntime-web-1.20.1/ort.wasm.min.js') === -1 &&
  appSrc.indexOf('cdn.jsdelivr.net/npm/onnxruntime-web') === -1);
check('APP enrolment banks neural embeddings from the burst picks',
  appSrc.indexOf('palmnetBankFromEmbeddings') !== -1 && appSrc.indexOf('sel.picks') !== -1);
check('APP Registry shows Neural scan needed + the Neural Scan action',
  appSrc.indexOf('Neural scan needed') !== -1 && appSrc.indexOf('data-neural') !== -1 && appSrc.indexOf("openTopup(b.dataset.neural, 'neural')") !== -1);
check('APP topup has a neural-only mode and Add Angles merges neural too',
  appSrc.indexOf("topupMode === 'neural'") !== -1 && appSrc.indexOf('mergePalmnetEmbeddings') !== -1);
check('APP both scan streams take fused decisions',
  (appSrc.match(/fusePalmVerifyResults/g) || []).length >= 4 &&
  appSrc.indexOf('neuralMeasuredStr') !== -1 && appSrc.indexOf('neuralImpostorMaxFor') !== -1);
check('APP Field Test records store the per-system neural scores',
  appSrc.indexOf('rec.neuralScore') !== -1 && appSrc.indexOf('rec.neuralImpostorMax') !== -1 && appSrc.indexOf('rec.acceptedBy') !== -1);
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const shellBlock = swSrc.slice(swSrc.indexOf('const SHELL'), swSrc.indexOf('];', swSrc.indexOf('const SHELL')));
check('SW shell does NOT precache the model (install can never fail on it)', shellBlock.indexOf('palmnet') === -1 && shellBlock.indexOf('models/') === -1);
const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'models', 'palmnet', 'manifest.json'), 'utf8'));
check('MODEL manifest is coherent (v65 named pin change: the TSGP container — weights parts + program, sizes add up)',
  man.format === 'tsg-palm-engine-container' && man.bytes === 4278756 && typeof man.sha256 === 'string' && man.sha256.length === 64 &&
  man.parts.length === 7 && man.parts.every(function (p) { return fs.existsSync(path.join(__dirname, '..', 'models', 'palmnet', p)); }) &&
  fs.existsSync(path.join(__dirname, '..', 'models', 'palmnet', 'program.json')));

console.log(fail === 0 ? 'ALL v47 PALMNET TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
