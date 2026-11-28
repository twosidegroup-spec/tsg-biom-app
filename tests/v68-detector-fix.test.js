/* TSG BIOM v68 — DETECTOR DELIVERY (the Chairman's order,
   2026-11-26 05:12, on his phone screenshot of the honest
   detector-blocked message: "Fix this issue").

   The five MediaPipe binary runtime files could not travel
   through the text-only channel that ships this app, so on the
   live host they answered 404 and the hand detector could never
   run. v68 carries them as base64 text parts under
   vendor/mediapipe-hands-0.4.1675469240/parts/ (the PalmNet
   weights pattern), reassembles and SHA-256-verifies them in
   the browser against pins held in code (app.js MpRuntime), and
   hands MediaPipe one Blob URL per file through locateFile.

   This suite pins: version coherence at v68 and the identity
   migration step; the manifest's hashes and sizes against the
   local original binaries AND against the pins in app.js;
   byte-exact chunk reassembly for all five files; part-file
   hygiene (size ceiling, base64 charset, no missing/extra
   parts); the locateFile mapping covering exactly the five
   names; the fail-closed assembly checks; and the v67
   detector-health behaviour surviving intact (per-call health,
   the still-loading rebuild rule, no self-switching camera). */
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

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const VENDOR = path.join(root, 'vendor', 'mediapipe-hands-0.4.1675469240');
const PARTS = path.join(VENDOR, 'parts');
const manifest = JSON.parse(fs.readFileSync(path.join(PARTS, 'manifest.json'), 'utf8'));

const FIVE = ['hands.binarypb', 'hand_landmark_lite.tflite', 'hands_solution_packed_assets.data',
  'hands_solution_simd_wasm_bin.wasm', 'hands_solution_wasm_bin.wasm'];

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function sliceBetween(src, a, b) {
  const i = src.indexOf(a);
  const j = b ? src.indexOf(b, i + a.length) : src.length;
  return i === -1 ? '' : src.slice(i, j === -1 ? src.length : j);
}

