/* TSG Biom — v41 regression: the genuine-reject fix.
   Trigger (the Chairman's phone, 2026-11-23 15:26): a smooth v40
   enrolment, then the payment-terminal scan ran 11,752 ms and ended
   NOT VERIFIED on his OWN palm — similarity 0.207, best single
   frame 0.242, threshold 0.32, no spoof complaint (the v40 hull
   fix held). No frame matched, so the scan ran its full no-match
   length: the slowness and the refusal were one root cause.

   PHASE 1 DIAGNOSIS (this harness: fixture palms rendered into
   640x480 frames with true landmarks, warped + encoded by the
   shipped path, ONE factor varied at a time). Ranked table —
   genuine score under the v40 (base) rule, enrolment at the flat
   base pose, baseline 0.536:
     out-of-plane tilt av=0.90 ......... 0.292  DOMINANT
     out-of-plane tilt av=0.85 ......... 0.224  (= his 0.21-0.24)
     out-of-plane tilt av=0.80 ......... 0.196
     out-of-plane tilt av=0.75 ......... 0.169
     knuckle-span read x1.15 ........... 0.238
     knuckle-span read x1.10 ........... 0.259
     knuckle-span read x0.90 ........... 0.314
     landmark jitter 12 px ............. 0.230
     landmark jitter 8 px .............. 0.287
     probe scale x0.6..x1.3 ............ 0.559-0.589  innocent
     in-plane rotation +-25 deg ........ 0.573-0.594  innocent
     ROI from 480px copy (v38 cuts) .... 0.517        innocent
     enrolment self-consistency ........ 0.531-0.678 mutual, healthy
   The tilt mechanism: palmRoiCornersPx builds a SQUARE from the
   knuckle span; a palm angled to the camera foreshortens along
   the wrist axis (the axis the span does not measure), so the
   print is encoded vertically compressed and no translation
   search recovers it.

   PHASE 2 FIX (probe-side only): PALMPRINT_GEO_VARIANTS re-encodes
   of the probe ROI — vertical stretches/squeezes and isotropic
   zooms — join the v33 max rule in both verify paths and the
   worker. Enrolled codes are untouched: existing enrolments
   benefit with no re-enrolment. This suite proves the indicted
   conditions now verify, impostors under the same conditions
   still do not, and the fast/exact pair-set identity holds.
   Run: node tests/v41-geovariants.test.js */
'use strict';
const B = require('../biometrics.js');
const vm = require('vm');
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function info(msg) { console.log('  ..  ' + msg); }

/* ---------------- fixture palms + frame renderer -----------------
   Same crease-curve palm family as palmprint.test.js, rendered at
   272px texture size, then placed into a 640x480 frame by a hand
   transform (centre, side, in-plane rotation, vertical
   foreshortening av, knuckle-span reporting factor) with the TRUE
   landmarks of that presentation. */
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
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
const TEX_A = roiImage(PALM_A, 991, { size: 272, noiseAmp: 8 });
const TEX_B = roiImage(PALM_B, 992, { size: 272, noiseAmp: 8 });
function sampleBilinear(img, S, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  function v(xx, yy) { xx = Math.max(0, Math.min(S - 1, xx)); yy = Math.max(0, Math.min(S - 1, yy)); return img[yy * S + xx]; }
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
  return { openness: 2.0, code: B.palmprintEncode(roi, 128, 128), roi: roi, sharpness: sharp || 100 };
}
function enrol(tex, baseOpt, seed0) {
  const frames = [];
  for (let i = 0; i < 9; i++) {
    frames.push(frameObj(tex, Object.assign({}, baseOpt, { seed: seed0 + i, cx: 320 + ((i % 3) - 1) * 2, cy: 240 + (((i + 1) % 3) - 1) * 2, deg: (baseOpt.deg || 0) + (i % 3) - 1 }), 100 + i * 10));
  }
  const codes = B.selectPalmprintProfileCodes(frames.filter(Boolean));
  return codes ? { v: 3, codes: codes } : null;
}
function probeRois(tex, optList) {
  const frames = optList.map(function (o, i) { return frameObj(tex, o, 200 + i * 10); }).filter(Boolean);
  return B.selectPalmprintLiveRois(frames);
}
/* The v40 rule: base probe codes only, scored by verifyPalmprintProfile. */
function baseOnlyScore(profile, rois) {
  let codes = [];
  rois.forEach(function (roi) { B.palmprintProbeCodes(roi).forEach(function (c) { codes.push(c); }); });
  const r = B.verifyPalmprintProfile(profile, codes);
  return r.similarity;
}
function seeds(base, n, extra) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Object.assign({ seed: base + i }, extra || {}));
  return out;
}

