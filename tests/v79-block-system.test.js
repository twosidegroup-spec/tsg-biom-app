/* TSG BIOM v79 — THE BLOCK SYSTEM, APP LEG (the Chairman's
   block ruling, 2026-11-27 09:51 + the 10:04 expansion).

   What this leg does, and what this suite pins:
   - version coherence at v79 + the v79 step as a pure adoption
     (a v78 store opens byte-identical; the chain is v37->v79,
     43 links, 42 steps);
   - the sync engine's persistent blocked-ID set for OTHER
     people (the terminal's knowledge): learned from flush
     refusals and from every pull summary row (server truth
     both ways — an unblock clears the entry), persisted
     through the loadBlockedIds/saveBlockedIds deps, with an
     in-memory fallback when the deps are absent, cleared by
     reset(), and exposed as Sync.isBlocked(id);
   - the merchant terminal's blocked verdict: the pre-scan
     gate and the post-verdict re-check, with the Chairman's
     own sentence as the copy ("Palm scanning failed — your
     palm scanning is blocked.");
   - the wallet scan card gate: while the own account is
     blocked the card shows the blocked state and the camera
     never starts (every Add / Send / Pay / Verify surface
     rides this card);
   - the Strengthen / Add Angle gate in openTopup;
   - spoof attribution: a terminal spoof verdict names the
     selected person; a wallet spoof verdict is attributed to
     the signed-in account (the server's category-b evidence);
   - the fieldTest wire flag: syncScanRecord carries it only
     when Field Test Mode was on, and the terminal's records
     pass fieldModeOn() through;
   - frozen systems: EDCC 0.32 / PalmNet 0.5895, and the strict
     money rule's bars untouched.

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
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }
function finish() {
  console.log(fail === 0 ? 'ALL V79 BLOCK-SYSTEM TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
}

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

/* ---------- version coherence + identity migration -------------- */
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v94',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v94' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v94'") !== -1 &&
  htmlSrc.indexOf('<meta name="biom-build" content="v94">') !== -1 &&
  htmlSrc.indexOf('TSG Biom · App v94 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v94' &&
  B.BIOM_DATA_VERSIONS.length === 58);
check('MIGRATION the v79 step is a pure adoption: a v78 store opens byte-identical at v79', (function () {
  const before = JSON.stringify({ people: [{ id: 'TSG-BIO-1', name: 'Gate', wallet: { balance: 5, statement: [], linkedAccounts: [] } }], logs: [], transactions: [], meta: [{ k: 'syncBlockedIds', v: 1 }] });
  const mig = B.migrateBiomData(JSON.parse(before), 'v78', 'v79');
  return mig.appliedSteps.join(',') === 'v79' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
})());
check('MIGRATION the whole chain v37->v85 applies 48 steps (pin rolled at the v85 bump)', (function () {
  const mig = B.migrateBiomData({ people: [], logs: [], transactions: [], meta: [] }, 'v37', 'v85');
  return mig.appliedSteps.length === 48 && mig.appliedSteps[mig.appliedSteps.length - 1] === 'v85';
})());
check('FREEZE the shipped bars are untouched (EDCC 0.32 / PalmNet 0.5895)',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895);

/* ---------- the fieldTest wire flag (biometrics record) ---------- */
check('FIELDTEST syncScanRecord carries fieldTest only when the scan ran under Field Test Mode', (function () {
  const on = B.syncScanRecord({ kind: 'money-auth', biomId: 'TSG-BIO-1', result: 'Denied', fieldTest: true });
  const off = B.syncScanRecord({ kind: 'money-auth', biomId: 'TSG-BIO-1', result: 'Denied' });
  const offFalse = B.syncScanRecord({ kind: 'money-auth', biomId: 'TSG-BIO-1', result: 'Denied', fieldTest: false });
  return on.fieldTest === true && !('fieldTest' in off) && !('fieldTest' in offFalse);
})());

