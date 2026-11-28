/* TSG BIOM v48 — back-camera flash control, functional and smooth.

   The Chairman's order (2026-11-24): whenever the back camera is
   open, the flash control system must work — functionally and
   smoothly. Registration and verification already run smoothly on
   v47; v48 touches the flash control only.

   Proven here:
   - RULES (B.flashUiState, the pure decision table app.js renders):
     the torch lights only on a live back camera with torch
     support and the user's choice On; a torch-less live BACK
     camera DISABLES the toggle with the exact note 'Flash not
     available on this camera'; on the front camera the choice
     stays set with the will-light-on-back note; with no camera
     the choice can be pre-set with the will-light-on-start note.
   - TORCH (B.applyTorchToTrack against mock tracks): the exact
     constraint {advanced:[{torch:bool}]} reaches a capable track;
     a torch-less track is never even asked; a rejecting track, a
     throwing getCapabilities and a null track all resolve false —
     flash can never throw or block a scan.
   - RE-APPLICATION: the v48 session story replayed on the pure
     helpers with mock tracks — choice On, back track A lights;
     A stops (a restart); the front interlude applies nothing and
     keeps the choice; back track B (the re-acquired track) is
     lit by the same preference. The preference is data the app
     holds, never a property of one track.
   - WIRING pins on the shipped sources: every scan surface
     carries its flash toggle (enrolment, terminal — verify /
     payment / Field Test — the shared wallet scan card, and the
     Add Angles / Neural Scan view); Cam.stop no longer resets
     the choice (resetFlash is gone); Cam.start applies capture
     tuning BEFORE the flash so nothing overwrites the torch, and
     refreshes the toggle state after every start; the terminal's
     mid-scan camera swap restarts with the flash key so the new
     track re-applies the choice; the flash tap handler never
     restarts a camera; the disabled state has a style.
   - MIGRATION: 'v48' is an adoption step (full-chain proof lives
     in v38-migration.test.js; the step + versions are pinned
     here too).
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

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

/* ---------- RULES: the flashUiState decision table ---------- */
const NA = B.FLASH_NOTE_NOT_AVAILABLE, FRONT = B.FLASH_NOTE_FRONT, PEND = B.FLASH_NOTE_PENDING;
check('RULES note copy is the honest wording', NA === 'Flash not available on this camera' &&
  FRONT === 'Flash is set On - it will light on the back camera.' &&
  PEND === 'Flash is set On - it will light when this camera starts.');
let ui = B.flashUiState({ prefOn: true, live: true, backChosen: true, torchSupported: true });
check('RULES back + torch + choice On => light it, toggle enabled, no note',
  ui.applyTorch === true && ui.disabled === false && ui.note === '');
ui = B.flashUiState({ prefOn: false, live: true, backChosen: true, torchSupported: true });
check('RULES back + torch + choice Off => dark, toggle enabled, no note',
  ui.applyTorch === false && ui.disabled === false && ui.note === '');
ui = B.flashUiState({ prefOn: true, live: true, backChosen: true, torchSupported: false });
check('RULES back + NO torch => toggle DISABLED with the not-available note, choice not lit',
  ui.disabled === true && ui.applyTorch === false && ui.note === NA);
ui = B.flashUiState({ prefOn: false, live: true, backChosen: true, torchSupported: false });
check('RULES back + NO torch disables the toggle even with the choice Off (it cannot pretend)',
  ui.disabled === true && ui.applyTorch === false && ui.note === NA);
ui = B.flashUiState({ prefOn: true, live: true, backChosen: false, torchSupported: false });
check('RULES front + choice On => choice kept, never lit, will-light-on-back note, toggle enabled',
  ui.applyTorch === false && ui.disabled === false && ui.note === FRONT);
ui = B.flashUiState({ prefOn: true, live: true, backChosen: false, torchSupported: true });
check('RULES front never lights even if the front track claims a torch',
  ui.applyTorch === false && ui.disabled === false && ui.note === FRONT);
ui = B.flashUiState({ prefOn: false, live: true, backChosen: false, torchSupported: false });
check('RULES front + choice Off => plain enabled toggle, no note',
  ui.applyTorch === false && ui.disabled === false && ui.note === '');
ui = B.flashUiState({ prefOn: true, live: false, backChosen: true, torchSupported: false });
check('RULES no camera + choice On => pre-settable, will-light-on-start note',
  ui.applyTorch === false && ui.disabled === false && ui.note === PEND);
ui = B.flashUiState({ prefOn: false, live: false, backChosen: false, torchSupported: false });
check('RULES no camera + choice Off => plain enabled toggle, no note',
  ui.applyTorch === false && ui.disabled === false && ui.note === '');