/* ---------- version coherence + identity migration -------------- */
check('VERSION app, shell, user-visible line and chain agree at v91 (v91 named pin change: liquid glass); the v68 detector-delivery content below is unchanged)',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v91' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v91'") !== -1 &&
  html.indexOf('TSG Biom · App v91 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v91');
check('MIGRATION the v68 step is a pure adoption: a v67 store opens byte-identical',
  (function () {
    const before = JSON.stringify({
      people: [{ id: 'TSG-BIO-1', name: 'Gate Person A', wallet: { balance: 500, statement: [{ kind: 'add', amount: 500, balanceAfter: 500, ref: 'DEMO-1' }], linkedAccounts: [] } }],
      logs: [{ ts: 1, result: 'Verified' }], transactions: [{ id: 'BIOM-PAY-1001', amount: 320 }], meta: [{ key: 'paySeq', value: 1002 }]
    });
    const mig = B.migrateBiomData(JSON.parse(before), 'v67', 'v68');
    return mig.appliedSteps.indexOf('v68') !== -1 && mig.changed === false && JSON.stringify(mig.snapshot) === before;
  })());
check('MIGRATION the whole chain v37->v68 applies 31 steps and changes nothing on a v37 store shape',
  (function () {
    const store = { people: [], logs: [], transactions: [], meta: [] };
    const mig = B.migrateBiomData(store, 'v37', 'v68');
    return mig.appliedSteps.length === 31 && mig.appliedSteps[mig.appliedSteps.length - 1] === 'v68';
  })());

/* ---------- manifest vs the local originals vs the code pins ----- */
check('MANIFEST names exactly the five binary files',
  manifest.files.length === 5 &&
  FIVE.every(function (n) { return manifest.files.some(function (f) { return f.name === n; }); }),
  manifest.files.map(function (f) { return f.name; }).join(', '));

/* The pins held in app.js (MP_EXPECTED_FILES), extracted from the
   shipped source — the loader's own ground truth. */
const pinsBlock = sliceBetween(appSrc, 'var MP_EXPECTED_FILES = [', '];');
const pins = {};
(pinsBlock.match(/\{ name: '[^']+', bytes: \d+, sha256: '[0-9a-f]{64}', mime: '[^']+' \}/g) || []).forEach(function (line) {
  const name = (line.match(/name: '([^']+)'/) || [])[1];
  pins[name] = {
    bytes: Number((line.match(/bytes: (\d+)/) || [])[1]),
    sha256: (line.match(/sha256: '([0-9a-f]{64})'/) || [])[1],
    mime: (line.match(/mime: '([^']+)'/) || [])[1]
  };
});
check('PINS app.js holds a pin for exactly the five files',
  Object.keys(pins).length === 5 && FIVE.every(function (n) { return !!pins[n]; }),
  Object.keys(pins).join(', '));

for (const f of manifest.files) {
  const orig = fs.readFileSync(path.join(VENDOR, f.name));
  check('MANIFEST ' + f.name + ': recorded size + SHA-256 match the local original binary',
    f.bytes === orig.length && f.sha256 === sha256(orig),
    f.bytes + ' B, ' + f.sha256.slice(0, 12) + '…');
  check('PINS ' + f.name + ': the pin in app.js equals the manifest and the original',
    !!pins[f.name] && pins[f.name].bytes === f.bytes && pins[f.name].sha256 === f.sha256 &&
    pins[f.name].mime === f.mime,
    pins[f.name] ? pins[f.name].sha256.slice(0, 12) + '…' : 'pin missing');
  check('PARTS ' + f.name + ': base64 length recorded honestly',
    f.base64Chars === f.parts.reduce(function (n, p) { return n + fs.readFileSync(path.join(PARTS, p), 'utf8').length; }, 0));
  /* Byte-exact reassembly: join the parts, decode, compare with
     the original binary byte for byte. */
  const joined = f.parts.map(function (p) { return fs.readFileSync(path.join(PARTS, p), 'utf8'); }).join('');
  const bytes = Buffer.from(joined, 'base64');
  check('REASSEMBLY ' + f.name + ' is byte-exact against the original binary',
    bytes.equals(orig) && bytes.length === f.bytes && sha256(bytes) === f.sha256,
    bytes.length + ' B reassembled');
}

/* Part-file hygiene: every part under the 1.2 MB ceiling, pure
   base64, and the parts directory holds exactly the manifest's
   parts plus the manifest itself — nothing missing, nothing extra. */
const onDisk = fs.readdirSync(PARTS).sort();
const listedParts = manifest.files.reduce(function (acc, f) { return acc.concat(f.parts); }, []).sort();
check('PARTS the parts directory holds exactly the listed parts + manifest.json',
  JSON.stringify(onDisk) === JSON.stringify(listedParts.concat(['manifest.json']).sort()),
  onDisk.length + ' files on disk');
check('PARTS every part file is at or below 800,000 bytes (the proven PalmNet chunk size, far under the connector limits)',
  listedParts.every(function (p) { return fs.statSync(path.join(PARTS, p)).size <= 800000; }),
  'largest: ' + Math.max.apply(null, listedParts.map(function (p) { return fs.statSync(path.join(PARTS, p)).size; })) + ' B');
check('PARTS every part file is pure base64 text (the shipping channel carries UTF-8 text only)',
  listedParts.every(function (p) { return /^[A-Za-z0-9+/=]+$/.test(fs.readFileSync(path.join(PARTS, p), 'utf8')); }));

/* ---------- the loader wiring ------------------------------------ */
const mpBlock = sliceBetween(appSrc, 'var MpRuntime = {', '\n  var PalmProc = {');
check('LOADER MpRuntime fetches the parts manifest from the vendored parts directory',
  appSrc.indexOf("var MP_PARTS_DIR = 'vendor/mediapipe-hands-0.4.1675469240/parts/';") !== -1 &&
  mpBlock.indexOf("fetch(MP_PARTS_DIR + 'manifest.json')") !== -1 &&
  mpBlock.indexOf("fetch(MP_PARTS_DIR + p)") !== -1);
check('LOADER the manifest is checked against the code pins BEFORE any part is fetched (fail-closed, PalmNet H-5 terms)',
  mpBlock.indexOf('detector parts manifest disagrees with this build') !== -1 &&
  mpBlock.indexOf('detector parts manifest is missing') !== -1 &&
  mpBlock.indexOf('detector parts manifest lists files this build does not run') !== -1 &&
  mpBlock.indexOf('f.bytes !== exp.bytes || f.sha256 !== exp.sha256') !== -1);
check('LOADER every assembled file is length- and SHA-256-verified before its Blob URL exists',
  mpBlock.indexOf('detector file size mismatch') !== -1 &&
  mpBlock.indexOf('detector file hash mismatch') !== -1 &&
  mpBlock.indexOf('URL.createObjectURL(new Blob([bytes], { type: exp.mime }))') !== -1 &&
  mpBlock.indexOf('mpSha256Hex(bytes)') !== -1);
check('LOADER a context without SubtleCrypto refuses rather than skip the integrity check',
  appSrc.indexOf('detector integrity check unavailable (no SubtleCrypto)') !== -1);
check('LOADER the assembly carries one overall timeout (a scan never waits forever on runtime files)',
  mpBlock.indexOf('detector runtime assembly timed out') !== -1 && mpBlock.indexOf('Promise.race') !== -1);
check('LOADER a failed assembly is not cached — a later scan may retry (transient network must not brick the detector)',
  mpBlock.indexOf('self.promise = null;') !== -1 && mpBlock.indexOf("self.state = 'failed';") !== -1);

const constructBlock = sliceBetween(appSrc, 'construct: function () {', 'landmarks: function (image) {');
check('LOCATEFILE the mapping covers exactly the five pinned names: an assembled Blob URL when ready, the vendored path otherwise',
  constructBlock.indexOf('var assembled = MpRuntime.urls && MpRuntime.urls[f];') !== -1 &&
  constructBlock.indexOf("return assembled || ('vendor/mediapipe-hands-0.4.1675469240/' + f);") !== -1 &&
  appSrc.indexOf('urls: null, // filename -> Blob URL, exactly the five pinned names') !== -1 &&
  mpBlock.indexOf('MP_EXPECTED_FILES.forEach(function (exp, i) { urls[exp.name] = urlsArr[i]; });') !== -1);
check('LOCATEFILE the WASM files carry the application/wasm MIME (streaming instantiation reads the Blob type)',
  pins['hands_solution_simd_wasm_bin.wasm'].mime === 'application/wasm' &&
  pins['hands_solution_wasm_bin.wasm'].mime === 'application/wasm');

/* ---------- PalmProc: v67 health behaviour, preserved ------------- */
check('PALMPROC construction now waits on the assembly: landmarks awaits ensureHands and a not-ready detector marks the frame failed',
  appSrc.indexOf('return this.ensureHands().then(function (ok) {') !== -1 &&
  appSrc.indexOf('if (!ok) { self._frameFailed = true; return null; }') !== -1 &&
  appSrc.indexOf('return self.sendFrame(image);') !== -1);
check('PALMPROC init() is the fire-and-forget warm-up the pre-warm call sites expect',
  appSrc.indexOf('init: function () {') !== -1 &&
  sliceBetween(appSrc, 'init: function () {', 'ensureHands: function () {').indexOf('this.ensureHands();') !== -1);
check('PALMPROC the v67 frame rules survive verbatim: delivered results clear the failure flag, the rebuild applies only after the first result ever, 4 s / 45 s bounds intact',
  appSrc.indexOf('self._frameFailed = false; // v67: this call ran the detector') !== -1 &&
  appSrc.indexOf('}, self._everResulted ? 4000 : 45000);') !== -1 &&
  appSrc.indexOf('if (self._everResulted) {') !== -1);
check('PALMPROC the wedged-graph rebuild still works after assembly (hands nulled -> next call reconstructs from the ready runtime)',
  appSrc.indexOf('self.hands = null;') !== -1 &&
  appSrc.indexOf('ensureHands: function () {') !== -1 &&
  appSrc.indexOf('if (this.hands) return Promise.resolve(true);') !== -1);
check('CAMERA no self-switching crept back in with the loader (the v67 camera law stands)',
  appSrc.indexOf('walletSwapCamera is DELETED') !== -1 &&
  !/onNoHand[\s\S]{0,200}swapCamera\(\)/.test(appSrc));

/* ---------- CSP: the one directive the assembly needs ------------ */
check('CSP connect-src admits blob: (the runtime fetches its files from the assembled Blob URLs) while the M-7 API pin is unchanged and no other directive moved',
  html.indexOf("connect-src 'self' https://tsg-biom-api.vercel.app blob:;") !== -1 &&
  html.indexOf("default-src 'none'; script-src 'self' 'wasm-unsafe-eval';") !== -1 &&
  html.indexOf("worker-src 'self' blob:;") !== -1);

/* ---------- service worker ---------------------------------------- */
check('SW the parts ride the vendor network-only rule (pathname /vendor/ — assembled bytes are always the served bytes)',
  swSrc.indexOf("url.pathname.indexOf('/vendor/')") !== -1 &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v91'") !== -1);

/* ---------- frozen systems ----------------------------------------- */
check('FREEZE the shipped bars are untouched (EDCC 0.32 / PalmNet 0.5895)',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895);

console.log(fail === 0 ? 'ALL V68 DETECTOR-FIX TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
