/* TSG BIOM v64 — DESIGN POLISH + SECURITY HARDENING (the
   Chairman's order, 2026-11-25 11:46; team record:
   ~/workspace/tsg-biom-team/V64-DESIGN-SECURITY-2026-11-25.md).

   What v64 does: a polish + hardening release on top of v63. Both
   third-party runtimes (MediaPipe Hands, ONNX Runtime Web) are
   self-hosted under vendor/ so no unauthenticated code executes
   in the credential-holding origin (Seat 2 H-1/H-2); app +
   dashboard carry meta-delivered CSPs with connect-src pinned to
   the one API (Step 5.1, M-7 decided); the PalmNet model's
   SHA-256 + byte length are pinned IN CODE and verified on both
   loader paths, failing soft to EDCC-only when SubtleCrypto is
   absent (H-5); the service worker no longer caches models/ or
   vendor/ (M-3). Design: guidance parity on every scan surface
   (Seat 1 G-1), token hygiene, motion tokens with transform-only
   progress, reduced-motion support, aria state publication,
   skeletons, projected balances, the footer + Done-screen
   hard-defect fixes (H-1/H-2), badge contrast (H-3/A-5).

   This suite pins those properties against the shipped files. */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const bioSrc = fs.readFileSync(path.join(root, 'biometrics.js'), 'utf8');
const shipped = { 'index.html': html, 'app.js': appSrc, 'styles.css': css, 'sw.js': swSrc, 'biometrics.js': bioSrc };

/* ---------- CSP + self-hosting (Seat 2 H-1/H-2/H-3, Step 5.1) ----- */
const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
check('CSP the app ships a Content-Security-Policy meta', csp.indexOf("default-src 'none'") === 0);
check("CSP script-src is self + wasm-unsafe-eval only (both wasm runtimes die without it)",
  csp.indexOf("script-src 'self' 'wasm-unsafe-eval'") !== -1 && csp.indexOf("script-src-attr 'none'") !== -1);
check('CSP connect-src is pinned to the TSG Biom API (M-7 decided: the endpoint is fixed for this build; v68 named pin change: blob: added — the assembled detector runtime is fetched from Blob URLs minted by this origin\'s own scripts, the same treatment worker-src/img-src/media-src already carry; blob: names no network endpoint, so the M-7 endpoint pin stands)',
  csp.indexOf("connect-src 'self' https://tsg-biom-api.vercel.app blob:") !== -1);
check('CSP framing, objects and forms are closed', csp.indexOf("frame-src 'none'") !== -1 &&
  csp.indexOf("object-src 'none'") !== -1 && csp.indexOf("form-action 'self'") !== -1);
check('CSP the page sends no referrer', html.indexOf('<meta name="referrer" content="no-referrer">') !== -1);
check('SELF-HOST no shipped file references the jsDelivr CDN any more',
  Object.keys(shipped).every(function (k) { return shipped[k].indexOf('cdn.jsdelivr.net') === -1; }));
check('SELF-HOST MediaPipe loads from the vendored copy (script tag + locateFile)',
  html.indexOf('src="vendor/mediapipe-hands-0.4.1675469240/hands.js?b=v94"') !== -1 &&
  appSrc.indexOf("'vendor/mediapipe-hands-0.4.1675469240/' + f") !== -1);
check('SELF-HOST ONNX Runtime is REMOVED — the TSG Palm Engine ships in biometrics.js (v65 named pin change: the v64 vendored-runtime pin is superseded by the TSG-ONLY programme)',
  appSrc.indexOf('B.palmEngineSource()') !== -1 &&
  appSrc.indexOf('vendor/onnxruntime-web-1.20.1/ort.wasm.min.js') === -1 &&
  !fs.existsSync(path.join(root, 'vendor', 'onnxruntime-web-1.20.1')));