ui = B.flashUiState(null);
check('RULES empty input is a safe dark enabled state', ui.applyTorch === false && ui.disabled === false && ui.note === '');

/* ---------- TORCH: applyTorchToTrack against mock tracks ---------- */
function mockTrack(opts) {
  const t = {
    calls: [],
    getCapabilities() {
      if (opts.throwCaps) throw new Error('caps boom');
      return opts.caps || {};
    },
    applyConstraints(c) {
      t.calls.push(c);
      return opts.reject ? Promise.reject(new Error('constraint rejected')) : Promise.resolve();
    }
  };
  return t;
}
async function torchChecks() {
  const capable = mockTrack({ caps: { torch: true } });
  check('TORCH a capable track accepts and resolves true', (await B.applyTorchToTrack(capable, true)) === true);
  check('TORCH the constraint is exactly {advanced:[{torch:true}]}',
    JSON.stringify(capable.calls[0]) === JSON.stringify({ advanced: [{ torch: true }] }), JSON.stringify(capable.calls[0]));
  check('TORCH off sends {torch:false} to the same track', (await B.applyTorchToTrack(capable, false)) === true &&
    JSON.stringify(capable.calls[1]) === JSON.stringify({ advanced: [{ torch: false }] }));
  const noTorch = mockTrack({ caps: { torch: false } });
  check('TORCH a torch-less track resolves false and is NEVER asked',
    (await B.applyTorchToTrack(noTorch, true)) === false && noTorch.calls.length === 0);
  const noCapsKey = mockTrack({ caps: {} });
  check('TORCH a track with no torch key in capabilities is treated as torch-less',
    (await B.applyTorchToTrack(noCapsKey, true)) === false && noCapsKey.calls.length === 0);
  const rejecting = mockTrack({ caps: { torch: true }, reject: true });
  check('TORCH a rejecting applyConstraints resolves false (never throws)',
    (await B.applyTorchToTrack(rejecting, true)) === false && rejecting.calls.length === 1);
  const throwing = mockTrack({ throwCaps: true });
  check('TORCH a throwing getCapabilities resolves false (never throws)',
    (await B.applyTorchToTrack(throwing, true)) === false && throwing.calls.length === 0);
  check('TORCH a null track resolves false', (await B.applyTorchToTrack(null, true)) === false);
  check('TORCH a track without applyConstraints resolves false',
    (await B.applyTorchToTrack({ getCapabilities: () => ({ torch: true }) }, true)) === false);

  /* ---------- RE-APPLICATION: one preference, many tracks ----------
     The v48 session story, replayed exactly as app.js drives it:
     the preference lives in the view's state; every new track is
     judged by flashUiState and lit by applyTorchToTrack. */
  const pref = { on: true };
  const trackA = mockTrack({ caps: { torch: true } });
  let s = B.flashUiState({ prefOn: pref.on, live: true, backChosen: true, torchSupported: true });
  if (s.applyTorch) await B.applyTorchToTrack(trackA, true);
  check('REAPPLY back track A is lit from the stored choice', trackA.calls.length === 1 &&
    JSON.stringify(trackA.calls[0]) === JSON.stringify({ advanced: [{ torch: true }] }));
  // A stops (restart / navigation). The preference is NOT track state:
  check('REAPPLY the preference survives the track stopping (it was never the track\u2019s to clear)', pref.on === true);
  const frontTrack = mockTrack({ caps: {} });
  s = B.flashUiState({ prefOn: pref.on, live: true, backChosen: false, torchSupported: false });
  if (s.applyTorch) await B.applyTorchToTrack(frontTrack, true);
  check('REAPPLY the front interlude applies nothing and the choice is intact',
    frontTrack.calls.length === 0 && pref.on === true && s.note === FRONT);
  const trackB = mockTrack({ caps: { torch: true } });
  s = B.flashUiState({ prefOn: pref.on, live: true, backChosen: true, torchSupported: true });
  if (s.applyTorch) await B.applyTorchToTrack(trackB, true);
  check('REAPPLY the re-acquired back track B is lit by the same preference (switch-back restores)',
    trackB.calls.length === 1 && JSON.stringify(trackB.calls[0]) === JSON.stringify({ advanced: [{ torch: true }] }));
  const laptopTrack = mockTrack({ caps: {} });
  s = B.flashUiState({ prefOn: pref.on, live: true, backChosen: true, torchSupported: false });
  if (s.applyTorch) await B.applyTorchToTrack(laptopTrack, true);
  check('REAPPLY a torch-less back track (laptop webcam) is never asked and the toggle disables',
    laptopTrack.calls.length === 0 && s.disabled === true && s.note === NA);
}

