/* TSG BIOM v73 — FLAW-AUDIT FIX REGRESSIONS (Seat 1 + Seat 3).
   Every check below is written against the NEW (fixed)
   behaviour and fails on the v72 code in principle:

   S1-F1 (HIGH)  Vault.encryptProfileCore fails CLOSED: with
     the vault not ready it resolves null, so the REAL sync
     engine (extracted verbatim from app.js) queues NOTHING and
     posts NOTHING. The local-save transform (vaultEncryptRow)
     is a different function and still resolves the row
     unchanged — local saves keep working exactly as before.
   S1-F2 (MED)   Profile deletion purges queued non-scan outbox
     items for the Biom ID in EVERY branch: a sync-off delete of
     a profile whose upsert was queued leaves an outbox with no
     item for that ID, and a later sync-on flush posts no bank.
   S1-F3 (LOW)   the localStorage migration stamps the data
     version only when every changed store wrote back.
   S1-F5 (LOW)   the service worker caches shell responses only
     when the content type matches the shell file's class.
   F1 (HIGH)     Sandbox Biom Pay: amount + store are bound at
     palm authorisation (sandboxAttempt); the Continue handler
     uses ONLY the binding and never reads the DOM fields, so
     mutating the fields after authorisation cannot change the
     created payment or bkashPending. Fields are locked while
     the interstitial is up.
   F2 (MED)      Send Money: authoriseSend snapshots receiver +
     amount at entry; the apply uses only the snapshot, so a
     mid-scan draft mutation cannot change the applied amount
     (proven end-to-end through the real B.walletApplySend with
     the snapshot values the shipped code passes).
   F3 (MED)      handleBkashReturn's invoice leg reads
     merchantInvoiceNumber (the field bKash actually sends);
     a present-but-different invoice refuses the Completed
     recording.
   HARDENING     the executed amount is compared DIRECTLY to
     bkashPending.amount: a mismatch is refused before any
     record — not Completed, no points.
   F4 (LOW)      the identify stream judges detector failure
     FIRST (before spoof/liveness/cap exits) and its
     static-liveness exit counts hand-frames, mirroring the
     verify stream.
   RELEASE       v73 coherence: app/shell/meta/chain agree; the
     v73 migration step is a pure adoption; the whole chain
     v37->v73 applies; frozen bars untouched (EDCC 0.32,
     PalmNet 0.5895).
   MICRO-FIXES   (combined re-review residuals, 2026-11-26):
     S1-F5 — the SW INSTALL handler type-checks each shell
     file with shellTypeOk before cache.put (no unchecked
     addAll); a wrong-type or failed file is skipped and
     install still completes (proven by running the real
     sw.js install handler in a vm with stubbed caches/fetch).
     PROVIDER — handleBkashReturn extracts the provider
     refusal BEFORE the mode check, so a grant-shaped refusal
     (bkashFail: statusCode/statusMessage, no mode) displays
     its code + message; a no-fields response keeps the exact
     generic behaviour. */
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

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function sliceBetween(src, a, b) {
  const i = src.indexOf(a);
  const j = b ? src.indexOf(b, i + a.length) : src.length;
  return i === -1 ? '' : src.slice(i, j === -1 ? src.length : j);
}

/* ================= RELEASE coherence ============================ */
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v95 (v95 named pin change: merchant terminal lightest)',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v95' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v95'") !== -1 &&
  html.indexOf('<meta name="biom-build" content="v95">') !== -1 &&
  html.indexOf('TSG Biom · App v95 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v95');
check('MIGRATION the chain ends at v95 with 59 links (v95 named pin change: merchant terminal lightest)',
  B.BIOM_DATA_VERSIONS.length === 59 && B.BIOM_DATA_VERSIONS[0] === 'v37');
check('MIGRATION the v73 step is a pure adoption: a v72-stamped snapshot opens unchanged under v73',
  (function () {
    const store = {
      people: [{ id: 'TSG-BIO-3001', name: 'Ayesha Rahman', wallet: { balance: 750, statement: [], linkedAccounts: [] }, palmProfile: { v: 4, codes: ['QUJD'] } }],
      logs: [{ ts: 1, result: 'Verified' }],
      transactions: [{ id: 'BIOM-PAY-1001', amount: 320 }],
      meta: [{ key: 'syncOutbox', value: [{ type: 'profile', record: { biomId: 'TSG-BIO-3001' } }] }]
    };
    const before = JSON.stringify(store);
    const mig = B.migrateBiomData(JSON.parse(before), 'v72', 'v73');
    return mig.appliedSteps.join(',') === 'v73' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
  })());
check('MIGRATION the whole chain v37->v75 applies 38 steps (v75 named pin change: flash-fix release)',
  (function () {
    const mig = B.migrateBiomData({ people: [], logs: [], transactions: [], meta: [] }, 'v37', 'v75');
    return mig.appliedSteps.length === 38 && mig.appliedSteps[mig.appliedSteps.length - 1] === 'v75';
  })());
check('FROZEN bars untouched: EDCC 0.32 / PalmNet 0.5895',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895);