check('SELF-HOST the vendored runtime files exist on disk (MediaPipe only since v65)',
  ['vendor/mediapipe-hands-0.4.1675469240/hands.js',
   'vendor/mediapipe-hands-0.4.1675469240/hands_solution_simd_wasm_bin.wasm',
   'vendor/mediapipe-hands-0.4.1675469240/hand_landmark_lite.tflite'
  ].every(function (p) { return fs.existsSync(path.join(root, p)); }));

/* ---------- model integrity (Seat 2 H-5) -------------------------- */
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'models', 'palmnet', 'manifest.json'), 'utf8'));
const pinSha = (appSrc.match(/PALMNET_EXPECTED_SHA256 = '([0-9a-f]{64})'/) || [])[1];
const pinBytes = Number((appSrc.match(/PALMNET_EXPECTED_BYTES = (\d+)/) || [])[1]);
check('MODEL the SHA-256 pinned in code equals the shipped manifest hash', pinSha === manifest.sha256, pinSha);
check('MODEL the byte length pinned in code equals the shipped manifest bytes', pinBytes === manifest.bytes, String(pinBytes));
check('MODEL the worker loader verifies against the pins (signature + manifest pre-check + never-skip; v65: weights + program pins)',
  appSrc.indexOf('function loadModel(manifestUrl, expectedModelId, expectedWeightsSha256, expectedWeightsBytes, expectedProgramSha256)') !== -1 &&
  appSrc.indexOf('man.weightsSha256 !== expectedWeightsSha256') !== -1);
check('MODEL the main-thread fallback verifies length AND hash (v65 named pin change: fetchModelContainer carries the v64 gauntlet to the TSGP container)',
  (function () {
    const fb = appSrc.slice(appSrc.indexOf('fetchModelContainer: function'), appSrc.indexOf('initMainThread: function'));
    return fb.indexOf('PALMNET_EXPECTED_BYTES') !== -1 && fb.indexOf('PALMNET_EXPECTED_SHA256') !== -1 &&
      fb.indexOf("crypto.subtle.digest('SHA-256', bytes)") !== -1;
  })());
check('MODEL a context without SubtleCrypto fails soft with the reason stated, on both paths',
  (appSrc.match(/no SubtleCrypto/g) || []).length >= 2);

/* ---------- service worker (Seat 2 M-3) ---------------------------- */
check('SW the shell is v88 and models/ + vendor/ are network-only (never cached; (v94 named pin change: declutter))',
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v94'") !== -1 &&
  swSrc.indexOf("url.pathname.indexOf('/models/')") !== -1 &&
  swSrc.indexOf("url.pathname.indexOf('/vendor/')") !== -1);

/* ---------- design system pins (Seat 1) ---------------------------- */
check('DESIGN theme-color is the house deep blue (the WhatsApp-teal token is retired)',
  html.indexOf('<meta name="theme-color" content="#0b4ea2">') !== -1 && html.indexOf('#075e55') === -1);
check('DESIGN H-1: the footer no longer claims descriptors stay on this device (false since v56 sync)',
  html.indexOf('stay on this device') === -1 && html.indexOf('never a palm image') !== -1);
check('DESIGN H-2: the enrolment Done owner actions are owner-only',
  /class="btn owner-only" id="enrollDoneRegistry"/.test(html) && /class="btn owner-only" id="enrollDoneTerminal"/.test(html));
check('DESIGN H-3/A-5: the warn token darkened for contrast (--warn #7c5507)',
  css.indexOf('--warn:#7c5507') !== -1);
check('DESIGN G-1: pill + Hand/Light/Steady indicators exist on all four scan surfaces',
  ['w', 'e', 't', 'u'].every(function (p) {
    return html.indexOf('id="' + p + 'IndHand"') !== -1 && html.indexOf('id="' + p + 'IndLight"') !== -1 &&
      html.indexOf('id="' + p + 'IndSteady"') !== -1 && html.indexOf('id="' + p + 'ScanPillText"') !== -1;
  }) && appSrc.indexOf('function makeScanIndicators(prefix)') !== -1 &&
  appSrc.indexOf('enrolInds.update') !== -1 && appSrc.indexOf('termInds.update') !== -1 && appSrc.indexOf('topupInds.update') !== -1);
