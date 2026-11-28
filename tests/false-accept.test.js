/* FALSE-ACCEPT suite for TSG Biom - run: bun tests/false-accept.test.js (or node)
   Written after the user's real-phone report: "whenever unknown scan it,
   it give auth right to them."

   BEFORE evidence (same scenarios run against the pre-hardening code on
   2026-11-19, probe scripts):
     - verifyFace(zeros, zeros)            -> verified TRUE  (distance 0)
     - verifyPalm(zeros, zeros)            -> verified TRUE  (distance 0)
     - verifyFace(zeros, near-zeros)       -> verified TRUE  (distance 0.011)
     - fingerprint crafted corr 0.42 + texture 0.97 -> verified TRUE
       (old weighted average: 0.7*0.42 + 0.3*0.97 = 0.584 >= 0.55)
     - dark-noise frame (covered camera) passed the old quality gate
       (ok=true; contrast stretch inflated its "sharpness" to 111,754)
     - palm tiny-hand cluster (5% of frame) produced a descriptor (not null)
   Every one of those must now be DENIED / rejected, while the same-subject
   controls must still VERIFY. */
const B = require('../biometrics.js');
let failures = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail !== undefined ? ' | ' + detail : ''));
  if (!cond) failures++;
}
function pattern(n, seed, amp) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.sin(i * 0.37 + seed) * amp + Math.cos(i * 0.11 + seed * 2) * amp * 0.5);
  return out;
}
function unit(v) { const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)); return v.map(x => x / n); }

/* ---------------- FACE ---------------- */
const faceA = unit(pattern(128, 1, 0.5));
let r = B.verifyFace(faceA, faceA.slice());
check('FACE control: same person verified', r.verified, 'distance=' + r.distance.toFixed(3));
const faceOther = unit(pattern(128, 47, 0.5)); // independent descriptor, ~random direction
r = B.verifyFace(faceA, faceOther);
check('FACE unknown person denied', !r.verified && r.distance > 1.0, 'distance=' + r.distance.toFixed(3) + ' (random unit descriptors sit ~1.4 apart, threshold ' + B.FACE_THRESHOLD + ')');
r = B.verifyFace(new Array(128).fill(0), new Array(128).fill(0));
check('FACE zero-vs-zero descriptor DENIED (was: verified)', !r.verified && !r.ok, r.reason);
r = B.verifyFace(new Array(128).fill(0), faceA);
check('FACE zero stored template DENIED', !r.verified && !r.ok, r.reason);
r = B.verifyFace(faceA, new Array(128).fill(0.001));
check('FACE near-zero live descriptor DENIED', !r.verified && !r.ok, r.reason);
const faceNaN = faceA.slice(); faceNaN[5] = NaN;
r = B.verifyFace(faceA, faceNaN);
check('FACE NaN descriptor DENIED', !r.verified, r.reason);
r = B.verifyFace(faceA, new Array(128).fill(0.08));
check('FACE constant descriptor DENIED', !r.verified && !r.ok, r.reason);
r = B.verifyFace(null, faceA);
check('FACE missing enrollment DENIED', !r.verified && !r.ok, r.reason);

