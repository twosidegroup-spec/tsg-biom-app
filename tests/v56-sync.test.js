/* TSG BIOM v56 — THE SCAN SYNC (the Chairman's order
   2026-11-24 22:20: "make a connection to u whenever i scan
   palm it will be seen by u as this palms will be real"; route
   chosen 22:25: our own API on his Vercel, NOT Supabase).

   What v56 does: a DEFAULT-OFF, owner-configured mirror. When
   the owner turns Scan Sync ON in More and points it at his own
   TSG Biom API, every event that already writes a Logs entry or
   a Field Test record also queues a scan record built from the
   SAME measured values in the SAME closure, and every bank
   change queues a profile upsert with the CURRENT stored bank
   (B.syncProfileRecord). A background flush (boot, debounced
   after each enqueue, Sync now) POSTs the queue in order and
   removes an item only on a 2xx. Matching never waits on the
   network. A 401 latches "key rejected" and stops retries until
   the settings are saved again.

   What this suite proves:
   - the pure builders shape both record kinds and refuse
     bank-less profiles and unknown kinds;
   - the engine (createBiomSync, extracted from app.js and
     driven with stub deps): OFF or unconfigured -> note*
     queues nothing and NO fetch is attempted; ON with the
     server down -> scans still complete and the queue grows,
     flush leaves it intact; ON with the server up -> the queue
     drains IN ORDER with the exact record shapes, and the
     device key appears in NO posted body; 401 -> latched,
     no retry storm, settingsChanged re-arms;
   - the same engine drains into the REAL local API server
     (tsg-biom-api/server.js, fs backend) and the records read
     back with the read key are value-identical;
   - profile upserts dedupe per Biom ID (latest bank wins);
   - the outbox persists across an engine restart;
   - source pins: the More settings card (device key is a
     password input), the My Account link row, the wiring
     (boot flush, wipe clears prefs + engine), the noteScan
     call-site kinds — and the deliberate ABSENCE of a
     delete-all record (the wipe sends nothing);
   - migration 'v56' purity lives in v38-migration.test.js.

   v73 PIN ALIGNMENT (named, 2026-11-26): the API now refuses
   non-tombstone profile writes carrying templates without
   enc:'v1' ("enc v1 required", API lib/records.js S2-2). This
   rig originally drove the engine with NO sealing dep (the
   pre-v61 plaintext contract), so its E2E profile write was
   rejected by the fixed API. The rig now wires a REAL ready
   vault into the engine — the same mechanism the v61 suite
   uses (B.vaultGenerateRaw / vaultImportKey /
   vaultDeriveBankKey + B.bankEncryptProfileCore, exactly the
   shipped app's sealing helper) — and every profile outcome
   below is asserted over the SEALED path: the posted/read-back
   bank carries enc:'v1' with sealed template strings, and
   opening those strings with the rig vault key restores the
   stored bank byte-for-byte. No outcome was dropped.

   All numbers here are RIG numbers; the phone is the verdict. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function info(msg) { console.log('  ..  ' + msg); }
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/* ---------------- the pure builders ---------------------------- */
(function () {
  const rec = B.syncScanRecord({ kind: 'verify', profileName: 'Sajid', biomId: 'TSG-BIO-1', hand: 'left', edccScore: 0.457, palmnetScore: 0.912, result: 'Verified' });
  check('BUILD scan record carries the measured values verbatim',
    deepEq(rec, { kind: 'verify', profileName: 'Sajid', biomId: 'TSG-BIO-1', hand: 'left', edccScore: 0.457, palmnetScore: 0.912, result: 'Verified' }));
  check('BUILD an unknown kind is refused', B.syncScanRecord({ kind: 'bogus' }) === null);
  check('BUILD non-numeric scores become null, a bad hand becomes null',
    deepEq(B.syncScanRecord({ kind: 'enrol', edccScore: 'high', hand: 'both' }),
      { kind: 'enrol', profileName: '', biomId: '', hand: null, edccScore: null, palmnetScore: null, result: '' }));
  check('BUILD every API kind is buildable', B.SYNC_SCAN_KINDS.every(function (k) { return !!B.syncScanRecord({ kind: k }); }),
    B.SYNC_SCAN_KINDS.join(','));

  const person = { id: 'TSG-BIO-9', name: 'Rig Person', palmProfile: { v: 4, format: 'packed96', hand: 'left', codes: ['QUJD', 'REVG'], neural: { v: 1, dim: 256, model: 'palmnet-r3-ep12', embeddings: ['R0hJ'] } } };
  check('BUILD profile record extracts the stored bank (codes, embeddings, stamp, hand)',
    deepEq(B.syncProfileRecord(person, 1764000000000),
      { biomId: 'TSG-BIO-9', name: 'Rig Person', hand: 'left', edccCodes: ['QUJD', 'REVG'], neuralEmbeddings: ['R0hJ'], neuralModel: 'palmnet-r3-ep12', updatedTs: 1764000000000 }));
  check('BUILD a person with no palm bank yields no upsert',
    B.syncProfileRecord({ id: 'TSG-BIO-3', name: 'No Palm' }, 1) === null &&
    B.syncProfileRecord({ id: 'TSG-BIO-4', name: 'Empty', palmProfile: { v: 4, format: 'packed96', codes: [] } }, 1) === null);
  check('BUILD an EDCC-only bank upserts with an empty neural side',
    deepEq(B.syncProfileRecord({ id: 'TSG-BIO-5', name: 'Old', palmProfile: { v: 4, format: 'packed96', codes: ['QUJD'] } }, 7),
      { biomId: 'TSG-BIO-5', name: 'Old', hand: null, edccCodes: ['QUJD'], neuralEmbeddings: [], neuralModel: '', updatedTs: 7 }));
})();

