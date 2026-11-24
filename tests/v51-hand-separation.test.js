/* TSG Biom v51 — HAND SEPARATION tests.
   Ordered 2026-11-24 by the Chairman: he tests alone (his
   brother is not always available), so his RIGHT hand must
   function as an independent second identity ("Samir") for
   verification tests, penetration tests and fine-tuning.
   Before v51 the mirror twin collapsed the two hands into one
   identity: every probe is also scored mirrored (front- and
   back-camera captures of the SAME palm are mirror images),
   and a person's two hands are near-mirror images.

   What this suite proves, with fixtures only:
   - CHIRALITY: B.palmAnatomicalHand reads the ANATOMICAL hand
     from the wrist -> index-MCP -> pinky-MCP signed area,
     corrected by camera facing, for both anatomical hands x
     both facings x palm-facing presentation; rotation does not
     flip it; degenerate / near-collinear / unreported-facing
     frames read null (unknown — v50 behaviour); a DORSAL
     presentation reads as the opposite hand (pinned as the
     documented limit — a dorsal presentation yields no
     palmprint ROI in the app, so the reading is never used).
   - THE GATE: a probe whose twin scores ABOVE the bar against
     an opposite-hand profile still does not verify (1:1, exact
     and fast paths), is not an identify candidate (1:N), and
     cannot bank (the v49 guard refuses before scoring); the
     same probe against a same-hand profile verifies as before
     (the twin scoped to its purpose); a null-hand profile with
     a known-hand probe, and a known-hand profile with an
     unknown-hand probe, behave EXACTLY as v50.
   - The worker bundle gates identically (the gate's helpers
     are in the worker's function list and the handler threads
     probeHand).
   - App wiring pins: enrolment records the hand and says so,
     top-up passes the capture hand to the guard and stamps
     hand-less profiles, both scan streams gate both matchers,
     Field Test records carry probeHand / profileHand /
     handGate, the Registry shows the hand.
   Run: node tests/v51-hand-separation.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function info(msg) { console.log('  ..  ' + msg); }

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const bioSrc = fs.readFileSync(path.join(__dirname, '..', 'biometrics.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

/* ---------------- chirality fixtures ---------------------------
   A 21-point landmark set: only indices 0 (wrist), 5 (index
   MCP) and 17 (pinky MCP) are read; the rest sit at the wrist.
   Canonical PALM-FACING layouts in a BACK camera's image space:
   a right palm facing the camera shows its index side on the
   image's right; a left palm shows it on the image's left. A
   FRONT camera sees the x-mirror of the same presentation. */
function lmSet(wrist, indexMcp, pinkyMcp) {
  const lm = [];
  for (let i = 0; i < 21; i++) lm.push({ x: wrist[0], y: wrist[1] });
  lm[0] = { x: wrist[0], y: wrist[1] };
  lm[5] = { x: indexMcp[0], y: indexMcp[1] };
  lm[17] = { x: pinkyMcp[0], y: pinkyMcp[1] };
  return lm;
}
function mirrorX(lm) { return lm.map(function (p) { return { x: 1 - p.x, y: p.y }; }); }
const RIGHT_AS_BACK = lmSet([0.50, 0.85], [0.68, 0.45], [0.34, 0.42]);
const LEFT_AS_BACK = lmSet([0.50, 0.85], [0.32, 0.45], [0.66, 0.42]);

check('CHIRALITY right hand, back camera, palm-facing => right', B.palmAnatomicalHand(RIGHT_AS_BACK, 'environment') === 'right');
check('CHIRALITY left hand, back camera, palm-facing => left', B.palmAnatomicalHand(LEFT_AS_BACK, 'environment') === 'left');
check('CHIRALITY right hand, front camera (mirrored image), palm-facing => right', B.palmAnatomicalHand(mirrorX(RIGHT_AS_BACK), 'user') === 'right');
check('CHIRALITY left hand, front camera (mirrored image), palm-facing => left', B.palmAnatomicalHand(mirrorX(LEFT_AS_BACK), 'user') === 'left');
(function () {
  // In-plane rotation preserves signed area: rotate the
  // right-hand back-camera layout 25 degrees about the wrist.
  const th = 25 * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const rot = RIGHT_AS_BACK.map(function (p) {
    const dx = p.x - 0.50, dy = p.y - 0.85;
    return { x: 0.50 + dx * c - dy * s, y: 0.85 + dx * s + dy * c };
  });
  check('CHIRALITY in-plane rotation (25 deg) does not flip the reading', B.palmAnatomicalHand(rot, 'environment') === 'right');
  // A smaller, lower hand in the frame (different span) reads
  // the same — the ratio gate is scale-free.
  const small = RIGHT_AS_BACK.map(function (p) { return { x: 0.5 + (p.x - 0.5) * 0.5, y: 0.85 + (p.y - 0.85) * 0.5 }; });
  check('CHIRALITY a half-scale presentation reads the same hand', B.palmAnatomicalHand(small, 'environment') === 'right');
})();
/* The documented limit, pinned so it is known: a DORSAL
   presentation (back of the hand to the camera) swaps the
   index/pinky sides in image space, so it reads as the
   opposite hand. It can neither enrol nor match in this app
   (no palmprint ROI), so the reading is never acted on. */
