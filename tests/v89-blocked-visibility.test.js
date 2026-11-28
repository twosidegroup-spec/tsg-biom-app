/* TSG BIOM v89 — BLOCKED VISIBILITY (the Chairman's ruling,
   2026-11-28, after his own morning test).

   His words, in substance: "When blocked, let the customer enter
   their wallet but use nothing. When they scan, show in their
   wallet: your account has been blocked for this reason. Not like
   now — I blocked it and nothing was shown: why blocked, what
   happened? When I blocked it and scanned, everything was perfect,
   showing no blocked feeling. That is the problem."

   What v89 changes:
   - the API's lean pull summary carries blockedReason / blockedTs
     / blockedBy while the block stands (API-side, pinned in the
     API's v79 suite as superseded + a v89 absence check);
   - the sync engine's blocked set stores the story as an info
     object {r,t,b} next to legacy `true` entries; isBlocked is
     truthy over both; a story-less learn (403, older API) never
     downgrades an entry that already carries a story;
   - the own-account latch carries the story into Sync.state();
   - Sync.blockedInfo(id) exposes { reason, ts, by } (nulls where
     the server sent nothing) or null when not blocked;
   - the wallet home renders a blocked card (heading + reason +
     what still works: viewing) at the top when the opened person
     is blocked; entry itself is never refused;
   - the wallet scan card and the Strengthen / Add Angle / Neural
     refusal messages append the reason line.

   Frozen: the block itself is untouched — every refusal, the
   flush drop on 403, the terminal verdict, the strict rule. v89
   changes only what the blocked person is TOLD.

   All numbers are RIG numbers; the phone is the verdict. */
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

function jsonRes(status, body) {
  return {
    status: status,
    headers: { get: function () { return null; } },
    json: function () { return Promise.resolve(body || null); },
    text: function () { return Promise.resolve(JSON.stringify(body || {})); }
  };
}
function makeEngine(over) {
  over = over || {};
  const store = { outbox: [], versions: {}, blockedIds: JSON.parse(JSON.stringify(over.blockedSeed || {})) };
  const rig = { seq: 1 };
  const prefs = { on: true, endpoint: 'http://api.test', deviceId: 'dev-rig', deviceSecret: 'sec-rig', label: 'Rig' };
  let n = 0;
  const deps = {
    B: B, modelId: 'palmnet-r3-ep12', appVersion: 'v89',
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
    ownBiomId: over.ownBiomId,
    loadBlockedIds: function () { return Promise.resolve(JSON.parse(JSON.stringify(store.blockedIds))); },
    saveBlockedIds: function (set) { store.blockedIds = JSON.parse(JSON.stringify(set)); return Promise.resolve(); }
  };
  if (!over.ownBiomId) delete deps.ownBiomId;
  return { engine: createBiomSync(deps), store: store, rig: rig };
}

