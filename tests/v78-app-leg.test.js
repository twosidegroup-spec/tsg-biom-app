/* TSG BIOM v78 — DASHBOARD CONTROL, APP LEG (the Chairman's
   orders, 2026-11-27 01:24–01:39; the API + dashboard side of
   v78 is already LIVE — see the v78 report §8).

   What this leg does, and what this suite pins:
   - the profile emit gains the wallet + Biom Pay mirrors,
     shaped field-by-field to EXACTLY the whitelist the shipped
     API applies — proven here by deep-equality against the
     API's own lib/records.js shapers and its shapeProfile entry
     point, not against a copy of them;
   - noteMoneyProfile: the money-moment emit (Add, Send —
     sender AND receiver — both Pay creations, and the recorded
     bKash sandbox pay), attaching payRecords to a transient
     copy that is never stored on the person row;
   - the sync engine's blocked latch: a 403 carrying
     blocked:true is an ACCOUNT block, not a device revocation —
     the refused item is dropped, the flush continues for
     everyone else, and the latch engages only for this device's
     own Biom ID (flush refusal, or the person's own summary row
     on pull, which also clears it on unblock);
   - version coherence at v78 + the v78 step as a pure adoption;
   - frozen systems: EDCC 0.32 / PalmNet 0.5895.

   All numbers here are RIG numbers; the phone is the verdict. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');
const apiRecords = require('../../tsg-biom-api/lib/records.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }
function finish() {
  console.log(fail === 0 ? 'ALL V78 APP-LEG TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
}

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

/* ---------- version coherence + identity migration -------------- */
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v91',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v91' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v91'") !== -1 &&
  htmlSrc.indexOf('<meta name="biom-build" content="v91">') !== -1 &&
  htmlSrc.indexOf('TSG Biom · App v91 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v91' &&
  B.BIOM_DATA_VERSIONS.length === 55);
check('MIGRATION the v78 step is a pure adoption: a v77 store opens byte-identical at v78', (function () {
  const before = JSON.stringify({ people: [{ id: 'TSG-BIO-1', name: 'Gate', wallet: { balance: 5, statement: [], linkedAccounts: [] } }], logs: [], transactions: [], meta: [{ k: 'x', v: 1 }] });
  const mig = B.migrateBiomData(JSON.parse(before), 'v77', 'v78');
  return mig.appliedSteps.join(',') === 'v78' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
})());
check('MIGRATION the whole chain v37->v85 applies 48 steps (pin rolled at the v85 bump; the v78 suite originally proved the chain to v78)', (function () {
  const mig = B.migrateBiomData({ people: [], logs: [], transactions: [], meta: [] }, 'v37', 'v85');
  return mig.appliedSteps.length === 48 && mig.appliedSteps[mig.appliedSteps.length - 1] === 'v85';
})());
check('FREEZE the shipped bars are untouched (EDCC 0.32 / PalmNet 0.5895)',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895);

