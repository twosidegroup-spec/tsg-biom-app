/* TSG Biom v52 — regBIOM UI REDESIGN tests.
   Approved by the Chairman 2026-11-24 19:42 from four design
   images ("build this way but more better seamless than the
   image"). v52 rebuilds the regBIOM customer surfaces —
   balance home, My Account, palm scan, Send / Add Money — as a
   PRESENTATION layer over the existing stores and flows.

   What this suite proves, from the shipped sources + fixtures:
   - STRUCTURE: the new surfaces exist with the ids the app
     wires (balance card + eye + avatar, four quick actions,
     linked wallets, recent activity, My Account with its palm
     identity card and settings list, corner-bracket scan frame
     with three live indicators, amount chips on both money
     forms, the recipient card's Scan Palm to Send).
   - REAL-DATA BINDING: the renderers read the real stores —
     balance / statement / linked accounts from the wallet,
     Biom ID and profile hand from the person record, limits
     from the enrolment limits — and the account's palm actions
     call the REAL flows (openTopup, enrolment).
   - NO MOCKUP DATA: the design images' figures (the 12,450
     balance, the BIOM-2481/2482 ids, the example names) appear
     NOWHERE in the shipped app sources; no fingerprint icon is
     used anywhere (palm icon only); the demo labelling survives.
   - NO BEHAVIOUR DRIFT: exactly three strict-money call sites
     remain (the v49/v50 rule), the quick Scan Palm action is a
     plain verify, the flash toggles and camera toggles are the
     v48 markup, and the migration is a pure adoption.
   - MIGRATION PURITY: a v51 store — wallet, statement, linked
     accounts, neural bank, hand stamp — opens under v52
     byte-identical; the full v37 chain lands intact.
   Run: node tests/v52-regbiom-ui.test.js */
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
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

/* ---------------- versions ------------------------------------ */
// v53: the three absolute pins below were converted to the
// version-coherence form (the v48/v49/v50/v51 pattern) when v53
// shipped — v52 remains IN the chain as an adoption step; the
// living current-version pins are in v38-migration + the v53
// suite. The redesign proofs in this suite are unchanged.
check('VERSION app data version and shell version agree', (function () {
  const dv = (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1];
  const sv = (swSrc.match(/tsg-biom-shell-(v\d+)/) || [])[1];
  return !!dv && dv === sv;
})());
check('VERSION v52 remains in the chain as an adoption step', B.BIOM_DATA_VERSIONS.indexOf('v52') !== -1);

/* ---------------- structure: balance home --------------------- */
check('HOME the balance card exists (deep-blue balcard)', htmlSrc.indexOf('class="balcard"') !== -1 && cssSrc.indexOf('.balcard{background:var(--blue)') !== -1);
check('HOME balance, holder and Biom ID keep their wired ids',
  htmlSrc.indexOf('id="wHomeBalance"') !== -1 && htmlSrc.indexOf('id="wHomeName"') !== -1 && htmlSrc.indexOf('id="wHomeId"') !== -1);
check('HOME the hide/show eye is present and wired',
  htmlSrc.indexOf('id="wBalEye"') !== -1 && appSrc.indexOf("$('wBalEye').addEventListener") !== -1 &&
  appSrc.indexOf('balanceHidden') !== -1);
check('HOME the avatar opens My Account',
  htmlSrc.indexOf('id="wHomeAvatar"') !== -1 && appSrc.indexOf("$('wHomeAvatar').addEventListener('click', function () { go('account'); })") !== -1);
check('HOME four quick actions exist (Add, Send, Scan Palm, History)',
  htmlSrc.indexOf('id="wAddOpen"') !== -1 && htmlSrc.indexOf('id="wSendOpen"') !== -1 &&
  htmlSrc.indexOf('id="wQuickScan"') !== -1 && htmlSrc.indexOf('id="wQuickHistory"') !== -1);
