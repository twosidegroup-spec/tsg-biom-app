/* Matching-logic tests for TSG Biom - run: bun tests/biometrics.test.js (or node) */
const B = require('../biometrics.js');
let failures = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail !== undefined ? ' | ' + detail : ''));
  if (!cond) failures++;
}

// Deterministic pseudo-vectors built from math only (no random in product logic;
// test fixtures use fixed arithmetic patterns).
function pattern(n, seed, amp) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.sin(i * 0.37 + seed) * amp + Math.cos(i * 0.11 + seed * 2) * amp * 0.5);
  return out;
}

// FACE: identical passes, clearly different denied, missing fails
const faceA = pattern(128, 1, 0.5);
let r = B.verifyFace(faceA, faceA.slice());
check('face identical verified', r.verified && r.distance === 0, 'distance=' + r.distance);
const faceB = pattern(128, 9, 2.5);
r = B.verifyFace(faceA, faceB);
check('face different denied', r.ok && !r.verified && r.distance > B.FACE_THRESHOLD, 'distance=' + r.distance.toFixed(3));
r = B.verifyFace(faceA, null);
check('face null fails honestly', !r.ok && !r.verified, r.reason);
const faceNear = faceA.map((v, i) => v + Math.sin(i) * 0.01);
r = B.verifyFace(faceA, faceNear);
check('face near-identical verified', r.verified, 'distance=' + r.distance.toFixed(4));

// PALM: landmarks -> descriptor; identical passes, different hand denied, bad input fails
function hand(scale, spread) {
  const lm = [];
  const base = [
    [0, 0], [0.05, 0.03], [0.09, 0.07], [0.12, 0.11], [0.15, 0.16],
    [0.06, 0.22], [0.07, 0.32], [0.075, 0.40], [0.08, 0.47],
    [0.0, 0.24], [0.0, 0.36], [0.0, 0.45], [0.0, 0.53],
    [-0.06, 0.22], [-0.065, 0.33], [-0.07, 0.41], [-0.07, 0.48],
    [-0.11, 0.19], [-0.13, 0.27], [-0.145, 0.33], [-0.155, 0.39]
  ];
  for (const [x, y] of base) lm.push({ x: x * scale * spread, y: y * scale, z: 0 });
  return lm;
}
const palmA = B.palmDescriptorFromLandmarks(hand(1, 1));
check('palm descriptor built (30 dims)', Array.isArray(palmA) && palmA.length === 30, 'len=' + (palmA && palmA.length));
const palmSame = B.palmDescriptorFromLandmarks(hand(2.3, 1)); // same hand, different camera distance
r = B.verifyPalm(palmA, palmSame);
check('palm same hand at different scale verified (normalised)', r.verified, 'distance=' + r.distance.toFixed(4));
const palmOther = B.palmDescriptorFromLandmarks(hand(1, 1.9)); // much wider, different geometry
r = B.verifyPalm(palmA, palmOther);
check('palm different geometry denied', r.ok && !r.verified && r.distance > B.PALM_THRESHOLD, 'distance=' + r.distance.toFixed(3));
check('palm bad landmarks -> null descriptor', B.palmDescriptorFromLandmarks([{ x: 0, y: 0 }]) === null);
r = B.verifyPalm(palmA, null);
check('palm null fails honestly', !r.ok && !r.verified, r.reason);

// FINGERPRINT: synthetic ridge image from fixed sine ridges (fixture, not product data)
function ridgeImage(w, h, freq, angle, phase) {
  const gray = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.sin((x * Math.cos(angle) + y * Math.sin(angle)) * freq + phase) * 90 + 128
      + Math.sin(x * 0.3 + y * 0.2) * 12;
    gray[y * w + x] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return gray;
}
function fingerRecord(gray, w, h) {
  const enhanced = B.adaptiveThreshold(B.sharpen(B.contrastStretch(gray), w, h), w, h, 8, 12);
  const template = B.downscaleTemplate(enhanced, w, h, 96);
  const texture = B.lbpHistogram(template, 96, 96);
  const quality = B.fingerprintQuality(gray, w, h, enhanced);
  return { template, texture, quality };
}
const W = 192, H = 192;
const recA = fingerRecord(ridgeImage(W, H, 0.55, 0.6, 0), W, H);
check('fingerprint quality gate accepts sharp ridge fixture', recA.quality.ok, 'sharpness=' + recA.quality.sharpness.toFixed(1) + ' ridgeDensity=' + recA.quality.ridgeDensity.toFixed(2));
const recSame = fingerRecord(ridgeImage(W, H, 0.55, 0.6, 0), W, H);
r = B.verifyFingerprint(recA, recSame);
check('fingerprint identical verified', r.verified && Math.abs(r.correlation - 1) < 1e-9, 'correlation=' + r.correlation.toFixed(3) + ' score=' + r.score.toFixed(3));
const recOther = fingerRecord(ridgeImage(W, H, 1.15, 2.2, 4), W, H);
r = B.verifyFingerprint(recA, recOther);
check('fingerprint different pattern denied', r.ok && !r.verified && r.score < B.FINGER_THRESHOLD, 'correlation=' + r.correlation.toFixed(3) + ' score=' + r.score.toFixed(3));
const blank = new Array(W * H).fill(128);
const blankQ = B.fingerprintQuality(blank, W, H, B.adaptiveThreshold(blank, W, H, 8, 12));
check('fingerprint blank image fails quality gate', !blankQ.ok && blankQ.sharpness === 0, 'sharpness=' + blankQ.sharpness);
r = B.verifyFingerprint(recA, null);
check('fingerprint null fails honestly', !r.ok && !r.verified, r.reason);
const recBlankTemplate = { template: new Array(96 * 96).fill(255), texture: B.lbpHistogram(new Array(96 * 96).fill(255), 96, 96) };
r = B.verifyFingerprint(recA, recBlankTemplate);
check('fingerprint blank template denied (flat correlation = 0)', !r.verified, 'correlation=' + r.correlation);

// WALLET
check('wallet +880 normalised', B.normaliseWalletNumber('+8801933038706') === '01933038706', B.normaliseWalletNumber('+8801933038706'));
check('wallet 880 normalised', B.normaliseWalletNumber('8801933038706') === '01933038706');
check('wallet plain accepted', B.normaliseWalletNumber('01933-038706') === '01933038706');
check('wallet invalid rejected', B.normaliseWalletNumber('019330387061') === null && B.normaliseWalletNumber('12345') === null);
check('wallet masked', B.maskWalletNumber('01933038706') === '01933-***706', B.maskWalletNumber('01933038706'));

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