/* ---------- the mirrors, against the shipped API shaper --------- */
const WALLET = {
  balance: 1250.5,
  statement: [
    { ref: 'DEMO-1', ts: 1764000001000, kind: 'add', amount: 2000, balanceAfter: 2000, accountType: 'bKash', accountLabel: 'Personal ···· 5706', note: 'Demo money added inside the app — not real funds.' },
    { ref: 'DEMO-2', ts: 1764000002000, kind: 'send', amount: 500, balanceAfter: 1500, counterpartyId: 'TSG-BIO-2', counterpartyName: 'Receiver Person', note: 'Demo transfer inside the app — not a real payment.' },
    { ref: 'DEMO-3', ts: 1764000003000, kind: 'receive', amount: 250.5, balanceAfter: 1750.5, counterpartyId: 'TSG-BIO-3', counterpartyName: 'Sender Person', note: 'Demo transfer inside the app — not a real payment.' },
    { ref: 'BAD-1', ts: 1764000004000, kind: 'pay', amount: 10, balanceAfter: 1740.5 },
    { ref: 'BAD-2', ts: 'not-a-ts', kind: 'add', amount: 10, balanceAfter: 1750.5, accountType: 'bKash', accountLabel: 'X' },
    { ref: 'DEMO-4', ts: 1764000005000, kind: 'add', amount: 100, balanceAfter: 1850.5, accountType: 'Nagad', accountLabel: 'Agent ···· 1234', note: 'Demo money added inside the app — not real funds.', internalField: 'must not leave the device' }
  ],
  linkedAccounts: [{ id: 'acct-1', type: 'bKash', label: 'Personal ···· 5706' }]
};
const PAY_RECORDS = [
  { id: 'BIOM-PAY-1001', ts: 1764000100000, personId: 'TSG-BIO-1', personName: 'Mirror Person', provider: 'bKash', walletMasked: '01933-***706', store: 'GreenCare Pharmacy', amount: 300, method: 'palm', measured: 'Palmprint similarity 0.512', status: 'Authorized — Demo' },
  { id: 'BKASH-SANDBOX-TRX1', ts: 1764000200000, personId: 'TSG-BIO-1', personName: 'Mirror Person', provider: 'bKash', walletMasked: '01933-***706', store: 'Mall Store', amount: 150, method: 'palm', rail: 'bkash-sandbox', trxID: 'TRX1', paymentID: 'PAY1', status: 'Completed — bKash Sandbox (TEST MODE)' },
  { id: '', ts: 1764000300000, amount: 10, store: 'No Id Store', provider: 'bKash', status: 'Authorized — Demo' },
  { id: 'BIOM-PAY-1002', ts: -5, amount: 10, store: 'Bad Ts Store', provider: 'bKash', status: 'Authorized — Demo' }
];
const PERSON = {
  id: 'TSG-BIO-1', name: 'Mirror Person', phone: '01933038706',
  palmProfile: { v: 4, format: 'packed96', hand: 'left', codes: ['QUJD'], neural: { v: 1, dim: 256, model: 'palmnet-r3-ep12', embeddings: ['R0hJ'] } },
  wallet: WALLET, payRecords: PAY_RECORDS
};

(function () {
  const rec = B.syncProfileRecord(PERSON, 1764000000000);
  check('MIRROR the emit carries a wallet mirror', !!rec && !!rec.wallet);
  check('MIRROR the app wallet mirror is byte-identical to the shipped API shaper output',
    deepEq(rec.wallet, apiRecords.shapeWalletMirror(WALLET)));
  check('MIRROR the app pays mirror is byte-identical to the shipped API shaper output',
    deepEq(rec.pays, apiRecords.shapePays(PAY_RECORDS)));
  check('MIRROR the local note and internal fields never leave the device',
    JSON.stringify(rec).indexOf('not real funds') === -1 && JSON.stringify(rec).indexOf('must not leave the device') === -1 &&
    JSON.stringify(rec).indexOf('walletMasked') === -1 && JSON.stringify(rec).indexOf('Palmprint similarity') === -1);
  check('MIRROR malformed entries are dropped, valid ones kept in order',
    rec.wallet.statement.length === 4 && rec.wallet.statement.map(function (e) { return e.ref; }).join(',') === 'DEMO-1,DEMO-2,DEMO-3,DEMO-4' &&
    rec.pays.length === 2 && rec.pays[0].id === 'BIOM-PAY-1001' && rec.pays[1].id === 'BKASH-SANDBOX-TRX1');

  /* the exact shipped entry point the server runs on the wire body */
  const shaped = apiRecords.shapeProfile({
    biomId: PERSON.id, name: PERSON.name, hand: 'left', edccCodes: ['QUJD'], neuralEmbeddings: ['R0hJ'],
    neuralModel: 'palmnet-r3-ep12', enc: 'v1', updatedTs: 1764000000000, wallet: WALLET, pays: PAY_RECORDS
  });
  check('MIRROR the API accepts the app emit at shapeProfile with identical mirrors',
    !shaped.error && deepEq(shaped.record.wallet, rec.wallet) && deepEq(shaped.record.pays, rec.pays));
  const shapedEmpty = apiRecords.shapeProfile({
    biomId: PERSON.id, name: PERSON.name, hand: 'left', edccCodes: ['QUJD'], neuralEmbeddings: [],
    neuralModel: '', enc: 'v1', updatedTs: 1, pays: []
  });
  check('MIRROR an explicitly empty pays array rides the API as a deliberate clear',
    !shapedEmpty.error && deepEq(shapedEmpty.record.pays, []));

  const bare = { id: 'TSG-BIO-9', name: 'Bare', palmProfile: PERSON.palmProfile };
  const bareRec = B.syncProfileRecord(bare, 7);
  check('MIRROR a person with no wallet and no payRecords emits the pre-v78 record byte-identical',
    deepEq(bareRec, { biomId: 'TSG-BIO-9', name: 'Bare', hand: 'left', edccCodes: ['QUJD'], neuralEmbeddings: ['R0hJ'], neuralModel: 'palmnet-r3-ep12', updatedTs: 7 }));
  const walletOnly = B.syncProfileRecord(Object.assign({}, bare, { wallet: WALLET }), 7);
  check('MIRROR wallet without payRecords: wallet rides, pays stays absent (server preservation holds)',
    !!walletOnly.wallet && !('pays' in walletOnly));
  const emptyPays = B.syncProfileRecord(Object.assign({}, bare, { payRecords: [] }), 7);
  check('MIRROR an explicitly empty payRecords emits pays: [] (the deliberate clear)',
    deepEq(emptyPays.pays, []));
  const badWallet = B.syncProfileRecord(Object.assign({}, bare, { wallet: { balance: 'rich', statement: [] } }), 7);
  check('MIRROR a malformed wallet is dropped whole — the bank still lands',
    !!badWallet && !('wallet' in badWallet) && badWallet.biomId === 'TSG-BIO-9');
  const noStmt = B.syncProfileRecord(Object.assign({}, bare, { wallet: { balance: 42 } }), 7);
  check('MIRROR a wallet with a balance but no statement emits an empty statement',
    deepEq(noStmt.wallet, { balance: 42, statement: [] }));

  const bigStmt = { balance: 1, statement: [], linkedAccounts: [] };
  for (let i = 1; i <= 105; i++) bigStmt.statement.push({ ref: 'R' + i, ts: 1764000000000 + i, kind: 'add', amount: 1, balanceAfter: i, accountType: 'bKash', accountLabel: 'L' });
  const bigRec = B.syncProfileRecord(Object.assign({}, bare, { wallet: bigStmt }), 7);
  check('MIRROR the statement tail is capped at the newest 100, like the API',
    bigRec.wallet.statement.length === 100 && bigRec.wallet.statement[0].ref === 'R6' && bigRec.wallet.statement[99].ref === 'R105');
  const manyPays = [];
  for (let i = 1; i <= 55; i++) manyPays.push({ id: 'BIOM-PAY-' + (1000 + i), ts: 1764000000000 + i, amount: 10, store: 'S', provider: 'bKash', status: 'Authorized — Demo' });
  const manyRec = B.syncProfileRecord(Object.assign({}, bare, { payRecords: manyPays }), 7);
  check('MIRROR the pays tail is capped at the newest 50, like the API',
    manyRec.pays.length === 50 && manyRec.pays[0].id === 'BIOM-PAY-1006' && manyRec.pays[49].id === 'BIOM-PAY-1055');
})();