check('CHIRALITY dorsal presentation reads as the opposite hand (documented limit)',
  B.palmAnatomicalHand(mirrorX(RIGHT_AS_BACK), 'environment') === 'left');
/* Degenerate evidence => null (unknown hand, v50 behaviour). */
check('CHIRALITY collinear knuckles (cross = 0) => null',
  B.palmAnatomicalHand(lmSet([0.50, 0.85], [0.68, 0.45], [0.86, 0.05]), 'environment') === null);
check('CHIRALITY within the noise band of the span => null',
  B.palmAnatomicalHand(lmSet([0.50, 0.85], [0.68, 0.45], [0.845, 0.095]), 'environment') === null);
check('CHIRALITY knuckle span too small to read => null',
  B.palmAnatomicalHand(lmSet([0.50, 0.85], [0.505, 0.45], [0.495, 0.45]), 'environment') === null);
check('CHIRALITY unreported facing => null',
  B.palmAnatomicalHand(RIGHT_AS_BACK, null) === null && B.palmAnatomicalHand(RIGHT_AS_BACK, 'selfie') === null);
check('CHIRALITY wrong landmark count => null',
  B.palmAnatomicalHand(RIGHT_AS_BACK.slice(0, 20), 'environment') === null);
check('CHIRALITY non-finite landmark => null',
  B.palmAnatomicalHand(lmSet([0.50, 0.85], [NaN, 0.45], [0.34, 0.42]), 'environment') === null);
check('CHIRALITY missing landmarks => null', B.palmAnatomicalHand(null, 'user') === null);

/* MediaPipe label conversion (cross-check only, never gates). */
check('MP label Left on a front camera => left', B.palmMpHandedness('Left', 'user') === 'left');
check('MP label Right on a front camera => right', B.palmMpHandedness('Right', 'user') === 'right');
check('MP label Left on a back camera => right (unmirrored frame flips the selfie assumption)', B.palmMpHandedness('Left', 'environment') === 'right');
check('MP label Right on a back camera => left', B.palmMpHandedness('Right', 'environment') === 'left');
check('MP label unusable inputs => null',
  B.palmMpHandedness('left', 'user') === null && B.palmMpHandedness(null, 'user') === null && B.palmMpHandedness('Left', null) === null);

/* Consensus + gate primitives. */
check('CONSENSUS strict majority wins', B.palmConsensusHand(['left', 'right', 'left', null]) === 'left' && B.palmConsensusHand(['right', 'right', 'left']) === 'right');
check('CONSENSUS tie => null', B.palmConsensusHand(['left', 'right']) === null);
check('CONSENSUS no known readings => null', B.palmConsensusHand([null, null]) === null && B.palmConsensusHand([]) === null && B.palmConsensusHand(null) === null);
check('GATE truth table: only known-and-different blocks',
  B.handGateBlocks('left', 'right') === true && B.handGateBlocks('right', 'left') === true &&
  B.handGateBlocks('left', 'left') === false && B.handGateBlocks('right', 'right') === false &&
  B.handGateBlocks('left', null) === false && B.handGateBlocks(null, 'right') === false &&
  B.handGateBlocks(null, null) === false && B.handGateBlocks('up', 'left') === false);
check('PROFILE hand reader: recorded hand only, else null',
  B.palmProfileHand({ hand: 'left' }) === 'left' && B.palmProfileHand({ hand: 'right' }) === 'right' &&
  B.palmProfileHand({}) === null && B.palmProfileHand({ hand: 'up' }) === null && B.palmProfileHand(null) === null);

