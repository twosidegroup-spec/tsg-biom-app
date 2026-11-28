/* TSG BIOM v71 — OLD-DESIGN FLASH FIX + BKASH SANDBOX RAIL
   (the Chairman's two orders, 2026-11-26 13:05).

   ORDER 1: on 2026-11-26 00:40 the Chairman's phone showed the
   OLD design after a new version shipped. The v69 service
   worker's fetch handler was stale-while-revalidate (return the
   cache hit, refresh behind it), so the first session after an
   update painted the old shell for the WHOLE session; and
   caches.match searched every cache on the origin. v71 makes
   the shell network-first with a current-cache-only fallback,
   holds a neutral boot splash until app.js of the SAME build
   is running (a meta-stamp coherence check forces one guarded
   reload instead of ever painting a mixed shell), and delivers
   a held update reload the moment no scan or money commit is
   in flight.

   ORDER 2: the Phase E bKash sandbox rail. The wallet Biom Pay
   flow, for bKash-linked profiles only and only after the
   strict palm authorisation has passed, asks the API which
   mode the rail is in: 'sandbox' hands off through an honest
   interstitial to bKash's own hosted sandbox page (the pending
   record is persisted BEFORE the redirect and cleared BEFORE
   anything is credited; the return trusts only the API's
   execute/query answers); 'demo' keeps the pre-v71 path
   exactly; a failed probe or an unexpected mode fails closed.
   Sandbox records carry rail:'bkash-sandbox' and are excluded
   from every demo aggregate. Frozen rules untouched: EDCC
   0.32 / PalmNet 0.5895, banking guard, strict money rule,
   codec freeze, PAY_STATUS demo path. */
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
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v91 (v91 named pin change: liquid glass); the v71 rail content below is unchanged)',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v91' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v91'") !== -1 &&
  html.indexOf('<meta name="biom-build" content="v91">') !== -1 &&
  html.indexOf('TSG Biom · App v91 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v91');
check('MIGRATION the v70 and v71 steps are pure adoptions: a v69 store opens byte-identical at v71',
  (function () {
    const store = {
      people: [{ id: 'TSG-BIO-1', name: 'A', loyaltyPoints: 40, palmProfile: { v: 4, codes: ['x'] } }],
      logs: [{ ts: 1, result: 'Verified' }],
      transactions: [{ id: 'BIOM-PAY-1001', amount: 320 }, { id: 'BKASH-SANDBOX-T1', amount: 50, rail: 'bkash-sandbox' }],
      meta: [{ key: 'bkashPending', value: { paymentID: 'TR0011X', personId: 'TSG-BIO-1', amount: 50 } }]
    };
    const before = JSON.stringify(store);
    const mig = B.migrateBiomData(JSON.parse(before), 'v69', 'v71');
    return mig.appliedSteps.join(',') === 'v70,v71' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
  })());
check('MIGRATION the whole chain v37->v71 applies 34 steps',
  (function () {
    const mig = B.migrateBiomData({ people: [], logs: [], transactions: [], meta: [] }, 'v37', 'v71');
    return mig.appliedSteps.length === 34 && mig.appliedSteps[mig.appliedSteps.length - 1] === 'v71';
  })());
check('FROZEN bars untouched: EDCC 0.32 / PalmNet 0.5895',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895);

/* ---------- ORDER 1: the service worker strategy ----------------- */
check('SW navigations are network-first (a fresh load can never paint a stale shell)',
  swSrc.indexOf('if (isNav || isShellUrl(url))') !== -1 && swSrc.indexOf('network-first for the document and every shell file') !== -1);
check('SW shell fetches bypass the HTTP cache (v75 named pin change: the fetch runs through the timed wrapper timedShellFetch, which carries the same no-cache rule and the 3.5 s bound)',
  swSrc.indexOf('function timedShellFetch(request)') !== -1 &&
  swSrc.indexOf("cache: 'no-cache'") !== -1 &&
  swSrc.indexOf('SHELL_NET_TIMEOUT_MS = 3500') !== -1 &&
  swSrc.indexOf('timedShellFetch(event.request)') !== -1);
