/* TSG BIOM — v45 tests: the Palm-X spec build (the user's explicit
   override, 2026-11-23 18:21 Dhaka: "do whatever in the prompt
   says then tell me", after the costs were put to him twice).

   Coverage, per spec section:
   1. ROI: 96x96 affine warp from Wrist (0), Index MCP (5), Pinky
      MCP (17); whole-hand localisation numbers (bbox fraction).
   1/3. Quality gate with the spec's numbers (mean < 45 rejected,
      > 15% of pixels > 245 rejected, Laplacian blur bar) and the
      spec's hint strings; CLAHE inside the encoder (proven
      indirectly: the identity section's codes come from the
      normalising encoder on both sides).
   3. Bit-packed Uint32Array templates + popcount Hamming: the
      packed score at every one of the 5 shifts is INTEGER-EXACT
      against edccScoreAtShift on the unpacked codes — the proof
      that the 0.32 threshold keeps its meaning.
   3. The 5-shift centre-outward early-exit matcher: a centre hit
      evaluates exactly 1 shift; a non-pass evaluates all 5;
      exhaustive mode logs all 5 (the Field Test toggle's data).
   4. Burst enrolment: exactly 3 time-spaced templates banked;
      burst liveness (micro-shift >= 1.2% + Z variance) passes a
      naturally drifting hand and fails a frozen one.
   5. THE MEASURED CONSEQUENCE, reported without editorialising:
      the tilt band (av 0.90 / 0.85 / 0.80) and the impostor
      maximum under the 5-shift matcher, on the established v41
      fixture family. Flat verifies; rotation verifies (the affine
      warp absorbs in-plane rotation); the tilt band does not
      verify — that is what the spec's matcher measures, and the
      numbers below are the record.
   Migration fixtures live in tests/v38-migration.test.js (the
   v45 section there); the Field Test toggle is pinned by source
   checks here and by the worker-parity exhaustive check.
   All timings are RIG numbers; the phone is the verdict. */
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
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const S = B.PALMPRINT_ROI_SIZE;

/* ---------------- fixture machinery (v41 renderer family) ------- */
function roiImage(creases, seed, opts) {
  opts = opts || {};
  const size = opts.size || 128, k = 128 / size, rnd = lcg(seed);
  const noiseAmp = opts.noiseAmp != null ? opts.noiseAmp : 12;
  const noise = [];
  for (let i = 0; i < size * size; i++) noise.push((rnd() - 0.5) * noiseAmp);
  const g = new Array(size * size);
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
const PALM_C = [{ a: 0.35, b: 30, f: 0.07, p: 0, amp: 3 }, { a: 0.10, b: 84, f: 0.05, p: 5, amp: 4 }, { a: -0.28, b: 70, f: 0.06, p: 1, amp: 3 }, { a: 0.42, b: 30, f: 0.05, p: 5, amp: 3, vert: true }];
const TEX_A = roiImage(PALM_A, 991, { size: 272, noiseAmp: 8 });
const TEX_B = roiImage(PALM_B, 992, { size: 272, noiseAmp: 8 });
const TEX_C = roiImage(PALM_C, 993, { size: 272, noiseAmp: 8 });
function sampleBilinear(img, Sz, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  function v(xx, yy) { xx = Math.max(0, Math.min(Sz - 1, xx)); yy = Math.max(0, Math.min(Sz - 1, yy)); return img[yy * Sz + xx]; }
  return v(x0, y0) * (1 - fx) * (1 - fy) + v(x0 + 1, y0) * fx * (1 - fy) + v(x0, y0 + 1) * (1 - fx) * fy + v(x0 + 1, y0 + 1) * fx * fy;
}
function render(tex, opt) {
  opt = Object.assign({ W: 640, H: 480, S: 272, deg: 0, av: 1, cx: 320, cy: 240, seed: 7, noiseAmp: 10, spanFactor: 1 }, opt || {});
  const W = opt.W, H = opt.H, th = opt.deg * Math.PI / 180;
  const u = { x: Math.cos(th), y: Math.sin(th) }, v = { x: -Math.sin(th), y: Math.cos(th) };
  const C = { x: opt.cx, y: opt.cy }, rnd = lcg(opt.seed);
  const g = new Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - C.x, dy = y - C.y;
    const qx = (dx * u.x + dy * u.y) / opt.S + 0.5;
    const qy = (dx * v.x + dy * v.y) / (opt.S * opt.av) + 0.5;
    let val = 96 + 18 * Math.sin(x * 0.011 + y * 0.007);
    if (qx >= 0 && qx < 1 && qy >= 0 && qy < 1) val = sampleBilinear(tex, 272, qx * 271, qy * 271);
    g[y * W + x] = Math.max(0, Math.min(255, Math.round(val + (rnd() - 0.5) * opt.noiseAmp)));
  }
  const span = (opt.S / 1.7) * opt.spanFactor;
  const Kc = { x: C.x - v.x * 0.42 * (1.7 * span), y: C.y - v.y * 0.42 * (1.7 * span) };
  function pt(du, dv) { return { x: (Kc.x + u.x * du + v.x * dv) / W, y: (Kc.y + u.y * du + v.y * dv) / H, z: 0 }; }
  const lm = [];
  for (let i = 0; i < 21; i++) lm.push(pt(0, -0.3 * span));
  lm[5] = pt(-span / 2, 0); lm[9] = pt(-span / 6, 0); lm[13] = pt(span / 6, 0); lm[17] = pt(span / 2, 0);
  lm[0] = { x: (Kc.x + u.x * (-span / 6) + v.x * span) / W, y: (Kc.y + u.y * (-span / 6) + v.y * span) / H, z: 0 };
  return { gray: g, w: W, h: H, lm: lm };
}
function frameObj(tex, opt, sharp) {
  const r = render(tex, opt);
  const roi = B.palmRoiFromLandmarks(r.gray, r.w, r.h, r.lm);
  if (!roi) return null;
  return { openness: 2.0, code: B.palmprintEncode(roi, S, S), roi: roi, sharpness: sharp || 100, _r: r };
}

