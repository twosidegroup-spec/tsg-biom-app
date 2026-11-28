/* TSG BIOM v53 — the genuine-owner verify fix.

   Ordered 2026-11-24 after the Chairman's own LEFT palm — the
   correct, hand-stamped hand for his Sajid profile — failed the
   wallet-OPEN scan on his phone under v52 ("The scan did not
   verify. Nothing was authorised."), good light, steady, hand
   detected. His screenshot showed the presentation: palm very
   close to the camera, fingertips cropped at the top of the
   frame, all three v52 indicators green.

   Proven here:
   - FRAME RULE (B.palmFrameCompleteness): a frame counts
     toward matching only when the hand is fully inside the
     frame — all five fingertips within the framing hint's own
     0.02 margin, knuckle span (5-17) at or below the hint's
     own 0.55 too-close ceiling. A small whole palm (span under
     the hint's 0.15 floor) is 'tooFar' — advice only, the
     frame still counts. The constants are the hint's numbers,
     promoted from advice to judgement so hint and rule cannot
     disagree (pinned by agreement checks on the same
     fixtures).
   - The collected-set selection (B.selectPalmprintLiveRois)
     never selects a frame marked incomplete — the sharpest
     frame in the set loses to a duller whole one. Frames
     carrying no judgement (every pre-v53 fixture) pass as
     before. Source pins: both scan streams match/embed only
     complete frames, and both hand consensuses read complete
     frames only, so a cropped close-up's chirality cannot
     reach the v51 gate.
   - GUIDANCE: the completeness issue outranks the framing
     mapping — 'Move back — fit your whole palm in the frame'
     for cropped/too close, 'Move a little closer' for too
     far; without a frameIssue the pre-v53 mappings are
     untouched. The v52 hand indicator warns on an unscorable
     hand instead of showing green (source pin).
   - DIAGNOSIS (B.scanDiagnosisLines): the panel under a
     failed scan's message carries the best palm score vs
     0.32, the PalmNet score vs its bar (or 'no neural
     evidence'), the hand read, and — when the hand gate
     decided the rejection — the plain gate sentence. The
     values are the log record's values: the fixture below
     builds the diag from the same fields a field record
     carries and pins that the panel prints exactly those
     numbers; source pins show the streams attach the diag
     from the same variables the record is built from.
   - RECOVERY: 'Strengthen my palm' exists ONLY on the two
     wallet-open contexts (source pins — the money contexts
     carry no recovery flag); it launches the existing guided
     Add Angles capture through openTopup's recovery entry,
     which every ordinary entry clears. The banking guard
     still refuses a different palm (functional). A refusal
     inside a recovery capture — and only there — offers
     'Re-register this palm' (source pins); the confirmation
     is Delete-All-Data style (typed REPLACE enables the
     button; the panel and its counts exist in the shipped
     markup). The re-registration runs two guided bursts
     (source pins: step 1 natural distance, step 2 farther
     back) and banks ONLY complete frames (source pin) into
     the same profile shape enrolment writes; the functional
     section builds that bank from fixture frames and proves
     it verifies the owner's palm and rejects another, that
     an all-incomplete capture banks nothing, and that the
     app-style save (one field replaced) leaves Biom ID,
     wallet, limits, points and every other profile
     byte-identical. The event is logged as 'Owner
     Re-registration' with the old bank's counts (source pin).
   - VERSIONS: v53 / shell v53 / chain newest v53, and the
     v52->v53 migration is a pure adoption (full proof in
     v38-migration.test.js).
   No threshold moved: EDCC 0.32, PalmNet 0.5773, the fusion
   OR rule, the strict money rule and its three sites, the
   banking guard bars and the v51 hand gate are all pinned by
   their own suites, which pass unmodified.
   (v54 note: the PalmNet bar has since moved to the Round 3
   model's own measured EER threshold, 0.5895 — an ordered
   model swap pinned in v54-palmnet-r3.test.js. The diagnosis
   panel prints the RUNNING bar, so the DIAG check below names
   its current rendering; every other rule named here is
   unchanged, and this suite's version pins were converted to
   the coherence form when v54 shipped.)
   (v60 note: wallet ENTRY is no longer a scan — the
   Chairman's order "entering our own wallet no need scan" —
   so the recovery ENTRY moved from the wallet-open failure
   panel to My Account → Palm Identity (Strengthen my palm /
   Neural scan / Re-register this palm, the last through the
   same openRecoveryTopup grant). The two entry-gating pins
   below were rewritten for the relocation and say so; the
   diagnosis panel stays on real scan failures, and the
   recovery machinery itself — grant, guard, refusal-gated
   offer, typed REPLACE, two-burst bank — is untouched.)
   All numbers here are RIG numbers; the phone is the verdict. */
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

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

