/* TSG BIOM v57 — front-camera recognition audit + instant, smooth
   Front/Back switching (the Chairman's phone report, 2026-11-25:
   the back camera scans "too good", the front camera troubles —
   not recognising, making problems — and the Front/Back buttons
   feel hang-type, stuck, not smooth; his order: zero lag, super
   smooth, clean, no clutter).

   THE AUDIT (code, read end to end before anything changed):
   the capture -> analysis -> warp -> match chain is
   CAMERA-SYMMETRIC. Both facings get the same getUserMedia
   constraints (640x480 ideal), the same frame grab (<=640 cap),
   the same MediaPipe analysis (320 cap), the same affine warp —
   which preserves chirality, so a front capture's ROI is the
   mirror of a back capture's, and BOTH matchers carry the
   mirror twin for exactly that: the EDCC probe is the code plus
   its mirror twin (palmCodesFromFrame / palmprintProbePacked),
   and every PalmNet probe site embeds the pair (embedPair:
   ROI + mirror twin, banks as captured). The hand reading is
   corrected by the LIVE track's facing (liveFacingMode ->
   B.palmAnatomicalHand). The preview mirror is CSS-only;
   captures read raw pixels. NO front-specific matching bug
   exists in the code — section 1 below proves the symmetry at
   the decision level with the fixture family.

   What the audit DID find, all front/switch-specific:
   (1) The "too dark" advice named Flash on the front camera,
       where the torch cannot light (v48: back-only) — a dead
       end served by B.palmGuidance and the enrolment quality
       gate's hint. Fixed: facing-aware advice (section 2);
       every gate NUMBER is unchanged.
   (2) Cam.start stopped the outgoing stream and blanked the
       preview BEFORE requesting the new camera — a black/frozen
       gap for the whole acquisition. Fixed: the outgoing stream
       is released only once its replacement is attached and
       playing (section 3, functional).
   (3) A switch paid the exact-facing getUserMedia attempt
       first — the classic multi-lens Android Overconstrained
       stall. Fixed: a replacing start asks preference-first;
       cold starts keep the v17 order (section 3).
   (4) The in-flight-start join ignored the facing: a quick
       Front->Back->Front tap joined the first start and the
       camera landed on the opposite facing from the buttons.
       Fixed: the join is facing-aware (section 3).
   (5) The scan loops pace grabs on video.currentTime; a
       replaced stream restarts that clock near zero and only
       the mid-scan swap reset the pacing by hand — a manual
       toggle stalled a running scan until the new clock caught
       up. Fixed: all three loops accept a backward clock
       (section 4, pins).
   (6) The preview mirror was set from the REQUESTED facing
       while the ladder can land on a fallback camera. Fixed:
       the mirror is applied at attach, from the attached
       track's own reported facing (section 3).

   What v57 does NOT claim: the front sensor itself — fixed
   focus (no AF exists to request), a smaller noisier sensor,
   and the palm held close at selfie distance — feeds the same
   absolute bars (the enrolment quality gate's blur/brightness
   bars, MediaPipe detection) worse raw material than the back
   camera. That is physics meeting frozen bars, not a code bug,
   and no bar was moved. The phone is the verdict on the feel.

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
function info(msg) { console.log('  ..  ' + msg); }

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const S = B.PALMPRINT_ROI_SIZE;

/* ============ 1. front/back symmetry at the decision level ====
   The fixture renderer family of palmprint.test.js / the v51
   suite: a synthetic palm's ROI, banked the way enrolment banks
   (selectPalmprintBurstCodes over rendered frames). The "back
   camera" probe is the palm as rendered; the "front camera"
   probe is its horizontal mirror — the exact relationship the
   v45 affine warp produces between the two cameras' ROIs of
   one palm (the warp preserves chirality; see the audit note). */
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function roiImage(creases, seed, size, noiseAmp) {
  const rnd = lcg(seed); const noise = [];
  for (let i = 0; i < size * size; i++) noise.push((rnd() - 0.5) * noiseAmp);
  const g = new Array(size * size); const k = 128 / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x * k, py = y * k;
    let v = 172 + Math.sin(px * 0.045 + 1.7) * 9 + Math.cos(py * 0.06 + 0.4) * 7;
    for (const c of creases) {
      if (c.vert) { const lx = c.a * py + c.b + Math.sin(py * c.f + c.p) * c.amp; const d = Math.abs(px - lx); if (d < 3) v -= (3 - d) * 30; }
      else { const ly = c.a * px + c.b + Math.sin(px * c.f + c.p) * c.amp; const d = Math.abs(py - ly); if (d < 3) v -= (3 - d) * 30; }
    }
    g[y * size + x] = Math.max(0, Math.min(255, Math.round(v + noise[y * size + x])));
  }
  return g;
}
const PALM_A = [{ a: 0.22, b: 26, f: 0.05, p: 1, amp: 3 }, { a: -0.35, b: 92, f: 0.04, p: 3, amp: 4 }, { a: 0.04, b: 62, f: 0.06, p: 5, amp: 3 }, { a: 0.55, b: 18, f: 0.05, p: 2, amp: 3, vert: true }];
const PALM_B = [{ a: -0.05, b: 38, f: 0.04, p: 2, amp: 5 }, { a: 0.18, b: 55, f: 0.07, p: 1, amp: 3 }, { a: -0.5, b: 118, f: 0.05, p: 4, amp: 4 }, { a: 0.85, b: 4, f: 0.04, p: 3, amp: 4, vert: true }];
function framesFor(creases, seed0, flip) {
  const frames = [];
  for (let i = 0; i < 9; i++) {
    let roi = roiImage(creases, seed0 + i * 13, S, 10);
    if (flip) roi = B.flipGrayHorizontal(roi, S, S);
    frames.push({ openness: 2.0, code: B.palmprintEncode(roi, S, S), codeM: null, roi: roi, sharpness: 400 + i * 10, poseTag: null, poseDesc: null, frameComplete: true });
  }
  return frames;
}
const bankA = B.selectPalmprintBurstCodes(framesFor(PALM_A, 5000, false));
const profA = { v: 4, format: 'packed96', codes: bankA.codes }; // hand-less: the twin is in scope, as for any cross-camera pair
const backProbe = B.selectPalmprintLiveRois(framesFor(PALM_A, 9200, false));
const frontProbe = B.selectPalmprintLiveRois(framesFor(PALM_A, 9300, true));
const frontStranger = B.selectPalmprintLiveRois(framesFor(PALM_B, 9400, true));
check('FIXTURE bank and both camera presentations produced ROIs', bankA.codes.length === 3 && backProbe.length > 0 && frontProbe.length > 0);

