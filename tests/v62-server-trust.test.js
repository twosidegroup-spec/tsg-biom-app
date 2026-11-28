/* TSG BIOM v62 — THE SERVER TRUST BATCH (Phase B items B2–B5 +
   B7, Seat 2's specs; Seat 1's key-UI revision; the Chairman's
   fraud penalty regime surfaced honestly; PIN copy truth).

   What v62 does: the Scan Sync connection stops trusting one
   shared key and a last-writer-wins server. The device
   registers its own credential (the shared key becomes a
   one-time bootstrap; v61 devices keep working on it), signs
   its writes with a per-device sequence, writes banks
   compare-and-swap against the last acknowledged version,
   tombstones its banks on Delete All Data and pulls other
   devices' tombstones. The server enforces the penalties
   (lockout, rate limits, velocity holds, revocation); this
   suite proves the APP side of every one of those contracts,
   driving the extracted engine with stub deps and a scripted
   fetch, plus the cross-implementation signing vector shared
   with the API suite. The end-to-end contracts against the
   real server live in tsg-biom-api/tests/server-trust.test.js
   and in the dashboard suite.

   PIN IS OUT of this release (the Chairman deferred it,
   2026-11-25): the suite pins that no copy promises a PIN
   flow any more.

   All numbers here are RIG numbers; the phone is the verdict. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');
const apiCanonical = require('../../tsg-biom-api/lib/canonical.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

/* ---------------- version + shape ------------------------------ */
(function () {
  check('VERSION app, shell and chain agree at v95 (v95 named pin change: merchant terminal lightest))',
    (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v95' &&
    swSrc.indexOf('tsg-biom-shell-v95') !== -1 &&
    B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v95');

  const person = { id: 'TSG-BIO-9', name: 'Rig', palmProfile: { v: 4, format: 'packed96', codes: ['QUJD'] } };
  check('SHAPE a person without a walletLink emits the v61 record byte-identical',
    deepEq(B.syncProfileRecord(person, 7),
      { biomId: 'TSG-BIO-9', name: 'Rig', hand: null, edccCodes: ['QUJD'], neuralEmbeddings: [], neuralModel: '', updatedTs: 7 }));
  const linked = Object.assign({}, person, { walletLink: { provider: 'bkash', agreementRef: 'AGR-123', maskedWallet: '01933-***706', linkedTs: 1764000000000, linkMethod: 'agreement' } });
  const rec = B.syncProfileRecord(linked, 7);
  check('SHAPE a valid walletLink rides the profile record (Phase E shape, no ceremony)',
    !!rec && deepEq(rec.walletLink, { provider: 'bkash', agreementRef: 'AGR-123', maskedWallet: '01933-***706', linkedTs: 1764000000000, linkMethod: 'agreement' }));
  const bad = Object.assign({}, person, { walletLink: { provider: 'nagad', agreementRef: 'X', maskedWallet: 'Y', linkedTs: 1, linkMethod: 'agreement' } });
  check('SHAPE a non-bKash / non-agreement walletLink is NOT emitted',
    !('walletLink' in B.syncProfileRecord(bad, 7)));
  check('SHAPE the validator caps its fields',
    B.syncWalletLinkShape({ provider: 'bkash', linkMethod: 'agreement', agreementRef: 'x'.repeat(200), maskedWallet: 'y'.repeat(40), linkedTs: 5 }).agreementRef.length === 128);
})();

/* ---------------- the signer, extracted ------------------------ */
const signerSrc = appSrc.slice(appSrc.indexOf('/* SYNC-SIGNER-BEGIN'), appSrc.indexOf('/* SYNC-SIGNER-END */'));
check('SIGNER the signer block is extractable from app.js', signerSrc.indexOf('function biomSignRequest') !== -1);
const signer = new Function('window', signerSrc + '\nreturn { sign: biomSignRequest, canon: biomCanonicalJson };')(
  { crypto: require('crypto').webcrypto, TextEncoder: TextEncoder });

/* ---------------- the engine, extracted and driven ------------- */
const engineSrc = appSrc.slice(appSrc.indexOf('/* SYNC-ENGINE-BEGIN'), appSrc.indexOf('/* SYNC-ENGINE-END */'));
const createBiomSync = new Function(engineSrc + '\nreturn createBiomSync;')();
const PERSON = { id: 'TSG-BIO-9', name: 'Rig Person', palmProfile: { v: 4, format: 'packed96', hand: 'left', codes: ['QUJD', 'REVG'], neural: { v: 1, dim: 256, model: 'palmnet-r3-ep12', embeddings: ['R0hJ'] } } };

function jsonRes(status, body, headers) {
  return {
    status: status,
    json: function () { return Promise.resolve(body || {}); },
    headers: { get: function (k) { return headers && headers[k] !== undefined ? headers[k] : null; } }
  };
}
function makeEngine(over) {
  over = over || {};
  const store = { outbox: [], versions: {} };
  const prefs = Object.assign({ on: true, endpoint: 'http://api.test', deviceKey: 'shared-key-1', label: 'Rig phone' }, over.prefs || {});
  const rig = { seq: 0, conflicts: [], tombstoned: [], savedVersions: [] };
  let n = 0;
  const deps = {
    B: B, modelId: 'palmnet-r3-ep12', appVersion: 'v62',
    getPrefs: function () { return prefs; },
    loadOutbox: function () { return Promise.resolve(store.outbox); },
    saveOutbox: function (items) { store.outbox = items; return Promise.resolve(); },
    fetchFn: over.fetchFn,
    now: function () { return 1764000000000; },
    uuid: function () { return 'uuid-' + (++n); },
    onStatus: function () {},
    loadVersions: function () { return Promise.resolve(JSON.parse(JSON.stringify(store.versions))); },
    saveVersions: function (v) { store.versions = v; rig.savedVersions.push(JSON.parse(JSON.stringify(v))); },
    getSeq: function () { return rig.seq; },
    setSeq: function (s) { rig.seq = s; },
    saveCredential: function (id, secret) { prefs.deviceId = id; prefs.deviceSecret = secret; },
    signRequest: function (secret, deviceId, seq, method, p, body) {
      return Promise.resolve(apiCanonical.signRequest(secret, deviceId, seq, method, p, body));
    },
    applyTombstone: function (biomId) { rig.tombstoned.push(biomId); return Promise.resolve(); },
    onProfileConflict: function (biomId, body) { rig.conflicts.push({ biomId: biomId, body: body }); }
  };
  if (over.noV62Deps) {
    delete deps.loadVersions; delete deps.saveVersions; delete deps.getSeq; delete deps.setSeq;
    delete deps.saveCredential; delete deps.signRequest; delete deps.applyTombstone; delete deps.onProfileConflict;
  }
  return { engine: createBiomSync(deps), store: store, prefs: prefs, rig: rig };
}

async function engineTests() {
  /* the pinned cross-implementation signing vector */
  const vecBody = { id: 'vec-1', ts: 1764000000000, kind: 'verify', edccScore: 0.5 };
  const apiSig = apiCanonical.signRequest('vector-secret', 'dev-vector', 7, 'POST', '/api/scans', vecBody);
  const appSig = await signer.sign('vector-secret', 'dev-vector', 7, 'POST', '/api/scans', vecBody);
  check('SIGNER the app signer and the API canonical module produce the SAME signature',
    appSig === apiSig, String(appSig).slice(0, 16) + '…');
  check('SIGNER the pinned vector holds (any canonicalisation drift breaks this)',
    apiSig === 'd93bd2611f7316247aa0a217e1d3bde25277da10c76bf65f48ee9a7a178e1c44', apiSig);
  check('SIGNER canonical JSON sorts keys recursively',
    signer.canon({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } }) === '{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');

  /* bootstrap: legacy prefs register once, then sign */
  const calls = [];
  let m = makeEngine({
    fetchFn: function (url, opts) {
      calls.push({ url: url, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null });
      if (url.endsWith('/api/devices')) return Promise.resolve(jsonRes(201, { deviceId: 'dev-rig1', deviceKey: 'secret-rig1' }));
      return Promise.resolve(jsonRes(201, { ok: true, version: 1 }));
    }
  });
  m.engine.noteScan({ kind: 'verify', profileName: 'Rig Person', biomId: 'TSG-BIO-9', hand: 'left', edccScore: 0.5, palmnetScore: 0.9, result: 'Verified' });
  await tick();
  await m.engine.flush();
  check('BOOTSTRAP the first flush registers the device BEFORE posting',
    calls.length === 2 && calls[0].url.endsWith('/api/devices') && calls[1].url.endsWith('/api/scans'),
    calls.map(function (c) { return c.url.split('/').pop(); }).join(','));
  check('BOOTSTRAP the registration used the shared key as a header, never in a body',
    calls[0].headers['x-device-key'] === 'shared-key-1' && JSON.stringify(calls[0].body).indexOf('shared-key-1') === -1);
  check('BOOTSTRAP the credential is stored and the scan went out signed, seq 1',
    m.prefs.deviceId === 'dev-rig1' && calls[1].headers['x-device-id'] === 'dev-rig1' &&
    calls[1].headers['x-device-seq'] === '1' && typeof calls[1].headers['x-device-sig'] === 'string' && m.rig.seq === 1);
  const callsBefore = calls.length;
  m.engine.noteScan({ kind: 'verify', result: 'Verified' });
  await tick();
  await m.engine.flush();
  check('BOOTSTRAP registration happens ONCE — the next flush just posts, seq 2',
    calls.length === callsBefore + 1 && calls[calls.length - 1].headers['x-device-seq'] === '2');

  /* CAS: baseVersion at send time, ack stored, 409 handled */
  const casCalls = [];
  let casStage = 0;
  let releaseCas1 = null;
  m = makeEngine({
    prefs: { deviceId: 'dev-cas', deviceSecret: 'secret-cas', deviceKey: '' },
    fetchFn: function (url, opts) {
      casCalls.push({ url: url, body: JSON.parse(opts.body) });
      casStage++;
      /* v88 PIN CHANGE (named): instant sync fires the first
         write at creation, so the rig holds that first response
         pending while it inspects the still-queued item — the
         assertion (posted body carries baseVersion, the queued
         item itself does not) is unchanged. */
      if (casStage === 1) return new Promise(function (r) { releaseCas1 = function () { r(jsonRes(201, { ok: true, biomId: 'TSG-BIO-9', version: 1 })); }; });
      if (casStage === 2) return Promise.resolve(jsonRes(409, { error: 'version conflict', currentVersion: 5 }));
      return Promise.resolve(jsonRes(201, { ok: true, biomId: 'TSG-BIO-9', version: 6 }));
    }
  });
  m.engine.noteProfile(PERSON);
  await tick();
  const queuedItem = m.store.outbox[0];
  if (releaseCas1) releaseCas1();
  await tick();
  await m.engine.flush();
  check('CAS the first profile write carries baseVersion 0 (queued item itself unchanged)',
    casCalls[0].body.baseVersion === 0 && !!queuedItem && !('baseVersion' in queuedItem.record));
  check('CAS the acknowledged version is stored for the next write',
    m.store.versions['TSG-BIO-9'] === 1, JSON.stringify(m.store.versions));
  m.engine.noteProfile(PERSON);
  await tick();
  await m.engine.flush();
  check('CAS the second write bases on version 1, meets the 409, and the item is DROPPED (no overwrite, no loop)',
    casCalls[1].body.baseVersion === 1 && m.engine.state().queued === 0);
  check('CAS the conflict adopts the server version and surfaces through the callback + status',
    m.store.versions['TSG-BIO-9'] === 5 && m.rig.conflicts.length === 1 &&
    m.engine.statusText().indexOf('Bank changed on another device') !== -1, m.engine.statusText());
  m.engine.noteProfile(PERSON);
  await tick();
  await m.engine.flush();
  check('CAS the next write bases on the adopted version 5 and lands',
    casCalls[2].body.baseVersion === 5 && m.store.versions['TSG-BIO-9'] === 6);

  /* revoked: 403 latches, status is honest, no retry storm */
  let revCalls = 0;
  m = makeEngine({
    prefs: { deviceId: 'dev-rev', deviceSecret: 'secret-rev', deviceKey: '' },
    fetchFn: function () { revCalls++; return Promise.resolve(jsonRes(403, { error: 'device revoked', revoked: true })); }
  });
  m.engine.noteScan({ kind: 'verify', result: 'Verified' });
  await tick();
  await m.engine.flush();
  await m.engine.flush();
  check('REVOKED a 403 latches the revoked state and stops all further attempts',
    m.engine.state().revoked === true && revCalls === 1 && m.engine.state().queued === 1);
  check('REVOKED the status line says the device was revoked, in plain words',
    m.engine.statusText().indexOf('revoked') !== -1, m.engine.statusText());
  const tc = await m.engine.testConnection();
  check('REVOKED testConnection also reports the revocation honestly',
    tc.ok === false && tc.message.indexOf('revoked') !== -1, tc.message);

  /* desync: one automatic re-registration, then the item lands */
  const desyncCalls = [];
  let desyncStage = 0;
  m = makeEngine({
    prefs: { deviceId: 'dev-old', deviceSecret: 'secret-old', deviceKey: 'shared-key-1' },
    fetchFn: function (url, opts) {
      desyncCalls.push(url.split('/api/')[1]);
      desyncStage++;
      if (url.endsWith('/api/devices')) return Promise.resolve(jsonRes(201, { deviceId: 'dev-new', deviceKey: 'secret-new' }));
      if (desyncStage === 1) return Promise.resolve(jsonRes(401, { error: 'request sequence out of step', code: 'SEQ_DESYNC' }));
      return Promise.resolve(jsonRes(201, { ok: true }));
    }
  });
  m.engine.noteScan({ kind: 'verify', result: 'Verified' });
  await tick();
  await m.engine.flush();
  check('DESYNC a sequence desync triggers ONE re-registration and the item still lands',
    deepEq(desyncCalls, ['scans', 'devices', 'scans']) && m.engine.state().queued === 0 && m.prefs.deviceId === 'dev-new',
    desyncCalls.join(','));
  check('DESYNC the fresh credential restarts the sequence at 1', m.rig.seq === 1);

  /* desync with no recovery: the latch is honest */
  m = makeEngine({
    prefs: { deviceId: 'dev-old', deviceSecret: 'secret-old', deviceKey: 'shared-key-1' },
    fetchFn: function (url) {
      if (url.endsWith('/api/devices')) return Promise.resolve(jsonRes(401, { error: 'unauthorised' }));
      return Promise.resolve(jsonRes(401, { error: 'request sequence out of step', code: 'SEQ_DESYNC' }));
    }
  });
  m.engine.noteScan({ kind: 'verify', result: 'Verified' });
  await tick();
  await m.engine.flush();
  check('DESYNC when re-registration fails the engine latches the re-registering state',
    m.engine.state().seqDesync === true && m.engine.statusText().indexOf('re-registering') !== -1, m.engine.statusText());

  /* 429: backoff, never a latch */
  m = makeEngine({
    prefs: { deviceId: 'dev-rl', deviceSecret: 'secret-rl', deviceKey: '' },
    fetchFn: function () { return Promise.resolve(jsonRes(429, { error: 'rate limited', retryAfter: 5 }, { 'Retry-After': '5' })); }
  });
  m.engine.noteScan({ kind: 'verify', result: 'Verified' });
  await tick();
  const st429 = await m.engine.flush();
  check('RATE a 429 keeps the item queued, latches nothing, and says rate-limiting',
    st429.queued === 1 && st429.keyRejected === false && st429.revoked === false &&
    m.engine.statusText().indexOf('rate-limiting') !== -1, m.engine.statusText());

  /* tombstones: queue + send, and the pull applies a remote one */
  const tombCalls = [];
  m = makeEngine({
    prefs: { deviceId: 'dev-tomb', deviceSecret: 'secret-tomb', deviceKey: '' },
    fetchFn: function (url, opts) {
      tombCalls.push({ url: url, body: opts.body ? JSON.parse(opts.body) : null });
      if (url.indexOf('summary=1') !== -1) {
        return Promise.resolve(jsonRes(200, { ok: true, count: 1, profiles: [{ biomId: 'TSG-BIO-REMOTE', name: '', hand: null, neuralModel: '', edccCount: 0, neuralCount: 0, enc: null, version: 3, deleted: true, deletedTs: 1764001000000, updatedTs: 1764001000000, ownerDeviceId: 'dev-other' }] }));
      }
      return Promise.resolve(jsonRes(201, { ok: true, biomId: 'TSG-BIO-9', version: 2 }));
    }
  });
  m.store.versions['TSG-BIO-9'] = 1;
  const queuedN = await m.engine.queueTombstones([PERSON]);
  await m.engine.flush();
  const tombPost = tombCalls.filter(function (c) { return c.url.endsWith('/api/profiles'); })[0];
  check('TOMBSTONE the wipe queues one tombstone per banked person and posts it as a versioned deletion',
    queuedN === 1 && !!tombPost && tombPost.body.deleted === true && tombPost.body.baseVersion === 1 && !('edccCodes' in tombPost.body),
    JSON.stringify(tombPost && tombPost.body));
  await m.engine.pull();
  check('TOMBSTONE the pull applies a newer remote tombstone (the second-device half of the round trip)',
    deepEq(m.rig.tombstoned, ['TSG-BIO-REMOTE']) && m.store.versions['TSG-BIO-REMOTE'] === 3);
  await m.engine.pull();
  check('TOMBSTONE the same tombstone is not applied twice', m.rig.tombstoned.length === 1);

  /* no v62 deps: the v56 behaviour, byte for byte */
  const legacyCalls = [];
  m = makeEngine({
    noV62Deps: true,
    fetchFn: function (url, opts) { legacyCalls.push({ url: url, headers: opts.headers, body: JSON.parse(opts.body) }); return Promise.resolve({ status: 201 }); }
  });
  m.engine.noteProfile(PERSON);
  await tick();
  await m.engine.flush();
  check('LEGACY without the v62 deps the engine sends the shared key only, no baseVersion, no signing headers',
    legacyCalls.length === 1 && legacyCalls[0].headers['x-device-key'] === 'shared-key-1' &&
    !('x-device-id' in legacyCalls[0].headers) && !('baseVersion' in legacyCalls[0].body) &&
    deepEq(legacyCalls[0].body, B.syncProfileRecord(PERSON, 1764000000000)));
}

/* ---------------- source pins ---------------------------------- */
(function () {
  /* v63 PIN CHANGE (named openly): the shared-key field and
     its toggle are removed — registration is automatic via the
     built-in registration-only key, and the card says so. The
     device credential fields, the secret toggle, the test
     button and the result line stay. */
  check('UI the settings card carries the credential fields, the secret toggle, test button and result line (v63 named pin change)',
    htmlSrc.indexOf('id="syncDeviceId"') !== -1 && htmlSrc.indexOf('id="syncDeviceSecret" type="password"') !== -1 &&
    htmlSrc.indexOf('id="syncDeviceKeyToggle"') === -1 && htmlSrc.indexOf('id="syncDeviceSecretToggle"') !== -1 &&
    htmlSrc.indexOf('id="syncTestBtn"') !== -1 && htmlSrc.indexOf('id="syncTestResult"') !== -1);
  check('UI registration is automatic and the card says so honestly (v63 named pin change)',
    htmlSrc.indexOf('Shared key (registration only)') === -1 &&
    htmlSrc.indexOf('registration key') !== -1 && htmlSrc.indexOf('On by default from v63') !== -1);
  check('WIRING the pull runs at boot after the flush, and Sync now pulls too',
    appSrc.indexOf('Sync.pull()') !== -1 && appSrc.indexOf("DB.getMeta('syncVersions', {})") !== -1);
  check('WIRING DB.remove exists for the pull (key-only removal, both backends)',
    appSrc.indexOf('remove: function (store, id)') !== -1);
  check('WIPE the wipe queues tombstones, keeps pending ones + prefs, and says which outcome happened',
    appSrc.indexOf('Sync.queueTombstones(banked)') !== -1 &&
    appSrc.indexOf("it.type === 'tombstone'") !== -1 &&
    appSrc.indexOf('complete on the next sync') !== -1 &&
    appSrc.indexOf('marked deleted there too') !== -1 &&
    appSrc.indexOf("'biomSyncDeviceId', 'biomSyncDeviceSecret', 'biomSyncSeq'") !== -1);
  check('COPY no surface promises a PIN flow any more (PIN deferred by the Chairman)',
    appSrc.indexOf('PIN confirmation is required') === -1 && htmlSrc.indexOf('PIN confirmation is required') === -1 &&
    htmlSrc.indexOf('it is refused. Leave blank for no limit.') !== -1 &&
    appSrc.indexOf('Payments above the limit are not created.') !== -1 &&
    appSrc.indexOf('not created on palm alone — it is refused.') !== -1);
  check('COPY the wipe card states the tombstone behaviour',
    htmlSrc.indexOf('marks this device\'s palm banks deleted on your TSG Biom server') !== -1);
})();

(async function () {
  await engineTests();
  console.log('\n' + (fail === 0 ? 'ALL v62 SERVER-TRUST TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed'));
  process.exit(fail === 0 ? 0 : 1);
})();
