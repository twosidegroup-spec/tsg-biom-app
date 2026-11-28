/* TSG BIOM v88 — PHASES 3+4: INSTANT SYNC + WORLD-CLASS UI REFRESH.

   Phase 4 (the Chairman's words: "যখন আমি স্ক্যান করবো, ইনস্ট্যান্ট
   সিঙ্ক করায় দিবা" — the moment a scan completes, its record goes
   to the server immediately):
   - a flush attempt fires AT RECORD CREATION for every queueable
     record kind (scan kinds incl. verify / money-auth / topup,
     profile, research) — no 900 ms debounce, no later event;
   - a same-tick burst coalesces into the running flush and every
     record is still sent;
   - `online` and visibility-return flush the outbox (engine
     onOnline / onVisible, wired to the real events in app.js);
   - a network failure schedules a REAL retry with exponential
     backoff (5 s, 10 s, … cap 300 s) — the pre-v88 code set
     lastError 'network unreachable — will retry' and scheduled
     nothing; this suite watches the retry timer actually fire;
   - 429 keeps its server-directed Retry-After behaviour;
   - the blocked-ID drop is FROZEN (v79): a 403 {blocked:true}
     still drops the item and latches — and now the indicator
     NAMES the blocked state instead of dying silently;
   - Sync.indicator() renders the honest states: synced /
     pending / offline / latched-error (with a next step).

   Phase 3 pins: the §K token layer in styles.css, the persistent
   #syncIndicator on the record-creating surfaces, the nav Scan
   emphasis, and v88 version coherence.

   All numbers are RIG numbers (stub fetch, stub deps); the phone
   is the verdict. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 40); }); }

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const engineSrc = appSrc.slice(appSrc.indexOf('/* SYNC-ENGINE-BEGIN'), appSrc.indexOf('/* SYNC-ENGINE-END */'));
check('ENGINE createBiomSync is extractable from app.js', engineSrc.indexOf('function createBiomSync') !== -1);
const createBiomSync = new Function(engineSrc + '\nreturn createBiomSync;')();

function res(status, body) {
  return {
    status: status,
    headers: { get: function () { return null; } },
    json: function () { return Promise.resolve(body || null); }
  };
}
function makeEngine(over) {
  over = over || {};
  const store = { outbox: [] };
  const calls = [];
  const prefs = Object.assign({ on: true, endpoint: 'http://api.test', deviceKey: 'device-key-1', label: 'Rig' }, over.prefs || {});
  let seq = 0;
  const engine = createBiomSync({
    B: B, modelId: 'palmnet-r3-ep12', appVersion: 'v88',
    getPrefs: function () { return prefs; },
    loadOutbox: function () { return Promise.resolve(store.outbox); },
    saveOutbox: function (items) { store.outbox = items; return Promise.resolve(); },
    fetchFn: function (url, opts) { calls.push(url); return over.fetchImpl ? over.fetchImpl(url, opts) : Promise.resolve(res(201)); },
    now: function () { return 1764000000000; },
    uuid: function () { return 'uuid-' + (++seq); },
    onStatus: function () {},
    isOnline: over.isOnline || function () { return true; },
    ownBiomId: over.ownBiomId || function () { return null; }
  });
  return { engine: engine, store: store, calls: calls };
}
const PERSON = { id: 'TSG-BIO-9', name: 'Rig Person', palmProfile: { v: 4, format: 'packed96', hand: 'left', codes: ['QUJD', 'REVG'], neural: { v: 1, dim: 256, model: 'palmnet-r3-ep12', embeddings: ['R0hJ'] } } };

