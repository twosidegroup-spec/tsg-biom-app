/* TSG Biom — v43 regression: the reconciled hands-free upgrade.
   The Chairman's choice (2026-11-23): adopt the pasted spec's
   hands-free / speed / UX layer, keep the proven matching core
   and all stored data. This suite proves the parts that are pure
   logic, on the established fixture palms:

     SESSION  the auto-trigger / cooldown state machine
              (B.createScanSession): view entry scans, ~3 stable
              frames arm the trigger, a verdict starts a ~1.5 s
              cooldown in which no second verdict can fire, Next
              Customer (reset) re-arms instantly, leaving the view
              disarms everything.
     GUIDE    the live guidance pill mapping (B.palmGuidance)
              from the quality signals the pipelines already
              compute — framing hints, mean luma, glare fraction,
              openness, sharpness (with the blur bar checked
              against measured fixture sharpness, sharp vs blurred).
     POSE     the pose classifier (B.palmPoseTag) on synthetic
              landmarks, and guided-enrolment banking
              (B.selectPalmprintPoseCodes) on rendered fixture
              sessions: every pose banked, the sharpest frame per
              pose, and banked codes that are measurably diverse
              (a tilt code is NOT a near-duplicate of the flat code).
     TILT     RETIRED as an enrolment claim in v45: the spec's
              burst enrolment banks one posture, so a tilted probe
              no longer verifies against a burst profile — the
              section below pins that measured consequence (and
              the tilt-band numbers live in full in
              tests/v45-palmx.test.js). What survives: a pose-tagged
              TOP-UP session still banks tilt templates into the
              packed store (the TOPUP rebank checks).
     TOP-UP   B.mergePalmprintProfileCodes: appends under the cap
              with existing codes verbatim, skips literal
              duplicates and already-covered poses, replaces only
              redundant codes at the cap with at least two
              pre-merge codes always surviving, and never touches
              anything outside the profile (wallet/points proven
              at the object level the app saves).
     PINS     the shipped app/index sources carry the wiring.

   Fixture note (stated plainly): the v41 renderer's texture path
   squashes the palm print with av (the code effect the v41 fix
   was validated on), but its landmark path does not foreshorten,
   so poseLandmarks() applies the same av to the wrist ->
   middle-MCP projection of a descriptor-only landmark copy —
   the geometry a real tilted hand presents to MediaPipe. Codes
   always come from the unmodified v41 warp path.
   Timings printed here are RIG numbers only; the phone is the
   verdict, as always. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function info(msg) { console.log('  ..  ' + msg); }

/* ---------------- fixture palms + frame renderer (v41 family) ---- */
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
const TEX_A = roiImage(PALM_A, 991, { size: 272, noiseAmp: 8 });
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
  return { openness: 2.0, code: B.palmprintEncode(roi, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE), roi: roi, sharpness: sharp || 100 };
}
/* Descriptor-only landmark copy with the presentation geometry a
   real hand shows: out-of-plane tilt foreshortens the projected
   wrist -> middle-MCP length by av; tilt-toward also brings the
   knuckles' depth toward the camera (negative z step). */
function poseLandmarks(r, opt) {
  const lm = r.lm.map(function (p) { return { x: p.x, y: p.y, z: p.z || 0 }; });
  const av = opt.av || 1;
  if (av !== 1) { lm[0] = { x: lm[9].x + (lm[0].x - lm[9].x) * av, y: lm[9].y + (lm[0].y - lm[9].y) * av, z: 0 }; }
  if (opt.towardZ) { [5, 9, 13, 17].forEach(function (i) { lm[i] = { x: lm[i].x, y: lm[i].y, z: opt.towardZ }; }); }
  return lm;
}
function poseFrame(tex, opt, sharp) {
  const r = render(tex, opt);
  const roi = B.palmRoiFromLandmarks(r.gray, r.w, r.h, r.lm);
  if (!roi) return null;
  return { openness: 2.0, code: B.palmprintEncode(roi, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE), roi: roi, sharpness: sharp || 100, lmPose: poseLandmarks(r, opt) };
}
/* Tag a session's frames exactly as streamEnrolPalm does: the
   flat baseline comes from the first fully-open, un-angled frame. */
