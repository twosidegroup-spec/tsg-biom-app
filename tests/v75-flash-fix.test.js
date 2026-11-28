/* TSG BIOM v75 — FLASH FIX (the Chairman's reports, 2026-11-26
   evening: under live v74 the old design STILL flashes on load,
   repeatedly, and the boot splash itself can stick).

   ROOT CAUSE (proven in the upgrade-simulation rig, see
   V75-FLASH-FIX-REPORT-2026-11-26.md): the v71 lifecycle dropped
   the boot splash at app.js PARSE time, before anything had
   rendered — so the un-routed static document (top bar, full
   nav, the wallet-locked page with skeleton cards) painted for
   the whole boot chain on every load (~1.5 s of it measured in
   the rig on a fast local network), and the v71 update and
   coherence reloads repeated that paint two or three times on
   upgrade loads. Separately, the service worker's network-first
   shell fetch had NO timeout: on a stalled connection the
   document or app.js could hang indefinitely, and since the
   only splash-removal code lives in app.js, the splash stuck.

   THE FIX: (1) the splash is held until the boot chain has
   rendered the first coherent screen (drop at chain end and on
   the chain's error path); (2) a 6 s watchdog armed before
   anything that can stall force-drops the splash — fail-open
   to a usable app, never an infinite splash; (3) the SW shell
   fetch is timed at 3.5 s with fallback to the current cache,
   so the shell always arrives from somewhere within a bound;
   (4) index.html version-stamps its shell assets (?b=v75), so
   a document can never pull another build's app.js/styles out
   of the HTTP cache (GitHub Pages serves max-age=600); (5) the
   coherence reload and the SW update delivery spend ONE shared
   boot-reload guard (bootReloadSpent, keyed by the newest build
   involved) — at most one boot reload per upgrade per session;
   (6) SW registration uses updateViaCache 'none'.

   Frozen rules untouched: EDCC 0.32 / PalmNet 0.5895, banking
   guard, strict money rule, codec freeze. The migration step
   is a pure adoption. */
'use strict';
const fs = require('fs');
const path = require('path');
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

function sliceBetween(src, a, b) {
  const i = src.indexOf(a);
  const j = b ? src.indexOf(b, i + a.length) : src.length;
  return i === -1 ? '' : src.slice(i, j === -1 ? src.length : j);
}

/* ---------- version coherence + identity migration -------------- */
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v94',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v94' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v94'") !== -1 &&
  html.indexOf('<meta name="biom-build" content="v94">') !== -1 &&
  html.indexOf('TSG Biom · App v94 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v94');
check('MIGRATION the v75 step is a pure adoption: a v74 store opens byte-identical at v75',
  (function () {
    const store = {
      people: [{ id: 'TSG-BIO-1', name: 'A', loyaltyPoints: 40, palmProfile: { v: 4, codes: ['x'] } }],
      logs: [{ ts: 1, result: 'Verified', durationMs: 1840 }],
      transactions: [{ id: 'BIOM-PAY-1001', amount: 320 }],
      meta: [{ key: 'bkashPending', value: { paymentID: 'TR0011X', personId: 'TSG-BIO-1', amount: 50 } }]
    };
    const before = JSON.stringify(store);
    const mig = B.migrateBiomData(JSON.parse(before), 'v74', 'v75');
    return mig.appliedSteps.join(',') === 'v75' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
  })());
check('MIGRATION the whole chain v37->v75 applies 38 steps',
  (function () {
    const mig = B.migrateBiomData({ people: [], logs: [], transactions: [], meta: [] }, 'v37', 'v75');
    return mig.appliedSteps.length === 38 && mig.appliedSteps[mig.appliedSteps.length - 1] === 'v75';
  })());
check('FROZEN bars untouched: EDCC 0.32 / PalmNet 0.5895',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895);

/* ---------- (1) the splash is held to the first coherent screen -- */
const bootBlock = sliceBetween(appSrc, 'var APP_DATA_VERSION', 'var DV_KEY');
check('SPLASH-HOLD the boot block no longer drops the splash at parse time (no bare dropBootSplash(); statement outside the watchdog)',
  bootBlock.indexOf('dropBootSplash();') !== -1 && // the watchdog call itself
  bootBlock.split('\n').filter(function (l) { return l.trim() === 'dropBootSplash();'; }).length === 0);
check('SPLASH-HOLD the boot chain drops the splash at its end, after handleBkashReturn',
  appSrc.indexOf('.then(function () { dropBootSplash(); })') !== -1 &&
  appSrc.indexOf('return handleBkashReturn();') < appSrc.indexOf('.then(function () { dropBootSplash(); })'));
