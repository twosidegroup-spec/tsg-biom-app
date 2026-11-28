/* TSG BIOM v88 — OVERNIGHT PHASE 5: UI CLEAN + DECLUTTER.
   Presentation-only release: dead controls removed, dead CSS
   removed, one verbatim-duplicated copy fold removed, one true
   duplicate route removed. Behaviour underneath is IDENTICAL —
   this suite pins (a) the removed items stay removed, (b) no
   handler reference dangles, (c) the frozen strings are intact,
   (d) no duplicate ids, (e) the v88 migration is PURE ADOPTION
   (a v86 store opens byte-identical under v88). */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const bioSrc = fs.readFileSync(path.join(__dirname, '..', 'biometrics.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

/* ---- version mechanics ---- */
check('APP_DATA_VERSION is v94', appSrc.indexOf("var APP_DATA_VERSION = 'v94';") !== -1);
check('SW cache is tsg-biom-shell-v94', swSrc.indexOf("const CACHE = 'tsg-biom-shell-v94';") !== -1);
check('index.html build meta is v94', htmlSrc.indexOf('<meta name="biom-build" content="v94">') !== -1);
check('index.html version line reads App v94', htmlSrc.indexOf('TSG Biom · App v94 · TwoSide Group') !== -1);
check('index.html asset stamps are ?b=v94', htmlSrc.indexOf('app.js?b=v94') !== -1 && htmlSrc.indexOf('styles.css?b=v94') !== -1 && htmlSrc.indexOf('?b=v86') === -1);
check('BIOM_DATA_VERSIONS ends with v94 (v94 named pin change: declutter)', /'v93', 'v94'\]/.test(bioSrc));

/* ---- removed dead controls stay removed ---- */
check('Partner page: no disabled placeholder inputs remain', htmlSrc.indexOf('<input disabled') === -1);
check('Partner page: partnership badges (the live information) remain',
  htmlSrc.indexOf('Sandbox connected — TEST MODE') !== -1 && htmlSrc.indexOf('Not connected — merchant credentials required') !== -1);
check('Partner page: the v71 honesty sentence survives as TEXT (it was information; only the dead input was removed)',
  htmlSrc.indexOf('Held on the API server only — never entered in the app') !== -1);
check('installBtn2 (duplicate of header installBtn route) removed from HTML', htmlSrc.indexOf('installBtn2') === -1);
check('installBtn2 listener removed from app.js — no dangling reference', appSrc.indexOf('installBtn2') === -1);
check('header installBtn (the surviving route) still present and wired',
  htmlSrc.indexOf('id="installBtn"') !== -1 && appSrc.indexOf("$('installBtn').addEventListener('click', install);") !== -1);
check('More page: verbatim-duplicate "The full explanation" fold removed', htmlSrc.indexOf('The full explanation') === -1);
check('More page: the visible scanning explanation (the surviving copy) remains',
  htmlSrc.indexOf('How the real scanning works') !== -1 && htmlSrc.indexOf('Nothing is simulated.') !== -1);
check('enrolment copyfold (a different, non-duplicate fold) untouched', htmlSrc.indexOf('How the palm scan works, in full') !== -1);

/* ---- dead CSS stays removed; pinned CSS stays ---- */
['.balancebox{', '.stmtrow{', '.checkrow{', '.checkrow .check{'].forEach(function (sel) {
  check('dead CSS rule removed: ' + sel, cssSrc.indexOf(sel) === -1);
});
check('suite-pinned .skelrow rule KEPT (v66 pin — not dead by the pin discipline)', cssSrc.indexOf('.skelrow{height:44px') !== -1);
check('live .check checkbox rule untouched', cssSrc.indexOf('.check{') !== -1 || cssSrc.indexOf('label.check') !== -1 || /\.check\b/.test(cssSrc));

/* ---- no duplicate ids ---- */
const ids = Array.from(htmlSrc.matchAll(/ id="([^"]+)"/g)).map(m => m[1]);
const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
check('no duplicate id attributes in index.html', dup.length === 0, dup.join(','));

/* ---- frozen strings intact ---- */
check('MONEY_STRICT_FAIL_MSG intact', appSrc.indexOf("var MONEY_STRICT_FAIL_MSG = 'Matched, but not clearly enough to authorise money — please scan again';") !== -1);
check('DETECTOR_FAIL_MSG intact', appSrc.indexOf('The hand detector could not run on this device, so this scan could not look for a hand.') !== -1);
check('v79 BLOCKED merchant wording intact', appSrc.indexOf('PALM SCANNING BLOCKED') !== -1);
check('v81 consent notice text intact', htmlSrc.indexOf('Help improve Biom — research mode') !== -1 && htmlSrc.indexOf('I agree — include my scan photos') !== -1);
check('frozen thresholds untouched in biometrics.js', (bioSrc.match(/0\.32/g) || []).length >= 10 && bioSrc.indexOf('0.5895') !== -1);
check('Research.tapFrame sites unchanged (3)', (appSrc.match(/Research\.tapFrame/g) || []).length === 3,
  'count=' + (appSrc.match(/Research\.tapFrame/g) || []).length);

/* ---- v88 migration is pure adoption ---- */
check('v88 step is the identity step', bioSrc.indexOf("'v88': function (snap) { return snap; }") !== -1);
(function () {
  const person = { biomId: 'TSG-BIO-9001', name: 'Fixture', loyaltyPoints: 137,
    loyaltyEvents: [{ eventId: 'e1', biomId: 'TSG-BIO-9001', type: 'earn', points: 137, reason: 'opening', ts: 1 }],
    palmProfile: { format: 'v2', codes: ['x'] }, wallet: { balance: 500 } };
  const snap = { people: [person], logs: [{ id: 'l1' }], transactions: [{ id: 't1' }], meta: [{ k: 'v' }] };
  const before = JSON.stringify(snap);
  const mig = B.migrateBiomData(snap, 'v86', 'v88');
  check('v86->v88 migration output is byte-identical to its input', JSON.stringify(mig.snapshot) === before);
  check('v86->v88 migration changes no store', mig.changed === false && mig.changedStores.length === 0);
  const mig2 = B.migrateBiomData(snap, 'v85', 'v88');
  check('v85->v88 migration output is byte-identical (v86 step already applied upstream is a no-op here)', JSON.stringify(mig2.snapshot) === before);
})();

console.log('\nv88-declutter: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
