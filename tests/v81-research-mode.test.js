/* TSG BIOM v81 — SIMULATION / RESEARCH MODE, APP LEG (the
   Chairman's own design, 2026-11-27: collect real scan photos
   from real registrations and scans, with explicit opt-in
   consent as the non-negotiable condition, so the TSG own
   detector can be judged on real data).

   The release-blocking guarantees pinned here:
   (a) NO CONSENT → ZERO FRAMES: with consent off or undecided,
       the Research module's tap is a strict no-op (not even a
       canvas is created), attach queues nothing, and the sync
       engine refuses a bundle whose consent flag is not true.
   (b) CONSENT ON → frames the pipeline consumed are buffered
       (bounded: at most 3, spaced, downscaled, expiring) and
       packaged against the scan's own kind/result, linked only
       to the anonymous research ID — the bundle carries no
       name, no phone, no Biom ID.
   (c) the engine queues bundles as their own item type to the
       research endpoint, and a server refusal on the merits
       (400/409/413) drops the bundle instead of wedging the
       queue. (The server-side refusal itself is pinned in the
       API's v81 suite.)
   (d) WITHDRAWAL: dropResearch clears every queued bundle and
       leaves scan/profile items untouched; the wiring pins show
       the Settings path clears the live buffer too.
   (e) TIMING: taps sit outside the analysis call in every scan
       loop, encoding happens in attach (post-verdict), and the
       module's own overhead measures in microseconds.

   Plus: version coherence at v81, the v81 migration step as a
   pure adoption, the frozen bars, and the consent-UI wiring.

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
function finish() {
  console.log(fail === 0 ? 'ALL V81 RESEARCH-MODE TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
}
const tick = function () { return new Promise(function (r) { setImmediate(r); }); };

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

/* ---------- version coherence + identity migration -------------- */
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v95',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v95' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v95'") !== -1 &&
  htmlSrc.indexOf('<meta name="biom-build" content="v95">') !== -1 &&
  htmlSrc.indexOf('TSG Biom · App v95 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v95' &&
  B.BIOM_DATA_VERSIONS.length === 59);
check('MIGRATION the v81 step is a pure adoption: a v80 store opens byte-identical at v81', (function () {
  const before = JSON.stringify({ people: [{ id: 'TSG-BIO-1', name: 'Gate', wallet: { balance: 5, statement: [], linkedAccounts: [] } }], logs: [], transactions: [], meta: [{ k: 'syncBlockedIds', v: 1 }] });
  const mig = B.migrateBiomData(JSON.parse(before), 'v80', 'v81');
  return mig.appliedSteps.join(',') === 'v81' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
})());
check('FREEZE the shipped bars are untouched (EDCC 0.32 / PalmNet 0.5895) and the strict money margins stand',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895 &&
  B.MONEY_MARGIN_EDCC === 0.10 && B.MONEY_MARGIN_NEURAL === 0.15);

/* ---------- the Research module, extracted and driven ----------- */
const researchSrc = appSrc.slice(appSrc.indexOf('/* RESEARCH-ENGINE-BEGIN'), appSrc.indexOf('/* RESEARCH-ENGINE-END */'));
check('MODULE createBiomResearch is extractable from app.js', researchSrc.indexOf('function createBiomResearch') !== -1);
const createBiomResearch = new Function(researchSrc + '\nreturn createBiomResearch;')();

function fakeCanvas(w, h) {
  return {
    width: w, height: h,
    getContext: function () { return { drawImage: function () {} }; },
    toDataURL: function (type) {
      if (type !== 'image/jpeg') throw new Error('wrong type');
      return 'data:image/jpeg;base64,QUJD';
    }
  };
}
function makeResearch(over) {
  over = over || {};
  const state = {
    consent: over.consent || 'off',
    blocked: !!over.blocked,
    canvases: 0,
    bundles: [],
    clock: over.clock || 1000000
  };
  const mod = createBiomResearch({
    getConsent: function () { return state.consent; },
    getResearchId: function () { return 'res-rig0000000000000000001'; },
    queueBundle: function (b) { state.bundles.push(b); return true; },
    isBlocked: function () { return state.blocked; },
    subjectAllowed: over.subjectAllowed || function () { return true; },
    deviceClass: function () { return 'android-phone Rig'; },
    makeCanvas: function (w, h) { state.canvases++; return fakeCanvas(w, h); },
    now: function () { return state.clock; }
  });
  return { mod: mod, state: state };
}
const SRC_FRAME = { width: 1280, height: 960 };