/* ---------------- 1. the affine warp ------------------------------ */
(function () {
  check('WARP the canonical patch is 96x96', S === 96 && B.PALMPRINT_FORMAT === 'packed96');
  const r = render(TEX_A, {});
  const roi = B.palmRoiFromLandmarks(r.gray, r.w, r.h, r.lm);
  check('WARP output is a 96x96 patch', !!roi && roi.length === 96 * 96);
  // Orientation: a frame whose palm area carries a left-to-right
  // gradient must warp to a patch whose columns rise left-to-right
  // (the knuckle line stays at the top, index side at the left for
  // this right-hand geometry).
  const W = 640, H = 480;
  const grad = new Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) grad[y * W + x] = Math.round(x / W * 255);
  const gRoi = B.palmRoiFromLandmarks(grad, W, H, r.lm);
  let leftSum = 0, rightSum = 0;
  for (let y = 20; y < 76; y++) for (let x = 0; x < 96; x++) { if (x < 20) leftSum += gRoi[y * 96 + x]; if (x > 75) rightSum += gRoi[y * 96 + x]; }
  check('WARP patch orientation follows the anchors (left column darker than right on an x-gradient)', leftSum < rightSum,
    'left=' + Math.round(leftSum / (56 * 20)) + ' right=' + Math.round(rightSum / (56 * 21)));
  // Anchor mapping: a bright dot at the index MCP lands at the
  // patch's A' anchor (0.10, 0.06) -> about (10, 6).
  const dot = new Array(W * H).fill(40);
  const ix = Math.round(r.lm[5].x * W), iy = Math.round(r.lm[5].y * H);
  for (let y = iy - 2; y <= iy + 2; y++) for (let x = ix - 2; x <= ix + 2; x++) dot[y * W + x] = 250;
  const dRoi = B.palmRoiFromLandmarks(dot, W, H, r.lm);
  let bestI = -1, bestV = -1;
  for (let i = 0; i < dRoi.length; i++) if (dRoi[i] > bestV) { bestV = dRoi[i]; bestI = i; }
  const bx = bestI % 96, by = Math.floor(bestI / 96);
  check('WARP the index-MCP dot lands at the A-prime anchor of the patch', Math.abs(bx - 10) <= 4 && Math.abs(by - 6) <= 4,
    'argmax=(' + bx + ',' + by + ') expected ~(10,6)');
  // Too-small hand: knuckle span under 10% of the frame -> no ROI.
  const tiny = r.lm.map(function (p) { return { x: 0.5 + (p.x - 0.5) * 0.05, y: 0.5 + (p.y - 0.5) * 0.05, z: 0 }; });
  check('WARP a too-small hand yields no ROI', B.palmRoiFromLandmarks(r.gray, r.w, r.h, tiny) === null);
  const frac = B.palmBboxWidthFrac(r.lm);
  check('BBOX the rendered hand spans a sane fraction of the frame width', typeof frac === 'number' && frac > 0.2 && frac < 0.95, 'frac=' + (frac && frac.toFixed(3)));
})();