/* ---------------- the engine, extracted and driven ------------- */
const engineSrc = appSrc.slice(appSrc.indexOf('/* SYNC-ENGINE-BEGIN'), appSrc.indexOf('/* SYNC-ENGINE-END */'));
check('ENGINE createBiomSync is extractable from app.js', engineSrc.indexOf('function createBiomSync') !== -1);
const createBiomSync = new Function(engineSrc + '\nreturn createBiomSync;')();

function makeEngine(over) {
  over = over || {};
  const store = { outbox: [], versions: {} };
  const prefs = Object.assign({ on: true, endpoint: 'http://api.test', deviceKey: 'device-key-1', label: 'Chairman phone' }, over.prefs || {});
  let seq = 0;
  const engine = createBiomSync({
    B: B, modelId: 'palmnet-r3-ep12', appVersion: 'v56',
    getPrefs: function () { return prefs; },
    loadOutbox: function () { return Promise.resolve(store.outbox); },
    saveOutbox: function (items) { store.outbox = items; return Promise.resolve(); },
    fetchFn: over.fetchFn || function () { return Promise.resolve({ status: 201 }); },
    now: function () { return 1764000000000; },
    uuid: function () { return 'uuid-' + (++seq); },
    onStatus: function () {},
    /* v73 PIN ALIGNMENT (2): the engine is wired with the
       version-store deps, exactly as the shipped app wires
       them (DB.getMeta/setMeta 'syncVersions'). With them the
       engine stamps every profile write with baseVersion —
       the v73 API (S2-3) refuses profile writes without one
       ("baseVersion required"); without the deps the engine
       sends none and the E2E bank write below cannot land. */
    loadVersions: function () { return Promise.resolve(JSON.parse(JSON.stringify(store.versions))); },
    saveVersions: function (v) { store.versions = v; },
    /* v73 PIN ALIGNMENT: the engine is wired with the sealing
       dep, exactly as the shipped app wires Vault.encryptProfileCore
       (which delegates to B.bankEncryptProfileCore under a ready
       vault). Rigs that omit the dep get the pre-v61 plaintext
       core — the fixed API refuses that, so this rig seals. */
    encryptProfileCore: function (core) { return sealProfileCore(core); }
  });
  return { engine: engine, store: store, prefs: prefs };
}
const PERSON = { id: 'TSG-BIO-9', name: 'Rig Person', palmProfile: { v: 4, format: 'packed96', hand: 'left', codes: ['QUJD', 'REVG'], neural: { v: 1, dim: 256, model: 'palmnet-r3-ep12', embeddings: ['R0hJ'] } } };