/* ---------- noteMoneyProfile: shape + call sites ----------------- */
check('MONEY noteMoneyProfile exists once, attaches payRecords to a transient copy and notes THAT',
  (appSrc.match(/function noteMoneyProfile\(person\)/g) || []).length === 1 &&
  appSrc.indexOf('copy.payRecords = mine.slice(-50)') !== -1 &&
  appSrc.indexOf('Sync.noteProfile(copy)') !== -1 &&
  appSrc.indexOf("DB.put('people', copy") === -1);
check('MONEY the money moments call it: Add, terminal Pay, wallet Pay, bKash record (v90: the Send moments left with the removed Send flow)',
  appSrc.indexOf('noteMoneyProfile(res.person); // v78: mirror the new balance + ledger') !== -1 &&
  appSrc.indexOf('noteMoneyProfile(res.sender); // v78: mirror both sides of the transfer') === -1 &&
  appSrc.indexOf('noteMoneyProfile(person); // v78: mirror the pay record + wallet') !== -1 &&
  appSrc.indexOf('noteMoneyProfile(fresh); // v78: mirror the pay record + wallet') !== -1 &&
  appSrc.indexOf('noteMoneyProfile(person); // v78: the recorded sandbox pay rides the same mirror') !== -1);
check('MONEY the wiring gives the engine its own Biom ID (the signed-in wallet person)',
  appSrc.indexOf('ownBiomId: function () { var me = walletSessionPerson(); return me ? me.id : null; }') !== -1);

