/* TSG BIOM v33 tests: the PalmCode-Bench v25 max-fusion upgrade.
   - shiftGrayClamped implements the benchmark's exact shift rule
     (out(x,y) = src(x-dx, y-dy), edge-clamped sampling).
   - Enrolment banks INDIVIDUAL capture codes only (no consensus).
   - Verification fuses at SCORE level with MAX over the
     (probe x enrolled) pairs.
   - The worker runs the identical ROI path.
   - The live threshold stays 0.32 (phone-calibrated; recalibration
     through the field test is a separate, later step).

   v45 port (2026-11-23): the max rule survives; its operands are
   the spec's. The probe set is the packed template of the ROI
   plus its mirror twin (the 25 image-level re-encodings are
   replaced by the 5-shift code-grid matcher inside each pair
   score), enrolment banks the burst's 3 time-spaced packed
   templates, and the manual MAX below enumerates exactly the
   pairs the verify path scores. Changed expectations are named
   inline where they occur.
   Run: node tests/v33-maxfusion.test.js */
'use strict';
const B = require('../biometrics.js');
const vm = require('vm');
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

/* ---------------- synthetic palm ROIs (same fixture family as
   palmprint.test.js: a smooth base with dark crease curves) -------- */
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

/* ---------------- shift rule ------------------------------------- */
(function () {
  const g = []; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) g.push(y * 10 + x);
  const id = B.shiftGrayClamped(g, 4, 4, 0, 0);
  check('SHIFT (0,0) is the identity', JSON.stringify(id) === JSON.stringify(g));
  const s = B.shiftGrayClamped(g, 4, 4, 1, 0);
  // out(x,y) = src(x-1, y) with clamping: first column replicates the edge.
  check('SHIFT (1,0) moves content right, edge replicated', s[0] === 0 && s[1] === 0 && s[2] === 1 && s[3] === 2 && s[5] === 10, 'row0=' + s.slice(0, 4).join(','));
  const s2 = B.shiftGrayClamped(g, 4, 4, -2, 1);
  // out(0,0) = src(2, -1 clamped to 0) = 2; out(3,3) = src(5 clamped to 3, 2) = 23.
  check('SHIFT (-2,1) clamps both axes', s2[0] === 2 && s2[15] === 23, 'corners ' + s2[0] + ',' + s2[15]);
  check('SHIFT rejects bad input', B.shiftGrayClamped(null, 4, 4, 1, 1) === null && B.shiftGrayClamped([1, 2], 4, 4, 1, 1) === null);
})();

/* ---------------- probe templates -------------------------------- */
const roiA = roiImage(PALM_A, 51);
const probes = B.palmprintProbePacked(roiA);
check('PROBE one ROI expands to 2 packed templates (plain + mirror)', probes.length === 2, 'n=' + probes.length);
check('PROBE every template is a sane packed template', probes.every(function (c) { return B.palmprintPackedSane(c); }));
check('PROBE the plain template unpacks to the ROI\'s own EDCC code', (function () {
  const base = B.palmprintEncode(roiA, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE);
  const unpacked = B.palmprintUnpackCode(probes[0]);
  if (!base || !unpacked || base.length !== unpacked.length) return false;
  for (let i = 0; i < base.length; i++) if (base[i] !== unpacked[i]) return false;
  return true;
})());
check('PROBE rejects a missing / wrong-size ROI', B.palmprintProbePacked(null).length === 0 && B.palmprintProbePacked([1, 2, 3]).length === 0);

/* ---------------- enrolment: individual captures only ------------ */
const framesA = [];
for (let i = 0; i < 9; i++) {
  const roi = roiImage(PALM_A, 61 + i, { dx: (i % 3) - 1, dy: ((i + 1) % 3) - 1 });
  framesA.push({ openness: 2.0, code: B.palmprintEncode(roi, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE), roi: roi, sharpness: 100 + i * 10 });
}
const enrolled = B.selectPalmprintProfileCodes(framesA);
check('ENROL banks 3 individual burst templates (v45: burst banking replaces the 6-code clip banking)', !!enrolled && enrolled.length === 3, 'n=' + (enrolled && enrolled.length));
(function () {
  const framePacked = new Set(framesA.map(function (f) { return B.palmprintPackedToBase64(B.palmprintPackCode(f.code)); }));
  check('ENROL every stored template IS one of the real captures, packed (no fused template)',
    !!enrolled && enrolled.every(function (b64) { return framePacked.has(b64); }));
  const cons = B.palmprintConsensusCode(framesA.slice(0, 6).map(function (f) { return f.code; }));
  const consPacked = cons && B.palmprintPackedToBase64(B.palmprintPackCode(cons));
  check('ENROL the majority-fused consensus template is NOT stored', !!enrolled && (!consPacked || enrolled.indexOf(consPacked) < 0));
})();
const profileA = { v: 4, format: B.PALMPRINT_FORMAT, codes: enrolled };