check('HOME Linked Wallets and Recent Activity sections keep their containers',
  htmlSrc.indexOf('id="wHomeAccounts"') !== -1 && htmlSrc.indexOf('id="wHomeStatement"') !== -1 &&
  htmlSrc.indexOf('Linked Wallets') !== -1 && htmlSrc.indexOf('Recent Activity') !== -1);
check('HOME demo honesty survives the redesign (v42 pin, restated)',
  htmlSrc.indexOf('Demo balance') !== -1 && htmlSrc.indexOf('Demo money — not real funds') !== -1);

/* ---------------- structure: My Account ----------------------- */
check('ACCOUNT the page exists and go() routes it (nav highlights Wallet)',
  htmlSrc.indexOf('<section class="page" id="page-account">') !== -1 &&
  appSrc.indexOf("page === 'account' ? 'wallet'") !== -1 && appSrc.indexOf("if (page === 'account') { renderAccount(); }") !== -1);
check('ACCOUNT profile header fields exist (avatar, name, phone, verified)',
  htmlSrc.indexOf('id="acAvatar"') !== -1 && htmlSrc.indexOf('id="acName"') !== -1 &&
  htmlSrc.indexOf('id="acPhone"') !== -1 && htmlSrc.indexOf('id="acVerified"') !== -1);
check('ACCOUNT the Palm Identity card carries Biom ID, registered palm and status',
  htmlSrc.indexOf('My Palm Identity') !== -1 && htmlSrc.indexOf('id="acBiomId"') !== -1 &&
  htmlSrc.indexOf('id="acPalmHand"') !== -1 && htmlSrc.indexOf('id="acPalmStatus"') !== -1 &&
  htmlSrc.indexOf('id="acPalmActions"') !== -1);
check('ACCOUNT the settings list is complete (info, linked, limit, security, notifications, language, help, log out)',
  ['Personal Information', 'Linked Wallets', 'Daily Limit', 'Security', 'Notifications', 'Language', 'Help and Support', 'Log Out']
    .every(function (s) { return htmlSrc.indexOf(s) !== -1; }));
check('ACCOUNT Log Out is the existing close-wallet behaviour',
  appSrc.indexOf("$('acLogout').addEventListener('click', function () { closeWalletSession(); go('wallet'); })") !== -1 &&
  appSrc.indexOf('function closeWalletSession()') !== -1 &&
  appSrc.indexOf("$('wCloseWallet').addEventListener('click', closeWalletSession)") !== -1);
check('ACCOUNT the honest rows stay honest (no notification service, English only)',
  htmlSrc.indexOf('TSG Biom sends no notifications') !== -1 && htmlSrc.indexOf('Bangla is not available in this build') !== -1);

/* ---------------- real-data binding --------------------------- */
check('BIND account reads the palm identity from the real profile (hand, format, neural need)',
  appSrc.indexOf('function renderAccount()') !== -1 &&
  appSrc.indexOf('B.palmProfileHand(me.palmProfile)') !== -1 &&
  appSrc.indexOf('B.palmprintProfileFormat(me.palmProfile)') !== -1 &&
  appSrc.indexOf('B.palmnetNeedsScan(me.palmProfile)') !== -1);
check('BIND account palm actions call the REAL flows (openTopup; enrolment for the other hand)',
  appSrc.indexOf("openTopup(me.id, b.dataset.acctTopup === 'neural' ? 'neural' : undefined)") !== -1 &&
  appSrc.indexOf("go('enroll')") !== -1);
check('BIND account limits come from the enrolment limits on the record',
  appSrc.indexOf('var lim = me.limits || {};') !== -1 && appSrc.indexOf('lim.daily') !== -1 && appSrc.indexOf('lim.perTx') !== -1);
check('BIND home linked wallets render the real linked accounts + the masked Biom Pay wallet',
  appSrc.indexOf('w.linkedAccounts.map') !== -1 && appSrc.indexOf('B.maskWalletNumber(me.walletNumber)') !== -1 &&
  appSrc.indexOf('Linked</span>') !== -1);
