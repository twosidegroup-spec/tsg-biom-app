/* TSG BIOM v60 — wallet entry with NO palm scan.

   The Chairman's direct order, 2026-11-25 01:34: "entering
   our own wallet no need scan". At v42-v59 the wallet was
   gated by a palm scan — a generic 1:N identify route and a
   per-profile 1:1 verify route — and the v53 owner-recovery
   entries (Strengthen my palm, the Neural Scan remedy, the
   confirmed re-registration) hung off wallet-open failures.

   Proven here:
   - ENTRY RUNS NO SCAN: both wallet-open scan routes are
     gone from the app and the markup; entry resolves by
     profile (resolveWalletEntry) — behavioural extraction:
     exactly one enrolled profile resolves to that profile,
     several resolve to null (the picker), none resolve to
     null, an open session wins, a stale session clears and
     falls back to the single-profile rule, and profiles
     without a usable palm never count. The picker renders
     name + Biom ID + hand and its tap calls openWalletDirect,
     whose extracted body sets the session and re-renders —
     no camera, no stream, no scan record anywhere in the
     entry path (structural absence pins on every slice).
   - ENTRY QUEUES NO RECORD: no 'wallet-open' sync context
     remains in the app (the sync engine still accepts the
     kind for records already on the server — v56 suite).
   - THE PICKER IS NOT DRESSED AS A GATE: the locked-card
     copy says the wallet opens without a scan and that
     choosing a profile is not a security check; the page
     copy says the palm is asked for only when money moves.
     With no enrolled profile the enrolment pointer remains.
   - RECOVERY RELOCATED, GUARDS UNTOUCHED: My Account →
     Palm Identity carries Strengthen my palm (Add Angles),
     Neural scan and Re-register this palm; the last routes
     through the SAME openRecoveryTopup grant, the banking
     guard still judges the capture, and the typed-REPLACE
     confirmation still gates the re-registration. A failed
     scan on the wallet card now shows the v53 diagnosis
     panel only — no recovery UI hangs off it.
   - MONEY STILL DEMANDS THE PALM: exactly three strict
     sites remain; Add Money and Send authorisation still
     open the scan card with the strict rule; the Send
     receiver identify and quick verify remain explicit
     scans on the shared card with v58 manual gating.
   - VERSIONS: v60 / shell v60 / chain newest v60, and the
     v59->v60 migration is a pure adoption (full proof in
     v38-migration.test.js).
   No threshold moved: EDCC 0.32, PalmNet 0.5895, the fusion
   OR rule, the strict money rule, the banking guard and the
   hand gate are pinned by their own suites.
   All numbers here are RIG numbers; the phone is the verdict. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function info(msg) { console.log('  ..  ' + msg); }

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function sliceBetween(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a === -1) return '';
  const b = src.indexOf(endMarker, a + startMarker.length);
  return b === -1 ? src.slice(a) : src.slice(a, b);
}
const NO_SCAN_TOKENS = ['Cam.start', 'streamVerifyPalm', 'streamIdentifyPalm', 'showWalletScan', 'noteScan', 'runWalletScan'];
function hasNoScan(slice) {
  return NO_SCAN_TOKENS.every(function (t) { return slice.indexOf(t) === -1; });
}

/* ---------------- entry: the scan routes are gone --------------- */
check('ENTRY the generic wallet-open scan button is gone from app and markup',
  appSrc.indexOf("$('walletOpenScan')") === -1 && htmlSrc.indexOf('id="walletOpenScan"') === -1);
check('ENTRY the per-profile wallet-open verify route is gone',
  appSrc.indexOf('function openWalletForPerson') === -1);
check('ENTRY no wallet-open sync context remains — entry queues no scan record',
  appSrc.indexOf("syncKind: 'wallet-open'") === -1 && appSrc.indexOf("kind: 'wallet-open'") === -1);

