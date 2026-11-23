/* TSG BIOM v47 — PalmNet PREPROCESSING / EMBEDDING PARITY.

   The correctness gate for the neural matcher: the SAME ROI must
   produce the SAME embedding through
     (a) the Python pipeline the model was trained/evaluated with
         (palmnet-bench code/04_eval_export.py load_raw: uint8
         grayscale /255, repeat to 3 channels, ImageNet MEAN/STD
         normalisation; the ORIGINAL two-file ONNX export under
         Python onnxruntime), and
     (b) the app's shipping path (B.palmnetPreprocessRoi + ONNX
         Runtime Web, WASM, numThreads=1 exactly as the app's
         worker configures it, running the model reassembled from
         the repo's own base64 parts — length + SHA-256 verified
         against models/palmnet/manifest.json first).

   Paths proven:
     A  native 128x128 (a real Tongji EVAL gallery ROI): the JS
        resampler is the identity here, so this isolates the
        normalisation + runtime numerics.
        Tolerance: max |diff| <= 1e-4, cosine >= 0.999999.
        (Measured at build time: 4.6e-07 / 0.99999998.)
     B  the app's real input shape: the same palm as a 96x96
        patch (the v45 affine ROI size). JS preprocesses the
        float patch (its own bilinear 96->128); Python gets the
        same patch quantised to uint8 and PIL-BILINEAR-resizes it
        — the residual is PIL's fixed-point resampler vs the
        float one, stated honestly.
        Tolerance: max |diff| <= 2e-2, cosine >= 0.999.
        (Measured at build time: 7.6e-03 / 0.99922.)
     C  a synthetic deterministic 128x128 pattern, native path —
        parity that does not depend on the bench dataset files.

   Dependencies (NOT part of the shipped repo): onnxruntime-web
   resolvable from the app's node_modules (install with:
   npm install --no-save onnxruntime-web@1.20.1) and the
   PalmNet-Bench venv + model (~/workspace/palmnet-bench, python
   override via PALMNET_BENCH_PYTHON). When a dependency is
   absent the suite prints SKIP and exits 0 — it never fakes a
   pass: every check below runs only against real outputs.
   Rig inference timings are printed, labelled RIG; the phone is
   the verdict. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { execFileSync } = require('child_process');
const B = require('../biometrics.js');

let pass = 0, fail = 0, skipped = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function skip(name, why) { skipped++; console.log('SKIP  ' + name + '  [' + why + ']'); }

const BENCH = path.join(os.homedir(), 'workspace', 'palmnet-bench');
const PY = process.env.PALMNET_BENCH_PYTHON || path.join(BENCH, 'venv', 'bin', 'python');
const PY_MODEL = path.join(BENCH, 'models', 'palmnet.onnx');
const GRAY_DIR = path.join(BENCH, 'data', 'gray_eval');

let ort = null;
try { ort = require('onnxruntime-web'); } catch (e) { /* handled below */ }
const depsOk = !!ort && fs.existsSync(PY) && fs.existsSync(PY_MODEL) && fs.existsSync(GRAY_DIR);
if (!depsOk) {
  skip('parity suite', 'onnxruntime-web and/or the PalmNet-Bench venv/model/data are absent on this machine');
  console.log('v47 parity: ' + pass + ' passed, ' + fail + ' failed, ' + skipped + ' skipped (dependencies absent)');
  process.exit(0);
}

/* The Python reference: the bench eval preprocessing, verbatim in
   spirit (04_eval_export.py load_raw) + PIL for the 96 path. */
const REF_PY = path.join(os.tmpdir(), 'palmnet_ref_v47.py');
fs.writeFileSync(REF_PY, [
  'import sys, json',
  'import numpy as np',
  'import onnxruntime as ort',
  'MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)',
  'STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)',
  'mode, raw_path, model_path = sys.argv[1], sys.argv[2], sys.argv[3]',
  'if mode == "native128":',
  '    a = np.fromfile(raw_path, dtype=np.uint8).astype(np.float32).reshape(128, 128) / 255.0',
  'elif mode == "pil96":',
  '    from PIL import Image',
  '    img = Image.fromarray(np.fromfile(raw_path, dtype=np.uint8).reshape(96, 96), "L")',
  '    a = np.asarray(img.resize((128, 128), Image.BILINEAR)).astype(np.float32) / 255.0',
  'else:',
  '    raise SystemExit("unknown mode")',
  'x = np.stack([a, a, a], 0)',
  'x = ((x - MEAN[:, None, None]) / STD[:, None, None])[None].astype(np.float32)',
  's = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])',
  'e = s.run(None, {"image": x})[0][0]',
  'print(json.dumps(e.tolist()))',
  ''
].join('\n'));
function pyEmbed(mode, rawPath) {
  const out = execFileSync(PY, [REF_PY, mode, rawPath, PY_MODEL], { maxBuffer: 1 << 24, timeout: 120000 });
  return JSON.parse(out.toString());
}
function diffStats(a, b) {
  let maxd = 0, dot = 0;
  for (let i = 0; i < a.length; i++) { maxd = Math.max(maxd, Math.abs(a[i] - b[i])); dot += a[i] * b[i]; }
  return { maxd: maxd, cos: dot };
}

