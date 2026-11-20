/* PALM STRENGTHENING suite for TSG Biom - run: node tests/palm-strength.test.js
   Covers the three layers added 2026-11-20 for Palm Loyalty:
   1) multi-capture profile (best-of-N geometry matching)
   2) texture realness gate (both-must-pass with geometry; fail closed
      when an enrolled texture is missing from the live scan)
   3) movement liveness (open -> close -> open openness series)

   Calibration honesty (probes, 2026-11-20): global/grid LBP and coarse
   template correlation did NOT separate same-palm from different-palm
   synthetic images, so texture is tested here only for what it provably
   does - rejecting flat/texture-less captures - never as identity. */
const B = require('../biometrics.js');
let failures = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail !== undefined ? ' | ' + detail : ''));
  if (!cond) failures++;
}

/* ---- synthetic hands (same helpers as the false-accept suite) ---- */
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
function captureFrom(baseHand, seedBase) {
  return B.palmDescriptorFromLandmarks(avgLm([1, 2, 3, 4, 5].map(s => jitter(baseHand, 0.005, seedBase + s * 11))));
}
function fistOf(openHand) {
  return openHand.map((p, i) => {
    if (i < 5) return p;
    const mcp = openHand[[5, 9, 13, 17][Math.floor((i - 5) / 4)]];
    return { x: mcp.x + (p.x - mcp.x) * 0.12, y: mcp.y + (p.y - mcp.y) * 0.12 + 0.03, z: 0 };
  });
}

/* ---- synthetic palm textures ---- */
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function palmImage(size, creases, seed, shift) {
  const rnd = lcg(seed); const noise = [];
  for (let i = 0; i < size * size; i++) noise.push((rnd() - 0.5) * 14);
  const g = new Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 168 + Math.sin(x * 0.05 + seed) * 10 + Math.cos(y * 0.07) * 8;
    for (const c of creases) {
      const ly = c.a * (x + (shift || 0)) + c.b + Math.sin(x * 0.05 + c.p) * 3;
      const d = Math.abs(y - ly);
      if (d < 2.2) v -= (2.2 - d) * 26;
    }
    g[y * size + x] = Math.max(0, Math.min(255, Math.round(v + noise[y * size + x])));
  }
  return g;
}
const S = 128;
const creasesA = [{ a: 0.25, b: 30, p: 1 }, { a: -0.4, b: 95, p: 3 }, { a: 0.05, b: 70, p: 5 }];
const texA = B.lbpHistogram(palmImage(S, creasesA, 7, 0), S, S);
const texA2 = B.lbpHistogram(palmImage(S, creasesA, 99, 1), S, S);
const texFlat = B.lbpHistogram(new Array(S * S).fill(170), S, S);

/* ---------------- MOVEMENT LIVENESS ---------------- */
const openHand = hand(null);
const fistHand = fistOf(openHand);
const openOp = B.palmOpenness(openHand), fistOp = B.palmOpenness(fistHand);
check('OPENNESS open hand above open minimum', openOp >= B.PALM_OPEN_MIN, 'open=' + openOp.toFixed(2));
check('OPENNESS fist below closed maximum', fistOp <= B.PALM_CLOSED_MAX, 'fist=' + fistOp.toFixed(2));
check('OPENNESS garbage landmarks -> null', B.palmOpenness([{ x: 0, y: 0 }]) === null && B.palmOpenness(null) === null);
check('MIXED-FRAME TRAP open hand alone describes', !!B.palmDescriptorFromLandmarks(openHand));
check('MIXED-FRAME TRAP averaged open+fist landmarks are rejected (why capture falls back to per-frame descriptors)', B.palmDescriptorFromLandmarks(avgLm([openHand, fistHand])) === null);
let ev = B.evaluatePalmMovement([2.08, 2.05, 2.09, 2.07, 2.06, 2.08, 2.05, 2.09]); // a photo: constant
check('MOVEMENT static series (photo) FAILS', !ev.pass, 'range=' + ev.range.toFixed(3));
ev = B.evaluatePalmMovement([openOp, openOp, fistOp, fistOp, openOp, openOp, openOp]);
check('MOVEMENT open-close-open PASSES', ev.pass, 'range=' + ev.range.toFixed(2) + ' - ' + ev.reason);
ev = B.evaluatePalmMovement([openOp, openOp, fistOp, fistOp, fistOp, fistOp, fistOp]); // ends closed
check('MOVEMENT ending closed FAILS', !ev.pass, ev.reason);
ev = B.evaluatePalmMovement([openOp, openOp, fistOp, fistOp, openOp, openOp, 1.58]); // final sample is a soft read, end phase open
check('MOVEMENT soft final sample but open end phase PASSES', ev.pass, 'range=' + ev.range.toFixed(2));
ev = B.evaluatePalmMovement([openOp, fistOp, fistOp, fistOp, fistOp, fistOp, fistOp]); // opened only at the very start
check('MOVEMENT open only at the start FAILS', !ev.pass, ev.reason);
ev = B.evaluatePalmMovement([openOp, fistOp, openOp]); // too few samples
check('MOVEMENT too few samples FAILS', !ev.pass, ev.reason);
ev = B.evaluatePalmMovement([fistOp, fistOp, fistOp, fistOp, fistOp, fistOp, fistOp]); // fist only
check('MOVEMENT fist-only FAILS', !ev.pass, ev.reason);

