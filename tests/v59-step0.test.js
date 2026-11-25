/* TSG BIOM v59 — Phase A STEP-0 tests (copy truth, Delete All
   honesty, the D6 points-after-payment reorder, inline-handler
   removal, www/ drift).

   v59 is the no-dependency batch from the team plan
   (PHASE-A-AUDIT-AND-PLAN-2026-11-25, Step 0):
   (0.1) Copy truth pass (Seat 1 Spec B1 + Seat 2 CD-6): no
         shipped surface may call the palm templates
         "encrypted" — they are encoded palm codes; encryption
         arrives in the security release. The Delete All Data
         copy must say a device wipe does not erase copies
         already synced to the server.
   (0.2) Defect D6 reorder (Seat 1): Palm Loyalty payment
         points are credited only AFTER the payment resolves,
         from the created transaction's amount; the 5-point
         visit award (verified scan, no amount) is unchanged.
         Refusals — no wallet, per-transaction limit, daily
         limit — award no payment points.
   (0.3) www/ drift kill (Seat 1 Spec B5): the staged copy is
         regenerated from current sources and check-www.js
         fails on any drift; package.json gains test/check-www.
   (0.4) Inline handlers removed (Seat 1 Spec B3 prerequisite):
         the enrolment Done buttons and the SW registration
         move into app.js, behaviour identical.

   What is proven here, at the level the code allows: the
   shipped sources are read and the ordering/structure is
   pinned exactly; the migration identity for v59 is proven
   in v38-migration.test.js. The full runTermScan closure is
   not extracted (its dependency web is the whole terminal);
   the D6 invariant is structural and complete: the payment
   award exists in exactly one place — inside createPay's
   success callback, after the transaction write — and every
   refusal returns before createPay is ever invoked, so no
   refusal path can reach it. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const B = require(path.join(__dirname, '..', 'biometrics.js'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bioSrc = fs.readFileSync(path.join(root, 'biometrics.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const readmeSrc = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/* ---------- version coherence ---------- */
/* v60 PIN CHANGE (named openly): these three pins were
   absolute at v59 when this suite shipped; following the
   v55/v56/v57-suite precedent they are converted to the
   coherence form now that v60 is current — app version ==
   shell version == newest chain link, and v59 remains in
   the chain as an adoption step. */
const appVer59 = (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1];
const shellVer59 = (swSrc.match(/tsg-biom-shell-(v\d+)/) || [])[1];
check('VERSION app data version and shell version agree and sit in the chain',
  !!appVer59 && appVer59 === shellVer59 && B.BIOM_DATA_VERSIONS.indexOf(appVer59) !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === appVer59,
  appVer59 + ' vs ' + shellVer59);
check('VERSION v59 remains in the chain as an adoption step', B.BIOM_DATA_VERSIONS.indexOf('v59') !== -1);

/* ---------- 0.1 copy truth: the false claim is gone ---------- */
const surfaces = { 'index.html': htmlSrc, 'app.js': appSrc, 'biometrics.js': bioSrc, 'sw.js': swSrc, 'styles.css': cssSrc, 'README.md': readmeSrc };
const falseClaims = ['encrypted palm', 'encrypted-template', 'encrypted template', 'encrypted palm-template'];
for (const name of Object.keys(surfaces)) {
  const low = surfaces[name].toLowerCase();
  check('COPY ' + name + ' never claims encrypted templates',
    falseClaims.every(function (p) { return low.indexOf(p) === -1; }));
}
/* v61 named pin changes: B1 shipped, so the v59 interim-truth
   pins are replaced by the v61 truth. The Scan Sync card now
   says the codes are sealed under the vault key before they are
   stored or posted; My Account states the bank's own state —
   sealed, sealed under another key, or still encoded (the
   pinned encoded sentence survives verbatim in the encoded
   branch). The interim promise is retired from all USER-VISIBLE
   copy: the ban below covers index.html in full and app.js from
   renderAccount on (the app.js header keeps the v59 changelog
   paragraph as history, above that point). */
check('COPY Scan Sync card says palm codes post (v61 wording)', htmlSrc.indexOf('posts the palm codes') !== -1);
check('COPY Scan Sync card states the v61 truth (sealed before storing/posting)',
  htmlSrc.indexOf('From v61 the codes are sealed on this device under its Biom Vault key before they are stored or posted') !== -1);
check('COPY the interim promise is retired from user-visible copy (v61 named pin change)',
  htmlSrc.indexOf('encryption arrives in the security release') === -1 &&
  htmlSrc.indexOf('The codes are encoded, not yet encrypted') === -1 &&
  appSrc.slice(appSrc.indexOf('function renderAccount()')).indexOf('encryption arrives in the security release') === -1);
check('COPY My Account states the sealed truth for a sealed bank (v61)',
  appSrc.indexOf('Palm templates are stored on this device encrypted under its Biom Vault key (AES-GCM)') !== -1);
check('COPY My Account security text says encoded palm codes', appSrc.indexOf('stored on this device as encoded palm codes') !== -1);
check('COPY My Account sync lines name the vault sealing in both states (v61 named pin change)',
  (appSrc.match(/palm codes also sync/g) || []).length >= 1 &&
  (appSrc.match(/sealed under this device/g) || []).length >= 2);

/* ---------- 0.1 Delete All Data copy is true about the server ---------- */
check('COPY Delete All intro no longer claims there is no copy anywhere else',
  htmlSrc.indexOf('there is no copy anywhere else') === -1);