/* ---------------- the resample primitive ------------------------- */
(function () {
  const g = []; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) g.push(y * 10 + x);
  check('SCALE zoom 1 is the identity', JSON.stringify(B.scaleGrayCentre(g, 4, 4, 1, 1)) === JSON.stringify(g));
  check('SCALE rejects bad input', B.scaleGrayCentre(null, 4, 4, 1, 1) === null && B.scaleGrayCentre(g, 4, 4, 0, 1) === null && B.scaleGrayCentre(g, 4, 4, 1, -2) === null);
  const geo = B.palmprintProbeCodesGeo(roiImage(PALM_A, 51));
  check('GEO one ROI expands to 18 codes (9 variants x plain + mirror)', geo.length === 18, 'n=' + geo.length);
  check('GEO every code is a sane 4096-byte EDCC code', geo.every(function (c) { return B.palmprintCodeSane(c) && c.length === 4096; }));
  check('GEO rejects a missing / wrong-size ROI', B.palmprintProbeCodesGeo(null).length === 0 && B.palmprintProbeCodesGeo([1, 2, 3]).length === 0);
})();

/* ---------------- enrolment at the flat base pose ---------------- */
const profile = enrol(TEX_A, {}, 100);
check('ENROL fixture profile banks codes', !!profile && profile.codes.length >= 2, profile ? profile.codes.length + ' codes' : 'null');

/* ---------------- the indicted conditions ------------------------ */
const CONDITIONS = [
  { name: 'tilt av=0.85 (his failure band)', extra: { av: 0.85 }, seed: 230 },
  { name: 'tilt av=0.75', extra: { av: 0.75 }, seed: 330 },
  { name: 'tilt av=0.70', extra: { av: 0.70 }, seed: 430 },
  { name: 'knuckle-span read x1.15', extra: { spanFactor: 1.15 }, seed: 240 },
  { name: 'knuckle-span read x0.90', extra: { spanFactor: 0.90 }, seed: 340 },
  { name: 'combined scale 0.85 + rotation 8 + tilt av=0.85', extra: { S: 272 * 0.85, deg: 8, av: 0.85 }, seed: 290 }
];
CONDITIONS.forEach(function (cond) {
  const rois = probeRois(TEX_A, seeds(cond.seed, 3, cond.extra));
  const base = baseOnlyScore(profile, rois);
  const t0 = Date.now();
  const rFast = B.verifyPalmprintRoisFast(profile, rois);
  const fastMs = Date.now() - t0;
  info(cond.name + ': base(v40)=' + base.toFixed(3) + ' expanded=' + rFast.similarity.toFixed(3) + ' fastMs=' + fastMs);
  check('GENUINE ' + cond.name + ' was BELOW threshold under the v40 base rule (the bug, reproduced)', base < B.PALMPRINT_THRESHOLD, 'base=' + base.toFixed(3));
  check('GENUINE ' + cond.name + ' verifies under the v41 expanded rule', rFast.verified === true && rFast.similarity >= B.PALMPRINT_THRESHOLD, 'sim=' + rFast.similarity.toFixed(3));
  const rExact = B.verifyPalmprintRois(profile, rois);
  check('EXACT path agrees on ' + cond.name, rExact.verified === true && Math.abs(rExact.similarity - rFast.similarity) < 1e-12 || (rFast.verified && rExact.similarity >= rFast.similarity),
    'exact=' + rExact.similarity.toFixed(4) + ' fast=' + rFast.similarity.toFixed(4));
});

/* ---------------- symmetric case: the ENROLMENT was tilted ------- */
(function () {
  const tiltedProfile = enrol(TEX_A, { av: 0.85 }, 500);
  const rois = probeRois(TEX_A, seeds(530, 3, {}));
  const base = baseOnlyScore(tiltedProfile, rois);
  const rFast = B.verifyPalmprintRoisFast(tiltedProfile, rois);
  info('enrol tilted av=0.85, probe flat: base=' + base.toFixed(3) + ' expanded=' + rFast.similarity.toFixed(3));
  check('GENUINE enrol-tilted / probe-flat was below threshold under the base rule', base < B.PALMPRINT_THRESHOLD, 'base=' + base.toFixed(3));
  check('GENUINE enrol-tilted / probe-flat verifies under the expanded rule (squeeze variants)', rFast.verified === true, 'sim=' + rFast.similarity.toFixed(3));
})();

