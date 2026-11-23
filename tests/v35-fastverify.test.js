/* TSG BIOM v35 tests: the fast streaming verify.
   The verdict rule is unchanged from v33/v34 — same EDCC encoder,
   same score-level MAX over the (probe x enrolled) pairs, same
   0.32 threshold. v35 changes only the ORDER and the amount of
   work:
   - palmprintSimilaritySeeded: branch-and-bound over the code-grid
     translations; must return the identical max.
   - verifyPalmprintRoisFast: lazy probe encodes in priority order
     with a threshold short-circuit. On a pass, the reported score
     is the deciding pair's true score (a lower bound of the full
     max); on a non-pass it must be the full max, bit-identical to
     verifyPalmprintRois.
   - the worker's multi-profile message encodes the probe once;
     each result must equal the per-profile exact call.

   v45 port (2026-11-23): the pair set is the spec's — the probe
   is the ROI's packed template plus its mirror twin, each pair
   scored by the 5-shift popcount matcher; the fast path's
   short-circuit is that matcher plus pair priority order. The
   byte-level reference section below still pins
   palmprintSimilarity against an independent 25-shift reference
   (the byte comparer the packed identity proof stands on).
   Run: node tests/v35-fastverify.test.js */
'use strict';
const B = require('../biometrics.js');
const vm = require('vm');
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

/* ---------------- synthetic palm ROIs (same fixture family as
   palmprint.test.js / v33-maxfusion.test.js) --------------------- */
function lcg(seed) { let s = seed; return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function roiImage(creases, seed, opts) {
  opts = opts || {};
  const size = B.PALMPRINT_ROI_SIZE, rnd = lcg(seed), noise = [];
  for (let i = 0; i < size * size; i++) noise.push((rnd() - 0.5) * 12);
  const dx = opts.dx || 0, dy = opts.dy || 0;
  const g = new Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x + dx, py = y + dy;
    let v = 172 + Math.sin(px * 0.045 + 1.7) * 9 + Math.cos(py * 0.06 + 0.4) * 7;
    for (const c of creases) {
      if (c.vert) { const lx = c.a * py + c.b + Math.sin(py * c.f + c.p) * c.amp; const d = Math.abs(px - lx); if (d < 3) v -= (3 - d) * 30; }
      else { const ly = c.a * px + c.b + Math.sin(px * c.f + c.p) * c.amp; const d = Math.abs(py - ly); if (d < 3) v -= (3 - d) * 30; }
    }
    g[y * size + x] = Math.max(0, Math.min(255, Math.round(v + noise[y * size + x])));
  }
  return g;
}
const PALM_A = [
  { a: 0.22, b: 26, f: 0.05, p: 1, amp: 3 }, { a: -0.35, b: 92, f: 0.04, p: 3, amp: 4 },
  { a: 0.04, b: 62, f: 0.06, p: 5, amp: 3 }, { a: 0.55, b: 18, f: 0.05, p: 2, amp: 3, vert: true },
  { a: -0.12, b: 108, f: 0.05, p: 6, amp: 4 }
];
const PALM_B = [
  { a: -0.05, b: 38, f: 0.04, p: 2, amp: 5 }, { a: 0.18, b: 55, f: 0.07, p: 1, amp: 3 },
  { a: -0.5, b: 118, f: 0.05, p: 4, amp: 4 }, { a: 0.85, b: 4, f: 0.04, p: 3, amp: 4, vert: true }
];
function enrolProfile(creases, seedBase) {
  const frames = [];
  for (let i = 0; i < 9; i++) {
    const roi = roiImage(creases, seedBase + i, { dx: (i % 3) - 1, dy: ((i + 1) % 3) - 1 });
    frames.push({ openness: 2.0, code: B.palmprintEncode(roi, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE), roi: roi, sharpness: 100 + i * 10 });
  }
  return { v: 4, format: B.PALMPRINT_FORMAT, codes: B.selectPalmprintProfileCodes(frames) };
}
const profileA = enrolProfile(PALM_A, 61);
const profileB = enrolProfile(PALM_B, 161);
const liveSame = roiImage(PALM_A, 71, { dx: 1, dy: -1 });
const liveSameFar = roiImage(PALM_A, 73, { dx: 2, dy: 2 });
const liveOther = roiImage(PALM_B, 81);
const liveOther2 = roiImage(PALM_B, 83, { dx: -1, dy: 1 });