/* ---------------- verification: the max rule ---------------------- */
const liveSame = roiImage(PALM_A, 71, { dx: 1, dy: -1 });
const liveOther = roiImage(PALM_B, 81);
const rSame = B.verifyPalmprintRois(profileA, [liveSame]);
check('VERIFY genuine palm (re-presented, shifted) verifies', rSame.verified === true, 'sim=' + (rSame.similarity || 0).toFixed(3));
const rOther = B.verifyPalmprintRois(profileA, [liveOther]);
check('VERIFY a different palm is denied', rOther.verified === false && rOther.similarity < B.PALMPRINT_THRESHOLD, 'sim=' + (rOther.similarity || 0).toFixed(3));
(function () {
  // The reported score must be exactly the max over (probe
  // templates x enrolled templates) of the packed similarity —
  // the v25 fusion rule, on the v45 pair set (plain + mirror
  // probes, each scored by the exhaustive 5-shift matcher, which
  // is what the exact verify path computes).
  let best = -1;
  B.palmprintProbePacked(liveSame).forEach(function (pc) {
    enrolled.forEach(function (ec) { const s = B.palmprintPackedSimilarity(pc, ec, { exhaustive: true }); if (s !== null && s > best) best = s; });
  });
  check('VERIFY score equals the manual score-level MAX over all pairs (v45 pair set)', Math.abs(rSame.similarity - best) < 1e-12, 'manual=' + best.toFixed(4) + ' reported=' + rSame.similarity.toFixed(4));
})();
check('VERIFY fails closed on a missing profile', B.verifyPalmprintRois(null, [liveSame]).verified === false);
check('VERIFY fails closed on no live ROI', B.verifyPalmprintRois(profileA, []).verified === false && B.verifyPalmprintRois(profileA, null).verified === false);
check('VERIFY fails closed on a blank ROI (no readable print)', B.verifyPalmprintRois(profileA, [new Array(B.PALMPRINT_ROI_SIZE * B.PALMPRINT_ROI_SIZE).fill(200)]).verified === false);
check('THRESHOLD stays the phone-calibrated 0.32', B.PALMPRINT_THRESHOLD === 0.32);

/* ---------------- live ROI selection ------------------------------ */
(function () {
  const sel = B.selectPalmprintLiveRois(framesA);
  check('LIVE ROI selection returns the top-3 sharpest ROIs', !!sel && sel.length === 3 && sel[0] === framesA[8].roi && sel[2] === framesA[6].roi);
  check('LIVE ROI selection is null when no frame carries an ROI',
    B.selectPalmprintLiveRois([{ openness: 2.0, code: framesA[0].code, sharpness: 5 }]) === null);
})();

/* ---------------- worker equivalence (ROI path) ------------------- */
(function () {
  let captured = null;
  const sandbox = { Buffer: Buffer, postMessage: function (msg) { captured = msg; } };
  vm.createContext(sandbox);
  vm.runInContext(B.palmprintWorkerSource(), sandbox);
  sandbox.onmessage({ data: { id: 7, profile: profileA, liveRois: [liveSame] } });
  check('WORKER ROI verdict matches the main thread exactly',
    !!captured && captured.id === 7 && !!captured.result && captured.result.verified === rSame.verified && Math.abs(captured.result.similarity - rSame.similarity) < 1e-9,
    captured && captured.result ? 'sim=' + captured.result.similarity.toFixed(3) : 'no result');
  captured = null;
  sandbox.onmessage({ data: { id: 8, profile: profileA, liveRois: [liveOther] } });
  check('WORKER ROI path denies a different palm like the main thread',
    !!captured && !!captured.result && captured.result.verified === false,
    captured && captured.result ? 'sim=' + captured.result.similarity.toFixed(3) : 'no result');
})();

console.log('v33 max-fusion tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