check('SW a non-OK network answer falls back to cache (only res.ok is served or stored)',
  swSrc.indexOf('if (res && res.ok)') !== -1 && swSrc.indexOf('return shellFallback(event.request, isNav);') !== -1);
check('SW the fallback reads ONLY the current shell cache, never caches.match across caches',
  swSrc.indexOf('caches.match(') === -1 && swSrc.indexOf('caches.open(CACHE)') !== -1 &&
  swSrc.indexOf('cache.match(shellKey(new URL(request.url)), { ignoreSearch: true })') !== -1);
check('SW shell copies are stored under the query-free shell key (a bKash return URL never becomes a cache key)',
  swSrc.indexOf('function shellKey(url)') !== -1 && swSrc.indexOf('return url.origin + url.pathname;') !== -1 &&
  swSrc.indexOf('cache.put(shellKey(url), copy)') !== -1);
check('SW install caches the whole shell and activate still clears older shells and claims clients (v73 micro-fix: per-file type-checked install supersedes the v71 atomic addAll pin — a bad file is skipped, install completes)',
  swSrc.indexOf('cache.addAll') === -1 && swSrc.indexOf('SHELL.map(') !== -1 && swSrc.indexOf('shellTypeOk(url, res)') !== -1 &&
  swSrc.indexOf('self.skipWaiting()') !== -1 &&
  swSrc.indexOf('self.clients.claim()') !== -1 && swSrc.indexOf('k !== CACHE') !== -1);
check('SW vendor and models stay network-only (the v68 assembly path is untouched)',
  swSrc.indexOf("url.pathname.indexOf('/models/') !== -1") !== -1 && swSrc.indexOf("url.pathname.indexOf('/vendor/') !== -1") !== -1 &&
  swSrc.indexOf('never matched from, or written to, this cache') !== -1);

/* ---------- ORDER 1: splash + coherence + update delivery -------- */
check('SPLASH index.html paints the boot splash with style attributes only (the CSP needs no loosening)',
  (function () {
    const seg = sliceBetween(html, '<div id="bootSplash"', '</div>');
    return seg.indexOf('style="') !== -1 && seg.indexOf('class=') === -1 && html.indexOf('id="bootSplash"') !== -1 &&
      html.indexOf("style-src-elem 'self'") !== -1;
  })());
check('SPLASH app.js removes the splash as its first DOM action on a coherent boot',
  (function () {
    const seg = sliceBetween(appSrc, 'var APP_DATA_VERSION', 'var DV_KEY');
    return seg.indexOf('dropBootSplash();') !== -1 &&
      seg.indexOf("getElementById('bootSplash')") !== -1 &&
      appSrc.indexOf('dropBootSplash') < appSrc.indexOf('var DB = {');
  })());
check('COHERENCE a stamp mismatch forces ONE guarded cache-bypassing reload and does not run the app (v75 named pin change: the guard is the shared bootReloadSpent, keyed by the CANONICAL bootReloadKey — the newest build involved, per Seat 1)',
  (function () {
    const seg = sliceBetween(appSrc, 'var APP_DATA_VERSION', 'var DV_KEY');
    return seg.indexOf("querySelector('meta[name=\"biom-build\"]')") !== -1 &&
      seg.indexOf('buildStamp !== APP_DATA_VERSION') !== -1 &&
      seg.indexOf('bootReloadSpent(bootReloadKey)') !== -1 &&
      seg.indexOf("'?_coh='") !== -1 && seg.indexOf('location.replace(') !== -1;
  })());
check('UPDATE the controllerchange reload is version-scoped (the NEXT update in the same tab is delivered too; v75 named pin change: it spends the shared bootReloadSpent guard under the canonical key)',
  appSrc.indexOf("/tsg-biom-shell-(v[0-9]+)/") !== -1 &&
  appSrc.indexOf('bootReloadSpent(spendKey)') !== -1 &&
  appSrc.indexOf('swReloadDoneFor[incoming]') !== -1);
check('UPDATE first install never reloads (the controller snapshot is taken at boot)',
  appSrc.indexOf('var swHadController = !!navigator.serviceWorker.controller;') !== -1 &&
  appSrc.indexOf('if (!swHadController) { swHadController = true; return; }') !== -1);