/* ---------- surface copy + gate source pins ---------------------- */
check('COPY the blocked copy lives in one place, with the Chairman\'s merchant sentence verbatim',
  appSrc.indexOf("var BLOCKED_TERMINAL_LINE = 'Palm scanning failed — your palm scanning is blocked.';") !== -1 &&
  appSrc.indexOf("var BLOCKED_ACCOUNT_LINE = 'This account has been blocked.") !== -1);
check('TERMINAL the pre-scan blocked gate fires before any scan work (verdict + copy + local log)',
  appSrc.indexOf('if (Sync.isBlocked(person.id)) {') !== -1 &&
  (appSrc.match(/PALM SCANNING BLOCKED/g) || []).length >= 2 &&
  appSrc.indexOf("logVerification(person, method, 'Blocked — account blocked', 'Blocked')") !== -1);
check('TERMINAL the post-verdict re-check stands between the verdict and the sync note / payment',
  (function () {
    const gate = appSrc.indexOf('if (Sync.isBlocked(person.id)) {', appSrc.indexOf('var verified = r.ok === true'));
    const note = appSrc.indexOf('Sync.noteScan({ kind: amount > 0', gate);
    return gate !== -1 && note > gate;
  })());
check('WALLET the scan card refuses to start the camera while the own account is blocked', (function () {
  const show = appSrc.slice(appSrc.indexOf('function showWalletScan'), appSrc.indexOf('function hideWalletScan'));
  const gate = show.indexOf('if (walletBlockedActive()) {');
  const cam = show.indexOf('startWalletCamera();', gate);
  return gate !== -1 && cam > gate && show.indexOf('BLOCKED_ACCOUNT_LINE') !== -1 &&
    show.indexOf("$('wScanStart').disabled = true;") !== -1;
})());
check('WALLET every camera/scan entry point runs the blocked test (seat review: no re-arm bypass)', (function () {
  const start = appSrc.slice(appSrc.indexOf('function startWalletCamera'), appSrc.indexOf('function runWalletScan'));
  const run = appSrc.slice(appSrc.indexOf('function runWalletScan'), appSrc.indexOf('function hideWalletScan'));
  const restarter = appSrc.slice(appSrc.indexOf('camRestarters.walletAct = function'), appSrc.indexOf("$('wScanRun').addEventListener"));
  return appSrc.indexOf('function walletBlockedActive()') !== -1 &&
    start.indexOf('walletBlockedActive()') !== -1 &&
    run.indexOf('walletBlockedActive()') !== -1 &&
    restarter.indexOf('walletBlockedActive()') !== -1;
})());
check('WALLET the blocked test consults the persisted set as well as the latch (seat review)', (function () {
  const helper = appSrc.slice(appSrc.indexOf('function walletBlockedActive()'), appSrc.indexOf('function startWalletCamera'));
  return helper.indexOf('Sync.state().blocked') !== -1 && helper.indexOf('Sync.isBlocked(me.id)') !== -1;
})());
check('TERMINAL the pre-scan gate awaits the blocked-set load (no cold-start window)', 
  appSrc.indexOf('return Sync.ensureBlockedIds();') !== -1 &&
  appSrc.indexOf('ensureBlockedIds: ensureBlockedIds') !== -1);
check('SEND the blocked-receiver refusal is REMOVED with the Send flow (v90, Chairman 2026-11-28 — there is no send left to refuse; totality is pinned by the terminal + wallet + topup checks in this suite)',
  appSrc.indexOf('Money cannot be sent to a blocked account.') === -1 &&
  appSrc.indexOf('wSendScanReceiver') === -1);
check('TOPUP the blocked copy names the right flow in Neural Scan mode', 
  appSrc.indexOf('Neural Scan is stopped while the block stands.') !== -1);
check('FIELDTEST the field-test record itself carries the exclusion flag (seat review)', 
  appSrc.indexOf("kind: 'field-test', profileName: person.name") !== -1 &&
  appSrc.indexOf('result: result, fieldTest: fieldModeOn() }') !== -1);
