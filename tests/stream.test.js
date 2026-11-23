/* TSG BIOM v20 streaming tests: passive liveness (micro-shift),
   streaming early-exit rule, landmark-alignment invariance, and the
   Web Worker matcher source equivalence. Run: node tests/stream.test.js */
'use strict';
const B = require('../biometrics.js');
const vm = require('vm');
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

/* ---------------- Passive liveness ---------------- */
function poses(list) { return list.map(function (p) { return { cx: p[0], cy: p[1], span: p[2] }; }); }
const frozen = B.passiveLivenessCheck(poses([[0.40, 0.40, 0.25], [0.40, 0.40, 0.25], [0.40, 0.40, 0.25], [0.40, 0.40, 0.25]]));
check('LIVENESS frozen frames are static and fail', frozen.pass === false && frozen.verdict === 'static', 'maxShift=' + frozen.maxShift);
const detectorNoise = B.passiveLivenessCheck(poses([[0.40, 0.40, 0.25], [0.4002, 0.3999, 0.2501], [0.3999, 0.4002, 0.2499], [0.4001, 0.4001, 0.2500]]));
check('LIVENESS detector-noise-only jitter still reads static', detectorNoise.pass === false && detectorNoise.verdict === 'static', 'maxShift=' + detectorNoise.maxShift.toFixed(5));
const natural = B.passiveLivenessCheck(poses([[0.40, 0.40, 0.25], [0.403, 0.401, 0.251], [0.406, 0.403, 0.252], [0.404, 0.406, 0.251]]));
check('LIVENESS natural hand micro-drift passes', natural.pass === true && natural.verdict === 'natural', 'maxShift=' + natural.maxShift.toFixed(4));
const approaching = B.passiveLivenessCheck(poses([[0.40, 0.40, 0.240], [0.401, 0.400, 0.246], [0.402, 0.401, 0.253], [0.402, 0.402, 0.259]]));
check('LIVENESS hand moving closer (span growth) passes', approaching.pass === true, 'spanChange=' + approaching.spanChange.toFixed(3));
const erratic = B.passiveLivenessCheck(poses([[0.40, 0.40, 0.25], [0.41, 0.40, 0.25], [0.75, 0.60, 0.25], [0.76, 0.61, 0.25]]));
check('LIVENESS scene jump is erratic and fails', erratic.pass === false && erratic.verdict === 'erratic', 'maxShift=' + erratic.maxShift.toFixed(3));
const tooFew = B.passiveLivenessCheck(poses([[0.40, 0.40, 0.25], [0.41, 0.41, 0.25]]));
check('LIVENESS fewer than 3 poses is inconclusive, never a pass', tooFew.pass === false && tooFew.verdict === 'inconclusive');
check('LIVENESS palmFramePose reads knuckle midpoint and span', (() => { const lm = []; for (let i = 0; i < 21; i++) lm.push({ x: 0, y: 0 }); lm[5] = { x: 0.35, y: 0.35 }; lm[17] = { x: 0.60, y: 0.35 }; const p = B.palmFramePose(lm); return p && Math.abs(p.cx - 0.475) < 1e-9 && Math.abs(p.span - 0.25) < 1e-9; })());

/* ---------------- Streaming match rule ----------------
   v45 (spec section 5): the judgement is the 1-snap rule — the
   FIRST frame whose packed match reaches the threshold completes
   the scan (the v32 two-frame rolling window is replaced, per
   the user's explicit spec override). streamMatchUpdate now
   tracks the running best for diagnostics and latches done on
   the first passing frame. */
let st = { streak: 0, best: null };
st = B.streamMatchUpdate(st, 0.41);
check('STREAM one passing frame completes (v45 1-snap rule)', st.done === true && st.streak === 1 && st.best === 0.41);
st = B.streamMatchUpdate(st, 0.38);
check('STREAM the win stays latched on later frames', st.done === true && st.best === 0.41);
let st2 = { streak: 0, best: null };
st2 = B.streamMatchUpdate(st2, 0.20);
check('STREAM a below-threshold frame does not complete', st2.done === false && st2.streak === 0 && st2.best === 0.20);
st2 = B.streamMatchUpdate(st2, null);
check('STREAM a code-less frame does not complete and keeps the best', st2.done === false && st2.streak === 0 && st2.best === 0.20);
let st3 = B.streamMatchUpdate(null, B.PALMPRINT_THRESHOLD);
check('STREAM a score exactly at threshold completes', st3.streak === 1 && st3.done === true);

