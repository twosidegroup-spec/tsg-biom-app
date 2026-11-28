/* TSG BIOM v65 — TSG PALM ENGINE (TSG-ONLY property programme).
 *
 * v65 removes ONNX Runtime Web: the PalmNet model runs on
 * TwoSide Group's own inference engine (B.createTsgPalmEngine in
 * biometrics.js) reading TSG's own TSGP container. This suite
 * pins:
 *   1. the container's integrity vs the hashes pinned in app
 *      code (weights + program), and the manifest's honesty;
 *   2. the engine's functional parity on real fixtures vs the
 *      Python onnxruntime reference (the v47-parity discipline;
 *      SKIPs honestly when the bench is absent — the full gate
 *      over 720 ROIs / 43,200 scores is recorded in
 *      ~/workspace/tsg-biom-team/tsg-palm-engine/gate/parity-report.json);
 *   3. the absence of the retired runtime from everything the
 *      app ships (code, vendor tree, CSP surface);
 *   4. the worker assembly being TSG source only.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const B = require('../biometrics.js');

let pass = 0, fail = 0, skipped = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function skip(name, why) { skipped++; console.log('SKIP  ' + name + '  [' + why + ']'); }

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const bioSrc = fs.readFileSync(path.join(root, 'biometrics.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const manDir = path.join(root, 'models', 'palmnet');
const man = JSON.parse(fs.readFileSync(path.join(manDir, 'manifest.json'), 'utf8'));

/* ---------- 1. container integrity vs code pins ---------- */
const pinSha = (appSrc.match(/PALMNET_EXPECTED_SHA256 = '([0-9a-f]{64})'/) || [])[1];
const pinBytes = Number((appSrc.match(/PALMNET_EXPECTED_BYTES = (\d+)/) || [])[1]);
const pinProg = (appSrc.match(/PALMNET_EXPECTED_PROGRAM_SHA256 = '([0-9a-f]{64})'/) || [])[1];
check('CONTAINER manifest is the TSGP format', man.format === 'tsg-palm-engine-container' && man.modelId === 'palmnet-r3-ep12');
const weights = Buffer.from(man.parts.map(function (p) { return fs.readFileSync(path.join(manDir, p), 'utf8'); }).join(''), 'base64');
const wSha = crypto.createHash('sha256').update(weights).digest('hex');
check('CONTAINER weights reassemble to the manifest length', weights.length === man.weightsBytes, weights.length + ' vs ' + man.weightsBytes);
check('CONTAINER weights SHA-256 matches the manifest', wSha === man.weightsSha256, wSha.slice(0, 16) + '...');
check('CONTAINER weights SHA-256 + length match the pins in app code', wSha === pinSha && weights.length === pinBytes);
const programText = fs.readFileSync(path.join(manDir, man.programFile), 'utf8');
const pSha = crypto.createHash('sha256').update(programText, 'utf8').digest('hex');
check('CONTAINER program SHA-256 matches the manifest AND the pin in app code', pSha === man.programSha256 && pSha === pinProg, pSha.slice(0, 16) + '...');
const program = JSON.parse(programText);
check('CONTAINER program is a PalmNet schedule (113 fused nodes, weights index complete)',
  program.format === 'tsg-palm-engine-program' && program.nodes.length === 113 &&
  program.weights.totalFloats === weights.length / 4,
  program.nodes.length + ' nodes, ' + program.weights.totalFloats + ' floats');