function tagSession(frames) {
  let ref = null;
  frames.forEach(function (f) {
    const d = B.palmPoseDescriptor(f.lmPose);
    if (d) {
      if (!ref && f.openness >= B.PALM_OPEN_MIN && Math.abs(d.ang) < 12) ref = { fore: d.fore, span: d.span };
      f.poseDesc = d; f.poseTag = B.palmPoseTag(f.lmPose, ref);
    }
  });
  return frames;
}
/* One guided sitting: flat captures first (they set the baseline),
   then tilted away, tilted toward, angled both ways, distance. */
function guidedSession(seedBase) {
  const frames = [];
  const push = function (opt, sharp) { const f = poseFrame(TEX_A, opt, sharp); if (f) frames.push(f); };
  push({ seed: seedBase + 1 }, 120); push({ seed: seedBase + 2 }, 320); push({ seed: seedBase + 3 }, 210);
  push({ seed: seedBase + 4, av: 0.85 }, 260); push({ seed: seedBase + 5, av: 0.85 }, 180);
  push({ seed: seedBase + 6, av: 0.88, towardZ: -0.05 }, 240);
  push({ seed: seedBase + 7, deg: 20 }, 230); push({ seed: seedBase + 8, deg: -20 }, 230);
  push({ seed: seedBase + 9, S: 210 }, 250);
  return tagSession(frames);
}

/* ---------------- SESSION: auto-trigger + cooldown ---------------- */
(function () {
  const s = B.createScanSession();
  check('SESSION starts idle and refuses verdicts', s.state(0) === 'idle' && s.verdict(0) === false);
  check('SESSION idle frames never arm', s.frame({ hasHand: true, pose: { cx: 0.5, cy: 0.5 } }, 0).armed === false);
  s.enter(1000);
  check('SESSION view entry is scanning with no click', s.state(1000) === 'scanning');
  check('SESSION no hand, no arm', s.frame({ hasHand: false, pose: null }, 1000).armed === false);
  const p = { cx: 0.5, cy: 0.5 };
  check('SESSION first steady frame counts once', s.frame({ hasHand: true, pose: p }, 1010).stableCount === 1);
  check('SESSION two steady frames not yet armed', s.frame({ hasHand: true, pose: p }, 1020).armed === false);
  check('SESSION ~3 steady frames arm the auto-trigger', s.frame({ hasHand: true, pose: p }, 1030).armed === true);
  check('SESSION a jump breaks stability', s.frame({ hasHand: true, pose: { cx: 0.56, cy: 0.5 } }, 1040).armed === false);
  s.frame({ hasHand: true, pose: { cx: 0.56, cy: 0.5 } }, 1050);
  s.frame({ hasHand: true, pose: { cx: 0.56, cy: 0.5 } }, 1060);
  check('SESSION stability re-arms after the jump', s.frame({ hasHand: true, pose: { cx: 0.56, cy: 0.5 } }, 1070).armed === true);
  check('SESSION verdict fires from scanning', s.verdict(1080) === true);
  check('SESSION cooldown blocks a second verdict inside the window', s.state(1200) === 'cooldown' && s.verdict(1200) === false);
  check('SESSION cooldown reports its remaining time', s.cooldownRemainingMs(1200) > 0 && s.cooldownRemainingMs(1200) <= 1500);
  check('SESSION frames during cooldown never arm', s.frame({ hasHand: true, pose: p }, 1300).armed === false);
  check('SESSION cooldown expires back to scanning', s.state(1080 + 1500) === 'scanning');
  check('SESSION a verdict can fire again after the cooldown', s.verdict(2600) === true);
  s.reset(2700);
  check('SESSION Next Customer resets instantly, mid-cooldown', s.state(2700) === 'scanning' && s.cooldownRemainingMs(2700) === 0);
  check('SESSION verdict fires immediately after the reset', s.verdict(2710) === true);
  s.leave();
  check('SESSION leaving the view disarms everything', s.state(3000) === 'idle' && s.verdict(3000) === false);
})();

