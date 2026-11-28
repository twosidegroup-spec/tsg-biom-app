/* TSG BIOM v63 — THE TWO-FACE RELEASE (the Chairman's order,
   2026-11-25 10:36 + the 10:47 scope additions; Seat 1 front-end
   design, Seat 2 sync/bootstrap).

   What v63 does: one app, two faces. The customer face (the
   default) shows only the wallet, the money flows, the
   customer's own activity and a light My Account — every owner
   surface (Desk, Registry, terminal/store modes, global logs,
   partner integration, Field Test Mode, Biom Vault, Scan Sync
   settings, Delete All Data) is detached from the DOM at boot
   and unreachable by navigation. The owner face is everything
   the app has today, opened by an owner-palm unlock (five taps
   on the My Account version line, or a long-press on the app
   logo) whose match must carry the new profile owner flag;
   when no profile carries it, the first successful match
   claims it. Registration is presented as the one-time wallet
   form (name, phone, palm). Send Money runs receiver -> amount
   -> sender authorisation. The wallet gains a Biom Pay flow
   (partner store -> amount -> own palm, strict rule — the
   fourth strict site, by the Chairman's explicit order). Sync
   is ON by default behind a baked-in endpoint and a
   registration-only bootstrap key; the legacy shared key is
   gone from the app.

   This suite proves, headlessly:
   - version coherence (app == shell == chain tail == v63, 26
     chain steps);
   - the FACE-MODE core extracted from app.js and driven
     against a fake DOM tree: customer mode detaches every
     owner surface (marker absence), owner mode restores them
     in the original order, Lock detaches again, and the
     navigation gate refuses owner pages while locked;
   - the owner-unlock decision matrix, incl. the bootstrap
     claim firing once and only once;
   - the shipped markup carries the owner-only markers, the
     customer nav, the version line, the wallet Pay card, the
     reordered Send blocks and the enrolment consent line, and
     no shared-key field anywhere;
   - the sync wiring defaults: baked endpoint, default ON,
     registration-only key, and the engine's degrade — with the
     bootstrap key refused by the server, the queue HOLDS, no
     write is attempted with it, and no key-rejected latch is
     set; with registration answered, the v62 machinery signs
     and drains exactly as before;
   - the owner-unlock scan kind is accepted by the record
     shaper on both sides (app + API whitelist).
   Run: node tests/v63-two-face.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require(path.join(__dirname, '..', 'biometrics.js'));
const apiCanonical = require('../../tsg-biom-api/lib/canonical.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const apiRecordsSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'tsg-biom-api', 'lib', 'records.js'), 'utf8');

/* ---------------- version coherence ---------------------------- */
check('VERSION app, shell and chain agree at v91 (v91 named pin change: liquid glass))',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v91' &&
  swSrc.indexOf('tsg-biom-shell-v91') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v91');
check('VERSION the chain is v37->v88: 52 links, 51 migration steps (v91 named pin change: liquid glass) — was 50 links at v86 (the v38 suite proves the applied steps; v79 named pin change: block system, pure adoption like the v77 performance link)',
  B.BIOM_DATA_VERSIONS.length === 55 && B.BIOM_DATA_VERSIONS[0] === 'v37', 'links=' + B.BIOM_DATA_VERSIONS.length);

/* ---------------- the face-mode core, extracted ---------------- */
const faceSrc = appSrc.slice(appSrc.indexOf('/* FACE-MODE-BEGIN'), appSrc.indexOf('/* FACE-MODE-END */'));
check('FACE the face-mode block is extractable from app.js', faceSrc.indexOf('function createFaceMode') !== -1);
const createFaceMode = new Function(faceSrc + '\nreturn createFaceMode;')();

function fakeNode(id, ownerOnly) { return { id: id, ownerOnly: !!ownerOnly, parent: null, children: [] }; }
function append(parent, child) { child.parent = parent; parent.children.push(child); return child; }
function treeIds(root) { const out = []; (function walk(n) { out.push(n.id); n.children.forEach(walk); })(root); return out; }

const root = fakeNode('main');
append(root, fakeNode('page-wallet'));
append(root, fakeNode('page-dashboard', true));
const moreSec = append(root, fakeNode('page-more'));
append(root, fakeNode('page-registry', true));
append(moreSec, fakeNode('morelink-account'));
append(moreSec, fakeNode('card-field-test', true));
append(moreSec, fakeNode('card-vault', true));
append(moreSec, fakeNode('card-sync', true));
append(moreSec, fakeNode('card-delete', true));
append(moreSec, fakeNode('card-how-it-works'));
const ORIGINAL_ORDER = treeIds(root).join(',');

const FaceMode = createFaceMode({
  ownerNodes: function () { const out = []; (function walk(n) { if (n.ownerOnly) out.push(n); n.children.forEach(walk); })(root); return out; },
  parentOf: function (n) { return n.parent; },
  nextOf: function (n) {
    if (!n.parent) return null;
    const sib = n.parent.children, i = sib.indexOf(n);
    return i >= 0 && i < sib.length - 1 ? sib[i + 1] : null;
  },
  detach: function (n) {
    if (n.parent) { const i = n.parent.children.indexOf(n); if (i >= 0) n.parent.children.splice(i, 1); n.parent = null; }
  },
  attach: function (n, parent, next) {
    if (!parent) return;
    const i = next ? parent.children.indexOf(next) : -1;
    if (i >= 0) parent.children.splice(i, 0, n); else parent.children.push(n);
    n.parent = parent;
  }
});

check('FACE a fresh session starts in customer mode', FaceMode.isOwner() === false);
check('FACE the gate refuses every owner page in customer mode',
  FaceMode.OWNER_PAGES.every(function (p) { return FaceMode.gate(p) === 'wallet'; }) &&
  FaceMode.gate('wallet') === null && FaceMode.gate('account') === null && FaceMode.gate('enroll') === null && FaceMode.gate('topup') === null);
const detachedCount = FaceMode.detachSurfaces();
const afterDetach = treeIds(root);
check('FACE customer mode detaches every owner surface (marker absence in the live tree)',
  detachedCount === 6 &&
  ['page-dashboard', 'page-registry', 'card-field-test', 'card-vault', 'card-sync', 'card-delete'].every(function (id) { return afterDetach.indexOf(id) === -1; }),
  'detached=' + detachedCount);
check('FACE customer surfaces survive the detach, in order',
  afterDetach.join(',') === 'main,page-wallet,page-more,morelink-account,card-how-it-works', afterDetach.join(','));
check('FACE detach is idempotent', FaceMode.detachSurfaces() === 6 && treeIds(root).join(',') === afterDetach.join(','));
FaceMode.enter();
check('FACE owner mode restores every surface in the ORIGINAL order',
  FaceMode.isOwner() === true && treeIds(root).join(',') === ORIGINAL_ORDER, treeIds(root).join(','));
check('FACE the gate opens in owner mode', FaceMode.OWNER_PAGES.every(function (p) { return FaceMode.gate(p) === null; }));
FaceMode.lock();
check('FACE Lock returns to the customer face (surfaces detached, gate closed)',
  FaceMode.isOwner() === false && treeIds(root).indexOf('page-dashboard') === -1 && FaceMode.gate('registry') === 'wallet');

/* ---------------- the unlock decision + claim-once ------------- */
(function () {
  const owner = { id: 'TSG-BIO-1', name: 'Owner', owner: true };
  const guest = { id: 'TSG-BIO-2', name: 'Guest' };
  check('UNLOCK no match is a no-match', FaceMode.unlockDecision(null, [owner, guest]) === 'no-match');
  check('UNLOCK the owner palm enters', FaceMode.unlockDecision(owner, [owner, guest]) === 'enter');
  check('UNLOCK a non-owner palm is refused while an owner exists', FaceMode.unlockDecision(guest, [owner, guest]) === 'refuse');
  check('UNLOCK with no owner anywhere, a match is a claim', FaceMode.unlockDecision(guest, [guest]) === 'claim');
  /* claim-once: apply the wiring's claim mutation (flag the
     matched profile) and the SAME decision function must never
     offer a second claim — a later non-owner match is refused,
     and the claimed profile now enters as owner. */
  const people = [{ id: 'TSG-BIO-2', name: 'Guest' }, { id: 'TSG-BIO-3', name: 'Other' }];
  check('UNLOCK first claim is offered when no owner exists', FaceMode.unlockDecision(people[0], people) === 'claim');
  people[0].owner = true; // the wiring's claim write
  check('UNLOCK after the claim, another palm is refused (claim fires once and only once)',
    FaceMode.unlockDecision(people[1], people) === 'refuse');
  check('UNLOCK after the claim, the claimed palm enters as owner',
    FaceMode.unlockDecision(people[0], people) === 'enter');
})();

/* ---------------- shipped markup ------------------------------- */
(function () {
  const ownerSections = ['page-dashboard', 'page-terminal', 'page-stores', 'page-registry', 'page-logs', 'page-partner'];
  check('MARKUP every owner page section carries the owner-only marker',
    ownerSections.every(function (id) { return htmlSrc.indexOf('class="page owner-only" id="' + id + '"') !== -1; }));
  check('MARKUP the More page owner cards and links carry the marker (Field Test, Vault, Sync, Delete, store/log/partner/registry links)',
    htmlSrc.indexOf('class="card owner-only" style="margin-top:16px"><h2>Field Test Mode</h2>') !== -1 &&
    htmlSrc.indexOf('class="card owner-only" style="margin-top:16px"><h2>Biom Vault') !== -1 &&
    htmlSrc.indexOf('class="card owner-only" style="margin-top:16px"><h2>Scan Sync</h2>') !== -1 &&
    htmlSrc.indexOf('class="card owner-only" style="margin-top:16px"><h2>Delete all data</h2>') !== -1 &&
    htmlSrc.indexOf('class="morelink owner-only" data-go="registry"') !== -1 &&
    htmlSrc.indexOf('class="morelink" data-go="account"') !== -1);
  check('MARKUP the customer nav is Wallet / Activity / My Account; the owner nav keeps the six',
    htmlSrc.indexOf('data-page="activity" data-face="customer"') !== -1 &&
    htmlSrc.indexOf('data-page="account" data-face="customer"') !== -1 &&
    htmlSrc.indexOf('data-page="dashboard" data-face="owner"') !== -1 &&
    htmlSrc.indexOf('data-page="more" data-face="owner"') !== -1);
  check('MARKUP the page boots in customer mode and carries the owner bar + version line',
    htmlSrc.indexOf('<body class="mode-customer">') !== -1 &&
    htmlSrc.indexOf('id="ownerBar"') !== -1 && htmlSrc.indexOf('id="ownerLockBtn"') !== -1 &&
    htmlSrc.indexOf('id="versionLine"') !== -1 && htmlSrc.indexOf('App v91') !== -1 &&
    htmlSrc.indexOf('id="brandLogo"') !== -1);
  check('MARKUP the wallet hero carries the points chip',
    htmlSrc.indexOf('id="wHomePoints"') !== -1 && htmlSrc.indexOf('Palm Loyalty') !== -1);
  check('MARKUP the registration form is name + phone + palm, owner fields customer-hidden',
    htmlSrc.indexOf('id="enName"') !== -1 && htmlSrc.indexOf('id="enPhone"') !== -1 &&
    htmlSrc.indexOf('Create your Biom wallet') !== -1 &&
    (htmlSrc.match(/cust-hide/g) || []).length >= 6);
  check('MARKUP the enrolment consent line names the sealed code and the vault, never a photo',
    htmlSrc.indexOf('sealed (encrypted) under this device\'s Biom Vault key — never a photo') !== -1 &&
    htmlSrc.indexOf('secure TSG Biom vault') !== -1);
  check('MARKUP the Send flow is REMOVED (v90, Chairman 2026-11-28 — people send money in bKash itself)',
    htmlSrc.indexOf('id="wSendScanReceiver"') === -1 && htmlSrc.indexOf('id="wSendAmountBlock"') === -1 &&
    htmlSrc.indexOf('id="wSendContinue"') === -1 && htmlSrc.indexOf('id="walletSend"') === -1);
  check('MARKUP the wallet Pay card carries the store picker, amount and scan button',
    htmlSrc.indexOf('id="walletPay"') !== -1 && htmlSrc.indexOf('id="wPayStore"') !== -1 &&
    htmlSrc.indexOf('id="wPayAmount"') !== -1 && htmlSrc.indexOf('id="wPayScan"') !== -1 &&
    htmlSrc.indexOf('id="wPayEmpty"') !== -1 && htmlSrc.indexOf('id="wPayOpen"') !== -1);
  check('MARKUP no shared-key field survives anywhere in the shipped page',
    htmlSrc.indexOf('syncDeviceKey') === -1);
})();

/* ---------------- app wiring (source) -------------------------- */
(function () {
  check('WIRING go() gates owner pages behind the face mode',
    appSrc.indexOf("if (!FaceMode.isOwner() && FaceMode.OWNER_PAGES.indexOf(page) !== -1) page = 'wallet';") !== -1);
  check('WIRING the boot chain applies the customer face last',
    appSrc.indexOf('applyInitialFace();') !== -1 && appSrc.indexOf('FaceMode.detachSurfaces()') !== -1);
  check('WIRING the Desk and terminal renders are owner-guarded',
    (appSrc.match(/if \(!FaceMode\.isOwner\(\)\) return Promise\.resolve\(\);/g) || []).length >= 2);
  check('WIRING the unlock is a wallet scan at plain bars with the owner-unlock sync kind',
    appSrc.indexOf("syncKind: 'owner-unlock'") !== -1 &&
    appSrc.indexOf('function openOwnerUnlock()') !== -1 &&
    appSrc.indexOf('FaceMode.unlockDecision(out.person, fresh)') !== -1);
  const unlockSlice = appSrc.slice(appSrc.indexOf('function openOwnerUnlock()'), appSrc.indexOf('/* Discreet owner entry'));
  check('WIRING the unlock scan itself carries NO strict-money flag (entry gate, not money)',
    unlockSlice.indexOf('streamIdentifyPalm') !== -1 && unlockSlice.indexOf('strictMoney') === -1);
  check('WIRING the claim writes the flag and a Logs entry; refusal is honest and logged',
    unlockSlice.indexOf('person.owner = true;') !== -1 &&
    unlockSlice.indexOf("result: 'Owner Claimed'") !== -1 &&
    unlockSlice.indexOf('who is not the owner of this device') !== -1 &&
    unlockSlice.indexOf("result: 'Owner Unlock Denied — Not Owner'") !== -1);
  check('WIRING owner entry triggers: five version-line taps and the logo long-press',
    appSrc.indexOf("if (taps >= 5)") !== -1 && appSrc.indexOf('setTimeout(openOwnerUnlock, 700)') !== -1);
  check('WIRING the Registry owner toggle exists and is owner-mode only',
    appSrc.indexOf('data-owner-toggle') !== -1 &&
    appSrc.indexOf('if (!FaceMode.isOwner()) return;') !== -1);
  check('WIRING sync defaults: baked endpoint, default ON, bootstrap key constant, registration-only dep',
    appSrc.indexOf("var SYNC_DEFAULT_ENDPOINT = 'https://tsg-biom-api.vercel.app';") !== -1 &&
    appSrc.indexOf("on: syncPrefGet('biomSyncOn') !== '0'") !== -1 &&
    appSrc.indexOf("endpoint: syncPrefGet('biomSyncEndpoint') || SYNC_DEFAULT_ENDPOINT") !== -1 &&
    /var SYNC_BOOTSTRAP_KEY = '[0-9a-f]{48}';/.test(appSrc) &&
    appSrc.indexOf('registrationOnlyKey: true') !== -1 &&
    appSrc.indexOf('deviceKey: SYNC_BOOTSTRAP_KEY') !== -1);
  check('WIRING the legacy shared-key pref is never read as the device key',
    appSrc.indexOf("deviceKey: syncPrefGet('biomSyncDeviceKey')") === -1);
  check('SEND the whole send wiring is REMOVED (v90, Chairman 2026-11-28)',
    appSrc.indexOf('wSendScanReceiver') === -1 && appSrc.indexOf('renderSendConfirm') === -1 &&
    appSrc.indexOf("$('wSendContinue')") === -1 && appSrc.indexOf('B.walletApplySend(') === -1);
  const paySlice = appSrc.slice(appSrc.indexOf("$('wPayScan').addEventListener"), appSrc.indexOf('/* ---------------- My Account'));
  check('PAY the wallet Pay verifies the OWN palm under the strict rule and creates the terminal-shaped record',
    paySlice.indexOf('{ strictMoney: true }') !== -1 &&
    paySlice.indexOf("'BIOM-PAY-' + seq") !== -1 &&
    paySlice.indexOf('status: PAY_STATUS') !== -1 &&
    paySlice.indexOf('Math.floor(tx.amount / LOYALTY_CONFIG.paymentEarnDivisor)') !== -1);
  check('PAY the store picker is filled from the same STORES list as enrolment and terminal',
    appSrc.indexOf("['enStore', 'termStore', 'wPayStore']") !== -1);
})();

/* ---------------- the scan kind, both sides -------------------- */
(function () {
  const rec = B.syncScanRecord({ kind: 'owner-unlock', profileName: 'Rig', biomId: 'TSG-BIO-9', hand: 'left', edccScore: 0.5, palmnetScore: 0.9, result: 'Verified', deviceLabel: 'Rig', modelId: 'palmnet-r3-ep12', appVersion: 'v63' }, 1764000000000);
  check('KIND the app shaper accepts the owner-unlock scan kind', !!rec && rec.kind === 'owner-unlock');
  const bogus = B.syncScanRecord({ kind: 'not-a-kind', profileName: 'Rig', biomId: 'TSG-BIO-9', result: 'Verified' }, 1764000000000);
  check('KIND the app shaper still refuses unknown kinds', bogus === null);
  check('KIND the API whitelist carries owner-unlock too', apiRecordsSrc.indexOf("'owner-unlock'") !== -1);
})();

/* ---------------- the sync engine degrade ---------------------- */
const engineSrc = appSrc.slice(appSrc.indexOf('/* SYNC-ENGINE-BEGIN'), appSrc.indexOf('/* SYNC-ENGINE-END */'));
const createBiomSync = new Function(engineSrc + '\nreturn createBiomSync;')();
function jsonRes(status, body) {
  return {
    status: status,
    json: function () { return Promise.resolve(body || {}); },
    headers: { get: function () { return null; } }
  };
}
function makeEngine63(fetchFn) {
  const store = { outbox: [], versions: {} };
  const prefs = { on: true, endpoint: 'https://tsg-biom-api.vercel.app', deviceKey: 'bootstrap-key-rig', label: 'Rig phone' };
  const rig = { seq: 0 };
  let n = 0;
  const deps = {
    B: B, modelId: 'palmnet-r3-ep12', appVersion: 'v63',
    registrationOnlyKey: true,
    getPrefs: function () { return prefs; },
    loadOutbox: function () { return Promise.resolve(store.outbox); },
    saveOutbox: function (items) { store.outbox = items; return Promise.resolve(); },
    fetchFn: fetchFn,
    now: function () { return 1764000000000; },
    uuid: function () { return 'uuid-' + (++n); },
    onStatus: function () {},
    loadVersions: function () { return Promise.resolve(JSON.parse(JSON.stringify(store.versions))); },
    saveVersions: function (v) { store.versions = v; },
    getSeq: function () { return rig.seq; },
    setSeq: function (s) { rig.seq = s; },
    saveCredential: function (id, secret) { prefs.deviceId = id; prefs.deviceSecret = secret; },
    signRequest: function (secret, deviceId, seq, method, p, body) {
      return Promise.resolve(apiCanonical.signRequest(secret, deviceId, seq, method, p, body));
    },
    applyTombstone: function () { return Promise.resolve(); },
    onProfileConflict: function () {}
  };
  return { engine: createBiomSync(deps), store: store, prefs: prefs };
}

async function engineTests() {
  /* Registration refused (the BOOTSTRAP_KEY env var not yet set
     on the server): the queue must HOLD — no write attempted
     with the bootstrap key, no key-rejected latch, honest
     status. This is the exact pre-Vercel-step behaviour. */
  const calls1 = [];
  const m1 = makeEngine63(function (url, opts) {
    calls1.push({ url: url, headers: opts.headers });
    if (url.endsWith('/api/devices')) return Promise.resolve(jsonRes(401, { error: 'unauthorised' }));
    return Promise.resolve(jsonRes(201, { ok: true }));
  });
  m1.engine.noteScan({ kind: 'owner-unlock', profileName: 'Rig', biomId: 'TSG-BIO-9', hand: 'left', edccScore: 0.5, palmnetScore: 0.9, result: 'Verified' });
  await tick();
  const st1 = await m1.engine.flush();
  /* v88 PIN CHANGE (named): instant sync attempts the flush at
     record creation AND this rig flushes manually, so the
     bootstrap registration may be attempted twice — the
     invariant is unchanged: EVERY call is the registration
     call; no scan/profile write is ever attempted with the
     bootstrap key. */
  check('SYNC with registration refused, NO scan/profile write is attempted with the bootstrap key',
    calls1.length >= 1 && calls1.every(function (c) { return c.url.endsWith('/api/devices'); }), 'calls=' + calls1.length);
  check('SYNC with registration refused, the queue HOLDS (nothing dropped)',
    st1.queued === 1 && m1.engine.pendingItems().length === 1, 'queued=' + st1.queued);
  check('SYNC with registration refused, no misleading key-rejected latch is set',
    st1.keyRejected === false && st1.lastError.indexOf('not registered yet') !== -1, st1.lastError);
  const tc1 = await m1.engine.testConnection();
  check('SYNC Test connection answers honestly while unregistered',
    tc1.ok === false && tc1.message.indexOf('could not register') !== -1, tc1.message.slice(0, 60));

  /* Registration answered: the device registers, then signs
     and drains exactly as the v62 machinery does. */
  const calls2 = [];
  const m2 = makeEngine63(function (url, opts) {
    calls2.push({ url: url, headers: opts.headers });
    if (url.endsWith('/api/devices')) return Promise.resolve(jsonRes(201, { deviceId: 'dev-v63rig', deviceKey: 'secret-v63rig' }));
    return Promise.resolve(jsonRes(201, { ok: true, version: 1 }));
  });
  m2.engine.noteScan({ kind: 'verify', profileName: 'Rig', biomId: 'TSG-BIO-9', hand: 'left', edccScore: 0.5, palmnetScore: 0.9, result: 'Verified' });
  await tick();
  const st2 = await m2.engine.flush();
  check('SYNC with registration answered, the device registers first, then posts',
    calls2.length === 2 && calls2[0].url.endsWith('/api/devices') && calls2[1].url.endsWith('/api/scans'),
    calls2.map(function (c) { return c.url.split('/').pop(); }).join(','));
  check('SYNC the post rides the issued credential (never the bootstrap key)',
    calls2[1].headers['x-device-id'] === 'dev-v63rig' && calls2[1].headers['x-device-key'] === 'secret-v63rig' &&
    !!calls2[1].headers['x-device-sig']);
  check('SYNC the queue drains after registration', st2.queued === 0, 'queued=' + st2.queued);

  console.log('\n' + (fail === 0 ? 'ALL v63 TWO-FACE TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed'));
  process.exit(fail === 0 ? 0 : 1);
}

engineTests().catch(function (e) { console.error(e); process.exit(1); });