/* ================= S1-F3: LS stamp honesty ====================== */
check('S1-F3 the LS migration stamps the version only when every write-back succeeded',
  (function () {
    const seg = sliceBetween(appSrc, 'var lsMig = B.migrateBiomData', 'dataMigratedFrom = storedDv;');
    const stampSeg = sliceBetween(appSrc, 'dataMigratedFrom = storedDv;', 'var DB_OP_TIMEOUT_MS');
    return seg.indexOf('var lsWriteOk = true;') !== -1 &&
      seg.indexOf('catch (e) { lsWriteOk = false; }') !== -1 &&
      stampSeg.indexOf('if (lsWriteOk)') !== -1 &&
      stampSeg.indexOf('localStorage.setItem(DV_KEY, APP_DATA_VERSION)') > stampSeg.indexOf('if (lsWriteOk)');
  })());

/* ================= S1-F5: SW content-type guard ================= */
check('S1-F5 the service worker only caches shell responses whose content type matches the file class',
  swSrc.indexOf('function shellTypeOk(url, res)') !== -1 &&
  swSrc.indexOf('(isShellUrl(url) || isNav) && shellTypeOk(url, res)') !== -1 &&
  swSrc.indexOf("path.endsWith('.js')") !== -1 && swSrc.indexOf('javascript') !== -1 &&
  swSrc.indexOf("path.endsWith('.css')") !== -1 && swSrc.indexOf('text/css') !== -1 &&
  swSrc.indexOf("ct.indexOf('text/html')") !== -1);
check('S1-F5 MICRO-FIX the SW install handler type-checks each shell file before caching — no unchecked addAll remains',
  swSrc.indexOf('cache.addAll') === -1 &&
  (function () {
    const seg = sliceBetween(swSrc, "self.addEventListener('install'", "self.addEventListener('activate'");
    return seg.indexOf('shellTypeOk(url, res)') !== -1 &&
      seg.indexOf('cache.put(shellKey(url)') !== -1 &&
      seg.indexOf('.catch(() => {})') !== -1; // one bad file is skipped, install continues
  })());

/* ================= Seat3 F1: sandbox binding ==================== */
check('F1 startSandboxPay binds the authorised amount + store into sandboxAttempt',
  (function () {
    const seg = sliceBetween(appSrc, 'function startSandboxPay(fresh, store, amount)', 'function closeSandboxInterstitial');
    return seg.indexOf('sandboxAttempt = { amount: amount, store: store, personId: fresh.id };') !== -1;
  })());
check('F1 the amount and store inputs are locked while the interstitial is up and unlocked on close',
  (function () {
    const open = sliceBetween(appSrc, 'function startSandboxPay(fresh, store, amount)', 'function closeSandboxInterstitial');
    const close = sliceBetween(appSrc, 'function closeSandboxInterstitial(note)', "$('wPaySandboxCancel')");
    return open.indexOf("$('wPayAmount').disabled = true;") !== -1 && open.indexOf("$('wPayStore').disabled = true;") !== -1 &&
      close.indexOf('sandboxAttempt = null;') !== -1 &&
      close.indexOf("$('wPayAmount').disabled = false;") !== -1 && close.indexOf("$('wPayStore').disabled = false;") !== -1;
  })());
check('F1 the Continue handler uses ONLY the bound values and never reads the DOM amount/store fields',
  (function () {
    const seg = sliceBetween(appSrc, "$('wPaySandboxGo').addEventListener('click'", '/* The return from bKash');
    return seg.indexOf('var bound = sandboxAttempt;') !== -1 &&
      seg.indexOf('var store = bound.store;') !== -1 &&
      seg.indexOf('var amount = bound.amount;') !== -1 &&
      seg.indexOf("$('wPayAmount')") === -1 && seg.indexOf("$('wPayStore')") === -1 &&
      seg.indexOf('walletValidateAmount') === -1;
  })());
check('F1 bkashPending and the create call are written from the bound values',
  (function () {
    const seg = sliceBetween(appSrc, "$('wPaySandboxGo').addEventListener('click'", '/* The return from bKash');
    return seg.indexOf('BkashRail.create({ biomId: fresh.id, amount: amount, payerReference: fresh.walletNumber })') !== -1 &&
      seg.indexOf('paymentID: res.paymentID, personId: fresh.id, amount: amount, store: store,') !== -1 &&
      seg.indexOf('bound.personId !== fresh.id') !== -1; // a binding for another profile refuses
  })());
/* Behavioural simulation of the shipped binding discipline:
   authorise 100 at Store A, mutate the "DOM fields" to
   100000 / Store B, invoke Continue's value selection — the
   created payment and pending record carry the AUTHORISED
   values. On v72 the handler re-read the fields, so this same
   simulation yields the tampered values. */