/* ---------------- GUIDE: the guidance pill mapping ---------------- */
(function () {
  check('GUIDE no hand asks for a hand', B.palmGuidance({ hasHand: false }) === 'Show an open hand to the camera');
  check('GUIDE cut-off hand maps to move back', B.palmGuidance({ hasHand: true, framing: 'Whole hand in view — part of the hand is being cut off. Move the palm back a little so the whole hand shows.' }) === 'Whole hand in view — move back a little');
  check('GUIDE too close maps to farther', B.palmGuidance({ hasHand: true, framing: 'Too close — move the palm back a little, about 30 cm away.' }) === 'Move a little farther');
  check('GUIDE too far maps to closer', B.palmGuidance({ hasHand: true, framing: 'Move the palm a little closer to the camera.' }) === 'Move slightly closer');
  check('GUIDE dark frame asks for the flash', B.palmGuidance({ hasHand: true, meanLuma: 30 }) === 'Too dark — turn on Flash');
  check('GUIDE lit frame is not called dark', B.palmGuidance({ hasHand: true, meanLuma: 120, stable: false }) === 'Hold steady...');
  check('GUIDE glare maps to angle the hand', B.palmGuidance({ hasHand: true, meanLuma: 120, glareFrac: 0.3 }) === 'Too much glare — angle the hand slightly');
  check('GUIDE closed fingers ask for an open hand', B.palmGuidance({ hasHand: true, meanLuma: 120, glareFrac: 0, openness: 1.2 }) === 'Hold open hand naturally — fingers spread');
  // Sharpness: measured on a real fixture ROI, sharp vs box-blurred.
  const f = frameObj(TEX_A, { seed: 42 }, 200);
  const GS = B.PALMPRINT_ROI_SIZE;
  const sharpVal = B.laplacianVariance(f.roi, GS, GS);
  const blurred = f.roi.slice();
  for (let y = 1; y < GS - 1; y++) for (let x = 1; x < GS - 1; x++) { const i = y * GS + x; blurred[i] = (f.roi[i - GS - 1] + f.roi[i - GS] + f.roi[i - GS + 1] + f.roi[i - 1] + f.roi[i] + f.roi[i + 1] + f.roi[i + GS - 1] + f.roi[i + GS] + f.roi[i + GS + 1]) / 9; }
  const blurVal = B.laplacianVariance(blurred, GS, GS);
  info('GUIDE measured sharpness — sharp ROI ' + Math.round(sharpVal) + ', blurred ROI ' + Math.round(blurVal) + ' (RIG numbers)');
  check('GUIDE sharp fixture ROI does not read as blurred', B.palmGuidance({ hasHand: true, meanLuma: 120, glareFrac: 0, openness: 2.0, sharpness: sharpVal, stable: true }) === null);
  check('GUIDE blurred fixture ROI reads as blurred', B.palmGuidance({ hasHand: true, meanLuma: 120, glareFrac: 0, openness: 2.0, sharpness: blurVal, stable: true }) === 'Hold steady — the image is blurred');
  check('GUIDE clean and stable shows no pill text', B.palmGuidance({ hasHand: true, meanLuma: 120, glareFrac: 0, openness: 2.0, sharpness: sharpVal, stable: true }) === null);
  check('GUIDE clean but moving asks to hold steady', B.palmGuidance({ hasHand: true, meanLuma: 120, glareFrac: 0, openness: 2.0, sharpness: sharpVal, stable: false }) === 'Hold steady...');
})();

