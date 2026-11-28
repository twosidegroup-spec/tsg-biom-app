/* TSG BIOM v69 — DELETE MY DATA + SCAN-VERDICT FRICTION
   (the Chairman's two orders, 2026-11-26 10:14, from his
   first live v68 scan session).

   ORDER 1: the customer Settings gains Delete my data — one
   profile's palm bank + wallet erased from this device
   through the existing v62 tombstone machinery (tombstones
   queued and flushed BEFORE any local erase, the Delete All
   Data order scoped to one person), behind the same
   typed-DELETE confirmation strength as the owner's wipe.

   ORDER 2: the wallet money-authorisation verdict friction.
   His session cycled "unauthorised" -> "antispoof" -> "no
   hand" -> recognised. The code-level causes pinned here:
   (a) the anti-spoof tracker was fed handless frames, whose
   whole-frame bezel/glare evidence could convict a scan —
   the tracker now refuses any frame with no hand read;
   (b) detector failure was judged at the BOTTOM of the
   verify loop, after the spoof/liveness exits that could
   overwrite it — it is now judged FIRST;
   (c) detector-failed frames burned the frame cap, and the
   static-liveness exit counted analysed (handless) frames —
   both now count only judged / hand-read frames;
   (d) every failure now maps to its cause's own next step
   (SCAN-GUIDANCE), and a thin bank (B.palmBankThin) is
   offered the Strengthen flow on scored-but-refused
   failures and once after enrolment.
   The frozen rules are untouched and re-pinned here:
   EDCC 0.32 / PalmNet 0.5895. */
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
check('VERSION app, shell, user-visible line and chain agree at v94 (v94 named pin change: declutter)',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v94' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v94'") !== -1 &&
  html.indexOf('TSG Biom · App v94 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v94');
check('MIGRATION the v69 step is a pure adoption: a v68 store opens byte-identical',
  (function () {
    const before = JSON.stringify({
      people: [{ id: 'TSG-BIO-1', name: 'Gate Person A', wallet: { balance: 500, statement: [], linkedAccounts: [] } }],
      logs: [{ ts: 1, result: 'Verified' }], transactions: [{ id: 'BIOM-PAY-1001', amount: 320 }], meta: [{ key: 'inbox:TSG-BIO-1', value: [] }]
    });
    const mig = B.migrateBiomData(JSON.parse(before), 'v68', 'v69');
    return mig.appliedSteps.indexOf('v69') !== -1 && mig.changed === false && JSON.stringify(mig.snapshot) === before;
  })());
check('MIGRATION the whole chain v37->v69 applies 32 steps and changes nothing on a v37 store shape',
  (function () {
    const store = { people: [], logs: [], transactions: [], meta: [] };
    const mig = B.migrateBiomData(store, 'v37', 'v69');
    return mig.appliedSteps.length === 32 && mig.appliedSteps[mig.appliedSteps.length - 1] === 'v69';
  })());
check('FROZEN bars untouched: EDCC 0.32 / PalmNet 0.5895',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895);

/* ---------- thin bank (B.palmBankThin) --------------------------- */
check('THIN a single enrolment bank (3 templates) is thin',
  B.palmBankThin({ codes: ['a', 'b', 'c'] }) === true);
check('THIN a strengthened bank (more than 3 templates) is not thin',
  B.palmBankThin({ codes: ['a', 'b', 'c', 'd'] }) === false &&
  B.palmBankThin({ codes: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }) === false);
check('THIN legacy / empty / missing banks are not thin (they take the re-scan path, not Strengthen)',
  B.palmBankThin({ codes: [], legacyCodes: ['x', 'y'] }) === false &&
  B.palmBankThin(null) === false && B.palmBankThin({}) === false && B.palmBankThin(undefined) === false);

/* ---------- ORDER 1: profile deletion factory -------------------- */
const delSrc = sliceBetween(appSrc, '/* PROFILE-DELETE-BEGIN', '/* PROFILE-DELETE-END */');
check('DELETE the profile-deletion block is extractable from app.js',
  delSrc.indexOf('function createProfileDeletion') !== -1);
const createProfileDeletion = new Function(delSrc + '\nreturn createProfileDeletion;')();

function bankedPerson(id) {
  return { id: id, name: 'Person ' + id, palmProfile: { codes: ['x', 'y', 'z'] }, wallet: { balance: 100, statement: [], linkedAccounts: [] } };
}
function fakeDeps(opts) {
  const calls = [];
  const people = opts.people || {};
  return {
    calls: calls,
    deps: {
      getPerson: function (id) { calls.push('getPerson:' + id); return Promise.resolve(people[id] || null); },
      syncActive: function () { return !!opts.syncActive; },
      queueTombstones: function (list) { calls.push('queueTombstones:' + list.map(function (p) { return p.id; }).join(',')); return Promise.resolve(list.length); },
      flush: function () { calls.push('flush'); return Promise.resolve(); },
      pendingTombstones: function (id) { calls.push('pendingTombstones:' + id); return opts.pending ? [{ type: 'tombstone', record: { biomId: id } }] : []; },
      erase: function (id) { calls.push('erase:' + id); return Promise.resolve({ transactions: 2 }); }
    }
  };
}

(async function () {
  /* sync on, banked, flush delivers: tombstone strictly before erase */
  {
    const f = fakeDeps({ syncActive: true, people: { 'TSG-BIO-1': bankedPerson('TSG-BIO-1'), 'TSG-BIO-2': bankedPerson('TSG-BIO-2') } });
    const out = await createProfileDeletion(f.deps).deleteProfile('TSG-BIO-1');
    const order = f.calls.join('|');
    check('DELETE tombstone is queued and flushed BEFORE any local erase',
      out.deleted === true && out.server === 'tombstoned' &&
      order.indexOf('queueTombstones:TSG-BIO-1') !== -1 &&
      order.indexOf('flush') > order.indexOf('queueTombstones') &&
      order.indexOf('erase:TSG-BIO-1') > order.indexOf('flush'), order);
    check('DELETE other profiles are never queued or erased',
      order.indexOf('TSG-BIO-2') === -1, order);
  }
  /* sync on, tombstone undeliverable: still erases locally, server reports pending */
  {
    const f = fakeDeps({ syncActive: true, pending: true, people: { 'TSG-BIO-1': bankedPerson('TSG-BIO-1') } });
    const out = await createProfileDeletion(f.deps).deleteProfile('TSG-BIO-1');
    check('DELETE an undelivered tombstone reports pending and the local erase still runs after it',
      out.deleted === true && out.server === 'pending' && f.calls.indexOf('erase:TSG-BIO-1') !== -1, f.calls.join('|'));
  }
  /* sync off: no tombstone machinery runs, erase still happens, server reports inactive */
  {
    const f = fakeDeps({ syncActive: false, people: { 'TSG-BIO-1': bankedPerson('TSG-BIO-1') } });
    const out = await createProfileDeletion(f.deps).deleteProfile('TSG-BIO-1');
    check('DELETE with sync off, no tombstone is queued and the outcome says inactive',
      out.deleted === true && out.server === 'inactive' &&
      f.calls.join('|').indexOf('queueTombstones') === -1 && f.calls.indexOf('erase:TSG-BIO-1') !== -1, f.calls.join('|'));
  }
  /* no palm bank: nothing to tombstone */
  {
    const bare = { id: 'TSG-BIO-9', name: 'No Palm', palmProfile: null, wallet: { balance: 0, statement: [], linkedAccounts: [] } };
    const f = fakeDeps({ syncActive: true, people: { 'TSG-BIO-9': bare } });
    const out = await createProfileDeletion(f.deps).deleteProfile('TSG-BIO-9');
    check('DELETE a profile with no palm bank erases locally and reports no server removal',
      out.deleted === true && out.server === 'none' && f.calls.join('|').indexOf('queueTombstones') === -1, f.calls.join('|'));
  }
  /* unknown id: nothing happens at all */
  {
    const f = fakeDeps({ syncActive: true, people: {} });
    const out = await createProfileDeletion(f.deps).deleteProfile('TSG-BIO-X');
    check('DELETE an unknown profile deletes nothing and erases nothing',
      out.deleted === false && f.calls.join('|').indexOf('erase') === -1, f.calls.join('|'));
  }

  /* ---------- ORDER 1: Settings surface wiring ------------------- */
  const settingsHtml = sliceBetween(html, 'id="page-settings"', '<!-- MY ACCOUNT');
  check('DELETE the Delete my data row lives in the customer Settings page',
    settingsHtml.indexOf('id="setDeleteRow"') !== -1 && settingsHtml.indexOf('Delete my data') !== -1);
  check('DELETE the confirmation sheet states what is deleted and that it cannot be undone',
    settingsHtml.indexOf('id="delConfirm"') !== -1 &&
    settingsHtml.indexOf('id="delCounts"') !== -1 &&
    settingsHtml.indexOf('permanently deletes your account') !== -1 &&
    settingsHtml.indexOf('cannot be undone') !== -1 &&
    settingsHtml.indexOf('register again') !== -1);
  check('DELETE confirmation is typed-DELETE strength, matching the owner wipe',
    settingsHtml.indexOf('id="delConfirmInput"') !== -1 &&
    settingsHtml.indexOf('id="delConfirmBtn" disabled') !== -1 &&
    appSrc.indexOf("confirmBtn.disabled = input.value.trim() !== 'DELETE';") !== -1 &&
    sliceBetween(appSrc, 'function wireProfileDelete()', 'function wireWipeData()').indexOf('ProfileDeletion.deleteProfile(personId)') !== -1);
  check('DELETE after deletion the session ends and the app returns to the role choice',
    (function () {
      const w = sliceBetween(appSrc, 'function wireProfileDelete()', 'function wireWipeData()');
      return w.indexOf('walletSessionId = null') !== -1 && w.indexOf('RoleMode.clear()') !== -1 && w.indexOf("go('role')") !== -1;
    })());
  check('DELETE the local erase removes the person row, the Inbox meta and the profile transactions',
    (function () {
      const w = sliceBetween(appSrc, 'var ProfileDeletion = createProfileDeletion({', '/* v69: the Settings wiring');
      return w.indexOf("DB.remove('people', personId)") !== -1 &&
        w.indexOf("DB.remove('meta', 'inbox:' + personId)") !== -1 &&
        w.indexOf("DB.remove('transactions', t.id)") !== -1 &&
        w.indexOf('t.personId === personId') !== -1;
    })());

  /* ---------- ORDER 2: scan guidance factory ---------------------- */
  const guideSrc = sliceBetween(appSrc, '/* SCAN-GUIDANCE-BEGIN', '/* SCAN-GUIDANCE-END */');
  check('GUIDANCE the scan-guidance block is extractable from app.js',
    guideSrc.indexOf('function createScanGuidance') !== -1);
  const G = new Function(guideSrc + '\nreturn createScanGuidance;')()();
  const cases = [
    ['detector', { detectorFailed: true, fail: 'The hand detector could not run on this device' }],
    ['spoof', { fail: 'Spoof / Screen Replay Detected — the scan showed a screen or a recording, not a live hand (bezel). Nothing was verified.' }],
    ['liveness-static', { fail: 'Liveness check failed: the palm did not move naturally at all — a still photo or a frozen image cannot be used.' }],
    ['liveness-erratic', { fail: 'Liveness check failed: the view changed too abruptly for one held hand.' }],
    ['liveness-static', { r: { verified: false, reason: 'The palm matched, but liveness could not be confirmed — no natural micro-movement was observed.' }, diag: { edcc: 0.4, neural: null } }],
    ['strict-margin', { fail: 'Matched, but not clearly enough to authorise money — please scan again', strictMoney: { applied: true, pass: false, block: 'margin' }, diag: { edcc: 0.41, neural: 0.7, strictBlock: 'margin' } }],
    ['strict-frames', { fail: 'Matched, but not clearly enough to authorise money — please scan again', strictMoney: { applied: true, pass: false, block: 'frames' }, diag: { edcc: 0.41, neural: null, strictBlock: 'frames' } }],
    ['hand-gate', { diag: { edcc: 0.1, neural: null, handGate: true, probeHand: 'left', profileHand: 'right' } }],
    ['unreadable', { fail: 'No usable open palm with readable print detail found in the scan. Nothing was verified.' }],
    ['nomatch', { diag: { edcc: 0.21, neural: 0.31, handGate: false } }],
    ['generic', { fail: 'Scan failed: boom' }],
    ['generic', null]
  ];
  cases.forEach(function (c, i) {
    check('GUIDANCE cause ' + (i + 1) + ' maps to ' + c[0], G.causeOf(c[1]) === c[0], G.causeOf(c[1]));
  });
  check('GUIDANCE every cause carries its own distinct next-step line',
    (function () {
      const lines = Object.keys(G.LINES).map(function (k) { return G.LINES[k]; });
      return lines.length >= 10 && lines.every(function (l) { return typeof l === 'string' && l.length > 20; }) &&
        new Set(lines).size === lines.length;
    })());
  check('GUIDANCE the detector cause outranks a spoof-shaped fail text (the v69 ordering rule, in the mapping)',
    G.causeOf({ detectorFailed: true, fail: 'Spoof / Screen Replay Detected — x' }) === 'detector');
  check('GUIDANCE Strengthen is offered only on scored-but-refused causes',
    G.strengthenApplies({ diag: { edcc: 0.21, neural: null } }) === true &&
    G.strengthenApplies({ strictMoney: { block: 'margin' }, diag: { edcc: 0.4, neural: null } }) === true &&
    G.strengthenApplies({ fail: 'No usable open palm with readable print detail found in the scan.' }) === true &&
    G.strengthenApplies({ detectorFailed: true }) === false &&
    G.strengthenApplies({ fail: 'Spoof / Screen Replay Detected — x' }) === false &&
    G.strengthenApplies({ diag: { edcc: 0.1, neural: null, handGate: true } }) === false);

  /* ---------- ORDER 2: stream-level pins -------------------------- */
  check('SPOOF the tracker refuses handless frames (no landmarks, no spoof evidence)',
    sliceBetween(appSrc, 'function makeSpoofTracker()', '/* Registration (v45').indexOf('if (!lm) return null;') !== -1);
  const verifySrc = sliceBetween(appSrc, 'function streamVerifyPalm(', '/* Wallet identification');
  check('ORDER detector failure is judged before the spoof exit in the verify loop',
    (function () {
      const loopSrc = sliceBetween(verifySrc, 'function loop() {', 'return loop();');
      const det = loopSrc.indexOf('if (detFails >= 3)');
      const spoof = loopSrc.indexOf('if (sp.spoof) return spoofOut(sp);');
      return det !== -1 && spoof !== -1 && det < spoof;
    })());
  check('ORDER the frame cap excludes detector-failed frames',
    verifySrc.indexOf('analysed - detTotal >= MAXF') !== -1 && verifySrc.indexOf('detTotal++') !== -1);
  check('ORDER the static-liveness exit counts hand-read frames, not analysed frames',
    verifySrc.indexOf('lv.verdict === \'static\' && handFrames >= 6') !== -1 && verifySrc.indexOf('if (r.pose) { handFrames++; Research.tapFrame(frame); }') !== -1);
  check('GUIDANCE the wallet failure sheet renders the cause guidance and the thin-bank Strengthen offer',
    (function () {
      const w = sliceBetween(appSrc, 'function walletScanFailed(out)', '/* v53 OWNER RECOVERY');
      return w.indexOf('ScanGuidance.lineFor(out)') !== -1 &&
        w.indexOf('id="wScanStrengthen"') !== -1 &&
        w.indexOf('B.palmBankThin(meNow.palmProfile)') !== -1 &&
        w.indexOf('openTopup(p.id)') !== -1;
    })());
  check('GUIDANCE the post-enrolment Strengthen offer exists, is once-per-profile and dismissible',
    html.indexOf('id="enrollStrengthenOffer"') !== -1 &&
    html.indexOf('id="enrollStrengthenDismiss"') !== -1 &&
    appSrc.indexOf("'strengthenOffered:' + person.id") !== -1 &&
    appSrc.indexOf('B.palmBankThin(person.palmProfile)') !== -1);

  console.log(fail === 0 ? 'ALL V69 DELETE + SCAN-FRICTION TESTS PASSED (' + pass + ')' : fail + ' V69 TEST(S) FAILED, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) { console.log('FAIL v69 suite crashed: ' + (e && e.stack || e)); process.exit(1); });
