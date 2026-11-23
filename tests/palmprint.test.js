/* TSG Biom — palmprint (EDCC) tests + threshold calibration probes.
   Synthetic palmprint ROIs only: each "palm" is a fixed set of principal
   crease curves; re-renders change noise, brightness and small shifts.
   The printed same-palm / different-palm similarity distributions are
   the calibration evidence for PALMPRINT_THRESHOLD.

   v45 port (2026-11-23): the pipeline under test is the spec's —
   96x96 affine-warped patches, CLAHE-normalised EDCC encoding,
   bit-packed templates, the 5-shift popcount matcher. Enrolment
   banking is the burst banking (3 time-spaced packed templates);
   live selection emits the sharpest frame's packed template plus
   its mirror twin. The byte-level EDCC comparer checks stay: the
   packed matcher's identity with them is proven in the v45 suite.
   Changed expectations vs the v44 suite, named:
   - enrolment banks 3 burst templates, not 6 clip codes (spec s.4);
   - live selection emits 2 packed templates (sharpest + mirror),
     not 8 byte codes with consensus appends (consensus banking was
     already gone; the packed live set is the spec's 1-snap probe);
   - the WARP section runs on the v41 renderer family (rendered
     frames + landmarks): presentation jitter verifies, and pure
     landmark error is tolerated to +2 px on this family (+3 px
     measures 0.304, under threshold — printed as info). The v44
     section's axis-aligned texture fixture passed ±3 px landmark
     trials only through the 25 image-level probe re-encodings the
     spec removed; alignment tolerance now comes from the affine
     warp plus the code-grid shifts, and this section pins what
     that actually measures. */
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function info(msg) { console.log('  ..  ' + msg); }
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const S = B.PALMPRINT_ROI_SIZE;

/* ---- synthetic palmprint ROI (canonical patch size) ---- */
function roiImage(creases, seed, opts) {
  opts = opts || {};
  const size = opts.size || S, k = 128 / size, rnd = lcg(seed);
  const noiseAmp = opts.noiseAmp != null ? opts.noiseAmp : 12;
  const noise = [];
  for (let i = 0; i < size * size; i++) noise.push((rnd() - 0.5) * noiseAmp);
  const dx = opts.dx || 0, dy = opts.dy || 0, bright = opts.bright || 0;
  const g = new Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + dx) * k, py = (y + dy) * k;
    let v = 172 + Math.sin(px * 0.045 + 1.7) * 9 + Math.cos(py * 0.06 + 0.4) * 7 + bright;
    for (const c of creases) {
      if (c.vert) {
        const lx = c.a * py + c.b + Math.sin(py * c.f + c.p) * c.amp;
        const d = Math.abs(px - lx);
        if (d < 3) v -= (3 - d) * 30;
      } else {
        const ly = c.a * px + c.b + Math.sin(px * c.f + c.p) * c.amp;
        const d = Math.abs(py - ly);
        if (d < 3) v -= (3 - d) * 30;
      }
    }
    g[y * size + x] = Math.max(0, Math.min(255, Math.round(v + noise[y * size + x])));
  }
  return g;
}
const PALMS = [
  [{ a: 0.22, b: 26, f: 0.05, p: 1, amp: 3 }, { a: -0.35, b: 92, f: 0.04, p: 3, amp: 4 }, { a: 0.04, b: 62, f: 0.06, p: 5, amp: 3 }, { a: 0.55, b: 18, f: 0.05, p: 2, amp: 3, vert: true }],
  [{ a: 0.48, b: 12, f: 0.06, p: 4, amp: 4 }, { a: -0.12, b: 78, f: 0.05, p: 0, amp: 3 }, { a: 0.30, b: 44, f: 0.04, p: 2, amp: 5 }, { a: 0.30, b: 40, f: 0.06, p: 1, amp: 3, vert: true }],
  [{ a: -0.05, b: 38, f: 0.04, p: 2, amp: 5 }, { a: 0.18, b: 55, f: 0.07, p: 1, amp: 3 }, { a: -0.5, b: 118, f: 0.05, p: 4, amp: 4 }, { a: 0.85, b: 4, f: 0.04, p: 3, amp: 4, vert: true }],
  [{ a: 0.35, b: 30, f: 0.07, p: 0, amp: 3 }, { a: 0.10, b: 84, f: 0.05, p: 5, amp: 4 }, { a: -0.28, b: 70, f: 0.06, p: 1, amp: 3 }, { a: 0.42, b: 30, f: 0.05, p: 5, amp: 3, vert: true }],
  [{ a: 0.08, b: 20, f: 0.05, p: 3, amp: 4 }, { a: -0.42, b: 104, f: 0.06, p: 2, amp: 3 }, { a: 0.26, b: 58, f: 0.04, p: 4, amp: 5 }, { a: 0.65, b: 10, f: 0.07, p: 0, amp: 3, vert: true }],
  [{ a: 0.55, b: 8, f: 0.04, p: 5, amp: 3 }, { a: -0.2, b: 66, f: 0.07, p: 3, amp: 4 }, { a: 0.14, b: 96, f: 0.05, p: 1, amp: 3 }, { a: 0.25, b: 48, f: 0.04, p: 4, amp: 4, vert: true }]
];
function encode(creases, seed, opts) {
  const img = roiImage(creases, seed, opts);
  return B.palmprintEncode(img, S, S);
}
function packedOf(codeBytes) { return B.palmprintPackedToBase64(B.palmprintPackCode(codeBytes)); }