/* ---------------- POSE: classifier on synthetic landmarks --------- */
function synthLm(o) {
  const lm = [];
  for (let i = 0; i < 21; i++) lm.push({ x: o.cx, y: o.cy, z: 0 });
  const th = (o.angDeg || 0) * Math.PI / 180;
  const ux = Math.cos(th), uy = Math.sin(th), vx = -Math.sin(th), vy = Math.cos(th);
  const s = o.span, mcp = { 5: -0.5, 9: -1 / 6, 13: 1 / 6, 17: 0.5 };
  Object.keys(mcp).forEach(function (k) { lm[k] = { x: o.cx + ux * mcp[k] * s, y: o.cy + uy * mcp[k] * s, z: o.zm || 0 }; });
  const dFore = o.foreRatio * s;
  lm[0] = { x: o.cx + ux * (-1 / 6) * s + vx * dFore, y: o.cy + uy * (-1 / 6) * s + vy * dFore, z: 0 };
  return lm;
}
(function () {
  const flat = synthLm({ cx: 0.5, cy: 0.45, span: 0.24, foreRatio: 1.34, angDeg: 0 });
  const ref = B.palmPoseDescriptor(flat);
  check('POSE descriptor reads the flat geometry', !!ref && Math.abs(ref.fore - 1.34) < 0.02 && Math.abs(ref.ang) < 1 && Math.abs(ref.span - 0.24) < 0.01,
    ref && 'fore=' + ref.fore.toFixed(2) + ' ang=' + ref.ang.toFixed(1) + ' span=' + ref.span.toFixed(2));
  check('POSE flat classifies flat', B.palmPoseTag(flat, ref) === 'flat');
  check('POSE +20 degrees classifies angleRight', B.palmPoseTag(synthLm({ cx: 0.5, cy: 0.45, span: 0.24, foreRatio: 1.34, angDeg: 20 }), ref) === 'angleRight');
  check('POSE -20 degrees classifies angleLeft', B.palmPoseTag(synthLm({ cx: 0.5, cy: 0.45, span: 0.24, foreRatio: 1.34, angDeg: -20 }), ref) === 'angleLeft');
  check('POSE foreshortened wrist classifies tiltAway', B.palmPoseTag(synthLm({ cx: 0.5, cy: 0.45, span: 0.24, foreRatio: 1.34 * 0.8, angDeg: 0 }), ref) === 'tiltAway');
  check('POSE foreshortened + knuckle depth classifies tiltToward', B.palmPoseTag(synthLm({ cx: 0.5, cy: 0.45, span: 0.24, foreRatio: 1.34 * 0.8, angDeg: 0, zm: -0.05 }), ref) === 'tiltToward');
  const smaller = flat.map(function (p) { return { x: 0.5 + (p.x - 0.5) * 0.7, y: 0.45 + (p.y - 0.45) * 0.7, z: 0 }; });
  check('POSE uniformly smaller palm classifies distance', B.palmPoseTag(smaller, ref) === 'distance');
  check('POSE garbage landmarks classify nothing', B.palmPoseDescriptor(null) === null && B.palmPoseDescriptor([{ x: 0, y: 0 }]) === null && B.palmPoseTag(null, ref) === null);
  check('POSE descriptor window: same presentation close, shifted fore not', B.palmPoseDescriptorsClose(ref, B.palmPoseDescriptor(flat)) === true &&
    B.palmPoseDescriptorsClose(ref, { fore: ref.fore + 0.1, ang: ref.ang, span: ref.span }) === false);
  check('POSE the pose set is the six the Chairman chose', B.PALMPRINT_POSES.map(function (p) { return p.id; }).join(',') === 'flat,tiltAway,tiltToward,angleLeft,angleRight,distance');
})();