/* (a) no consent → zero frames */
(function () {
  const off = makeResearch({ consent: 'off' });
  check('(a) OFF: tapFrame is a strict no-op — returns false and creates no canvas',
    off.mod.tapFrame(SRC_FRAME) === false && off.state.canvases === 0 && off.mod.pendingFrames() === 0);
  check('(a) OFF: attach queues nothing',
    off.mod.attach({ kind: 'verify', result: 'Verified' }) === false && off.state.bundles.length === 0);
  const unset = makeResearch({ consent: 'unset' });
  check('(a) UNDECIDED: treated exactly as off — no tap, no attach, no canvas',
    unset.mod.tapFrame(SRC_FRAME) === false && unset.mod.attach({ kind: 'enrol', result: 'Registered' }) === false &&
    unset.state.canvases === 0 && unset.state.bundles.length === 0);
  const weird = makeResearch({ consent: 'yes' });
  check('(a) any consent value other than the affirmative "on" collects nothing',
    weird.mod.tapFrame(SRC_FRAME) === false && weird.state.canvases === 0);
})();

/* (b) consent on → bounded capture, tagged bundle, anonymous link */
(function () {
  const r = makeResearch({ consent: 'on' });
  const t0 = r.state.clock;
  check('(b) ON: first tap accepted', r.mod.tapFrame(SRC_FRAME) === true);
  r.state.clock = t0 + 100;
  check('(b) taps closer than the 250 ms spacing are refused (no near-duplicate frames)',
    r.mod.tapFrame(SRC_FRAME) === false && r.mod.pendingFrames() === 1);
  r.state.clock = t0 + 300;
  check('(b) second spaced tap accepted', r.mod.tapFrame(SRC_FRAME) === true);
  r.state.clock = t0 + 600;
  check('(b) third spaced tap accepted', r.mod.tapFrame(SRC_FRAME) === true);
  r.state.clock = t0 + 1000;
  check('(b) the buffer is bounded at 3 frames per scan', r.mod.tapFrame(SRC_FRAME) === false && r.mod.pendingFrames() === 3);
  check('(b) attach queues exactly one bundle', r.mod.attach({ kind: 'verify', result: 'Verified' }) === true && r.state.bundles.length === 1);
  const b = r.state.bundles[0];
  check('(b) the bundle carries consent, kind, result, field-test flag, device class and the anonymous research ID only',
    b.consent === true && b.kind === 'verify' && b.result === 'Verified' && b.fieldTest === false &&
    b.deviceClass === 'android-phone Rig' && b.researchId === 'res-rig0000000000000000001' &&
    !('biomId' in b) && !('name' in b) && !('phone' in b) && !('wallet' in b));
  check('(b) the bundle frames are JPEG data URLs, 3 of them, downscaled to at most 480 px',
    b.frames.length === 3 && b.frames.every(function (f) {
      return f.data.indexOf('data:image/jpeg;base64,') === 0 && f.w <= 480 && f.h <= 480;
    }));
  check('(b) attach clears the buffer — a second attach without new taps queues nothing',
    r.mod.attach({ kind: 'verify', result: 'Verified' }) === false && r.state.bundles.length === 1);
})();

/* (b2) the safety exclusions: blocked account, blocked verdict, staleness */
(function () {
  const blocked = makeResearch({ consent: 'on', blocked: true });
  blocked.mod.tapFrame(SRC_FRAME);
  check('(b) a BLOCKED account collects nothing even with consent on',
    blocked.mod.attach({ kind: 'verify', result: 'Denied' }) === false && blocked.state.bundles.length === 0);
  const verdict = makeResearch({ consent: 'on' });
  verdict.mod.tapFrame(SRC_FRAME);
  check('(b) a blocked VERDICT record collects nothing',
    verdict.mod.attach({ kind: 'terminal', result: 'Blocked — palm scanning is blocked' }) === false && verdict.state.bundles.length === 0);
  const stale = makeResearch({ consent: 'on' });
  stale.mod.tapFrame(SRC_FRAME);
  stale.state.clock += 46000;
  check('(b) frames older than the 45 s buffer life never ride a later scan',
    stale.mod.attach({ kind: 'verify', result: 'Verified' }) === false && stale.state.bundles.length === 0);
  const ft = makeResearch({ consent: 'on' });
  ft.mod.tapFrame(SRC_FRAME);
  ft.mod.attach({ kind: 'verify', result: 'Verified', fieldTest: true });
  check('(b) Field Test Mode scans follow the same consent rule and carry the flag',
    ft.state.bundles.length === 1 && ft.state.bundles[0].fieldTest === true);
})();