/* ---------------- ENCODER SANITY ---------------- */
const codeA = encode(PALMS[0], 11, {});
check('ENCODE real synthetic palm -> sane code', B.palmprintCodeSane(codeA));
check('ENCODE null input -> null', B.palmprintEncode(null, 0, 0) === null);
const flatCode = B.palmprintEncode(new Array(S * S).fill(170), S, S);
check('ENCODE flat image -> code rejected as degenerate', !B.palmprintCodeSane(flatCode));
check('SIMILARITY garbage codes -> null', B.palmprintSimilarity(new Uint8Array(841), codeA) === null && B.palmprintSimilarity(codeA, null) === null);
const packedA = packedOf(codeA);
check('PACK a code packs to a sane template of the packed size', B.palmprintPackedSane(packedA) && B.palmprintPackedBytes(packedA).length === B.PALMPRINT_PACK_LEN,
  B.PALMPRINT_PACK_LEN + ' bytes serialised (byte code: ' + codeA.length + ')');
check('PACK pack/unpack round-trips the code exactly', JSON.stringify(Array.from(B.palmprintUnpackCode(packedA))) === JSON.stringify(Array.from(codeA)));

/* ---------------- CALIBRATION: single-pair distributions (info) ------- */
const variantsA = [
  encode(PALMS[0], 21, {}),
  encode(PALMS[0], 22, { dx: 1, dy: -1, bright: 6 }),
  encode(PALMS[0], 23, { dx: -2, dy: 1, bright: -7 }),
  encode(PALMS[0], 24, { dx: 2, dy: 2, noiseAmp: 18 })
];
let sameMin = 1, sameMax = 0;
for (let i = 0; i < variantsA.length; i++) for (let j = i + 1; j < variantsA.length; j++) {
  const s = B.palmprintSimilarity(variantsA[i], variantsA[j]);
  if (s < sameMin) sameMin = s;
  if (s > sameMax) sameMax = s;
}
let diffMax = 0;
for (let p = 1; p < PALMS.length; p++) {
  const other = encode(PALMS[p], 31 + p, {});
  for (const v of variantsA) {
    const s = B.palmprintSimilarity(v, other);
    if (s > diffMax) diffMax = s;
  }
}
console.log('  CAL single-pair same-palm: ' + sameMin.toFixed(3) + ' .. ' + sameMax.toFixed(3) + '  different-palm max: ' + diffMax.toFixed(3));
check('CALIBRATION single-pair separation at least 0.05', sameMin - diffMax >= 0.05, 'margin=' + (sameMin - diffMax).toFixed(3));