check('UPDATE the reload waits out scans, money commits and the sandbox interstitial, and is delivered at flow boundaries',
  appSrc.indexOf('function swFlowBusy() { return palmScanBusy || moneyCommitBusy || sandboxInterstitialOpen; }') !== -1 &&
  appSrc.indexOf('function checkPendingSwReload()') !== -1 &&
  (appSrc.match(/checkPendingSwReload\(\);/g) || []).length >= 6);

/* ---------- ORDER 2: the rail transport --------------------------- */
check('RAIL the payments transport reuses the device credential and the SHARED sync sequence counter',
  (function () {
    const seg = sliceBetween(appSrc, 'var BkashRail = (function () {', 'function renderSyncStatus()');
    return seg.indexOf("syncPrefGet('biomSyncDeviceId')") !== -1 &&
      seg.indexOf("syncPrefGet('biomSyncSeq')") !== -1 &&
      seg.indexOf("syncPrefSet('biomSyncSeq', String(seq))") !== -1 &&
      seg.indexOf('biomSignRequest(') !== -1 &&
      seg.indexOf("'/api/payments/mode'") !== -1 && seg.indexOf("'/api/payments'") !== -1 &&
      seg.indexOf("'/api/payments/execute'") !== -1 && seg.indexOf("'/api/payments/query'") !== -1;
  })());
check('RAIL the bootstrap key is never spent on payment routes and a half-written credential is refused (Seat 2 RC-2/RC-3)',
  (function () {
    const seg = sliceBetween(appSrc, 'var BkashRail = (function () {', 'function renderSyncStatus()');
    return seg.indexOf('SYNC_BOOTSTRAP_KEY') === -1 &&
      seg.indexOf("syncPrefGet('biomSyncDeviceKey')") !== -1 &&
      seg.indexOf('device credential incomplete') !== -1;
  })());
check('RAIL the transport speaks the API contract: Sync header names and the signer in its defined order over the body OBJECT (Seat 2 re-review 1+2)',
  (function () {
    const seg = sliceBetween(appSrc, 'var BkashRail = (function () {', 'function renderSyncStatus()');
    return seg.indexOf("h['x-device-id'] = c.deviceId;") !== -1 &&
      seg.indexOf("h['x-device-key'] = c.deviceSecret;") !== -1 &&
      seg.indexOf("h['x-device-seq'] = String(seq);") !== -1 &&
      seg.indexOf("h['x-device-sig'] = sig;") !== -1 &&
      seg.indexOf('X-Biom-Device') === -1 && seg.indexOf('X-Biom-Key') === -1 &&
      seg.indexOf('biomSignRequest(c.deviceSecret, c.deviceId, seq, \'POST\', path, bodyObj)') !== -1;
  })());
check('RAIL the sequence counter advances only on the server seq-consumed marker, calls are serialised and sync is drained first (Seat 2 re-review 3)',
  (function () {
    const seg = sliceBetween(appSrc, 'var BkashRail = (function () {', 'function renderSyncStatus()');
    return seg.indexOf("r.headers.get('x-biom-seq-consumed')") !== -1 &&
      seg.indexOf('if (r.seqConsumed === String(seq))') !== -1 &&
      seg.indexOf('var payChain = Promise.resolve();') !== -1 &&
      seg.indexOf('return Sync.flush().then(function () {') !== -1 &&
      seg.indexOf("r.json.code === 'SEQ_DESYNC'") !== -1;
  })());
check('RAIL the only bKash navigation target is the sandbox hosted page on the sandbox host over https',
  appSrc.indexOf("url.hostname === 'sandbox.payment.bkash.com'") !== -1 &&
  appSrc.indexOf("url.protocol === 'https:'") !== -1 &&
  appSrc.indexOf('window.location.assign(res.bkashURL)') !== -1);

/* ---------- ORDER 2: the pay branch -------------------------------- */
check('PAY the sandbox branch sits AFTER the strict authorisation and the per-transaction limit, inside the existing scan run',
  (function () {
    const seg = sliceBetween(appSrc, "$('wPayScan').addEventListener('click'", '/* ---------------- v71 bKash sandbox payment flow');
    const authAt = seg.indexOf('if (!auth.verified)');
    const limitAt = seg.indexOf('fresh.limits.perTx');
    const branchAt = seg.indexOf("probedMode === 'sandbox') return startSandboxPay(fresh, store, amount);");
    return authAt !== -1 && limitAt > authAt && branchAt > limitAt;
  })());