/* (b3) seat-fix: the subject rule — only the consenting user's
   OWN palm is ever collected */
(function () {
  const other = makeResearch({ consent: 'on', subjectAllowed: function () { return false; } });
  other.mod.tapFrame(SRC_FRAME);
  check('(b) SEAT-FIX a scan whose subject is not the device user collects nothing (terminal customer, third party)',
    other.mod.attach({ kind: 'identify', result: 'Verified', biomId: 'TSG-BIO-OTHER' }) === false && other.state.bundles.length === 0);
  const noDep = createBiomResearch({
    getConsent: function () { return 'on'; },
    getResearchId: function () { return 'res-rig0000000000000000001'; },
    queueBundle: function () { return true; },
    isBlocked: function () { return false; },
    deviceClass: function () { return 'android-phone'; },
    makeCanvas: function (w, h) { return fakeCanvas(w, h); },
    now: function () { return 1000000; }
  });
  noDep.tapFrame(SRC_FRAME);
  check('(b) SEAT-FIX without the subject dep the module fails CLOSED',
    noDep.attach({ kind: 'verify', result: 'Verified', biomId: 'TSG-BIO-SELF' }) === false);
})();

/* (e) timing: the module's own overhead */
(function () {
  const r = makeResearch({ consent: 'on' });
  const t0 = Date.now();
  for (let i = 0; i < 300; i++) {
    r.state.clock += 300;
    r.mod.tapFrame(SRC_FRAME); r.mod.tapFrame(SRC_FRAME); r.mod.tapFrame(SRC_FRAME);
    r.mod.attach({ kind: 'verify', result: 'Verified' });
  }
  const per = (Date.now() - t0) / 300;
  check('(e) module overhead per scan (3 taps + attach, fake canvas) is under 1 ms', per < 1, per.toFixed(3) + ' ms');
  check('(e) taps sit OUTSIDE the analysis call in both stream steps (tap after analyse resolves)',
    appSrc.indexOf('if (r.pose) { handFrames++; Research.tapFrame(frame); }') !== -1 &&
    appSrc.indexOf('poses.shift(); Research.tapFrame(frame); }') !== -1);
  check('(e) the enrolment burst taps the frame it already captured (no extra capture)',
    /* v82 PIN CHANGE (named openly): the burst grab now also
       enqueues the same captured frame for its overlapped
       analysis (the Chairman's method order, 2026-11-27
       22:49) — the tap still rides the very frame that was
       captured, and no extra capture was added. */
    appSrc.indexOf('if (f) { frames.push(f); Research.tapFrame(f); enqueue(f, frames.length - 1); }') !== -1);
})();

/* ---------- the sync engine: noteResearch / dropResearch -------- */
const engineSrc = appSrc.slice(appSrc.indexOf('/* SYNC-ENGINE-BEGIN'), appSrc.indexOf('/* SYNC-ENGINE-END */'));
const createBiomSync = new Function(engineSrc + '\nreturn createBiomSync;')();
function makeEngine(over) {
  over = over || {};
  const store = { outbox: [] };
  const calls = [];
  let seq = 0;
  const engine = createBiomSync({
    B: B, modelId: 'palmnet-r3-ep12', appVersion: 'v81',
    getPrefs: function () { return { on: true, endpoint: 'http://api.test', deviceKey: 'device-key-1', label: 'Rig' }; },
    loadOutbox: function () { return Promise.resolve(store.outbox); },
    saveOutbox: function (items) { store.outbox = items; return Promise.resolve(); },
    fetchFn: over.fetchFn || function (url) { calls.push(url); return Promise.resolve({ status: 201, json: function () { return Promise.resolve({}); } }); },
    researchConsentOn: over.researchConsentOn,
    now: function () { return 1764000000000; },
    uuid: function () { return 'uuid-' + (++seq); },
    onStatus: function () {}
  });
  return { engine: engine, store: store, calls: calls };
}
const GOOD_BUNDLE = {
  researchId: 'res-rig0000000000000000001', consent: true, kind: 'verify', result: 'Verified',
  fieldTest: false, deviceClass: 'android-phone Rig', ts: 1764000000000,
  frames: [{ data: 'data:image/jpeg;base64,QUJD', w: 480, h: 360 }]
};