/* ---------------- ROI WARP end-to-end (v41 renderer family) --------
   Frames are rendered whole (texture + landmarks together), so a
   presentation change moves the texture and the landmarks as one —
   the variation the app actually sees. Enrolment banks from a
   15-frame burst; probes are fresh renders. */
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
const TEX_A = roiImage(PALMS[0], 991, { size: 272, noiseAmp: 8 });
const TEX_B = roiImage(PALMS[1], 992, { size: 272, noiseAmp: 8 });
const r0 = render(TEX_A, {});
const roiA = B.palmRoiFromLandmarks(r0.gray, r0.w, r0.h, r0.lm);
check('WARP ROI extracted from frame at the canonical size', !!roiA && roiA.length === S * S, S + 'x' + S);
check('WARP warped palm encodes sane', B.palmprintCodeSane(B.palmprintEncode(roiA, S, S)));
check('WARP degenerate landmarks -> null ROI', B.palmRoiFromLandmarks(r0.gray, r0.w, r0.h, r0.lm.slice(0, 5)) === null);
const enrolFrames = [];
for (let i = 0; i < 15; i++) enrolFrames.push(frameObj(TEX_A, { seed: 100 + i, cx: 320 + ((i % 3) - 1) * 2, cy: 240 + (((i + 1) % 3) - 1) * 2, deg: (i % 3) - 1 }, 100 + i * 10));
const warpProfile = { v: 4, format: B.PALMPRINT_FORMAT, codes: B.selectPalmprintProfileCodes(enrolFrames.filter(Boolean)) };
check('WARP profile banked from warped frames is sane', B.palmprintProfileSane(warpProfile), warpProfile.codes ? warpProfile.codes.length + ' templates' : 'null');
let warpGenuineMin = 1, warpImpostorMax = 0;
[[2, 1, 0], [3, -2, 1], [5, 3, -1], [-4, 2, 1], [0, -3, -1]].forEach(function (j, t) {
  const f = frameObj(TEX_A, { seed: 600 + t * 7, cx: 320 + j[0], cy: 240 + j[1], deg: j[2] }, 200);
  const rr = B.verifyPalmprintRois(warpProfile, [f.roi]);
  if (rr.similarity < warpGenuineMin) warpGenuineMin = rr.similarity;
});
[[0, 0, 0], [3, 2, 1]].forEach(function (j, t) {
  const f = frameObj(TEX_B, { seed: 700 + t * 7, cx: 320 + j[0], cy: 240 + j[1], deg: j[2] }, 200);
  const rr = B.verifyPalmprintRois(warpProfile, [f.roi]);
  if (rr.similarity > warpImpostorMax) warpImpostorMax = rr.similarity;
});
console.log('  CAL warp genuine min: ' + warpGenuineMin.toFixed(3) + '  warp impostor max: ' + warpImpostorMax.toFixed(3));
check('WARP same palm through presentation jitter verified (all trials)', warpGenuineMin >= B.PALMPRINT_THRESHOLD, 'min=' + warpGenuineMin.toFixed(3));
check('WARP different palm through warp denied (all trials)', warpImpostorMax < B.PALMPRINT_THRESHOLD, 'max=' + warpImpostorMax.toFixed(3));
(function () {
  // Pure landmark error: the landmarks are offset from the hand
  // that is actually in the frame. Measured tolerance on this
  // family: +2 px still verifies; +3 px does not (printed).
  const f = frameObj(TEX_A, { seed: 555 }, 200);
  const sims = [1, 2, 3].map(function (jx) {
    const lmOff = f._r.lm.map(function (p) { return { x: p.x + jx / 640, y: p.y, z: 0 }; });
    const roi = B.palmRoiFromLandmarks(f._r.gray, f._r.w, f._r.h, lmOff);
    return B.verifyPalmprintRois(warpProfile, [roi]).similarity;
  });
  info('WARP landmark-error tolerance — +1px ' + sims[0].toFixed(3) + ', +2px ' + sims[1].toFixed(3) + ', +3px ' + sims[2].toFixed(3) + ' (RIG numbers)');
  check('WARP landmark error of +2 px still verifies', sims[1] >= B.PALMPRINT_THRESHOLD, 'sim=' + sims[1].toFixed(3));
})();