/* ---------------- PALM ---------------- */
function hand(mods) {
  const base = [
    [0.30, 0.55], [0.35, 0.52], [0.39, 0.48], [0.42, 0.44], [0.45, 0.39],
    [0.36, 0.33], [0.37, 0.23], [0.375, 0.15], [0.38, 0.08],
    [0.30, 0.31], [0.30, 0.19], [0.30, 0.10], [0.30, 0.02],
    [0.24, 0.33], [0.235, 0.22], [0.23, 0.14], [0.23, 0.07],
    [0.19, 0.36], [0.17, 0.28], [0.155, 0.22], [0.145, 0.16]
  ];
  return base.map(([x, y], i) => {
    const m = (mods && mods[i]) || {};
    return { x: x * (m.sx || 1) * ((mods && mods.spread) || 1), y: 0.55 + (y - 0.55) * (m.sy || 1), z: 0 };
  });
}
function jitter(lm, amp, seed) {
  return lm.map((p, i) => ({ x: p.x + Math.sin(i * 12.9898 + seed) * amp, y: p.y + Math.cos(i * 78.233 + seed) * amp, z: 0 }));
}
function avgLm(sets) {
  const out = [];
  for (let i = 0; i < 21; i++) {
    let x = 0, y = 0; sets.forEach(s => { x += s[i].x; y += s[i].y; });
    out.push({ x: x / sets.length, y: y / sets.length, z: 0 });
  }
  return out;
}
const palmA = B.palmDescriptorFromLandmarks(hand(null));
check('PALM descriptor built from valid hand', Array.isArray(palmA) && palmA.length === 30);
// control: same hand, MediaPipe-style jitter 0.005, 5-frame averaged (as the app now captures)
const palmSameAvg = B.palmDescriptorFromLandmarks(avgLm([1, 2, 3, 4, 5].map(s => jitter(hand(null), 0.005, s * 11))));
r = B.verifyPalm(palmA, palmSameAvg);
check('PALM control: same hand (jittered, frame-averaged) verified', r.verified, 'distance=' + r.distance.toFixed(4) + ' threshold=' + B.PALM_THRESHOLD);
const palmWide = B.palmDescriptorFromLandmarks(hand({ spread: 1.06 }));
r = B.verifyPalm(palmA, palmWide);
check('PALM different hand (palm 6% wider) denied', !r.verified, 'distance=' + (r.distance === null ? 'null' : r.distance.toFixed(4)));
const mods3 = { spread: 1.05 }; [8, 12, 16, 20].forEach(i => mods3[i] = { sy: 1.03 });
const palmDiff = B.palmDescriptorFromLandmarks(hand(mods3));
r = B.verifyPalm(palmA, palmDiff);
check('PALM different hand (fingers +3%, spread 1.05) denied', !r.verified, 'distance=' + (r.distance === null ? 'null' : r.distance.toFixed(4)));
r = B.verifyPalm(new Array(30).fill(0), new Array(30).fill(0));
check('PALM zero-vs-zero descriptor DENIED (was: verified)', !r.verified && !r.ok, r.reason);
r = B.verifyPalm(palmA, null);
check('PALM missing live descriptor DENIED', !r.verified && !r.ok, r.reason);
check('PALM collapsed landmarks rejected (null)', B.palmDescriptorFromLandmarks(Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }))) === null);
check('PALM tiny hand cluster rejected (null) (was: descriptor built)', B.palmDescriptorFromLandmarks(hand(null).map(p => ({ x: 0.5 + (p.x - 0.3) * 0.05, y: 0.5 + (p.y - 0.3) * 0.05, z: 0 }))) === null);
check('PALM partial landmarks (10 points) rejected (null)', B.palmDescriptorFromLandmarks(hand(null).slice(0, 10)) === null);
const bent = hand(null).map((p, i) => i >= 5 ? { x: p.x, y: 0.55 - (0.55 - p.y) * 0.35, z: 0 } : p); // fingers folded toward palm
check('PALM folded/partial hand rejected (null)', B.palmDescriptorFromLandmarks(bent) === null);