check('TOPUP Strengthen / Add Angle gate on the blocked set before any camera work', (function () {
  const open = appSrc.slice(appSrc.indexOf('function openTopup'), appSrc.indexOf('function closeTopup'));
  return open.indexOf('Sync.isBlocked(personId)') !== -1 && open.indexOf('BLOCKED_ACCOUNT_LINE') !== -1;
})());
check('SPOOF the terminal attributes a spoof verdict to the selected person',
  appSrc.indexOf("result: 'Spoof / Screen Replay Detected', fieldTest: fieldModeOn() }") !== -1 &&
  appSrc.indexOf("out.fail.indexOf('Spoof / Screen Replay') === 0") !== -1);
check('SPOOF the wallet attributes a spoof verdict to the signed-in account (and writes one record, not two)',
  appSrc.indexOf('var spoofAttributed = false;') !== -1 &&
  appSrc.indexOf('if (!spoofAttributed && ctx && ctx.syncKind && out && out.diag)') !== -1);
check('FIELDTEST the terminal records pass fieldModeOn() through to the sync note',
  appSrc.indexOf("result: verified ? 'Verified' : 'Denied', fieldTest: fieldModeOn(),") !== -1);
check('WIRING the engine gets its blocked-set persistence deps (DB meta syncBlockedIds)',
  appSrc.indexOf("loadBlockedIds: function () { return DB.getMeta('syncBlockedIds', {}); }") !== -1 &&
  appSrc.indexOf("saveBlockedIds: function (m) { return DB.setMeta('syncBlockedIds', m); }") !== -1 &&
  appSrc.indexOf('isBlocked: isBlocked') !== -1);

/* ---------- the blocked-ID set, engine extracted and driven ------ */
const engineSrc = appSrc.slice(appSrc.indexOf('/* SYNC-ENGINE-BEGIN'), appSrc.indexOf('/* SYNC-ENGINE-END */'));
check('ENGINE the sync engine block is extractable from app.js', engineSrc.indexOf('function createBiomSync') !== -1);
const createBiomSync = new Function(engineSrc + '\nreturn createBiomSync;')();
const OTHER_PERSON = { id: 'TSG-BIO-OTHER', name: 'Other Person', palmProfile: { v: 4, format: 'packed96', hand: 'right', codes: ['REVG'], neural: { v: 1, dim: 256, model: 'palmnet-r3-ep12', embeddings: ['SUpL'] } } };