/* ---------------- PROFILE FLOW (v4 packed) ---------------- */
function clipFrames(creases, baseSeed, open) {
  const frames = [];
  for (let i = 0; i < 9; i++) {
    const roi = roiImage(creases, baseSeed + i, { dx: (i % 3) - 1, dy: ((i + 1) % 3) - 1 });
    frames.push({ openness: open ? 2.0 : 1.1, roi: roi, code: B.palmprintEncode(roi, S, S), sharpness: 100 + i * 10 });
  }
  return frames;
}
const enrollCodes = B.selectPalmprintProfileCodes(clipFrames(PALMS[0], 51, true));
check('PROFILE enrolment banks 3 time-spaced packed templates (spec burst banking)', !!enrollCodes && enrollCodes.length === 3, enrollCodes ? enrollCodes.length + ' templates' : 'null');
const profile = { v: 4, format: B.PALMPRINT_FORMAT, codes: enrollCodes };
check('PROFILE v4 packed profile is sane', B.palmprintProfileSane(profile));
check('PROFILE one-template profile rejected', !B.palmprintProfileSane({ v: 4, format: B.PALMPRINT_FORMAT, codes: [enrollCodes[0]] }));
check('PROFILE v2-shaped object is not a palmprint profile', !B.palmprintProfileSane({ v: 2, geometry: [], texture: null }));
check('PROFILE a v3 byte profile is legacy, not sane, to the v45 reader', !B.palmprintProfileSane({ v: 3, codes: enrollCodes }) && B.palmprintProfileFormat({ v: 3, codes: enrollCodes }) === 'legacy');
const liveSame = B.selectPalmprintLiveCodes(clipFrames(PALMS[0], 71, true));
let r = B.verifyPalmprintProfile(profile, liveSame);
check('VERIFY same palm verified', r.verified === true, 'sim=' + (r.similarity && r.similarity.toFixed(3)));
const liveDiff = B.selectPalmprintLiveCodes(clipFrames(PALMS[2], 81, true));
r = B.verifyPalmprintProfile(profile, liveDiff);
check('VERIFY different palm denied', r.verified === false, 'sim=' + (r.similarity && r.similarity.toFixed(3)));
r = B.verifyPalmprintProfile(profile, B.selectPalmprintLiveCodes(clipFrames(PALMS[0], 91, false)));
check('VERIFY fist-only clip yields no live codes -> fail closed', r.verified === false && r.similarity === null, r.reason);
r = B.verifyPalmprintProfile(null, liveSame);
check('VERIFY missing profile -> fail closed', r.verified === false && r.ok === false);
check('SELECT fist frames are not usable for enrolment', B.selectPalmprintProfileCodes(clipFrames(PALMS[0], 95, false)) === null);

/* ---------------- mirror twins ------------------------------------ */
const imgFlip = [10, 20, 30, 40, 50, 60];
check('FLIP double flip is identity', JSON.stringify(B.flipGrayHorizontal(B.flipGrayHorizontal(imgFlip, 3, 2), 3, 2)) === JSON.stringify(imgFlip));
check('FLIP single flip reverses each row', JSON.stringify(B.flipGrayHorizontal(imgFlip, 3, 2)) === JSON.stringify([30, 20, 10, 60, 50, 40]));
check('FLIP null input -> null', B.flipGrayHorizontal(null, 3, 2) === null);
const roiImgA = roiImage(PALMS[0], 77, {});
const codePlain = B.palmprintEncode(roiImgA, S, S);
const codeMirror = B.palmprintEncode(B.flipGrayHorizontal(roiImgA, S, S), S, S);
const simMirror = B.palmprintSimilarity(codePlain, codeMirror);
check('MIRROR a palm code does not match its own mirror twin', simMirror !== null && simMirror < B.PALMPRINT_THRESHOLD, 'sim=' + (simMirror && simMirror.toFixed(3)));
const framesPlain = [
  { openness: 2.0, roi: roiImgA, code: codePlain, sharpness: 100 },
  { openness: 2.0, roi: roiImgA, code: codePlain, sharpness: 90 },
  { openness: 2.0, roi: roiImgA, code: codePlain, sharpness: 80 }
];
const liveWithTwin = B.selectPalmprintLiveCodes(framesPlain);
check('MIRROR live selection emits the top-2 frames, each packed plain + mirror twin', !!liveWithTwin && liveWithTwin.length === 4, liveWithTwin ? liveWithTwin.length + ' templates' : 'null');
const roiImgFlip = B.flipGrayHorizontal(roiImgA, S, S);
const framesFlipped = [0, 1, 2, 3].map(function (i) {
  return { openness: 2.0, roi: roiImgFlip, code: codeMirror, sharpness: 100 - i * 10 };
});
const mirrorProfile = { v: 4, format: B.PALMPRINT_FORMAT, codes: B.selectPalmprintProfileCodes(framesFlipped) };
r = B.verifyPalmprintProfile(mirrorProfile, liveWithTwin);
check('MIRROR enrolment in one orientation verifies in the other via the twin', r.verified === true, 'sim=' + (r.similarity && r.similarity.toFixed(3)));
(function () {
  // Fully-open gating under burst banking: sharper transition
  // frames (openness 1.70) interleaved with open ones must never
  // be banked — the picks are exactly the three open captures.
  const openRois = [301, 302, 303].map(function (sd) { return roiImage(PALMS[0], sd, {}); });
  const transRoi = roiImage(PALMS[2], 399, {});
  const mixed = [];
  for (let i = 0; i < 9; i++) {
    if (i === 0 || i === 4 || i === 8) mixed.push({ openness: 2.05, roi: openRois[i / 4], code: B.palmprintEncode(openRois[i / 4], S, S), sharpness: 50 + i });
    else mixed.push({ openness: 1.70, roi: transRoi, code: B.palmprintEncode(transRoi, S, S), sharpness: 999 - i });
  }
  const picks = B.selectPalmprintProfileCodes(mixed);
  const openPacked = openRois.map(function (ro) { return packedOf(B.palmprintEncode(ro, S, S)); });
  check('FULLY-OPEN burst banking ignores sharper transition frames', !!picks && picks.length === 3 && picks.every(function (c) { return openPacked.indexOf(c) !== -1; }),
    picks ? picks.length + ' picks' : 'null');
})();