/* ---- v73 sealed-contract helpers (the v61 suite's vault) ------
   A real vault key for this rig: deriveKey(biomId) yields the
   per-bank AES key, sealProfileCore produces the enc:'v1'
   envelope the shipped app posts, and openCore reverses a
   sealed core back to the plaintext syncProfileRecord shape so
   the assertions below can prove the SAME bank landed. */
let vaultCtx = null;
async function initVault() {
  if (vaultCtx) return vaultCtx;
  const raw = await B.vaultGenerateRaw();
  const kid = await B.vaultKeyId(raw);
  const vaultKey = await B.vaultImportKey(raw, false);
  const cache = {};
  function deriveKey(biomId) {
    if (!cache[biomId]) cache[biomId] = B.vaultDeriveBankKey(vaultKey, biomId);
    return cache[biomId];
  }
  vaultCtx = { kid: kid, deriveKey: deriveKey };
  return vaultCtx;
}
function sealProfileCore(core) {
  if (!vaultCtx) return Promise.resolve(null);
  return B.bankEncryptProfileCore(core, vaultCtx.deriveKey, vaultCtx.kid);
}
async function openCore(sealed) {
  const bankKey = await vaultCtx.deriveKey(sealed.biomId);
  const edcc = [];
  for (const s of sealed.edccCodes || []) edcc.push(await B.bankDecryptString(s, bankKey));
  const neural = [];
  for (const s of sealed.neuralEmbeddings || []) neural.push(await B.bankDecryptString(s, bankKey));
  return { biomId: sealed.biomId, name: sealed.name, hand: sealed.hand, edccCodes: edcc, neuralEmbeddings: neural, neuralModel: sealed.neuralModel, updatedTs: sealed.updatedTs };
}
function isSealedCore(core) {
  return !!core && core.enc === 'v1' &&
    (core.edccCodes || []).every(function (s) { return B.bankEncIsSealed(s); }) &&
    (core.neuralEmbeddings || []).every(function (s) { return B.bankEncIsSealed(s); });
}
/* Sealing is async (WebCrypto): wait until the engine's outbox
   actually carries a profile item matching pred before flushing
   or asserting queue state — the v61 suite's wait pattern. */
async function waitForProfile(m, pred) {
  for (let i = 0; i < 200; i++) {
    const items = m.engine.pendingItems().filter(function (it) { return it.type === 'profile'; });
    if (items.length && (!pred || pred(items[items.length - 1].record))) return true;
    await tick(10);
  }
  return false;
}