/* ---------------- 3. packed identity ------------------------------ */
(function () {
  const pairs = [];
  [PALM_A, PALM_B, PALM_C].forEach(function (creases, ci) {
    const img1 = roiImage(creases, 1000 + ci * 10, {});
    const img2 = roiImage(creases, 1000 + ci * 10 + 1, { dx: 1, dy: -1 });
    pairs.push([B.palmprintEncode(img1, S, S), B.palmprintEncode(img2, S, S)]);
  });
  // Cross pairs too.
  pairs.push([B.palmprintEncode(roiImage(PALM_A, 2000, {}), S, S), B.palmprintEncode(roiImage(PALM_B, 2001, {}), S, S)]);
  let exact = true, worst = 0;
  pairs.forEach(function (pr) {
    const pa = B.palmprintPackedWords(B.palmprintPackedToBase64(B.palmprintPackCode(pr[0])));
    const pb = B.palmprintPackedWords(B.palmprintPackedToBase64(B.palmprintPackCode(pr[1])));
    B.PALMPRINT_SHIFTS5.forEach(function (sh) {
      const packedScore = B.edccPackedScoreAtShift(pa, pb, sh[0], sh[1]);
      const byteScore = B.edccScoreAtShift(pr[0], pr[1], sh[0], sh[1], 64);
      if (packedScore !== byteScore) { exact = false; worst = Math.max(worst, Math.abs((packedScore || 0) - (byteScore || 0))); }
    });
    // Exhaustive packed similarity === max over the 5 byte scores.
    let mx = null;
    B.PALMPRINT_SHIFTS5.forEach(function (sh) {
      const s = B.edccScoreAtShift(pr[0], pr[1], sh[0], sh[1], 64);
      if (s !== null && (mx === null || s > mx)) mx = s;
    });
    const simEx = B.palmprintPackedSimilarity(B.palmprintPackedToBase64(B.palmprintPackCode(pr[0])), B.palmprintPackedToBase64(B.palmprintPackCode(pr[1])), { exhaustive: true });
    if (simEx !== mx) { exact = false; worst = Math.max(worst, Math.abs((simEx || 0) - (mx || 0))); }
  });
  check('IDENTITY packed score === unpacked edccScoreAtShift at every one of the 5 shifts, on every fixture pair', exact, 'worst diff ' + worst);
  check('IDENTITY the packed template serialises smaller than the byte code', B.PALMPRINT_PACK_LEN === 2560 && B.PALMPRINT_PACK_LEN < pairs[0][0].length,
    B.PALMPRINT_PACK_LEN + ' vs ' + pairs[0][0].length + ' bytes');
  check('IDENTITY popcount32 counts bits', B.popcount32(0) === 0 && B.popcount32(0xFFFFFFFF) === 32 && B.popcount32(0x0F0F0F0F) === 16);
})();

/* ---------------- 3. early exit ----------------------------------- */
(function () {
  const img = roiImage(PALM_A, 3000, {});
  const self = B.palmprintPackedToBase64(B.palmprintPackCode(B.palmprintEncode(img, S, S)));
  const mSelf = B.palmprintPackedMatch(self, self);
  check('EXIT a centre hit evaluates exactly 1 shift and scores 1.0', mSelf.score === 1 && mSelf.evaluated.length === 1,
    'evaluated=' + mSelf.evaluated.length);
  const other = B.palmprintPackedToBase64(B.palmprintPackCode(B.palmprintEncode(roiImage(PALM_B, 3001, {}), S, S)));
  const mOther = B.palmprintPackedMatch(self, other);
  check('EXIT a non-pass evaluates all 5 shifts', mOther.evaluated.length === 5 && mOther.score < B.PALMPRINT_THRESHOLD,
    'evaluated=' + mOther.evaluated.length + ' score=' + mOther.score.toFixed(3));
  const mEx = B.palmprintPackedMatch(self, other, { exhaustive: true });
  check('EXIT exhaustive mode evaluates all 5 and logs all 5', mEx.evaluated.length === 5 && Array.isArray(mEx.perShift) && mEx.perShift.length === 5 &&
    mEx.perShift[0].dx === 0 && mEx.perShift[0].dy === 0 && mEx.score === mOther.score);
  check('EXIT the shift set is the spec set, centre first', JSON.stringify(B.PALMPRINT_SHIFTS5) === JSON.stringify([[0, 0], [0, -2], [0, 2], [-2, 0], [2, 0]]),
    JSON.stringify(B.PALMPRINT_SHIFTS5));
})();

