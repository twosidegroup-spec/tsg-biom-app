/* TSG Biom — v42: the demonstration wallet layer.
   The Chairman's order (2026-11-23 15:57): opening the app leads
   with the wallet; every registered person has a wallet whose
   account is their Biom ID, balance 0 at registration; Add Money
   lands only after the owner's own palm authorises; Send Money
   finds the receiver by THEIR palm and is impossible when that
   palm matches no registered Biom ID; with balance 0 (or less
   than the amount) nothing can be sent.

   Every money rule lives in the B.wallet* store layer in
   biometrics.js, and the app UI moves demo money only through
   those functions — this suite tests the rules where they are
   enforced, modelling a scan outcome exactly the way the app
   builds it from the EXISTING verify pipelines: a verified scan
   of person X is { verified: true, personId: X }; anything else
   (no match, spoof rejection, somebody else's palm) is
   { verified: false, personId: null } or a mismatched personId.

   Honesty pins: demo references are DEMO-prefixed, and the app
   source routes every wallet action through the tested layer. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function person(id, name) {
  // The shape finishEnrollment saves in v42 (wallet included).
  return {
    id: id, name: name, phone: '01700000000', type: 'Customer', store: 'GreenCare Pharmacy (CVS)',
    walletProvider: '', walletNumber: '', limits: { perTx: null, daily: null },
    loyaltyPoints: 0, wallet: B.walletNew(), palmProfile: null, enrolledAt: 1795420000000
  };
}
const AUTH_A = { verified: true, personId: 'TSG-BIO-3001' };
const AUTH_B = { verified: true, personId: 'TSG-BIO-3002' };
const NO_AUTH = { verified: false, personId: null };
const TS = 1795423600000;

/* ---------- wallet creation: balance 0, Biom ID is the account --- */
const fresh = B.walletNew();
check('WALLET new wallet starts at balance 0 with an empty statement and no linked accounts',
  fresh.balance === 0 && Array.isArray(fresh.statement) && fresh.statement.length === 0 &&
  Array.isArray(fresh.linkedAccounts) && fresh.linkedAccounts.length === 0);
check('WALLET walletNew output is sane', B.walletSane(fresh));
const noWallet = person('TSG-BIO-3001', 'Ayesha Rahman'); delete noWallet.wallet;
const ensured = B.walletEnsurePerson(noWallet);
check('WALLET a person without a wallet gains one at balance 0, keyed by their Biom ID',
  ensured !== noWallet && ensured.id === 'TSG-BIO-3001' && B.walletSane(ensured.wallet) && ensured.wallet.balance === 0);
check('WALLET ensuring does not mutate the input row', noWallet.wallet === undefined);
const liveWallet = person('TSG-BIO-3001', 'Ayesha Rahman');
liveWallet.wallet.balance = 750;
liveWallet.wallet.statement.push({ ref: 'DEMO-3', ts: TS, kind: 'add', amount: 750, balanceAfter: 750 });
check('WALLET ensuring an already-sane wallet returns the row untouched (identity — no reset)',
  B.walletEnsurePerson(liveWallet) === liveWallet && liveWallet.wallet.balance === 750 && liveWallet.wallet.statement.length === 1);

/* ---------- amount validation ------------------------------------- */
check('AMOUNT a positive number is accepted', B.walletValidateAmount(500).ok === true && B.walletValidateAmount(500).amount === 500);
check('AMOUNT a numeric string is accepted', B.walletValidateAmount('250').ok === true && B.walletValidateAmount('250').amount === 250);
check('AMOUNT zero is rejected', B.walletValidateAmount(0).ok === false && B.walletValidateAmount(0).code === 'INVALID_AMOUNT');
check('AMOUNT a negative amount is rejected', B.walletValidateAmount(-50).ok === false);
check('AMOUNT non-numeric text is rejected', B.walletValidateAmount('abc').ok === false && B.walletValidateAmount('').ok === false);
check('AMOUNT NaN / Infinity are rejected', B.walletValidateAmount(NaN).ok === false && B.walletValidateAmount(Infinity).ok === false);

/* ---------- demo references --------------------------------------- */
check('REF demo references are DEMO-prefixed', B.walletDemoRef(1) === 'DEMO-1' && /^DEMO-\d+$/.test(B.walletDemoRef(1042)));
check('REF a demo reference is never shaped like a provider TrxID', !/^(BK|NG)?[0-9A-Z]{10}$/.test(B.walletDemoRef(1042)) && B.walletDemoRef(1042).indexOf('DEMO-') === 0);

/* ---------- linked funding accounts -------------------------------- */
let a = person('TSG-BIO-3001', 'Ayesha Rahman');
const linkBad = B.walletAddLinkedAccount(a, 'PayPal', 'x', TS);
check('LINK an unknown account type is rejected', linkBad.ok === false && linkBad.code === 'BAD_ACCOUNT_TYPE');
const linkBlank = B.walletAddLinkedAccount(a, 'bKash', '   ', TS);
check('LINK a blank account label is rejected', linkBlank.ok === false && linkBlank.code === 'BAD_ACCOUNT_LABEL');
const linkOk = B.walletAddLinkedAccount(a, 'bKash', 'My bKash — 01933…', TS);
check('LINK a bKash account links onto the wallet', linkOk.ok === true && linkOk.person.wallet.linkedAccounts.length === 1 &&
  linkOk.person.wallet.linkedAccounts[0].type === 'bKash' && linkOk.account.id === linkOk.person.wallet.linkedAccounts[0].id);