const resolveSrc = sliceBetween(appSrc, 'function resolveWalletEntry(people)', 'function renderWallet()');
check('ENTRY resolveWalletEntry exists and reads profiles by enrolment, not by palm',
  resolveSrc.length > 0 && resolveSrc.indexOf('personHasMethod') !== -1 && resolveSrc.indexOf('withPalm.length === 1') !== -1);
check('ENTRY resolveWalletEntry invokes no camera, stream, scan card or record',
  resolveSrc.length > 0 && hasNoScan(resolveSrc));

const renderWalletSrc = sliceBetween(appSrc, 'function renderWallet()', 'function renderWalletProfiles');
check('ENTRY renderWallet resolves the entry profile and opens its home directly',
  renderWalletSrc.indexOf('resolveWalletEntry(people)') !== -1 && renderWalletSrc.indexOf('walletSessionId = entry.id') !== -1 &&
  renderWalletSrc.indexOf('renderWalletHome(me)') !== -1);
check('ENTRY renderWallet invokes no camera, stream, scan card or record',
  renderWalletSrc.length > 0 && hasNoScan(renderWalletSrc));

/* ---------------- entry: behaviour (extracted resolver) --------- */
(function () {
  const personHasMethod = function (p) { return !!p.enrolled; };
  function makeResolver(sessionId) {
    const factory = new Function('personHasMethod',
      'var walletSessionId = ' + JSON.stringify(sessionId) + ';\n' + resolveSrc +
      '\nreturn { resolve: resolveWalletEntry, session: function () { return walletSessionId; } };');
    return factory(personHasMethod);
  }
  const P1 = { id: 'TSG-BIO-1', name: 'One', enrolled: true };
  const P2 = { id: 'TSG-BIO-2', name: 'Two', enrolled: true };
  const PX = { id: 'TSG-BIO-9', name: 'NoPalm', enrolled: false };
  check('BEHAVIOUR exactly one enrolled profile resolves straight to that profile',
    makeResolver(null).resolve([P1]) === P1);
  check('BEHAVIOUR several enrolled profiles resolve to null — the picker decides, not a scan',
    makeResolver(null).resolve([P1, P2]) === null);
  check('BEHAVIOUR no enrolled profile resolves to null — the enrolment pointer shows',
    makeResolver(null).resolve([]) === null && makeResolver(null).resolve([PX]) === null);
  check('BEHAVIOUR a profile without a usable palm never counts toward entry',
    makeResolver(null).resolve([PX, P2]) === P2);
  check('BEHAVIOUR an already-open session wins over the picker',
    makeResolver('TSG-BIO-2').resolve([P1, P2]) === P2);
  (function () {
    const r = makeResolver('TSG-BIO-GONE');
    const out = r.resolve([P1]);
    check('BEHAVIOUR a stale session clears and falls back to the single-profile rule',
      out === P1 && r.session() === null, 'session=' + r.session());
  })();
})();

/* ---------------- entry: the picker ------------------------------ */
const pickerSrc = sliceBetween(appSrc, 'function renderWalletProfiles', 'function openWalletDirect');
check('PICKER the picker lists name, Biom ID and registered hand, and says what the tap does',
  pickerSrc.indexOf('pc-name') !== -1 && pickerSrc.indexOf('pc-id') !== -1 &&
  pickerSrc.indexOf('Tap to open this wallet') !== -1 && pickerSrc.indexOf('palm registered') !== -1);
check('PICKER the picker copy carries no scan promise (no "scan this person", no "opens only")',
  pickerSrc.indexOf('scan this person') === -1 && pickerSrc.indexOf('opens only') === -1);
check('PICKER tapping a card opens that wallet directly',
  pickerSrc.indexOf('data-open-wallet') !== -1 && pickerSrc.indexOf('openWalletDirect(b.dataset.openWallet)') !== -1);
check('PICKER with no enrolled profile the enrolment pointer remains',
  pickerSrc.indexOf('No palm is registered on this device yet. Register a palm first') !== -1);

