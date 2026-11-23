/* Illumination flattening + CLAHE adoption probe (v24 candidate).
   A/B: current encoder vs encoder fed a normalised ROI
   (B.palmprintNormaliseRoi), on the palmprint suite's synthetic
   palms, under the re-capture conditions a phone in a shop actually
   produces - including strong illumination GRADIENTS (uneven light),
   which the plain brightness-offset variants never modelled.
   Decision rule: adopt only if normalised genuine-min >= current
   genuine-min on clean/bright AND gradient genuine improves AND
   impostor-max does not rise. */
const B = require('../biometrics.js');

function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
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
function gradient(img, axis, lo, hi) {
  const out = new Array(img.length);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const t = (axis === 'x' ? x : y) / 127;
    out[y * 128 + x] = Math.max(0, Math.min(255, Math.round(img[y * 128 + x] * (lo + (hi - lo) * t))));
  }
  return out;
}
function enc(img, normalised) {
  return B.palmprintEncode(normalised ? B.palmprintNormaliseRoi(img, 128, 128) : img, 128, 128);
}
/* v45 port: the byte-code palmprintSimilarity is gone; the packed
   exhaustive similarity over the spec's 5 shifts is the current
   matcher (this probe's A/B question — normaliser on/off — is
   unaffected by which matcher reads the codes). */
function simPacked(a, b) {
  return B.palmprintPackedSimilarity(
    B.palmprintPackedToBase64(B.palmprintPackCode(a)),
    B.palmprintPackedToBase64(B.palmprintPackCode(b)), { exhaustive: true });
}
function best(live, enrolCodes) {
  let b = 0;
  for (const c of enrolCodes) { const s = simPacked(c, live); if (s !== null && s > b) b = s; }
  return b;
}

const VARIANTS = [
  ['clean', (img) => img],
  ['bright +16', (img) => img.map(v => Math.min(255, v + 16))],
  ['gradient X 0.65->1.25', (img) => gradient(img, 'x', 0.65, 1.25)],
  ['gradient Y 0.7->1.2', (img) => gradient(img, 'y', 0.7, 1.2)],
  ['gradient X + shift', (img) => gradient(img, 'x', 0.65, 1.25)]
];

for (const normalised of [false, true]) {
  const label = normalised ? 'NORMALISED (flatten+CLAHE)' : 'CURRENT';
  const enrol = PALMS.map((c, i) => [enc(roiImage(c, 100 + i), normalised), enc(roiImage(c, 200 + i), normalised)]);
  let impMax = 0;
  PALMS.forEach((c, i) => {
    const live = enc(roiImage(c, 300 + i), normalised);
    PALMS.forEach((c2, j) => { if (i !== j) impMax = Math.max(impMax, best(live, enrol[j])); });
  });
  console.log('== ' + label + ' ==  impostor max ' + impMax.toFixed(3));
  for (const [vname, fn] of VARIANTS) {
    let gmin = 1;
    PALMS.forEach((c, i) => {
      const opts = vname === 'gradient X + shift' ? { dx: 2, dy: -1 } : {};
      const s = best(enc(fn(roiImage(c, 400 + i, opts)), normalised), enrol[i]);
      if (s < gmin) gmin = s;
    });
    console.log('   genuine min [' + vname + '] ' + gmin.toFixed(3) + (gmin >= 0.36 ? '  (passes 0.36)' : '  (BELOW 0.36)'));
  }
}

// Per-frame cost of the EDCC path (encode + one similarity), node CPU.
const img = roiImage(PALMS[0], 42);
let t0 = Date.now();
for (let i = 0; i < 20; i++) enc(img, false);
const encMs = (Date.now() - t0) / 20;
t0 = Date.now();
for (let i = 0; i < 20; i++) enc(img, true);
const encNormMs = (Date.now() - t0) / 20;
const c1 = enc(img, false), c2 = enc(roiImage(PALMS[0], 43), false);
t0 = Date.now();
for (let i = 0; i < 200; i++) simPacked(c1, c2);
const simMs = (Date.now() - t0) / 200;
console.log('per-frame cost (node CPU): encode ' + encMs.toFixed(1) + ' ms, normalised encode ' + encNormMs.toFixed(1) + ' ms, similarity ' + simMs.toFixed(2) + ' ms');