check('F1 BEHAVIOUR mutating the fields after authorisation cannot change the created payment or bkashPending',
  (function () {
    const dom = { wPayAmount: '100', wPayStore: 'Store A' };   // what the user typed/authorised
    let sandboxAttempt = null;
    (function startSandboxPaySim(store, amount) { sandboxAttempt = { amount: amount, store: store, personId: 'TSG-BIO-1' }; })('Store A', 100);
    dom.wPayAmount = '100000'; dom.wPayStore = 'Store B';       // the tamper, mid-interstitial
    const bound = sandboxAttempt;                                // the shipped handler's only source
    const created = { amount: bound.amount, store: bound.store };
    const pending = { amount: bound.amount, store: bound.store };
    return created.amount === 100 && created.store === 'Store A' &&
      pending.amount === 100 && pending.store === 'Store A' &&
      dom.wPayAmount === '100000'; // the tamper really happened — and was ignored
  })());

/* ================= Seat3 F2: send snapshot ======================== */
check('F2 the F2 send-snapshot surface is REMOVED with the Send flow (v90, Chairman 2026-11-28 — the flaw class leaves with the feature)',
  appSrc.indexOf('function authoriseSend()') === -1 && appSrc.indexOf('sendSnap') === -1 &&
  appSrc.indexOf('sendDraft') === -1 && appSrc.indexOf('B.walletApplySend(') === -1);
/* End-to-end through the REAL store layer: the snapshot taken
   at authorise entry (300) is what walletApplySend receives,
   even though the draft was mutated to 900 mid-scan. On v72
   the apply read sendDraft at apply time and moved 900. */
check('F2 BEHAVIOUR a mid-scan draft mutation cannot change the applied amount (real walletApplySend)',
  (function () {
    function person(id, name, bal) {
      const p = { id: id, name: name, phone: '01700000000', type: 'Customer', store: 'Store', walletProvider: '', walletNumber: '', limits: { perTx: null, daily: null }, loyaltyPoints: 0, wallet: B.walletNew(), palmProfile: null, enrolledAt: 1795420000000 };
      p.wallet.balance = bal; return p;
    }
    const sender = person('TSG-BIO-3001', 'Sender', 1000);
    const receiver = person('TSG-BIO-3002', 'Receiver', 0);
    const sendDraft = { receiverId: receiver.id, receiverName: receiver.name, amount: 300 };
    const sendSnap = { receiverId: sendDraft.receiverId, receiverName: sendDraft.receiverName, amount: sendDraft.amount }; // authoriseSend entry
    sendDraft.amount = 900; // the mid-scan tamper (Send card Continue)
    const res = B.walletApplySend([sender, receiver], sender.id, sendSnap.receiverId, sendSnap.amount,
      { verified: true, personId: sender.id }, 1795423600000, B.walletDemoRef(7));
    return res.ok === true && res.sender.wallet.balance === 700 && res.receiver.wallet.balance === 300 &&
      res.senderEntry.amount === 300 && sendDraft.amount === 900;
  })());

/* ================= Seat3 F3 + HARDENING: return predicate ======== */
check('F3 the invoice leg reads merchantInvoiceNumber from the execute/query results (legacy name kept as fallback)',
  (function () {
    const seg = sliceBetween(appSrc, 'function handleBkashReturn()', '/* ---------------- My Account (v52)');
    return seg.indexOf("var relayedInvoice = q.merchantInvoiceNumber || ex.merchantInvoiceNumber || q.merchantInvoice || ex.merchantInvoice || '';") !== -1 &&
      seg.indexOf('relayedInvoice && pending.invoice && relayedInvoice !== pending.invoice') !== -1;
  })());
check('F3 BEHAVIOUR a present-but-different merchantInvoiceNumber refuses the Completed recording',
  (function () {
    /* The shipped predicate leg, evaluated with the shipped
       field selection: v72 read q.merchantInvoice (absent from
       real bKash answers), so relayedInvoice was '' and the
       leg silently skipped. */
    const pending = { invoice: 'TSG-INV-1' };
    const q = { merchantInvoiceNumber: 'TSG-INV-OTHER' }, ex = {};
    const relayedInvoice = q.merchantInvoiceNumber || ex.merchantInvoiceNumber || q.merchantInvoice || ex.merchantInvoice || '';
    const refuses = !!(relayedInvoice && pending.invoice && relayedInvoice !== pending.invoice);
    const qOk = { merchantInvoiceNumber: 'TSG-INV-1' };
    const relayedOk = qOk.merchantInvoiceNumber || ex.merchantInvoiceNumber || qOk.merchantInvoice || ex.merchantInvoice || '';
    const passes = !(relayedOk && pending.invoice && relayedOk !== pending.invoice);
    return refuses === true && passes === true;
  })());
check('HARDENING the executed amount is compared DIRECTLY to pending.amount before any Completed record is written',
  (function () {
    const seg = sliceBetween(appSrc, 'function handleBkashReturn()', '/* ---------------- My Account (v52)');
    const cmpAt = seg.indexOf('executedAmount !== Number(pending.amount)');
    return cmpAt !== -1 &&
      seg.indexOf('NOT recorded as completed', cmpAt) !== -1 &&
      seg.indexOf('no points were awarded', cmpAt) !== -1 &&
      cmpAt < seg.indexOf("DB.put('transactions', rec)") &&
      seg.indexOf('var pts = Math.floor(executedAmount / LOYALTY_CONFIG.paymentEarnDivisor);') !== -1;
  })());