const directSrc = sliceBetween(appSrc, 'function openWalletDirect(personId)', 'var balanceHidden');
check('PICKER openWalletDirect sets the session and re-renders — nothing else',
  directSrc.indexOf('walletSessionId = personId') !== -1 && directSrc.indexOf('renderWallet()') !== -1);
check('PICKER openWalletDirect invokes no camera, stream, scan card or record',
  directSrc.length > 0 && hasNoScan(directSrc));
(function () {
  let session = null, renders = 0, hides = 0;
  const walletPeopleCache = [{ id: 'TSG-BIO-1' }, { id: 'TSG-BIO-2' }];
  const factory = new Function('walletPeopleCache', 'hideWalletScan', 'renderWallet',
    'var walletSessionId = null;\n' + directSrc +
    '\nreturn { open: openWalletDirect, session: function () { return walletSessionId; } };');
  const api = factory(walletPeopleCache,
    function () { hides++; },
    function () { renders++; return Promise.resolve(); });
  api.open('TSG-BIO-2');
  check('BEHAVIOUR a picker tap opens exactly the tapped wallet',
    api.session() === 'TSG-BIO-2' && renders === 1 && hides === 1,
    'session=' + api.session() + ' renders=' + renders);
  api.open('TSG-BIO-UNKNOWN');
  check('BEHAVIOUR an unknown profile id opens nothing',
    api.session() === 'TSG-BIO-2' && renders === 1);
})();

/* ---------------- copy: entry is not a gate ---------------------- */
check('COPY the wallet page states the truth: no scan to enter, palm only when money moves',
  htmlSrc.indexOf('opens directly — no scan to enter') !== -1 && htmlSrc.indexOf('your palm is asked for only when money moves') !== -1);
check('COPY the picker card is not dressed as a security check (v90 plain-words pass: same truth, simpler words)',
  htmlSrc.indexOf('opens without a scan — tap your name to open it') !== -1 &&
  htmlSrc.indexOf('Your palm is only needed when you pay or add money.') !== -1);
check('COPY no copy anywhere claims the palm opens or unlocks the wallet',
  htmlSrc.indexOf('Scan Your Palm to Open Your Wallet') === -1 &&
  htmlSrc.indexOf('Scan your palm to open your wallet') === -1 &&
  htmlSrc.indexOf('the scan is the key') === -1 &&
  appSrc.indexOf('open it with this palm') === -1);

/* ---------------- recovery: relocated, guards intact ------------- */
const accountSrc = sliceBetween(appSrc, 'function renderAccount()', "$('acBack').addEventListener");
check('RELOCATED My Account resolves the session by the same entry rule',
  accountSrc.indexOf('resolveWalletEntry(people)') !== -1);
check('RELOCATED the Palm Identity card carries Strengthen my palm, Neural scan and Re-register this palm',
  accountSrc.indexOf('data-acct-topup="angles">Strengthen my palm') !== -1 &&
  accountSrc.indexOf('data-acct-topup="neural">Neural scan') !== -1 &&
  accountSrc.indexOf('id="acRereg">Re-register this palm') !== -1);
check('RELOCATED Strengthen and Neural route to the same openTopup flows as before',
  accountSrc.indexOf("openTopup(me.id, b.dataset.acctTopup === 'neural' ? 'neural' : undefined)") !== -1);
check('RELOCATED Re-register routes through the same recovery grant (openRecoveryTopup)',
  accountSrc.indexOf('openRecoveryTopup(me.id)') !== -1 &&
  appSrc.indexOf("function openRecoveryTopup(personId) { openTopup(personId, 'angles', true); }") !== -1);
check('RELOCATED the recovery launch notice names its true origin (My Account → Palm Identity)',
  appSrc.indexOf('You came here from My Account → Palm Identity (Re-register this palm).') !== -1 &&
  appSrc.indexOf('You came here from a failed wallet-open scan') === -1);