a = linkOk.person;
const acctId = linkOk.account.id;

/* ---------- Add Money: the owner's palm is the authorisation ------- */
const addNoAcct = B.walletApplyAddMoney(a, 500, 'ACCT-missing', AUTH_A, TS, B.walletDemoRef(1));
check('ADD without a linked funding account nothing is credited', addNoAcct.ok === false && addNoAcct.code === 'NO_ACCOUNT' && a.wallet.balance === 0);
const addWrongPalm = B.walletApplyAddMoney(a, 500, acctId, AUTH_B, TS, B.walletDemoRef(1));
check('ADD another person\'s verified palm cannot credit this wallet', addWrongPalm.ok === false && addWrongPalm.code === 'AUTH_FAILED' && a.wallet.balance === 0);
const addNoMatch = B.walletApplyAddMoney(a, 500, acctId, NO_AUTH, TS, B.walletDemoRef(1));
check('ADD an unmatched / spoof-rejected scan (no authorisation) credits nothing', addNoMatch.ok === false && addNoMatch.code === 'AUTH_FAILED' && a.wallet.balance === 0);
const addBadAmt = B.walletApplyAddMoney(a, 0, acctId, AUTH_A, TS, B.walletDemoRef(1));
check('ADD a zero amount is rejected even with the owner\'s palm', addBadAmt.ok === false && addBadAmt.code === 'INVALID_AMOUNT' && a.wallet.balance === 0);
const addOk = B.walletApplyAddMoney(a, 1000, acctId, AUTH_A, TS, B.walletDemoRef(1));
check('ADD the owner\'s palm credits the exact amount', addOk.ok === true && addOk.person.wallet.balance === 1000);
check('ADD the credit writes a statement entry with a DEMO reference and the funding account',
  addOk.entry.kind === 'add' && addOk.entry.amount === 1000 && addOk.entry.balanceAfter === 1000 &&
  addOk.entry.ref === 'DEMO-1' && addOk.entry.accountType === 'bKash' && addOk.person.wallet.statement.length === 1);
a = addOk.person;

/* ---------- Send Money: receiver by palm, balance is a hard wall --- */
let b = person('TSG-BIO-3002', 'Tanvir Hasan');
let people = [a, b];
check('RESOLVE an identified Biom ID resolves to that person', B.walletResolveReceiver(people, 'TSG-BIO-3002') === b);
check('RESOLVE a scan matching NO registered palm resolves to null', B.walletResolveReceiver(people, null) === null && B.walletResolveReceiver(people, undefined) === null);
check('RESOLVE an unknown Biom ID resolves to null', B.walletResolveReceiver(people, 'TSG-BIO-9999') === null);

const sendUnreg = B.walletApplySend(clone(people), 'TSG-BIO-3001', null, 100, AUTH_A, TS, B.walletDemoRef(2));
check('SEND to an unregistered palm is impossible — no receiver, no transfer', sendUnreg.ok === false && sendUnreg.code === 'RECEIVER_NOT_REGISTERED');
const sendUnreg2 = B.walletApplySend(people, 'TSG-BIO-3001', 'TSG-BIO-9999', 100, AUTH_A, TS, B.walletDemoRef(2));
check('SEND to an unknown Biom ID is impossible and balances are unchanged',
  sendUnreg2.ok === false && sendUnreg2.code === 'RECEIVER_NOT_REGISTERED' && a.wallet.balance === 1000 && b.wallet.balance === 0);

const sendSelf = B.walletApplySend(people, 'TSG-BIO-3001', 'TSG-BIO-3001', 100, AUTH_A, TS, B.walletDemoRef(2));
check('SEND to yourself is blocked', sendSelf.ok === false && sendSelf.code === 'SELF_SEND' && a.wallet.balance === 1000 && a.wallet.statement.length === 1);

const sendTooMuch = B.walletApplySend(people, 'TSG-BIO-3001', 'TSG-BIO-3002', 1001, AUTH_A, TS, B.walletDemoRef(2));
check('SEND above the balance is blocked — no partial transfer, no negative balance',
  sendTooMuch.ok === false && sendTooMuch.code === 'INSUFFICIENT_BALANCE' && a.wallet.balance === 1000 && b.wallet.balance === 0 &&
  a.wallet.statement.length === 1 && b.wallet.statement.length === 0);

const broke = person('TSG-BIO-3003', 'Empty Wallet');
const sendFromZero = B.walletApplySend([broke, b], 'TSG-BIO-3003', 'TSG-BIO-3002', 50, { verified: true, personId: 'TSG-BIO-3003' }, TS, B.walletDemoRef(2));
check('SEND at balance 0 is blocked — with 0 money no money can be sent',
  sendFromZero.ok === false && sendFromZero.code === 'INSUFFICIENT_BALANCE' && broke.wallet.balance === 0 && b.wallet.balance === 0);