/* ---------------- matcher fixtures (v49 renderer family) ----- */
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const S = B.PALMPRINT_ROI_SIZE;
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
function framesFor(creases, seed0) {
  const frames = [];
  for (let i = 0; i < 9; i++) {
    const roi = roiImage(creases, seed0 + i * 13, S, 10);
    frames.push({ openness: 2.0, code: B.palmprintEncode(roi, S, S), codeM: null, roi: roi, sharpness: 400 + i * 10, poseTag: null, poseDesc: null });
  }
  return frames;
}
/* The "other hand" of an enrolment: the same palm seen mirrored
   (a person's two hands are near-mirror images; the mirror
   render is the exact cross-hand analogue the twin collapses). */
function flippedFrames(frames) {
  return frames.map(function (f) {
    const roi = B.flipGrayHorizontal(f.roi, S, S);
    return { openness: 2.0, code: B.palmprintEncode(roi, S, S), codeM: null, roi: roi, sharpness: f.sharpness, poseTag: null, poseDesc: null };
  });
}
const burstA = B.selectPalmprintBurstCodes(framesFor(PALM_A, 5000));
const burstB = B.selectPalmprintBurstCodes(framesFor(PALM_B, 6000));
const liveFlipA = B.selectPalmprintLiveRois(flippedFrames(framesFor(PALM_A, 9100)));
const livePlainA = B.selectPalmprintLiveRois(framesFor(PALM_A, 9200));
const profNone = { v: 4, format: 'packed96', codes: burstA.codes };
const profLeft = { v: 4, format: 'packed96', codes: burstA.codes, hand: 'left' };
const profBRight = { v: 4, format: 'packed96', codes: burstB.codes, hand: 'right' };
check('FIXTURE burst banking produced 3 templates per palm', burstA.codes.length === 3 && burstB.codes.length === 3);

/* The pre-v51 collapse, measured: the mirrored palm verifies
   against the hand-less profile, twin score above the bar. */
const twinUngated = B.verifyPalmprintRois(profNone, liveFlipA);
check('TWIN (v50 behaviour) the mirrored palm verifies against a hand-less profile',
  twinUngated.verified === true && twinUngated.similarity >= B.PALMPRINT_THRESHOLD,
  'twin sim ' + (twinUngated.similarity && twinUngated.similarity.toFixed(3)) + ' vs bar ' + B.PALMPRINT_THRESHOLD);

/* THE GATE, 1:1 — the same above-bar twin probe against the
   opposite-hand profile must not verify, on either path. */
const gated = B.verifyPalmprintRois(profLeft, liveFlipA, { probeHand: 'right' });
check('GATE cross-hand probe does NOT verify (exact path)', gated.verified === false);
check('GATE the gated judgement is an exclusion, not a score: ok, no similarity, handGate flagged',
  gated.ok === true && gated.similarity === null && gated.handGate === true && gated.probeHand === 'right' && gated.profileHand === 'left');
check('GATE the gated reason names the hands', /Hand gate/.test(gated.reason) && gated.reason.indexOf('right') !== -1 && gated.reason.indexOf('left') !== -1);
const gatedFast = B.verifyPalmprintRoisFast(profLeft, liveFlipA, { probeHand: 'right' });
check('GATE cross-hand probe does NOT verify (fast/streaming path)', gatedFast.verified === false && gatedFast.handGate === true && gatedFast.similarity === null);
const fusedGated = B.fusePalmVerifyResults(gated, null);
check('GATE the gated EDCC result fused with no neural evidence stays unverified', fusedGated.verified === false);

/* SAME HAND — the twin keeps its purpose (front/back tolerance
   for the same hand): mirrored image + left-hand evidence
   verifies; plain image + left-hand evidence verifies. */
const sameHandTwin = B.verifyPalmprintRois(profLeft, liveFlipA, { probeHand: 'left' });
check('SAME-HAND the twin still verifies within a same-hand comparison (front-camera case)',
  sameHandTwin.verified === true && sameHandTwin.similarity >= B.PALMPRINT_THRESHOLD, 'sim ' + (sameHandTwin.similarity && sameHandTwin.similarity.toFixed(3)));
const sameHandPlain = B.verifyPalmprintRois(profLeft, livePlainA, { probeHand: 'left' });
check('SAME-HAND the plain presentation verifies as before', sameHandPlain.verified === true);

/* NULL fallbacks — exactly v50 on either side. */
check('NULL profile hand + known probe hand behaves exactly as v50 (twin verifies)',
  B.verifyPalmprintRois(profNone, liveFlipA, { probeHand: 'right' }).verified === true);
check('NULL probe hand + known profile hand behaves exactly as v50 (twin verifies)',
  B.verifyPalmprintRois(profLeft, liveFlipA, {}).verified === true &&
  B.verifyPalmprintRois(profLeft, liveFlipA, { probeHand: null }).verified === true &&
  B.verifyPalmprintRois(profLeft, liveFlipA).verified === true);