/* ---------------- POSE BANKING + TILT: the guided flow ------------ */
const session = guidedSession(1000);
const sel = B.selectPalmprintPoseCodes(session);
(function () {
  check('BANK the guided session tags every pose', ['flat', 'tiltAway', 'tiltToward', 'angleLeft', 'angleRight', 'distance'].every(function (t) {
    return session.some(function (f) { return f.poseTag === t; });
  }), session.map(function (f) { return f.poseTag; }).join(','));
  check('BANK a pose set is selected', !!sel, sel && sel.tags.join(','));
  check('BANK all six poses banked, one code each', !!sel && sel.tags.length === 6 && sel.codes.length === 6, sel && sel.tags.join(','));
  if (sel) {
    const bytes = sel.codes.map(function (c) { return Buffer.from(c, 'base64'); });
    const idx = function (t) { return sel.tags.indexOf(t); };
    const simFT = B.palmprintSimilarity(bytes[idx('flat')], bytes[idx('tiltAway')]);
    const simFD = B.palmprintSimilarity(bytes[idx('flat')], bytes[idx('distance')]);
    info('BANK diversity — flat vs tiltAway ' + simFT.toFixed(3) + ', flat vs tiltToward ' + B.palmprintSimilarity(bytes[idx('flat')], bytes[idx('tiltToward')]).toFixed(3) + ', flat vs distance ' + simFD.toFixed(3) + ' (same-presentation captures measure ~0.61)');
    check('BANK tilt code is measurably diverse, not a near-duplicate of flat', simFT < 0.40, 'sim=' + simFT.toFixed(3));
    check('BANK every banked code is a sane EDCC code', bytes.every(function (b) { return B.palmprintCodeSane(b); }));
    const sharpFlat = session.filter(function (f) { return f.poseTag === 'flat'; }).sort(function (a, b) { return b.sharpness - a.sharpness; })[0];
    check('BANK the sharpest frame of a pose is the one banked', B.palmprintSimilarity(bytes[idx('flat')], sharpFlat.code) > 0.999);
  }
  const flatOnlyFrames = session.filter(function (f) { return f.poseTag === 'flat'; });
  check('BANK a single-posture session banks NO pose set (caller falls back)', B.selectPalmprintPoseCodes(flatOnlyFrames) === null);
})();

/* The tilted probe: the v41 genuine-reject geometry (av 0.85).
   v45: enrolment is the spec's single burst — one posture banked.
   The tilted probe therefore measures BELOW threshold against a
   burst profile; this section pins that consequence on the same
   fixtures the v43 section used to prove the opposite, and the
   v45 suite reports the full tilt band. A flat probe still
   verifies against the same profile. */
const flatFrames = [];
for (let i = 0; i < 9; i++) flatFrames.push(frameObj(TEX_A, { seed: 300 + i, cx: 320 + ((i % 3) - 1) * 2, cy: 240 + (((i + 1) % 3) - 1) * 2, deg: (i % 3) - 1 }, 100 + i * 10));
const flatCodes = B.selectPalmprintProfileCodes(flatFrames.filter(Boolean));
const flatByteCodes = flatFrames.filter(Boolean).map(function (f) { return Buffer.from(f.code).toString('base64'); });
const probeFrames = [401, 402, 403].map(function (s) { return frameObj(TEX_A, { seed: s, av: 0.85 }, 220); }).filter(Boolean);
const probeRois = B.selectPalmprintLiveRois(probeFrames);
(function () {
  check('TILT fixtures built', !!sel && !!flatCodes && !!probeRois, flatCodes && flatCodes.length + ' burst templates');
  if (!sel || !flatCodes || !probeRois) return;
  const flat = { v: 4, format: B.PALMPRINT_FORMAT, codes: flatCodes };
  const fullFlat = B.verifyPalmprintRois(flat, probeRois);
  const flatProbe = frameObj(TEX_A, { seed: 950 }, 220);
  const fullFlatProbe = B.verifyPalmprintRois(flat, [flatProbe.roi]);
  info('TILT tilted probe (av 0.85) vs burst profile: ' + (fullFlat.similarity && fullFlat.similarity.toFixed(3)) + '; flat probe vs burst profile: ' + (fullFlatProbe.similarity && fullFlatProbe.similarity.toFixed(3)) + ' (RIG numbers; full tilt band in tests/v45-palmx.test.js)');
  check('TILT (v45) the burst profile does NOT verify the tilted probe — the spec trade-off, measured', fullFlat.verified === false && fullFlat.similarity < B.PALMPRINT_THRESHOLD,
    'sim=' + (fullFlat.similarity && fullFlat.similarity.toFixed(3)));
  check('TILT (v45) the same burst profile verifies a flat probe', fullFlatProbe.verified === true,
    'sim=' + (fullFlatProbe.similarity && fullFlatProbe.similarity.toFixed(3)));
})();