check('PAY one pre-scan probe governs the attempt: the prompt names the settling rail and a bad probe stops before any scan (Seat 3 RC-3)',
  (function () {
    const seg = sliceBetween(appSrc, "$('wPayScan').addEventListener('click'", '/* ---------------- v71 bKash sandbox payment flow');
    return seg.indexOf('BkashRail.mode().then') !== -1 &&
      seg.indexOf('openPayScan(m.mode)') !== -1 &&
      seg.indexOf("probedMode === 'sandbox'") !== -1 &&
      seg.indexOf('through the bKash Sandbox (TEST MODE — no real money)') !== -1 &&
      seg.indexOf('of demo money at') !== -1 &&
      seg.indexOf('payments rail answered an unexpected mode — nothing was charged') !== -1 &&
      seg.indexOf('payment server is unreachable — nothing was charged') !== -1 &&
      seg.indexOf('openPayScan(null)') !== -1 &&
      seg.indexOf('if (me.walletProvider === ') !== -1;
  })());
check('PAY the demo settle path is byte-identical in behaviour (daily check then createWalletPay, PAY_STATUS record)',
  appSrc.indexOf('var settleDemoPay = function ()') !== -1 &&
  appSrc.indexOf('status: PAY_STATUS') !== -1 &&
  appSrc.indexOf("id: 'BIOM-PAY-' + seq") !== -1);
check('PAY the interstitial restates the payment and waits for an explicit tap before any create',
  html.indexOf('id="wPaySandbox"') !== -1 && html.indexOf('bKash Sandbox — TEST MODE') !== -1 &&
  html.indexOf('never sees your bKash PIN or OTP') !== -1 &&
  appSrc.indexOf("$('wPaySandboxText').textContent = 'Pay '") !== -1 &&
  appSrc.indexOf('sandboxInterstitialOpen = true;') !== -1);

/* ---------- ORDER 2: create + return discipline -------------------- */
check('RETURN the pending record is persisted BEFORE the redirect and the URL is validated first',
  (function () {
    const seg = sliceBetween(appSrc, "$('wPaySandboxGo').addEventListener('click'", 'function bkashReturnMessage');
    return seg.indexOf('bkashSandboxUrlOk(res.bkashURL)') !== -1 &&
      seg.indexOf("DB.setMeta('bkashPending'") !== -1 &&
      seg.indexOf("DB.setMeta('bkashPending'") < seg.indexOf('window.location.assign') &&
      seg.indexOf("res.mode !== 'sandbox'") !== -1;
  })());
check('RETURN callback parameters are never trusted: params stripped at once, paymentID matched to the pending record',
  (function () {
    const seg = sliceBetween(appSrc, 'function handleBkashReturn()', '/* ---------------- My Account (v52)');
    return seg.indexOf('history.replaceState') !== -1 &&
      seg.indexOf('pending.paymentID !== paymentID') !== -1 &&
      seg.indexOf('BkashRail.execute(paymentID)') !== -1 &&
      seg.indexOf('BkashRail.query(paymentID)') !== -1;
  })());
check('RETURN the write is idempotent by paymentID and the pending record is retired only after the record lands (Seat 3 RC-2)',
  (function () {
    const seg = sliceBetween(appSrc, 'function handleBkashReturn()', '/* ---------------- My Account (v52)');
    return seg.indexOf("t.rail === 'bkash-sandbox' && t.paymentID === paymentID") !== -1 &&
      seg.indexOf('has not been credited twice') !== -1 &&
      seg.indexOf("DB.put('transactions', rec)") !== -1 &&
      seg.indexOf("DB.setMeta('bkashPending', null)", seg.indexOf("DB.put('transactions', rec)")) > seg.indexOf("DB.put('transactions', rec)");
  })());