/* ---------------- 1/3. quality gate ------------------------------- */
(function () {
  const clean = roiImage(PALM_A, 4000, {});
  const gClean = B.palmprintQualityGate(clean, S, S);
  check('GATE a clean textured patch passes', gClean.pass === true && gClean.hint === null, 'mean=' + gClean.mean.toFixed(0) + ' blur=' + Math.round(gClean.blur));
  const dark = clean.map(function (v) { return Math.round(v * 0.15); });
  const gDark = B.palmprintQualityGate(dark, S, S);
  check('GATE mean brightness < 45 is rejected with the spec hint', gDark.pass === false && gDark.mean < 45 && gDark.hint === 'Too dark — turn on Flash',
    'mean=' + gDark.mean.toFixed(1));
  const glare = clean.slice();
  for (let i = 0; i < glare.length; i += 4) glare[i] = 255; // 25% blown
  const gGlare = B.palmprintQualityGate(glare, S, S);
  check('GATE > 15% of pixels > 245 is rejected', gGlare.pass === false && gGlare.glareFrac > 0.15 && gGlare.reasons.some(function (r) { return /Washed out/.test(r); }),
    'glareFrac=' + gGlare.glareFrac.toFixed(2));
  const flatPatch = new Array(S * S).fill(150);
  const gBlur = B.palmprintQualityGate(flatPatch, S, S);
  check('GATE a featureless (blurred-out) patch is rejected on the blur bar', gBlur.pass === false && gBlur.blur < B.PALMPRINT_QUALITY_BLUR_MIN,
    'blur=' + gBlur.blur.toFixed(1) + ' bar=' + B.PALMPRINT_QUALITY_BLUR_MIN);
  check('GATE no hand reads the spec hint', B.palmprintQualityGate(clean, S, S, { hasHand: false }).hint === 'Show open palm');
  check('GATE a too-far palm reads the spec hint', B.palmprintQualityGate(clean, S, S, { hasHand: true, bboxWidthFrac: 0.10 }).hint === 'Move slightly closer');
  check('GATE the spec numbers are the shipped constants', B.PALMPRINT_QUALITY_MIN_BRIGHTNESS === 45 && B.PALMPRINT_QUALITY_MAX_GLARE_FRAC === 0.15 &&
    B.PALMPRINT_BBOX_MIN_FRAC === 0.20 && B.PALMPRINT_BBOX_MAX_FRAC === 0.60);
})();