/* ---------------- TOP-UP: merge into an existing profile ----------
   v45 semantics: candidates are packed (pose selection first,
   burst picks otherwise). A PACKED profile merges exactly as v43
   did — originals verbatim, cap, dup/pose skips, redundant-only
   replacement, two-original floor. A LEGACY (v3 byte) profile is
   RE-BANKED: the candidates become the profile and no legacy code
   is carried into the packed store (the migration keeps them
   archived in the person record as legacyCodes). */
(function () {
  check('TOPUP fixtures built', !!flatCodes && !!sel);
  if (!flatCodes || !sel) return;
  const packedOfSel = sel.codes.map(function (b64) { return B.palmprintPackedToBase64(B.palmprintPackCode(new Uint8Array(Buffer.from(b64, 'base64')))); });
  // Rebank path: a legacy byte profile (2 codes, no pose data).
  const legacy2 = { v: 3, codes: flatByteCodes.slice(0, 2) };
  const mRe = B.mergePalmprintProfileCodes(legacy2, guidedSession(2000));
  check('TOPUP a legacy profile is re-banked from the session candidates', !!mRe && mRe.rebanked === true && mRe.format === 'packed96' && mRe.codes.length === 6,
    mRe && 'codes=' + mRe.codes.length);
  check('TOPUP re-banked templates are all sane packed templates', !!mRe && mRe.codes.every(function (c) { return B.palmprintPackedSane(c); }));
  check('TOPUP no legacy byte code is carried into the packed profile', !!mRe && mRe.codes.every(function (c) { return legacy2.codes.indexOf(c) === -1; }));
  check('TOPUP the stored profile input is never mutated', legacy2.codes.length === 2);
  // Append path: a small packed profile (2 burst templates, no poses).
  const smallPacked = { v: 4, format: B.PALMPRINT_FORMAT, codes: flatCodes.slice(0, 2) };
  const mAdd = B.mergePalmprintProfileCodes(smallPacked, guidedSession(2000));
  check('TOPUP appends diverse templates under the cap', !!mAdd && mAdd.added === 4 && mAdd.replaced === 0, mAdd && 'added=' + mAdd.added + ' skipped=' + mAdd.skipped);
  check('TOPUP existing templates preserved verbatim on append', !!mAdd && JSON.stringify(mAdd.codes.slice(0, 2)) === JSON.stringify(smallPacked.codes));
  check('TOPUP cap respected on append', !!mAdd && mAdd.codes.length === B.PALMPRINT_PROFILE_MAX_CODES, mAdd && mAdd.codes.length + ' templates');
  // The app-level save: only palmProfile changes on the person.
  const person = { id: 'TSG-BIO-9001', name: 'Topup Fixture', loyaltyPoints: 55, wallet: { balance: 450, statement: [{ ref: 'DEMO-1', amount: 450 }], linkedAccounts: [{ id: 'a1', type: 'bKash', label: 'Personal' }] }, palmProfile: smallPacked };
  const updated = Object.assign({}, person, { palmProfile: { v: 4, format: B.PALMPRINT_FORMAT, codes: mAdd.codes, poses: mAdd.poses } });
  check('TOPUP wallet, points and identity untouched by the save', updated.wallet === person.wallet && updated.loyaltyPoints === 55 && updated.id === 'TSG-BIO-9001' && updated.wallet.balance === 450 && updated.wallet.statement.length === 1);
  check('TOPUP the packed profile input is never mutated', smallPacked.codes.length === 2 && person.palmProfile === smallPacked);
  // Literal duplicate: the session's flat frame IS a banked template.
  const flatDesc = sel.poses[sel.tags.indexOf('flat')];
  const bytesOf = function (t) { return Buffer.from(sel.codes[sel.tags.indexOf(t)], 'base64'); };
  const manual = function (codeBytes, tag, desc) { return { openness: 2.0, code: codeBytes, sharpness: 300, poseTag: tag, poseDesc: desc }; };
  const dupProfile = { v: 4, format: B.PALMPRINT_FORMAT, codes: [packedOfSel[sel.tags.indexOf('flat')], packedOfSel[sel.tags.indexOf('distance')]], poses: [flatDesc, sel.poses[sel.tags.indexOf('distance')]] };
  const dupSession = [manual(bytesOf('flat'), 'flat', flatDesc), manual(bytesOf('tiltAway'), 'tiltAway', sel.poses[sel.tags.indexOf('tiltAway')]), manual(bytesOf('angleLeft'), 'angleLeft', sel.poses[sel.tags.indexOf('angleLeft')]), manual(bytesOf('distance'), 'distance', sel.poses[sel.tags.indexOf('distance')])];
  const mDup = B.mergePalmprintProfileCodes(dupProfile, dupSession);
  check('TOPUP a literal re-capture is skipped, never banked twice', !!mDup && mDup.skipped >= 2 && mDup.added === 2 && mDup.codes.filter(function (c) { return c === dupProfile.codes[0]; }).length === 1,
    mDup && 'added=' + mDup.added + ' skipped=' + mDup.skipped);
  // At cap, all poses already covered: nothing changes.
  const fullProfile = { v: 4, format: B.PALMPRINT_FORMAT, codes: packedOfSel, poses: sel.poses };
  const mFull = B.mergePalmprintProfileCodes(fullProfile, guidedSession(3000));
  check('TOPUP at cap with every pose covered changes nothing', !!mFull && mFull.changed === false && mFull.added === 0 && mFull.replaced === 0 && JSON.stringify(mFull.codes) === JSON.stringify(packedOfSel),
    mFull && 'skipped=' + mFull.skipped);
  // At cap with a redundant pair: only the redundant template is replaced.
  const redProfile = { v: 4, format: B.PALMPRINT_FORMAT, codes: packedOfSel.slice(), poses: sel.poses.slice() };
  redProfile.poses[5] = redProfile.poses[0]; // index 5 now duplicates index 0's presentation
  const distFrame = poseFrame(TEX_A, { seed: 777, S: 360 }, 300);
  const redSession = tagSession([session[1], session[6], distFrame].filter(Boolean));
  const mRed = B.mergePalmprintProfileCodes(redProfile, redSession);
  check('TOPUP at cap replaces only the redundant template', !!mRed && mRed.replaced === 1 && mRed.codes.length === 6,
    mRed && 'added=' + mRed.added + ' replaced=' + mRed.replaced + ' skipped=' + mRed.skipped);
  check('TOPUP the replacement lands in the redundant slot, the rest verbatim', !!mRed && JSON.stringify(mRed.codes.slice(0, 5)) === JSON.stringify(packedOfSel.slice(0, 5)) && mRed.codes[5] !== packedOfSel[5]);
  // A legacy profile re-banked from a POSE session keeps the tilt
  // range the v43 rebuild existed for — inside the packed store.
  const legacy6 = { v: 3, codes: flatByteCodes.slice(0, 6) };
  const mLeg = B.mergePalmprintProfileCodes(legacy6, guidedSession(4000));
  check('TOPUP a legacy profile re-banks to the session pose set', !!mLeg && mLeg.rebanked === true && mLeg.codes.length === 6 && mLeg.codes.every(function (c) { return B.palmprintPackedSane(c); }),
    mLeg && 'codes=' + mLeg.codes.length);
  const legTilt = mLeg ? B.verifyPalmprintRois({ v: 4, format: B.PALMPRINT_FORMAT, codes: mLeg.codes }, probeRois) : { similarity: null, verified: false };
  info('TOPUP tilted probe (av 0.85) vs the re-banked pose profile: ' + (legTilt.similarity && legTilt.similarity.toFixed(3)) + ' (RIG number)');
  check('TOPUP the re-banked pose profile verifies the tilted probe', legTilt.verified === true,
    'sim=' + (legTilt.similarity && legTilt.similarity.toFixed(3)));
  // A burst session against the profile it was banked from: every
  // candidate is a literal duplicate — nothing changes.
  const burstProfile = { v: 4, format: B.PALMPRINT_FORMAT, codes: flatCodes };
  const mNone = B.mergePalmprintProfileCodes(burstProfile, flatFrames.filter(Boolean));
  check('TOPUP re-running the banking burst changes nothing', !!mNone && mNone.poseSet === false && mNone.changed === false && JSON.stringify(mNone.codes) === JSON.stringify(flatCodes),
    mNone && 'skipped=' + mNone.skipped);
  check('TOPUP a non-profile merges to null', B.mergePalmprintProfileCodes(null, guidedSession(5000)) === null && B.mergePalmprintProfileCodes({ v: 9, codes: [] }, guidedSession(5000)) === null);
})();