const sendWrongAuth = B.walletApplySend(people, 'TSG-BIO-3001', 'TSG-BIO-3002', 100, AUTH_B, TS, B.walletDemoRef(2));
check('SEND authorised by the RECEIVER\'s palm (not the sender\'s) moves nothing',
  sendWrongAuth.ok === false && sendWrongAuth.code === 'AUTH_FAILED' && a.wallet.balance === 1000 && b.wallet.balance === 0);
const sendNoAuth = B.walletApplySend(people, 'TSG-BIO-3001', 'TSG-BIO-3002', 100, NO_AUTH, TS, B.walletDemoRef(2));
check('SEND with no authorising scan moves nothing', sendNoAuth.ok === false && sendNoAuth.code === 'AUTH_FAILED');

const sendOk = B.walletApplySend(people, 'TSG-BIO-3001', 'TSG-BIO-3002', 300, AUTH_A, TS, B.walletDemoRef(2));
check('SEND a valid send debits the sender and credits the receiver by the exact amount',
  sendOk.ok === true && sendOk.sender.wallet.balance === 700 && sendOk.receiver.wallet.balance === 300);
check('SEND both wallets gain a statement entry under one DEMO reference naming the counterparty',
  sendOk.senderEntry.kind === 'send' && sendOk.receiverEntry.kind === 'receive' &&
  sendOk.senderEntry.ref === 'DEMO-2' && sendOk.receiverEntry.ref === 'DEMO-2' &&
  sendOk.senderEntry.counterpartyId === 'TSG-BIO-3002' && sendOk.receiverEntry.counterpartyId === 'TSG-BIO-3001' &&
  sendOk.senderEntry.balanceAfter === 700 && sendOk.receiverEntry.balanceAfter === 300 &&
  sendOk.sender.wallet.statement.length === 2 && sendOk.receiver.wallet.statement.length === 1);
check('SEND the returned store carries both updates and leaves other rows by identity',
  sendOk.people.length === 2 && sendOk.people[0] === sendOk.sender && sendOk.people[1] === sendOk.receiver);
check('SEND the input rows are not mutated by a transfer', a.wallet.balance === 1000 && b.wallet.balance === 0);
const sendExact = B.walletApplySend(sendOk.people, 'TSG-BIO-3001', 'TSG-BIO-3002', 700, AUTH_A, TS, B.walletDemoRef(3));
check('SEND sending the whole balance is allowed and lands exactly on zero',
  sendExact.ok === true && sendExact.sender.wallet.balance === 0 && sendExact.receiver.wallet.balance === 1000);

/* ---------- migration: v41 -> v42 (also covered in the migration suite) */
const v41Person = person('TSG-BIO-2841', 'Chairman Fixture'); delete v41Person.wallet;
v41Person.loyaltyPoints = 137;
const migStore = { people: [clone(v41Person)], logs: [], transactions: [], meta: [{ key: 'biomSeq', value: 2842 }] };
const mig42 = B.migrateBiomData(migStore, 'v41', 'v42');
const mp42 = mig42.snapshot.people[0];
check('MIGRATE v41->v42 gives the existing enrolment a wallet at balance 0 — no re-enrolment',
  !!mp42.wallet && mp42.wallet.balance === 0 && mp42.wallet.statement.length === 0 && mp42.wallet.linkedAccounts.length === 0);
check('MIGRATE v41->v42 rewrites only the people store and keeps points and identity',
  mig42.changedStores.join(',') === 'people' && mp42.loyaltyPoints === 137 && mp42.id === 'TSG-BIO-2841');
const richStore = clone(mig42.snapshot);
richStore.people[0].wallet.balance = 450;
const migRich = B.migrateBiomData(richStore, 'v41', 'v42');
check('MIGRATE the v42 step never resets an existing wallet balance',
  migRich.snapshot.people[0].wallet.balance === 450 && migRich.changed === false);

/* ---------- the app consumes this layer — no second money path ----- */
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
check('APP registration creates the wallet (finishEnrollment carries B.walletNew())', appSrc.indexOf('wallet: B.walletNew()') !== -1);
check('APP add-money goes through B.walletApplyAddMoney', appSrc.indexOf('B.walletApplyAddMoney') !== -1);
check('APP send-money is REMOVED (Chairman, 2026-11-28: people send money in bKash itself — the app never calls B.walletApplySend; the store primitive stays for historical statement rows)', appSrc.indexOf('B.walletApplySend') === -1);
check('APP wallet scans use the existing pipelines (streamVerifyPalm / streamIdentifyPalm)',
  appSrc.indexOf('streamIdentifyPalm') !== -1 && appSrc.indexOf('streamVerifyPalm') !== -1);
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
check('APP wallet home labels the balance as demo money', htmlSrc.indexOf('Demo balance') !== -1 && htmlSrc.indexOf('Demo money — not real funds') !== -1);
check('APP the wallet is the landing page', htmlSrc.indexOf('<section class="page active" id="page-wallet">') !== -1);

console.log(fail === 0 ? 'ALL WALLET TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