/* ---------------- MULTI-CAPTURE PROFILE ---------------- */
const cap1 = captureFrom(hand(null), 100);
const cap2 = captureFrom(hand({ spread: 1.01 }), 200);       // slight angle change
const cap3 = captureFrom(hand({ spread: 0.99 }), 300);
const profile = { v: 2, geometry: [cap1, cap2, cap3], texture: texA };
check('PROFILE strengthened profile is sane', B.palmProfileSane(profile));
check('PROFILE degenerate profile rejected', !B.palmProfileSane({ v: 2, geometry: [new Array(30).fill(0)], texture: null }));
check('PROFILE one bad capture poisons the profile', !B.palmProfileSane({ v: 2, geometry: [cap1, new Array(30).fill(0)], texture: null }));

const liveSame = { geometry: captureFrom(hand(null), 400), texture: texA2 };
let r = B.verifyPalmProfile(profile, liveSame);
check('PROFILE same hand verified (best-of-3 + texture gate)', r.verified, 'distance=' + r.distance.toFixed(4) + ' texSim=' + r.textureSimilarity.toFixed(3));
const liveDiff = { geometry: captureFrom(hand({ spread: 1.06 }), 500), texture: texA2 };
r = B.verifyPalmProfile(profile, liveDiff);
check('PROFILE different hand denied even with real texture', !r.verified, 'distance=' + r.distance.toFixed(4));
r = B.verifyPalmProfile(profile, { geometry: liveSame.geometry, texture: texFlat });
check('PROFILE flat/texture-less capture DENIED by realness gate', !r.verified && (r.textureSimilarity === null || r.textureSimilarity < B.PALM_TEXTURE_MIN), r.textureSimilarity === null ? 'flat histogram is degenerate - treated as no texture, fail closed' : 'texSim=' + r.textureSimilarity.toFixed(3));
r = B.verifyPalmProfile(profile, { geometry: liveSame.geometry, texture: null });
check('PROFILE missing live texture DENIED fail-closed (stored has texture)', !r.verified && !r.ok, r.reason);
r = B.verifyPalmProfile(profile, { geometry: null, texture: texA2 });
check('PROFILE missing live geometry DENIED', !r.verified && !r.ok, r.reason);
r = B.verifyPalmProfile(null, liveSame);
check('PROFILE missing enrollment DENIED', !r.verified && !r.ok, r.reason);
r = B.verifyPalmProfile({ v: 2, geometry: [new Array(30).fill(0)], texture: null }, liveSame);
check('PROFILE degenerate stored geometry DENIED', !r.verified && !r.ok, r.reason);

/* Legacy single-descriptor enrollment still verifies on geometry alone */
const legacy = B.palmDescriptorFromLandmarks(hand(null));
r = B.verifyPalmProfile(legacy, { geometry: liveSame.geometry, texture: null });
check('LEGACY array enrollment verifies same hand (geometry only)', r.verified, 'distance=' + r.distance.toFixed(4));
r = B.verifyPalmProfile(legacy, { geometry: liveDiff.geometry, texture: null });
check('LEGACY array enrollment denies different hand', !r.verified, 'distance=' + r.distance.toFixed(4));

/* Texture sanity */
check('TEXTURE real palm texture is sane', B.palmTextureSane(texA));
check('TEXTURE flat histogram rejected', !B.palmTextureSane(texFlat));
check('TEXTURE zero histogram rejected', !B.palmTextureSane(new Array(256).fill(0)));

/* ---------------- CLIP FRAME SELECTION ----------------
   The recorded-clip path analyses frames into
   { openness, descriptor, sharpness, texture } and the selectors
   decide. A fist frame (low openness) or a gateless descriptor must
   never be selected, however sharp. */
const clipFrames = [
  { openness: openOp, descriptor: captureFrom(hand(null), 600), sharpness: 50, texture: texA },
  { openness: fistOp, descriptor: captureFrom(hand(null), 700), sharpness: 999, texture: texA },
  { openness: openOp, descriptor: captureFrom(hand(null), 800), sharpness: 80, texture: texA },
  { openness: null, descriptor: null, sharpness: 500, texture: null },
  { openness: openOp, descriptor: captureFrom(hand(null), 900), sharpness: 60, texture: texA },
  { openness: openOp, descriptor: null, sharpness: 700, texture: texA }
];
check('CLIP usable frames exclude fist, missing and gateless frames', B.palmUsableOpenFrames(clipFrames).length === 3, 'usable=' + B.palmUsableOpenFrames(clipFrames).length);
const clipDesc = B.selectPalmDescriptor(clipFrames);
check('CLIP selectPalmDescriptor returns a sane descriptor', B.palmDescriptorSane(clipDesc));
r = B.verifyPalmProfile(profile, { geometry: clipDesc, texture: texA2 });
check('CLIP selected descriptor verifies against the same hand profile', r.verified, 'distance=' + (r.distance === null ? 'n/a' : r.distance.toFixed(4)));
const clipProfile = B.selectPalmProfile(clipFrames);
check('CLIP selectPalmProfile returns 3 spread descriptors', Array.isArray(clipProfile) && clipProfile.length === 3 && clipProfile.every(d => B.palmDescriptorSane(d)));
check('CLIP all-fist clip selects nothing', B.selectPalmDescriptor([{ openness: fistOp, descriptor: captureFrom(hand(null), 1000), sharpness: 10, texture: texA }]) === null && B.selectPalmProfile([{ openness: fistOp, descriptor: captureFrom(hand(null), 1100), sharpness: 10, texture: texA }]) === null);
check('CLIP empty clip selects nothing', B.selectPalmDescriptor([]) === null && B.selectPalmProfile([]) === null);

console.log(failures === 0 ? '\nALL PALM-STRENGTH TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