async function main() {
  /* ---- 1. the pull teaches the story -------------------------- */
  const summary = { profiles: [
    { biomId: 'TSG-BIO-OTHER', version: 5, blocked: true, blockedReason: 'Stolen palm reports', blockedTs: 1763999900000, blockedBy: 'chairman' },
    { biomId: 'TSG-BIO-PLAIN', version: 2, blocked: true },
    { biomId: 'TSG-BIO-OWN', version: 5, blocked: true, blockedReason: 'Test block', blockedTs: 1763999950000, blockedBy: 'chairman' }
  ] };
  const p = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    fetchFn: function () { return Promise.resolve(jsonRes(200, summary)); }
  });
  const st = await p.engine.pull();
  check('STORY pull stores the reason for another person (info object in the persisted set)',
    p.store.blockedIds['TSG-BIO-OTHER'] && p.store.blockedIds['TSG-BIO-OTHER'].r === 'Stolen palm reports' && p.store.blockedIds['TSG-BIO-OTHER'].b === 'chairman');
  check('STORY blockedInfo returns the story for a blocked person',
    (function () { const i = p.engine.blockedInfo('TSG-BIO-OTHER'); return !!i && i.reason === 'Stolen palm reports' && i.ts === 1763999900000 && i.by === 'chairman'; })());
  check('STORY a story-less row still blocks, with an honest empty story',
    p.engine.isBlocked('TSG-BIO-PLAIN') === true && (function () { const i = p.engine.blockedInfo('TSG-BIO-PLAIN'); return !!i && i.reason === null && i.ts === null && i.by === null; })());
  check('STORY the own latch carries the story into state()',
    st.blocked === true && st.blockedBiomId === 'TSG-BIO-OWN' && st.blockedReason === 'Test block' && st.blockedBy === 'chairman');
  check('STORY blockedInfo prefers the own latch for the own ID',
    (function () { const i = p.engine.blockedInfo('TSG-BIO-OWN'); return !!i && i.reason === 'Test block'; })());
  check('STORY blockedInfo is null for a person who is not blocked',
    p.engine.blockedInfo('TSG-BIO-NOBODY') === null);

  /* ---- 2. no downgrade, clean unblock -------------------------- */
  const summary2 = { profiles: [
    { biomId: 'TSG-BIO-OTHER', version: 6, blocked: true },
    { biomId: 'TSG-BIO-OWN', version: 6, blocked: false }
  ] };
  const p2 = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    blockedSeed: { 'TSG-BIO-OTHER': { r: 'Kept reason', t: 1763999900000, b: 'system' } },
    fetchFn: function () { return Promise.resolve(jsonRes(200, summary2)); }
  });
  const st2 = await p2.engine.pull();
  check('STORY a later story-less blocked row never downgrades a stored story',
    p2.store.blockedIds['TSG-BIO-OTHER'] && p2.store.blockedIds['TSG-BIO-OTHER'].r === 'Kept reason');
  check('STORY an unblock clears the latch AND its story',
    st2.blocked === false && st2.blockedReason === null && st2.blockedBiomId === '');

  /* ---- 3. legacy entries --------------------------------------- */
  const legacy = makeEngine({
    ownBiomId: function () { return 'TSG-BIO-OWN'; },
    blockedSeed: { 'TSG-BIO-OLD': true, 'TSG-BIO-OBJ': { r: 'Legacy object', t: 1763999900000, b: 'chairman' } },
    fetchFn: function () { return Promise.reject(new Error('offline')); }
  });
  await legacy.engine.ensureBlockedIds();
  check('LEGACY a persisted `true` entry still reads as blocked',
    legacy.engine.isBlocked('TSG-BIO-OLD') === true);
  check('LEGACY a persisted info object still reads as blocked, with its story',
    legacy.engine.isBlocked('TSG-BIO-OBJ') === true && legacy.engine.blockedInfo('TSG-BIO-OBJ').reason === 'Legacy object');

  /* ---- 4. UI pins ---------------------------------------------- */
  check('UI the wallet home carries the blocked card container',
    htmlSrc.indexOf('id="wHomeBlocked"') !== -1 && htmlSrc.indexOf('blockedcard') !== -1);
  check('UI renderWalletHome renders the card for a blocked person and clears it otherwise',
    appSrc.indexOf('blockedCardHTML(bInfo)') !== -1 && appSrc.indexOf("$('wHomeBlocked')") !== -1);
  check('UI the card says what he ordered: blocked + reason + view-only',
    appSrc.indexOf('Your account has been blocked') !== -1 &&
    appSrc.indexOf('You can open and view your wallet') !== -1 &&
    appSrc.indexOf('No reason was recorded for this block.') !== -1);
  check('UI the wallet scan refusal appends the reason line',
    appSrc.indexOf("esc(blockedReasonLine(wBlkInfo))") !== -1);
  check('UI the Strengthen / Add Angle / Neural refusal appends the reason line',
    appSrc.indexOf('esc(blockedReasonLine(blockedInfoFor(personId)))') !== -1);
  check('UI the blocked card is styled (danger card in styles.css)',
    cssSrc.indexOf('.blockedcard{') !== -1 && cssSrc.indexOf('.blockedreason') !== -1);
  check('UI wallet entry itself is never refused for a blocked person (no blocked gate on openWalletDirect)',
    (function () {
      const i = appSrc.indexOf('function openWalletDirect');
      const seg = appSrc.slice(i, i + 900);
      return seg.indexOf('isBlocked') === -1 && seg.indexOf('blocked') === -1;
    })());

  /* ---- 5. version coherence ------------------------------------- */
  check('VERSION app, shell, chain and stamps agree at v95 (the v89 content shipped inside v90)',
    appSrc.indexOf("var APP_DATA_VERSION = 'v95';") !== -1 &&
    swSrc.indexOf('tsg-biom-shell-v95') !== -1 &&
    htmlSrc.indexOf('content="v95"') !== -1 &&
    B.BIOM_DATA_VERSIONS.indexOf('v89') !== -1 && B.BIOM_DATA_VERSIONS.indexOf('v90') !== -1);

  console.log('\nv89-blocked-visibility: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}
main().catch(function (e) { console.error(e); process.exit(1); });