/* ---------------- Landmark alignment invariance ----------------
   A hand presented rotated in the image plane must produce (nearly)
   the same ROI, because the warp frame is built from the landmarks
   themselves - v20 aligns on the wrist -> middle-MCP axis. */
const W = 640, H = 480;
function texImage(seed, fmul) {
  let s = seed;
  const f = fmul || 1;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const g = new Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    g[y * W + x] = Math.max(0, Math.min(255, Math.round(120 + 46 * Math.sin(x * 0.045 * f + y * 0.013 + seed) * Math.cos(y * 0.05 * f - x * 0.007) + 26 * Math.sin((x + y) * 0.11 * f + seed * 2) + (rnd() * 10 - 5))));
  }
  return g;
}
function baseLandmarks() {
  const lm = [];
  for (let i = 0; i < 21; i++) lm.push({ x: 0.475, y: 0.55, z: 0 });
  lm[0] = { x: 0.475, y: 0.78, z: 0 };   // wrist
  lm[5] = { x: 0.35, y: 0.35, z: 0 };    // index MCP
  lm[9] = { x: 0.475, y: 0.35, z: 0 };   // middle MCP
  lm[17] = { x: 0.60, y: 0.35, z: 0 };   // pinky MCP
  return lm;
}
function rotateLandmarks(lm, deg) {
  const rad = deg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  return lm.map(function (p) {
    const dx = p.x * W - cx, dy = p.y * H - cy;
    // rotateGray samples out(x,y) = in(cx + dx cos + dy sin, cy - dx sin + dy cos),
    // so a source point lands at centre + [[cos,-sin],[sin,cos]] * (p - centre).
    const qx = cx + dx * cos - dy * sin, qy = cy + dx * sin + dy * cos;
    return { x: qx / W, y: qy / H, z: 0 };
  });
}
const img = texImage(7);
const roiA = B.palmRoiFromLandmarks(img, W, H, baseLandmarks());
const codeA = B.palmprintEncode(roiA, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE);
[12, -18].forEach(function (deg) {
  const rImg = B.rotateGray(img, W, H, deg);
  const roiR = B.palmRoiFromLandmarks(rImg, W, H, rotateLandmarks(baseLandmarks(), deg));
  const codeR = roiR && B.palmprintEncode(roiR, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE);
  const sim = codeR ? B.palmprintSimilarity(codeA, codeR) : null;
  check('ALIGN hand rotated ' + deg + ' deg still aligns (similarity >= 0.55)', sim !== null && sim >= 0.55, 'sim=' + (sim === null ? 'null' : sim.toFixed(3)));
});

/* ---------------- Worker matcher equivalence ----------------
   The worker source is assembled from the real functions; run it in a
   vm with a captured postMessage and require byte-identical verdicts.
   v45: the profile and the live codes are packed templates. */
const roiCode = codeA;
const packedOf = (bytes) => B.palmprintPackedToBase64(B.palmprintPackCode(bytes));
const profile = { v: 4, format: B.PALMPRINT_FORMAT, codes: [packedOf(roiCode), packedOf(B.palmprintEncode(B.rotateGray(roiA, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE, 2), B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE))] };
const liveOk = [packedOf(roiCode)];
const mainRes = B.verifyPalmprintProfile(profile, liveOk);
check('WORKER fixture: main-thread verify of the same palm passes', mainRes.verified === true, 'sim=' + (mainRes.similarity || 0).toFixed(3));
let captured = null;
const sandbox = { Buffer: Buffer, postMessage: function (m) { captured = m; } };
vm.createContext(sandbox);
vm.runInContext(B.palmprintWorkerSource(), sandbox);
sandbox.onmessage({ data: { id: 42, profile: profile, liveCodes: liveOk } });
check('WORKER replies with the request id', !!captured && captured.id === 42);
check('WORKER verdict matches the main thread exactly', !!captured && !!captured.result && captured.result.verified === mainRes.verified && Math.abs(captured.result.similarity - mainRes.similarity) < 1e-9, captured && captured.result ? 'sim=' + captured.result.similarity.toFixed(3) : 'no result');
const otherImg = texImage(99, 2.3);
const otherRoi = B.palmRoiFromLandmarks(otherImg, W, H, baseLandmarks());
const otherCode = B.palmprintEncode(otherRoi, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE);
captured = null;
sandbox.onmessage({ data: { id: 43, profile: profile, liveCodes: [packedOf(otherCode)] } });
check('WORKER denies a different palm like the main thread', !!captured && !!captured.result && captured.result.verified === false && captured.result.similarity < B.PALMPRINT_THRESHOLD, captured && captured.result ? 'sim=' + captured.result.similarity.toFixed(3) : 'no result');

console.log('stream tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