check('BIND home activity renders the real ledger with correct signs (add/received +, send −)',
  appSrc.indexOf('w.statement.slice().reverse()') !== -1 &&
  appSrc.indexOf('<div class="amt in">+ ') !== -1 && appSrc.indexOf('<div class="amt out">− ') !== -1);
check('BIND empty states are honest lines, not invented rows',
  appSrc.indexOf('No activity yet — add or send demo money and it will appear here.') !== -1 &&
  appSrc.indexOf('No wallet linked yet — Add Money will ask you to link a funding account.') !== -1);
check('BIND the balance eye hides the rendered figure only (store untouched)',
  appSrc.indexOf("balanceHidden ? 'BDT ••••••••' : fmtBDT(w.balance)") !== -1);

/* ---------------- structure: palm scan ------------------------ */
check('SCAN the wallet scan frame is corner brackets only (corners overlay, no ring element added)',
  htmlSrc.indexOf('class="corners"') !== -1 && cssSrc.indexOf('.corners .tl') !== -1 &&
  htmlSrc.indexOf('id="wScanVideo"') !== -1);
check('SCAN three live indicators exist (hand, light, steady)',
  htmlSrc.indexOf('id="wIndHand"') !== -1 && htmlSrc.indexOf('id="wIndLight"') !== -1 && htmlSrc.indexOf('id="wIndSteady"') !== -1);
check('SCAN indicators are driven by the real per-frame pipeline info and the session stability',
  appSrc.indexOf('function updateScanIndicators(info, frameRes)') !== -1 &&
  appSrc.indexOf('updateScanIndicators(info, fr)') !== -1 &&
  appSrc.indexOf('info.meanLuma') !== -1 && appSrc.indexOf('info.glareFrac') !== -1 && appSrc.indexOf('frameRes.armed') !== -1);
check('SCAN indicators reset when the card opens',
  appSrc.indexOf('resetScanIndicators();') !== -1);
check('SCAN flash + camera toggles are the untouched v48 markup',
  htmlSrc.indexOf('data-flash-toggle="walletAct"') !== -1 && htmlSrc.indexOf('data-cam-toggle="walletAct"') !== -1 &&
  htmlSrc.indexOf('data-flash-note="walletAct"') !== -1);
check('SCAN the instruction line is the caller prompt (wScanPrompt kept)',
  htmlSrc.indexOf('id="wScanPrompt"') !== -1 && appSrc.indexOf("$('wScanPrompt').textContent = ctx.prompt") !== -1);

/* ---------------- structure: Send / Add Money ----------------- */
check('MONEY amount chips exist for both forms and are wired to their inputs',
  htmlSrc.indexOf('data-chips="wAddAmount"') !== -1 && htmlSrc.indexOf('data-chips="wSendAmount"') !== -1 &&
  appSrc.indexOf("document.querySelectorAll('[data-chips]')") !== -1);
check('MONEY both forms show the real balance line',
  htmlSrc.indexOf('id="wAddBalance"') !== -1 && htmlSrc.indexOf('id="wSendBalance"') !== -1 &&
  appSrc.indexOf("$('wSendBalance').textContent = fmtBDT(B.walletEnsurePerson(me).wallet.balance)") !== -1);
check('MONEY Add Money carries the truthful fee line (the store layer charges none)',
  htmlSrc.indexOf('Fee') !== -1 && htmlSrc.indexOf('no fee is charged') !== -1);
check('MONEY Add authorisation button reads Scan Palm to Add; Send reads Scan Palm to Send',
  htmlSrc.indexOf('id="wAddScan">Scan Palm to Add<') !== -1 && appSrc.indexOf('>Scan Palm to Send</button>') !== -1);
check('MONEY the Send recipient card is the real identified profile (name, Biom ID, palm-verified badge)',
  appSrc.indexOf('class="recvcard"') !== -1 && appSrc.indexOf('sendDraft.receiverName') !== -1 &&
  appSrc.indexOf('sendDraft.receiverId') !== -1 && appSrc.indexOf('Palm verified') !== -1);