/* ---------- the blocked latch, engine extracted and driven ------- */
const engineSrc = appSrc.slice(appSrc.indexOf('/* SYNC-ENGINE-BEGIN'), appSrc.indexOf('/* SYNC-ENGINE-END */'));
check('ENGINE the sync engine block is extractable from app.js', engineSrc.indexOf('function createBiomSync') !== -1);
const createBiomSync = new Function(engineSrc + '\nreturn createBiomSync;')();
const ENGINE_PERSON = { id: 'TSG-BIO-OWN', name: 'Owner Person', palmProfile: { v: 4, format: 'packed96', hand: 'left', codes: ['QUJD'], neural: { v: 1, dim: 256, model: 'palmnet-r3-ep12', embeddings: ['R0hJ'] } } };
const OTHER_PERSON = { id: 'TSG-BIO-OTHER', name: 'Other Person', palmProfile: { v: 4, format: 'packed96', hand: 'right', codes: ['REVG'], neural: { v: 1, dim: 256, model: 'palmnet-r3-ep12', embeddings: ['SUpL'] } } };

function jsonRes(status, body) {
  return { status: status, json: function () { return Promise.resolve(body || {}); }, headers: { get: function () { return null; } } };
}
function makeEngine(over) {
  over = over || {};
  const store = { outbox: [], versions: {} };
  const prefs = { on: true, endpoint: 'http://api.test', deviceId: 'dev-rig', deviceSecret: 'secret-rig', label: 'Rig phone' };
  const rig = { seq: 0 };
  let n = 0;
  const deps = {
    B: B, modelId: 'palmnet-r3-ep12', appVersion: 'v78',
    getPrefs: function () { return prefs; },
    loadOutbox: function () { return Promise.resolve(store.outbox); },
    saveOutbox: function (items) { store.outbox = items; return Promise.resolve(); },
    fetchFn: over.fetchFn,
    now: function () { return 1764000000000; },
    uuid: function () { return 'uuid-' + (++n); },
    onStatus: function () {},
    loadVersions: function () { return Promise.resolve(JSON.parse(JSON.stringify(store.versions))); },
    saveVersions: function (v) { store.versions = v; },
    getSeq: function () { return rig.seq; },
    setSeq: function (s) { rig.seq = s; },
    saveCredential: function (id, secret) { prefs.deviceId = id; prefs.deviceSecret = secret; },
    signRequest: function () { return Promise.resolve('sig'); },
    applyTombstone: function () { return Promise.resolve(); },
    onProfileConflict: function () {},
    ownBiomId: over.ownBiomId
  };
  if (!over.ownBiomId) delete deps.ownBiomId;
  return { engine: createBiomSync(deps), store: store, rig: rig };
}