async function engineTests() {
  await initVault();
  /* OFF: nothing queues, no fetch is attempted */
  let fetchCount = 0;
  let m = makeEngine({ prefs: { on: false }, fetchFn: function () { fetchCount++; return Promise.resolve({ status: 201 }); } });
  check('OFF noteScan/noteProfile refuse to queue',
    m.engine.noteScan({ kind: 'verify', result: 'Verified' }) === false && m.engine.noteProfile(PERSON) === false);
  await tick();
  await m.engine.flush();
  check('OFF zero fetches attempted and the outbox stays empty', fetchCount === 0 && m.store.outbox.length === 0 && m.engine.statusText() === 'Off');

  /* ON but unconfigured: same silence */
  m = makeEngine({ prefs: { endpoint: '', deviceKey: '' }, fetchFn: function () { fetchCount++; return Promise.resolve({ status: 201 }); } });
  check('UNCONFIGURED noteScan refuses to queue', m.engine.noteScan({ kind: 'verify' }) === false);
  await tick();
  check('UNCONFIGURED still zero fetches', fetchCount === 0 && m.store.outbox.length === 0);

  /* ON, server down: scans complete, the queue grows, flush keeps it */
  m = makeEngine({ fetchFn: function () { return Promise.reject(new Error('down')); } });
  check('DOWN noteScan accepts the record (the scan itself already completed)',
    m.engine.noteScan({ kind: 'enrol', profileName: 'Rig Person', biomId: 'TSG-BIO-9', hand: 'left', result: 'Enrolled' }) === true);
  m.engine.noteScan({ kind: 'verify', profileName: 'Rig Person', biomId: 'TSG-BIO-9', hand: 'left', edccScore: 0.457, palmnetScore: 0.912, result: 'Verified' });
  await tick();
  check('DOWN the queue grows to 2 and persists', m.engine.state().queued === 2 && m.store.outbox.length === 2, 'queued=' + m.engine.state().queued);
  await m.engine.flush();
  check('DOWN a failed flush leaves the queue intact', m.engine.state().queued === 2 && m.store.outbox.length === 2);

  /* the outbox survives an engine restart (same persisted store) */
  const m2 = makeEngine({});
  m2.store.outbox = m.store.outbox;
  await m2.engine.ensureLoaded();
  check('RESTART a fresh engine loads the persisted outbox', m2.engine.state().queued === 2);

  /* ON, server up: drains IN ORDER, exact shapes, no key in any body */
  const sent = [];
  m = makeEngine({ fetchFn: function (url, opts) { sent.push({ url: url, body: JSON.parse(opts.body), key: opts.headers['x-device-key'] }); return Promise.resolve({ status: 201 }); } });
  m.engine.noteScan({ kind: 'enrol', profileName: 'Rig Person', biomId: 'TSG-BIO-9', hand: 'left', result: 'Enrolled' });
  m.engine.noteProfile(PERSON);
  /* v73: sealing is async — wait for the sealed profile to be
     queued BEFORE noting the second scan, so the queue order
     asserted below (scan, profile, scan) is deterministic.
     (Cross-type order carries no server semantics; the rig
     sequences the calls so the original order outcome is
     still the thing asserted.) */
  await waitForProfile(m);
  m.engine.noteScan({ kind: 'verify', profileName: 'Rig Person', biomId: 'TSG-BIO-9', hand: 'left', edccScore: 0.457, palmnetScore: 0.912, result: 'Verified' });
  await tick();
  await m.engine.flush();
  check('UP the queue drains fully', m.engine.state().queued === 0 && m.store.outbox.length === 0);
  check('UP posts go in queue order (scan, profile, scan) to the right routes',
    sent.length === 3 && sent[0].url === 'http://api.test/api/scans' && sent[1].url === 'http://api.test/api/profiles' && sent[2].url === 'http://api.test/api/scans',
    sent.map(function (s) { return s.url.split('/').pop(); }).join(','));
  check('UP the scan body is exactly the API shape (id, ts, label, model, version + measured values)',
    deepEq(Object.keys(sent[0].body).sort(), ['appVersion', 'biomId', 'deviceLabel', 'edccScore', 'hand', 'id', 'kind', 'modelId', 'palmnetScore', 'profileName', 'result', 'ts']) &&
    sent[0].body.kind === 'enrol' && sent[0].body.deviceLabel === 'Chairman phone' && sent[0].body.modelId === 'palmnet-r3-ep12' && sent[0].body.appVersion === 'v56' &&
    sent[2].body.edccScore === 0.457 && sent[2].body.palmnetScore === 0.912);
  check('UP the device key rides the header and appears in NO posted body',
    sent.every(function (s) { return s.key === 'device-key-1'; }) &&
    sent.every(function (s) { return JSON.stringify(s.body).indexOf('device-key-1') === -1; }));
  /* v73 PIN CHANGE (named): was 'UP the profile body is the
     stored bank' against the PLAINTEXT core. The same outcome
     is now asserted over the sealed path: the posted body is
     the enc:'v1' envelope of the stored bank — shape fields
     verbatim, every template string sealed, no plaintext
     template anywhere in the body — and opening it with the
     rig vault key restores B.syncProfileRecord(PERSON, …)
     byte-for-byte. */
  check('UP the profile body is the stored bank, sealed (enc v1; opens back to the exact bank)',
    sent.length === 3 && isSealedCore(sent[1].body) &&
    JSON.stringify(sent[1].body).indexOf('QUJD') === -1 && JSON.stringify(sent[1].body).indexOf('R0hJ') === -1 &&
    deepEq(await openCore(sent[1].body), B.syncProfileRecord(PERSON, 1764000000000)));
  check('UP the status line reports the sync', /^Last synced .* · 0 queued$/.test(m.engine.statusText()), m.engine.statusText());

  /* profile dedupe: the latest bank per Biom ID wins.
     v88 PIN CHANGE (named): instant sync fires the first
     upsert's flush AT CREATION, so the rig's first fetch is
     held pending — the second note then lands while the first
     is in flight, exactly the phone race. The invariants are
     unchanged and still asserted: the QUEUE holds ONE item for
     the Biom ID (the in-flight upsert is deduped out of it),
     and the LAST bank posted is the LATEST bank, sealed. (The
     in-flight first post may complete — it was legitimately
     sent before the newer bank existed; the engine's identity
     removal keeps its completion from dropping the newer
     queued item, which is what makes the last post latest.) */
  const sentP = [];
  let releaseFirstP = null;
  m = makeEngine({ fetchFn: function (url, opts) {
    sentP.push(JSON.parse(opts.body));
    if (sentP.length === 1) return new Promise(function (r) { releaseFirstP = function () { r({ status: 201 }); }; });
    return Promise.resolve({ status: 201 });
  } });
  m.engine.noteProfile(PERSON);
  m.engine.noteProfile(Object.assign({}, PERSON, { palmProfile: Object.assign({}, PERSON.palmProfile, { codes: ['QUJD', 'REVG', 'TU5P'] }) }));
  /* v73: wait until the queued item is the SEALED latest bank
     (3 sealed codes) — sealing resolves asynchronously and the
     per-person sequence guard keeps the last call's bank. */
  await waitForProfile(m, function (rec) { return rec.edccCodes.length === 3; });
  check('DEDUPE two upserts for one Biom ID queue ONE item', m.engine.state().queued === 1, 'queued=' + m.engine.state().queued);
  if (releaseFirstP) releaseFirstP();
  await tick(60);
  await m.engine.flush();
  /* v73 PIN CHANGE (named): 'the item sent is the LATEST bank'
     now also proves the sent item is the sealed form of that
     latest bank (enc v1) and opens back to its exact codes.
     v88: asserted on the LAST post (see the pin note above). */
  check('DEDUPE the last item sent is the LATEST bank, sealed (enc v1; opens back to the latest codes)',
    sentP.length >= 1 && sentP[sentP.length - 1].edccCodes.length === 3 && isSealedCore(sentP[sentP.length - 1]) &&
    deepEq((await openCore(sentP[sentP.length - 1])).edccCodes, ['QUJD', 'REVG', 'TU5P']) &&
    m.engine.state().queued === 0,
    'posts=' + sentP.length);

  /* 401: latches, no retry storm, settingsChanged re-arms */
  let calls401 = 0;
  let allow = false;
  m = makeEngine({ fetchFn: function () { calls401++; return Promise.resolve({ status: allow ? 201 : 401 }); } });
  m.engine.noteScan({ kind: 'verify', result: 'Verified' });
  await tick();
  await m.engine.flush();
  check('401 the flush stops with the item still queued', m.engine.state().queued === 1 && calls401 === 1);
  check('401 the status line says the key was rejected', m.engine.statusText().indexOf('Key rejected') === 0, m.engine.statusText());
  await m.engine.flush();
  await m.engine.flush();
  check('401 no retry storm — further flushes attempt nothing', calls401 === 1);
  allow = true;
  await m.engine.flush();
  check('401 still latched until the settings change', calls401 === 1 && m.engine.state().queued === 1);
  m.engine.settingsChanged();
  await m.engine.flush();
  check('401 saving settings re-arms and the queue drains', calls401 === 2 && m.engine.state().queued === 0);
}