/* ---------- 2. engine parity on fixtures ---------- */
const BENCH = path.join(os.homedir(), 'workspace', 'palmnet-bench');
const PY = process.env.PALMNET_BENCH_PYTHON || path.join(BENCH, 'venv', 'bin', 'python');
const PY_MODEL = path.join(BENCH, 'round3', 'integration-v54', 'palmnet_r3_snapshot.onnx');
const GRAY_DIR = path.join(BENCH, 'data', 'gray_eval');
const depsOk = fs.existsSync(PY) && fs.existsSync(PY_MODEL) && fs.existsSync(GRAY_DIR);
let engine = null;
try {
  engine = B.createTsgPalmEngine().load(program, weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.length));
} catch (e) { /* reported by the check below */ }
check('ENGINE the shipped container loads into the TSG Palm Engine', !!engine);
function engineEmbed(roiArr, size) {
  const input = B.palmnetPreprocessRoi(roiArr, size);
  const out = engine.run(input, [1, 3, B.PALMNET_INPUT_SIZE, B.PALMNET_INPUT_SIZE]);
  return Array.from(out.data);
}
if (depsOk && engine) {
  const REF_PY = path.join(os.tmpdir(), 'palmnet_ref_v65.py');
  fs.writeFileSync(REF_PY, [
    'import sys, json',
    'import numpy as np',
    'import onnxruntime as ort',
    'MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)',
    'STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)',
    'raw_path, model_path = sys.argv[1], sys.argv[2]',
    'a = np.fromfile(raw_path, dtype=np.uint8).astype(np.float32).reshape(128, 128) / 255.0',
    'x = np.stack([a, a, a], 0)',
    'x = ((x - MEAN[:, None, None]) / STD[:, None, None])[None].astype(np.float32)',
    's = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])',
    'e = s.run(None, {"image": x})[0][0]',
    'print(json.dumps(e.tolist()))',
    ''
  ].join('\n'));
  function pyEmbed(rawPath) {
    const out = execFileSync(PY, [REF_PY, rawPath, PY_MODEL], { maxBuffer: 1 << 24, timeout: 120000 });
    return JSON.parse(out.toString());
  }
  function diffStats(a, b) {
    let maxd = 0, dot = 0;
    for (let i = 0; i < a.length; i++) { maxd = Math.max(maxd, Math.abs(a[i] - b[i])); dot += a[i] * b[i]; }
    return { maxd: maxd, cos: dot };
  }
  const rawPath = path.join(GRAY_DIR, 'p012_c1.raw');
  const rawArr = Array.from(fs.readFileSync(rawPath));
  const dA = diffStats(engineEmbed(rawArr, 128), pyEmbed(rawPath));
  check('PARITY A native-128 real EVAL ROI: max |diff| <= 1e-4', dA.maxd <= 1e-4, 'max ' + dA.maxd.toExponential(3));
  check('PARITY A native-128 real EVAL ROI: cosine >= 0.999999', dA.cos >= 0.999999, dA.cos.toFixed(9));
  const synth = new Array(128 * 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    synth[y * 128 + x] = Math.max(0, Math.min(255, Math.round(127 + 90 * Math.sin(x / 9.0) * Math.cos(y / 7.0) + ((x * 31 + y * 17) % 23) - 11)));
  }
  const synthPath = path.join(os.tmpdir(), 'palmnet_synth_v65.raw');
  fs.writeFileSync(synthPath, Buffer.from(synth));
  const dC = diffStats(engineEmbed(synth, 128), pyEmbed(synthPath));
  check('PARITY C synthetic native-128: max |diff| <= 1e-4', dC.maxd <= 1e-4, 'max ' + dC.maxd.toExponential(3));
  check('PARITY C synthetic native-128: cosine >= 0.999999', dC.cos >= 0.999999, dC.cos.toFixed(9));
  /* A score-level check at the shipped bar: the same palm's
     probe must clear 0.5895 against its gallery through the
     engine exactly as the reference scores it. */
  const gal = [1, 2, 3].map(function (c) { return engineEmbed(Array.from(fs.readFileSync(path.join(GRAY_DIR, 'p012_c' + c + '.raw'))), 128); });
  const probe = engineEmbed(Array.from(fs.readFileSync(path.join(GRAY_DIR, 'p012_c4.raw'))), 128);
  const score = Math.max.apply(null, gal.map(function (g) { return B.palmnetCosine(g, probe); }));
  check('SCORE engine genuine score for palm 12 probe clears the shipped bar', score !== null && score >= B.PALMNET_THRESHOLD, 'score ' + (score && score.toFixed(4)) + ' vs ' + B.PALMNET_THRESHOLD);
} else {
  skip('PARITY fixtures', 'PalmNet-Bench venv/model/data absent on this machine (the full gate record stands in the team workspace)');
}

/* ---------- 3. the retired runtime is gone ---------- */
check('REMOVED no shipped file references the ONNX Runtime (any case) or its session API',
  [appSrc, bioSrc, html, swSrc].every(function (s) {
    return s.toLowerCase().indexOf('onnxruntime') === -1 && s.indexOf('InferenceSession') === -1;
  }));
check('REMOVED the vendored ONNX Runtime tree is deleted',
  !fs.existsSync(path.join(root, 'vendor', 'onnxruntime-web-1.20.1')));
check('REMOVED no CDN host is referenced by the shipped app files',
  [appSrc, bioSrc, html, swSrc].every(function (s) {
    return s.indexOf('cdn.jsdelivr.net') === -1 && s.indexOf('unpkg.com') === -1 && s.indexOf('fonts.googleapis.com') === -1;
  }));
check('REMOVED the old ONNX base64 parts are gone from models/',
  !fs.readdirSync(manDir).some(function (f) { return /^palmnet\.b64\.part/.test(f); }));

/* ---------- 4. worker assembly is TSG source only ---------- */
check('WORKER app assembles the PalmNet worker from the engine + preprocess sources',
  appSrc.indexOf('B.palmEngineSource()') !== -1 && appSrc.indexOf('B.palmnetPreprocessSource()') !== -1 &&
  appSrc.indexOf('createTsgPalmEngine().load') !== -1);
check('WORKER biometrics exports the engine factory + its source string',
  typeof B.createTsgPalmEngine === 'function' && typeof B.palmEngineSource === 'function' &&
  B.palmEngineSource().indexOf('function createTsgPalmEngine') !== -1);
check('WORKER the main-thread fallback creates the same engine (no second runtime)',
  appSrc.indexOf('B.createTsgPalmEngine().load') !== -1 && appSrc.indexOf('self.engine') !== -1);

console.log('v65 tsg engine: ' + pass + ' passed, ' + fail + ' failed, ' + skipped + ' skipped');
process.exit(fail ? 1 : 0);