/* ---------- WIRING pins on the shipped sources ---------- */
function wiringChecks() {
  ['enrollPalm', 'terminal', 'walletAct', 'topup'].forEach(function (g) {
    check('WIRING scan surface carries its flash toggle: ' + g,
      idxSrc.indexOf('data-flash-toggle="' + g + '"') !== -1 && idxSrc.indexOf('data-flash-note="' + g + '"') !== -1);
  });
  check('WIRING the Add Angles / Neural Scan view is the topup surface (one toggle serves both)',
    appSrc.indexOf("topupMode = mode === 'neural' ? 'neural' : 'angles'") !== -1 &&
    idxSrc.indexOf('data-flash-toggle="topup"') !== -1);
  check('WIRING app.js renders the pure rules (flashUiState + applyTorchToTrack)',
    appSrc.indexOf('B.flashUiState') !== -1 && appSrc.indexOf('B.applyTorchToTrack') !== -1 &&
    appSrc.indexOf('function refreshFlashUi') !== -1);
  check('WIRING Cam.stop no longer resets the flash choice (resetFlash is gone)',
    appSrc.indexOf('resetFlash') === -1);
  const startIdx = appSrc.indexOf('function applyCaptureTuning');
  const tuneCall = appSrc.indexOf('return applyCaptureTuning(stream);');
  const flashCall = appSrc.indexOf('applyFlashForKey(viewKey)');
  check('WIRING Cam.start applies capture tuning BEFORE the flash (nothing overwrites the torch)',
    startIdx !== -1 && tuneCall > startIdx && flashCall > tuneCall);
  check('WIRING Cam.start refreshes the toggle state after every start',
    appSrc.indexOf('refreshFlashUi(flashGroupKey(viewKey))') !== -1);
  // v67 pin update (named): the terminal mid-scan camera swap
  // this check covered is DELETED on the Chairman's order
  // (2026-11-26 — the camera never changes on its own, so no
  // swap remains for the flash to re-apply under). The pin now
  // asserts the swap callback is gone and the terminal scan
  // passes no swap callback at all.
  check('WIRING v67: the terminal scan has NO mid-scan camera swap (deleted, not damped)',
    !/Cam\.start\(\$\('termVideo'\), camFacing\[k\], k\)/.test(appSrc) &&
    /* v82 PIN CHANGE (named openly): the terminal call now
       passes an empty people array plus opts.peopleReady (the
       list loads concurrently; the stream's tail awaits it) —
       the swap-callback argument this pin guards is still the
       literal null in the same position. */
    appSrc.indexOf("streamVerifyPalm($('termVideo'), $('termStatus'), person, [], null, fieldRec") !== -1);
  const wf = appSrc.slice(appSrc.indexOf('function wireFlashToggles'), appSrc.indexOf('/* ---------------- Palm CLIP capture'));
  check('WIRING the flash tap handler never restarts a camera or a scan',
    wf.length > 100 && wf.indexOf('Cam.start(') === -1 && wf.indexOf('camRestarters') === -1 && wf.indexOf('Cam.stop(') === -1);
  check('WIRING the flash tap applies in place to the live track',
    wf.indexOf('applyFlashForKey(key)') !== -1 && wf.indexOf('applyTorchToCurrentTrack(false)') !== -1);
  check('WIRING the camera-switch handler refreshes the flash note when no restart runs',
    appSrc.indexOf('else refreshFlashUi(groupKey);') !== -1);
  check('WIRING the terminal method note goes through refreshFlashUi (one owner of the note)',
    appSrc.indexOf("refreshFlashUi('terminal');") !== -1);
  check('WIRING the disabled toggle state has a style', cssSrc.indexOf('.camtoggle button:disabled') !== -1);
  check('WIRING versions: app data version and shell version agree and sit in the chain (v49-era form of this pin)',
    (function () {
      const dv = (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1];
      const sv = (swSrc.match(/tsg-biom-shell-(v\d+)/) || [])[1];
      return !!dv && dv === sv && B.BIOM_DATA_VERSIONS.indexOf(dv) !== -1 && B.BIOM_DATA_VERSIONS.indexOf('v48') !== -1;
    })());
  check('MIGRATION v48 remains in the chain as an adoption step',
    B.BIOM_DATA_VERSIONS.indexOf('v48') !== -1 &&
    B.migrateBiomData({ people: [], logs: [], transactions: [], meta: [] }, 'v47', 'v48').appliedSteps.join(',') === 'v48');
}

Promise.resolve().then(torchChecks).then(wiringChecks).then(function () {
  console.log(fail === 0 ? 'ALL v48 FLASH TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
}).catch(function (e) {
  console.log('FAIL  suite threw: ' + (e && e.stack || e));
  process.exit(1);
});