/* ---------------- end to end into the real API server ---------- */
async function e2eTest() {
  await initVault();
  const apiDir = path.join(__dirname, '..', '..', 'tsg-biom-api');
  if (!fs.existsSync(path.join(apiDir, 'server.js'))) { info('tsg-biom-api not found beside the app — e2e skipped'); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tsg-biom-v56-'));
  const PORT = 18937;
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), STORAGE: 'fs', DATA_DIR: path.join(tmp, 'data'),
    DEVICE_KEY: 'v56-device-key', READ_KEY: 'v56-read-key'
  });
  const child = spawn(process.execPath, [path.join(apiDir, 'server.js')], { env: env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      try { const r = await fetch('http://127.0.0.1:' + PORT + '/api/health'); up = r.ok; } catch (e) { await tick(150); }
    }
    check('E2E the real API server starts', up);
    if (!up) return;
    const m = makeEngine({ prefs: { endpoint: 'http://127.0.0.1:' + PORT, deviceKey: 'v56-device-key' }, fetchFn: function (u, o) { return fetch(u, o); } });
    m.engine.noteScan({ kind: 'enrol', profileName: 'Rig Person', biomId: 'TSG-BIO-9', hand: 'left', result: 'Enrolled' });
    m.engine.noteProfile(PERSON);
    /* v73: the profile write is the SEALED core (enc v1) — the
       only form the fixed API accepts. Wait for it to queue
       before the last scan + flush so the whole queue drains
       in this one flush, as the original rig asserted. */
    await waitForProfile(m);
    m.engine.noteScan({ kind: 'wallet-open', profileName: 'Rig Person', biomId: 'TSG-BIO-9', hand: 'left', edccScore: 0.457, palmnetScore: 0.912, result: 'Verified' });
    await tick();
    await m.engine.flush();
    check('E2E the app queue drains into the real server', m.engine.state().queued === 0);
    const scansRes = await fetch('http://127.0.0.1:' + PORT + '/api/scans', { headers: { 'x-read-key': 'v56-read-key' } });
    const scansJson = await scansRes.json();
    check('E2E both scan records read back with the read key', scansRes.status === 200 && scansJson.count === 2, 'count=' + scansJson.count);
    const wo = scansJson.scans.find(function (s) { return s.kind === 'wallet-open'; });
    check('E2E the wallet-open record is value-identical (scores, hand, label, model, version)',
      !!wo && wo.edccScore === 0.457 && wo.palmnetScore === 0.912 && wo.hand === 'left' &&
      wo.deviceLabel === 'Chairman phone' && wo.modelId === 'palmnet-r3-ep12' && wo.appVersion === 'v56' && wo.profileName === 'Rig Person');
    const profRes = await fetch('http://127.0.0.1:' + PORT + '/api/profiles', { headers: { 'x-read-key': 'v56-read-key' } });
    const profJson = await profRes.json();
    /* v62 NAMED PIN CHANGE: the server now stamps version,
       ownerDeviceId and receivedTs on the stored bank (B3/B4) —
       the client-sent fields still read back verbatim. */
    const bankBack = Object.assign({}, (profJson.profiles || [])[0] || {});
    delete bankBack.version; delete bankBack.ownerDeviceId; delete bankBack.receivedTs;
    /* v73 PIN CHANGE (named): was 'E2E the bank reads back
       verbatim' against the PLAINTEXT syncProfileRecord. The
       same outcome is now asserted over the sealed path: the
       stored record carries enc:'v1', every template string
       reads back as a sealed envelope (the server stored the
       ciphertext verbatim, staying blind), and opening the
       read-back bank with the rig vault key restores
       B.syncProfileRecord(PERSON, …) byte-for-byte. */
    check('E2E the bank reads back verbatim, sealed (enc v1; opens back to the exact bank)',
      profJson.count === 1 && isSealedCore(bankBack) &&
      deepEq(await openCore(bankBack), B.syncProfileRecord(PERSON, 1764000000000)));
    check('E2E the v62 server stamped version 1 + the legacy owner on the bank',
      !!(profJson.profiles || [])[0] && profJson.profiles[0].version === 1 && profJson.profiles[0].ownerDeviceId === 'legacy');
  } finally {
    child.kill('SIGTERM');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

/* ---------------- source pins ---------------------------------- */
(function () {
  /* v63 PIN CHANGE (named openly): the shared-key field is
     GONE from the card — the app registers itself with the
     built-in registration-only bootstrap key, so there is no
     key for the owner to type. The card keeps the endpoint,
     the device credential fields, label, toggle, status and
     both buttons, and the shared-key input must stay absent. */
  check('UI the More page carries the Sync card (endpoint, label, toggle, status, both buttons; v63: no shared-key field)',
    htmlSrc.indexOf('id="syncEndpoint"') !== -1 && htmlSrc.indexOf('id="syncDeviceKey"') === -1 &&
    htmlSrc.indexOf('id="syncLabel"') !== -1 && htmlSrc.indexOf('id="syncOn"') !== -1 &&
    htmlSrc.indexOf('id="syncStatus"') !== -1 && htmlSrc.indexOf('id="syncSaveBtn"') !== -1 && htmlSrc.indexOf('id="syncNowBtn"') !== -1);
  check('UI My Account settings link to the Sync card on More',
    htmlSrc.indexOf('<span class="setlbl">Scan Sync</span>') !== -1);
  check('WIRING settings are wired and the boot sequence flushes',
    appSrc.indexOf('wireSyncSettings();') !== -1 && appSrc.indexOf('Sync.flush()') !== -1 && appSrc.indexOf('fillSyncSettings()') !== -1);
  check('WIRING the outbox persists as the syncOutbox meta row',
    appSrc.indexOf("DB.getMeta('syncOutbox', [])") !== -1 && appSrc.indexOf("DB.setMeta('syncOutbox', items)") !== -1);
  check('WIRING Delete All Data clears the four sync prefs and resets the engine',
    appSrc.indexOf("'biomSyncEndpoint', 'biomSyncDeviceKey', 'biomSyncLabel', 'biomSyncOn'") !== -1 && appSrc.indexOf('Sync.reset();') !== -1);
  /* v62 NAMED PIN CHANGE: the bound rises 6 -> 12. The shared
     key gains ONE new legitimate role in v62 — it is the
     bootstrap credential that registers this device's own
     credential (POST /api/devices) and the desync recovery
     path — so the engine names it in the bootstrap and its
     guards as well as in the two header sends. The invariant
     the pin exists for is unchanged and still checked here:
     the key is read from prefs and sent ONLY as the
     x-device-key header — never in a body, never in a log. */
  check('WIRING the device key is read from prefs and sent ONLY as the x-device-key header',
    appSrc.indexOf("'x-device-key': p.deviceKey") !== -1 &&
    (appSrc.match(/deviceKey/g) || []).length <= 12,
    'deviceKey mentions=' + (appSrc.match(/deviceKey/g) || []).length);
  /* v60 PIN CHANGE (named openly): 'wallet-open' leaves the
     app-callsite list — wallet entry is no longer a scan (the
     Chairman's order, 2026-11-25), so the app produces no
     wallet-open records any more. The engine still accepts
     the kind (the E2E section above queues one directly and
     it round-trips), because records already on the server
     carry it. The check after the loop pins the absence. */
  ['enrol', 'verify', 'identify', 'money-auth', 'topup', 're-register', 'field-test'].forEach(function (k) {
    check('CALLSITE a noteScan call site queues kind ' + k, appSrc.indexOf("kind: '" + k + "'") !== -1 || appSrc.indexOf('kind: amount > 0') !== -1 && (k === 'verify' || k === 'money-auth'));
  });
  check('CALLSITE v60: NO app call site queues kind wallet-open any more (entry is not a scan)',
    appSrc.indexOf("kind: 'wallet-open'") === -1 && appSrc.indexOf("syncKind: 'wallet-open'") === -1);
  check('CALLSITE terminal money scans pick money-auth vs verify by amount (the single-source closure)',
    appSrc.indexOf("kind: amount > 0 ? 'money-auth' : 'verify'") !== -1);
  check('CALLSITE NO delete-all record is ever queued (the wipe sends nothing, by design)',
    appSrc.indexOf("kind: 'delete-all'") === -1);
  // v57 pin conversion (named, the v55 precedent): this was an
  // absolute pin on 'v56'; it is now the coherence form — the app
  // data version, the shell version and the newest migration link
  // agree with each other, whatever the current version is.
  check('VERSION app data version, shell version and newest migration link agree',
    (function () {
      const dv = (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1];
      const sv = (swSrc.match(/tsg-biom-shell-(v\d+)/) || [])[1];
      return !!dv && dv === sv && B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === dv;
    })());
})();

(async function () {
  await engineTests();
  await e2eTest();
  console.log('\n' + (fail === 0 ? 'ALL v56 SYNC TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed'));
  info('rig only: stub deps, a stub fetch and the local fs-backed API server. The phone verdict — his real palms appearing on his real Vercel deployment — is the real-world proof, and it has not been claimed here.');
  process.exit(fail === 0 ? 0 : 1);
})();