async function engineTests() {
  /* (1) own profile write refused with blocked:true — latch, drop,
     no revocation, sequence consumed, flush continues afterwards */
  let plan = [];
  let m = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    fetchFn: function () { return Promise.resolve(plan.shift() || jsonRes(201, { ok: true, version: 9 })); }
  });
  plan = [jsonRes(403, { error: 'account blocked', blocked: true, biomId: 'TSG-BIO-OWN' })];
  m.engine.noteProfile(ENGINE_PERSON);
  await tick();
  let st = await m.engine.flush();
  check('BLOCK a blocked:true 403 latches blocked (not revoked) for the own ID',
    st.blocked === true && st.blockedBiomId === 'TSG-BIO-OWN' && st.revoked === false);
  check('BLOCK the refused item is dropped (it can never succeed) and the sequence was consumed',
    st.queued === 0 && m.rig.seq === 1);
  check('BLOCK statusText is the plain blocked state, not silent failure',
    m.engine.statusText().indexOf('This account has been blocked') === 0);
  plan = [jsonRes(201, { ok: true, version: 2 }), jsonRes(201, { ok: true, version: 3 })];
  m.engine.noteProfile(OTHER_PERSON);
  m.engine.noteScan({ kind: 'verify', profileName: 'Other Person', biomId: 'TSG-BIO-OTHER', hand: 'right', edccScore: 0.5, palmnetScore: 0.9, result: 'Verified' });
  await tick();
  st = await m.engine.flush();
  check('BLOCK the latch does not wedge the queue: other people still flush while blocked',
    st.queued === 0 && st.blocked === true);
  plan = [jsonRes(201, { ok: true, version: 9 })];
  m.engine.noteProfile(ENGINE_PERSON);
  await tick();
  st = await m.engine.flush();
  check('BLOCK a later successful own profile write clears the latch (server evidence)',
    st.blocked === false && st.blockedBiomId === '');

  /* (2) a terminal flushing a blocked CUSTOMER's scan: dropped,
     unlatched, and the flush carries on */
  let plan2 = [];
  let t = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    fetchFn: function () { return Promise.resolve(plan2.shift() || jsonRes(201, { ok: true, version: 1 })); }
  });
  plan2 = [jsonRes(403, { error: 'account blocked', blocked: true, biomId: 'TSG-BIO-OTHER' }), jsonRes(201, { ok: true, version: 4 })];
  t.engine.noteScan({ kind: 'money-auth', profileName: 'Other Person', biomId: 'TSG-BIO-OTHER', hand: 'right', edccScore: 0.5, palmnetScore: 0.9, result: 'Verified' });
  t.engine.noteProfile(OTHER_PERSON);
  await tick();
  st = await t.engine.flush();
  check('BLOCK a stranger\'s block drops their item but never latches this device',
    st.blocked === false && st.revoked === false && st.queued === 0);

  /* (3) a plain 403 without the blocked marker is still a revocation */
  let r = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    fetchFn: function () { return Promise.resolve(jsonRes(403, { error: 'device revoked' })); }
  });
  r.engine.noteProfile(ENGINE_PERSON);
  await tick();
  st = await r.engine.flush();
  check('BLOCK a 403 without blocked:true still latches revoked, exactly as v62',
    st.revoked === true && st.blocked === false && st.queued === 1);

  /* (4) pull learns the block from the own summary row, a
     stranger's row does not latch, and an unblock clears it */
  let summary = { profiles: [
    { biomId: 'TSG-BIO-OTHER', version: 5, blocked: true },
    { biomId: 'TSG-BIO-OWN', version: 5, blocked: true }
  ] };
  let p = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    fetchFn: function () { return Promise.resolve(jsonRes(200, summary)); }
  });
  st = await p.engine.pull();
  check('BLOCK pull latches from the OWN summary row (blocked:true rides the lean summary)',
    st.blocked === true && st.blockedBiomId === 'TSG-BIO-OWN');
  summary = { profiles: [{ biomId: 'TSG-BIO-OWN', version: 6 }] };
  st = await p.engine.pull();
  check('BLOCK pull clears the latch when the own row no longer carries the flag (unblock)',
    st.blocked === false && st.blockedBiomId === '');

  let summary2 = { profiles: [{ biomId: 'TSG-BIO-OTHER', version: 5, blocked: true }] };
  let p2 = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    fetchFn: function () { return Promise.resolve(jsonRes(200, summary2)); }
  });
  st = await p2.engine.pull();
  check('BLOCK a stranger\'s blocked summary row never latches this device', st.blocked === false);

  /* (5) settingsChanged clears the latch, like the other penalties */
  let plan5 = [];
  let s5 = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    fetchFn: function () { return Promise.resolve(plan5.shift() || jsonRes(201, { ok: true, version: 1 })); }
  });
  plan5 = [jsonRes(403, { error: 'account blocked', blocked: true, biomId: 'TSG-BIO-OWN' })];
  s5.engine.noteProfile(ENGINE_PERSON);
  await tick();
  st = await s5.engine.flush();
  const latched = st.blocked === true;
  s5.engine.settingsChanged();
  check('BLOCK settingsChanged clears the blocked latch (re-registration path stays open)',
    latched && s5.engine.state().blocked === false && s5.engine.state().lastError === '');

  /* (6) Seat 2 F2: a tombstone refused by a block is RETAINED —
     Delete All must land after an unblock, not silently never */
  let plan6 = [];
  let s6 = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    fetchFn: function () { return Promise.resolve(plan6.shift() || jsonRes(201, { ok: true, version: 9 })); }
  });
  plan6 = [jsonRes(403, { error: 'account blocked', blocked: true, biomId: 'TSG-BIO-OWN' })];
  await s6.engine.queueTombstones([ENGINE_PERSON]);
  st = await s6.engine.flush();
  check('BLOCK (F2) a tombstone refused by a block is retained, not dropped',
    st.blocked === true && st.queued === 1);
  plan6 = [jsonRes(201, { ok: true, version: 9 })];
  st = await s6.engine.flush();
  check('BLOCK (F2) the retained tombstone lands on the next flush (post-unblock)',
    st.queued === 0);

  /* (7) Seat 2 F5b: with no ownBiomId dep, the latch engages on
     any blocked refusal (the conservative fallback) */
  let s7 = makeEngine({
    fetchFn: function () { return Promise.resolve(jsonRes(403, { error: 'account blocked', blocked: true, biomId: 'TSG-BIO-ANY' })); }
  });
  s7.engine.noteScan({ kind: 'verify', profileName: 'Any', biomId: 'TSG-BIO-ANY', hand: 'left', edccScore: 0.5, palmnetScore: 0.9, result: 'Verified' });
  await tick();
  st = await s7.engine.flush();
  check('BLOCK with no ownBiomId dep the latch engages (fallback semantics)',
    st.blocked === true && st.blockedBiomId === 'TSG-BIO-ANY' && st.queued === 0);

  /* (8) Seat 2 F5b: a blocked body without a biomId falls back
     to the refused item's own Biom ID */
  let s8 = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    fetchFn: function () { return Promise.resolve(jsonRes(403, { error: 'account blocked', blocked: true })); }
  });
  s8.engine.noteProfile(ENGINE_PERSON);
  await tick();
  st = await s8.engine.flush();
  check('BLOCK a biomId-less blocked body falls back to the item\'s Biom ID',
    st.blocked === true && st.blockedBiomId === 'TSG-BIO-OWN');

  /* (9) Seat 1 fix: pull's 403 honours a blocked body; a plain
     403 on pull still revokes */
  let p9 = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    fetchFn: function () { return Promise.resolve(jsonRes(403, { error: 'account blocked', blocked: true, biomId: 'TSG-BIO-OWN' })); }
  });
  st = await p9.engine.pull();
  check('BLOCK pull latches blocked (not revoked) when its 403 carries blocked:true for the own ID',
    st.blocked === true && st.revoked === false);
  let p9b = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    fetchFn: function () { return Promise.resolve(jsonRes(403, { error: 'device revoked', revoked: true })); }
  });
  st = await p9b.engine.pull();
  check('BLOCK pull still latches revoked on a plain 403 (the shipped API\'s revoked shape)',
    st.revoked === true && st.blocked === false);

  /* (10) Seat 1 fix 8: noteMoneyProfile, behaviourally — the
     noted copy carries the tail, the stored person is untouched,
     and a failing DB read is swallowed to false */
  const nmpStart = appSrc.indexOf('function noteMoneyProfile(person) {');
  const nmpEnd = appSrc.indexOf('\n  }\n', nmpStart);
  const nmpSrc = appSrc.slice(nmpStart, nmpEnd + 5);
  check('MONEY noteMoneyProfile is extractable for the behavioural rig',
    nmpStart !== -1 && nmpSrc.indexOf('Sync.noteProfile(copy)') !== -1);
  const noted = [];
  const txs = [];
  for (let i = 1; i <= 55; i++) txs.push({ id: 'BIOM-PAY-' + i, ts: 1764000000000 + i, personId: 'TSG-BIO-1', amount: 10, store: 'S', provider: 'bKash', status: 'Authorized — Demo' });
  txs.push({ id: 'OTHER-1', ts: 1764009999999, personId: 'TSG-BIO-2', amount: 1, store: 'X', provider: 'bKash', status: 'Authorized — Demo' });
  const stubSync = { noteProfile: function (p) { noted.push(p); } };
  const noteMoneyProfile = new Function('DB', 'Sync', nmpSrc + '\nreturn noteMoneyProfile;')(
    { all: function () { return Promise.resolve(txs); } }, stubSync);
  const personFixture = { id: 'TSG-BIO-1', name: 'Fixture', wallet: { balance: 10, statement: [] } };
  const beforeJson = JSON.stringify(personFixture);
  await noteMoneyProfile(personFixture);
  check('MONEY (behavioural) the noted copy carries the newest-50 own pay records only',
    noted.length === 1 && noted[0].payRecords.length === 50 &&
    noted[0].payRecords.every(function (t) { return t.personId === 'TSG-BIO-1'; }) &&
    noted[0].payRecords[0].id === 'BIOM-PAY-6' && noted[0].payRecords[49].id === 'BIOM-PAY-55');
  check('MONEY (behavioural) the input person is untouched — payRecords never lands on the stored row',
    JSON.stringify(personFixture) === beforeJson && !('payRecords' in personFixture) && noted[0] !== personFixture);
  const noteMoneyProfileBad = new Function('DB', 'Sync', nmpSrc + '\nreturn noteMoneyProfile;')(
    { all: function () { return Promise.reject(new Error('db down')); } }, stubSync);
  const swallowed = await noteMoneyProfileBad(personFixture);
  check('MONEY (behavioural) a rejecting DB read resolves false — a money flow can never break on it',
    swallowed === false);
}

engineTests().then(finish).catch(function (e) {
  console.log('FAIL  engine tests threw: ' + (e && e.stack || e));
  fail++;
  finish();
});