/* THE GATE, 1:N — the cross-hand profile is not a candidate:
   its result carries no similarity, so it can neither win the
   identification nor feed an impostor-max; the same-hand
   profile in the same call still verifies. */
const multi = B.verifyPalmprintProfilesRois([profLeft, profBRight], liveFlipA, { probeHand: 'right' });
check('IDENTIFY the cross-hand profile is excluded (gated, no similarity)',
  multi[0].handGate === true && multi[0].verified === false && multi[0].similarity === null);
check('IDENTIFY the same-call other profile is judged normally (different palm, scored, denied)',
  multi[1].handGate !== true && typeof multi[1].similarity === 'number' && multi[1].verified === false,
  'sim ' + (multi[1].similarity && multi[1].similarity.toFixed(3)));
const impMax = Math.max.apply(null, multi.map(function (r) { return typeof r.similarity === 'number' ? r.similarity : -1; }));
check('IDENTIFY the impostor-max over the gated set excludes the twin score entirely',
  impMax === multi[1].similarity && impMax < B.PALMPRINT_THRESHOLD, 'max ' + impMax.toFixed(3) + ' (ungated twin was ' + twinUngated.similarity.toFixed(3) + ')');
const multiLeft = B.verifyPalmprintProfilesRois([profLeft, profBRight], liveFlipA, { probeHand: 'left' });
check('IDENTIFY with the matching probe hand, the left profile verifies via the twin',
  multiLeft[0].verified === true && multiLeft[0].handGate !== true);

/* WORKER parity — the bundle carries the gate and the handler
   threads probeHand, so a worker match gates identically. */
(function () {
  let captured = null;
  const sandbox = { Buffer: Buffer, postMessage: function (m) { captured = m; } };
  vm.createContext(sandbox);
  vm.runInContext(B.palmprintWorkerSource(), sandbox);
  sandbox.onmessage({ data: { id: 51, profile: profLeft, liveRois: liveFlipA, fast: true, probeHand: 'right' } });
  check('WORKER the gated verdict matches the main thread (excluded, no similarity)',
    !!captured && !!captured.result && captured.result.verified === false && captured.result.handGate === true && captured.result.similarity === null);
  captured = null;
  sandbox.onmessage({ data: { id: 52, profile: profLeft, liveRois: liveFlipA, fast: true, probeHand: 'left' } });
  check('WORKER the same-hand twin verdict matches the main thread (verified)',
    !!captured && !!captured.result && captured.result.verified === true && Math.abs(captured.result.similarity - sameHandTwin.similarity) < 1e-9,
    captured && captured.result ? 'sim=' + captured.result.similarity.toFixed(3) : 'no result');
})();

/* THE GATE at the banking guard — refused BEFORE scoring, so
   neither system's score is even consulted; the identical
   capture with the matching hand passes on its scores. */
function unit(v) { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)); return v.map((x) => x / n); }
function embFrom(seed, base, mix) {
  const rnd = lcg(seed); const v = [];
  for (let i = 0; i < 256; i++) { const r = rnd() * 2 - 1; v.push(base ? base[i] * mix + r * (1 - mix) : r); }
  return unit(v);
}
const embA = embFrom(11, null, 0);
const embA2 = embFrom(12, embA, 0.92);
const candA = B.palmprintPackedCandidates(framesFor(PALM_A, 9000)).list.map(function (c) { return c.words; });
const profDualLeft = { v: 4, format: 'packed96', codes: burstA.codes, neural: B.palmnetBankFromEmbeddings([embA]), hand: 'left' };
let g = B.bankingGuardCheck(profDualLeft, { edccProbes: candA, neuralEmbeddings: [embA2], hand: 'right' });
check('GUARD cross-hand capture is refused even though its scores pass both bars',
  g.status === 'fail' && g.handGate === true && g.via === null && g.probeHand === 'right' && g.profileHand === 'left');
check('GUARD the refusal happens before scoring (neither system consulted)',
  g.edccChecked === false && g.neuralChecked === false && g.edccScore === null && g.neuralScore === null);
g = B.bankingGuardCheck(profDualLeft, { edccProbes: candA, neuralEmbeddings: [embA2], hand: 'left' });
check('GUARD the identical capture with the matching hand passes on its scores',
  g.status === 'pass' && g.via === 'both' && g.handGate === false);