/* ---------------- impostors under the same conditions ------------ */
(function () {
  let impMax = 0, impBaseMax = 0;
  CONDITIONS.forEach(function (cond) {
    const rois = probeRois(TEX_B, seeds(cond.seed + 700, 3, cond.extra));
    const r = B.verifyPalmprintRoisFast(profile, rois);
    if (r.similarity > impMax) impMax = r.similarity;
    const b = baseOnlyScore(profile, rois);
    if (b > impBaseMax) impBaseMax = b;
  });
  const roisFlat = probeRois(TEX_B, seeds(300, 3, {}));
  const rFlat = B.verifyPalmprintRoisFast(profile, roisFlat);
  if (rFlat.similarity > impMax) impMax = rFlat.similarity;
  info('impostor max: expanded=' + impMax.toFixed(3) + ' base-only=' + impBaseMax.toFixed(3));
  check('IMPOSTOR under every indicted condition stays below threshold with the expanded set', impMax < B.PALMPRINT_THRESHOLD, 'max=' + impMax.toFixed(3));
  check('IMPOSTOR expansion cost is small on this fixture family (expanded max within 0.03 of base max)', impMax - impBaseMax <= 0.03, 'delta=' + (impMax - impBaseMax).toFixed(3));
})();

/* ---------------- fast/exact identity + worker ------------------- */
(function () {
  // Non-pass case: fast must report the FULL max, bit-identical to
  // the exact path, now over the expanded pair set.
  const rois = probeRois(TEX_B, seeds(300, 3, {}));
  const e = B.verifyPalmprintRois(profile, rois);
  const f = B.verifyPalmprintRoisFast(profile, rois);
  check('FAST non-pass score is bit-identical to the exact path over the expanded set', f.similarity === e.similarity && f.verified === e.verified,
    'fast=' + f.similarity.toFixed(6) + ' exact=' + e.similarity.toFixed(6));
  // Worker: fast path on the tilted genuine ROI, multi-profile on
  // the impostor ROI — both must equal the main thread exactly.
  function workerCall(msg) {
    let captured = null;
    const sandbox = { Buffer: Buffer, postMessage: function (m) { captured = m; } };
    vm.createContext(sandbox);
    vm.runInContext(B.palmprintWorkerSource(), sandbox);
    sandbox.onmessage({ data: msg });
    return captured;
  }
  const tiltRois = probeRois(TEX_A, seeds(230, 3, { av: 0.85 }));
  const mainFast = B.verifyPalmprintRoisFast(profile, [tiltRois[0]]);
  const wFast = workerCall({ id: 1, profile: profile, liveRois: [tiltRois[0]], fast: true });
  check('WORKER fast verdict + score match the main thread on a tilted genuine ROI',
    !!wFast && !!wFast.result && wFast.result.verified === mainFast.verified && wFast.result.similarity === mainFast.similarity,
    wFast && wFast.result ? 'sim=' + wFast.result.similarity.toFixed(4) : 'no result');
  const wMulti = workerCall({ id: 2, profiles: [profile], liveRois: [rois[0]] });
  const mSingle = B.verifyPalmprintRois(profile, [rois[0]]);
  check('WORKER multi-profile result equals the exact call (geo codes included)',
    !!wMulti && Array.isArray(wMulti.results) && wMulti.results[0].similarity === mSingle.similarity && wMulti.results[0].verified === mSingle.verified,
    wMulti && wMulti.results ? 'sim=' + wMulti.results[0].similarity.toFixed(4) : 'no results');
})();

/* ---------------- no-match cost bound ------------------------------ */
(function () {
  const roi = probeRois(TEX_A, seeds(200, 1, {}))[0];
  const total = B.palmprintProbeCodes(roi).length + B.palmprintProbeCodesGeo(roi).length;
  check('COST pair set per ROI is bounded: 50 base + 18 geo = 68 codes', total === 68, 'n=' + total);
  const t0 = Date.now();
  B.verifyPalmprintRoisFast(profile, [roi]);
  info('single-ROI genuine fast verify (pass, short-circuits): ' + (Date.now() - t0) + ' ms on this rig');
  const roisB = probeRois(TEX_B, seeds(300, 1, {}));
  const t1 = Date.now();
  B.verifyPalmprintRoisFast(profile, roisB);
  info('single-ROI impostor fast verify (full no-match enumeration): ' + (Date.now() - t1) + ' ms on this rig');
})();

check('THRESHOLD stays the phone-calibrated 0.32', B.PALMPRINT_THRESHOLD === 0.32);

console.log('v41 geo-variant tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