const failedSrc = sliceBetween(appSrc, 'function walletScanFailed(out)', "$('wScanStart').addEventListener");
check('RELOCATED a failed scan shows the diagnosis panel only — no recovery UI hangs off it',
  failedSrc.indexOf('scanDiagHTML(out && out.diag)') !== -1 && failedSrc.indexOf('diagHtml +=') === -1 &&
  appSrc.indexOf('renderWalletRecovery') === -1 && (appSrc.match(/recoverable: true/g) || []).length === 0);
const topupSrc = sliceBetween(appSrc, 'function runTopupCapture()', '/* ---------------- v53 owner re-registration');
check('GUARDS the banking guard still judges every top-up capture',
  topupSrc.indexOf('B.bankingGuardCheck(person.palmProfile') !== -1 &&
  topupSrc.indexOf('This palm does not match this profile — nothing was added') !== -1);
check('GUARDS the re-registration offer still waits for a refusal inside a recovery capture',
  appSrc.indexOf('if (recoveryPersonId && recoveryPersonId === person.id)') !== -1 &&
  appSrc.indexOf('id="topReregOpen"') !== -1);
check('GUARDS the typed REPLACE confirmation still gates the re-registration',
  htmlSrc.indexOf('id="topReregInput"') !== -1 && appSrc.indexOf("input.value.trim() !== 'REPLACE'") !== -1);

/* ---------------- money still demands the palm ------------------- */
/* v63 PIN CHANGE (named openly): a fourth strict site — the
   wallet Biom Pay — was added by the Chairman's explicit order
   (2026-11-25 10:47); see the v49 suite's note. */
check('MONEY exactly three strict-money call sites remain (terminal Biom Pay, Add Money, wallet Biom Pay — v90 named pin change: Send Money removed)',
  (appSrc.match(/\{ strictMoney: true(?=[, }])/g) || []).length === 3);
const addSrc = sliceBetween(appSrc, "$('wAddScan').addEventListener", '/* ---------------- Wallet Biom Pay');
check('MONEY Add Money still opens the scan card under the strict rule',
  addSrc.indexOf('showWalletScan({') !== -1 && addSrc.indexOf('strictMoney: true') !== -1);
check('MONEY the Send flow is REMOVED (v90, Chairman 2026-11-28 — no authorise, no receiver identify)',
  appSrc.indexOf('function authoriseSend()') === -1 && appSrc.indexOf('wSendScanReceiver') === -1);
const quickSrc = sliceBetween(appSrc, "$('wQuickScan').addEventListener", "document.querySelectorAll('[data-chips]')");
check('MONEY quick verify (Scan Palm) remains an explicit palm scan',
  quickSrc.indexOf('showWalletScan({') !== -1 && quickSrc.indexOf('streamVerifyPalm') !== -1);
check('MONEY the terminal scan binding is untouched',
  appSrc.indexOf("$('termScan').addEventListener('click', runTermScan)") !== -1);

/* ---------------- versions --------------------------------------- */
/* v61 named pin change (the v55–v60 precedent): the absolute v60
   pins below become coherence pins — v60's own behaviours stay
   pinned by the sections above; the CURRENT version is pinned by
   the migration suite and v61-b1.test.js. */
check('VERSION the app version pin is coherent (v60 section, converted at the v61 bump)',
  /APP_DATA_VERSION = 'v\d+'/.test(appSrc) && /tsg-biom-shell-v\d+/.test(swSrc));
check('VERSION v60 remains a chain link with its adoption step (v60 section, converted at the v61 bump)',
  B.BIOM_DATA_VERSIONS.indexOf('v60') !== -1 &&
  B.migrateBiomData({ people: [], logs: [], transactions: [], meta: [] }, 'v59', 'v60').appliedSteps.join(',') === 'v60');

info('rig only: source pins and extracted-function behaviour. The phone verdict — the wallet opening with no scan, the picker on the two-profile phone, money still demanding the palm — is the real-world proof, and it has not been claimed here.');
console.log(fail === 0 ? 'ALL v60 WALLET-ENTRY TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