g = B.bankingGuardCheck({ v: 4, format: 'packed96', codes: burstA.codes, neural: B.palmnetBankFromEmbeddings([embA]) }, { edccProbes: candA, neuralEmbeddings: [embA2], hand: 'right' });
check('GUARD a hand-less profile + known-hand capture behaves exactly as v49 (passes on scores)',
  g.status === 'pass' && g.handGate === false);
g = B.bankingGuardCheck(profDualLeft, { edccProbes: candA, neuralEmbeddings: [embA2] });
check('GUARD a known-hand profile + hand-less capture behaves exactly as v49 (passes on scores)',
  g.status === 'pass' && g.handGate === false);
g = B.bankingGuardCheck({ v: 3, format: 'legacy', codes: [], legacyCodes: ['AAAA'], rescanNeeded: true }, { edccProbes: candA, neuralEmbeddings: [embA2], hand: 'right' });
check('GUARD a legacy profile stays uncheckable (it carries no hand to gate against)',
  g.status === 'uncheckable' && g.handGate === false);

/* ---------------- app wiring pins ---------------------------- */
check('APP enrolment records the capture hand on the profile', appSrc.indexOf('hand: capHand') !== -1);
check('APP enrolment states what was recorded', appSrc.indexOf('palm recorded — this profile is the') !== -1);
check('APP frame analysis computes the hand the one shared way', appSrc.indexOf('B.palmAnatomicalHand(lm, facing)') !== -1);
check('APP frame analysis reads the live track facing (not the requested one)', appSrc.indexOf('function liveFacingMode()') !== -1);
check('APP MediaPipe label is captured as a cross-check only', appSrc.indexOf('PalmProc.lastHandedness()') !== -1 && appSrc.indexOf('B.palmMpHandedness(') !== -1);
check('APP Match threads probeHand to the worker messages',
  (appSrc.match(/probeHand: probeHand \}/g) || []).length >= 2);
check('WORKER the match handler threads probeHand into every branch',
  bioSrc.indexOf('probeHand:d.probeHand||null') !== -1);
check('APP both scan streams pass the frame hand into the EDCC match',
  (appSrc.match(/probeHand: r\.hand/g) || []).length >= 2);
check('APP the verify stream gates the PalmNet per-frame score by hand',
  appSrc.indexOf('B.handGateBlocks(r.hand, profileHand)') !== -1);
check('APP the identify stream gates per-candidate PalmNet scores by hand',
  appSrc.indexOf('B.handGateBlocks(r.hand, B.palmProfileHand(p.palmProfile))') !== -1);
check('APP the verify stream states the hand evidence in its measured strings',
  appSrc.indexOf('function handEvidenceStr(probeHand)') !== -1 && appSrc.indexOf("' Probe hand: ' + probeHand + '; profile hand: '") !== -1);
check('APP top-up passes the capture hand to the banking guard', appSrc.indexOf('neuralEmbeddings: good, hand: captureHand') !== -1);
check('APP top-up stamps a hand-less profile from the first passing capture',
  appSrc.indexOf('var stampHand = B.palmProfileHand(person.palmProfile) ? null : captureHand;') !== -1);
check('APP the legacy re-bank records the capture hand', appSrc.indexOf('codes: merged.codes, hand: captureHand') !== -1);
check('APP Field Test records carry the hand evidence as extra fields',
  appSrc.indexOf('rec.probeHand = neural.probeHand') !== -1 && appSrc.indexOf('rec.profileHand = neural.profileHand') !== -1 && appSrc.indexOf('rec.handGate = true') !== -1);
check('APP the Registry shows each profile hand', appSrc.indexOf("B.palmProfileHand(p.palmProfile) === 'left' ? 'Left' : 'Right'") !== -1);
// v52: the two absolute pins below were converted to the
// version-coherence form (the v48/v49/v50 pattern) when v52
// shipped — v51 remains IN the chain as an adoption step; the
// living current-version pins are in v38-migration + the v52
// suite. The hand-separation proofs in this suite are unchanged.
check('VERSION app data version and shell version agree', (function () {
  const dv = (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1];
  const sv = (swSrc.match(/tsg-biom-shell-(v\d+)/) || [])[1];
  return !!dv && dv === sv;
})());
check('VERSION v51 remains in the chain as an adoption step', B.BIOM_DATA_VERSIONS.indexOf('v51') !== -1);

info('rig only: chirality fixtures are synthetic landmark geometry; gate fixtures are synthetic palms. The phone verdict (his two hands, his two profiles) is the real-world proof.');
console.log('\nv51 hand-separation tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
