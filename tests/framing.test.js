/* TSG Biom — v24 framing guidance + live openness gate tests.
   The phone failure these pin: enrolled fine, no match at the
   terminal, with the palm overflowing the frame (fingertips cut off,
   warp built on estimated landmarks) and a natural checkout palm
   sitting below the enrolment openness bar, so live frames produced
   no codes at all. */
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

function hand(over) {
  const lm = [];
  for (let i = 0; i < 21; i++) lm.push({ x: 0.5, y: 0.5 });
  lm[0] = { x: 0.5, y: 0.88 };            // wrist
  lm[5] = { x: 0.36, y: 0.46 };           // index MCP
  lm[9] = { x: 0.49, y: 0.43 };           // middle MCP
  lm[13] = { x: 0.61, y: 0.46 };          // ring MCP
  lm[17] = { x: 0.71, y: 0.51 };          // pinky MCP  (span ~0.355)
  lm[8] = { x: 0.31, y: 0.2 };            // index tip
  lm[12] = { x: 0.49, y: 0.15 };          // middle tip
  lm[16] = { x: 0.65, y: 0.21 };          // ring tip
  lm[20] = { x: 0.78, y: 0.32 };          // pinky tip
  if (over) Object.keys(over).forEach(function (k) { lm[Number(k)] = over[k]; });
  return lm;
}

check('FRAME well-framed hand -> no hint', B.palmFramingHint(hand()) === null);
check('FRAME fingertip out of frame -> cut-off hint', /cut off/.test(B.palmFramingHint(hand({ 12: { x: 0.49, y: -0.03 } })) || ''));
check('FRAME wrist out of frame -> cut-off hint', /cut off/.test(B.palmFramingHint(hand({ 0: { x: 0.5, y: 1.04 } })) || ''));
check('FRAME huge span -> too close hint', /Too close/.test(B.palmFramingHint(hand({ 5: { x: 0.08, y: 0.5 }, 17: { x: 0.76, y: 0.5 }, 8: { x: 0.05, y: 0.25 }, 20: { x: 0.82, y: 0.3 } })) || ''));
check('FRAME tiny span -> closer hint', /closer/.test(B.palmFramingHint(hand({ 5: { x: 0.45, y: 0.5 }, 17: { x: 0.55, y: 0.5 } })) || ''));
check('FRAME no landmarks -> null', B.palmFramingHint(null) === null);
/* v34 free-form scanning: the hints are the only positioning text the
   scan view shows, and none of them may send the user to a ring or a
   guide - the hand is shown to the camera, anywhere in the frame. */
check('FRAME cut-off hint never mentions a ring or guide', !/ring|guide/i.test(B.palmFramingHint(hand({ 12: { x: 0.49, y: -0.03 } })) || ''));
check('FRAME too-close hint never mentions a ring or guide', !/ring|guide/i.test(B.palmFramingHint(hand({ 5: { x: 0.08, y: 0.5 }, 17: { x: 0.76, y: 0.5 }, 8: { x: 0.05, y: 0.25 }, 20: { x: 0.82, y: 0.3 } })) || ''));
check('FRAME closer hint never mentions a ring or guide', !/ring|guide/i.test(B.palmFramingHint(hand({ 5: { x: 0.45, y: 0.5 }, 17: { x: 0.55, y: 0.5 } })) || ''));

/* Live gate: a sane code on a 1.58-openness frame is a live candidate
   but never an enrolment-banked frame. */
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function roiImage(seed) {
  const rnd = lcg(seed), g = new Array(128 * 128);
  const creases = [{ a: 0.22, b: 26, f: 0.05, p: 1, amp: 3 }, { a: -0.35, b: 92, f: 0.04, p: 3, amp: 4 }, { a: 0.04, b: 62, f: 0.06, p: 5, amp: 3 }];
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    let v = 172 + Math.sin(x * 0.045 + 1.7) * 9 + Math.cos(y * 0.06 + 0.4) * 7;
    for (const c of creases) { const ly = c.a * x + c.b + Math.sin(x * c.f + c.p) * c.amp; const d = Math.abs(y - ly); if (d < 3) v -= (3 - d) * 30; }
    g[y * 128 + x] = Math.max(0, Math.min(255, Math.round(v + (rnd() - 0.5) * 12)));
  }
  return g;
}
const code = B.palmprintEncode(roiImage(7), 128, 128);
const frame158 = { openness: 1.58, code: code, codeM: null, sharpness: 50 };
check('GATE code is sane', B.palmprintCodeSane(code) === true);
check('GATE enrolment selection still excludes a 1.58 frame', B.palmprintUsableOpenFrames([frame158]).length === 0);
check('GATE live selection includes a 1.58 frame', B.palmprintUsableOpenFrames([frame158], B.PALM_LIVE_OPEN_MIN).length === 1);
const liveCodes = B.selectPalmprintLiveCodes([frame158]);
check('GATE selectPalmprintLiveCodes returns the 1.58 frame code', Array.isArray(liveCodes) && liveCodes.length === 1);
const frame140 = { openness: 1.40, code: code, codeM: null, sharpness: 50 };
check('GATE a 1.40 frame is excluded even live', B.selectPalmprintLiveCodes([frame140]) === null);

console.log('framing tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