const vBack = B.verifyPalmprintRois(profA, backProbe);
const vFront = B.verifyPalmprintRois(profA, frontProbe);
check('SYMMETRY the back-camera presentation verifies (exact path)', vBack.verified === true && vBack.similarity >= B.PALMPRINT_THRESHOLD,
  'sim ' + (vBack.similarity && vBack.similarity.toFixed(3)));
check('SYMMETRY the front-camera (mirrored) presentation verifies against the same bank (exact path)', vFront.verified === true && vFront.similarity >= B.PALMPRINT_THRESHOLD,
  'sim ' + (vFront.similarity && vFront.similarity.toFixed(3)));
const vBackFast = B.verifyPalmprintRoisFast(profA, backProbe);
const vFrontFast = B.verifyPalmprintRoisFast(profA, frontProbe);
check('SYMMETRY both presentations verify on the streaming (fast) path too', vBackFast.verified === true && vFrontFast.verified === true,
  'back ' + (vBackFast.similarity && vBackFast.similarity.toFixed(3)) + ' / front ' + (vFrontFast.similarity && vFrontFast.similarity.toFixed(3)));
const vStranger = B.verifyPalmprintRois(profA, frontStranger);
check('SYMMETRY a stranger palm in the front presentation does NOT verify (the twin is not a hole)', vStranger.verified === false,
  'sim ' + (vStranger.similarity && vStranger.similarity.toFixed(3)));

/* PalmNet leg: the app's scoring rule (palmnetScoreEmbeddings)
   takes the MAX over the probe PAIR — the mirror slot is real
   scoring input, not decoration. Synthetic unit embeddings
   (rig): eA is the banked palm; the pair [stranger, eA] models
   a front capture whose plain orientation is the stranger-side
   read and whose twin is the palm itself. */