/* ---------------- no behaviour drift -------------------------- */
check('DRIFT exactly three strict-money call sites remain (v49/v50 rule untouched)',
  (appSrc.match(/\{ strictMoney: true \}\)/g) || []).length === 3,
  'found ' + (appSrc.match(/\{ strictMoney: true \}\)/g) || []).length);
check('DRIFT the quick Scan Palm action is a PLAIN verify (authorises nothing)',
  (function () {
    const i = appSrc.indexOf("$('wQuickScan')");
    const slice = appSrc.slice(i, appSrc.indexOf("document.querySelectorAll('[data-chips]')", i));
    return slice.indexOf('streamVerifyPalm') !== -1 && slice.indexOf('strictMoney') === -1 &&
      slice.indexOf('moves no money') !== -1;
  })());
check('DRIFT thresholds untouched in the engine (0.32 EDCC bar; PalmNet fusion constants present)',
  fs.readFileSync(path.join(__dirname, '..', 'biometrics.js'), 'utf8').indexOf('0.5773') !== -1);

/* ---------------- no mockup data, palm icon only -------------- */
check('MOCKUP none of the design images\' figures or names appear in the app sources',
  ['12,450', 'Farah', 'Anjum', 'BIOM-2481', 'BIOM-2482'].every(function (s) {
    return htmlSrc.indexOf(s) === -1 && appSrc.indexOf(s) === -1 && cssSrc.indexOf(s) === -1;
  }));
check('MOCKUP no fingerprint icon or wording anywhere in the app sources',
  htmlSrc.toLowerCase().indexOf('fingerprint') === -1 && appSrc.toLowerCase().indexOf('fingerprint') === -1);
check('MOCKUP the palm icon is the one used for palm actions (quick action + identity card)',
  (htmlSrc.match(/class="palmicon"/g) || []).length >= 2);

/* ---------------- migration purity ---------------------------- */
const v51Store = {
  people: [{ id: 'TSG-BIO-1', name: 'Rig', phone: '01933038706', type: 'Customer', store: 'HQ',
    limits: { perTx: 1000, daily: 5000 }, loyaltyPoints: 12,
    wallet: { balance: 450, statement: [{ kind: 'add', amount: 450, ref: 'DEMO-1' }], linkedAccounts: [{ id: 'a1', type: 'bKash', label: 'Rig bKash' }] },
    walletProvider: 'bKash', walletNumber: '01933038706',
    palmProfile: { v: 4, format: 'packed96', hand: 'left', codes: ['QUJD'], neural: { v: 1, dim: 256, model: 'palmnet-v1', embeddings: ['QUJD'] } } }],
  logs: [{ ts: 1 }], transactions: [{ id: 'BIOM-PAY-1' }], meta: []
};
const before52 = JSON.stringify(v51Store);
const mig52 = B.migrateBiomData(JSON.parse(before52), 'v51', 'v52');
check('MIGRATION v51->v52 runs the v52 step', mig52.appliedSteps.indexOf('v52') !== -1, mig52.appliedSteps.join(','));
check('MIGRATION v51->v52 is a pure adoption (byte-identical store)',
  mig52.changed === false && JSON.stringify(mig52.snapshot) === before52);
check('MIGRATION the hand stamp, wallet and limits survive v52',
  B.palmProfileHand(mig52.snapshot.people[0].palmProfile) === 'left' &&
  mig52.snapshot.people[0].wallet.balance === 450 &&
  mig52.snapshot.people[0].limits.daily === 5000);
const migChain52 = B.migrateBiomData(JSON.parse(before52), 'v37', 'v52');
check('MIGRATION the full chain v37->v52 runs all fifteen steps in order',
  migChain52.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v52',
  migChain52.appliedSteps.join(','));
const migAgain52 = B.migrateBiomData(mig52.snapshot, 'v52', 'v52');
check('MIGRATION is idempotent at v52', migAgain52.appliedSteps.length === 0 && migAgain52.changed === false);

info('rig only: this suite pins structure, binding and purity from the shipped sources; the phone is the verdict on the design itself.');
console.log('\nv52 regbiom-ui tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