check('RETURN a stale pending record is abandoned, never executed (Seat 3 RC-4)',
  (function () {
    const seg = sliceBetween(appSrc, 'function handleBkashReturn()', '/* ---------------- My Account (v52)');
    return seg.indexOf('30 * 60 * 1000') !== -1 && seg.indexOf('payment link has expired') !== -1 &&
      seg.indexOf('30 * 60 * 1000') < seg.indexOf('BkashRail.execute(paymentID)');
  })());
check('RETURN a Completed sandbox payment records the REAL TrxID with the TEST MODE status and the rail discriminator',
  appSrc.indexOf("rail: 'bkash-sandbox'") !== -1 &&
  appSrc.indexOf("trxID ? 'Completed — bKash Sandbox (TEST MODE)' : 'Completed — bKash Sandbox (TEST MODE) · TrxID not returned by bKash'") !== -1 &&
  appSrc.indexOf("'BKASH-SANDBOX-' + (trxID || paymentID)") !== -1 &&
  appSrc.indexOf('bKash Sandbox TrxID: ') !== -1 &&
  appSrc.indexOf('bKash did not return a TrxID for this payment') !== -1);
check('RETURN Completed is a checked predicate: both relays ok, same payment, same invoice, BDT, agreeing amounts, verification Complete (Seat 2 re-review 6)',
  (function () {
    const seg = sliceBetween(appSrc, 'function handleBkashReturn()', '/* ---------------- My Account (v52)');
    return seg.indexOf('the rail answered for a different payment than the one started on this device') !== -1 &&
      seg.indexOf('the rail answered for a different invoice than the one created on this device') !== -1 &&
      seg.indexOf('the rail answered in an unexpected currency') !== -1 &&
      seg.indexOf('execute and query disagree on the amount') !== -1 &&
      seg.indexOf("ex.ok !== true || q.ok !== true || finalStatus !== 'Completed' || q.verificationStatus !== 'Complete'") !== -1;
  })());
check('HONESTY the Partner Integration page states the sandbox truth (Seat 3 re-review 3)',
  html.indexOf('Sandbox connected — TEST MODE · Production not connected') !== -1 &&
  html.indexOf('Held on the API server only — never entered in the app') !== -1);
check('RETURN points come from the EXECUTED amount only; an executed amount differing from the authorised (pending) amount is refused BEFORE any record (v73 hardening: direct comparison — named pin change from the v71 record-with-note behaviour)',
  (function () {
    const seg = sliceBetween(appSrc, 'function handleBkashReturn()', '/* ---------------- My Account (v52)');
    return seg.indexOf('executedAmount !== Number(pending.amount)') !== -1 &&
      seg.indexOf('var pts = Math.floor(executedAmount / LOYALTY_CONFIG.paymentEarnDivisor);') !== -1 &&
      seg.indexOf('no points were awarded') !== -1 &&
      seg.indexOf('executedAmount !== Number(pending.amount)') < seg.indexOf("DB.put('transactions', rec)");
  })());
check('RETURN a non-Completed outcome records nothing, credits nothing and says no money moved',
  (function () {
    const seg = sliceBetween(appSrc, 'function handleBkashReturn()', '/* ---------------- My Account (v52)');
    const failAt = seg.indexOf("finalStatus !== 'Completed'");
    return failAt !== -1 && seg.indexOf('No money moved, nothing was recorded', failAt) !== -1 &&
      seg.indexOf("DB.put('transactions', rec)") > failAt;
  })());

/* ---------- ORDER 2: aggregates + honesty surfaces ------------------ */
check('AGGREGATES sandbox records are excluded from the Desk volume, the merchant Balance chain and both daily sums',
  (appSrc.match(/t\.rail !== 'bkash-sandbox'/g) || []).length >= 4);
check('HONESTY the Inbox kind, the rail line and the result copy all carry the sandbox truth',
  appSrc.indexOf("bkash: 'bKash Sandbox payment — TEST MODE'") !== -1 &&
  appSrc.indexOf('Settlement rail: bKash Sandbox (test mode)') !== -1 &&
  appSrc.indexOf('bKash Sandbox — TEST MODE — no real money moved') !== -1 &&
  html.indexOf('id="wPayRailLine"') !== -1);
check('HONESTY the boot settles a bKash return after the face and role layers are up',
  appSrc.indexOf('.then(function () { return handleBkashReturn(); })') !== -1);

console.log('v71 suite: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