check('DESIGN M-1: motion tokens exist and progress bars move by transform, never width',
  css.indexOf('--dur-state:180ms') !== -1 && css.indexOf('--dur-page:300ms') !== -1 &&
  css.indexOf('transform:scaleX(.3333)') !== -1 &&
  appSrc.indexOf("$('enrollProgressBar').style.transform") !== -1 &&
  appSrc.indexOf("$('enrollProgressBar').style.width") === -1);
check('DESIGN M-1: no CSS transition animates a layout property (transform/opacity/colour only)',
  (function () {
    const decls = css.match(/transition:[^;}]+/g) || [];
    return decls.length > 0 && decls.every(function (d) {
      return !/\b(width|height|top|left|right|bottom|margin|padding|all)\b/.test(d);
    });
  })(), (css.match(/transition:[^;}]+/g) || []).length + ' transition declarations audited');
check('DESIGN M-2: a reduced-motion block collapses durations and stills the scan pulse',
  css.indexOf('@media (prefers-reduced-motion: reduce)') !== -1 && css.indexOf('animation:none') !== -1);
check('DESIGN A-1/A-2: toggle + expansion state is published (aria-pressed / aria-expanded / aria-current), toast is a status region',
  appSrc.indexOf("setAttribute('aria-pressed'") !== -1 && appSrc.indexOf("setAttribute('aria-expanded'") !== -1 &&
  appSrc.indexOf("setAttribute('aria-current', 'page')") !== -1 && /id="toast"[^>]*role="status"/.test(html));
check('DESIGN A-3/A-4: one focus-visible rule and the 44px chip floor',
  css.indexOf(':focus-visible') !== -1 && /\.chip\{[^}]*min-height:44px/.test(css));
check('DESIGN M-3/R-UX2: the two projected-balance lines exist and are wired (v90: the Send step bar and its line left with the Send flow)',
  html.indexOf('id="wSendProgressBar"') === -1 &&
  ['wAddProjected', 'wPayProjected'].every(function (id) { return html.indexOf('id="' + id + '"') !== -1; }) &&
  html.indexOf('id="wSendProjected"') === -1 &&
  appSrc.indexOf('function setSendProgress(step)') === -1 && appSrc.indexOf('function updateProjected(') !== -1 &&
  appSrc.indexOf('balanceFlashPending = true') !== -1);
check('DESIGN L-1: the wallet chooser skeleton exists in markup + CSS and retires when profiles render',
  css.indexOf('.skelcard') !== -1 && html.indexOf('id="walletProfilesSkeleton"') !== -1 &&
  appSrc.indexOf("skel.classList.add('hidden')") !== -1);
check('DESIGN C-2: the layered pre-scan copy keeps every consent sentence reachable (details fold)',
  html.indexOf('class="scanprep"') !== -1 && html.indexOf('<details class="copyfold">') !== -1 &&
  html.indexOf('Your palm is stored as a') !== -1 && html.indexOf('sealed palm code') !== -1);
check('DESIGN R-36: the static store-mode titles no longer say CVS; the STORES data value is untouched (data half deferred)',
  html.indexOf('<h3>Pharmacy</h3>') !== -1 && html.indexOf('Pharmacy, Supermarket, Retail, Mall') !== -1 &&
  appSrc.indexOf("'GreenCare Pharmacy (CVS)'") !== -1);

/* ---------- no-emoji scan of the shipped files --------------------- */
check('DESIGN no emoji characters in any shipped file (Material Rounded icons + text only)',
  (function () {
    const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}\u{20E3}]/u;
    return Object.keys(shipped).every(function (k) { return !re.test(shipped[k]); });
  })());

console.log(fail === 0 ? 'ALL V64 DESIGN-SECURITY TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