async function main() {
  /* The shipped artifact first: reassemble + verify the model
     exactly as the app does (length + SHA-256 vs the manifest). */
  const manDir = path.join(__dirname, '..', 'models', 'palmnet');
  const man = JSON.parse(fs.readFileSync(path.join(manDir, 'manifest.json'), 'utf8'));
  const bytes = Buffer.from(man.parts.map(function (p) { return fs.readFileSync(path.join(manDir, p), 'utf8'); }).join(''), 'base64');
  check('MODEL shipped parts reassemble to the manifest byte count', bytes.length === man.bytes, bytes.length + ' vs ' + man.bytes);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  check('MODEL shipped parts match the manifest SHA-256', sha === man.sha256, sha.slice(0, 16) + '...');

  ort.env.wasm.numThreads = 1; // the app worker's configuration
  const session = await ort.InferenceSession.create(bytes);
  async function jsEmbed(roi, size) {
    const input = B.palmnetPreprocessRoi(roi, size);
    const out = await session.run({ image: new ort.Tensor('float32', input, [1, 3, 128, 128]) });
    return Array.from(out.embedding.data);
  }

  /* Fixture A: a real Tongji EVAL gallery ROI, native 128 path. */
  let galleryFile = 'p012_c1.raw';
  try {
    const rows = fs.readFileSync(path.join(BENCH, 'data', 'manifest_eval.csv'), 'utf8').replace(/\r/g, '').trim().split('\n').slice(1);
    const g = rows.map(function (l) { return l.split(','); }).find(function (r) { return r[2] === 'gallery'; });
    if (g) galleryFile = g[3];
  } catch (e) {}
  const rawPath = path.join(GRAY_DIR, galleryFile);
  const rawArr = Array.from(fs.readFileSync(rawPath));
  const pyA = pyEmbed('native128', rawPath);
  const jsA = await jsEmbed(rawArr, 128);
  const dA = diffStats(jsA, pyA);
  check('PARITY A native-128 real ROI: max |diff| <= 1e-4', dA.maxd <= 1e-4, 'max ' + dA.maxd.toExponential(3));
  check('PARITY A native-128 real ROI: cosine >= 0.999999', dA.cos >= 0.999999, dA.cos.toFixed(9));

  /* Fixture B: the same palm as a 96x96 patch (the app's input). */
  const wctx = {};
  vm.createContext(wctx);
  vm.runInContext(B.palmnetPreprocessSource(), wctx);
  const roi96 = Array.from(wctx.resizeGrayBilinear(rawArr, 128, 128, 96));
  const patchPath = path.join(os.tmpdir(), 'palmnet_roi96_v47.raw');
  fs.writeFileSync(patchPath, Buffer.from(roi96.map(function (v) { return Math.max(0, Math.min(255, Math.round(v))); })));
  const pyB = pyEmbed('pil96', patchPath);
  const jsB = await jsEmbed(roi96, 96);
  const dB = diffStats(jsB, pyB);
  check('PARITY B 96->128 same patch: max |diff| <= 2e-2 (PIL fixed-point vs float bilinear)', dB.maxd <= 2e-2, 'max ' + dB.maxd.toExponential(3));
  check('PARITY B 96->128 same patch: cosine >= 0.999', dB.cos >= 0.999, dB.cos.toFixed(9));

  /* Fixture C: synthetic deterministic pattern, native path. */
  const synth = new Array(128 * 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    synth[y * 128 + x] = Math.max(0, Math.min(255, Math.round(127 + 90 * Math.sin(x / 9.0) * Math.cos(y / 7.0) + ((x * 31 + y * 17) % 23) - 11)));
  }
  const synthPath = path.join(os.tmpdir(), 'palmnet_synth_v47.raw');
  fs.writeFileSync(synthPath, Buffer.from(synth));
  const pyC = pyEmbed('native128', synthPath);
  const jsC = await jsEmbed(synth, 128);
  const dC = diffStats(jsC, pyC);
  check('PARITY C synthetic native-128: max |diff| <= 1e-4', dC.maxd <= 1e-4, 'max ' + dC.maxd.toExponential(3));
  check('PARITY C synthetic native-128: cosine >= 0.999999', dC.cos >= 0.999999, dC.cos.toFixed(9));

  /* Rig inference timing (ORT Web WASM, numThreads=1, Node):
     pure session.run on the fixture-A tensor, then end-to-end
     (preprocess + run) on the 96 path — the app's real per-ROI
     cost shape. RIG numbers; the phone is the verdict. */
  const tensorA = new ort.Tensor('float32', B.palmnetPreprocessRoi(rawArr, 128), [1, 3, 128, 128]);
  for (let i = 0; i < 10; i++) await session.run({ image: tensorA });
  const ts = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    await session.run({ image: tensorA });
    ts.push(performance.now() - t0);
  }
  ts.sort(function (a, b) { return a - b; });
  const median = ts[Math.floor(ts.length / 2)];
  const mean = ts.reduce(function (a, b) { return a + b; }, 0) / ts.length;
  console.log('  ..  RIG ONLY — ORT Web (WASM, 1 thread) inference per ROI: median ' + median.toFixed(2) + ' ms, mean ' + mean.toFixed(2) + ' ms, p95 ' + ts[Math.floor(ts.length * 0.95)].toFixed(2) + ' ms (Node on this shared VM; not a phone number).');
  check('RIG inference sanity: median under 1000 ms', median < 1000, median.toFixed(2) + ' ms');
  const te = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    await jsEmbed(roi96, 96);
    te.push(performance.now() - t0);
  }
  te.sort(function (a, b) { return a - b; });
  console.log('  ..  RIG ONLY — end-to-end per ROI on the 96 path (JS preprocess + inference): median ' + te[Math.floor(te.length / 2)].toFixed(2) + ' ms.');

  console.log(fail === 0 ? 'ALL v47 PARITY TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(function (e) { console.error('PARITY SUITE ERROR', e); process.exit(1); });