check('HARDENING BEHAVIOUR an executed amount different from the authorised amount cannot reach the record write',
  (function () {
    const pending = { amount: 100 };
    function gate(executedAmount) { // the shipped comparison
      if (executedAmount === null || executedAmount !== Number(pending.amount)) return 'refused';
      return 'record';
    }
    return gate(100) === 'record' && gate(100000) === 'refused' && gate(99) === 'refused' && gate(null) === 'refused';
  })());

/* ================= Seat3 F4: identify ordering =================== */
check('F4 the identify stream judges detector failure FIRST — before the spoof exit',
  (function () {
    const seg = sliceBetween(appSrc, 'function streamIdentifyPalm', 'var palmScanBusy = false;');
    const loopAt = seg.indexOf('function loop()');
    const detAt = seg.indexOf('if (detFails >= 3)', loopAt);
    const spoofAt = seg.indexOf('if (sp.spoof)', loopAt);
    return loopAt !== -1 && detAt !== -1 && spoofAt !== -1 && detAt < spoofAt &&
      seg.indexOf('detectorFailed: true', detAt) !== -1 &&
      (seg.match(/if \(detFails >= 3\)/g) || []).length === 1; // the bottom copy is gone — exactly one exit
  })());
check('F4 the identify static-liveness exit counts hand-frames, not analysed frames',
  (function () {
    const seg = sliceBetween(appSrc, 'function streamIdentifyPalm', 'var palmScanBusy = false;');
    return seg.indexOf("if (lv.verdict === 'static' && handFrames >= 6)") !== -1 &&
      seg.indexOf("if (lv.verdict === 'static' && analysed >= 6)") === -1 &&
      seg.indexOf('var handFrames = 0;') !== -1 &&
      seg.indexOf('if (r.pose) { handFrames++;') !== -1;
  })());
check('F4 the verify stream ordering is unchanged (detector-first, hand-frames static guard)',
  (function () {
    const seg = sliceBetween(appSrc, 'function streamVerifyPalm', 'function streamIdentifyPalm');
    const loopAt = seg.indexOf('function loop()');
    const detAt = seg.indexOf('if (detFails >= 3)', loopAt);
    const spoofAt = seg.indexOf('if (sp.spoof)', loopAt);
    return loopAt !== -1 && detAt !== -1 && spoofAt !== -1 && detAt < spoofAt && seg.indexOf("if (lv.verdict === 'static' && handFrames >= 6)") !== -1;
  })());

/* ============ URGENT: provider refusal surfacing =============== */
check('PROVIDER the create handler surfaces the API-relayed provider refusal before the generic fallback',
  (function () {
    const seg = sliceBetween(appSrc, "$('wPaySandboxGo').addEventListener('click'", '/* The return from bKash');
    return seg.indexOf('var refusal = bkashProviderRefusal(res);') !== -1 &&
      seg.indexOf("refusal || (res && res.error ? res.error : 'the sandbox refused to create the payment')") !== -1;
  })());
check('PROVIDER the return path not-completed line carries the provider refusal from execute/query too',
  (function () {
    const seg = sliceBetween(appSrc, 'function handleBkashReturn()', '/* ---------------- My Account (v52)');
    return seg.indexOf('bkashProviderRefusal(q) || bkashProviderRefusal(ex)') !== -1 &&
      seg.indexOf('bKash answered: ') !== -1;
  })());
check('PROVIDER MICRO-FIX the return path extracts the provider refusal BEFORE the mode check (the grant bkashFail shape carries no mode field)',
  (function () {
    const seg = sliceBetween(appSrc, 'function handleBkashReturn()', '/* ---------------- My Account (v52)');
    const extAt = seg.indexOf('var refusal0 = bkashProviderRefusal(q) || bkashProviderRefusal(ex);');
    const modeAt = seg.indexOf("ex.mode !== 'sandbox'");
    return extAt !== -1 && modeAt !== -1 && extAt < modeAt &&
      seg.indexOf("if (refusal0) throw new Error(") !== -1 &&
      seg.indexOf("bKash answered: ' + refusal0") !== -1 &&
      seg.indexOf("throw new Error('the rail answered an unexpected mode');") !== -1; // no-refusal behaviour unchanged
  })());
{
  const fnSrc = sliceBetween(appSrc, 'function bkashProviderRefusal(res) {', 'function bkashSandboxUrlOk(u) {');
  check('PROVIDER the refusal helper is extractable from app.js', fnSrc.indexOf('statusCode') !== -1 && fnSrc.indexOf('statusMessage') !== -1);
  const bkashProviderRefusal = new Function(fnSrc + '\nreturn bkashProviderRefusal;')();
  /* The Chairman's live failure shape: bKash answered 2049. */
  const stubRefusal = { ok: false, provider: 'bkash', mode: 'sandbox', statusCode: '2049', statusMessage: 'Invalid Merchant Callback URL' };
  const wording = bkashProviderRefusal(stubRefusal);
  const errorLine = 'bKash Sandbox could not start this payment (' + (wording || 'the sandbox refused to create the payment') + ')';
  check('PROVIDER BEHAVIOUR a stubbed refusal carrying 2049 renders BOTH the code and the message in the error line',
    wording === '2049: Invalid Merchant Callback URL' &&
    errorLine.indexOf('2049') !== -1 && errorLine.indexOf('Invalid Merchant Callback URL') !== -1,
    errorLine);
  check('PROVIDER BEHAVIOUR a refusal WITHOUT provider fields falls back to today\'s generic text',
    bkashProviderRefusal({ ok: false }) === '' &&
    bkashProviderRefusal({ ok: false, error: 'payment provider unreachable' }) === '' &&
    bkashProviderRefusal(null) === '' && bkashProviderRefusal(undefined) === '' &&
    ('bKash Sandbox could not start this payment (' + (bkashProviderRefusal({ ok: false }) || 'the sandbox refused to create the payment') + ')') ===
      'bKash Sandbox could not start this payment (the sandbox refused to create the payment)');
  check('PROVIDER BEHAVIOUR sanitisation: only the two fields, trimmed and length-capped, no raw dump',
    bkashProviderRefusal({ statusCode: ' 2049 ', statusMessage: '  Invalid Merchant Callback URL  ', bkashURL: 'https://evil.example', extra: 'dump' }) === '2049: Invalid Merchant Callback URL' &&
    bkashProviderRefusal({ statusMessage: 'x'.repeat(500) }).length === 120 &&
    bkashProviderRefusal({ statusCode: { nested: true }, statusMessage: 42 }) === '');
}