check('COPY Delete All intro states synced copies stay on the server',
  htmlSrc.indexOf('copies already synced to your TSG Biom server stay on the server; server-side removal arrives in the security release.') !== -1);
check('COPY Delete All result states the wipe did not erase server copies',
  appSrc.indexOf('Copies already synced to your TSG Biom server are not erased by this wipe') !== -1);

/* ---------- 0.2 D6: points only after the payment resolves ---------- */
const termStart = appSrc.indexOf('function runTermScan(');
const termEnd = appSrc.indexOf("$('termScan').addEventListener", termStart);
const term = termStart !== -1 && termEnd !== -1 ? appSrc.slice(termStart, termEnd) : '';
check('D6 runTermScan located', term.length > 1000);
const awardSites = [];
let ai = term.indexOf('person.loyaltyPoints = (person.loyaltyPoints || 0) +');
while (ai !== -1) { awardSites.push(ai); ai = term.indexOf('person.loyaltyPoints = (person.loyaltyPoints || 0) +', ai + 1); }
check('D6 exactly two award sites remain (visit + post-payment)', awardSites.length === 2, 'found ' + awardSites.length);
check('D6 the visit award is the 5-point award, gated to no-amount scans',
  term.indexOf('if (!(amount > 0)) {') !== -1 &&
  term.indexOf('person.loyaltyPoints = (person.loyaltyPoints || 0) + 5;') !== -1 &&
  awardSites.length === 2 && term.slice(Math.max(0, awardSites[0] - 200), awardSites[0]).indexOf('if (!(amount > 0))') !== -1);
check('D6 no award is computed from the typed amount anywhere in the app',
  appSrc.indexOf('Math.floor(amount / 10)') === -1);
const txWrite = term.indexOf("return DB.put('transactions', tx).then(function () {");
const payAward = term.indexOf('var payPts = Math.floor(tx.amount / 10);');
check('D6 the payment award is computed from the created transaction amount', payAward !== -1);
check('D6 the payment award sits INSIDE the transaction-write success callback',
  txWrite !== -1 && payAward > txWrite && awardSites.length === 2 && awardSites[1] > txWrite);
check('D6 the payment award persists the person after crediting',
  payAward !== -1 && term.indexOf("DB.put('people', person);", payAward) !== -1 &&
  term.indexOf("DB.put('people', person);", payAward) < term.indexOf("$('termResult').innerHTML = html + loyaltyLine +", payAward));
const refusalMarks = ['Biom Pay not created: this person has no linked', "exceeds this customer\\'s biometric-only per-transaction limit", "biometric-only daily limit of BDT"];
check('D6 all three refusal branches still exist', refusalMarks.every(function (m) { return term.indexOf(m) !== -1; }));
check('D6 no refusal branch carries an award (award sites are only the two pinned ones)',
  awardSites.every(function (pos) {
    return term.slice(Math.max(0, pos - 200), pos).indexOf('if (!(amount > 0))') !== -1 || pos > txWrite;
  }));

/* ---------- 0.4 inline handlers / inline scripts removed ---------- */
check('INLINE index.html has no onclick attributes', htmlSrc.indexOf('onclick') === -1);
check('INLINE index.html has no inline <script> block (every script has src=)',
  !/<script(?![^>]*\ssrc=)/.test(htmlSrc));
check('INLINE Done buttons carry ids instead',
  ['enrollDoneRegistry', 'enrollDoneWallet', 'enrollDoneTerminal'].every(function (id) { return htmlSrc.indexOf('id="' + id + '"') !== -1; }));
check('INLINE app.js binds the Done buttons with addEventListener',
  ['enrollDoneRegistry', 'enrollDoneWallet', 'enrollDoneTerminal'].every(function (id) { return appSrc.indexOf("'" + id + "'") !== -1; }) &&
  appSrc.indexOf("b.addEventListener('click', function () { go(pair[1]); })") !== -1);
check('INLINE SW registration lives in app.js now',
  appSrc.indexOf("navigator.serviceWorker.register('sw.js')") !== -1 && htmlSrc.indexOf('serviceWorker') === -1);
check('INLINE window.TSGApp export retained (nothing else broke)',
  appSrc.indexOf('window.TSGApp = { go: go };') !== -1);

/* ---------- 0.3 www/ drift discipline ---------- */
check('DRIFT package.json has test and check-www scripts',
  pkg.scripts && pkg.scripts.test === 'node tests/run-all.js' && pkg.scripts['check-www'] === 'node check-www.js');
check('DRIFT stage-www enforces the drift check after staging',
  fs.readFileSync(path.join(root, 'stage-www.js'), 'utf8').indexOf('require("./check-www.js")') !== -1);
const drift = spawnSync(process.execPath, [path.join(root, 'check-www.js')], { encoding: 'utf8' });
check('DRIFT www/ matches the root sources right now', drift.status === 0, (drift.stdout || '').trim());
check('DRIFT the staged app is the current version (no stale copy remains)',
  fs.readFileSync(path.join(root, 'www', 'app.js'), 'utf8').indexOf("APP_DATA_VERSION = '" + appVer59 + "'") !== -1 &&
  fs.readFileSync(path.join(root, 'www', 'sw.js'), 'utf8').indexOf('tsg-biom-shell-' + appVer59) !== -1);

console.log(fail === 0 ? 'ALL v59 STEP-0 TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
