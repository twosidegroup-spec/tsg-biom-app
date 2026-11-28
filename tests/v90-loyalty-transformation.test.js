/* TSG BIOM v90 — THE LOYALTY TRANSFORMATION (the Chairman's
   order, 2026-11-28 10:13).

   His words, in substance: turn this into a full-fledged loyalty
   system that merchants use as their loyalty system. The customer
   app is for registering the palm and strengthening it (different
   angles, different light); the main scanning happens from the
   merchant account. Send Money is REMOVED — people send money in
   bKash itself, it is not needed here. Biom Pay stays. Declutter
   the buttons, make shapes and styles consistent, and stop
   showing technical writing to customers and merchants — plain
   words they understand; the technical talk stays on our side.

   This suite pins:
   - Send Money is GONE (no tile, no dialog, no flow wiring);
   - Palm Loyalty is a first-class wallet surface (tile + the
     account loyalty card it opens);
   - the quick-actions grid is the calm 3-column shape;
   - the plain-words loyalty explanation;
   - the v89 blocked card survives the transformation;
   - version coherence at v90. */
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
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

/* ---- Send Money is removed ------------------------------------ */
check('SEND no Send Money tile in the wallet home', htmlSrc.indexOf('id="wSendOpen"') === -1);
check('SEND no Send Money dialog in the page', htmlSrc.indexOf('id="walletSend"') === -1 && htmlSrc.indexOf('wSendAmount') === -1);
check('SEND no send flow wiring left in app.js',
  appSrc.indexOf('wSendOpen') === -1 && appSrc.indexOf('authoriseSend') === -1 &&
  appSrc.indexOf('renderSendConfirm') === -1 && appSrc.indexOf('sendDraft') === -1 &&
  appSrc.indexOf('setSendProgress') === -1);
check('SEND the sheet registry no longer lists a send sheet', appSrc.indexOf("id: 'walletSend'") === -1);
check('SEND Biom Pay and Add Money survive', htmlSrc.indexOf('id="wPayOpen"') !== -1 && htmlSrc.indexOf('id="wAddOpen"') !== -1);

/* ---- Loyalty is first-class ------------------------------------ */
check('LOYALTY the wallet home carries a Palm Loyalty tile', htmlSrc.indexOf('id="wLoyaltyOpen"') !== -1);
check('LOYALTY the tile opens My Account at the loyalty card',
  appSrc.indexOf("getElementById('wLoyaltyOpen')") !== -1 || appSrc.indexOf("$('wLoyaltyOpen')") !== -1);
check('LOYALTY the account loyalty card still renders from the ledger',
  htmlSrc.indexOf('id="acLoyaltyCard"') !== -1 && appSrc.indexOf('loyaltySectionHTML(me)') !== -1);
check('LOYALTY the explanation is plain words a customer understands',
  appSrc.indexOf('Every time a shop scans your palm, you earn points.') !== -1 &&
  appSrc.indexOf('the balance is counted from those records') === -1);
check('LOYALTY the terminal still tells the customer their points in plain words',
  appSrc.indexOf('points awarded — balance') !== -1);

/* ---- Declutter + consistency ------------------------------------ */
check('UI the quick-actions grid is the calm 3-column shape',
  cssSrc.indexOf('.qa-grid{display:grid;grid-template-columns:repeat(3,1fr)') !== -1 &&
  cssSrc.indexOf('.qa-grid{grid-template-columns:repeat(5,1fr)') === -1);
check('UI the Strengthen page speaks plainly (no burst/template jargon)',
  htmlSrc.indexOf('Take a few more photos of this palm') !== -1 &&
  htmlSrc.indexOf('burst capture') === -1);

/* ---- v89 blocked visibility survives ----------------------------- */
check('BLOCKED the wallet blocked card is still wired',
  htmlSrc.indexOf('id="wHomeBlocked"') !== -1 && appSrc.indexOf('blockedCardHTML(bInfo)') !== -1 &&
  appSrc.indexOf('but Add Money, Send Money, Biom Pay and palm scans are stopped') === -1);

/* ---- version coherence ------------------------------------------- */
check('VERSION app, shell, chain and stamps agree at v94',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v94' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v94'") !== -1 &&
  htmlSrc.indexOf('<meta name="biom-build" content="v94">') !== -1 &&
  htmlSrc.indexOf('TSG Biom · App v94 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v94' &&
  B.BIOM_DATA_VERSIONS.length === 58);

console.log('\n' + (fail === 0 ? 'ALL v90 LOYALTY-TRANSFORMATION TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed'));
if (fail) process.exit(1);