/* ---------------- PINS: the shipped wiring ------------------------- */
(function () {
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const idxSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  check('PIN app runs scan sessions', appSrc.indexOf('createScanSession') !== -1);
  check('PIN app keeps one warm Pipeline', appSrc.indexOf('Pipeline') !== -1 && appSrc.indexOf('Pipeline.start()') !== -1);
  check('PIN app banks the burst and merges top-ups', appSrc.indexOf('selectPalmprintBurstCodes') !== -1 && appSrc.indexOf('mergePalmprintProfileCodes') !== -1);
  check('PIN app drives the guidance pill', appSrc.indexOf('palmGuidance') !== -1);
  check('PIN terminal has Next Customer', idxSrc.indexOf('id="termNext"') !== -1 && appSrc.indexOf('termNext') !== -1);
  check('PIN wallet scan card carries camera + flash toggles', idxSrc.indexOf('data-cam-toggle="walletAct"') !== -1 && idxSrc.indexOf('data-flash-toggle="walletAct"') !== -1);
  check('PIN add-angles page exists with its own camera toggles', idxSrc.indexOf('id="page-topup"') !== -1 && idxSrc.indexOf('id="topVideo"') !== -1 && idxSrc.indexOf('data-cam-toggle="topup"') !== -1);
  check('PIN registry offers Add Angles', appSrc.indexOf('data-topup') !== -1 && appSrc.indexOf('Add Angles') !== -1);
})();

/* ---------------- rig timings (info only) -------------------------- */
(function () {
  const t0 = Date.now();
  const s2 = guidedSession(9000);
  const t1 = Date.now();
  B.selectPalmprintPoseCodes(s2);
  const t2 = Date.now();
  if (probeRois && flatCodes) B.verifyPalmprintRois({ v: 4, format: B.PALMPRINT_FORMAT, codes: flatCodes }, probeRois);
  const t3 = Date.now();
  info('RIG ONLY — guided fixture session render+tag ' + (t1 - t0) + ' ms for 9 frames; pose banking ' + (t2 - t1) + ' ms; full verify of 3 probe ROIs ' + (t3 - t2) + ' ms. These are rig numbers, not phone numbers.');
})();

console.log(fail === 0 ? 'ALL V43 TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