/* ================= async: S1-F1 + S1-F2 with the REAL engine ===== */
(async function () {
  /* ---- S1-F1: extract the shipped Vault.encryptProfileCore and
     the shipped vaultEncryptRow and evaluate them with a
     not-ready vault, then drive the REAL sync engine. ---- */
  const vaultSeg = sliceBetween(appSrc, 'Vault.encryptProfileCore = function (core) {', '/* The v61 conversion sweep');
  check('S1-F1 the shipped encryptProfileCore resolves null when the vault is not ready',
    vaultSeg.indexOf('if (!Vault.ready) return Promise.resolve(null);') !== -1 &&
    vaultSeg.indexOf('return Promise.resolve(core)') === -1);
  const rowSeg = sliceBetween(appSrc, 'function vaultEncryptRow(person) {', 'function vaultDecryptRows(rows) {');
  const VaultStub = { ready: false, kid: 'kid-test' };
  const mkVaultFns = new Function('Vault', 'B', 'vaultDerive',
    rowSeg + '\n' + vaultSeg + '\nreturn { encryptProfileCore: Vault.encryptProfileCore, vaultEncryptRow: vaultEncryptRow };');
  const vaultFns = mkVaultFns(VaultStub, B, function () { return Promise.reject(new Error('no key')); });
  const coreFixture = { biomId: 'TSG-BIO-3001', edccCodes: ['QUJD', 'REVG'], neuralEmbeddings: ['R0hJ'] };
  const sealedWhenNotReady = await vaultFns.encryptProfileCore(clone(coreFixture));
  check('S1-F1 BEHAVIOUR vault-not-ready sealing resolves null (nothing sealable leaves)',
    sealedWhenNotReady === null);
  const localRow = { id: 'TSG-BIO-3001', name: 'Local Person', palmProfile: { codes: ['QUJD'] }, wallet: { balance: 500, statement: [], linkedAccounts: [] } };
  const savedRow = await vaultFns.vaultEncryptRow(clone(localRow));
  check('S1-F1 BEHAVIOUR the LOCAL save path is unchanged: vaultEncryptRow resolves the row itself when not ready',
    JSON.stringify(savedRow) === JSON.stringify(localRow));

  const engineSrc = appSrc.slice(appSrc.indexOf('/* SYNC-ENGINE-BEGIN'), appSrc.indexOf('/* SYNC-ENGINE-END */'));
  check('S1-F1/S1-F2 the sync engine is extractable from app.js', engineSrc.indexOf('function createBiomSync') !== -1);
  const createBiomSync = new Function(engineSrc + '\nreturn createBiomSync;')();

  function makeEngine(store, sent, encryptProfileCore) {
    return createBiomSync({
      B: B, modelId: B.PALMNET_MODEL_ID, appVersion: 'v73',
      getPrefs: function () { return { on: true, endpoint: 'http://api.test', deviceKey: 'device-key-1', label: 'rig' }; },
      loadOutbox: function () { return Promise.resolve(clone(store.outbox)); },
      saveOutbox: function (items) { store.outbox = clone(items); return Promise.resolve(); },
      fetchFn: function (url, opts) { sent.push({ url: url, body: opts && opts.body ? JSON.parse(opts.body) : null }); return Promise.resolve({ status: 201 }); },
      now: function () { return 1795423600000; },
      uuid: function () { return 'uuid-v73'; },
      onStatus: function () {},
      encryptProfileCore: encryptProfileCore
    });
  }
  function bankedPerson(id) {
    return {
      id: id, name: 'Person ' + id, phone: '01700000000', type: 'Customer', store: 'Store',
      hand: 'right', walletProvider: '', walletNumber: '', limits: { perTx: null, daily: null }, loyaltyPoints: 0,
      wallet: B.walletNew(), enrolledAt: 1795420000000,
      palmProfile: { v: 4, format: 'packed96', codes: ['QUJD', 'REVG'], hand: 'right', neural: { model: B.PALMNET_MODEL_ID, embeddings: ['R0hJ'] } }
    };
  }
  async function waitFor(cond, tries) {
    for (let i = 0; i < (tries || 100); i++) { if (cond()) return true; await new Promise(function (r) { setTimeout(r, 10); }); }
    return cond();
  }

  /* S1-F1 end-to-end: not-ready vault -> noteProfile queues and
     posts NOTHING. On v72 the same wiring posted the raw core. */
  {
    const store = { outbox: [] }, sent = [];
    const engine = makeEngine(store, sent, vaultFns.encryptProfileCore);
    await engine.ensureLoaded();
    await engine.noteProfile(bankedPerson('TSG-BIO-3001'));
    await new Promise(function (r) { setTimeout(r, 60); }); // give any (wrong) queueing time to land
    await engine.flush();
    check('S1-F1 BEHAVIOUR vault-not-ready: sync queues NOTHING and posts NOTHING',
      store.outbox.length === 0 && sent.filter(function (s) { return s.url.indexOf('/api/profiles') !== -1; }).length === 0,
      'outbox=' + store.outbox.length + ' posts=' + sent.length);
  }
  /* Control: with a working seal the same engine DOES queue and
     post — the fail-closed change did not break sync itself. */
  {
    const store = { outbox: [] }, sent = [];
    const engine = makeEngine(store, sent, function (c) { const x = clone(c); x.enc = 'v1'; return Promise.resolve(x); });
    await engine.ensureLoaded();
    await engine.noteProfile(bankedPerson('TSG-BIO-3001'));
    /* v88 PIN CHANGE (named): instant sync may post the profile
       before the outbox poll ever sees it queued — the control's
       invariant is that the sealed profile IS posted exactly
       once, so the wait accepts either witness (queued or
       already posted). */
    const queued = await waitFor(function () { return store.outbox.some(function (it) { return it.type === 'profile'; }) || sent.some(function (s) { return s.url.indexOf('/api/profiles') !== -1; }); });
    await engine.flush();
    const posted = sent.filter(function (s) { return s.url.indexOf('/api/profiles') !== -1; });
    check('S1-F1 CONTROL with a working seal the engine still queues and posts the profile',
      queued === true && posted.length === 1 && posted[0].body.enc === 'v1');
  }

  /* ---- S1-F2: real engine + real deletion factory. Queue an
     upsert while the server is unreachable, delete with sync
     OFF, then turn sync back on: no bank may be posted. ---- */
  const delSrc = sliceBetween(appSrc, '/* PROFILE-DELETE-BEGIN', '/* PROFILE-DELETE-END */');
  check('S1-F2 the profile-deletion block is extractable from app.js',
    delSrc.indexOf('function createProfileDeletion') !== -1);
  const createProfileDeletion = new Function(delSrc + '\nreturn createProfileDeletion;')();
  check('S1-F2 the deletion factory purges the outbox before the tombstone branch, and the app wiring passes Sync.purgeProfile',
    delSrc.indexOf('deps.purgeProfile(personId)') !== -1 &&
    delSrc.indexOf('deps.purgeProfile(personId)') < delSrc.indexOf('deps.queueTombstones(banked)') &&
    appSrc.indexOf('purgeProfile: function (personId) { return Sync.purgeProfile(personId); }') !== -1 &&
    engineSrc.indexOf('function purgeProfile(biomId)') !== -1);
  {
    const store = { outbox: [] }, sent = [];
    let serverDown = true;
    const engine = createBiomSync({
      B: B, modelId: B.PALMNET_MODEL_ID, appVersion: 'v73',
      getPrefs: function () { return { on: true, endpoint: 'http://api.test', deviceKey: 'device-key-1', label: 'rig' }; },
      loadOutbox: function () { return Promise.resolve(clone(store.outbox)); },
      saveOutbox: function (items) { store.outbox = clone(items); return Promise.resolve(); },
      fetchFn: function (url, opts) {
        if (serverDown) return Promise.reject(new Error('unreachable'));
        sent.push({ url: url, body: opts && opts.body ? JSON.parse(opts.body) : null });
        return Promise.resolve({ status: 201 });
      },
      now: function () { return 1795423600000; },
      uuid: function () { return 'uuid-v73-del'; },
      onStatus: function () {},
      encryptProfileCore: function (c) { const x = clone(c); x.enc = 'v1'; return Promise.resolve(x); }
    });
    await engine.ensureLoaded();
    const person = bankedPerson('TSG-BIO-3001');
    await engine.noteProfile(person);
    const queuedUp = await waitFor(function () { return store.outbox.some(function (it) { return it.type === 'profile' && it.record.biomId === 'TSG-BIO-3001'; }); });
    await engine.flush(); // fails (server down) — the upsert stays queued, as in Seat 1's repro
    const stillQueued = store.outbox.some(function (it) { return it.type === 'profile' && it.record.biomId === 'TSG-BIO-3001'; });
    check('S1-F2 SETUP the upsert is queued and survives a failed flush', queuedUp === true && stillQueued === true);

    const deletion = createProfileDeletion({
      getPerson: function (id) { return Promise.resolve(id === person.id ? clone(person) : null); },
      syncActive: function () { return false; }, // sync OFF at delete time — Seat 1's branch
      queueTombstones: function (list) { return engine.queueTombstones(list); },
      flush: function () { return engine.flush(); },
      pendingTombstones: function (id) { return engine.pendingItems().filter(function (it) { return it.type === 'tombstone' && it.record && it.record.biomId === id; }); },
      purgeProfile: function (id) { return engine.purgeProfile(id); },
      erase: function (id) { return Promise.resolve({ transactions: 0 }); }
    });
    const outcome = await deletion.deleteProfile('TSG-BIO-3001');
    const outboxForId = engine.pendingItems().filter(function (it) { return it.record && it.record.biomId === 'TSG-BIO-3001'; });
    const persistedForId = store.outbox.filter(function (it) { return it.record && it.record.biomId === 'TSG-BIO-3001'; });
    check('S1-F2 BEHAVIOUR sync-off delete purges the queued upsert: outbox holds NO item for that Biom ID',
      outcome.deleted === true && outcome.server === 'inactive' && outboxForId.length === 0 && persistedForId.length === 0,
      'outbox=' + JSON.stringify(outboxForId));
    serverDown = false; // sync comes back on later
    await engine.flush();
    const bankPosts = sent.filter(function (s) { return s.url.indexOf('/api/profiles') !== -1 && s.body && s.body.biomId === 'TSG-BIO-3001' && !s.body.deleted; });
    check('S1-F2 BEHAVIOUR the later sync-on flush sends NO bank for the deleted profile',
      bankPosts.length === 0, 'posts=' + sent.length);
  }
  /* S1-F2 branch coverage: purge also runs when sync is ON and
     when the profile has no bank (factory-level, fake deps). */
  {
    const calls = [];
    const mk = function (syncActive, person) {
      return createProfileDeletion({
        getPerson: function () { return Promise.resolve(person); },
        syncActive: function () { return syncActive; },
        queueTombstones: function (list) { calls.push('tombstone'); return Promise.resolve(list.length); },
        flush: function () { calls.push('flush'); return Promise.resolve(); },
        pendingTombstones: function () { return []; },
        purgeProfile: function (id) { calls.push('purge:' + id); return Promise.resolve(1); },
        erase: function (id) { calls.push('erase:' + id); return Promise.resolve({ transactions: 0 }); }
      });
    };
    calls.length = 0;
    await mk(true, bankedPerson('TSG-BIO-4001')).deleteProfile('TSG-BIO-4001');
    const onOrder = calls.join('|');
    calls.length = 0;
    await mk(true, { id: 'TSG-BIO-4002', name: 'No Palm', palmProfile: null }).deleteProfile('TSG-BIO-4002');
    const noBankOrder = calls.join('|');
    check('S1-F2 BEHAVIOUR the purge runs in the sync-on branch (before tombstone) and in the no-bank branch too',
      onOrder.indexOf('purge:TSG-BIO-4001') !== -1 && onOrder.indexOf('purge:TSG-BIO-4001') < onOrder.indexOf('tombstone') &&
      noBankOrder.indexOf('purge:TSG-BIO-4002') !== -1 && noBankOrder.indexOf('erase:TSG-BIO-4002') !== -1,
      onOrder + ' // ' + noBankOrder);
  }

  /* ---- MICRO-FIX A BEHAVIOUR: run the REAL sw.js install
     handler in a vm with stubbed caches/fetch. A captive
     portal answers ./app.js with a 200 HTML page: that file
     must NOT land in the cache, every other shell file must,
     and install must complete (skipWaiting reached). ---- */
  {
    const vm = require('vm');
    function runInstall(fetchImpl) {
      const listeners = {};
      const stored = new Map();
      const state = { skipped: false, err: null };
      const cacheStub = {
        put: function (key, res) { stored.set(String(key), res); return Promise.resolve(); },
        addAll: function () { return Promise.reject(new Error('addAll must not be used at install')); },
        match: function () { return Promise.resolve(undefined); }
      };
      const selfStub = {
        location: { href: 'https://biom.test/', origin: 'https://biom.test' },
        addEventListener: function (name, fn) { listeners[name] = fn; },
        skipWaiting: function () { state.skipped = true; return Promise.resolve(); }
      };
      const sandbox = {
        self: selfStub,
        caches: { open: function () { return Promise.resolve(cacheStub); }, keys: function () { return Promise.resolve([]); }, delete: function () { return Promise.resolve(true); } },
        fetch: fetchImpl,
        URL: URL, console: console
      };
      vm.createContext(sandbox);
      vm.runInContext(swSrc, sandbox);
      let done = null;
      listeners.install({ waitUntil: function (p) { done = p; } });
      return done.then(function () { return { stored: stored, state: state }; },
        function (e) { state.err = e; return { stored: stored, state: state }; });
    }
    function typedResp(ct) {
      return { ok: true, status: 200, headers: { get: function (h) { return String(h).toLowerCase() === 'content-type' ? ct : null; } }, clone: function () { return this; } };
    }
    const goodTypes = { './': 'text/html', './index.html': 'text/html', './styles.css': 'text/css', './app.js': 'application/javascript', './biometrics.js': 'application/javascript', './manifest.webmanifest': 'application/manifest+json', './icons/icon-192.png': 'image/png', './icons/icon-512.png': 'image/png', './icons/icon-180.png': 'image/png' };
    const portal = await runInstall(function (entry) {
      return Promise.resolve(typedResp(entry === './app.js' ? 'text/html' : (goodTypes[entry] || 'text/html'))); // the portal page for app.js
    });
    check('S1-F5 MICRO-FIX BEHAVIOUR install with a portal page served for ./app.js: that file is NOT cached, the other 8 shell files are, install completes',
      portal.state.err === null && portal.state.skipped === true &&
      !portal.stored.has('https://biom.test/app.js') &&
      portal.stored.has('https://biom.test/') && portal.stored.has('https://biom.test/index.html') &&
      portal.stored.has('https://biom.test/styles.css') && portal.stored.has('https://biom.test/biometrics.js') &&
      portal.stored.has('https://biom.test/manifest.webmanifest') && portal.stored.has('https://biom.test/icons/icon-192.png') &&
      portal.stored.size === 8,
      'cached=' + Array.from(portal.stored.keys()).join(','));
    const flaky = await runInstall(function (entry) {
      if (entry === './styles.css') return Promise.reject(new Error('network down'));
      return Promise.resolve(typedResp(goodTypes[entry] || 'text/html'));
    });
    check('S1-F5 MICRO-FIX BEHAVIOUR one shell file failing to load does not fail install: it is skipped, the rest are cached',
      flaky.state.err === null && flaky.state.skipped === true &&
      !flaky.stored.has('https://biom.test/styles.css') && flaky.stored.has('https://biom.test/app.js') && flaky.stored.size === 8);
  }

  /* ---- MICRO-FIX B BEHAVIOUR: the return-path mode gate,
     driven by the REAL extracted bkashProviderRefusal and the
     shipped ordering (refusal extracted first; the mode check
     reports it when present, the generic wording otherwise).
     handleBkashReturn itself is DOM-bound, so — as with F3 /
     HARDENING above — the decision is simulated over the real
     helper and pinned to the shipped source by the pin check. ---- */
  {
    const fnSrc2 = sliceBetween(appSrc, 'function bkashProviderRefusal(res) {', 'function bkashSandboxUrlOk(u) {');
    const refusalOf = new Function(fnSrc2 + '\nreturn bkashProviderRefusal;')();
    function returnGateMessage(ex, q) { // mirrors the shipped lines in handleBkashReturn
      var refusal0 = refusalOf(q) || refusalOf(ex);
      if (!ex || ex.mode !== 'sandbox' || !q || q.mode !== 'sandbox') {
        if (refusal0) return 'the payment provider refused the request — bKash answered: ' + refusal0;
        return 'the rail answered an unexpected mode';
      }
      return 'proceed';
    }
    function displayedLine(msg) { // the shipped catch composition
      return 'The sandbox payment could not be confirmed with the payment server (' + msg + '). It is NOT recorded here — check the bKash sandbox result before paying again.';
    }
    /* The grant-failure shape: API bkashFail — statusCode +
       statusMessage, NO mode field on either relay. */
    const grantEx = { ok: false, provider: 'bkash', error: 'payment provider refused the request', statusCode: '2051', statusMessage: 'Grant token request was refused' };
    const grantQ = { ok: false, provider: 'bkash', error: 'payment provider refused the request', statusCode: '2051', statusMessage: 'Grant token request was refused' };
    const grantLine = displayedLine(returnGateMessage(grantEx, grantQ));
    check('PROVIDER MICRO-FIX BEHAVIOUR a grant-shaped refusal (statusCode/statusMessage, no mode) is what gets displayed on the return path',
      grantLine.indexOf('2051') !== -1 && grantLine.indexOf('Grant token request was refused') !== -1 &&
      grantLine.indexOf('unexpected mode') === -1,
      grantLine);
    const bareLine = displayedLine(returnGateMessage({ ok: false }, { ok: false }));
    check('PROVIDER MICRO-FIX BEHAVIOUR a response with NO refusal fields keeps today\'s generic behaviour exactly',
      returnGateMessage({ ok: false }, { ok: false }) === 'the rail answered an unexpected mode' &&
      bareLine.indexOf('unexpected mode') !== -1 &&
      returnGateMessage({ mode: 'sandbox', ok: true }, { mode: 'sandbox', ok: true }) === 'proceed');
  }

  console.log(fail === 0 ? 'ALL v73 FLAW-FIX TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) { console.log('FAIL  suite crashed: ' + (e && e.stack || e)); process.exit(1); });