/* ---------------- FINGERPRINT ---------------- */
const W = 192, H = 192;
function ridgeImage(w, h, freq, angle, phase) {
  const g = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.sin((x * Math.cos(angle) + y * Math.sin(angle)) * freq + phase) * 90 + 128 + Math.sin(x * 0.3 + y * 0.2) * 12;
    g[y * w + x] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return g;
}
function fingerRecord(gray, w, h) {
  const enhanced = B.adaptiveThreshold(B.sharpen(B.contrastStretch(gray), w, h), w, h, 8, 12);
  const template = B.downscaleTemplate(enhanced, w, h, 96);
  return { template, texture: B.lbpHistogram(template, 96, 96), quality: B.fingerprintQuality(gray, w, h, enhanced) };
}
const recA = fingerRecord(ridgeImage(W, H, 0.55, 0.6, 0), W, H);
check('FINGER quality gate accepts a real ridge capture', recA.quality.ok, 'std=' + recA.quality.stdDev.toFixed(1) + ' sharpness=' + recA.quality.sharpness.toFixed(1));
r = B.verifyFingerprint(recA, fingerRecord(ridgeImage(W, H, 0.55, 0.6, 0), W, H));
check('FINGER control: same finger verified (both rules pass)', r.verified, 'corr=' + r.correlation.toFixed(3) + ' tex=' + r.textureSimilarity.toFixed(3));
r = B.verifyFingerprint(recA, fingerRecord(ridgeImage(W, H, 1.15, 2.2, 4), W, H));
check('FINGER unknown finger denied', !r.verified, 'corr=' + r.correlation.toFixed(3) + ' tex=' + r.textureSimilarity.toFixed(3));
// both-must-pass, case 1: texture nearly identical but template correlation mediocre (the old average passed this)
function zeroMean(v) { const m = v.reduce((a, b) => a + b, 0) / v.length; return v.map(x => x - m); }
const tBase = zeroMean(Array.from({ length: 9216 }, (_, i) => (Math.sin(i * 0.37) + Math.cos(i * 0.11)) * 25));
const tOrth = zeroMean(Array.from({ length: 9216 }, (_, i) => (Math.sin(i * 1.93 + 4) + Math.cos(i * 0.53)) * 25));
const rho = 0.42;
const tLive = tBase.map((v, i) => rho * v + Math.sqrt(1 - rho * rho) * tOrth[i]);
const texShared = new Array(256).fill(0.002); texShared[10] = 0.25; texShared[60] = 0.20; texShared[120] = 0.062;
const recCraftStored = { template: tBase.map(v => v + 128), texture: texShared };
const recCraftLive = { template: tLive.map(v => v + 128), texture: texShared.slice() };
r = B.verifyFingerprint(recCraftStored, recCraftLive);
check('FINGER corr 0.42 + texture ~1.0 DENIED by both-must-pass (was: verified, score 0.584)', !r.verified && r.correlation < B.FINGER_CORR_MIN, 'corr=' + r.correlation.toFixed(3) + ' tex=' + r.textureSimilarity.toFixed(3));
// both-must-pass, case 2: identical template but wrong texture
const texOther = new Array(256).fill(0.002); texOther[180] = 0.25; texOther[220] = 0.20; texOther[30] = 0.062;
r = B.verifyFingerprint(recCraftStored, { template: recCraftStored.template.slice(), texture: texOther });
check('FINGER corr 1.0 + texture mismatch DENIED by both-must-pass', !r.verified && r.textureSimilarity < B.FINGER_TEXTURE_MIN, 'corr=' + r.correlation.toFixed(3) + ' tex=' + r.textureSimilarity.toFixed(3));
// blank / uniform frames
const blank = new Array(W * H).fill(128);
const blankQ = B.fingerprintQuality(blank, W, H, B.adaptiveThreshold(blank, W, H, 8, 12));
check('FINGER blank uniform frame fails quality gate', !blankQ.ok, 'std=' + blankQ.stdDev.toFixed(2));
// dark noise (covered camera / dark room): tiny per-pixel noise around mean 35
function lcgNoise(w, h, base, seed) {
  let s = seed; const g = new Array(w * h);
  for (let i = 0; i < w * h; i++) { s = (s * 1103515245 + 12345) % 2147483648; g[i] = base + (s % 5) - 2; }
  return g;
}
const dn = lcgNoise(W, H, 35, 12345);
const dnRidge = B.adaptiveThreshold(B.sharpen(B.contrastStretch(dn), W, H), W, H, 10, 12);
const dnQ = B.fingerprintQuality(dn, W, H, dnRidge);
check('FINGER dark-noise frame fails quality gate (was: passed)', !dnQ.ok, 'std=' + dnQ.stdDev.toFixed(2) + ' mean=' + dnQ.meanBrightness.toFixed(0) + ' - ' + dnQ.reason);
r = B.verifyFingerprint(fingerRecord(dn, W, H), fingerRecord(lcgNoise(W, H, 35, 987654), W, H));
check('FINGER noise-vs-noise DENIED', !r.verified, 'corr=' + (r.correlation === null ? 'null' : r.correlation.toFixed(3)));
// degenerate / missing templates
r = B.verifyFingerprint({ template: new Array(9216).fill(255), texture: B.lbpHistogram(new Array(9216).fill(255), 96, 96) }, recA);
check('FINGER flat stored template DENIED', !r.verified && !r.ok, r.reason);
r = B.verifyFingerprint(recA, { template: new Array(9216).fill(0), texture: new Array(256).fill(1 / 256) });
check('FINGER flat live template DENIED', !r.verified && !r.ok, r.reason);
r = B.verifyFingerprint(null, recA);
check('FINGER missing enrollment DENIED', !r.verified && !r.ok, r.reason);
r = B.verifyFingerprint(recA, null);
check('FINGER missing capture DENIED', !r.verified && !r.ok, r.reason);

console.log(failures === 0 ? '\nALL FALSE-ACCEPT TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