/* ------- independent reference: the documented EDCC comparer ----
   score at a code-grid translation = identical packed bytes over
   the overlapping region / overlap count; similarity = max over
   the 25 translations. Written from the rule, not from the
   shipping code, so it pins palmprintSimilarity's refactor. */
function refScoreAtShift(a, b, dx, dy, size) {
  let matches = 0, count = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const bx = x + dx, by = y + dy;
    if (bx < 0 || bx >= size || by < 0 || by >= size) continue;
    count++;
    if (a[y * size + x] === b[by * size + bx]) matches++;
  }
  return count ? matches / count : null;
}
function refSimilarity(a, b) {
  let best = null;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const s = refScoreAtShift(a, b, dx, dy, 64);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}
(function () {
  // Byte-level probe set, enumerated by hand: the ROI re-encoded
  // at the 25 image-level shifts, plain + mirror (the v33 probe
  // expansion, rebuilt here because the shipping probe is packed
  // now). Enrolled codes are the profile's templates unpacked.
  const S = B.PALMPRINT_ROI_SIZE;
  const probes = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    probes.push(B.palmprintEncode(B.shiftGrayClamped(liveSame, S, S, dx, dy), S, S));
    probes.push(B.palmprintEncode(B.flipGrayHorizontal(B.shiftGrayClamped(liveSame, S, S, dx, dy), S, S), S, S));
  }
  const enrolled = profileA.codes.map(function (b64) { return B.palmprintUnpackCode(b64); });
  let allSame = true, worst = 0;
  probes.forEach(function (pc) {
    enrolled.forEach(function (ec) {
      const got = B.palmprintSimilarity(pc, ec), want = refSimilarity(pc, ec);
      if (got !== want) { allSame = false; worst = Math.max(worst, Math.abs(got - want)); }
    });
  });
  check('SIMILARITY palmprintSimilarity equals the independent reference on all fixture pairs', allSame, 'pairs=' + (probes.length * enrolled.length) + ' worst diff ' + worst);
})();

/* ---------------- fast verify: verdict + score contract -------- */
const exactSame = B.verifyPalmprintRois(profileA, [liveSame]);
const fastSame = B.verifyPalmprintRoisFast(profileA, [liveSame]);
check('FAST genuine palm verifies, like the exact path', fastSame.verified === true && exactSame.verified === true, 'fast sim=' + fastSame.similarity.toFixed(3));
check('FAST pass score is at/above threshold and never above the exact full max',
  fastSame.similarity >= B.PALMPRINT_THRESHOLD && fastSame.similarity <= exactSame.similarity + 1e-12,
  'fast=' + fastSame.similarity.toFixed(4) + ' exact=' + exactSame.similarity.toFixed(4));
(function () {
  const probes = B.palmprintProbePacked(liveSame);
  const isPairScore = probes.some(function (pc) {
    return profileA.codes.some(function (ec) { return Math.abs(B.palmprintPackedSimilarity(pc, ec, { exhaustive: true }) - fastSame.similarity) < 1e-12; });
  });
  check('FAST pass score IS one true pair score from the v45 pair set', isPairScore);
})();
const fastFar = B.verifyPalmprintRoisFast(profileA, [liveSameFar]);
/* v45 changed expectation, stated plainly: a (2,2) CONTENT offset
   inside a fixed ROI is a sub-cell shift (the matcher moves whole
   code cells, ±2). The v44 pipeline rescued it by re-encoding the
   ROI at 25 image-level shifts; the spec's matcher does not, and
   this fixture measures 0.192 — below threshold. In the shipped
   app the probe is never a fixed ROI: it is warped from the live
   landmarks, so presentation movement is absorbed by the warp
   (the palmprint suite's WARP section measures that path at
   0.53+). This check pins the limitation where it belongs — on
   the raw matcher — instead of hiding it. */
check('FAST a sub-cell content offset inside a fixed ROI is NOT rescued by the 5-shift code matcher (measured, v45 limitation)',
  fastFar.verified === false && fastFar.similarity < B.PALMPRINT_THRESHOLD, 'sim=' + (fastFar.similarity || 0).toFixed(3));