/* ---------------- 4. burst banking + liveness --------------------- */
(function () {
  const frames = [];
  for (let i = 0; i < 15; i++) frames.push(frameObj(TEX_A, { seed: 100 + i, cx: 320 + ((i % 3) - 1) * 2, cy: 240 + (((i + 1) % 3) - 1) * 2, deg: (i % 3) - 1 }, 100 + i * 10));
  const t0 = Date.now();
  const burst = B.selectPalmprintBurstCodes(frames.filter(Boolean));
  const tBurst = Date.now() - t0;
  check('BURST banks exactly 3 templates', !!burst && burst.codes.length === 3, burst && burst.codes.length + ' templates');
  check('BURST the picks are time-spaced (one per third of the burst)',
    !!burst && burst.picks.length === 3 && burst.picks[0] < 5 && burst.picks[1] >= 5 && burst.picks[1] < 10 && burst.picks[2] >= 10,
    burst && 'picks=' + burst.picks.join(','));
  check('BURST banked templates are sane packed templates', !!burst && burst.codes.every(function (c) { return B.palmprintPackedSane(c); }));
  info('BURST selection + encode + pack over 15 analysed frames: ' + tBurst + ' ms (RIG number; renders excluded — frames were pre-rendered)');
  check('BURST the spec burst constants ship', B.PALMPRINT_BURST_MS === 900 && B.PALMPRINT_BURST_TEMPLATES === 3 &&
    B.PALMPRINT_BURST_MIN_FRAMES === 12 && B.PALMPRINT_BURST_MAX_FRAMES === 18);

  function lmSet(scaleStep, zAmp, framesN) {
    const sets = [];
    for (let i = 0; i < framesN; i++) {
      const lm = [];
      for (let k = 0; k < 21; k++) lm.push({ x: 0.5, y: 0.5, z: 0 });
      const sc = 1 + scaleStep * i;
      lm[5] = { x: 0.5 - 0.08 * sc, y: 0.35, z: (i % 3) * zAmp };
      lm[17] = { x: 0.5 + 0.08 * sc, y: 0.35, z: (i % 3) * zAmp };
      lm[9] = { x: 0.5, y: 0.35, z: (i % 3) * zAmp };
      lm[13] = { x: 0.5 + 0.03 * sc, y: 0.35, z: (i % 3) * zAmp };
      lm[0] = { x: 0.5, y: 0.78, z: (i % 3) * zAmp };
      sets.push(lm);
    }
    return sets;
  }
  // One natural adjustment mid-burst (a 1.5% span step) + depth play.
  const stepSets = lmSet(0, 0.0012, 15);
  stepSets.forEach(function (lm, i) { if (i >= 7) { lm[5] = { x: lm[5].x - 0.0012, y: lm[5].y, z: lm[5].z }; lm[17] = { x: lm[17].x + 0.0012, y: lm[17].y, z: lm[17].z }; } });
  const lvStep = B.palmprintBurstLiveness(stepSets);
  check('LIVENESS a natural mid-burst adjustment (>= 1.2% micro-shift) with depth variance passes', lvStep.pass === true,
    'microShift=' + (lvStep.microShift * 100).toFixed(2) + '% zRange=' + lvStep.zRange.toFixed(4));
  const lvFrozen = B.palmprintBurstLiveness(lmSet(0, 0, 15));
  check('LIVENESS a frozen presentation (photo-like) fails', lvFrozen.pass === false && lvFrozen.microShift === 0 && lvFrozen.zRange === 0);
  const lvCreep = B.palmprintBurstLiveness(lmSet(0.002, 0.0012, 15));
  check('LIVENESS slow creep under 1.2% per frame does not pass the burst gate (the spec bar is a per-frame micro-shift)', lvCreep.pass === false,
    'microShift=' + (lvCreep.microShift * 100).toFixed(2) + '%');
})();

/* ---------------- 5. the measured tilt band + impostor max -------- */
(function () {
  const frames = [];
  for (let i = 0; i < 15; i++) frames.push(frameObj(TEX_A, { seed: 100 + i, cx: 320 + ((i % 3) - 1) * 2, cy: 240 + (((i + 1) % 3) - 1) * 2, deg: (i % 3) - 1 }, 100 + i * 10));
  const profile = { v: 4, format: B.PALMPRINT_FORMAT, codes: B.selectPalmprintProfileCodes(frames.filter(Boolean)) };
  check('MEASURE enrolment banks a sane packed profile', B.palmprintProfileSane(profile), profile.codes.length + ' templates');
  function probe(tex, opt, seed) {
    const f = frameObj(tex, Object.assign({ seed: seed }, opt), 220);
    return B.verifyPalmprintRois(profile, [f.roi]);
  }
  const flat = [0, 1, 2].map(function (i) { return probe(TEX_A, {}, 600 + i).similarity; });
  const t90 = [0, 1, 2].map(function (i) { return probe(TEX_A, { av: 0.90 }, 610 + i).similarity; });
  const t85 = [0, 1, 2].map(function (i) { return probe(TEX_A, { av: 0.85 }, 620 + i).similarity; });
  const t80 = [0, 1, 2].map(function (i) { return probe(TEX_A, { av: 0.80 }, 630 + i).similarity; });
  const span = [0, 1, 2].map(function (i) { return probe(TEX_A, { spanFactor: 1.15 }, 640 + i).similarity; });
  const rot = [0, 1, 2].map(function (i) { return probe(TEX_A, { deg: 8 }, 650 + i).similarity; });
  let impMax = 0;
  [TEX_B, TEX_C].forEach(function (tex, ti) {
    [{}, { av: 0.85 }, { av: 0.90 }].forEach(function (opt, oi) {
      const r = probe(tex, opt, 700 + ti * 10 + oi);
      if (r.similarity > impMax) impMax = r.similarity;
    });
  });
  const fmt = function (a) { return a.map(function (x) { return x.toFixed(3); }).join(', '); };
  info('MEASURED under the v45 5-shift packed matcher (RIG numbers):');
  info('  genuine flat:        ' + fmt(flat));
  info('  genuine tilt av=0.90: ' + fmt(t90));
  info('  genuine tilt av=0.85: ' + fmt(t85));
  info('  genuine tilt av=0.80: ' + fmt(t80));
  info('  genuine span x1.15:   ' + fmt(span));
  info('  genuine rotation 8deg: ' + fmt(rot));
  info('  impostor max (B, C; flat + tilted): ' + impMax.toFixed(3));
  check('MEASURE flat genuine verifies on every trial', flat.every(function (s) { return s >= B.PALMPRINT_THRESHOLD; }), fmt(flat));
  check('MEASURE in-plane rotation verifies on every trial (affine warp)', rot.every(function (s) { return s >= B.PALMPRINT_THRESHOLD; }), fmt(rot));
  check('MEASURE the tilt band scores below threshold on every trial (the spec trade-off, as measured)',
    t90.concat(t85, t80).every(function (s) { return s < B.PALMPRINT_THRESHOLD; }),
    'av0.90 max=' + Math.max.apply(null, t90).toFixed(3) + ' av0.85 max=' + Math.max.apply(null, t85).toFixed(3) + ' av0.80 max=' + Math.max.apply(null, t80).toFixed(3));
  check('MEASURE span x1.15 scores below threshold on every trial', span.every(function (s) { return s < B.PALMPRINT_THRESHOLD; }), fmt(span));
  check('MEASURE impostor maximum stays below threshold', impMax < B.PALMPRINT_THRESHOLD, 'max=' + impMax.toFixed(3));
})();