check('SPLASH-HOLD the boot chain error path also drops the splash (fail-open)',
  appSrc.indexOf('.catch(function () { dropBootSplash(); })') !== -1);

/* ---------- (2) the watchdog -------------------------------------- */
check('WATCHDOG SPLASH_MAX_MS is 6000 and the watchdog is armed BEFORE the coherence check can stall or return',
  bootBlock.indexOf('var SPLASH_MAX_MS = 6000;') !== -1 &&
  bootBlock.indexOf('setTimeout(function () { dropBootSplash(); }, SPLASH_MAX_MS);') !== -1 &&
  bootBlock.indexOf('setTimeout(function () { dropBootSplash(); }, SPLASH_MAX_MS);') <
    bootBlock.indexOf('buildStamp !== APP_DATA_VERSION'));

/* ---------- (2b) the pure-CSS fail-open (no script required) ------- */
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
check('FAIL-OPEN the splash element carries the CSS fail-open animation at a 6 s delay (inline style — CSP forbids inline scripts)',
  html.indexOf('animation:bootSplashFailOpen .45s ease 6s forwards') !== -1);
check('FAIL-OPEN the bootSplashFailOpen keyframes live in styles.css and end invisible',
  css.indexOf('@keyframes bootSplashFailOpen{to{opacity:0;visibility:hidden}}') !== -1);

/* ---------- (5) one shared boot-reload guard ----------------------- */
check('GUARD bootReloadSpent exists and is keyed by the target build',
  appSrc.indexOf('function bootReloadSpent(targetBuild)') !== -1 &&
  appSrc.indexOf("'biomBootReload:' + targetBuild") !== -1);
check('GUARD the coherence reload spends the CANONICAL key (newest of document stamp and running app)',
  appSrc.indexOf('var bootReloadKey = newestBuild(buildStamp, APP_DATA_VERSION);') !== -1 &&
  bootBlock.indexOf('bootReloadSpent(bootReloadKey)') !== -1 &&
  bootBlock.indexOf('bootReloadSpent(buildStamp)') === -1);
check('GUARD the SW update delivery spends the canonical key extended by the incoming build; the catch path spends the page key; no raw-stamp or unknown spends remain',
  appSrc.indexOf('var spendKey = m ? newestBuild(incoming, bootReloadKey) : bootReloadKey;') !== -1 &&
  appSrc.indexOf('bootReloadSpent(spendKey)') !== -1 &&
  appSrc.split('bootReloadSpent(bootReloadKey)').length - 1 >= 2 && // boot block + SW catch path
  appSrc.indexOf('bootReloadSpent(incoming)') === -1 &&
  appSrc.indexOf('bootReloadSpent(APP_DATA_VERSION)') === -1);
check('GUARD the retired per-mechanism guard keys are gone (no stacking)',
  appSrc.indexOf('biomCohReload:') === -1 && appSrc.indexOf('biomSwReloaded:') === -1);
check('GUARD BEHAVIOUR first spend is free, the second is refused, broken storage fails closed',
  (function () {
    const seg = sliceBetween(appSrc, 'function bootReloadSpent', 'var buildMetaEl');
    const store = {};
    global.sessionStorage = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); }
    };
    let fn;
    eval('fn = ' + seg.replace('function bootReloadSpent', 'function __bootReloadSpent'));
    const first = fn('v75');
    const second = fn('v75');
    const otherBuild = fn('v76'); // a different upgrade keeps its own single reload
    global.sessionStorage = { getItem: function () { throw new Error('no'); }, setItem: function () { throw new Error('no'); } };
    const broken = fn('v77');
    delete global.sessionStorage;
    return first === false && second === true && otherBuild === false && broken === true;
  })());

check('GUARD BEHAVIOUR cross-path (Seat 1): a v74-document/v75-app coherence spend REFUSES the later v75 controllerchange spend — one reload per upgrade',
  (function () {
    const nbSeg = sliceBetween(appSrc, 'function newestBuild', 'function bootReloadSpent');
    const seg = sliceBetween(appSrc, 'function bootReloadSpent', 'var buildMetaEl');
    const store = {};
    global.sessionStorage = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); }
    };
    let newestBuild, spent;
    eval(nbSeg.replace('function newestBuild', 'function __nb') + '\nnewestBuild = __nb;');
    eval('spent = ' + seg.replace('function bootReloadSpent', 'function __brs'));
    // Page A: document stamped v74, running app v75 (mismatch).
    const pageAKey = newestBuild('v74', 'v75');
    const cohSpend = spent(pageAKey); // coherence reload fires
    // Page B: coherent v75 page; the v75 SW activates.
    const pageBKey = newestBuild('v75', 'v75');
    const ccSpend = spent(newestBuild('v75', pageBKey)); // must be refused
    // A genuinely later upgrade in the same session still gets its one reload.
    const nextUpgrade = spent(newestBuild('v76', pageBKey));
    delete global.sessionStorage;
    return pageAKey === 'v75' && cohSpend === false && ccSpend === true && nextUpgrade === false;
  })());