(async function () {
  /* (a) engine-level: a bundle without the consent flag is refused */
  {
    const rig = makeEngine();
    const noConsent = Object.assign({}, GOOD_BUNDLE, { consent: false });
    check('(a) ENGINE: noteResearch refuses a bundle whose consent flag is not true',
      rig.engine.noteResearch(noConsent) === false);
    const noFlag = Object.assign({}, GOOD_BUNDLE); delete noFlag.consent;
    check('(a) ENGINE: noteResearch refuses a bundle with no consent flag at all',
      rig.engine.noteResearch(noFlag) === false);
    await tick(); await tick();
    check('(a) ENGINE: nothing was queued', rig.store.outbox.length === 0);
  }
  /* (b)+(c) engine-level: queue, flush to the research endpoint.
     v88 PIN CHANGE (named): instant sync fires the flush at
     creation, so this rig holds the research response pending
     while it inspects the queued item, then releases it — the
     assertions (own item type, no PII in the record, posts to
     /api/research/frames, drains on 201) are unchanged. */
  {
    const bCalls = [];
    let releaseB = null;
    const rig = makeEngine({ fetchFn: function (url) {
      bCalls.push(url);
      return new Promise(function (r) { releaseB = function () { r({ status: 201, json: function () { return Promise.resolve({}); } }); }; });
    } });
    check('(b) ENGINE: a consented bundle is accepted', rig.engine.noteResearch(GOOD_BUNDLE) === true);
    await tick(); await tick();
    check('(b) ENGINE: it queues as its own item type', rig.store.outbox.length === 1 && rig.store.outbox[0].type === 'research');
    const rec = rig.store.outbox[0].record;
    check('(b) ENGINE: the queued record carries no name, phone or Biom ID',
      !('biomId' in rec) && !('name' in rec) && !('phone' in rec) && rec.researchId === GOOD_BUNDLE.researchId && rec.consent === true);
    check('(b) SEAT-FIX the queued record carries no device label (a label can hold a name or number)',
      !('deviceLabel' in rec));
    if (releaseB) releaseB();
    await tick(); await tick();
    await rig.engine.flush();
    check('(c) ENGINE: the flush posts to /api/research/frames and the queue drains on 201',
      bCalls.length === 1 && bCalls[0] === 'http://api.test/api/research/frames' && rig.store.outbox.length === 0);
  }
  /* (c) a merits refusal drops the bundle instead of wedging the queue */
  {
    const rig = makeEngine({ fetchFn: function (url) {
      const refuse = String(url).indexOf('/api/research/') !== -1;
      return Promise.resolve({ status: refuse ? 400 : 201, json: function () { return Promise.resolve(refuse ? { error: 'consent flag required' } : {}); } });
    } });
    rig.engine.noteResearch(GOOD_BUNDLE);
    rig.engine.noteScan({ kind: 'verify', biomId: 'TSG-BIO-RIG', result: 'Verified' });
    await tick(); await tick();
    await rig.engine.flush();
    check('(c) ENGINE: a 400 refusal drops the research bundle and the scan behind it still lands',
      rig.store.outbox.length === 0);
  }
  /* queue bound */
  {
    const rig = makeEngine({ fetchFn: function () { return new Promise(function () {}); } });
    for (let i = 0; i < 30; i++) { rig.engine.noteResearch(GOOD_BUNDLE); await tick(); }
    const held = rig.store.outbox.filter(function (it) { return it.type === 'research'; });
    check('BOUND: the outbox holds at most 24 research bundles (oldest dropped)',
      held.length === 24, 'held=' + held.length);
  }
  /* (d) withdrawal clears the queue, scans untouched.
     v88 PIN CHANGE (named): the fetch hangs, as in the BOUND
     block above — with instant sync a resolving fetch would
     drain the queue at creation, before the withdrawal could
     be tested against it. The assertion is unchanged. */
  {
    const rig = makeEngine({ fetchFn: function () { return new Promise(function () {}); } });
    rig.engine.noteResearch(GOOD_BUNDLE);
    rig.engine.noteResearch(GOOD_BUNDLE);
    rig.engine.noteScan({ kind: 'verify', biomId: 'TSG-BIO-RIG', result: 'Verified' });
    await tick(); await tick();
    const removed = await rig.engine.dropResearch();
    const types = rig.store.outbox.map(function (it) { return it.type; });
    check('(d) dropResearch removes every queued bundle and only those',
      removed === 2 && types.join(',') === 'scan', 'removed=' + removed + ' left=' + types.join(','));
  }

  /* (d2) seat-fix: consent re-checked at SEND time — a bundle
     queued while consent was on is dropped, not sent, after a
     withdrawal; scans behind it still land */
  {
    const rig = makeEngine({ researchConsentOn: function () { return false; } });
    rig.engine.noteResearch(GOOD_BUNDLE);
    rig.engine.noteScan({ kind: 'verify', biomId: 'TSG-BIO-RIG', result: 'Verified' });
    await tick(); await tick();
    await rig.engine.flush();
    check('(d) SEAT-FIX with consent off at send time the bundle is dropped and the scan still lands',
      rig.store.outbox.length === 0 && rig.calls.length === 1 && rig.calls[0] === 'http://api.test/api/scans');
  }

  /* ---------- wiring pins ---------------------------------------- */
  check('WIRE every noted scan closes the research buffer for that scan (noteScan wrapper)',
    appSrc.indexOf('Sync.noteScan = function (fields)') !== -1 && appSrc.indexOf('Research.attach(fields)') !== -1);
  check('WIRE consent state is a device pref, undecided by absence, and only "1" is on',
    appSrc.indexOf("syncPrefGet('biomResearchConsent')") !== -1 &&
    appSrc.indexOf("return v === '1' ? 'on' : v === '0' ? 'off' : 'unset';") !== -1);
  check('WIRE the anonymous research ID is generated on device at first opt-in',
    appSrc.indexOf("'res-' + syncUuid()") !== -1 && appSrc.indexOf("syncPrefSet('biomResearchId'") !== -1);
  check('WIRE withdrawal clears the live buffer AND the queued bundles in one place',
    appSrc.indexOf('Research.clearBuffer();') !== -1 && appSrc.indexOf('Sync.dropResearch();') !== -1);
  check('WIRE the consent notice is offered on scan surfaces only while undecided',
    appSrc.indexOf("researchConsentState() === 'unset') showResearchConsent()") !== -1);
  check('WIRE the overlay exists with both answers and the Bangla notice',
    htmlSrc.indexOf('id="researchConsent"') !== -1 && htmlSrc.indexOf('id="researchAgreeBtn"') !== -1 &&
    htmlSrc.indexOf('id="researchDeclineBtn"') !== -1 && htmlSrc.indexOf('lang="bn"') !== -1);
  check('WIRE Settings and More both carry the standing toggle, status and research code',
    htmlSrc.indexOf('id="researchConsentToggle"') !== -1 && htmlSrc.indexOf('id="researchConsentToggle2"') !== -1 &&
    htmlSrc.indexOf('id="researchStatus"') !== -1 && htmlSrc.indexOf('id="researchIdLine"') !== -1);
  check('WIRE the bundle the module builds names no identity field (source pin)',
    researchSrc.indexOf('biomId') === -1 && researchSrc.indexOf('phone') === -1 && researchSrc.indexOf('wallet') === -1);
  check('WIRE SEAT-FIX the subject rule is wired (own session, self-registration only)',
    appSrc.indexOf('subjectAllowed: function (fields)') !== -1 &&
    appSrc.indexOf("fields.kind === 'enrol'") !== -1 &&
    appSrc.indexOf('fields.biomId === me.id') !== -1);
  check('WIRE SEAT-FIX the research buffer is cleared at navigation and at capture start (no cross-scan bleed)',
    appSrc.indexOf('navigation is a research-buffer boundary') !== -1 &&
    appSrc.indexOf("Research.clearBuffer(); // v81 (seat-fix): a fresh capture starts") !== -1 &&
    (appSrc.match(/Research\.clearBuffer\(\);/g) || []).length >= 3);
  check('WIRE SEAT-FIX the device class is platform + form factor only (no handset model)',
    appSrc.slice(appSrc.indexOf('function researchDeviceClass'), appSrc.indexOf('var Research =')).indexOf("return os + '-' + cls;") !== -1 &&
    appSrc.slice(appSrc.indexOf('function researchDeviceClass'), appSrc.indexOf('var Research =')).indexOf('ua.match') === -1);
  check('WIRE SEAT-FIX re-opting in after a withdrawal mints a fresh research id',
    appSrc.indexOf("researchConsentState() === 'off' || !syncPrefGet('biomResearchId')") !== -1);
  check('WIRE SEAT-FIX the engine is wired with the send-time consent re-check',
    appSrc.indexOf('researchConsentOn: function () { return researchConsentState()') !== -1);

  finish();
})().catch(function (e) { console.log('FAIL  suite error: ' + (e && e.stack || e)); process.exit(1); });
