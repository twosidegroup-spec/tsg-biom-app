/* TSG Biom — palmprint (EDCC) tests + threshold calibration probes.
   Synthetic palmprint ROIs only: each "palm" is a fixed set of principal
   crease curves; re-renders change noise, brightness and small shifts.
   The printed same-palm / different-palm similarity distributions are
   the calibration evidence for PALMPRINT_THRESHOLD. */
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

/* ---- synthetic palmprint ROI (128x128) ---- */
function roiImage(creases, seed, opts) {
  opts = opts || {};
  const size = opts.size || 128, k = 128 / size, rnd = lcg(seed);
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
  return B.palmprintEncode(img, 128, 128);
}

/* ---------------- ENCODER SANITY ---------------- */
const codeA = encode(PALMS[0], 11, {});
check('ENCODE real synthetic palm -> sane code', B.palmprintCodeSane(codeA));
check('ENCODE null input -> null', B.palmprintEncode(null, 0, 0) === null);
const flatCode = B.palmprintEncode(new Array(128 * 128).fill(170), 128, 128);
check('ENCODE flat image -> code rejected as degenerate', !B.palmprintCodeSane(flatCode));
check('SIMILARITY garbage codes -> null', B.palmprintSimilarity(new Uint8Array(841), codeA) === null && B.palmprintSimilarity(codeA, null) === null);

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

/* ---------------- ROI WARP end-to-end ---------------- */
// 640x480 frame; landmarks chosen axis-aligned so the ROI square is the
// hand-computed rect (168,146)-(440,418): knuckle span 160px, side 272.
function frameWithPalm(creases, seed) {
  const W = 640, H = 480;
  const g = new Array(W * H).fill(90);
  const tex = roiImage(creases, seed, { size: 272 });
  for (let y = 0; y < 272; y++) for (let x = 0; x < 272; x++) {
    g[(146 + y) * W + (168 + x)] = tex[y * 272 + x];
  }
  return { gray: g, w: W, h: H };
}
function landmarks(jx, jy) {
  const lm = [];
  for (let i = 0; i < 21; i++) lm.push({ x: 0.475, y: 0.55, z: 0 });
  lm[0] = { x: 0.475 + jx / 640, y: 0.78 + jy / 480, z: 0 };
  lm[5] = { x: 0.35 + jx / 640, y: 0.35 + jy / 480, z: 0 };
  lm[17] = { x: 0.60 + jx / 640, y: 0.35 + jy / 480, z: 0 };
  return lm;
}
const fA = frameWithPalm(PALMS[0], 41);
const roiA = B.palmRoiFromLandmarks(fA.gray, fA.w, fA.h, landmarks(0, 0));
check('WARP ROI extracted from frame', !!roiA && roiA.length === B.PALMPRINT_ROI_SIZE * B.PALMPRINT_ROI_SIZE);
const wCodeA = B.palmprintEncode(roiA, 128, 128);
check('WARP warped palm encodes sane', B.palmprintCodeSane(wCodeA));
function warpFrames(frame, jitters) {
  return jitters.map(function (j, i) {
    const roi = B.palmRoiFromLandmarks(frame.gray, frame.w, frame.h, landmarks(j[0], j[1]));
    return { openness: 2.0, code: B.palmprintEncode(roi, 128, 128), sharpness: 100 + i };
  });
}
const warpProfile = { v: 3, codes: B.selectPalmprintProfileCodes(warpFrames(fA, [[0, 0], [2, 1], [-2, -1], [1, -2], [-1, 2], [0, 0], [2, -1], [-2, 1], [1, 1]])) };
check('WARP profile from warped frames is sane', B.palmprintProfileSane(warpProfile));
const fB = frameWithPalm(PALMS[1], 42);
let warpGenuineMin = 1, warpImpostorMax = 0;
[[3, -2], [-3, 2], [2, 2], [-2, -3], [0, 3]].forEach(function (j) {
  const rr = B.verifyPalmprintProfile(warpProfile, B.selectPalmprintLiveCodes(warpFrames(fA, [j, [-j[0], j[1]]])));
  if (rr.similarity < warpGenuineMin) warpGenuineMin = rr.similarity;
});
[[0, 0], [2, 2]].forEach(function (j) {
  const rr = B.verifyPalmprintProfile(warpProfile, B.selectPalmprintLiveCodes(warpFrames(fB, [j, [1, -1]])));
  if (rr.similarity > warpImpostorMax) warpImpostorMax = rr.similarity;
});
console.log('  CAL warp genuine min: ' + warpGenuineMin.toFixed(3) + '  warp impostor max: ' + warpImpostorMax.toFixed(3));
check('WARP same palm through jittered warps verified (all trials)', warpGenuineMin >= B.PALMPRINT_THRESHOLD, 'min=' + warpGenuineMin.toFixed(3));
check('WARP different palm through warp denied (all trials)', warpImpostorMax < B.PALMPRINT_THRESHOLD, 'max=' + warpImpostorMax.toFixed(3));
check('WARP degenerate landmarks -> null ROI', B.palmRoiFromLandmarks(fA.gray, fA.w, fA.h, landmarks(0, 0).slice(0, 5)) === null);

/* ---------------- PROFILE FLOW (v3) ---------------- */
function clipFrames(creases, baseSeed, open) {
  const frames = [];
  for (let i = 0; i < 9; i++) {
    frames.push({
      openness: open ? 2.0 : 1.1,
      code: encode(creases, baseSeed + i, { dx: (i % 3) - 1, dy: ((i + 1) % 3) - 1 }),
      sharpness: 100 + i * 10
    });
  }
  return frames;
}
const enrollCodes = B.selectPalmprintProfileCodes(clipFrames(PALMS[0], 51, true));
check('PROFILE enrolment selects 3 codes', !!enrollCodes && enrollCodes.length === 3, enrollCodes ? enrollCodes.length + ' codes' : 'null');
const profile = { v: 3, codes: enrollCodes };
check('PROFILE v3 profile is sane', B.palmprintProfileSane(profile));
check('PROFILE one-code profile rejected', !B.palmprintProfileSane({ v: 3, codes: [enrollCodes[0]] }));
check('PROFILE v2-shaped object is not a palmprint profile', !B.palmprintProfileSane({ v: 2, geometry: [], texture: null }));
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

/* ------------- CALIBRATION: profile-level decision rule -------------
   The product decision is verifyPalmprintProfile (best of 3 enrolled
   codes x 2 live codes). The threshold is calibrated HERE, on that
   rule: genuine = every palm verified against its own profile over
   several fresh clips; impostor = every palm's live codes against
   every other palm's profile. */
let genuineMin = 1, impostorMax = 0;
const profiles = PALMS.map(function (creases, p) {
  return { v: 3, codes: B.selectPalmprintProfileCodes(clipFrames(creases, 100 + p * 10, true)) };
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
