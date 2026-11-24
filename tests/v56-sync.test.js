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
  const store = { outbox: [] };
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
    onStatus: function () {}
  });
  return { engine: engine, store: store, prefs: prefs };
}
const PERSON = { id: 'TSG-BIO-9', name: 'Rig Person', palmProfile: { v: 4, format: 'packed96', hand: 'left', codes: ['QUJD', 'REVG'], neural: { v: 1, dim: 256, model: 'palmnet-r3-ep12', embeddings: ['R0hJ'] } } };

async function engineTests() {
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
  check('UP the profile body is the stored bank', deepEq(sent[1].body, B.syncProfileRecord(PERSON, 1764000000000)));
  check('UP the status line reports the sync', /^Last synced .* · 0 queued$/.test(m.engine.statusText()), m.engine.statusText());

  /* profile dedupe: the latest bank per Biom ID wins */
  const sentP = [];
  m = makeEngine({ fetchFn: function (url, opts) { sentP.push(JSON.parse(opts.body)); return Promise.resolve({ status: 201 }); } });
  m.engine.noteProfile(PERSON);
  m.engine.noteProfile(Object.assign({}, PERSON, { palmProfile: Object.assign({}, PERSON.palmProfile, { codes: ['QUJD', 'REVG', 'TU5P'] }) }));
  await tick();
  check('DEDUPE two upserts for one Biom ID queue ONE item', m.engine.state().queued === 1, 'queued=' + m.engine.state().queued);
  await m.engine.flush();
  check('DEDUPE the item sent is the LATEST bank', sentP.length === 1 && sentP[0].edccCodes.length === 3);

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
    check('E2E the bank reads back verbatim', profJson.count === 1 && deepEq(profJson.profiles[0], B.syncProfileRecord(PERSON, 1764000000000)));
  } finally {
    child.kill('SIGTERM');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

/* ---------------- source pins ---------------------------------- */
(function () {
  check('UI the More page carries the Sync card (endpoint, PASSWORD device key, label, toggle, status, both buttons)',
    htmlSrc.indexOf('id="syncEndpoint"') !== -1 && htmlSrc.indexOf('id="syncDeviceKey" type="password"') !== -1 &&
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
  check('WIRING the device key is read from prefs and sent ONLY as the x-device-key header',
    appSrc.indexOf("'x-device-key': p.deviceKey") !== -1 &&
    (appSrc.match(/deviceKey/g) || []).length <= 6,
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