/* ---------------- worker parity (incl. exhaustive) ---------------- */
(function () {
  function workerCall(msg) {
    let posted = null;
    const sandbox = { Buffer: Buffer, postMessage: function (m) { posted = m; } };
    vm.createContext(sandbox);
    vm.runInContext(B.palmprintWorkerSource(), sandbox);
    sandbox.onmessage({ data: msg });
    return posted;
  }
  const frames = [];
  for (let i = 0; i < 9; i++) frames.push(frameObj(TEX_A, { seed: 100 + i }, 100 + i * 10));
  const profile = { v: 4, format: B.PALMPRINT_FORMAT, codes: B.selectPalmprintProfileCodes(frames.filter(Boolean)) };
  const probeF = frameObj(TEX_A, { seed: 999 }, 200);
  const mFast = B.verifyPalmprintRoisFast(profile, [probeF.roi]);
  const wFast = workerCall({ id: 1, profile: profile, liveRois: [probeF.roi], fast: true });
  check('WORKER fast verdict + score identical to the main thread', !!wFast && !!wFast.result && wFast.result.similarity === mFast.similarity && wFast.result.verified === mFast.verified,
    wFast && wFast.result ? 'sim=' + wFast.result.similarity.toFixed(4) : 'no result');
  const mEx = B.verifyPalmprintRois(profile, [probeF.roi], { exhaustive: true });
  const wEx = workerCall({ id: 2, profile: profile, liveRois: [probeF.roi], exhaustive: true });
  check('WORKER exhaustive verdict + shift log identical to the main thread', !!wEx && !!wEx.result && wEx.result.similarity === mEx.similarity &&
    JSON.stringify(wEx.result.shiftLog) === JSON.stringify(mEx.shiftLog),
    wEx && wEx.result ? 'log entries=' + wEx.result.shiftLog.length : 'no result');
})();

/* ---------------- Field Test toggle + format pins ----------------- */
(function () {
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const idxSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  check('PIN Field Test exhaustive toggle exists on both surfaces', idxSrc.indexOf('id="fieldExhaustiveToggle"') !== -1 && idxSrc.indexOf('id="fieldExhaustiveToggle2"') !== -1);
  check('PIN the toggle persists and feeds the match calls', appSrc.indexOf('biomFieldExhaustive') !== -1 && appSrc.indexOf('fieldExhaustiveOn()') !== -1 && appSrc.indexOf('exhaustive: fieldExhaustiveOn()') !== -1);
  check('PIN the burst ring ships in the enrolment card', idxSrc.indexOf('id="palmBurstRing"') !== -1 && appSrc.indexOf('palmBurstRing') !== -1);
  check('PIN scan latency is recorded in the measured strings', appSrc.indexOf('Scan latency: ') !== -1);
  const legacy = { v: 3, codes: ['AAAA'] };
  check('FORMAT a v3 profile reads legacy with the re-scan reason', B.palmprintProfileFormat(legacy) === 'legacy' && /re-scan/.test(B.palmprintProfileFailReason(legacy)));
  check('FORMAT a v4 packed profile reads packed96', B.palmprintProfileFormat({ v: 4, format: 'packed96', codes: [] }) === 'packed96');
})();

console.log(fail === 0 ? 'ALL V45 TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