function unitVec(seed) {
  const rnd = lcg(seed); const v = new Array(B.PALMNET_EMBED_DIM);
  let n = 0; for (let i = 0; i < v.length; i++) { v[i] = rnd() * 2 - 1; n += v[i] * v[i]; }
  n = Math.sqrt(n); for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
const eA = unitVec(4242), eStranger = unitVec(777);
const bankN = B.palmnetBankFromEmbeddings([eA]);
const storedN = { v: 4, format: 'packed96', codes: bankA.codes, neural: bankN };
const bankedN = B.palmnetProfileEmbeddings(storedN);
check('NEURAL the r3-stamped bank reads back for scoring', Array.isArray(bankedN) && bankedN.length === 1 && bankN.model === B.PALMNET_MODEL_ID);
const pairScore = B.palmnetScoreEmbeddings(bankedN, [eStranger, eA]);
const plainScore = B.palmnetScoreEmbeddings(bankedN, [eStranger]);
check('NEURAL the pair score takes the twin slot (front presentation reaches the bar)', typeof pairScore === 'number' && pairScore >= B.PALMNET_THRESHOLD,
  'pair ' + (pairScore && pairScore.toFixed(3)) + ' vs bar ' + B.PALMNET_THRESHOLD);
check('NEURAL the plain slot alone (stranger orientation) stays far under the bar', typeof plainScore === 'number' && plainScore < B.PALMNET_THRESHOLD,
  'plain ' + (plainScore && plainScore.toFixed(3)));
const fusedFront = B.fusePalmVerifyResults({ ok: true, verified: false, similarity: 0.10, threshold: B.PALMPRINT_THRESHOLD }, pairScore);
check('NEURAL the fused decision accepts the front presentation on the PalmNet leg', fusedFront.verified === true && fusedFront.acceptedBy === 'palmnet');

/* ============ 2. facing-aware "too dark" advice =============== */
check('ADVICE the two dark lines are the honest pair', B.PALM_DARK_HINT_BACK === 'Too dark — turn on Flash' &&
  B.PALM_DARK_HINT_FRONT === 'Too dark — face a light, or switch to the back camera to use Flash');
const darkInfo = { hasHand: true, meanLuma: 20, glareFrac: 0, openness: 2.0, sharpness: 400, stable: false };
check('ADVICE palmGuidance on the front camera never names Flash', B.palmGuidance(Object.assign({ facing: 'user' }, darkInfo)) === B.PALM_DARK_HINT_FRONT);
check('ADVICE palmGuidance on the back camera keeps the Flash line', B.palmGuidance(Object.assign({ facing: 'environment' }, darkInfo)) === B.PALM_DARK_HINT_BACK);
check('ADVICE palmGuidance with no facing reported is byte-identical to pre-v57', B.palmGuidance(darkInfo) === B.PALM_DARK_HINT_BACK);
// The enrolment quality gate: a dark patch fails on the SAME
// numbers whatever the facing — only the hint follows the camera.
const darkPatch = new Array(S * S).fill(20);
const gNoFacing = B.palmprintQualityGate(darkPatch, S, S, { hasHand: true, bboxWidthFrac: 0.4 });
const gFront = B.palmprintQualityGate(darkPatch, S, S, { hasHand: true, bboxWidthFrac: 0.4, facing: 'user' });
const gBack = B.palmprintQualityGate(darkPatch, S, S, { hasHand: true, bboxWidthFrac: 0.4, facing: 'environment' });
check('ADVICE the quality gate judges a dark patch identically on both cameras (bars untouched)',
  gNoFacing.pass === false && gFront.pass === false && gBack.pass === false &&
  gFront.mean === gBack.mean && gFront.blur === gBack.blur && gFront.reasons.join() === gBack.reasons.join());
check('ADVICE the quality gate hint follows the camera (front line on front, Flash line otherwise)',
  gFront.hint === B.PALM_DARK_HINT_FRONT && gBack.hint === B.PALM_DARK_HINT_BACK && gNoFacing.hint === B.PALM_DARK_HINT_BACK);
check('WIRING both guidance call sites pass the live facing', (appSrc.match(/facing: liveFacingMode\(\)/g) || []).length === 3,
  'guidance x2 + enrolment gate x1');

/* ============ 3. the switch, functionally (extracted Cam) =====
   The shipped Cam object, extracted from app.js and driven with
   stub devices: scripted getUserMedia, spy tracks, a spy video
   element. This proves the ORDER of operations a switch performs
   — the thing the phone feels — at rig level. */
const camSrc = appSrc.slice(appSrc.indexOf('var Cam = {'), appSrc.indexOf('function cameraErrorHTML'));
check('EXTRACT the Cam object was extracted whole', camSrc.indexOf('start: function') !== -1 && camSrc.indexOf('stop: function') !== -1 && camSrc.length > 4000);
check('SWITCH Cam.start contains no entry stop() (the black gap is gone by construction)', camSrc.indexOf('this.stop()') === -1);
check('SWITCH the camera layer never touches the pipeline (no model/worker reload on a switch)',
  camSrc.indexOf('PalmNet') === -1 && camSrc.indexOf('PalmProc') === -1 && camSrc.indexOf('Pipeline') === -1 && camSrc.indexOf('Match.') === -1 && camSrc.indexOf('Hands') === -1);
check('WIRING the toggle flips the mirror only when no live restart follows',
  appSrc.indexOf('if (!liveRestart) applyMirror(videoId, b.dataset.facing);') !== -1 && appSrc.indexOf('if (liveRestart) restart();') !== -1);

function makeTrack(facing) {
  return { facing: facing, stops: 0,
    stop: function () { this.stops++; },
    getSettings: function () { return { facingMode: this.facing }; },
    getCapabilities: function () { return {}; },
    applyConstraints: function () { return Promise.resolve(); } };
}
function makeStream(facing) {
  const t = makeTrack(facing);
  return { track: t, getTracks: function () { return [t]; }, getVideoTracks: function () { return [t]; } };
}
function makeVideo2() {
  const v = { srcObject: null, mirrorCalls: [], play: function () { return Promise.resolve(); } };
  v.classList = { toggle: function (cls, on) { if (cls === 'mirror') v.mirrorCalls.push(on); } };
  return v;
}
function deferred() { let res, rej; const p = new Promise(function (a, b) { res = a; rej = b; }); return { p: p, res: res, rej: rej }; }
function makeCam(gumImpl) {
  const calls = [];
  const nav = { mediaDevices: { getUserMedia: function (c) { calls.push(c); return gumImpl(c, calls.length); } } };
  // Cam.start's two app-scope companions come with it, extracted
  // verbatim: the start-timeout constant and applyCaptureTuning
  // (the flash names stay undefined here, exactly the typeof-
  // guarded path a view without flash would take).
  const timeoutDecl = (appSrc.match(/var CAM_START_TIMEOUT_MS = \d+;/) || [''])[0];
  const tuningSrc = appSrc.slice(appSrc.indexOf('function applyCaptureTuning'), appSrc.indexOf('function gum('));
  const factory = new Function('navigator', 'B', timeoutDecl + '\n' + tuningSrc + '\n' + camSrc + '\nreturn Cam;');
  return { Cam: factory(nav, B), calls: calls };
}
const tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

async function camChecks() {
  /* Cold start: exact-first (the v17 order is preserved when
     nothing is being replaced). */
  {
    const sUser = makeStream('user');
    const { Cam, calls } = makeCam(function () { return Promise.resolve(sUser); });
    const video = makeVideo2();
    const out = await Cam.start(video, 'user', 'enrollPalm');
    check('COLD start resolves with the stream attached', out === sUser && video.srcObject === sUser && Cam.stream === sUser);
    check('COLD start asks the facing exactly first (v17 order kept)', calls.length === 1 && calls[0].video.facingMode === 'user',
      JSON.stringify(calls[0] && calls[0].video.facingMode));
    check('COLD the mirror follows the attached track (front -> mirrored)', video.mirrorCalls.length >= 1 && video.mirrorCalls[video.mirrorCalls.length - 1] === true);
  }
  /* The switch: the outgoing stream survives until the new one
     is attached and playing; the ladder asks preference-first. */
  {
    const sUser = makeStream('user');
    const sBack = makeStream('environment');
    const gate = deferred();
    let n = 0;
    const { Cam, calls } = makeCam(function () { n++; return n === 1 ? Promise.resolve(sUser) : gate.p; });
    const video = makeVideo2();
    await Cam.start(video, 'user', 'enrollPalm');
    const switching = Cam.start(video, 'environment', 'enrollPalm');
    await tick(); await tick();
    check('SWITCH while the new camera is being acquired, the old stream is untouched (no black gap)',
      sUser.track.stops === 0 && video.srcObject === sUser);
    check('SWITCH a replacing start asks the new facing as a preference first',
      calls.length === 2 && typeof calls[1].video.facingMode === 'object' && calls[1].video.facingMode.ideal === 'environment',
      JSON.stringify(calls[1] && calls[1].video.facingMode));
    gate.res(sBack);
    const out = await switching;
    check('SWITCH the new stream attaches and only then the old tracks stop',
      out === sBack && video.srcObject === sBack && Cam.stream === sBack && sUser.track.stops === 1,
      'old stops=' + sUser.track.stops);
    check('SWITCH the mirror follows the new track (back -> unmirrored)', video.mirrorCalls[video.mirrorCalls.length - 1] === false);
  }
  /* The join: same facing joins; a different facing supersedes. */
  {
    const gate = deferred();
    const sUser = makeStream('user');
    const { Cam, calls } = makeCam(function () { return gate.p; });
    const video = makeVideo2();
    const p1 = Cam.start(video, 'user', 'enrollPalm');
    const p2 = Cam.start(video, 'user', 'enrollPalm');
    check('JOIN a second start for the same view and facing joins the in-flight start', p1 === p2 && calls.length === 1);
    gate.res(sUser);
    await p1;
  }
  {
    const gates = [deferred(), deferred()];
    const sUser = makeStream('user'), sBack = makeStream('environment');
    let n = 0;
    const { Cam, calls } = makeCam(function () { return gates[n++].p; });
    const video = makeVideo2();
    const p1 = Cam.start(video, 'user', 'enrollPalm');
    const p2 = Cam.start(video, 'environment', 'enrollPalm');
    check('JOIN a start for a DIFFERENT facing does not join — it supersedes', p1 !== p2 && calls.length === 2);
    gates[0].res(sUser); // the loser lands late
    await p1;
    check('JOIN the superseded stream is stopped on landing and never attaches', sUser.track.stops === 1 && video.srcObject !== sUser);
    gates[1].res(sBack);
    const out = await p2;
    check('JOIN the winning start attaches its camera', out === sBack && video.srcObject === sBack && Cam.stream === sBack);
  }
  /* NotReadable on a switch: the outgoing camera is released
     before the timed retry (the pre-v57 precondition). */
  {
    const sUser = makeStream('user');
    const sBack = makeStream('environment');
    let n = 0;
    const { Cam } = makeCam(function () {
      n++;
      if (n === 1) return Promise.resolve(sUser);
      if (n === 2) { const e = new Error('busy'); e.name = 'NotReadableError'; return Promise.reject(e); }
      return Promise.resolve(sBack);
    });
    const video = makeVideo2();
    await Cam.start(video, 'user', 'enrollPalm');
    const out = await Cam.start(video, 'environment', 'enrollPalm');
    check('SWITCH NotReadableError releases the outgoing camera and the retry lands the new one',
      out === sBack && video.srcObject === sBack && sUser.track.stops === 1, 'old stops=' + sUser.track.stops);
  }
  /* A failed start leaves no camera running (the pre-v57
     guarantee, restored on the failure path). */
  {
    const sUser = makeStream('user');
    let n = 0;
    const { Cam } = makeCam(function () {
      n++;
      if (n === 1) return Promise.resolve(sUser);
      const e = new Error('denied'); e.name = 'NotAllowedError'; return Promise.reject(e);
    });
    const video = makeVideo2();
    await Cam.start(video, 'user', 'enrollPalm');
    let rejected = false;
    await Cam.start(video, 'environment', 'enrollPalm').then(function () {}, function () { rejected = true; });
    check('SWITCH a start that fails before attaching rejects and releases the outgoing camera',
      rejected === true && sUser.track.stops === 1 && Cam.stream === null, 'old stops=' + sUser.track.stops);
  }
}

/* ============ 4. stream-clock acceptance (pins) =============== */
check('CLOCK all three stream loops accept a replaced stream\'s restarted clock',
  (appSrc.match(/video\.currentTime < lastGrabT - 0\.05/g) || []).length === 3,
  'occurrences=' + (appSrc.match(/video\.currentTime < lastGrabT - 0\.05/g) || []).length);

/* ============ 5. frozen surfaces + version coherence ========= */
check('FROZEN the bars are untouched (EDCC 0.32, PalmNet 0.5895, model palmnet-r3-ep12)',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895 && B.PALMNET_MODEL_ID === 'palmnet-r3-ep12');
/* v58 pin conversion (named, per the v55/v56 precedent): this
   check pinned v57 absolutely; from v58 it is a COHERENCE
   check — app version, shell version and the newest chain
   link must agree, whatever the current version is. */
const v57AppVer = (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1];
const v57ShellVer = (swSrc.match(/tsg-biom-shell-(v\d+)/) || [])[1];
check('VERSION app data version, shell and newest migration link agree (coherence form since v58)',
  !!v57AppVer && v57AppVer === v57ShellVer &&
  v57AppVer === B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1]);

camChecks().then(function () {
  info('rig only: synthetic fixture palms, synthetic embeddings and stub camera devices. The phone verdict — front recognition in his light, the switch feel on his handset — is the real-world proof, and it has not been claimed here.');
  console.log(fail === 0 ? 'ALL v57 CAMERA TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
}).catch(function (e) {
  console.log('FAIL  harness error: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