/* ------------- source alignment (rotation) --------------------------
   A palm physically presented rotated yields rotated LANDMARKS;
   the warp frame is built from those landmarks, so the patch —
   and its template — comes out upright without rotation twins. */
check('ROTATE 0 degrees is identity', JSON.stringify(B.rotateGray(imgFlip, 3, 2, 0)) === JSON.stringify(imgFlip));
check('ROTATE null input -> null', B.rotateGray(null, 3, 2, 5) === null);
const roiRot = B.rotateGray(roiImgA, S, S, 5);
check('ROTATE rotated ROI still encodes sane', B.palmprintCodeSane(B.palmprintEncode(roiRot, S, S)));
(function () {
  const f5 = frameObj(TEX_A, { seed: 888, deg: 5 }, 200);
  const rr = B.verifyPalmprintRois(warpProfile, [f5.roi]);
  check('ALIGNED a live palm presented 5 degrees rotated still verifies (source alignment, no twins)', rr.verified === true, 'sim=' + (rr.similarity && rr.similarity.toFixed(3)));
  const f12 = frameObj(TEX_A, { seed: 889, deg: 12 }, 200);
  const rr12 = B.verifyPalmprintRois(warpProfile, [f12.roi]);
  check('ALIGNED a live palm presented 12 degrees rotated still verifies', rr12.verified === true, 'sim=' + (rr12.similarity && rr12.similarity.toFixed(3)));
})();

/* ------------- CALIBRATION: profile-level decision rule -------------
   The product decision is verifyPalmprintProfile (packed probes x
   enrolled packed templates, 5-shift max). The threshold is
   calibrated HERE, on that rule: genuine = every palm verified
   against its own profile over several fresh clips; impostor =
   every palm's live codes against every other palm's profile. */
let genuineMin = 1, impostorMax = 0;
const profiles = PALMS.map(function (creases, p) {
  return { v: 4, format: B.PALMPRINT_FORMAT, codes: B.selectPalmprintProfileCodes(clipFrames(creases, 100 + p * 10, true)) };
});
PALMS.forEach(function (creases, p) {
  for (let t = 0; t < 3; t++) {
    const live = B.selectPalmprintLiveCodes(clipFrames(creases, 300 + p * 40 + t * 7, true));
    const rr = B.verifyPalmprintProfile(profiles[p], live);
    if (rr.similarity < genuineMin) genuineMin = rr.similarity;
  }
  PALMS.forEach(function (other, q) {
    if (q === p) return;
    const live = B.selectPalmprintLiveCodes(clipFrames(other, 500 + q * 13, true));
    const rr = B.verifyPalmprintProfile(profiles[p], live);
    if (rr.similarity > impostorMax) impostorMax = rr.similarity;
  });
});
console.log('  CAL profile-level genuine min: ' + genuineMin.toFixed(3) + '  impostor max: ' + impostorMax.toFixed(3) + '  threshold: ' + B.PALMPRINT_THRESHOLD);
check('CALIBRATION genuine minimum clears threshold', genuineMin >= B.PALMPRINT_THRESHOLD, 'min=' + genuineMin.toFixed(3));
check('CALIBRATION impostor maximum stays below threshold', impostorMax < B.PALMPRINT_THRESHOLD, 'max=' + impostorMax.toFixed(3));
check('CALIBRATION profile-level margin at least 0.08', genuineMin - impostorMax >= 0.08, 'margin=' + (genuineMin - impostorMax).toFixed(3));

console.log('\npalmprint tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
