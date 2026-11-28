/* TSG BIOM v77 — PERFORMANCE PASS (the Chairman's order,
   2026-11-27 01:20: "full fledged scan and fix the lag hang and
   make it ultra smoothness like butter. Smooth flow no hang no
   stuck... and make it a proper web app").

   What this suite pins:
   - version coherence at the current version (the pin rolled to v78 at the dashboard-control bump) + the v77 step as a pure adoption;
   - the chunked base64 decoder, BEHAVIOURALLY: extracted from
     app.js and run against the real pinned parts — its output
     must hash to the in-code SHA-256 pins, and it must agree
     byte-for-byte with the one-shot decoder on padding edge
     cases;
   - fetchWithTimeout, behaviourally: a hanging fetch is aborted
     at the bound, a fast fetch resolves untouched;
   - the boot reordering: routing + splash drop precede the sync
     flush/pull; flush still precedes pull;
   - the pre-warm scheduling: Pipeline.start is no longer called
     synchronously at init; it is scheduled from dropBootSplash
     on idle time with a first-interaction kick;
   - the worker loader's self-contained bounded fetch (the v55
     harness contract: palmnetWorkerMain must not reference
     main-thread helpers);
   - the vendored loader's progress-reporter guard (the blob:
     page-error root cause);
   - :has() gone from the shell CSS; the sheet/detail states ride
     maintained classes; box-shadow no longer transitions;
   - the enrolment Strengthen listener leak (onclick assignment);
   - search debounce; the logs DOM cap;
   - the PWA completion set: manifest colours match the app,
     a dedicated maskable icon exists at 512x512, no forced
     portrait orientation, capability metas, dialog semantics on
     the four wallet sheets;
   - frozen systems: EDCC 0.32 / PalmNet 0.5895, the five
     MediaPipe pins, the v75 boot mechanics strings. */
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
function finish() {
  console.log(fail === 0 ? 'ALL V77 PERFORMANCE TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
}

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const loaderSrc = fs.readFileSync(path.join(root, 'vendor/mediapipe-hands-0.4.1675469240/hands_solution_packed_assets_loader.js'), 'utf8');

/* ---------- version coherence + identity migration -------------- */
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v91',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v91' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v91'") !== -1 &&
  html.indexOf('<meta name="biom-build" content="v91">') !== -1 &&
  html.indexOf('TSG Biom · App v91 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v91' &&
  B.BIOM_DATA_VERSIONS.length === 55);
check('MIGRATION the v77 step is a pure adoption: a v76 store opens byte-identical at v77', (function () {
  const before = JSON.stringify({ people: [{ id: 'TSG-BIO-1', name: 'Gate' }], logs: [], transactions: [], meta: [{ k: 'x', v: 1 }] });
  const mig = B.migrateBiomData(JSON.parse(before), 'v76', 'v77');
  return mig.appliedSteps.join(',') === 'v77' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
})());
check('MIGRATION the whole chain v37->v77 applies 40 steps', (function () {
  const mig = B.migrateBiomData({ people: [], logs: [], transactions: [], meta: [] }, 'v37', 'v77');
  return mig.appliedSteps.length === 40 && mig.appliedSteps[mig.appliedSteps.length - 1] === 'v77';
})());

/* ---------- frozen systems -------------------------------------- */
check('FREEZE the shipped bars are untouched (EDCC 0.32 / PalmNet 0.5895)',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895);
check('FREEZE the five MediaPipe pins are untouched', ['ab76c4215fca99cc2db1b5885cb8398d210e59ebe685245f72e692b4b58421e4',
  'd7fde8ac11f8ce03f8663775bfc323f4fc9f2a38062b4f4efa142874ef5b2a48', 'bdce7b66bfc5b39ba86a47775c98e0b186fe73f8308c2279f852af4c89ffdf42',
  '78ef7eb86ebc6424ac06b13f89b9a1fc01ff35e07520e37de98887cf88c06653', '4e70eaf8063e0e9ac10e682d9d6b55c08d0788f0a8d49925e2e484636526e157']
  .every(function (h) { return appSrc.indexOf(h) !== -1; }));
check('FREEZE the v75 boot mechanics survive (splash hold, 6 s bound, watchdog)',
  appSrc.indexOf('var SPLASH_MAX_MS = 6000;') !== -1 &&
  appSrc.indexOf('function dropBootSplash()') !== -1 &&
  html.indexOf('bootSplashFailOpen') !== -1);

/* ---------- boot reordering + pre-warm scheduling --------------- */
const bootChain = appSrc.slice(appSrc.indexOf('DB.open().then(function () { return Vault.init(); })'), appSrc.indexOf("catch(function () { dropBootSplash(); }); // v75"));
check('BOOT the boot chain is extractable', bootChain.length > 500);
check('BOOT routing and splash drop precede the sync flush; flush still precedes pull', (function () {
  const iFace = bootChain.indexOf('applyInitialFace()');
  const iDrop = bootChain.indexOf('dropBootSplash(); })');
  const iFlush = bootChain.indexOf('Sync.flush()');
  const iPull = bootChain.indexOf('Sync.pull()');
  return iFace !== -1 && iDrop !== -1 && iFlush !== -1 && iPull !== -1 && iFace < iFlush && iDrop < iFlush && iFlush < iPull;
})());
check('BOOT Pipeline.start is not called synchronously at init; the pre-warm is idle-scheduled from dropBootSplash',
  appSrc.indexOf('function schedulePipelinePrewarm()') !== -1 &&
  appSrc.indexOf('requestIdleCallback(run, { timeout: 2500 })') !== -1 &&
  appSrc.indexOf('schedulePipelinePrewarm(); // v77: first screen is up') !== -1 &&
  appSrc.indexOf("Pipeline.start(); // v43") === -1);
check('BOOT the first interaction kicks the pre-warm immediately',
  appSrc.indexOf("window.addEventListener('pointerdown', kick, true)") !== -1 &&
  appSrc.indexOf("window.addEventListener('keydown', kick, true)") !== -1);

/* ---------- bounded fetches ------------------------------------- */
check('NET the sync layer rides the bounded fetch (20 s)',
  appSrc.indexOf('fetchFn: function (url, opts) { return fetchWithTimeout(url, opts, 20000); }') !== -1);
check('NET the payments rail rides the bounded fetch (20 s)',
  appSrc.indexOf('return fetchWithTimeout(url, opts, 20000).then(function (r) { // v77: bounded') !== -1);
check('NET the main-thread model loader rides the bounded fetch (30 s)',
  appSrc.indexOf('return fetchWithTimeout(self.modelManifest, null, 30000)') !== -1);
check('NET the worker loader is self-contained: its own fetchBounded, no main-thread helper calls', (function () {
  const seg = appSrc.slice(appSrc.indexOf('function palmnetWorkerMain()'), appSrc.indexOf('var PalmNet = {'));
  return seg.indexOf('function fetchBounded(url, ms)') !== -1 && seg.indexOf('fetchWithTimeout(') === seg.indexOf("main thread's fetchWithTimeout") + "main thread's fetchWithTimeout".length - 'fetchWithTimeout'.length + 0 || (seg.indexOf('function fetchBounded(url, ms)') !== -1 && !/fetchWithTimeout\(/.test(seg.replace("main thread's fetchWithTimeout", '')));
})());
check('NET the vendored packed-assets loader carries the progress-reporter guard (blob: page-error root cause)',
  loaderSrc.indexOf('if (Module.dataFileDownloads && Module.dataFileDownloads[url]) Module.dataFileDownloads[url].loaded = event.loaded;') !== -1 &&
  loaderSrc.indexOf('TSG local patch (v77') !== -1);

/* ---------- CSS smoothness -------------------------------------- */
check('CSS no body:has() or section:has() selectors remain in the shell stylesheet (comments may still name the old form)',
  !/^\s*body:has\(/m.test(css) && css.indexOf('#page-registry.active:has(') === -1 &&
  css.indexOf(':has(#page-wallet.active') === -1);
check('CSS the sheet backdrop rides the maintained body.sheet-open class',
  css.indexOf('body.sheet-open .sheet-backdrop{display:block}') !== -1);
check('CSS the registry detail grid rides the maintained .detail-open class',
  css.indexOf('#page-registry.active.detail-open{display:grid') !== -1);
check('CSS box-shadow no longer transitions on the tapped controls or the balance hero',
  css.indexOf('background var(--dur-state) var(--ease-std),box-shadow') === -1 &&
  css.indexOf('.balcard{transition:box-shadow') === -1);
check('APP the sheet/detail classes are maintained from the elements\u2019 own class changes (one MutationObserver)',
  appSrc.indexOf('new MutationObserver(syncSheetClasses)') !== -1 &&
  appSrc.indexOf("classList.toggle('sheet-open'") !== -1 &&
  appSrc.indexOf("classList.toggle('detail-open'") !== -1);

/* ---------- interaction smoothness ------------------------------- */
check('APP the enrolment Strengthen offer binds by assignment (the stacked-listener leak is closed)',
  appSrc.indexOf('goBtn.onclick = function') !== -1 &&
  appSrc.indexOf("goBtn.addEventListener('click'") === -1);
check('APP registry and terminal search are debounced at 150 ms',
  appSrc.indexOf("addEventListener('input', debounce(renderRegistry, 150))") !== -1 &&
  appSrc.indexOf("addEventListener('input', debounce(renderTermPeople, 150))") !== -1);
check('APP the logs render caps its DOM build (data and export untouched)',
  appSrc.indexOf('var LOG_DOM_CAP = 200;') !== -1 && appSrc.indexOf('txs.slice(0, LOG_DOM_CAP)') !== -1);
check('APP the burst ring repaints only on whole-percent change, label node cached',
  appSrc.indexOf('ring._v77pct === whole') !== -1 && appSrc.indexOf('ring._v77lbl') !== -1);
check('APP the scratch canvases assign size only on change',
  appSrc.indexOf('if (analysisScratch.width !== aw) analysisScratch.width = aw;') !== -1 &&
  appSrc.indexOf('if (canvas.width !== gw) canvas.width = gw;') !== -1 &&
  appSrc.indexOf('measuresScratch.width = size; measuresScratch.height = size; }') !== -1);
check('SCAN warm-up sends are single-flighted until the first result lands (Seat 3 race fix)',
  appSrc.indexOf('if (self._everResulted) return self.sendFrame(image);') !== -1 &&
  appSrc.indexOf('self._warmChain = p.then(function () {}, function () {});') !== -1);

/* ---------- proper web app (PWA) --------------------------------- */
check('PWA manifest colours match the app (theme + splash background are the v66 blue)',
  manifest.theme_color === '#0b4ea2' && manifest.background_color === '#0b4ea2');
check('PWA the manifest carries a dedicated maskable icon, and the file is a 512x512 PNG', (function () {
  const entry = (manifest.icons || []).filter(function (i) { return i.purpose === 'maskable'; })[0];
  if (!entry || entry.src !== 'icons/icon-maskable-512.png') return false;
  const buf = fs.readFileSync(path.join(root, 'icons', 'icon-maskable-512.png'));
  return buf.slice(1, 4).toString('latin1') === 'PNG' && buf.readUInt32BE(16) === 512 && buf.readUInt32BE(20) === 512;
})());
check('PWA no forced portrait orientation (desktop/terminal landscape is allowed)',
  !('orientation' in manifest));
check('PWA capability metas are present for installed-app behaviour',
  html.indexOf('name="mobile-web-app-capable"') !== -1 &&
  html.indexOf('name="apple-mobile-web-app-capable"') !== -1 &&
  html.indexOf('name="apple-mobile-web-app-title"') !== -1);
check('PWA the three wallet sheets carry dialog semantics (v90: the Send sheet is removed)',
  ['walletAdd', 'walletPay', 'walletScanCard'].every(function (id) {
    return html.indexOf('id="' + id + '" class="card hidden" role="dialog" aria-modal="true"') !== -1;
  }) && html.indexOf('id="walletSend"') === -1);
check('APP Escape closes an open sheet through its own Back/Cancel control',
  appSrc.indexOf("if (ev.key !== 'Escape') return;") !== -1 &&
  appSrc.indexOf("closeId: 'wScanCancel'") !== -1);

/* ---------- behavioural: fetchWithTimeout ------------------------ */
function extractFn(name, endMarker) {
  const i = appSrc.indexOf('function ' + name + '(');
  const j = appSrc.indexOf(endMarker, i);
  return appSrc.slice(i, j);
}
const fwtSrc = extractFn('fetchWithTimeout', '/* v77: the detector/model pre-warm');
const fwtFactory = new Function('fetch', 'AbortController', 'setTimeout', 'clearTimeout',
  fwtSrc + '\nreturn fetchWithTimeout;');
(function () {
  const hangFetch = function (url, opts) {
    return new Promise(function (resolve, reject) {
      /* a faithful fetch stand-in: like the real fetch, it
         rejects when the caller's AbortSignal fires */
      if (opts && opts.signal) opts.signal.addEventListener('abort', function () {
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
      });
    });
  };
  const fastFetch = function () { return Promise.resolve({ ok: true, status: 200 }); };
  const fwtHang = fwtFactory(hangFetch, AbortController, setTimeout, clearTimeout);
  const fwtFast = fwtFactory(fastFetch, AbortController, setTimeout, clearTimeout);
  const t0 = Date.now();
  let hangOutcome = 'pending';
  fwtHang('https://rig.invalid/slow', null, 60).then(function () { hangOutcome = 'resolved'; }, function (e) { hangOutcome = 'rejected:' + (e && e.name); });
  fwtFast('https://rig.invalid/fast', null, 5000).then(function (r) {
    check('BEHAVIOUR fetchWithTimeout resolves a fast fetch untouched', r && r.ok === true);
    setTimeout(function () {
      check('BEHAVIOUR fetchWithTimeout aborts a hanging fetch at the bound', hangOutcome.indexOf('rejected') === 0 && (Date.now() - t0) < 3000, hangOutcome + ' after ~' + (Date.now() - t0) + 'ms');
      decoderChecks();
    }, 400);
  }, function () { check('BEHAVIOUR fetchWithTimeout resolves a fast fetch untouched', false); decoderChecks(); });
})();

/* ---------- behavioural: the chunked decoder vs the pins --------- */
function decoderChecks() {
  const decSrc = (function () {
    const i = appSrc.indexOf('var MP_B64_TABLE = null;');
    const j = appSrc.indexOf('function mpSha256Hex', i);
    return appSrc.slice(appSrc.indexOf('function mpB64ToBytesChunked', i) !== -1 ? appSrc.indexOf('function mpB64ToBytesChunked', i) : i, j);
  })();
  let decode = null;
  try {
    decode = new Function('setTimeout', 'Promise', appSrc.slice(appSrc.indexOf('var MP_B64_TABLE = null;'), appSrc.indexOf('function mpSha256Hex')) + '\nreturn mpB64ToBytesChunked;')(setTimeout, Promise);
  } catch (e) { check('BEHAVIOUR the chunked decoder is extractable', false, e.message); finish(); return; }
  check('BEHAVIOUR the chunked decoder is extractable', typeof decode === 'function');
  const cases = [[], [1], [1, 2], [1, 2, 3], [255, 254, 253, 252, 251]];
  let seed = 42;
  const big = new Uint8Array(700001);
  for (let i = 0; i < big.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; big[i] = seed & 255; }
  cases.push(Array.from(big.slice(0, 999)));
  const jobs = cases.map(function (arr) {
    const bytes = Uint8Array.from(arr);
    const b64 = Buffer.from(bytes).toString('base64');
    return decode(b64).then(function (out) {
      return Buffer.from(out).equals(Buffer.from(bytes));
    });
  });
  jobs.push(decode(Buffer.from(big).toString('base64')).then(function (out) {
    return Buffer.from(out).equals(Buffer.from(big));
  }));
  /* the real pinned file: hands.binarypb's parts, decoded by the
     extracted chunked decoder, must hash to the in-code pin */
  const partsDir = path.join(root, 'vendor/mediapipe-hands-0.4.1675469240/parts');
  const man = JSON.parse(fs.readFileSync(path.join(partsDir, 'manifest.json'), 'utf8'));
  const entry = man.files.filter(function (f) { return f.name === 'hands.binarypb'; })[0];
  const joined = entry.parts.map(function (p) { return fs.readFileSync(path.join(partsDir, p), 'utf8'); }).join('').replace(/\s+/g, '');
  jobs.push(decode(joined).then(function (out) {
    const hex = crypto.createHash('sha256').update(Buffer.from(out)).digest('hex');
    return out.length === 550 && hex === 'ab76c4215fca99cc2db1b5885cb8398d210e59ebe685245f72e692b4b58421e4';
  }));
  Promise.all(jobs).then(function (results) {
    check('BEHAVIOUR the chunked decoder is byte-exact on padding edge cases and a 700 KB payload', results.slice(0, -1).every(Boolean));
    check('BEHAVIOUR the chunked decoder assembles a real pinned file to its SHA-256 pin', results[results.length - 1] === true);
    finish();
  }).catch(function (e) {
    check('BEHAVIOUR decoder jobs complete', false, e && e.message);
    finish();
  });
}