/* ---------------- fixture machinery (v41/v45/v49 family) ------- */
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const S = B.PALMPRINT_ROI_SIZE;
function roiImage(creases, seed, size, noiseAmp) {
  const rnd = lcg(seed); const noise = [];
  for (let i = 0; i < size * size; i++) noise.push((rnd() - 0.5) * noiseAmp);
  const g = new Array(size * size); const k = 128 / size;
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
function framesFor(creases, seed0) {
  const frames = [];
  for (let i = 0; i < 9; i++) {
    const roi = roiImage(creases, seed0 + i * 13, S, 10);
    frames.push({ openness: 2.0, code: B.palmprintEncode(roi, S, S), codeM: null, roi: roi, sharpness: 400 + i * 10, poseTag: null, poseDesc: null });
  }
  return frames;
}
/* Landmark fixtures — the framing.test.js hand (span ~0.355,
   every tip inside the frame). */
function hand(over) {
  const lm = [];
  for (let i = 0; i < 21; i++) lm.push({ x: 0.5, y: 0.5 });
  lm[0] = { x: 0.5, y: 0.88 };
  lm[4] = { x: 0.22, y: 0.52 };            // thumb tip (inside)
  lm[5] = { x: 0.36, y: 0.46 };
  lm[9] = { x: 0.49, y: 0.43 };
  lm[13] = { x: 0.61, y: 0.46 };
  lm[17] = { x: 0.71, y: 0.51 };
  lm[8] = { x: 0.31, y: 0.2 };
  lm[12] = { x: 0.49, y: 0.15 };
  lm[16] = { x: 0.65, y: 0.21 };
  lm[20] = { x: 0.78, y: 0.32 };
  if (over) Object.keys(over).forEach(function (k) { lm[Number(k)] = over[k]; });
  return lm;
}

/* ---------------- the frame rule -------------------------------- */
check('FRAME the rule constants are the framing hint\'s own numbers (0.02 margin, 0.55 ceiling, 0.15 floor)',
  B.PALM_FRAME_TIP_MARGIN === 0.02 && B.PALM_FRAME_MAX_SPAN === 0.55 && B.PALM_FRAME_MIN_SPAN === 0.15);
const whole = B.palmFrameCompleteness(hand());
check('FRAME a whole hand in frame is complete', whole && whole.complete === true && whole.issue === null, JSON.stringify(whole));
const croppedMid = B.palmFrameCompleteness(hand({ 12: { x: 0.49, y: -0.03 } }));
check('FRAME a fingertip above the frame is cropped and does not count', croppedMid && croppedMid.complete === false && croppedMid.issue === 'cropped');
const croppedThumb = B.palmFrameCompleteness(hand({ 4: { x: 1.04, y: 0.52 } }));
check('FRAME the thumb tip is one of the five — out is cropped (the brief\'s rule; the hint alone never checked it)',
  croppedThumb && croppedThumb.complete === false && croppedThumb.issue === 'cropped');
const tooCloseLm = hand({ 5: { x: 0.08, y: 0.5 }, 17: { x: 0.76, y: 0.5 }, 8: { x: 0.05, y: 0.25 }, 20: { x: 0.82, y: 0.3 } });
const tooClose = B.palmFrameCompleteness(tooCloseLm);
check('FRAME knuckle span over the 0.55 ceiling is tooClose and does not count',
  tooClose && tooClose.complete === false && tooClose.issue === 'tooClose', tooClose && ('span=' + tooClose.span.toFixed(3)));
const tooFar = B.palmFrameCompleteness(hand({ 5: { x: 0.45, y: 0.5 }, 17: { x: 0.55, y: 0.5 } }));
check('FRAME a small whole palm is tooFar advice only — the frame still counts',
  tooFar && tooFar.complete === true && tooFar.issue === 'tooFar', tooFar && ('span=' + tooFar.span.toFixed(3)));
check('FRAME unusable landmarks give no judgement', B.palmFrameCompleteness(null) === null && B.palmFrameCompleteness(hand().slice(0, 20)) === null);
check('FRAME the hint and the rule agree on the cropped fixture', /cut off/.test(B.palmFramingHint(hand({ 12: { x: 0.49, y: -0.03 } })) || ''));
check('FRAME the hint and the rule agree on the too-close fixture', /Too close/.test(B.palmFramingHint(tooCloseLm) || ''));

/* ---------------- the rule in the collected set ----------------- */
(function () {
  const sharpWhole = framesFor(PALM_A, 500)[0]; sharpWhole.sharpness = 300; sharpWhole.frameComplete = true;
  const dullWhole = framesFor(PALM_A, 700)[0]; dullWhole.sharpness = 200; dullWhole.frameComplete = true;
  const sharpestCropped = framesFor(PALM_B, 900)[0]; sharpestCropped.sharpness = 900; sharpestCropped.frameComplete = false;
  const sel = B.selectPalmprintLiveRois([sharpWhole, sharpestCropped, dullWhole]);
  check('SET the sharpest frame loses when it is incomplete — it is never selected',
    !!sel && sel.indexOf(sharpestCropped.roi) === -1 && sel.indexOf(sharpWhole.roi) !== -1 && sel.indexOf(dullWhole.roi) !== -1,
    sel ? ('selected ' + sel.length) : 'null');
  const unmarked = framesFor(PALM_B, 900)[0]; unmarked.sharpness = 900; // no frameComplete field at all
  const sel2 = B.selectPalmprintLiveRois([sharpWhole, unmarked]);
  check('SET a frame carrying no judgement passes exactly as before v53',
    !!sel2 && sel2.indexOf(unmarked.roi) !== -1);
})();

/* ---------------- stream wiring (source pins) ------------------- */
check('WIRE both scan streams match and embed only complete frames',
  (appSrc.match(/if \(sane && r\.roi && r\.frameComplete\)/g) || []).length === 2);
check('WIRE both hand consensuses read complete frames only',
  (appSrc.match(/frames\.filter\(function \(f\) \{ return f\.frameComplete === true; \}\)/g) || []).length === 2);
check('WIRE the frame analysis stamps every frame with the judgement',
  appSrc.indexOf('frameComplete: comp ? comp.complete : false') !== -1 &&
  appSrc.indexOf('var comp = B.palmFrameCompleteness(lm);') !== -1);
check('WIRE enrolment banking keeps its own quality gate (the frame rule does not re-found enrolment)',
  appSrc.indexOf('B.selectPalmprintBurstCodes(res.results)') !== -1);
check('WIRE the hand indicator warns on an unscorable hand instead of showing green',
  appSrc.indexOf("info.frameComplete === false") !== -1 && appSrc.indexOf("'Hand cropped — move back'") !== -1 &&
  appSrc.indexOf("'Too close — move back'") !== -1);

/* ---------------- guidance -------------------------------------- */
check('GUIDE cropped -> the move-back instruction, in the approved words',
  B.palmGuidance({ hasHand: true, frameIssue: 'cropped' }) === 'Move back — fit your whole palm in the frame');
check('GUIDE tooClose -> the same move-back instruction',
  B.palmGuidance({ hasHand: true, frameIssue: 'tooClose' }) === 'Move back — fit your whole palm in the frame');
check('GUIDE tooFar -> move a little closer',
  B.palmGuidance({ hasHand: true, frameIssue: 'tooFar' }) === 'Move a little closer');
check('GUIDE the completeness issue outranks a contradictory framing hint',
  B.palmGuidance({ hasHand: true, frameIssue: 'cropped', framing: 'Move the palm a little closer' }) === 'Move back — fit your whole palm in the frame');
check('GUIDE without a frameIssue the pre-v53 framing mapping is untouched',
  B.palmGuidance({ hasHand: true, framing: 'Too close', meanLuma: 100, glareFrac: 0, openness: 2, sharpness: 200 }) === 'Move a little farther');

/* ---------------- the diagnosis panel --------------------------- */
(function () {
  // The fixture record is shaped like the scan's log record:
  // the genuine score plus the hand/neural extras the streams
  // attach. The diag is built from THOSE fields — the panel
  // must print the record's numbers, digit for digit.
  const rec = { genuineScore: 0.287, palmnetScore: 0.512, probeHand: 'left', profileHand: 'left', handGate: false };
  const diag = { edcc: rec.genuineScore, neural: rec.palmnetScore, probeHand: rec.probeHand, profileHand: rec.profileHand, handGate: rec.handGate };
  const lines = B.scanDiagnosisLines(diag);
  check('DIAG the panel prints the log record\'s palm score against the 0.32 bar',
    lines.some(function (l) { return l.indexOf(rec.genuineScore.toFixed(3)) !== -1 && l.indexOf('0.32') !== -1; }), lines.join(' | '));
  check('DIAG the panel prints the log record\'s PalmNet score against the running bar (0.59 at 2dp)',
    lines.some(function (l) { return l.indexOf(rec.palmnetScore.toFixed(3)) !== -1 && l.indexOf(B.PALMNET_THRESHOLD.toFixed(2)) !== -1; }));
  check('DIAG the panel states the hand read', lines.indexOf('Hand read: left.') !== -1);
  check('DIAG no gate sentence when the gate did not decide',
    !lines.some(function (l) { return l.indexOf('different identity') !== -1; }));
  const gateLines = B.scanDiagnosisLines({ edcc: null, neural: null, probeHand: 'right', profileHand: 'left', handGate: true });
  check('DIAG a hand-gate rejection says so plainly, naming both hands',
    gateLines.some(function (l) { return l.indexOf('different identity') !== -1 && l.indexOf('left') !== -1 && l.indexOf('right') !== -1 && l.indexOf('not scored') !== -1; }),
    gateLines.join(' | '));
  check('DIAG no neural evidence is stated, not faked',
    gateLines.some(function (l) { return l.indexOf('no neural evidence') !== -1; }));
  const gate1N = B.scanDiagnosisLines({ edcc: 0.11, neural: null, probeHand: 'right', profileHand: null, handGate: true, excludedCount: 1 });
  check('DIAG the 1:N gate sentence names the exclusion',
    gate1N.some(function (l) { return l.indexOf('different identity') !== -1 && l.indexOf('1 registered profile') !== -1 && l.indexOf('excluded') !== -1; }),
    gate1N.join(' | '));
  check('DIAG no diag, no panel', B.scanDiagnosisLines(null).length === 0 && B.scanDiagnosisLines(undefined).length === 0);
})();
check('DIAG the verify stream attaches the diag from the same values its record carries',
  appSrc.indexOf('var rejDiag = { edcc: fused.similarity, neural: nScore') !== -1 &&
  appSrc.indexOf('fieldRec(fused.similarity, impMax') !== -1 &&
  appSrc.indexOf('diag: rejDiag') !== -1);
check('DIAG the identify stream attaches its best score and hand evidence',
  appSrc.indexOf("diag: { edcc: best && typeof best.similarity === 'number'") !== -1 &&
  appSrc.indexOf('handGate: excludedCount > 0') !== -1);
check('DIAG the wallet card renders the panel under the failure message (v69 named pin change: the v69 guidance panel is appended to the same assignment)',
  appSrc.indexOf('var diagHtml = scanDiagHTML(out && out.diag);') !== -1 &&
  appSrc.indexOf("$('wScanDiag').innerHTML = diagHtml + extraHtml;") !== -1 &&
  htmlSrc.indexOf('id="wScanDiag"') !== -1);
check('DIAG the terminal renders the panel on both failure surfaces',
  (appSrc.match(/scanDiagHTML\(out\.diag\)/g) || []).length === 2);

/* ---------------- recovery: entry gating ------------------------ */
/* v60 PIN CHANGES (named openly): at v53-v59 the recovery
   entry hung off the two wallet-open scan contexts (the
   'recoverable: true' flags, the failure-panel picker and the
   named 1:1 button). At v60 wallet entry is no longer a scan
   (the Chairman's order, 2026-11-25), so those contexts are
   gone and the SAME actions live on the owner's Palm Identity
   card in My Account. The two checks below replace the two
   that stood here; everything else in this section — the
   grant, the guard, the refusal-gated offer, the typed
   REPLACE, the two-burst bank — is unchanged. */
check('RECOVERY v60: no scan context carries the recovery flag any more (wallet entry is not a scan)',
  (appSrc.match(/recoverable: true/g) || []).length === 0 &&
  appSrc.indexOf('renderWalletRecovery') === -1 && appSrc.indexOf('data-strengthen') === -1);
check('RECOVERY v60: the Palm Identity card carries the relocated actions — Strengthen my palm, Neural scan, Re-register this palm',
  appSrc.indexOf('data-acct-topup="angles">Strengthen my palm') !== -1 &&
  appSrc.indexOf('data-acct-topup="neural">Neural scan') !== -1 &&
  appSrc.indexOf('id="acRereg">Re-register this palm') !== -1 &&
  appSrc.indexOf('openRecoveryTopup(me.id)') !== -1);
check('RECOVERY the recovery entry launches the guided Add Angles capture for the chosen profile',
  appSrc.indexOf("function openRecoveryTopup(personId) { openTopup(personId, 'angles', true); }") !== -1);
check('RECOVERY every ordinary top-up entry clears the recovery state',
  appSrc.indexOf('recoveryPersonId = viaRecovery ? personId : null;') !== -1);
check('RECOVERY the banking guard still refuses a different palm (the bars did not move)',
  (function () {
    const bank = B.palmprintPackedCandidates(framesFor(PALM_A, 300)).list.map(function (c) { return c.b64; });
    const profile = { v: 4, format: B.PALMPRINT_FORMAT, codes: bank, hand: 'left' };
    const probesB = B.palmprintPackedCandidates(framesFor(PALM_B, 1300)).list.map(function (c) { return c.words; });
    const g = B.bankingGuardCheck(profile, { edccProbes: probesB, neuralEmbeddings: [], hand: null });
    return g.status === 'fail';
  })());
check('RECOVERY the re-registration offer exists only behind a refusal inside a recovery capture',
  appSrc.indexOf('if (recoveryPersonId && recoveryPersonId === person.id)') !== -1 &&
  appSrc.indexOf('id="topReregOpen"') !== -1 &&
  appSrc.indexOf('This palm does not match this profile — nothing was added') !== -1);
check('RECOVERY the confirmation is Delete-All-Data style: named profile, bank counts, typed REPLACE',
  htmlSrc.indexOf('id="topRereg"') !== -1 && htmlSrc.indexOf('id="topReregCounts"') !== -1 &&
  htmlSrc.indexOf('id="topReregInput"') !== -1 && htmlSrc.indexOf('id="topReregConfirm"') !== -1 &&
  appSrc.indexOf("input.value.trim() !== 'REPLACE'") !== -1 &&
  appSrc.indexOf("$('topReregCounts').textContent") !== -1);
(function () {
  const run = appSrc.slice(appSrc.indexOf('function runReRegistration'), appSrc.indexOf('function bankReRegistration'));
  check('RECOVERY the re-registration is two guided bursts — natural distance, then farther back',
    run.indexOf('step 1 of 2') !== -1 && run.indexOf('step 2 of 2') !== -1 &&
    (run.match(/streamEnrolPalm/g) || []).length === 2);
  const bank = appSrc.slice(appSrc.indexOf('function bankReRegistration'), appSrc.indexOf('function wireRereg'));
  check('RECOVERY the new bank is built from complete frames only, saved as the one replaced field',
    bank.indexOf('r.frameComplete === true') !== -1 &&
    bank.indexOf('B.palmprintPackedCandidates(complete)') !== -1 &&
    bank.indexOf('Object.assign({}, person, { palmProfile: profile })') !== -1);
  check('RECOVERY the event is logged as an owner re-registration with the old bank\'s counts',
    bank.indexOf("result: 'Owner Re-registration'") !== -1 && bank.indexOf('Old bank: ') !== -1 &&
    bank.indexOf('typed REPLACE') !== -1);
})();

/* ---------------- recovery: the bank build works ---------------- */
(function () {
  // The owner's two guided bursts, fixture form: palm A frames
  // complete, plus palm B frames marked incomplete (a wrong
  // palm wandering through the capture must not contaminate).
  const burst1 = framesFor(PALM_A, 2100).map(function (f) { f.frameComplete = true; return f; });
  const burst2 = framesFor(PALM_A, 2400).map(function (f) { f.frameComplete = true; return f; });
  const stray = framesFor(PALM_B, 2700).map(function (f) { f.frameComplete = false; return f; });
  const results = burst1.concat(burst2, stray);
  const complete = results.filter(function (r) { return r.frameComplete === true; });
  const cand = B.palmprintPackedCandidates(complete);
  check('BANK the recovery build banks templates from the complete frames', cand.list.length > 0, 'candidates=' + cand.list.length);
  const profile = { v: 4, format: B.PALMPRINT_FORMAT, codes: cand.list.slice(0, B.PALMPRINT_PROFILE_MAX_CODES).map(function (c) { return c.b64; }), hand: 'left' };
  const liveA = B.selectPalmprintLiveCodes(framesFor(PALM_A, 3100));
  const verA = liveA && B.verifyPalmprintProfile(profile, liveA);
  check('BANK the re-registered bank verifies the owner\'s palm',
    !!verA && verA.verified === true && verA.similarity >= B.PALMPRINT_THRESHOLD,
    verA ? ('sim=' + (verA.similarity || 0).toFixed(3)) : 'no live codes');
  const liveB = B.selectPalmprintLiveCodes(framesFor(PALM_B, 3400));
  const verB = liveB && B.verifyPalmprintProfile(profile, liveB);
  check('BANK the re-registered bank still rejects another palm',
    !!verB && verB.verified === false, verB ? ('sim=' + (verB.similarity || 0).toFixed(3)) : 'no live codes');
  const noneComplete = results.filter(function (r) { return r.frameComplete === true && false; });
  check('BANK an all-incomplete capture banks nothing (the app changes nothing)',
    B.palmprintPackedCandidates(noneComplete).list.length === 0);
  // The app-style save: one field replaced on the same record.
  const person = { id: 'TSG-BIO-7', name: 'Owner', phone: '01933038706', type: 'Customer', store: 'HQ',
    limits: { perTx: 1000, daily: 5000 }, loyaltyPoints: 42,
    wallet: { balance: 450, statement: [{ kind: 'add', amount: 450, ref: 'DEMO-1' }], linkedAccounts: [{ id: 'a1', type: 'bKash', label: 'Owner bKash' }] },
    walletProvider: 'bKash', walletNumber: '01933038706', palmProfile: { v: 4, format: 'packed96', codes: ['T0xE'], hand: 'left' } };
  const other = { id: 'TSG-BIO-8', name: 'Other', palmProfile: { v: 4, format: 'packed96', codes: ['T1RIRVI='], hand: 'right' } };
  const people = [person, other];
  const updated = Object.assign({}, person, { palmProfile: profile });
  const untouched = Object.keys(person).every(function (k) {
    return k === 'palmProfile' || JSON.stringify(updated[k]) === JSON.stringify(person[k]);
  });
  check('BANK the save replaces only the palm bank — ID, wallet, limits, points byte-identical',
    untouched && updated.id === person.id && updated.palmProfile !== person.palmProfile &&
    people[1] === other && JSON.stringify(other.palmProfile) === JSON.stringify({ v: 4, format: 'packed96', codes: ['T1RIRVI='], hand: 'right' }));
})();

/* ---------------- versions + migration -------------------------- */
// v54: the three absolute pins below were converted to the
// version-coherence form (the v48/v49/v50/v51/v52 pattern) when
// v54 shipped — v53 remains IN the chain as an adoption step;
// the living current-version pins are in v38-migration + the
// v54 suite. The v53 proofs in this suite are unchanged.
check('VERSION app data version and shell version agree', (function () {
  const dv = (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1];
  const sv = (swSrc.match(/tsg-biom-shell-(v\d+)/) || [])[1];
  return !!dv && dv === sv;
})());
check('VERSION v53 remains in the chain as an adoption step', B.BIOM_DATA_VERSIONS.indexOf('v53') !== -1);
(function () {
  const store = { people: [{ id: 'TSG-BIO-1', name: 'Rig', limits: { perTx: 1000, daily: 5000 }, loyaltyPoints: 9,
    wallet: { balance: 450, statement: [{ kind: 'add', amount: 450, ref: 'DEMO-1' }], linkedAccounts: [{ id: 'a1', type: 'bKash', label: 'Rig bKash' }] },
    palmProfile: { v: 4, format: 'packed96', hand: 'left', codes: ['QUJD'], neural: { v: 1, dim: 256, model: 'palmnet-v1', embeddings: ['QUJD'] } } }],
    logs: [], transactions: [], meta: [] };
  const before = JSON.stringify(store);
  const mig = B.migrateBiomData(JSON.parse(before), 'v52', 'v53');
  check('MIGRATION v52->v53 is a pure adoption (byte-identical store)',
    mig.appliedSteps.indexOf('v53') !== -1 && mig.changed === false && JSON.stringify(mig.snapshot) === before);
})();

info('rig only: landmark fixtures are synthetic geometry; palm fixtures are synthetic prints. The phone verdict — his left palm verifying at the money scans (wallet entry itself has needed no scan since v60) — is the real-world proof, and it has not been claimed here.');
console.log('\nv53 owner-verify-fix tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