function jsonRes(status, body) {
  return { status: status, json: function () { return Promise.resolve(body || {}); }, headers: { get: function () { return null; } } };
}
function makeEngine(over) {
  over = over || {};
  const store = { outbox: [], versions: {}, blockedIds: over.blockedSeed || {} };
  const prefs = { on: true, endpoint: 'http://api.test', deviceId: 'dev-rig', deviceSecret: 'secret-rig', label: 'Rig phone' };
  const rig = { seq: 0 };
  let n = 0;
  const deps = {
    B: B, modelId: 'palmnet-r3-ep12', appVersion: 'v79',
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
  if (!over.noBlockedDeps) {
    deps.loadBlockedIds = function () { return Promise.resolve(JSON.parse(JSON.stringify(store.blockedIds))); };
    deps.saveBlockedIds = function (set) { store.blockedIds = JSON.parse(JSON.stringify(set)); return Promise.resolve(); };
  }
  return { engine: createBiomSync(deps), store: store, rig: rig };
}

async function engineTests() {
  /* (1) a flush refusal for a CUSTOMER teaches the set, persists
     it, and never latches this device's own state */
  let plan = [];
  let t = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    fetchFn: function () { return Promise.resolve(plan.shift() || jsonRes(201, { ok: true, version: 1 })); }
  });
  plan = [jsonRes(403, { error: 'account blocked', blocked: true, biomId: 'TSG-BIO-OTHER' })];
  t.engine.noteScan({ kind: 'money-auth', profileName: 'Other Person', biomId: 'TSG-BIO-OTHER', hand: 'right', edccScore: 0.5, palmnetScore: 0.9, result: 'Verified' });
  await tick();
  let st = await t.engine.flush();
  check('SET a flush refusal teaches isBlocked(customer) without latching the own state',
    t.engine.isBlocked('TSG-BIO-OTHER') === true && st.blocked === false && st.revoked === false);
  check('SET the learned block is persisted through the dep',
    t.store.blockedIds['TSG-BIO-OTHER'] === true);
  /* (1b) restart persistence, proven offline: a fresh engine
     over a pre-seeded store, with every fetch failing, knows
     the seeded block from its persisted set alone — no server
     contact teaches it (seat review: this check used to be a
     stub that returned true; it now drives the real path). */
  let off = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    blockedSeed: { 'TSG-BIO-SEEDED': true },
    fetchFn: function () { return Promise.reject(new Error('offline')); }
  });
  await off.engine.ensureBlockedIds();
  await off.engine.flush().catch(function () {});
  check('SET a pre-seeded set is honoured after a restart with no server contact (persisted knowledge survives)',
    off.engine.isBlocked('TSG-BIO-SEEDED') === true && off.engine.isBlocked('TSG-BIO-OWN') === false);

  /* (2) pull learns from EVERY summary row and clears on unblock */
  let summary = { profiles: [
    { biomId: 'TSG-BIO-OTHER', version: 5, blocked: true },
    { biomId: 'TSG-BIO-THIRD', version: 2, blocked: true },
    { biomId: 'TSG-BIO-OWN', version: 5, blocked: false }
  ] };
  let p = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    blockedSeed: { 'TSG-BIO-STALE': true },
    fetchFn: function () { return Promise.resolve(jsonRes(200, summary)); }
  });
  st = await p.engine.pull();
  check('SET pull learns blocked rows for other people (and the own latch stays off for an unblocked own row)',
    p.engine.isBlocked('TSG-BIO-OTHER') === true && p.engine.isBlocked('TSG-BIO-THIRD') === true && st.blocked === false);
  summary = { profiles: [
    { biomId: 'TSG-BIO-OTHER', version: 6, blocked: false },
    { biomId: 'TSG-BIO-THIRD', version: 2, blocked: true },
    { biomId: 'TSG-BIO-OWN', version: 5, blocked: false }
  ] };
  st = await p.engine.pull();
  check('SET an unblock on the server clears the entry on the next pull (server truth both ways)',
    p.engine.isBlocked('TSG-BIO-OTHER') === false && p.engine.isBlocked('TSG-BIO-THIRD') === true);
  check('SET a stale seeded entry for a person absent from the pull is left alone (absence is not evidence)',
    p.engine.isBlocked('TSG-BIO-STALE') === true);

  /* (3) dep-absent fallback: the set still works in-memory */
  let plan3 = [];
  let m = makeEngine({
    noBlockedDeps: true,
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    fetchFn: function () { return Promise.resolve(plan3.shift() || jsonRes(201, { ok: true, version: 1 })); }
  });
  plan3 = [jsonRes(403, { error: 'account blocked', blocked: true, biomId: 'TSG-BIO-OTHER' })];
  m.engine.noteProfile(OTHER_PERSON);
  await tick();
  await m.engine.flush();
  check('SET with no persistence deps the set still answers within the session',
    m.engine.isBlocked('TSG-BIO-OTHER') === true);

  /* (4) reset() forgets the set with the credential */
  m.engine.reset();
  check('SET reset() clears the blocked set alongside the credential',
    m.engine.isBlocked('TSG-BIO-OTHER') === false);

  /* (5) testConnection: a blocked marker on the revoked denial
     latches blocked (F1 client side) */
  let c = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    fetchFn: function () { return Promise.resolve(jsonRes(403, { error: 'device revoked', revoked: true, blocked: true, biomId: 'TSG-BIO-OWN' })); }
  });
  const tc = await c.engine.testConnection();
  check('F1 testConnection reads the blocked marker on a revoked denial and latches blocked',
    tc.ok === false && /blocked/i.test(tc.message || '') && c.engine.state().blocked === true && c.engine.state().revoked === false);
}

engineTests().then(finish).catch(function (e) {
  console.log('FAIL  engine rig threw: ' + (e && e.stack || e));
  fail++;
  finish();
});