/* ---------- (4) version-stamped shell assets ----------------------- */
check('ASSETS index.html version-stamps its design-bearing shell assets at ?b=v94',
  html.indexOf('href="styles.css?b=v94"') !== -1 &&
  html.indexOf('src="vendor/mediapipe-hands-0.4.1675469240/hands.js?b=v94"') !== -1 &&
  html.indexOf('src="biometrics.js?b=v94"') !== -1 &&
  html.indexOf('src="app.js?b=v94"') !== -1);
check('ASSETS no un-stamped copy of those references remains',
  html.indexOf('href="styles.css"') === -1 &&
  html.indexOf('src="biometrics.js"') === -1 &&
  html.indexOf('src="app.js"') === -1 &&
  html.indexOf('hands.js"') === -1);

/* ---------- (3) the timed shell fetch ------------------------------ */
check('SW the shell fetch is timed at 3500 ms and the fetch handler routes through it',
  swSrc.indexOf('const SHELL_NET_TIMEOUT_MS = 3500;') !== -1 &&
  swSrc.indexOf('function timedShellFetch(request)') !== -1 &&
  swSrc.indexOf('timedShellFetch(event.request)') !== -1);
check('SW the timed fetch keeps the v71 no-cache rule',
  sliceBetween(swSrc, 'function timedShellFetch', 'function shellFallback').indexOf("cache: 'no-cache'") !== -1);
check('SW the cache fallback refuses a request stamped NEWER than the worker\u2019s own build (no mixed shell for styles/biometrics)',
  sliceBetween(swSrc, 'function shellFallback', null).indexOf('parseInt(stamped[1].slice(1), 10) > parseInt(own[1].slice(1), 10)') !== -1);
check('SW same-build stamped shell assets are CACHE-FIRST (the serial-stall fix); navigations are excluded',
  swSrc.indexOf('stampedBuild === ownBuild') !== -1 &&
  swSrc.indexOf('if (!isNav && stampedBuild && ownBuild && stampedBuild === ownBuild)') !== -1 &&
  swSrc.indexOf('return hit || refresh;') !== -1);
/* (the SW BEHAVIOUR check is async — it runs after the summary
   block below and its verdict is folded into the exit code) */

/* ---------- (6) SW registration ------------------------------------ */
check('REGISTRATION SW updates are never answered from the HTTP cache (updateViaCache none)',
  appSrc.indexOf("navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })") !== -1);

/* ---------- the scan timers (v74) survived the surgery ------------- */
check('NO-REGRESSION the v74 scan timers are intact',
  appSrc.indexOf('createScanTimer') !== -1 && appSrc.indexOf('scanTimerStart') !== -1);

/* ---------- async: the timed fetch, behaviourally ----------------- */
(function () {
  const seg = sliceBetween(swSrc, 'function timedShellFetch', 'function shellFallback');
  const constSeg = 'const SHELL_NET_TIMEOUT_MS = 60;'; // shrunk bound for the test only
  let timedShellFetch;
  global.fetch = function () { return new Promise(function () {}); }; // never settles
  eval(constSeg + '\n' + seg.replace('function timedShellFetch', 'function __tsf') + '\n;timedShellFetch = __tsf;');
  const t0 = Date.now();
  timedShellFetch({}).then(function () {
    check('SW BEHAVIOUR a hanging fetch is rejected at the bound', false, 'resolved instead of timing out');
    finish();
  }, function (err) {
    const hung = Date.now() - t0 >= 50 && /timed out/.test(err.message);
    global.fetch = function () { return Promise.resolve({ ok: true }); };
    timedShellFetch({}).then(function (res) {
      delete global.fetch;
      check('SW BEHAVIOUR a hanging fetch is rejected at the bound; a fast fetch resolves',
        hung && res.ok === true, 'hangMs>=' + 50);
      finish();
    });
  });
})();

function finish() {
  console.log(fail === 0
    ? 'ALL V75 FLASH-FIX TESTS PASSED (' + pass + ')'
    : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
}