async function main() {
  /* ---- 1. flush AT CREATION, per record kind ----------------- */
  for (const kind of ['enrol', 'verify', 'money-auth', 'topup']) {
    const m = makeEngine({});
    m.engine.noteScan({ kind: kind, profileName: 'Rig Person', biomId: 'TSG-BIO-9', hand: 'left', result: 'Verified' });
    await tick(60);
    check('INSTANT a ' + kind + ' scan record attempts a flush at creation (no manual flush, no later event)',
      m.calls.length === 1 && m.calls[0] === 'http://api.test/api/scans' && m.engine.state().queued === 0,
      'calls=' + m.calls.length);
  }
  {
    const m = makeEngine({});
    m.engine.noteProfile(PERSON);
    await tick(60);
    check('INSTANT a profile record attempts a flush at creation',
      m.calls.length === 1 && m.calls[0] === 'http://api.test/api/profiles' && m.engine.state().queued === 0,
      'calls=' + m.calls.length);
  }
  {
    const m = makeEngine({});
    m.engine.noteResearch({ consent: true, researchId: 'r-1', kind: 'verify', result: 'Verified', frames: [{ data: 'data:image/jpeg;base64,x', w: 1, h: 1 }] });
    await tick(60);
    check('INSTANT a research bundle attempts a flush at creation',
      m.calls.length === 1 && m.calls[0] === 'http://api.test/api/research/frames' && m.engine.state().queued === 0,
      'calls=' + m.calls.length);
  }
  {
    const m = makeEngine({});
    m.engine.noteScan({ kind: 'verify', result: 'Verified' });
    m.engine.noteScan({ kind: 'verify', result: 'Verified' });
    m.engine.noteScan({ kind: 'verify', result: 'Verified' });
    await tick(80);
    check('INSTANT a same-tick burst of 3 records is fully sent by the creation-triggered flush',
      m.calls.length === 3 && m.engine.state().queued === 0, 'calls=' + m.calls.length);
  }
  check('INSTANT the engine no longer carries the 900 ms creation debounce',
    engineSrc.indexOf('flushTimer = setTimeout') === -1 && engineSrc.indexOf('function scheduleFlush() { requestFlush(); }') !== -1);

  /* ---- 2. online / visibility triggers ----------------------- */
  {
    let down = true;
    const m = makeEngine({ fetchImpl: function () { return down ? Promise.reject(new Error('down')) : Promise.resolve(res(201)); } });
    m.engine.noteScan({ kind: 'verify', result: 'Verified' });
    await tick(60);
    check('ONLINE the failed creation attempt leaves the record queued', m.engine.state().queued === 1);
    down = false;
    await m.engine.onOnline();
    check('ONLINE onOnline() flushes the outbox immediately', m.engine.state().queued === 0);
  }
  {
    let down = true;
    const m = makeEngine({ fetchImpl: function () { return down ? Promise.reject(new Error('down')) : Promise.resolve(res(201)); } });
    m.engine.noteScan({ kind: 'verify', result: 'Verified' });
    await tick(60);
    down = false;
    await m.engine.onVisible();
    check('VISIBLE onVisible() flushes the outbox immediately', m.engine.state().queued === 0);
  }
  check('WIRING app.js binds the real online + visibilitychange events to the engine triggers',
    appSrc.indexOf("window.addEventListener('online'") !== -1 && appSrc.indexOf('Sync.onOnline()') !== -1 &&
    appSrc.indexOf("document.addEventListener('visibilitychange'") !== -1 && appSrc.indexOf('Sync.onVisible()') !== -1);

  /* ---- 3. REAL retry with backoff ---------------------------- */
  {
    let attempts = 0;
    const m = makeEngine({ fetchImpl: function () { attempts++; return Promise.reject(new Error('down')); } });
    m.engine.noteScan({ kind: 'verify', result: 'Verified' });
    await tick(80);
    const st = m.engine.state();
    check('RETRY a network failure schedules a real retry (timer armed, first backoff 5 s)',
      st.retryScheduled === true && st.retryDelaySec === 5 && st.retryAttempt === 1 && m.engine.state().queued === 1,
      'delay=' + st.retryDelaySec + ' attempt=' + st.retryAttempt);
    const before = attempts;
    let fired = false;
    for (let i = 0; i < 80 && !fired; i++) { await tick(100); if (attempts > before) fired = true; }
    check('RETRY the scheduled timer actually fires a second attempt (~5 s later, no other event)',
      fired, 'attempts=' + attempts);
    const st2 = m.engine.state();
    check('RETRY the second failure backs off further (10 s) and keeps the record queued',
      st2.retryScheduled === true && st2.retryDelaySec === 10 && st2.queued === 1,
      'delay=' + st2.retryDelaySec);
  }
  {
    const m = makeEngine({ fetchImpl: function () {
      return Promise.resolve({ status: 429, headers: { get: function (h) { return h === 'Retry-After' ? '7' : null; } }, json: function () { return Promise.resolve(null); } });
    } });
    m.engine.noteScan({ kind: 'verify', result: 'Verified' });
    await tick(80);
    const st = m.engine.state();
    check('RETRY 429 behaviour preserved: Retry-After honoured, item kept, no latch',
      st.retryScheduled === true && st.retryDelaySec === 7 && st.queued === 1 && !st.keyRejected && !st.revoked,
      'delay=' + st.retryDelaySec);
  }

  /* ---- 4. indicator states ----------------------------------- */
  {
    const m = makeEngine({});
    m.engine.noteScan({ kind: 'verify', result: 'Verified' });
    await tick(60);
    const ind = m.engine.indicator();
    check('INDICATOR synced state renders after a drain', ind.kind === 'synced' && ind.text.indexOf('Synced') === 0, ind.text);
  }
  {
    const m = makeEngine({ fetchImpl: function () { return new Promise(function () {}); } }); // network hangs
    m.engine.noteScan({ kind: 'verify', result: 'Verified' });
    await tick(60);
    const ind = m.engine.indicator();
    check('INDICATOR pending state renders while a record is unsent',
      ind.kind === 'pending' && ind.text.indexOf('1 record pending') === 0, ind.text);
  }
  {
    const m = makeEngine({ isOnline: function () { return false; }, fetchImpl: function () { return Promise.reject(new Error('down')); } });
    m.engine.noteScan({ kind: 'verify', result: 'Verified' });
    await tick(60);
    const ind = m.engine.indicator();
    check('INDICATOR offline state renders in plain words',
      ind.kind === 'offline' && ind.text.indexOf('offline, will send when back') !== -1, ind.text);
  }
  {
    const m = makeEngine({ fetchImpl: function () { return Promise.resolve(res(401)); } });
    m.engine.noteScan({ kind: 'verify', result: 'Verified' });
    await tick(60);
    const ind = m.engine.indicator();
    check('INDICATOR a latched stop is VISIBLE with a next step (never a silent death)',
      ind.kind === 'error' && ind.text.indexOf('Sync stopped') === 0 && ind.next.indexOf('Save settings') !== -1,
      ind.text + ' / ' + ind.next);
  }
  {
    /* FROZEN v79 semantics: the blocked drop is unchanged — the
       item is dropped, the latch engages — but the state is now
       named by the indicator. */
    const m = makeEngine({
      ownBiomId: function () { return 'TSG-BIO-9'; },
      fetchImpl: function () { return Promise.resolve(res(403, { blocked: true, biomId: 'TSG-BIO-9' })); }
    });
    m.engine.noteScan({ kind: 'verify', biomId: 'TSG-BIO-9', result: 'Verified' });
    await tick(60);
    const ind = m.engine.indicator();
    check('BLOCKED (frozen) a blocked ID record is still dropped at the 403, and the indicator names the blocked state',
      m.engine.state().queued === 0 && m.engine.state().blocked === true && ind.kind === 'blocked' && ind.next.indexOf('unblock') !== -1,
      ind.text);
  }
  check('INDICATOR the persistent indicator element ships on the app surfaces with its text span',
    htmlSrc.indexOf('id="syncIndicator"') !== -1 && htmlSrc.indexOf('id="syncIndicatorText"') !== -1 &&
    appSrc.indexOf('Sync.indicator()') !== -1);

  /* ---- 5. Phase 3 UI pins ------------------------------------- */
  check('TOKENS the §K token layer ships (blue ramp, neutrals, semantics, focus, fonts)',
    cssSrc.indexOf('--k-blue-600:#1F5BD1') !== -1 && cssSrc.indexOf('--k-n-500:#5B6B82') !== -1 &&
    cssSrc.indexOf('--k-success:#177245') !== -1 && cssSrc.indexOf('--k-danger:#C81E1E') !== -1 &&
    cssSrc.indexOf('--font-sans:') !== -1 && cssSrc.indexOf('--font-mono:') !== -1 && cssSrc.indexOf('--focus:var(--k-blue-500)') !== -1);
  check('TOKENS the sync indicator is styled per kind (colour + word, never colour alone)',
    cssSrc.indexOf('.sync-indicator.kind-synced') !== -1 && cssSrc.indexOf('.sync-indicator.kind-pending') !== -1 &&
    cssSrc.indexOf('.sync-indicator.kind-offline') !== -1 && cssSrc.indexOf('.sync-indicator.kind-blocked') !== -1 &&
    cssSrc.indexOf('.sync-indicator.kind-error') !== -1);
  check('UI the wallet balance renders at the display token (the largest element on the home)',
    cssSrc.indexOf('.balcard .balnum{font-size:var(--fs-display)') !== -1);
  check('UI the bottom nav carries the Scan emphasis (nav-scan) on the Scanner tab',
    htmlSrc.indexOf('data-page="scanner" class="nav-scan"') !== -1 && cssSrc.indexOf('.nav button.nav-scan') !== -1);
  check('VERSION app, shell, chain and stamps agree at v95',
    (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v95' &&
    swSrc.indexOf("CACHE = 'tsg-biom-shell-v95'") !== -1 &&
    B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v95' &&
    htmlSrc.indexOf('app.js?b=v95') !== -1 && htmlSrc.indexOf('TSG Biom · App v95 · TwoSide Group') !== -1);

  console.log('\n' + (fail === 0 ? 'ALL v88 INSTANT-SYNC + UI TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed'));
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(function (e) { console.log('FAIL suite error: ' + (e && e.stack || e)); process.exit(1); });