const fastMirror = B.verifyPalmprintRoisFast(profileA, [B.flipGrayHorizontal(liveSame, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE)]);
check('FAST mirror-twin presentation verifies', fastMirror.verified === true, 'sim=' + (fastMirror.similarity || 0).toFixed(3));

const exactOther = B.verifyPalmprintRois(profileA, [liveOther]);
const fastOther = B.verifyPalmprintRoisFast(profileA, [liveOther]);
check('FAST different palm is denied, like the exact path', fastOther.verified === false && exactOther.verified === false);
check('FAST non-pass score is the FULL max, bit-identical to the exact path (no short-circuit below threshold)',
  fastOther.similarity === exactOther.similarity, 'fast=' + fastOther.similarity.toFixed(6) + ' exact=' + exactOther.similarity.toFixed(6));
(function () {
  const eMulti = B.verifyPalmprintRois(profileA, [liveOther, liveOther2]);
  const fMulti = B.verifyPalmprintRoisFast(profileA, [liveOther, liveOther2]);
  check('FAST multi-ROI non-pass is bit-identical to the exact path', fMulti.verified === eMulti.verified && fMulti.similarity === eMulti.similarity,
    'fast=' + (fMulti.similarity || 0).toFixed(6) + ' exact=' + (eMulti.similarity || 0).toFixed(6));
})();
check('FAST fails closed on a missing profile', B.verifyPalmprintRoisFast(null, [liveSame]).verified === false);
check('FAST fails closed on no live ROI', B.verifyPalmprintRoisFast(profileA, []).verified === false && B.verifyPalmprintRoisFast(profileA, null).verified === false);
check('FAST fails closed on a blank ROI (no readable print)', B.verifyPalmprintRoisFast(profileA, [new Array(B.PALMPRINT_ROI_SIZE * B.PALMPRINT_ROI_SIZE).fill(200)]).verified === false);
check('FAST result shape matches the exact path', fastSame.ok === exactSame.ok && fastSame.threshold === exactSame.threshold && fastSame.reason === exactSame.reason);

/* ---------------- worker: fast + multi-profile ------------------ */
function workerCall(msg) {
  let captured = null;
  const sandbox = { Buffer: Buffer, postMessage: function (m) { captured = m; } };
  vm.createContext(sandbox);
  vm.runInContext(B.palmprintWorkerSource(), sandbox);
  sandbox.onmessage({ data: msg });
  return captured;
}
(function () {
  const wFast = workerCall({ id: 1, profile: profileA, liveRois: [liveSame], fast: true });
  check('WORKER fast verdict + score match the main-thread fast path exactly',
    !!wFast && !!wFast.result && wFast.result.verified === fastSame.verified && wFast.result.similarity === fastSame.similarity,
    wFast && wFast.result ? 'sim=' + wFast.result.similarity.toFixed(4) : 'no result');
  const wFastOther = workerCall({ id: 2, profile: profileA, liveRois: [liveOther], fast: true });
  check('WORKER fast non-pass score is bit-identical to the exact path',
    !!wFastOther && !!wFastOther.result && wFastOther.result.similarity === exactOther.similarity);
  const wMulti = workerCall({ id: 3, profiles: [profileA, profileB], liveRois: [liveOther] });
  const mA = B.verifyPalmprintRois(profileA, [liveOther]);
  const mB = B.verifyPalmprintRois(profileB, [liveOther]);
  check('WORKER multi-profile results equal the per-profile exact calls (probe encoded once)',
    !!wMulti && Array.isArray(wMulti.results) && wMulti.results.length === 2 &&
    wMulti.results[0].similarity === mA.similarity && wMulti.results[0].verified === mA.verified &&
    wMulti.results[1].similarity === mB.similarity && wMulti.results[1].verified === mB.verified,
    wMulti && wMulti.results ? 'A=' + wMulti.results[0].similarity.toFixed(4) + ' B=' + wMulti.results[1].similarity.toFixed(4) : 'no results');
  const wExact = workerCall({ id: 4, profile: profileA, liveRois: [liveSame] });
  check('WORKER exact path untouched (no fast flag): full max, bit-identical',
    !!wExact && !!wExact.result && wExact.result.similarity === exactSame.similarity && wExact.result.verified === true);
})();

console.log('v35 fast-verify tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
