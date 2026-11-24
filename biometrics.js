/* TSG Biom - real biometric matching logic.
   Pure functions only: every score here is computed from real captured data.
   There is no random element in any function in this file.
   Works in the browser (window.TSGBiometrics) and in Node/Bun for testing.

   SECURITY POSTURE (hardened after false-accept reports, 2026-11-19):
   Fail closed everywhere. A verification can only pass when ALL of these
   hold: (a) the enrolled template is present and non-degenerate, (b) the
   live capture is present and non-degenerate, (c) the comparison passes
   the method's rule. Null, empty, zero, constant, NaN or mismatched data
   is DENIED, never verified. Fingerprint uses a BOTH-MUST-PASS rule
   (correlation AND texture independently), never an average that lets a
   strong texture score carry a weak template match. */
(function (global) {
  'use strict';

  var FACE_THRESHOLD = 0.6;       // Euclidean distance on 128-d face descriptor
  var FACE_MIN_NORM = 0.2;        // real face descriptors have norm ~0.5-1.5; near-zero = degenerate
  var PALM_THRESHOLD = 0.06;      // Euclidean distance on normalized hand-geometry descriptor.
                                  // Calibrated with synthetic tests (see tests/false-accept.test.js):
                                  // same hand, 5-frame averaged, landmark jitter up to 0.008 of frame
                                  // -> distance <= 0.035; smallest different-hand change tested
                                  // (palm 6% wider) -> 0.079; fingers +3% & spread 1.05 -> 0.23.
                                  // 0.06 sits between: ~1.7x margin over worst same-hand noise,
                                  // and every different-hand variant tested is above it.
  var FINGER_CORR_MIN = 0.55;     // template Pearson correlation must pass on its own
  var FINGER_TEXTURE_MIN = 0.60;  // LBP texture similarity must ALSO pass on its own
  var FINGER_THRESHOLD = FINGER_CORR_MIN; // legacy export: the headline finger threshold

  /* ---------------- shared sanity helpers ---------------- */

  function allFinite(arr) {
    for (var i = 0; i < arr.length; i++) {
      var v = Number(arr[i]);
      if (!isFinite(v) || isNaN(v)) return false;
    }
    return true;
  }
  function vecNorm(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) { var v = Number(arr[i]); s += v * v; }
    return Math.sqrt(s);
  }
  function vecStd(arr) {
    if (!arr || !arr.length) return 0;
    var m = 0, i;
    for (i = 0; i < arr.length; i++) m += Number(arr[i]);
    m /= arr.length;
    var s = 0;
    for (i = 0; i < arr.length; i++) { var d = Number(arr[i]) - m; s += d * d; }
    return Math.sqrt(s / arr.length);
  }

  /* A usable face descriptor: right shape, finite, and with real energy.
     A zero / near-zero / constant descriptor is degenerate - it would sit
     at distance ~0 from another degenerate descriptor and false-accept. */
  function faceDescriptorSane(d) {
    if (!d || d.length !== 128) return false;
    if (!allFinite(d)) return false;
    if (vecNorm(d) < FACE_MIN_NORM) return false;
    if (vecStd(d) < 0.005) return false; // constant vector carries no identity
    return true;
  }

  /* A usable palm geometry descriptor: 30 positive, plausible distances. */
  function palmDescriptorSane(d) {
    if (!d || d.length !== 30) return false;
    if (!allFinite(d)) return false;
    for (var i = 0; i < d.length; i++) {
      var v = Number(d[i]);
      if (v < 0.03 || v > 3.5) return false; // normalized hand distances live well inside this band
    }
    if (vecNorm(d) < 1) return false; // a real 30-measure hand descriptor has norm ~4-6
    return true;
  }

  /* A usable fingerprint record: non-flat template + a real texture
     histogram (sums to ~1, not concentrated in a single bin). */
  function fingerprintRecordSane(rec) {
    if (!rec || !rec.template || !rec.texture) return false;
    if (!rec.template.length || rec.template.length !== 96 * 96) return false;
    if (rec.texture.length !== 256) return false;
    if (!allFinite(rec.template) || !allFinite(rec.texture)) return false;
    if (vecStd(rec.template) < 5) return false; // flat/blank template
    var sum = 0, maxBin = 0;
    for (var i = 0; i < 256; i++) { var v = Number(rec.texture[i]); if (v < 0) return false; sum += v; if (v > maxBin) maxBin = v; }
    if (Math.abs(sum - 1) > 0.05) return false;
    if (maxBin > 0.95) return false; // single-bin histogram = uniform image, not a print
    return true;
  }

  function euclidean(a, b) {
    if (!a || !b || a.length !== b.length || a.length === 0) return null;
    var sum = 0;
    for (var i = 0; i < a.length; i++) {
      var d = Number(a[i]) - Number(b[i]);
      if (!isFinite(d)) return null;
      sum += d * d;
    }
    return Math.sqrt(sum);
  }

  /* ---------------- Face ---------------- */

  function verifyFace(storedDescriptor, liveDescriptor) {
    if (!faceDescriptorSane(storedDescriptor)) {
      return { ok: false, verified: false, distance: null, threshold: FACE_THRESHOLD, reason: 'No usable face enrolled for this person - the stored face data is missing or invalid.' };
    }
    if (!faceDescriptorSane(liveDescriptor)) {
      return { ok: false, verified: false, distance: null, threshold: FACE_THRESHOLD, reason: 'No real face was detected in this scan.' };
    }
    var distance = euclidean(storedDescriptor, liveDescriptor);
    if (distance === null || !isFinite(distance)) {
      return { ok: false, verified: false, distance: null, threshold: FACE_THRESHOLD, reason: 'Face comparison failed.' };
    }
    return {
      ok: true,
      verified: distance < FACE_THRESHOLD,
      distance: distance,
      threshold: FACE_THRESHOLD,
      reason: distance < FACE_THRESHOLD ? 'Face distance below threshold.' : 'Face distance above threshold - not the enrolled person.'
    };
  }

  /* ---------------- Palm ---------------- */

  /* Build a scale/translation-normalized hand-geometry descriptor from
     MediaPipe's 21 hand landmarks ([{x,y,z}, ...]).
     Returns null for degenerate or implausible detections: partial hands,
     collapsed/tiny landmark clusters, or geometry no real hand has - a
     descriptor is never built from those. */
  function palmDescriptorFromLandmarks(landmarks) {
    if (!landmarks || landmarks.length !== 21) return null;
    var i;
    for (i = 0; i < 21; i++) {
      var p = landmarks[i];
      if (!p || !isFinite(Number(p.x)) || !isFinite(Number(p.y))) return null;
    }
    // The hand must occupy a real fraction of the frame - a tiny cluster of
    // points is a false/partial detection, not a palm.
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    landmarks.forEach(function (pt) {
      if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
    });
    var bw = maxX - minX, bh = maxY - minY;
    if (bw < 0.12 || bh < 0.12 || bw * bh < 0.025) return null;

    var wrist = landmarks[0];
    var pts = landmarks.map(function (pt) {
      return { x: pt.x - wrist.x, y: pt.y - wrist.y };
    });
    var scale = Math.hypot(pts[9].x, pts[9].y); // wrist -> middle finger MCP
    if (!scale || scale < 0.10) return null; // hand too small / collapsed
    pts = pts.map(function (pt) { return { x: pt.x / scale, y: pt.y / scale }; });
    function dist(a, b) { return Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y); }

    // Human-plausible geometry: fingertip reach from the wrist, in units of
    // the wrist->middle-MCP scale. Outside these bands it is not a real
    // open hand (bent/partial/false detection) - reject, do not describe.
    var reach = [
      { tip: 4, min: 0.8, max: 2.3 },   // thumb
      { tip: 8, min: 1.6, max: 2.6 },   // index
      { tip: 12, min: 1.9, max: 2.9 },  // middle
      { tip: 16, min: 1.7, max: 2.7 },  // ring
      { tip: 20, min: 1.3, max: 2.3 }   // pinky
    ];
    for (i = 0; i < reach.length; i++) {
      var d = dist(0, reach[i].tip);
      if (!(d >= reach[i].min && d <= reach[i].max)) return null;
    }
    var knuckleSpan = dist(5, 17); // index MCP -> pinky MCP
    if (!(knuckleSpan >= 0.5 && knuckleSpan <= 1.5)) return null;
    // Every finger chain must have real segment lengths (no folded-to-zero joints).
    var chains = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
    for (i = 0; i < chains.length; i++) {
      var ch = chains[i];
      for (var j = 0; j < ch.length - 1; j++) {
        if (dist(ch[j], ch[j + 1]) < 0.12) return null;
      }
    }

    var pairs = [
      [0, 5], [0, 9], [0, 13], [0, 17], [5, 9], [9, 13], [13, 17],
      [5, 8], [9, 12], [13, 16], [17, 20],
      [2, 4], [5, 6], [6, 8], [9, 10], [10, 12], [13, 14], [14, 16], [17, 18], [18, 20],
      [4, 8], [8, 12], [12, 16], [16, 20], [4, 20], [0, 4], [0, 8], [0, 12], [0, 16], [0, 20]
    ];
    var descriptor = pairs.map(function (pr) { return dist(pr[0], pr[1]); });
    return palmDescriptorSane(descriptor) ? descriptor : null;
  }

  function verifyPalm(storedDescriptor, liveDescriptor) {
    if (!palmDescriptorSane(storedDescriptor)) {
      return { ok: false, verified: false, distance: null, threshold: PALM_THRESHOLD, reason: 'No usable palm enrolled for this person - the stored palm data is missing or invalid.' };
    }
    if (!palmDescriptorSane(liveDescriptor)) {
      return { ok: false, verified: false, distance: null, threshold: PALM_THRESHOLD, reason: 'No real open palm was detected in this scan.' };
    }
    var distance = euclidean(storedDescriptor, liveDescriptor);
    if (distance === null || !isFinite(distance)) {
      return { ok: false, verified: false, distance: null, threshold: PALM_THRESHOLD, reason: 'Palm comparison failed.' };
    }
    return {
      ok: true,
      verified: distance < PALM_THRESHOLD,
      distance: distance,
      threshold: PALM_THRESHOLD,
      reason: distance < PALM_THRESHOLD ? 'Palm geometry distance below threshold.' : 'Palm geometry distance above threshold - not the enrolled hand.'
    };
  }

  /* ---------------- Palm strengthening (2026-11-20) ----------------
     Three layers added on top of the geometry match, after calibration
     probes (synthetic hands + synthetic palm images, 2026-11-20):

     1) MULTI-CAPTURE PROFILE. Enrollment stores up to 5 geometry captures
        of the same hand (slightly different angles). Verification takes
        the BEST (smallest) distance - angle variation at enrollment is
        the main cause of genuine palm rejections.

     2) TEXTURE REALNESS GATE. A global LBP histogram of the palm crop.
        Calibration was blunt: LBP similarity for the same palm re-rendered
        was 0.892 and for a DIFFERENT palm 0.895 - global LBP does NOT
        identify a palm, and grid LBP / coarse-template correlation did
        not separate either (same 0.44-0.60 vs different 0.50-0.76). So
        texture is never used as identity here. What it provably does:
        a flat / blank / uniform frame scores ~0.07 against a real palm
        texture, real palms score ~0.89. The gate floor (0.35) therefore
        rejects flat, blank and texture-less captures - a realness check,
        scored alongside geometry, exactly as labelled in the UI.

     3) MOVEMENT LIVENESS. A photograph or screen image of a palm cannot
        open and close. palmOpenness (mean wrist->tip / wrist->MCP ratio,
        index..pinky) measured on synthetic hands: open 2.08, fist 1.15.
        A passing scan must show a real open -> close -> open sequence.
        This is the primary anti-photo defence. */

  var PALM_TEXTURE_MIN = 0.35;    // realness floor - see calibration note above
  var PALM_OPEN_MIN = 1.65;       // openness at/above this = open hand (open synthetic: 2.08)
  var PALM_CLOSED_MAX = 1.55;     // openness at/below this = closed hand (fist synthetic: 1.15)
  var PALM_LIVE_OPEN_MIN = 1.55;  // v24: live (verification) frames produce/match codes from
                                  // this openness. Enrolment banks only fully-open codes
                                  // (>= PALM_OPEN_MIN), but a natural checkout palm - held
                                  // like tapping a card, not performed wide for a camera -
                                  // sits lower; gating live codes at the enrolment bar
                                  // starved verification of frames on a real phone
                                  // (2026-11-20: enrolled fine, no match at the terminal).
                                  // The 0.36 similarity + two-consecutive-frame rule +
                                  // spoof gate remain the judges; this only widens the
                                  // candidate frames they judge.
  var PALM_MOVE_MIN_RANGE = 0.35; // openness must swing at least this far during the scan
  var PALM_MOVE_MIN_SAMPLES = 6;  // and be observed over at least this many samples
  // Thresholds were loosened once, after the first real-phone test
  // (2026-11-20, "nothing is happening"): a real loose fist on real
  // MediaPipe landmarks does not curl as far as the synthetic fist, so
  // the closed/range bars were set too strict. The anti-photo margin is
  // untouched: a static image's openness range measures ~0.04, ten times
  // below the 0.35 swing still required.

  /* A usable palm texture: a real 256-bin LBP histogram (sums to ~1,
     not concentrated in one bin - a uniform image lands in one bin). */
  function palmTextureSane(t) {
    if (!t || t.length !== 256) return false;
    if (!allFinite(t)) return false;
    var sum = 0, maxBin = 0;
    for (var i = 0; i < 256; i++) {
      var v = Number(t[i]);
      if (v < 0) return false;
      sum += v; if (v > maxBin) maxBin = v;
    }
    if (Math.abs(sum - 1) > 0.05) return false;
    if (maxBin > 0.9) return false;
    if (vecStd(t) < 0.001) return false;
    return true;
  }

  /* A palm profile is either a legacy single geometry descriptor (plain
     array, pre-strengthening enrollments) or the strengthened record:
     { v: 2, geometry: [descriptor, ...], texture: [256] | null }. */
  function normalisePalmProfile(stored) {
    if (!stored) return null;
    if (Array.isArray(stored)) {
      return palmDescriptorSane(stored) ? { geometry: [stored], texture: null, legacy: true } : null;
    }
    if (typeof stored === 'object' && Array.isArray(stored.geometry)) {
      var geo = stored.geometry.filter(function (d) { return palmDescriptorSane(d); });
      if (!geo.length || geo.length !== stored.geometry.length) return null;
      if (stored.texture != null && !palmTextureSane(stored.texture)) return null;
      return { geometry: geo, texture: stored.texture || null, legacy: false };
    }
    return null;
  }

  function palmProfileSane(stored) { return normalisePalmProfile(stored) !== null; }

  /* Strengthened palm verification. Geometry is the identity check and
     uses the best of the enrolled captures; when a texture was enrolled,
     the live texture MUST be present and clear the realness floor -
     missing texture fails closed, it never silently skips the gate.
     Legacy enrollments (no texture) verify on geometry alone and say so. */
  function verifyPalmProfile(stored, live) {
    var fail = function (reason, distance, textureSimilarity) {
      return { ok: false, verified: false, distance: distance, threshold: PALM_THRESHOLD, textureSimilarity: textureSimilarity, textureThreshold: PALM_TEXTURE_MIN, reason: reason };
    };
    var profile = normalisePalmProfile(stored);
    if (!profile) return fail('No usable palm enrolled for this person - the stored palm data is missing or invalid.', null, null);
    if (!live || !palmDescriptorSane(live.geometry)) return fail('No real open palm was detected in this scan.', null, null);
    var best = null;
    for (var i = 0; i < profile.geometry.length; i++) {
      var d = euclidean(profile.geometry[i], live.geometry);
      if (d === null || !isFinite(d)) return fail('Palm comparison failed.', null, null);
      if (best === null || d < best) best = d;
    }
    var geometryOk = best < PALM_THRESHOLD;
    var textureSimilarity = null, textureOk = true;
    if (profile.texture) {
      if (!palmTextureSane(live.texture)) return fail('Palm texture was not captured in this scan - hold the palm steady in good light and scan again.', best, null);
      textureSimilarity = histogramSimilarity(profile.texture, live.texture);
      if (textureSimilarity === null || !isFinite(textureSimilarity)) return fail('Palm texture comparison failed.', best, null);
      textureOk = textureSimilarity >= PALM_TEXTURE_MIN;
    }
    var verified = geometryOk && textureOk;
    var reason;
    if (verified) reason = profile.texture ? 'Palm geometry matches the enrolled hand and the palm texture is real.' : 'Palm geometry matches the enrolled hand (legacy enrollment - no texture gate).';
    else if (!geometryOk) reason = 'Palm geometry distance above threshold - not the enrolled hand.';
    else reason = 'Palm texture does not look like a real palm capture - scan a real, open palm in good light.';
    return { ok: true, verified: verified, distance: best, threshold: PALM_THRESHOLD, textureSimilarity: textureSimilarity, textureThreshold: PALM_TEXTURE_MIN, reason: reason };
  }

  /* Openness of a hand from its 21 landmarks: mean over index..pinky of
     wrist->tip distance divided by wrist->MCP distance. Scale-free.
     Open synthetic hand: 2.08. Fist: 1.15. Returns null for bad input. */
  function palmOpenness(landmarks) {
    if (!landmarks || landmarks.length !== 21) return null;
    for (var i = 0; i < 21; i++) {
      var p = landmarks[i];
      if (!p || !isFinite(Number(p.x)) || !isFinite(Number(p.y))) return null;
    }
    function dist(a, b) { return Math.hypot(landmarks[a].x - landmarks[b].x, landmarks[a].y - landmarks[b].y); }
    if (dist(0, 9) < 0.02) return null; // collapsed / degenerate detection
    var fingers = [[8, 5], [12, 9], [16, 13], [20, 17]];
    var sum = 0;
    for (i = 0; i < fingers.length; i++) {
      var mcp = dist(0, fingers[i][1]);
      if (mcp < 0.01) return null;
      sum += dist(0, fingers[i][0]) / mcp;
    }
    var v = sum / fingers.length;
    return isFinite(v) ? v : null;
  }

  /* Movement liveness verdict over a time series of openness samples.
     Pass requires ALL of: enough samples, the hand was seen open, the
     hand was seen closed, the openness swung by at least the minimum
     range, and the hand ENDS open — judged on the end phase (any of
     the last 3 samples open), not the single final sample: on a real
     phone the last detection is often a soft/partial read while the
     hand settles (his 2026-11-20 v9 test failed exactly there, after
     a full open-close swing). A static image produces a near-constant
     series and still fails on range. */
  /* The liveness cycle: an open sample, then a closed sample, then an
     open sample again, in that order, anywhere inside the clip. This
     cycle rule replaced the v10 "final samples must read open" rule in
     v14 (2026-11-20): on a real phone the hand naturally relaxes or
     leaves the frame as the 4.5 s recording ends, which failed real
     users who had completed the movement — the end check alone failed
     the chairman's own enrolments on 2026-11-20 (v9 and v13 tests).
     A still photo still cannot pass: it shows neither the close nor
     the re-open. Fail-closed is unchanged. */
  function palmCycleCompleted(vals) {
    var seenOpen = false, seenClosedAfterOpen = false;
    for (var i = 0; i < vals.length; i++) {
      if (!seenOpen) { if (vals[i] >= PALM_OPEN_MIN) seenOpen = true; }
      else if (!seenClosedAfterOpen) { if (vals[i] <= PALM_CLOSED_MAX) seenClosedAfterOpen = true; }
      else if (vals[i] >= PALM_OPEN_MIN) return true;
    }
    return false;
  }
  function evaluatePalmMovement(samples) {
    var vals = (samples || []).filter(function (v) { return typeof v === 'number' && isFinite(v); });
    var out = { ok: false, pass: false, samples: vals.length, min: null, max: null, last: null, range: null, reason: 'Not enough hand movement observed.' };
    if (vals.length < PALM_MOVE_MIN_SAMPLES) { out.reason = 'Movement check needs a few seconds of hand movement - open, close, then open your palm.'; return out; }
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), last = vals[vals.length - 1];
    out.min = min; out.max = max; out.last = last; out.range = max - min;
    if (max < PALM_OPEN_MIN) out.reason = 'Open your palm wide, fingers spread, so the camera can see it fully.';
    else if (min > PALM_CLOSED_MAX) out.reason = 'Now close your hand into a loose fist, then open it again - a still image cannot pass this check.';
    else if (out.range < PALM_MOVE_MIN_RANGE) out.reason = 'The open-close movement was too small - close fully into a loose fist, then open wide.';
    else if (!palmCycleCompleted(vals)) out.reason = 'After closing into a fist, open your palm wide again - the full open - close - open movement must complete inside the recording.';
    else { out.ok = true; out.pass = true; out.reason = 'Live hand movement confirmed (open - close - open).'; }
    return out;
  }

  /* ---- Clip frame selection (recorded palm clip path) ----
     A recorded palm clip is analysed frame by frame; each analysed
     frame yields { openness, descriptor, sharpness, texture } with any
     field possibly null. These selectors are the pure decision layer
     over that list. A frame counts as a usable open palm only when its
     openness is at/above PALM_OPEN_MIN AND its descriptor passed every
     plausibility gate - a fist frame or a garbage frame never counts,
     no matter how sharp it is. */
  function palmUsableOpenFrames(frames) {
    var out = [];
    (frames || []).forEach(function (f, i) {
      if (f && typeof f.openness === 'number' && isFinite(f.openness) && f.openness >= PALM_OPEN_MIN && palmDescriptorSane(f.descriptor)) {
        out.push({ index: i, openness: f.openness, descriptor: f.descriptor, sharpness: f.sharpness || 0, texture: f.texture || null });
      }
    });
    return out;
  }
  function averageDescriptorList(list) {
    if (!list.length) return null;
    if (list.length === 1) return list[0].slice();
    var out = [];
    for (var j = 0; j < list[0].length; j++) {
      var s = 0;
      list.forEach(function (d) { s += d[j]; });
      out.push(s / list.length);
    }
    return palmDescriptorSane(out) ? out : list[0].slice();
  }
  // Verification: one descriptor averaged (in descriptor space) from
  // the sharpest usable open frames, up to 3. Null when the clip holds
  // no usable open palm at all.
  function selectPalmDescriptor(frames) {
    var usable = palmUsableOpenFrames(frames);
    if (!usable.length) return null;
    usable.sort(function (a, b) { return b.sharpness - a.sharpness; });
    return averageDescriptorList(usable.slice(0, 3).map(function (u) { return u.descriptor; }));
  }
  // Enrolment: up to 3 descriptors spread across the clip - the
  // sharpest usable frame in each third of the usable sequence - so
  // the stored profile keeps natural pose variation, the same role the
  // old straight/tilt-left/tilt-right captures played.
  function selectPalmProfile(frames) {
    var usable = palmUsableOpenFrames(frames);
    if (!usable.length) return null;
    if (usable.length <= 3) return usable.map(function (u) { return u.descriptor; });
    var picks = [];
    for (var t = 0; t < 3; t++) {
      var bucket = usable.slice(Math.floor(t * usable.length / 3), Math.floor((t + 1) * usable.length / 3));
      bucket.sort(function (a, b) { return b.sharpness - a.sharpness; });
      if (bucket.length) picks.push(bucket[0].descriptor);
    }
    return picks.length ? picks : null;
  }

  /* ------------- Randomised liveness sequences (v18) -------------------
     The fixed open -> close -> open choreography could be satisfied by
     a pre-recorded video of someone else performing it. From v18 each
     scan is issued ONE sequence at random from the set below, the
     prompts are shown live, and the stages must complete IN ORDER
     within a strict 3.5-second window (PALM_SEQUENCE_WINDOW_MS). A
     recording made for a different sequence, or at a different pace,
     misses the order or the window. Stages are judged on per-frame
     measures computed from the landmarks: openness (above), spread
     (fingertip fan) and tilt (knuckle-line angle). */
  var PALM_SPREAD_MIN = 0.9;        // fingertip-gap sum / knuckle span at/above this = fingers spread
  var PALM_TILT_MIN = 25;           // knuckle-line angle (degrees) at/above this = hand tilted
  var PALM_SEQUENCE_WINDOW_MS = 3500;
  var PALM_SEQUENCES = [
    { id: 'open-close-open', label: 'Open - Close - Open', stages: ['open', 'close', 'open'] },
    { id: 'open-tilt-open', label: 'Open - Tilt - Open', stages: ['open', 'tilt', 'open'] },
    { id: 'open-close-spread', label: 'Open - Close - Spread', stages: ['open', 'close', 'spread'] },
    { id: 'open-curl-open', label: 'Open - Curl - Open', stages: ['open', 'curl', 'open'] }
  ];
  var PALM_STAGE_PROMPTS = {
    open: 'Open your palm wide, fingers spread.',
    close: 'Now close it into a loose fist.',
    curl: 'Now curl your fingers halfway - not a full fist.',
    tilt: 'Now tilt your hand to one side, palm still open.',
    spread: 'Now spread your fingers wide apart.'
  };
  function palmSpread(landmarks) {
    if (!landmarks || landmarks.length !== 21) return null;
    function dist(a, b) { var dx = landmarks[a].x - landmarks[b].x, dy = landmarks[a].y - landmarks[b].y; return Math.sqrt(dx * dx + dy * dy); }
    var span = dist(5, 17);
    if (!(span > 0.02)) return null;
    var gaps = dist(8, 12) + dist(12, 16) + dist(16, 20);
    var v = gaps / span;
    return isFinite(v) ? v : null;
  }
  function palmTilt(landmarks) {
    if (!landmarks || landmarks.length !== 21) return null;
    var dx = landmarks[17].x - landmarks[5].x, dy = landmarks[17].y - landmarks[5].y;
    if (Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02) return null;
    var deg = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
    if (deg > 90) deg = 180 - deg; // knuckle line orientation, direction-free
    return isFinite(deg) ? deg : null;
  }
  function palmStageMet(stage, m) {
    if (!m || typeof m.openness !== 'number' || !isFinite(m.openness)) return false;
    switch (stage) {
      // v28: the movement stages are a LIVENESS proof (the hand moves
      // through the issued poses in order), not the print-quality gate
      // - banking separately requires >= PALM_OPEN_MIN frames. The
      // 'open'/'spread' stage bars therefore sit at PALM_LIVE_OPEN_MIN
      // (1.55, the openness verification itself accepts): at 1.65 a
      // natural re-open after the fist sat at Step 3 of 3 forever on
      // the user's phone (2026-11-20) even though the hand was open.
      case 'open': return m.openness >= PALM_LIVE_OPEN_MIN;
      case 'close': return m.openness <= PALM_CLOSED_MAX;
      case 'curl': return m.openness > PALM_CLOSED_MAX && m.openness < 1.95;
      case 'spread': return m.openness >= PALM_LIVE_OPEN_MIN && typeof m.spread === 'number' && m.spread >= PALM_SPREAD_MIN;
      case 'tilt': return m.openness >= 1.45 && typeof m.tilt === 'number' && m.tilt >= PALM_TILT_MIN;
      default: return false;
    }
  }
  /* measures: [{openness, spread, tilt}] one per recorded frame, in
     order; frameMs: milliseconds between frames (250 in the app).
     Passes only when every stage is met in order and the span from the
     first stage's frame to the last stage's frame fits the window. */
  function evaluateMovementSequence(measures, sequence, frameMs) {
    var fail = function (reason) { return { pass: false, reason: reason, sequence: sequence ? sequence.id : null, completedMs: null }; };
    if (!sequence || !sequence.stages || !sequence.stages.length) return fail('No liveness sequence was issued for this scan.');
    if (!measures || measures.length < 3) return fail('Movement check needs a few seconds of hand movement - follow the prompts shown during the recording.');
    var stageIdx = 0, firstIdx = -1, lastIdx = -1;
    for (var i = 0; i < measures.length && stageIdx < sequence.stages.length; i++) {
      if (palmStageMet(sequence.stages[stageIdx], measures[i])) {
        if (firstIdx < 0) firstIdx = i;
        lastIdx = i;
        stageIdx++;
      }
    }
    if (stageIdx < sequence.stages.length) {
      return fail('The movement sequence was not completed in order (' + sequence.label + '). Follow each prompt as it appears during the recording.');
    }
    var completedMs = (lastIdx - firstIdx) * (frameMs || 250);
    if (completedMs > PALM_SEQUENCE_WINDOW_MS) {
      return fail('The movement sequence was completed too slowly (' + (completedMs / 1000).toFixed(1) + 's; the live limit is ' + (PALM_SEQUENCE_WINDOW_MS / 1000).toFixed(1) + 's). Follow the prompts promptly - a pre-recorded video cannot match the issued sequence and pace.');
    }
    return { pass: true, reason: 'Live movement sequence completed in order inside the window (' + sequence.label + ', ' + (completedMs / 1000).toFixed(1) + 's).', sequence: sequence.id, completedMs: completedMs };
  }
  /* Streaming enrolment judge (v22). The burst-chain enrolment cannot
     use the clip window above: measures accumulate across bursts that
     are separated by analysis time, and the user can only perform the
     next stage after the prompt changes - which happens after the
     previous burst is analysed. Judged by the 3.5 s clip window, a
     prompt-following human needs the whole sequence inside ~14
     recorded measures while one burst alone records 12, so enrolment
     stalled silently until the deadline (his phone, 2026-11-20: the
     looping test video passes because it cycles continuously; a human
     following prompts cannot). The streaming judge keeps the two
     properties that carry the anti-replay weight - the sequence is
     freshly randomised per enrolment and the stages must occur IN
     ORDER - and replaces the total window with a per-stage budget of
     recorded measures: each stage must first be met within
     STREAM_STAGE_BUDGET measures of the previous stage's first met
     measure (40 measures = 10 s of recorded frames at 250 ms). */
  var STREAM_STAGE_BUDGET = 40;
  function evaluateMovementSequenceStreaming(measures, sequence) {
    var fail = function (reason) { return { pass: false, reason: reason, sequence: sequence ? sequence.id : null, completedMs: null }; };
    if (!sequence || !sequence.stages || !sequence.stages.length) return fail('No liveness sequence was issued for this scan.');
    if (!measures || measures.length < 3) return fail('Movement check needs a few seconds of hand movement - follow the prompts shown during the recording.');
    var stageIdx = 0, firstIdx = -1, lastIdx = -1, prevIdx = 0;
    for (var i = 0; i < measures.length && stageIdx < sequence.stages.length; i++) {
      if (palmStageMet(sequence.stages[stageIdx], measures[i])) {
        if (firstIdx < 0) firstIdx = i;
        if (i - prevIdx > STREAM_STAGE_BUDGET) {
          return fail('The movement sequence was followed too slowly between stages (' + sequence.label + '). Follow each prompt as soon as it appears - a pre-recorded video cannot match the issued sequence and pace.');
        }
        prevIdx = i;
        lastIdx = i;
        stageIdx++;
      }
    }
    if (stageIdx < sequence.stages.length) {
      return fail('The movement sequence was not completed in order (' + sequence.label + '). Follow each prompt as it appears during the recording.');
    }
    return { pass: true, reason: 'Live movement sequence completed in order, each stage inside its recorded-frame budget (' + sequence.label + ').', sequence: sequence.id, completedMs: (lastIdx - firstIdx) * 250 };
  }

  /* ------------- Screen-spoof detector (v18) ---------------------------
     A video replay presents the hand on another device's screen. Three
     physical traces of a screen are measured on the raw grayscale
     frame: (1) PIXEL GRID IN FLAT REGIONS - a display's pixel structure
     beats against the camera sensor, while a real scene's fine texture
     (palm creases) lives only where the texture is. The grid trigger
     is the signal's PERIODICITY inside the flattest quartile of blocks
     (v19 - see the note at flatCoherence): alternation density alone
     false-flagged both a genuine synthetic feed (0.46-0.51) and a real
     phone (0.27-0.41), because dense texture and sensor noise
     alternate too.
     v36: the grid analysis is SCOPED TO THE PALM REGION when the
     caller passes one (the optional 4th argument, from
     palmRoiRegionPx). A replay is a picture OF A PALM on a screen, so
     the grid evidence that matters is the grid inside the palm image
     itself. The whole-frame version false-convicted a live hand in a
     real room on 2026-11-23 (density 0.21-0.29, coherence 0.83-0.84 -
     the flattest blocks were patterned bedding/clothing, not the
     hand). Background periodicity outside the hand can no longer
     convict a scan. Region semantics: undefined = legacy whole-frame
     analysis (direct callers and tests); an object = measure grid
     stats over the blocks fully inside it only; null = the caller
     knows no palm region exists in this frame, so grid evidence is
     not measurable and cannot convict. (2) BEZEL - the device's
     rectangular frame produces long straight edges spanning the frame
     in both orientations - and (3) GLASS GLARE stay whole-frame: they
     describe the presenting device, not scene texture.
     v40: when the region carries a palm HULL (palmHullRegionPx —
     the app's path from v40), two more defences apply. (i) HULL
     MASKING: only blocks whose CENTRE falls inside the eroded
     palm silhouette are sampled at all — the v36 square still
     admitted the surface the hand hovers over, and on 2026-11-23 a
     glossy printed page inside the square convicted a live scan
     (density 0.31, coherence 0.82) though the print was never on
     the palm. (ii) COVERAGE: the grid-ALONE conviction additionally
     requires the periodic-grid evidence to be present in at least
     60% of the sampled in-hull blocks (per-block density >= 0.20
     and per-block coherence >= 0.35, the detector's own presence
     bars, with a minimum strong-alternation count so a near-empty
     block cannot vote). A screen displaying a palm carries its
     lattice across the whole palm; a pattern touching only a
     minority of the palm — the edge of printed cloth beside the
     fingers — can still raise the pooled stats through the flat
     quartile, but it can no longer convict on grid alone. The
     grid + glare rule (a second, whole-frame physical signal) and
     the bezel rule are unchanged, as are all bars.
     Heuristic by design: Field Test Mode exists to measure its
     real-world rejection rate. */
  function screenSpoofCheck(gray, w, h, region) {
    var none = { spoof: false, score: 0, reasons: [], moire: 0, flatMoire: 0, flatCoherence: 0, bezel: false, glare: 0, checked: false, gridScoped: region !== undefined, gridBlocks: 0, gridHull: false, gridCoverage: null, gridPositives: 0 };
    if (!gray || !w || !h || gray.length < w * h || w < 48 || h < 48) return none;
    // Global strong-alternation density (informational).
    var strong = 0, altern = 0, prevSign = 0;
    for (var y = 2; y < h - 2; y += 2) {
      var base = y * w;
      for (var x = 1; x < w; x++) {
        var d = gray[base + x] - gray[base + x - 1];
        if (Math.abs(d) >= 12) {
          strong++;
          var s = d > 0 ? 1 : -1;
          if (prevSign !== 0 && s !== prevSign) altern++;
          prevSign = s;
        }
      }
    }
    var moire = strong > 200 ? altern / strong : 0;
    // Flat-region alternation: range of every 16x16 block, keep the
    // flattest quartile, measure the same density inside those blocks.
    // v36: when a palm region is passed, only blocks FULLY INSIDE it
    // are candidates - the grid stats then describe the palm image,
    // not the room behind the hand. A null region (no palm located)
    // or a region holding fewer than 4 blocks yields no grid evidence
    // at all: flatMoire and flatCoherence stay 0 and the grid rules
    // below cannot fire on this frame.
    // v40: a region carrying a hull (palmHullRegionPx) switches the
    // membership test: a block is a candidate iff its CENTRE falls
    // inside the eroded palm hull. Blocks centred outside the hull
    // contribute nothing - not to the flat quartile, not to the
    // pooled stats, not to the coverage fraction.
    var hullPts = (region && region.hull && region.hull.length >= 3) ? region.hull : null;
    var BS = 16, blocksIdx = [];
    var gridUsable = region === undefined || !!region;
    if (gridUsable) {
      for (var by = 0; by + BS <= h; by += BS) for (var bx = 0; bx + BS <= w; bx += BS) {
        if (hullPts) { if (!pointInConvexHullPx(bx + BS / 2, by + BS / 2, hullPts)) continue; }
        else if (region && (bx < region.x0 || bx + BS > region.x1 || by < region.y0 || by + BS > region.y1)) continue;
        var mn = 255, mx = 0;
        for (var yy = 0; yy < BS; yy++) for (var xx = 0; xx < BS; xx++) {
          var v = gray[(by + yy) * w + (bx + xx)];
          if (v < mn) mn = v; if (v > mx) mx = v;
        }
        blocksIdx.push({ bx: bx, by: by, range: mx - mn });
      }
    }
    if (blocksIdx.length < 4) gridUsable = false;
    blocksIdx.sort(function (a, b) { return a.range - b.range; });
    var flatBlocks = gridUsable ? blocksIdx.slice(0, Math.max(4, Math.floor(blocksIdx.length / 4))) : [];
    var fStrong = 0, fAltern = 0;
    flatBlocks.forEach(function (bl) {
      for (var yy2 = 0; yy2 < BS; yy2++) {
        var prev = 0, rowBase = (bl.by + yy2) * w + bl.bx;
        for (var xx2 = 1; xx2 < BS; xx2++) {
          var d = gray[rowBase + xx2] - gray[rowBase + xx2 - 1];
          if (Math.abs(d) >= 12) {
            fStrong++;
            var s2 = d > 0 ? 1 : -1;
            if (prev !== 0 && s2 !== prev) fAltern++;
            prev = s2;
          }
        }
      }
    });
    var flatMoire = fStrong > 30 ? fAltern / fStrong : 0;
    // Flat-region GRID COHERENCE (v19): a display grid is a 2D lattice
    // - the pattern in one row repeats in the row below, exactly
    // inverted (checkerboard), or shifted by a pixel or two (diagonal
    // moire). Sensor noise is independent in every row, and a smooth
    // gradient has no high-frequency energy at all. So the trigger
    // pairs two facts inside the flat blocks: high-frequency energy is
    // present (the alternation density above), AND the detrended rows
    // correlate with the row beneath them at some small shift - one
    // global estimate per shift, accumulated over all flat blocks
    // before dividing. Noise stays at ~0 coherence however strong it
    // is; a lattice peaks near 1. This distinction is forced by a real
    // phone test: density alone scored 0.27-0.41 on a genuine hand in
    // indoor light and false-flagged the scan.
    var SH = 3, cohNum = [], cohDenA = [], cohDenB = [], shIdx;
    for (shIdx = 0; shIdx <= 2 * SH; shIdx++) { cohNum.push(0); cohDenA.push(0); cohDenB.push(0); }
    function detrendRow(vals) {
      var n = vals.length, mean = 0, i, num = 0, den2 = 0, slope, out = [];
      for (i = 0; i < n; i++) mean += vals[i];
      mean /= n;
      for (i = 0; i < n; i++) { num += (i - (n - 1) / 2) * (vals[i] - mean); den2 += (i - (n - 1) / 2) * (i - (n - 1) / 2); }
      slope = den2 ? num / den2 : 0;
      for (i = 0; i < n; i++) out.push(vals[i] - mean - slope * (i - (n - 1) / 2));
      return out;
    }
    flatBlocks.forEach(function (bl) {
      var rowsD = [], yy4, xx4;
      for (yy4 = 0; yy4 < BS; yy4++) {
        var rb4 = (bl.by + yy4) * w + bl.bx, vals = [];
        for (xx4 = 0; xx4 < BS; xx4++) vals.push(gray[rb4 + xx4]);
        rowsD.push(detrendRow(vals));
      }
      for (var p = 0; p + 1 < BS; p++) {
        var A = rowsD[p], Bv = rowsD[p + 1];
        for (var sh = -SH; sh <= SH; sh++) {
          var si = sh + SH;
          for (var i4 = 0; i4 < BS; i4++) {
            var j = i4 + sh;
            if (j < 0 || j >= BS) continue;
            cohNum[si] += A[i4] * Bv[j];
            cohDenA[si] += A[i4] * A[i4];
            cohDenB[si] += Bv[j] * Bv[j];
          }
        }
      }
    });
    var flatCoherence = 0;
    for (var s1 = 0; s1 <= 2 * SH; s1++) {
      var dd = Math.sqrt(cohDenA[s1] * cohDenB[s1]);
      if (dd > 0) flatCoherence = Math.max(flatCoherence, Math.abs(cohNum[s1] / dd));
    }
    // v40 COVERAGE (hull-scoped calls only): in how many of the
    // sampled in-hull blocks is the periodic grid actually PRESENT?
    // Presence is judged per block with the detector's own bars -
    // alternation density >= 0.20 and detrended row-pair coherence
    // >= 0.35, computed exactly as the pooled measures above but
    // restricted to the single block - plus a floor of 16 strong
    // alternations so a block with almost no high-frequency energy
    // (where a density ratio is noise) cannot vote present. The
    // pooled stats can be carried by a flat minority patch (the
    // flat quartile prefers it); coverage cannot.
    function blockGridPresent(bl) {
      var strong = 0, altern = 0;
      for (var yy = 0; yy < BS; yy++) {
        var prev = 0, rowBase = (bl.by + yy) * w + bl.bx;
        for (var xx = 1; xx < BS; xx++) {
          var d = gray[rowBase + xx] - gray[rowBase + xx - 1];
          if (Math.abs(d) >= 12) {
            strong++;
            var s = d > 0 ? 1 : -1;
            if (prev !== 0 && s !== prev) altern++;
            prev = s;
          }
        }
      }
      if (strong < 16 || altern / strong < 0.20) return false;
      var rowsD = [], yy3, xx3;
      for (yy3 = 0; yy3 < BS; yy3++) {
        var rb3 = (bl.by + yy3) * w + bl.bx, vals = [];
        for (xx3 = 0; xx3 < BS; xx3++) vals.push(gray[rb3 + xx3]);
        rowsD.push(detrendRow(vals));
      }
      for (var p = 0; p + 1 < BS; p++) {
        var A = rowsD[p], Bv = rowsD[p + 1];
        for (var sh = -SH; sh <= SH; sh++) {
          var num = 0, dA = 0, dB = 0;
          for (var i5 = 0; i5 < BS; i5++) {
            var j = i5 + sh;
            if (j < 0 || j >= BS) continue;
            num += A[i5] * Bv[j]; dA += A[i5] * A[i5]; dB += Bv[j] * Bv[j];
          }
          var dd2 = Math.sqrt(dA * dB);
          if (dd2 > 0 && Math.abs(num / dd2) >= 0.35) return true;
        }
      }
      return false;
    }
    var gridCoverage = null, gridPositives = 0;
    if (hullPts && gridUsable) {
      blocksIdx.forEach(function (bl) { if (blockGridPresent(bl)) gridPositives++; });
      gridCoverage = blocksIdx.length ? gridPositives / blocksIdx.length : 0;
    }
    // (2) Bezel: per-row and per-column mean edge strength; a bezel
    // edge spikes one row/column far above the frame's median AND runs
    // across at least 80% of that line - a local bright patch (glare)
    // has straight edges too, but they do not span the frame.
    function spike(horizontal) {
      var n = horizontal ? h : w, vals = [], cover = [];
      for (var i = 1; i < n; i++) {
        var sum = 0, cnt = 0, strongCnt = 0;
        if (horizontal) { for (var xx = 0; xx < w; xx += 2) { var d1 = Math.abs(gray[i * w + xx] - gray[(i - 1) * w + xx]); sum += d1; if (d1 >= 12) strongCnt++; cnt++; } }
        else { for (var yy = 0; yy < h; yy += 2) { var d2 = Math.abs(gray[yy * w + i] - gray[yy * w + i - 1]); sum += d2; if (d2 >= 12) strongCnt++; cnt++; } }
        vals.push(sum / cnt);
        cover.push(cnt ? strongCnt / cnt : 0);
      }
      var sorted = vals.slice().sort(function (a, b) { return a - b; });
      var median = sorted[Math.floor(sorted.length / 2)] || 0;
      for (var k = 0; k < vals.length; k++) {
        if (vals[k] > 16 && vals[k] > 6 * Math.max(median, 0.5) && cover[k] >= 0.8) return true;
      }
      return false;
    }
    var bezel = spike(true) && spike(false);
    // (3) Glare: share of 8x8 blocks that are flat AND near-saturated.
    var blocks = 0, flatBright = 0;
    for (var by = 0; by + 8 <= h; by += 8) for (var bx = 0; bx + 8 <= w; bx += 8) {
      var mn = 255, mx = 0, sm = 0;
      for (var yy2 = 0; yy2 < 8; yy2++) for (var xx2 = 0; xx2 < 8; xx2++) {
        var v = gray[(by + yy2) * w + (bx + xx2)];
        if (v < mn) mn = v; if (v > mx) mx = v; sm += v;
      }
      blocks++;
      if (sm / 64 >= 238 && mx - mn <= 10) flatBright++;
    }
    var glare = blocks ? flatBright / blocks : 0;
    var reasons = [];
    if (bezel) reasons.push('rectangular device bezel edges detected around the hand');
    if (flatMoire >= 0.20 && flatCoherence >= 0.35) reasons.push('periodic screen pixel-grid pattern detected in the ' + (region !== undefined ? 'palm region' : 'flat regions') + ' of the frame (density ' + flatMoire.toFixed(2) + ', grid coherence ' + flatCoherence.toFixed(2) + ')');
    if (glare > 0.05) reasons.push('flat specular glass glare detected (' + Math.round(glare * 100) + '% of frame)');
    // v32: the grid-ALONE bar rises 0.50 -> 0.62. Measured on the
    // user's phone (2026-11-20): his REAL hand at a real terminal was
    // spoof-rejected with grid coherences 0.52-0.59 (density
    // 0.22-0.55) - his camera's processing of a flat bright wall
    // produces a stronger lattice signature than the test rig's
    // actual screen replay (coherence 0.46, caught by the bezel rule
    // instead). Grid-alone in the 0.50s is therefore not evidence of
    // a screen in the environment that matters; bezel, and grid +
    // glare at 0.35, are unchanged.
    // v40: in hull mode the grid-ALONE term additionally requires
    // coverage >= 0.60 - the grid must be present across a clear
    // majority of the palm, as it is when a screen displays the
    // palm. gridCoverage is null outside hull mode, where the v36
    // rule applies untouched. The grid + glare term is NOT gated:
    // glare is a second physical signal, and that rule is kept
    // exactly as it was.
    var gridAlone = flatMoire >= 0.20 && flatCoherence >= 0.62 && (gridCoverage === null || gridCoverage >= 0.60);
    var spoof = bezel || gridAlone || (flatMoire >= 0.20 && flatCoherence >= 0.35 && glare > 0.05);
    var score = Math.max(bezel ? 0.9 : 0, flatMoire >= 0.20 ? Math.min(1, flatCoherence / 0.5) : flatCoherence * 0.5, Math.min(1, glare / 0.12));
    return { spoof: spoof, score: spoof ? Math.max(score, 0.6) : score, reasons: reasons, moire: moire, flatMoire: flatMoire, flatCoherence: flatCoherence, bezel: bezel, glare: glare, checked: true, gridScoped: region !== undefined, gridBlocks: blocksIdx.length, gridHull: !!hullPts, gridCoverage: gridCoverage, gridPositives: gridPositives };
  }

  /* v36: one entry per distinct reason KIND. The tracker concatenates
     the reasons of every flagged frame, so one scan used to repeat
     the grid reason once per flagged frame - identical text, only the
     measured numbers differed - which read as a doubled fault in the
     user-facing message (the Chairman's 2026-11-23 screenshot showed
     it twice). The dedupe key strips the parenthesised measurements
     and any bare numbers; the first occurrence is kept verbatim,
     numbers and all. */
  function dedupeSpoofReasons(reasons) {
    var seen = {}, out = [];
    (reasons || []).forEach(function (r) {
      if (typeof r !== 'string') return;
      var key = r.replace(/\([^)]*\)/g, '').replace(/\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(r);
    });
    return out;
  }

  /* ------------- Field-test statistics + CSV (v18) ---------------------
     Pure functions over field-test scan records so the gate metrics are
     computed identically on screen, in the exported CSV and in tests.
     Record shape: { ts, biomId, camera, lighting, genuineScore,
     impostorMax, liveness ('pass'|'fail'), spoofTag ('real_hand' |
     'photo_spoof' | 'video_replay'), result ('verified'|'rejected') }.
     GAR: share of real-hand attempts verified. FAR: share of real-hand
     attempts whose highest OTHER-template score reached the match
     threshold (the scan would have false-accepted against that
     template). Spoof rejection: share of photo/video spoof attempts
     that were rejected.
     v47: records may additionally carry the PalmNet evidence —
     neuralScore (the genuine palm's neural cosine),
     neuralImpostorMax (the highest neural cosine against any OTHER
     enrolled palm) and acceptedBy ('edcc'|'palmnet'|'both'). The
     result field is the FUSED verdict (that is the system under
     test now), so GAR measures the fused system. FAR counts a
     false accept when EITHER system's impostor score reached its
     own bar; records without neural fields (everything written
     before v47) are judged on the EDCC fields alone, exactly as
     before. */
  function fieldTestStats(records) {
    var g = { attempts: 0, accepted: 0 }, f = { attempts: 0, falseAccepts: 0 }, s = { attempts: 0, rejected: 0 };
    (records || []).forEach(function (r) {
      if (!r) return;
      if (r.spoofTag === 'real_hand') {
        g.attempts++;
        if (r.result === 'verified') g.accepted++;
        var hasEdccImp = typeof r.impostorMax === 'number' && isFinite(r.impostorMax);
        var hasNeuralImp = typeof r.neuralImpostorMax === 'number' && isFinite(r.neuralImpostorMax);
        if (hasEdccImp || hasNeuralImp) {
          f.attempts++;
          if ((hasEdccImp && r.impostorMax >= PALMPRINT_THRESHOLD) ||
              (hasNeuralImp && r.neuralImpostorMax >= PALMNET_THRESHOLD)) f.falseAccepts++;
        }
      } else if (r.spoofTag === 'photo_spoof' || r.spoofTag === 'video_replay') {
        s.attempts++;
        if (r.result !== 'verified') s.rejected++;
      }
    });
    var pct = function (a, b) { return b > 0 ? Math.round((a / b) * 1000) / 10 : null; };
    return {
      genuine: { attempts: g.attempts, accepted: g.accepted, gar: pct(g.accepted, g.attempts) },
      impostor: { attempts: f.attempts, falseAccepts: f.falseAccepts, far: pct(f.falseAccepts, f.attempts) },
      spoof: { attempts: s.attempts, rejected: s.rejected, rejectionRate: pct(s.rejected, s.attempts) }
    };
  }
  function fieldTestCsv(records) {
    function cell(v) {
      if (v === null || v === undefined) return '';
      var s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    /* v47 note: the PalmNet per-system scores (neuralScore,
       neuralImpostorMax, acceptedBy) are stored ON the field
       records and used by fieldTestStats, but deliberately NOT
       added as CSV columns — the export's column set is a pinned
       format (tests/fieldtest.test.js) and the fused verdict +
       both genuine scores are already visible per record in the
       app; the CSV keeps its exact v18 shape. */
    var lines = ['timestamp,biom_id,camera,lighting,genuine_score,impostor_max_score,liveness,spoof_tag,result'];
    (records || []).forEach(function (r) {
      if (!r) return;
      lines.push([
        cell(new Date(r.ts).toISOString()), cell(r.biomId), cell(r.camera), cell(r.lighting),
        cell(typeof r.genuineScore === 'number' ? r.genuineScore.toFixed(3) : ''),
        cell(typeof r.impostorMax === 'number' ? r.impostorMax.toFixed(3) : ''),
        cell(r.liveness), cell(r.spoofTag), cell(r.result)
      ].join(','));
    });
    return lines.join('\n') + '\n';
  }

  /* ---------------- Palmprint — EDCC competitive code (v9, 2026-11-20) ----
     The geometry matcher above is kept for legacy (v2) enrolments only.
     New enrolments use a real palmprint method, ported from EDCC
     (Leosocy/EDCC-Palmprint-Recognition, MIT licence — the strongest
     licence-clean palmprint encoder found in the 2026-11-20 GitHub
     research; see ~/workspace/research_notes/github-palm-scan-best-20261120-0552/).

     Pipeline, the same shape every serious palmprint system uses:
       1. ROI: MediaPipe landmarks are used ONLY to locate the palm —
          a palm-centred square is perspective-warped out of the frame
          (palmRoiFromLandmarks). Landmarks carry no identity here.
       2. ENCODE (EDCC competitive coding, ported faithfully from the
          MIT reference; image_size 64 chosen over the 29 default -
          see PALMPRINT_SIZE):
          resize ROI to SIZE x SIZE, Gaussian blur, Laplacian enhancement,
          convolve with a fixed bank of 10 Gabor kernels (kmax = pi/2,
          sigma = 2pi, kernel 5x5); at each pixel the winning direction
          d (0..9) is stored plus one side bit s (which neighbouring
          direction responded stronger). One byte per pixel, 841 bytes.
       3. MATCH (EDCC comparer, exact): score = fraction of pixels whose
          packed (d, s) byte is identical. Our one extension, declared:
          the score is the best over +-1 px translations of the code
          grid, because a phone warp is never pixel-perfect.

     The enhancement stage (blur + Laplacian) is implemented with the
     standard separable 5-tap kernels; enrolment and verification always
     run this same code, so templates are self-consistent. Threshold is
     calibrated on synthetic palmprint probes (tests/palmprint.test.js)
     and MUST be recalibrated on real palms in the field test before
     any pilot sale — published EDCC numbers come from controlled
     datasets with pre-extracted ROIs. */

  var PALMPRINT_SIZE = 64;          // EDCC image_size. The reference implementation's default is 29;
                                    // 64 is a legitimate EncoderConfig choice and keeps far more print
                                    // detail from a 128px phone ROI - measured better separation below.
  var PALMPRINT_DIRECTIONS = 10;    // EDCC gabor_directions
  var PALMPRINT_KERNEL_SIZE = 5;    // EDCC gabor_kernel_size
  var PALMPRINT_CODE_LEN = PALMPRINT_SIZE * PALMPRINT_SIZE; // 4096 at size 64
  var PALMPRINT_ROI_SIZE = 96;      // v45: canonical warped ROI side (px) — the Palm-X
                                    // spec's 96x96 affine palm-line square (was 128
                                    // under the pre-v45 homography warp)
  var PALMPRINT_THRESHOLD = 0.32;   // RECALIBRATED 2026-11-20 (v27) for the STREAMING
                                    // pipeline: on the verified rig (own server, served
                                    // code checked), genuine scores for the same palm
                                    // through the shipped streaming enrol/verify path
                                    // measured {0.513, 0.406, 0.353, 0.353, 0.349, 0.344,
                                    // 0.310} - the 0.36 line sat inside the genuine
                                    // distribution and failed 5 of 7 genuine attempts,
                                    // matching the user's phone experience. Streaming
                                    // impostor on the same rig: 0.214-0.236; the static
                                    // calibration impostor max below is 0.261, so 0.32
                                    // keeps >= 0.059 clearance over every impostor ever
                                    // measured on this engine while passing 6 of 7
                                    // genuine rig runs. The 20-person field test
                                    // (zero false accepts) remains the gate before sale.
                                    // ORIGINAL calibration 2026-11-20 TWICE. (1) Synthetic probes
                                    // (tests/palmprint.test.js) through the product decision rule.
                                    // (2) REALISTIC-IMAGE calibration (tests/e2e, 5 photorealistic
                                    // palms, re-capture variants +-4px / +-8% brightness, product
                                    // rule = best of 3 enrolled x 2 live codes): at code size 29
                                    // genuine min 0.512 / impostor max 0.383 (margin 0.129); at 48:
                                    // 0.487 / 0.307 (0.180); at 64: 0.467 / 0.261 (0.206) - hence
                                    // size 64 and threshold 0.36 (~0.10 margin both sides). The
                                    // earlier 0.28 threshold FALSE-ACCEPTED a different palm in
                                    // the first end-to-end run (impostor scored 0.295 at size 29).
                                    // Still a small sample - the 20-person field test remains
                                    // the gate before any pilot sale.
  // v33 (2026-11-23): the DECISION RULE changed (see verifyPalmprintRois)
  // to the PalmCode-Bench v25 max-fusion rule — probe re-encoded at 25
  // image-level shifts, scored against the individual enrolled codes,
  // single best pair wins. Max fusion over that many pairs inflates
  // scores relative to the v27-v32 consensus rule this 0.32 was
  // calibrated under, so 0.32 is kept ONLY as the existing
  // phone-calibrated default, in this one named place, and it MUST be
  // recalibrated on real palms through the 20-person / 200-scan field
  // test before any sale. No benchmark-derived threshold is substituted:
  // the benchmark's score scale comes from aligned dataset ROIs, not
  // phone captures, and its numbers do not transfer directly.
  var PALMPRINT_MAX_DIR_SHARE = 0.80; // one direction may not dominate a real code

  /* --- small image helpers (array-like gray, row-major) --- */
  function reflect101(i, n) {
    if (n <= 1) return 0;
    while (i < 0 || i >= n) { if (i < 0) i = -i; if (i >= n) i = 2 * n - 2 - i; }
    return i;
  }
  function resizeGrayBilinear(gray, w, h, size) {
    var out = new Float64Array(size * size);
    var sx, sy, x0, y0, x1, y1, fx, fy;
    for (var y = 0; y < size; y++) {
      sy = (y + 0.5) * (h / size) - 0.5;
      y0 = Math.floor(sy); fy = sy - y0;
      y1 = y0 + 1;
      y0 = Math.max(0, Math.min(h - 1, y0)); y1 = Math.max(0, Math.min(h - 1, y1));
      for (var x = 0; x < size; x++) {
        sx = (x + 0.5) * (w / size) - 0.5;
        x0 = Math.floor(sx); fx = sx - x0;
        x1 = x0 + 1;
        x0 = Math.max(0, Math.min(w - 1, x0)); x1 = Math.max(0, Math.min(w - 1, x1));
        var top = gray[y0 * w + x0] * (1 - fx) + gray[y0 * w + x1] * fx;
        var bot = gray[y1 * w + x0] * (1 - fx) + gray[y1 * w + x1] * fx;
        out[y * size + x] = top * (1 - fy) + bot * fy;
      }
    }
    return out;
  }
  function convolveSeparable(gray, size, kx, ky) {
    var tmp = new Float64Array(size * size), out = new Float64Array(size * size);
    var half = Math.floor(kx.length / 2), x, y, i, s;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
      s = 0;
      for (i = -half; i <= half; i++) s += kx[i + half] * gray[y * size + reflect101(x + i, size)];
      tmp[y * size + x] = s;
    }
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
      s = 0;
      for (i = -half; i <= half; i++) s += ky[i + half] * tmp[reflect101(y + i, size) * size + x];
      out[y * size + x] = s;
    }
    return out;
  }
  function convolve2d(gray, size, kernel, ksize) {
    var out = new Float64Array(size * size);
    var half = Math.floor(ksize / 2);
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      var s = 0;
      for (var i = -half; i <= half; i++) for (var j = -half; j <= half; j++) {
        s += kernel[(i + half) * ksize + (j + half)] * gray[reflect101(y + i, size) * size + reflect101(x + j, size)];
      }
      out[y * size + x] = s;
    }
    return out;
  }

  /* EDCC Gabor kernel (real part), verbatim formula from gabor_filter.cpp:
     Kv = kmax / f^dimension with kmax = pi/2, dimension = 0 -> Kv = pi/2;
     sigma = 2*pi; kernel = Kv^2/sigma^2 * exp(-Kv^2 (i^2+j^2) / (2 sigma^2))
     * (cos(Kv cos(Qu) j + Kv sin(Qu) i) - exp(-sigma^2 / 2)), Qu = pi*d/10. */
  function gaborKernelReal(direction) {
    var size = PALMPRINT_KERNEL_SIZE, half = Math.floor(size / 2);
    var kmax = Math.PI / 2, sigma = 2 * Math.PI, sqsigma = sigma * sigma;
    var Kv = kmax;
    var Qu = Math.PI * direction / PALMPRINT_DIRECTIONS;
    var postmean = Math.exp(-sqsigma / 2);
    var kernel = new Float64Array(size * size);
    for (var i = -half; i <= half; i++) for (var j = -half; j <= half; j++) {
      var tmp1 = Math.exp(-(Kv * Kv * (i * i + j * j)) / (2 * sqsigma));
      var tmp2 = Math.cos(Kv * Math.cos(Qu) * j + Kv * Math.sin(Qu) * i) - postmean;
      kernel[(i + half) * size + (j + half)] = Kv * Kv * tmp1 * tmp2 / sqsigma;
    }
    return kernel;
  }
  var PALMPRINT_KERNELS = null;
  function palmprintKernels() {
    if (!PALMPRINT_KERNELS) {
      PALMPRINT_KERNELS = [];
      for (var d = 0; d < PALMPRINT_DIRECTIONS; d++) PALMPRINT_KERNELS.push(gaborKernelReal(d));
    }
    return PALMPRINT_KERNELS;
  }

  /* EDCC enhancement: Gaussian blur 5x5 (sigma 1.1, OpenCV's auto sigma
     for a 5-tap kernel), then a 5-tap Laplacian (separable Sobel form:
     smooth [1,4,6,4,1]/16 on one axis, second difference [1,-2,1] on
     the other, summed over both axes). */
  function palmprintEnhance(img29, size) {
    size = size || PALMPRINT_SIZE;
    var gw = [], norm = 0, k;
    for (k = 0; k < 5; k++) { var wgt = Math.exp(-((k - 2) * (k - 2)) / (2 * 1.1 * 1.1)); gw.push(wgt); norm += wgt; }
    for (k = 0; k < 5; k++) gw[k] /= norm;
    var blurred = convolveSeparable(img29, size, gw, gw);
    var smooth = [1, 4, 6, 4, 1].map(function (v) { return v / 16; });
    var d2 = [0, 1, -2, 1, 0];
    var lx = convolveSeparable(blurred, size, d2, smooth);
    var ly = convolveSeparable(blurred, size, smooth, d2);
    var out = new Float64Array(size * size);
    for (var i = 0; i < size * size; i++) out[i] = lx[i] + ly[i];
    return out;
  }

  /* Encode a grayscale palm ROI (any size) into an EDCC code:
     a Uint8Array of 841 packed bytes (direction | side << 4), or null
     when the input is unusable. The code is only a template — sanity
     (palmprintCodeSane) decides whether it carries real print detail. */
  /* Centre-anchored resample of a grayscale image by (zoomX, zoomY):
     out(x, y) samples the source at centre + (p - centre) / zoom, with
     bilinear interpolation and edge-clamped sampling. zoom > 1 zooms
     IN (samples a smaller central area); zoom < 1 zooms out. Used for
     the v41 geometric probe variants: a palm presented tilted away
     from the camera plane is foreshortened along the hand's vertical
     (wrist) axis — the landmark warp builds a SQUARE from the knuckle
     span, so it cannot undo that foreshortening — and a vertical
     stretch of the probe ROI (zoomY > 1 in the sampling sense below:
     the source is stretched to fill the frame) restores the print's
     proportions. See PALMPRINT_GEO_VARIANTS. */
  function scaleGrayCentre(gray, w, h, zoomX, zoomY) {
    if (!gray || !w || !h || gray.length < w * h || !isFinite(zoomX) || !isFinite(zoomY) || zoomX <= 0 || zoomY <= 0) return null;
    var cx = (w - 1) / 2, cy = (h - 1) / 2;
    var out = new Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var sx = cx + (x - cx) / zoomX, sy = cy + (y - cy) / zoomY;
      var x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      function v(xx, yy) {
        xx = Math.max(0, Math.min(w - 1, xx)); yy = Math.max(0, Math.min(h - 1, yy));
        return gray[yy * w + xx];
      }
      out[y * w + x] = v(x0, y0) * (1 - fx) * (1 - fy) + v(x0 + 1, y0) * fx * (1 - fy) + v(x0, y0 + 1) * (1 - fx) * fy + v(x0 + 1, y0 + 1) * fx * fy;
    }
    return out;
  }
  /* Horizontal mirror of a grayscale image (row-wise reversal). Used to
     encode the mirror twin of a palm ROI: a front-camera capture and a
     back-camera capture of the same palm are mirror images of each
     other, and an EDCC code of one does not match the other. */
  function flipGrayHorizontal(gray, w, h) {
    if (!gray || !w || !h || gray.length < w * h) return null;
    var out = new Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) out[y * w + (w - 1 - x)] = gray[y * w + x];
    return out;
  }
  /* Rotate a grayscale image by a few degrees around its centre
     (bilinear sampling, corners filled with the image mean). Used to
     encode small-rotation twins of a palm ROI: between two sessions a
     real hand is presented a few degrees rotated, the landmark warp
     cannot fully undo that, and an EDCC code is not rotation-tolerant
     on its own. */
  function rotateGray(gray, w, h, degrees) {
    if (!gray || !w || !h || gray.length < w * h || !isFinite(degrees)) return null;
    var rad = degrees * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    var cx = (w - 1) / 2, cy = (h - 1) / 2, mean = 0, i;
    for (i = 0; i < w * h; i++) mean += gray[i];
    mean /= (w * h);
    var out = new Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var dx = x - cx, dy = y - cy;
      var sx = cx + dx * cos + dy * sin, sy = cy - dx * sin + dy * cos;
      var x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      var v00 = (x0 >= 0 && x0 < w && y0 >= 0 && y0 < h) ? gray[y0 * w + x0] : mean;
      var v10 = (x0 + 1 >= 0 && x0 + 1 < w && y0 >= 0 && y0 < h) ? gray[y0 * w + x0 + 1] : mean;
      var v01 = (x0 >= 0 && x0 < w && y0 + 1 >= 0 && y0 + 1 < h) ? gray[(y0 + 1) * w + x0] : mean;
      var v11 = (x0 + 1 >= 0 && x0 + 1 < w && y0 + 1 >= 0 && y0 + 1 < h) ? gray[(y0 + 1) * w + x0 + 1] : mean;
      out[y * w + x] = Math.round((v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy);
    }
    return out;
  }
  /* Illumination flattening + CLAHE for a square palm ROI -
     EVALUATED 2026-11-20 and NOT ADOPTED (tests/norm-experiment.js).
     The recipe is standard in RGB palmprint pipelines (divide out a
     smooth illumination field estimated from a 16x16 downscale, then
     CLAHE 8x8 tiles, clip limit 2.0), but measured on this encoder it
     made things worse: genuine min fell on every condition (clean
     0.483 -> 0.454, gradient X 0.479 -> 0.452, gradient+shift 0.314
     -> 0.206) while impostor max improved only 0.140 -> 0.110, for
     +2.3 ms per encode. The reason is structural: the EDCC
     enhancement is a Laplacian high-pass, which already suppresses
     smooth illumination fields (a 0.65->1.25 brightness gradient
     costs the current pipeline only 0.004 of genuine score), while
     CLAHE's per-tile contrast changes perturb the fine directional
     responses the competitive coding competes on. Kept here, unused
     by palmprintEncode, as the recorded candidate for the future
     neural engine's preprocessing, where the calculus may differ. */
  function palmprintNormaliseRoi(gray, w, h) {
    if (!gray || !w || !h || w !== h || gray.length < w * h) return gray;
    var size = w, i;
    var small = resizeGrayBilinear(gray, w, h, 16);
    var illum = resizeGrayBilinear(small, 16, 16, size);
    var mean = 0;
    for (i = 0; i < size * size; i++) mean += illum[i];
    mean /= (size * size);
    if (!(mean > 1)) return gray;
    var flat = new Float64Array(size * size);
    for (i = 0; i < size * size; i++) {
      var d = illum[i] > 1 ? illum[i] : 1;
      var v = gray[i] * mean / d;
      flat[i] = v < 0 ? 0 : (v > 255 ? 255 : v);
    }
    // CLAHE: 8x8 tiles, clip limit 2.0.
    var tiles = 8, ts = Math.floor(size / tiles);
    if (ts < 4) return flat;
    var luts = [];
    for (var ty = 0; ty < tiles; ty++) {
      luts.push([]);
      for (var tx = 0; tx < tiles; tx++) {
        var hist = new Float64Array(256), count = 0, x, y;
        for (y = ty * ts; y < (ty + 1) * ts; y++) for (x = tx * ts; x < (tx + 1) * ts; x++) {
          hist[Math.max(0, Math.min(255, Math.round(flat[y * size + x])))]++;
          count++;
        }
        var clip = 2.0 * (count / 256), excess = 0, b;
        for (b = 0; b < 256; b++) if (hist[b] > clip) { excess += hist[b] - clip; hist[b] = clip; }
        var add = excess / 256;
        var lut = new Float64Array(256), cdf = 0;
        for (b = 0; b < 256; b++) { cdf += hist[b] + add; lut[b] = 255 * cdf / count; }
        luts[ty].push(lut);
      }
    }
    var out = new Float64Array(size * size);
    for (var py = 0; py < size; py++) for (var px = 0; px < size; px++) {
      // Bilinear blend of the four nearest tile LUTs (tile centres at
      // (t + 0.5) * ts - 0.5 in pixel coordinates).
      var gx = (px + 0.5) / ts - 0.5, gy = (py + 0.5) / ts - 0.5;
      var x0 = Math.floor(gx), y0 = Math.floor(gy);
      var fx = gx - x0, fy = gy - y0;
      var xa = Math.max(0, Math.min(tiles - 1, x0)), xb = Math.max(0, Math.min(tiles - 1, x0 + 1));
      var ya = Math.max(0, Math.min(tiles - 1, y0)), yb = Math.max(0, Math.min(tiles - 1, y0 + 1));
      var bin = Math.max(0, Math.min(255, Math.round(flat[py * size + px])));
      var top = luts[ya][xa][bin] * (1 - fx) + luts[ya][xb][bin] * fx;
      var bot = luts[yb][xa][bin] * (1 - fx) + luts[yb][xb][bin] * fx;
      out[py * size + px] = top * (1 - fy) + bot * fy;
    }
    return out;
  }
  function palmprintEncode(gray, w, h, size) {
    size = size || PALMPRINT_SIZE;
    if (!gray || !w || !h || gray.length < w * h) return null;
    // v45 (Palm-X spec section 1.3): local contrast normalisation —
    // illumination flattening + CLAHE (palmprintNormaliseRoi) — is
    // applied to the square palm patch BEFORE encoding, so indoor
    // shop shadows and bright lights do not drop match scores. The
    // 2026-11-20 experiment that rejected this recipe measured it
    // against the OLD pipeline's stored codes; under the v45 format
    // change every template is written by this same encoder, so
    // enrolment and verification stay self-consistent. Square
    // inputs only — the non-square fingerprint path never calls
    // this encoder.
    var src = (w === h) ? palmprintNormaliseRoi(gray, w, h) : gray;
    var img = resizeGrayBilinear(src, w, h, size);
    var enhanced = palmprintEnhance(img, size);
    var kernels = palmprintKernels();
    var responses = [];
    for (var d = 0; d < PALMPRINT_DIRECTIONS; d++) responses.push(convolve2d(enhanced, size, kernels[d], PALMPRINT_KERNEL_SIZE));
    var code = new Uint8Array(size * size);
    for (var p = 0; p < size * size; p++) {
      var best = 0, bestVal = -Infinity;
      for (d = 0; d < PALMPRINT_DIRECTIONS; d++) {
        var v = responses[d][p];
        if (v > bestVal) { bestVal = v; best = d; }
      }
      var sLeft = best === PALMPRINT_DIRECTIONS - 1 ? 0 : best + 1;
      var sRight = best === 0 ? PALMPRINT_DIRECTIONS - 1 : best - 1;
      var side = responses[sLeft][p] >= responses[sRight][p] ? 1 : 0;
      code[p] = best | (side << 4);
    }
    return code;
  }

  /* A usable palmprint code: right length, every byte a legal (d, s)
     pair, and real directional variety — a flat or blank capture
     collapses to one dominant direction and is rejected here. */
  function palmprintCodeSane(code, size) {
    var bytes = palmprintCodeBytes(code);
    var want = (size || PALMPRINT_SIZE) * (size || PALMPRINT_SIZE);
    if (!bytes || bytes.length !== want) return false;
    var counts = new Array(PALMPRINT_DIRECTIONS).fill(0);
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if ((b & 0x0F) >= PALMPRINT_DIRECTIONS) return false;
      if ((b & 0xF0) !== 0 && (b & 0xF0) !== 0x10) return false;
      counts[b & 0x0F]++;
    }
    var distinct = 0, maxShare = 0;
    for (i = 0; i < PALMPRINT_DIRECTIONS; i++) {
      if (counts[i] > 0) distinct++;
      if (counts[i] / bytes.length > maxShare) maxShare = counts[i] / bytes.length;
    }
    if (distinct < 5) return false;
    if (maxShare > PALMPRINT_MAX_DIR_SHARE) return false;
    return true;
  }

  /* Codes travel as base64 strings inside stored profiles. */
  function palmprintCodeBytes(code) {
    if (!code) return null;
    if (typeof code === 'string') return palmprintCodeFromBase64(code);
    var n = code.length, root = Math.round(Math.sqrt(n));
    if (n >= PALMPRINT_CODE_LEN && root * root === n) {
      var out = new Uint8Array(n);
      for (var i = 0; i < n; i++) { var v = Number(code[i]); if (!isFinite(v) || v < 0 || v > 255) return null; out[i] = v; }
      return out;
    }
    return null;
  }
  function palmprintCodeToBase64(code) {
    var bytes = palmprintCodeBytes(code);
    if (!bytes) return null;
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return typeof btoa === 'function' ? btoa(s) : null;
  }
  function palmprintCodeFromBase64(str) {
    if (typeof str !== 'string' || !str.length) return null;
    try {
      var bytes;
      if (typeof Buffer !== 'undefined') bytes = new Uint8Array(Buffer.from(str, 'base64'));
      else if (typeof atob === 'function') {
        var bin = atob(str);
        bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else return null;
      return bytes.length === PALMPRINT_CODE_LEN ? bytes : null;
    } catch (e) { return null; }
  }

  /* EDCC comparer, exact: score = (# pixels with identical packed
     byte) / len, computed here at a code-grid translation (dx, dy)
     over the overlapping region only. */
  function edccScoreAtShift(a, b, dx, dy, size) {
    size = size || PALMPRINT_SIZE;
    var matches = 0, count = 0;
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      var bx = x + dx, by = y + dy;
      if (bx < 0 || bx >= size || by < 0 || by >= size) continue;
      count++;
      if (a[y * size + x] === b[by * size + bx]) matches++;
    }
    return count ? matches / count : null;
  }
  /* The 25 code-grid translations of the similarity search, in the
     order they are tried: (0,0) first, then expanding Manhattan
     rings. The max over the set is identical in any order; the order
     only decides how much of the search the branch-and-bound in
     palmprintSimilaritySeeded can abandon early. The same list
     orders the image-level probe re-encodes in
     verifyPalmprintRoisFast (v35). */
  var PALMPRINT_SHIFT_ORDER = (function () {
    var list = [];
    for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) list.push([dx, dy]);
    list.sort(function (p, q) {
      var mp = Math.abs(p[0]) + Math.abs(p[1]), mq = Math.abs(q[0]) + Math.abs(q[1]);
      return (mp - mq) || (p[1] - q[1]) || (p[0] - q[0]);
    });
    return list;
  })();

  /* EDCC similarity over pre-validated code bytes, with
     branch-and-bound against a seed (v35): `seed` is a score the
     caller has already reached, or null. Each translation is
     scanned row by row over exactly the overlapping region
     edccScoreAtShift counts; a scan is abandoned as soon as its
     ceiling — the score it would reach if every remaining
     overlapping pixel matched — can no longer beat the best score
     so far. A translation whose true score beats the running best
     is never abandoned (its ceiling stays at or above its true
     score at every row boundary), so the returned value is exactly
     the full-search max whenever that max exceeds the seed, and
     some value at or below the seed otherwise — all a caller
     maximising over pairs ever needs. With a null seed nothing is
     abandoned before the first completed translation and the
     result is the full computation, identical to the v34 search:
     same translations, same integer match counts, same divisions. */
  function palmprintSimilaritySeeded(ba, bb, seed, size) {
    size = size || PALMPRINT_SIZE;
    var best = (typeof seed === 'number' && isFinite(seed)) ? seed : null;
    for (var si = 0; si < PALMPRINT_SHIFT_ORDER.length; si++) {
      var dx = PALMPRINT_SHIFT_ORDER[si][0], dy = PALMPRINT_SHIFT_ORDER[si][1];
      var x0 = Math.max(0, -dx), x1 = Math.min(size, size - dx);
      var y0 = Math.max(0, -dy), y1 = Math.min(size, size - dy);
      var count = (x1 - x0) * (y1 - y0);
      if (count <= 0) continue;
      var matches = 0, scanned = 0, abandoned = false;
      for (var y = y0; y < y1; y++) {
        var rowA = y * size, rowB = (y + dy) * size + dx;
        for (var x = x0; x < x1; x++) {
          if (ba[rowA + x] === bb[rowB + x]) matches++;
        }
        scanned += (x1 - x0);
        if (best !== null && (matches + (count - scanned)) / count <= best) { abandoned = true; break; }
      }
      if (abandoned) continue;
      var s = matches / count;
      if (best === null || s > best) best = s;
    }
    return best;
  }

  /* Palmprint similarity: EDCC score, best over +-1 px translations. */
  function palmprintSimilarity(a, b, size) {
    var ba = palmprintCodeBytes(a), bb = palmprintCodeBytes(b);
    if (!palmprintCodeSane(ba, size) || !palmprintCodeSane(bb, size)) return null;
    // v15: the shift search widened from +/-1 to +/-2 code pixels. On a
    // real phone the landmark-derived warp lands a few pixels off
    // between sessions; +/-1 starved genuine matches (a real enrolled
    // palm scored 0.240 against the 0.36 threshold on 2026-11-20).
    // Impostor separation re-verified on the E2E battery before shipping.
    // v35: the search itself is palmprintSimilaritySeeded with a null
    // seed — the identical max over the identical 25 translations.
    return palmprintSimilaritySeeded(ba, bb, null, size);
  }

  /* ================= v45: bit-packed templates + 5-shift matcher ==
     The Palm-X spec's storage and matching layer, adopted by the
     Chairman's explicit override 2026-11-23 18:21 Dhaka ("do
     whatever in the prompt says") after the trade-offs were put to
     him twice. What changes, exactly:

     - A template is the EDCC code's per-pixel VALUE v = d + 10*s
       (direction 0..9 plus the side bit — 20 legal values, 5 bits)
       stored as five bit-planes in a Uint32Array: plane j holds
       bit j of every pixel's value, row-major, pixel x of a row at
       bit (x mod 32) of word (x div 32). 5 planes x 64 rows x 2
       words = 640 words = 2,560 bytes serialised — against 4,096
       bytes for the unpacked code.
     - Similarity at a code-grid shift is computed EXACTLY as the
       unpacked comparer computes it — the fraction of overlapping
       pixels whose packed byte is identical — but counted with
       32-bit popcount: XOR the two codes' planes, OR the five
       difference planes together (a pixel differs iff any of its
       five bits differs), mask to the overlap, popcount. Integer
       arithmetic throughout, so a packed score is bit-identical to
       the unpacked score at the same shift (proven in the v45
       suite), and the 0.32 threshold keeps its meaning.
     - The matcher is the spec's centre-outward 5-shift early-exit:
       (0,0), (0,-2), (0,2), (-2,0), (2,0) in code-grid units. The
       centre is tested first; the moment a shift reaches the
       threshold the pair is VERIFIED and no later shift is
       evaluated. A pair no shift passes has all five evaluated, so
       its reported score is the true 5-shift max. This REPLACES
       the 25-shift search and the v41 geometric-variant set in
       every judgement path (opts.exhaustive disables the early
       exit and records every shift's score — the Field Test Mode
       benchmarking toggle).
     - Profiles are format version 4: { v: 4, format: 'packed96',
       codes: [base64 packed, ...] }. A v3 (byte-code) profile is
       'legacy': its codes cannot be read by this pipeline and
       cannot be converted (different patch, different packing) —
       the v45 migration archives them in the record and flags the
       profile for a one-time palm re-scan (see the migration
       section). Verification against a legacy profile fails closed
       with that reason stated, never silently. */
  var PALMPRINT_FORMAT = 'packed96';
  var PALMPRINT_PACK_PLANES = 5; // bits of v = d + 10*s (20 legal values)
  var PALMPRINT_PACK_WORDS_PER_ROW = PALMPRINT_SIZE / 32; // 2 at size 64
  var PALMPRINT_PACK_WORDS = PALMPRINT_PACK_PLANES * PALMPRINT_SIZE * PALMPRINT_PACK_WORDS_PER_ROW; // 640
  var PALMPRINT_PACK_LEN = PALMPRINT_PACK_WORDS * 4; // 2560 serialised bytes
  var PALMPRINT_SHIFTS5 = [[0, 0], [0, -2], [0, 2], [-2, 0], [2, 0]];
  /* Spec section 1.3 quality-gate numbers, verbatim: reject a
     patch whose mean brightness is under 45, or with more than
     15% of pixels blown past 245. The blur bar is the app's own
     measured one (the v43 guidance bar): fixture palms read
     laplacian variance 320-530 sharp, 62-93 after one 3x3 box
     blur, ~31 after two — 100 sits under every sharp capture and
     over every blurred one. */
  var PALMPRINT_QUALITY_MIN_BRIGHTNESS = 45;
  var PALMPRINT_QUALITY_MAX_GLARE_FRAC = 0.15;
  var PALMPRINT_QUALITY_BLUR_MIN = 100;
  /* Spec section 1.1: the palm bounding box must span 20%-60% of
     the frame width (whole hand, localisation only). */
  var PALMPRINT_BBOX_MIN_FRAC = 0.20;
  var PALMPRINT_BBOX_MAX_FRAC = 0.60;
  /* Spec section 4: the registration burst. */
  var PALMPRINT_BURST_MS = 900;
  var PALMPRINT_BURST_MIN_FRAMES = 12;
  var PALMPRINT_BURST_MAX_FRAMES = 18;
  var PALMPRINT_BURST_TEMPLATES = 3;
  var PALMPRINT_BURST_MICRO_MIN = 0.012; // >= 1.2% natural scale/angle micro-shift
  var PALMPRINT_BURST_Z_MIN = 0.001;     // any measurable Z-depth variance across the burst

  /* 32-bit population count (SWAR) — the Hamming-weight primitive
     the packed comparer is built on. */
  function popcount32(x) {
    x = x >>> 0;
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    x = (x + (x >>> 4)) & 0x0F0F0F0F;
    return (x * 0x01010101) >>> 24;
  }

  /* Pack one EDCC byte code (or its base64) into the five-plane
     Uint32Array template. Returns null on any unusable input. */
  function palmprintPackCode(code) {
    var bytes = palmprintCodeBytes(code);
    if (!bytes || bytes.length !== PALMPRINT_CODE_LEN) return null;
    var words = new Uint32Array(PALMPRINT_PACK_WORDS);
    var WPR = PALMPRINT_PACK_WORDS_PER_ROW, SIZE = PALMPRINT_SIZE;
    for (var y = 0; y < SIZE; y++) for (var x = 0; x < SIZE; x++) {
      var b = bytes[y * SIZE + x];
      var v = (b & 0x0F) + ((b & 0xF0) ? PALMPRINT_DIRECTIONS : 0);
      var wi = (x >> 5), bit = 1 << (x & 31);
      for (var pl = 0; pl < PALMPRINT_PACK_PLANES; pl++) {
        if ((v >> pl) & 1) words[pl * SIZE * WPR + y * WPR + wi] |= bit;
      }
    }
    return words;
  }
  /* Serialise a packed template to its little-endian byte form. */
  function palmprintPackedBytes(packed) {
    var words = palmprintPackedWords(packed);
    if (!words) return null;
    var out = new Uint8Array(PALMPRINT_PACK_LEN);
    for (var i = 0; i < PALMPRINT_PACK_WORDS; i++) {
      var w = words[i] >>> 0;
      out[i * 4] = w & 0xFF; out[i * 4 + 1] = (w >>> 8) & 0xFF;
      out[i * 4 + 2] = (w >>> 16) & 0xFF; out[i * 4 + 3] = (w >>> 24) & 0xFF;
    }
    return out;
  }
  /* Normalise any packed-template representation (Uint32Array of
     words, Uint8Array of serialised bytes, a plain array of either
     length, or the base64 string) to a Uint32Array of words.
     Returns null when the shape is wrong. */
  function palmprintPackedWords(packed) {
    if (!packed) return null;
    if (typeof packed === 'string') return palmprintPackedFromBase64(packed);
    var n = packed.length;
    if (n === PALMPRINT_PACK_WORDS) {
      var words = new Uint32Array(PALMPRINT_PACK_WORDS);
      for (var i = 0; i < n; i++) { var w = Number(packed[i]); if (!isFinite(w)) return null; words[i] = w >>> 0; }
      return words;
    }
    if (n === PALMPRINT_PACK_LEN) {
      var out = new Uint32Array(PALMPRINT_PACK_WORDS);
      for (var j = 0; j < PALMPRINT_PACK_WORDS; j++) {
        out[j] = (Number(packed[j * 4]) | (Number(packed[j * 4 + 1]) << 8) | (Number(packed[j * 4 + 2]) << 16) | (Number(packed[j * 4 + 3]) << 24)) >>> 0;
      }
      return out;
    }
    return null;
  }
  function palmprintPackedToBase64(packed) {
    var bytes = palmprintPackedBytes(packed);
    if (!bytes) return null;
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return typeof btoa === 'function' ? btoa(s) : null;
  }
  function palmprintPackedFromBase64(str) {
    if (typeof str !== 'string' || !str.length) return null;
    try {
      var bytes;
      if (typeof Buffer !== 'undefined') bytes = new Uint8Array(Buffer.from(str, 'base64'));
      else if (typeof atob === 'function') {
        var bin = atob(str);
        bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else return null;
      if (bytes.length !== PALMPRINT_PACK_LEN) return null;
      return palmprintPackedWords(bytes);
    } catch (e) { return null; }
  }
  /* Unpack a template back to the EDCC byte code — the identity
     bridge the v45 suite proves the packed scores against, and a
     diagnostic aid. The packed form is the storage/matching form;
     nothing in the shipping judgement path needs this. */
  function palmprintUnpackCode(packed) {
    var words = palmprintPackedWords(packed);
    if (!words) return null;
    var WPR = PALMPRINT_PACK_WORDS_PER_ROW, SIZE = PALMPRINT_SIZE;
    var out = new Uint8Array(PALMPRINT_CODE_LEN);
    for (var y = 0; y < SIZE; y++) for (var x = 0; x < SIZE; x++) {
      var v = 0, wi = (x >> 5), bit = x & 31;
      for (var pl = 0; pl < PALMPRINT_PACK_PLANES; pl++) {
        if ((words[pl * SIZE * WPR + y * WPR + wi] >>> bit) & 1) v |= (1 << pl);
      }
      if (v >= PALMPRINT_DIRECTIONS) out[y * SIZE + x] = (v - PALMPRINT_DIRECTIONS) | 0x10;
      else out[y * SIZE + x] = v;
    }
    return out;
  }
  /* A usable packed template: right shape, and the code it carries
     passes the same sanity the byte codes pass (real directional
     variety — a flat capture collapses and is rejected). */
  function palmprintPackedSane(packed) {
    var words = palmprintPackedWords(packed);
    if (!words) return false;
    var bytes = palmprintUnpackCode(words);
    return !!bytes && palmprintCodeSane(bytes);
  }

  /* Packed score at one code-grid shift: the fraction of
     overlapping pixels whose value is identical, counted by
     popcount over the OR of the five XORed planes. Bit-identical
     to edccScoreAtShift on the unpacked codes — same overlap
     region, same pairing (a's pixel (x, y) against b's
     (x + dx, y + dy)), integer counts, one division. */
  function edccPackedScoreAtShift(pa, pb, dx, dy) {
    var SIZE = PALMPRINT_SIZE, WPR = PALMPRINT_PACK_WORDS_PER_ROW;
    var x0 = Math.max(0, -dx), x1 = Math.min(SIZE, SIZE - dx);
    var y0 = Math.max(0, -dy), y1 = Math.min(SIZE, SIZE - dy);
    var count = (x1 - x0) * (y1 - y0);
    if (count <= 0) return null;
    var masks = [];
    for (var wI = 0; wI < WPR; wI++) {
      var lo = Math.max(x0, wI * 32), hi = Math.min(x1, wI * 32 + 32);
      if (hi <= lo) { masks.push(0); continue; }
      var bits = hi - lo;
      masks.push(bits >= 32 ? 0xFFFFFFFF : (((1 << bits) - 1) << (lo - wI * 32)) >>> 0);
    }
    var diffs = 0;
    for (var y = y0; y < y1; y++) {
      var brow = y + dy;
      for (var wi = 0; wi < WPR; wi++) {
        if (!masks[wi]) continue;
        var or = 0;
        for (var pl = 0; pl < PALMPRINT_PACK_PLANES; pl++) {
          var base = pl * SIZE * WPR;
          var aw = pa[base + y * WPR + wi];
          var b0 = pb[base + brow * WPR], b1 = pb[base + brow * WPR + 1];
          var bw;
          if (dx === 0) bw = wi === 0 ? b0 : b1;
          else if (dx > 0) bw = wi === 0 ? ((b0 >>> dx) | (b1 << (32 - dx))) : (b1 >>> dx);
          else { var s = -dx; bw = wi === 0 ? (b0 << s) : ((b1 << s) | (b0 >>> (32 - s))); }
          or |= (aw ^ bw) >>> 0;
        }
        diffs += popcount32((or & masks[wi]) >>> 0);
      }
    }
    return (count - diffs) / count;
  }
  /* The 5-shift matcher over two already-validated packed
     templates. Centre first; early exit the moment a shift
     reaches the threshold (unless opts.exhaustive). Returns
     { score, evaluated: [[dx, dy]...], perShift } — perShift is
     filled only in exhaustive mode (the Field Test toggle). */
  function palmprintPackedMatchWords(pa, pb, opts) {
    var exhaustive = !!(opts && opts.exhaustive);
    var best = null, evaluated = [], perShift = exhaustive ? [] : null;
    for (var i = 0; i < PALMPRINT_SHIFTS5.length; i++) {
      var dx = PALMPRINT_SHIFTS5[i][0], dy = PALMPRINT_SHIFTS5[i][1];
      var s = edccPackedScoreAtShift(pa, pb, dx, dy);
      evaluated.push([dx, dy]);
      if (perShift) perShift.push({ dx: dx, dy: dy, score: s });
      if (s !== null && (best === null || s > best)) best = s;
      if (!exhaustive && best !== null && best >= PALMPRINT_THRESHOLD) break;
    }
    return { score: best, evaluated: evaluated, perShift: perShift };
  }
  /* Public packed match: validates both sides, then the matcher
     above. Returns null when either side is unusable. */
  function palmprintPackedMatch(a, b, opts) {
    var pa = palmprintPackedWords(a), pb = palmprintPackedWords(b);
    if (!pa || !pb || !palmprintPackedSane(pa) || !palmprintPackedSane(pb)) return null;
    return palmprintPackedMatchWords(pa, pb, opts);
  }
  /* Packed similarity (score only) — the drop-in counterpart of
     palmprintSimilarity for the packed store. */
  function palmprintPackedSimilarity(a, b, opts) {
    var m = palmprintPackedMatch(a, b, opts);
    return m ? m.score : null;
  }

  /* Spec section 1.1: palm bounding-box width as a fraction of
     the frame width, from the landmarks' x-extent (the whole hand
     — localisation only). Null on unusable landmarks. */
  function palmBboxWidthFrac(landmarks) {
    if (!landmarks || landmarks.length !== 21) return null;
    var minX = Infinity, maxX = -Infinity;
    for (var i = 0; i < 21; i++) {
      var p = landmarks[i];
      if (!p || !isFinite(Number(p.x))) return null;
      if (Number(p.x) < minX) minX = Number(p.x);
      if (Number(p.x) > maxX) maxX = Number(p.x);
    }
    return maxX - minX;
  }
  /* Spec section 1.3 quality gate over one warped palm patch:
     Laplacian-variance blur, mean brightness, blown-pixel glare —
     with the spec's numbers and its hint strings. `framing` is
     optional caller context: { hasHand, bboxWidthFrac } — no hand
     reads "Show open palm", a palm under 20% of the frame width
     reads "Move slightly closer". Returns { pass, mean, glareFrac,
     blur, reasons, hint } — hint is null on a clean pass. */
  function palmprintQualityGate(gray, w, h, framing) {
    var out = { pass: false, mean: null, glareFrac: null, blur: 0, reasons: [], hint: 'Show open palm' };
    if (framing && framing.hasHand === false) return out;
    if (framing && typeof framing.bboxWidthFrac === 'number' && isFinite(framing.bboxWidthFrac) && framing.bboxWidthFrac < PALMPRINT_BBOX_MIN_FRAC) {
      out.hint = 'Move slightly closer';
      out.reasons.push('Palm is too far from the camera.');
      return out;
    }
    if (!gray || !w || !h || gray.length < w * h) { out.reasons.push('No palm patch to judge.'); return out; }
    var n = w * h, sum = 0, blown = 0, i;
    for (i = 0; i < n; i++) { var v = gray[i]; sum += v; if (v > 245) blown++; }
    out.mean = sum / n;
    out.glareFrac = blown / n;
    out.blur = laplacianVariance(gray, w, h);
    if (out.mean < PALMPRINT_QUALITY_MIN_BRIGHTNESS) out.reasons.push('Too dark: mean brightness ' + out.mean.toFixed(1) + ' is under ' + PALMPRINT_QUALITY_MIN_BRIGHTNESS + '.');
    if (out.glareFrac > PALMPRINT_QUALITY_MAX_GLARE_FRAC) out.reasons.push('Washed out: ' + Math.round(out.glareFrac * 100) + '% of pixels are blown past 245 (bar ' + Math.round(PALMPRINT_QUALITY_MAX_GLARE_FRAC * 100) + '%).');
    if (out.blur < PALMPRINT_QUALITY_BLUR_MIN) out.reasons.push('Blurry: sharpness ' + out.blur.toFixed(0) + ' is under the bar of ' + PALMPRINT_QUALITY_BLUR_MIN + '.');
    out.pass = out.reasons.length === 0;
    out.hint = !out.pass
      ? (out.mean !== null && out.mean < PALMPRINT_QUALITY_MIN_BRIGHTNESS ? 'Too dark — turn on Flash' : 'Hold steady...')
      : null;
    return out;
  }
  /* Spec section 4 passive liveness over the registration burst:
     natural 3D hand micro-motion read from the burst's landmark
     sets — Z-depth variance across the palm anchors (0, 5, 9, 13,
     17) and the largest consecutive-frame scale/angle micro-shift
     (knuckle-span change as a fraction of span, or knuckle-line
     angle change in radians — a radian of rotation is the angle
     axis's own unit). Pass: micro-shift >= 1.2% AND measurable Z
     variance. A flat photo or a frozen replay holds both at zero
     and fails; the screen-glare / edge-replay defences stay in
     screenSpoofCheck, sampled over the burst by the caller. */
  function palmprintBurstLiveness(landmarkSets) {
    var sets = (landmarkSets || []).filter(function (lm) { return lm && lm.length === 21; });
    if (sets.length < 2) return { pass: false, microShift: 0, zRange: 0, frames: sets.length, reason: 'Too few frames with a detected hand to judge liveness.' };
    var anchors = [0, 5, 9, 13, 17];
    var zRangeSum = 0;
    anchors.forEach(function (idx) {
      var mn = Infinity, mx = -Infinity, seen = false;
      sets.forEach(function (lm) {
        var z = lm[idx] && isFinite(Number(lm[idx].z)) ? Number(lm[idx].z) : null;
        if (z === null) return;
        seen = true;
        if (z < mn) mn = z;
        if (z > mx) mx = z;
      });
      if (seen) zRangeSum += (mx - mn);
    });
    var zRange = zRangeSum / anchors.length;
    function spanAng(lm) {
      var a = lm[5], b = lm[17];
      if (!a || !b || !isFinite(Number(a.x)) || !isFinite(Number(a.y)) || !isFinite(Number(b.x)) || !isFinite(Number(b.y))) return null;
      return { span: Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y)), ang: Math.atan2(Number(b.y) - Number(a.y), Number(b.x) - Number(a.x)) };
    }
    var microShift = 0;
    for (var i = 1; i < sets.length; i++) {
      var p0 = spanAng(sets[i - 1]), p1 = spanAng(sets[i]);
      if (!p0 || !p1 || !(p0.span > 0)) continue;
      var dSpan = Math.abs(p1.span - p0.span) / p0.span;
      var dAng = Math.abs(p1.ang - p0.ang);
      if (dAng > Math.PI) dAng = 2 * Math.PI - dAng;
      var m = Math.max(dSpan, dAng);
      if (m > microShift) microShift = m;
    }
    var pass = microShift >= PALMPRINT_BURST_MICRO_MIN && zRange >= PALMPRINT_BURST_Z_MIN;
    return {
      pass: pass, microShift: microShift, zRange: zRange, frames: sets.length,
      reason: pass ? 'Natural micro-motion across the burst.'
        : (microShift < PALMPRINT_BURST_MICRO_MIN
          ? 'The hand did not move naturally at all across the burst (micro-shift ' + (microShift * 100).toFixed(2) + '% — a still photo or a frozen image cannot enrol).'
          : 'No measurable depth variation across the burst — a flat presentation cannot enrol.')
    };
  }
  /* Spec section 4 banking: from the burst's usable fully-open
     frames (the palmprintUsableOpenFrames gate), the sharpest
     frame in each third of the burst — time-spaced, so the three
     banked templates carry the burst's natural micro-angle
     variation instead of three copies of one instant. Each pick's
     ROI is encoded and packed here. Returns { codes: [packed
     base64 x3], picks: [frame indices] } or null when fewer than
     three usable frames with ROIs exist. */
  function selectPalmprintBurstCodes(frames) {
    var usableAll = palmprintUsableOpenFrames(frames).filter(function (u) { return !!u.roi; });
    if (usableAll.length < PALMPRINT_BURST_TEMPLATES) return null;
    /* Fully-open preference (the v15/v24 measured rule, kept):
       codes banked from mid-movement transition frames match
       nothing later (a real enrolled palm scored 0.240 at
       verification on 2026-11-20), so when at least three frames
       sit within 0.30 openness of the burst's most-open frame,
       the banking set is those frames; otherwise all usable
       frames compete. The picks themselves stay the spec's:
       sharpest per time-third. */
    var maxOpen = Math.max.apply(null, usableAll.map(function (u) { return u.openness; }));
    var full = usableAll.filter(function (u) { return u.openness >= maxOpen - 0.30; });
    var usable = full.length >= PALMPRINT_BURST_TEMPLATES ? full : usableAll;
    usable.sort(function (a, b) { return a.index - b.index; });
    var picks = [];
    for (var t = 0; t < PALMPRINT_BURST_TEMPLATES; t++) {
      var bucket = usable.slice(Math.floor(t * usable.length / PALMPRINT_BURST_TEMPLATES), Math.floor((t + 1) * usable.length / PALMPRINT_BURST_TEMPLATES));
      if (!bucket.length) return null;
      bucket.sort(function (a, b) { return b.sharpness - a.sharpness; });
      picks.push(bucket[0]);
    }
    var codes = [];
    for (var i = 0; i < picks.length; i++) {
      var code = palmprintEncode(picks[i].roi, PALMPRINT_ROI_SIZE, PALMPRINT_ROI_SIZE);
      if (!code || !palmprintCodeSane(code)) return null;
      var packed = palmprintPackCode(code);
      var b64 = packed && palmprintPackedToBase64(packed);
      if (!b64) return null;
      codes.push(b64);
    }
    return { codes: codes, picks: picks.map(function (u) { return u.index; }) };
  }

  /* v33: shift a grayscale image by (dx, dy) with edge-clamped
     sampling — out(x, y) = src(x-dx, y-dy), source coordinates clamped
     to the image edge (border replication, so no artificial black
     border is introduced). Identical to the PalmCode-Bench v25
     shiftGray used to produce the measured max-fusion numbers. */
  function shiftGrayClamped(gray, w, h, dx, dy) {
    if (!gray || !w || !h || gray.length < w * h) return null;
    var out = new Array(w * h);
    for (var y = 0; y < h; y++) {
      var sy = Math.max(0, Math.min(h - 1, y - dy));
      for (var x = 0; x < w; x++) {
        var sx = Math.max(0, Math.min(w - 1, x - dx));
        out[y * w + x] = gray[sy * w + sx];
      }
    }
    return out;
  }

  var PALMPRINT_SHIFT_RANGE = 2; // v33: probe re-encode shifts dx, dy in {-2,-1,0,1,2} — 25 positions

  /* v33 probe codes (PalmCode-Bench v25): encode one warped palm ROI
     at all 25 image-level shifts, and the same 25 for its mirror twin
     (a front-camera and a back-camera presentation of the same palm
     are mirror images; the benchmark's dataset ROIs had a single
     fixed orientation, the phone product does not). Sane codes only.
     The score-level max over these codes against the individual
     enrolled codes is the v25 decision rule — on Dataset B it
     measured EER 4.42% / Rank-1 92.9%, against 13.02% / 70.7% for
     the consensus-template rule it replaces (aligned dataset ROIs;
     phone numbers come from the field test, not from the bench). */
  function palmprintProbeCodes(roi) {
    if (!roi || roi.length !== PALMPRINT_ROI_SIZE * PALMPRINT_ROI_SIZE) return [];
    var out = [];
    var flipped = flipGrayHorizontal(roi, PALMPRINT_ROI_SIZE, PALMPRINT_ROI_SIZE);
    [roi, flipped].forEach(function (img) {
      if (!img) return;
      for (var dy = -PALMPRINT_SHIFT_RANGE; dy <= PALMPRINT_SHIFT_RANGE; dy++) {
        for (var dx = -PALMPRINT_SHIFT_RANGE; dx <= PALMPRINT_SHIFT_RANGE; dx++) {
          var src = (dx === 0 && dy === 0) ? img : shiftGrayClamped(img, PALMPRINT_ROI_SIZE, PALMPRINT_ROI_SIZE, dx, dy);
          var code = palmprintEncode(src, PALMPRINT_ROI_SIZE, PALMPRINT_ROI_SIZE);
          if (code && palmprintCodeSane(code)) out.push(code);
        }
      }
    });
    return out;
  }

  /* v41 GEOMETRIC probe variants — the fix for the 2026-11-23 phone
     genuine reject (his own palm: similarity 0.207, best frame 0.242,
     against the 0.32 bar, after a smooth enrolment).
     DIAGNOSIS (rig, fixture palms through the real warp+encode path,
     one factor varied at a time; full table in tests/v41-geovariants):
       - probe distance/scale x0.6..x1.3: 0.559-0.589 — INNOCENT
         (the landmark warp normalises scale);
       - in-plane rotation +-25 deg: 0.573-0.594 — INNOCENT (the
         warp aligns on the wrist axis at the source);
       - ROI from the 480px analysis copy vs the 640px source: probe
         still verifies at 0.517 — the v38 input cuts are INNOCENT;
       - enrolment self-consistency: mutual sims of the 6 banked
         codes 0.531-0.678 — healthy, NOT the failure;
       - OUT-OF-PLANE TILT (palm plane angled to the camera, print
         foreshortened along the wrist axis): av 0.90 -> 0.292,
         0.85 -> 0.224, 0.80 -> 0.196, 0.75 -> 0.169 — THE dominant
         factor, landing exactly on his measured 0.21-0.24. The
         warp's ROI is a square built from the KNUCKLE SPAN (the
         axis a tilt around the knuckle line barely shortens), so
         the foreshortened print is encoded compressed and no
         translation search can recover it;
       - knuckle-span misread (fingers more/less spread than at
         enrolment): span x1.10 -> 0.259, x1.15 -> 0.238,
         x0.90 -> 0.314 — the second factor (the square's SIZE is
         the span, so a span error is a zoom error);
       - landmark jitter 8-12 px on the warp landmarks: 0.287 /
         0.230 — contributes, partly covered by the same variants.
     FIX: the probe side gains a bounded set of geometric re-encodes
     — vertical stretches that undo foreshortening (zy 1.12-1.43),
     vertical squeezes for the symmetric case (the ENROLMENT was
     the tilted one: zy 0.85 / 0.75), and isotropic zooms that undo
     a span misread (1.10 / 0.91). Each variant is encoded ONCE per
     orientation at the centre shift only: the similarity's own
     +-2 code-grid translation search absorbs the residual
     translation (measured: centre-only scores identical to a
     9-shift expansion on every fixture). Order is measured
     likelihood: the tilt stretches that cover his failure band
     first. The variants only ADD pairs to the v33 max rule — the
     matcher, fusion and threshold are untouched — and they are
     probe-side only, so every existing enrolment (including his
     v40 one) benefits with no re-enrolment and no stored-data
     change. Impostor cost, measured on the fixture family with
     the full expanded set: max 0.150, identical to the base set's
     0.150 — the expansion did not widen the impostor surface
     there; the field test remains the real-world gate. */
  var PALMPRINT_GEO_VARIANTS = [
    { zx: 1, zy: 1.18 }, { zx: 1, zy: 1.33 }, { zx: 1, zy: 1.25 },
    { zx: 1, zy: 1.12 }, { zx: 1, zy: 1.43 },
    { zx: 1, zy: 0.85 }, { zx: 1, zy: 0.75 },
    { zx: 1.10, zy: 1.10 }, { zx: 0.91, zy: 0.91 }
  ];
  /* The geometric probe codes for one ROI: for each variant, the
     resampled ROI and its mirror twin, encoded at the centre shift.
     Sane codes only, in PALMPRINT_GEO_VARIANTS order. */
  function palmprintProbeCodesGeo(roi) {
    if (!roi || roi.length !== PALMPRINT_ROI_SIZE * PALMPRINT_ROI_SIZE) return [];
    var out = [];
    var flipped = flipGrayHorizontal(roi, PALMPRINT_ROI_SIZE, PALMPRINT_ROI_SIZE);
    var imgs = flipped ? [roi, flipped] : [roi];
    PALMPRINT_GEO_VARIANTS.forEach(function (gv) {
      imgs.forEach(function (img) {
        var scaled = scaleGrayCentre(img, PALMPRINT_ROI_SIZE, PALMPRINT_ROI_SIZE, gv.zx, gv.zy);
        if (!scaled) return;
        var code = palmprintEncode(scaled, PALMPRINT_ROI_SIZE, PALMPRINT_ROI_SIZE);
        if (code && palmprintCodeSane(code)) out.push(code);
      });
    });
    return out;
  }

  /* v44 PROMISING-BAND FLOOR for the geometric variants (the
     Chairman's phone verdict on v43, 2026-11-23 17:42: "verify and
     payment scan takes too timeeeee" — on his device a full-window
     run measured 24 frames in 11,752 ms, ~490 ms per analysed
     frame, and every non-matching frame was paying all 18 geo
     encodes plus their scoring before the scan moved on).
     MEASUREMENT (2026-11-23, the v41 fixture families, per single
     frame against a flat enrolment): geo-RESCUABLE genuine frames
     — base below 0.32, full rule at/above 0.32 — scored base
     0.158..0.314 (n=40; the lowest was a tilt av=0.70 frame at
     0.158; his own failure band, tilt av=0.85, sat at 0.215-0.224).
     Impostor frames scored base max 0.174 (n=80, median 0.120).
     The distributions overlap, and that is safe here: skipping the
     geo set can only LOWER a frame's score (a max over a subset of
     the pairs), so the gate can never create an accept — the only
     thing a floor can lose is a rescue, and no rescue has been
     observed below a base of 0.158. The floor is set at 0.14:
     0.018 under the lowest measured rescuable frame, above the
     impostor median, so most junk frames skip the geo work while
     every frame at/above the floor receives the identical full
     v43 judgement (same variants, same max rule). The field test
     remains the real-world judge of the rescue floor. */
  var PALMPRINT_GEO_FLOOR = 0.14;

  /* --- Palm ROI extraction: landmarks locate, they do not identify ---
     Palm frame built in PIXEL space (landmark coords are per-axis
     normalised, so geometry must be computed after scaling). v20
     alignment: the frame's v axis is the wrist -> middle-finger MCP
     axis (landmarks 0 -> 9), the hand's own vertical; u is its
     perpendicular, oriented from the index side toward the pinky side.
     Aligning on this axis before encoding cancels the hand's in-plane
     rotation at the source, which is what lets verification work with
     2 code variants per frame (aligned + mirror) instead of the v16
     set of 18 with rotation twins. The ROI square has side 1.7 x
     knuckle span, centred 0.42 side-lengths toward the wrist from the
     knuckle line — the central palm, where the principal lines live.
     NOTE: codes enrolled before v20 were warped on the old knuckle-
     line frame; they still decode, but genuine scores against v20
     live codes drop - re-enrolment is the clean path. */
  function palmRoiCornersPx(w, h, landmarks) {
    if (!landmarks || landmarks.length !== 21 || !w || !h) return null;
    var pts = [];
    for (var i = 0; i < 21; i++) {
      var p = landmarks[i];
      if (!p || !isFinite(Number(p.x)) || !isFinite(Number(p.y))) return null;
      pts.push({ x: Number(p.x) * w, y: Number(p.y) * h });
    }
    var A = pts[5], Bp = pts[17], W = pts[0], M = pts[9];
    var mx = (A.x + Bp.x) / 2, my = (A.y + Bp.y) / 2;
    var kx = Bp.x - A.x, ky = Bp.y - A.y;
    var span = Math.hypot(kx, ky);
    if (!(span >= 0.10 * Math.min(w, h))) return null; // hand too small / partial
    // v axis: middle MCP -> wrist (the hand's vertical, pointing from
    // the fingers toward the wrist).
    var vx = W.x - M.x, vy = W.y - M.y;
    var vlen = Math.hypot(vx, vy);
    if (!(vlen >= 0.05 * Math.min(w, h))) return null; // collapsed hand geometry
    vx /= vlen; vy /= vlen;
    // u axis: perpendicular to v, oriented index side -> pinky side.
    var ux = -vy, uy = vx;
    if (kx * ux + ky * uy < 0) { ux = -ux; uy = -uy; }
    var side = 1.7 * span;
    var cx = mx + vx * 0.42 * side, cy = my + vy * 0.42 * side;
    var hs = side / 2;
    return [
      { x: cx - ux * hs - vx * hs, y: cy - uy * hs - vy * hs },
      { x: cx + ux * hs - vx * hs, y: cy + uy * hs - vy * hs },
      { x: cx + ux * hs + vx * hs, y: cy + uy * hs + vy * hs },
      { x: cx - ux * hs + vx * hs, y: cy - uy * hs + vy * hs }
    ];
  }
  /* The palm region the spoof grid gate may look at (v36): the
     axis-aligned box around the exact ROI square palmRoiFromLandmarks
     warps out for matching, grown by a small margin (6% of its larger
     side) for warp slop and clamped to the frame. Returns
     {x0, y0, x1, y1} in pixels, or null when no usable ROI square
     exists (no hand, hand too small, degenerate geometry).
     v40: the app no longer feeds this box to the spoof gate — the
     box is much larger than the palm itself, and print/texture
     inside the square but off the palm still convicted live scans
     (see palmHullRegionPx below). This box remains for direct
     callers and the v36 regression suite. */
  function palmRoiRegionPx(w, h, landmarks) {
    var corners = palmRoiCornersPx(w, h, landmarks);
    if (!corners) return null;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    corners.forEach(function (c) {
      if (c.x < x0) x0 = c.x; if (c.x > x1) x1 = c.x;
      if (c.y < y0) y0 = c.y; if (c.y > y1) y1 = c.y;
    });
    var m = 0.06 * Math.max(x1 - x0, y1 - y0);
    x0 = Math.max(0, Math.floor(x0 - m)); y0 = Math.max(0, Math.floor(y0 - m));
    x1 = Math.min(w, Math.ceil(x1 + m)); y1 = Math.min(h, Math.ceil(y1 + m));
    if (!(x1 - x0 >= 16 && y1 - y0 >= 16)) return null;
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  /* Convex hull (Andrew's monotone chain) over pixel points;
     collinear interior points are dropped, so the result is the
     minimal vertex set, in order, with no repeated endpoint. */
  function convexHullPx(points) {
    var pts = points.slice().sort(function (a, b) { return (a.x - b.x) || (a.y - b.y); });
    var uniq = [];
    pts.forEach(function (p) {
      var last = uniq[uniq.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y) uniq.push(p);
    });
    if (uniq.length < 3) return uniq;
    function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    var lower = [], upper = [], i;
    for (i = 0; i < uniq.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], uniq[i]) <= 0) lower.pop();
      lower.push(uniq[i]);
    }
    for (i = uniq.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], uniq[i]) <= 0) upper.pop();
      upper.push(uniq[i]);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }
  /* Point-in-convex-polygon by consistent edge-cross sign; works
     for either winding. Points exactly on an edge count as in. */
  function pointInConvexHullPx(x, y, hull) {
    var sign = 0;
    for (var i = 0; i < hull.length; i++) {
      var a = hull[i], b = hull[(i + 1) % hull.length];
      var c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (c !== 0) {
        var s = c > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else if (s !== sign) return false;
      }
    }
    return true;
  }
  /* The palm region the spoof grid gate may look at (v40): the
     convex hull of the landmarks that trace the PALM BODY — wrist
     (0), thumb base (1, 2) and the four knuckle joints (5, 9, 13,
     17) — eroded 10% toward the hull's vertex centroid, so the
     sampled area is palm skin with a small safety margin from the
     silhouette edge. Finger joints and fingertips are NOT palm and
     are excluded, as is everything the old ROI-square box admitted
     around the hand (the surface the hand hovers over, the gaps
     beside the fingers). Returns { hull: [{x, y}...], cx, cy } in
     pixels, or null when the landmarks are unusable (missing,
     non-finite, hand too small by the same span bar the ROI uses,
     or a degenerate/collinear outline) — a null region means the
     frame carries NO grid evidence, exactly as in v36; the gate
     never falls back to the square or the whole frame. */
  function palmHullRegionPx(w, h, landmarks) {
    if (!landmarks || landmarks.length !== 21 || !w || !h) return null;
    var pts = [];
    for (var i = 0; i < 21; i++) {
      var p = landmarks[i];
      if (!p || !isFinite(Number(p.x)) || !isFinite(Number(p.y))) return null;
      pts.push({ x: Number(p.x) * w, y: Number(p.y) * h });
    }
    var span = Math.hypot(pts[17].x - pts[5].x, pts[17].y - pts[5].y);
    if (!(span >= 0.10 * Math.min(w, h))) return null; // hand too small / partial
    var outline = [0, 1, 2, 5, 9, 13, 17].map(function (idx) { return pts[idx]; });
    var hull = convexHullPx(outline);
    if (hull.length < 3) return null;
    var area2 = 0, cx = 0, cy = 0;
    hull.forEach(function (pt, i) {
      var q = hull[(i + 1) % hull.length];
      area2 += pt.x * q.y - q.x * pt.y;
      cx += pt.x; cy += pt.y;
    });
    if (!(Math.abs(area2) > 1)) return null; // collinear outline: no interior
    cx /= hull.length; cy /= hull.length;
    var eroded = hull.map(function (pt) {
      return { x: cx + (pt.x - cx) * 0.9, y: cy + (pt.y - cy) * 0.9 };
    });
    return { hull: eroded, cx: cx, cy: cy };
  }
  function homographyFromQuad(corners) {
    // Maps the unit square (0,0),(1,0),(1,1),(0,1) onto corners TL,TR,BR,BL.
    var x0 = corners[0].x, y0 = corners[0].y, x1 = corners[1].x, y1 = corners[1].y;
    var x2 = corners[2].x, y2 = corners[2].y, x3 = corners[3].x, y3 = corners[3].y;
    var sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    var dx1 = x1 - x2, dy1 = y1 - y2, dx2 = x3 - x2, dy2 = y3 - y2;
    var det = dx1 * dy2 - dx2 * dy1;
    if (!det || !isFinite(det)) return null;
    var g = (sx * dy2 - dx2 * sy) / det, hh = (dx1 * sy - sx * dy1) / det;
    return {
      a: x1 - x0 + g * x1, b: x3 - x0 + hh * x3, c: x0,
      d: y1 - y0 + g * y1, e: y3 - y0 + hh * y3, f: y0,
      g: g, h: hh
    };
  }
  /* v45 (the Chairman's Palm-X spec, adopted 2026-11-23 over his
     earlier reconciled build): the canonical ROI is an AFFINE
     square built from exactly three anchors — Wrist (0), Index
     MCP (5), Pinky MCP (17). The destination triangle is fixed in
     patch units: Index MCP -> (0.10, 0.06), Pinky MCP -> (0.90,
     0.06), Wrist -> (0.50, 1.10) — the wrist anchor sits just past
     the patch's lower edge, so the square covers the inner palm
     between the knuckle line and the wrist, where the primary
     palmar creases live. Every destination pixel solves for its
     barycentric coordinates in that triangle and samples the
     source at A + s*(B - A) + t*(W - A), bilinear with
     edge-clamped sampling — the same sampling discipline the
     retired homography warp used. Because the three anchors fix
     rotation AND scale, the print lands in the same orientation
     and size on every capture — the premise the spec's 5-shift
     matcher relies on. The whole hand is used for localisation
     only; fingers are never matched. The too-small bar is the
     same one the old warp used (knuckle span >= 10% of the
     frame's smaller side). */
  var PALMPRINT_AFFINE_DEST = { ax: 0.10, ay: 0.06, bx: 0.90, by: 0.06, wx: 0.50, wy: 1.10 };
  function palmRoiAffineFromLandmarks(gray, w, h, landmarks, outSize) {
    if (!gray || !w || !h || gray.length < w * h) return null;
    if (!landmarks || landmarks.length !== 21) return null;
    var size = outSize || PALMPRINT_ROI_SIZE;
    var A = null, Bp = null, W = null, p, i;
    var want = [0, 5, 17];
    for (i = 0; i < 3; i++) {
      p = landmarks[want[i]];
      if (!p || !isFinite(Number(p.x)) || !isFinite(Number(p.y))) return null;
      var pt = { x: Number(p.x) * w, y: Number(p.y) * h };
      if (want[i] === 0) W = pt; else if (want[i] === 5) A = pt; else Bp = pt;
    }
    var span = Math.hypot(Bp.x - A.x, Bp.y - A.y);
    if (!(span >= 0.10 * Math.min(w, h))) return null; // hand too small / partial
    var D = PALMPRINT_AFFINE_DEST;
    var e1x = D.bx - D.ax, e1y = D.by - D.ay, e2x = D.wx - D.ax, e2y = D.wy - D.ay;
    var det = e1x * e2y - e2x * e1y;
    if (!det || !isFinite(det)) return null;
    var ux = Bp.x - A.x, uy = Bp.y - A.y;
    var vx = W.x - A.x, vy = W.y - A.y;
    var out = new Array(size * size);
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      var du = (x + 0.5) / size - D.ax, dv = (y + 0.5) / size - D.ay;
      var s = (du * e2y - e2x * dv) / det;
      var t = (e1x * dv - du * e1y) / det;
      var sx = A.x + s * ux + t * vx, sy = A.y + s * uy + t * vy;
      sx = Math.max(0, Math.min(w - 1, sx)); sy = Math.max(0, Math.min(h - 1, sy));
      var x0 = Math.floor(sx), y0 = Math.floor(sy);
      var x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      var fx = sx - x0, fy = sy - y0;
      var top = gray[y0 * w + x0] * (1 - fx) + gray[y0 * w + x1] * fx;
      var bot = gray[y1 * w + x0] * (1 - fx) + gray[y1 * w + x1] * fx;
      out[y * size + x] = top * (1 - fy) + bot * fy;
    }
    return out;
  }
  /* Warp the palm square out of a grayscale frame. Returns a
     PALMPRINT_ROI_SIZE square (plain Array of gray values) or null.
     v45: the warp IS the affine (0, 5, 17) construction above; the
     pre-v45 homography warp (palmRoiCornersPx + homographyFromQuad)
     is retired — its helpers remain for the spoof region and the
     historical suites. */
  function palmRoiFromLandmarks(gray, w, h, landmarks, outSize) {
    return palmRoiAffineFromLandmarks(gray, w, h, landmarks, outSize);
  }

  /* --- Palmprint profile (v45 format v4, packed) + clip selection ---
     A scannable profile is { v: 4, format: 'packed96', codes:
     [packed base64, ...] } with at least two sane packed templates.
     A v3 byte-code profile reports format 'legacy' (see
     palmprintProfileFormat): the v45 migration archives its codes
     in the record and flags it, and this pipeline fails closed on
     it with the re-scan reason — it is never silently unreadable
     and never silently dropped. */
  function palmprintProfileFormat(stored) {
    if (!stored || typeof stored !== 'object' || !Array.isArray(stored.codes)) return null;
    if (stored.v === 4 && stored.format === PALMPRINT_FORMAT) return PALMPRINT_FORMAT;
    if (stored.v === 3) return 'legacy';
    return null;
  }
  function normalisePalmprintProfile(stored) {
    if (palmprintProfileFormat(stored) !== PALMPRINT_FORMAT) return null;
    var codes = [];
    for (var i = 0; i < stored.codes.length; i++) {
      var words = palmprintPackedWords(stored.codes[i]);
      if (!words || !palmprintPackedSane(words)) return null;
      codes.push(words);
    }
    if (codes.length < 2) return null; // enrolment banks 3; fewer than 2 sane templates is not a profile
    return { codes: codes };
  }
  function palmprintProfileSane(stored) { return normalisePalmprintProfile(stored) !== null; }
  /* The fail reason for a profile this pipeline cannot judge:
     a legacy profile gets the honest re-scan reason, anything
     else the long-standing missing/invalid one. */
  function palmprintProfileFailReason(stored) {
    if (palmprintProfileFormat(stored) === 'legacy') {
      return 'This palm was enrolled under the previous template format, which the current scanner cannot read — a one-time palm re-scan is needed (Registry → Add Angles re-banks it). Nothing else about this person has changed.';
    }
    return 'No usable palmprint enrolled for this person - the stored palmprint data is missing or invalid.';
  }

  /* ================= v51: hand separation =======================
     Ordered 2026-11-24: the Chairman tests alone (his brother is
     not always available), so his RIGHT hand must function as an
     independent second identity ("Samir") for verification tests,
     penetration tests and fine-tuning. Before v51 that was
     impossible: every probe is also scored as its mirror twin
     (the twin exists because front- and back-camera captures of
     the SAME palm are mirror images — see palmprintProbePacked),
     and a person's two hands are near-mirror images, so the
     right palm matched the left palm's enrolment and the two
     accounts collapsed into one identity.

     v51 makes the hand part of the identity:
       - enrolment and top-up record the palm's ANATOMICAL hand
         on the profile (profile.hand: 'left' | 'right' | null);
       - when the probe's hand and a profile's hand are BOTH
         known and DIFFER, that profile is not a candidate at
         all — excluded from 1:1 verify, from 1:N candidacy,
         from the banking guard and from the impostor-max —
         regardless of what the mirror twin would score;
       - the twin itself is unchanged and keeps its purpose:
         front/back camera tolerance for the SAME hand. It is
         scored only inside a comparison the gate lets through
         (same hand, or either hand unknown), which is exactly
         the scoping the gate provides;
       - a profile with hand = null (every pre-v51 profile) and
         a probe whose hand cannot be determined both behave
         EXACTLY as v50 — no exclusion, twin allowed. The first
         guarded top-up that passes stamps a null-hand profile
         with the capture's hand (app.js).

     THE HANDEDNESS CONVENTION (palmAnatomicalHand). Landmarks
     are MediaPipe's 21 points in image space (x right, y down,
     normalised). Take the signed area of the knuckle triangle
     wrist(0) -> index-MCP(5) -> pinky-MCP(17):

       cross = (I - W) x (P - W)   (z-component)

     For a PALM-FACING presentation (the palmar side toward the
     camera — the only presentation this app enrols or matches:
     the ROI, the encoder and the quality gates all read the
     palm) in an UNMIRRORED image (a back-camera frame), the
     anatomy reads directly:
       cross < 0  ->  RIGHT hand   (index side sits image-right
                                    of the pinky side: the thumb
                                    of a right palm facing you
                                    appears on your right)
       cross > 0  ->  LEFT hand
     A FRONT-camera frame is the mirror image of the back-camera
     frame of the same presentation (the app's standing measured
     fact — it is why the mirror twin exists), so for facing
     'user' the reading flips. A DORSAL presentation (back of
     the hand toward the camera) would also flip the reading;
     it is out of scope by construction — a dorsal presentation
     yields no palmprint ROI and can neither enrol nor match —
     and the fixtures pin that property so it is known, not
     discovered. In-plane rotation preserves the sign (rotation
     preserves signed area); foreshortening shrinks |cross| but
     cannot flip it short of folding the hand flat, so the
     reading is stable across the presentations the app accepts.

     CONFIDENCE: the reading is null (unknown — v50 behaviour)
     when the landmarks are missing/degenerate, when the facing
     is not reported, or when |cross| is within the noise band
     of the knuckle span (HAND_CROSS_MIN_RATIO of span^2): a
     frame too poor to read chirality from must not exclude
     anyone. How often real scans land in that band is exactly
     what the Field Test handGate records (app.js) will show. */
  var HAND_CROSS_MIN_RATIO = 0.08; // |cross| below this x span^2 = chirality unreadable
  function palmAnatomicalHand(landmarks, facing) {
    if (facing !== 'user' && facing !== 'environment') return null;
    if (!landmarks || landmarks.length !== 21) return null;
    var w = landmarks[0], ix = landmarks[5], pk = landmarks[17];
    if (!w || !ix || !pk) return null;
    var wx = Number(w.x), wy = Number(w.y), ixX = Number(ix.x), ixY = Number(ix.y), pkX = Number(pk.x), pkY = Number(pk.y);
    if (!isFinite(wx) || !isFinite(wy) || !isFinite(ixX) || !isFinite(ixY) || !isFinite(pkX) || !isFinite(pkY)) return null;
    var span = Math.hypot(pkX - ixX, pkY - ixY);
    if (!(span > 0.02)) return null;
    var cross = (ixX - wx) * (pkY - wy) - (ixY - wy) * (pkX - wx);
    if (Math.abs(cross) < HAND_CROSS_MIN_RATIO * span * span) return null;
    var imageHand = cross < 0 ? 'right' : 'left';
    if (facing === 'user') return imageHand === 'right' ? 'left' : 'right';
    return imageHand;
  }
  /* MediaPipe's own handedness label as a CROSS-CHECK only (the
     geometric reading above is the definition; this never gates
     anything). MediaPipe computes its label assuming the input
     image is a mirrored selfie view: a front-camera raw frame
     is such an image, so for facing 'user' the label is already
     anatomical; a back-camera frame is unmirrored, so the label
     is the opposite of anatomical there. Anything unrecognised
     reads null. */
  function palmMpHandedness(label, facing) {
    if (label !== 'Left' && label !== 'Right') return null;
    if (facing !== 'user' && facing !== 'environment') return null;
    var anatomical = label.toLowerCase();
    if (facing === 'environment') anatomical = anatomical === 'left' ? 'right' : 'left';
    return anatomical;
  }
  /* The hand a stored profile carries: 'left' | 'right', or
     null when the profile predates v51 (or its capture could
     not determine one) — null always means "no hand evidence",
     never a third hand. */
  function palmProfileHand(stored) {
    if (!stored || typeof stored !== 'object') return null;
    return (stored.hand === 'left' || stored.hand === 'right') ? stored.hand : null;
  }
  /* THE GATE: true exactly when both hands are known and they
     differ. Any unknown side makes the comparison hand-blind,
     which is the v50 behaviour. */
  function handGateBlocks(probeHand, profileHand) {
    var a = (probeHand === 'left' || probeHand === 'right') ? probeHand : null;
    var b = (profileHand === 'left' || profileHand === 'right') ? profileHand : null;
    return !!(a && b && a !== b);
  }
  /* A scan's probe hand from its frames' individual readings:
     the strict majority of the KNOWN readings, or null when
     there are none or the known readings tie — a scan that
     cannot agree with itself about the hand excludes nobody. */
  function palmConsensusHand(hands) {
    var l = 0, r = 0;
    (hands || []).forEach(function (h) {
      if (h === 'left') l++;
      else if (h === 'right') r++;
    });
    if (l === r) return null;
    return l > r ? 'left' : 'right';
  }

  /* The verify result for a completed comparison (shared by every
     palmprint verify path so the object shape never drifts). */
  function palmprintMatchResult(best) {
    var verified = best >= PALMPRINT_THRESHOLD;
    return {
      ok: true, verified: verified, similarity: best, threshold: PALMPRINT_THRESHOLD,
      reason: verified ? 'Palmprint code matches the enrolled palm.' : 'Palmprint similarity below threshold - not the enrolled palm.'
    };
  }

  /* The packed judgement core (v45): score every packed probe
     against every packed enrolled template with the 5-shift
     early-exit matcher; the person's score is the best pair —
     score-level MAX fusion over individual templates, as since
     v33, but over the spec's matcher instead of the retired
     25-shift + geometric-variant expansion. opts.exhaustive
     disables the early exit and attaches the per-shift log
     (Field Test Mode's benchmarking toggle). Assumes `profile`
     came from normalisePalmprintProfile and `probes` are sane
     packed words. */
  function palmprintMatchPackedProfile(profile, probes, opts) {
    var best = null;
    var shiftLog = (opts && opts.exhaustive) ? [] : null;
    for (var i = 0; i < profile.codes.length; i++) for (var j = 0; j < probes.length; j++) {
      var m = palmprintPackedMatchWords(profile.codes[i], probes[j], opts);
      if (!m || m.score === null || !isFinite(m.score)) return null;
      if (shiftLog && m.perShift) {
        for (var k = 0; k < m.perShift.length; k++) {
          shiftLog.push({ enrolled: i, probe: j, dx: m.perShift[k].dx, dy: m.perShift[k].dy, score: m.perShift[k].score });
        }
      }
      if (best === null || m.score > best) best = m.score;
    }
    if (best === null) return null;
    var r = palmprintMatchResult(best);
    if (shiftLog) r.shiftLog = shiftLog;
    return r;
  }
  /* Verify packed probes against a stored profile — the shared
     entry every v45 judgement path funnels through. Fail closed
     on any missing or degenerate data, with the legacy reason
     stated for pre-v45 profiles. */
  function verifyPackedProbes(stored, probes, opts) {
    var fail = function (reason, similarity) {
      return { ok: false, verified: false, similarity: similarity, threshold: PALMPRINT_THRESHOLD, reason: reason };
    };
    var profile = normalisePalmprintProfile(stored);
    if (!profile) return fail(palmprintProfileFailReason(stored), null);
    // v51 HAND GATE: when the probe's hand (opts.probeHand) and
    // this profile's recorded hand are both known and differ,
    // the profile is not a candidate at all — the judgement is
    // "excluded", returned before any template is scored, so
    // the mirror twin never gets the chance to collapse the
    // two hands into one identity. The result is a completed
    // judgement (ok: true) that verifies nothing and carries
    // no similarity: gated profiles contribute nothing to a
    // best-score pick or an impostor-max. Either hand unknown
    // => no gate, exactly the v50 behaviour.
    if (opts && opts.probeHand) {
      var profHand = palmProfileHand(stored);
      if (handGateBlocks(opts.probeHand, profHand)) {
        return {
          ok: true, verified: false, similarity: null, threshold: PALMPRINT_THRESHOLD,
          handGate: true, probeHand: opts.probeHand, profileHand: profHand,
          reason: 'Hand gate: the scanned palm is the ' + opts.probeHand + ' hand, but this profile enrolled the ' + profHand + ' hand — the other hand is a different identity, so this profile was excluded without scoring.'
        };
      }
    }
    var sane = [];
    (probes || []).forEach(function (w) { var words = palmprintPackedWords(w); if (words && palmprintPackedSane(words)) sane.push(words); });
    if (!sane.length) return fail('No real open palm with readable print detail was detected in this scan.', null);
    var r = palmprintMatchPackedProfile(profile, sane, opts);
    if (!r) return fail('Palmprint comparison failed.', null);
    return r;
  }
  /* Verify live EDCC codes against a stored profile: each live
     byte code (or packed template) is packed once, then judged by
     the packed core. Kept signature-compatible with the pre-v45
     path; the worker's code-pair branch uses it. */
  function verifyPalmprintProfile(stored, liveCodes, opts) {
    var probes = [];
    (liveCodes || []).forEach(function (c) {
      var w = palmprintPackedWords(c);
      if (w) { probes.push(w); return; }
      var packed = palmprintPackCode(c);
      if (packed) probes.push(packed);
    });
    return verifyPackedProbes(stored, probes, opts);
  }
  /* The live side of a v45 judgement: one warped 96x96 patch is
     encoded ONCE (plus its mirror twin, for front/back camera
     presentations — the spec is silent on mirroring, so the
     long-standing twin is kept) and packed. No shift re-encodes,
     no geometric variants: the affine warp is the alignment, the
     5-shift matcher is the tolerance. */
  function palmprintProbePacked(roi) {
    if (!roi || roi.length !== PALMPRINT_ROI_SIZE * PALMPRINT_ROI_SIZE) return [];
    var out = [];
    var code = palmprintEncode(roi, PALMPRINT_ROI_SIZE, PALMPRINT_ROI_SIZE);
    if (code && palmprintCodeSane(code)) { var p = palmprintPackCode(code); if (p) out.push(p); }
    var flipped = flipGrayHorizontal(roi, PALMPRINT_ROI_SIZE, PALMPRINT_ROI_SIZE);
    if (flipped) {
      var codeM = palmprintEncode(flipped, PALMPRINT_ROI_SIZE, PALMPRINT_ROI_SIZE);
      if (codeM && palmprintCodeSane(codeM)) { var pm = palmprintPackCode(codeM); if (pm) out.push(pm); }
    }
    return out;
  }

  /* v45 verification — the spec's 1-snap judgement: each live
     ROI is encoded once (plus its mirror twin) into packed
     templates, and every probe is scored against every INDIVIDUAL
     enrolled template with the 5-shift early-exit popcount
     matcher; the person's score is the single best pair. This is
     the exact path: every pair is judged (the early exit lives
     inside each pair's shift search, exactly as the spec writes
     it). Fail closed on any missing or degenerate data, with the
     legacy re-scan reason for pre-v45 profiles. */
  function verifyPalmprintRois(stored, liveRois, opts) {
    var probes = [];
    (liveRois || []).forEach(function (roi) {
      palmprintProbePacked(roi).forEach(function (p) { probes.push(p); });
    });
    return verifyPackedProbes(stored, probes, opts);
  }

  /* v45 fast streaming verify — the SAME judgement as
     verifyPalmprintRois (same probes, same matcher, same best
     pair), organised for the per-frame Show & Pay call and
     carrying the scan-diagnostics timing sink the app renders
     (opts.timing: baseMs = probe encode+pack time, matchMs =
     packed matching time, baseEncodes = probe encodes produced;
     the geometric-variant fields stay zero — that expansion no
     longer exists). opts.geoFloor is accepted and ignored: the
     v44 band gate belonged to the retired geometric set. */
  function verifyPalmprintRoisFast(stored, liveRois, opts) {
    var tm = opts && opts.timing ? opts.timing : null;
    if (tm) { tm.baseMs = tm.baseMs || 0; tm.geoMs = tm.geoMs || 0; tm.matchMs = tm.matchMs || 0; tm.baseEncodes = tm.baseEncodes || 0; tm.geoEncodes = tm.geoEncodes || 0; }
    var nowMs = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
      ? function () { return performance.now(); } : function () { return Date.now(); };
    var t0 = tm ? nowMs() : 0;
    var probes = [];
    (liveRois || []).forEach(function (roi) {
      var ps = palmprintProbePacked(roi);
      if (tm) tm.baseEncodes += ps.length;
      ps.forEach(function (p) { probes.push(p); });
    });
    if (tm) tm.baseMs += nowMs() - t0;
    var t1 = tm ? nowMs() : 0;
    var r = verifyPackedProbes(stored, probes, opts);
    if (tm) tm.matchMs += nowMs() - t1;
    return r;
  }

  /* v45 multi-profile composition (wallet identification + the
     impostor-max diagnostic): the probe templates are encoded
     once and scored against every profile — each result is
     exactly that profile's verifyPalmprintRois result over the
     shared probe set. opts.timing fills the same diagnostics
     sink as the fast path. */
  function verifyPalmprintProfilesRois(profiles, liveRois, opts) {
    var tm = opts && opts.timing ? opts.timing : null;
    if (tm) { tm.baseMs = tm.baseMs || 0; tm.geoMs = tm.geoMs || 0; tm.matchMs = tm.matchMs || 0; tm.baseEncodes = tm.baseEncodes || 0; tm.geoEncodes = tm.geoEncodes || 0; }
    var nowMs = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
      ? function () { return performance.now(); } : function () { return Date.now(); };
    var t0 = tm ? nowMs() : 0;
    var probes = [];
    (liveRois || []).forEach(function (roi) {
      var ps = palmprintProbePacked(roi);
      if (tm) tm.baseEncodes += ps.length;
      ps.forEach(function (p) { probes.push(p); });
    });
    if (tm) tm.baseMs += nowMs() - t0;
    var t1 = tm ? nowMs() : 0;
    var results = (profiles || []).map(function (p) { return verifyPackedProbes(p, probes, opts); });
    if (tm) tm.matchMs += nowMs() - t1;
    return results;
  }

  /* Clip frames for the palmprint path carry { openness, code,
     sharpness }. A frame counts only when the hand is open AND its
     code carries real print detail. */
  function palmprintUsableOpenFrames(frames, minOpen) {
    var gate = typeof minOpen === 'number' ? minOpen : PALM_OPEN_MIN;
    var out = [];
    (frames || []).forEach(function (f, i) {
      if (f && typeof f.openness === 'number' && isFinite(f.openness) && f.openness >= gate && palmprintCodeSane(f.code)) {
        out.push({ index: i, openness: f.openness, code: palmprintCodeBytes(f.code), codeM: (f.codeM && palmprintCodeSane(f.codeM)) ? palmprintCodeBytes(f.codeM) : null, roi: (f.roi && f.roi.length === PALMPRINT_ROI_SIZE * PALMPRINT_ROI_SIZE) ? f.roi : null, sharpness: f.sharpness || 0, poseTag: (typeof f.poseTag === 'string') ? f.poseTag : null, poseDesc: (f.poseDesc && typeof f.poseDesc === 'object') ? f.poseDesc : null });
      }
    });
    return out;
  }
  // Enrolment: up to 3 codes, sharpest usable frame in each third of
  // the clip (natural pose variation), returned as base64 strings.
  /* Majority fusion of aligned palmprint codes (v29): for each code
     byte (a packed direction pair), the consensus takes the value
     most input codes carry at that position; ties keep the earliest
     (sharpest) code's value. Inputs are warp-aligned codes of the
     same palm, so positions correspond. Session noise - lighting,
     landmark jitter, phone camera processing - flips individual
     positions from capture to capture; the values the frames agree
     on are the palm's stable print. */
  function palmprintConsensusCode(codes) {
    var byteSets = (codes || []).map(palmprintCodeBytes).filter(function (b) { return !!b; });
    if (byteSets.length < 2) return null;
    var len = byteSets[0].length;
    for (var i = 1; i < byteSets.length; i++) if (byteSets[i].length !== len) return null;
    var out = new Uint8Array(len);
    var n = byteSets.length;
    for (var idx = 0; idx < len; idx++) {
      var counts = {}, bestVal = byteSets[0][idx], bestCount = 0;
      for (var k = 0; k < n; k++) {
        var v = byteSets[k][idx];
        counts[v] = (counts[v] || 0) + 1;
        if (counts[v] > bestCount) { bestCount = counts[v]; bestVal = v; }
      }
      out[idx] = bestVal;
    }
    return out;
  }
  /* v45: profile banking IS the spec's burst banking — the
     sharpest usable fully-open frame per time-third of the burst,
     encoded and bit-packed (selectPalmprintBurstCodes). This
     helper keeps its long-standing name/shape (frames in, stored
     codes out, null when nothing bankable) so every caller banks
     the current format; the v43 byte-code selection it replaces
     survives only inside palmprintPackedCandidates' pose pick,
     which selects FRAMES by pose and packs them there. */
  function selectPalmprintProfileCodes(frames) {
    var burst = selectPalmprintBurstCodes(frames);
    return burst ? burst.codes : null;
  }
  /* ================= v43: multi-angle enrolment ===================
     The Chairman's choice (2026-11-23): "Rebuild enrolment to capture
     my palm at many angles." The v41 diagnosis is the reason: the
     dominant genuine-reject factor is out-of-plane palm TILT — a
     profile banked from one posture in one sitting carries no code
     for the tilted presentations a hand naturally makes at payment
     time, and the probe-side geometric variants only partially
     recover them. So enrolment now banks the best sharp code per
     POSE from one continuous guided flow, and an existing profile
     can gain the missing poses later (top-up) without re-registering.

     A frame's pose is MEASURED from its landmarks (palmPoseTag),
     never merely assumed from the prompt on screen: the prompts
     guide the user, the classifier decides what was actually
     presented. The descriptor is the presentation geometry the warp
     cannot normalise away: fore (projected wrist -> middle-MCP
     length over knuckle span — out-of-plane tilt foreshortens it),
     ang (signed knuckle-line angle in the image plane), span
     (knuckle span, normalised frame coords — the distance axis),
     zm (mean MCP depth minus wrist depth, MediaPipe z; its sign
     splits tilt toward the camera from tilt away when the sensor
     reports it, and the tag falls back to tiltAway — the common
     payment presentation — when it does not).

     Measured fixture bands behind the bars below (v43 probe,
     2026-11-23, the v41 fixture family): same-presentation adjacent
     captures score ~0.61 against each other; a flat code scores
     0.218 against the av=0.85 tilted capture, 0.55 against a
     15-degree in-plane rotation, 0.61-0.63 against a distance
     change. Code similarity therefore CANNOT certify pose diversity
     on its own — the descriptor is the diversity axis, and
     similarity is used only where it is decisive: >= 0.95 is a
     literal re-capture of the same frame's code, and >= 0.55 (the
     redundancy bar) marks the most-redundant pair when a full
     profile must make room. Both limits are stated in the v43
     report; the field test remains the real-world judge. */
  var PALMPRINT_PROFILE_MAX_CODES = 6; // the store cap the v16/v30 selectors already bank to
  var PALMPRINT_POSES = [
    { id: 'flat', label: 'Flat', prompt: 'Hold your palm flat, facing the camera, fingers spread.' },
    { id: 'tiltAway', label: 'Tilted away', prompt: 'Now tilt the top of your palm slightly away from the camera, fingers pointing a little away — palm still open.' },
    { id: 'tiltToward', label: 'Tilted toward', prompt: 'Now tilt the top of your palm slightly toward the camera — palm still open.' },
    { id: 'angleLeft', label: 'Angled left', prompt: 'Now angle your hand to the left, palm still open and facing the camera.' },
    { id: 'angleRight', label: 'Angled right', prompt: 'Now angle your hand to the right, palm still open and facing the camera.' },
    { id: 'distance', label: 'Different distance', prompt: 'Now move your palm a little farther from the camera — or closer, if you started far — palm still open.' }
  ];
  var PALMPRINT_POSE_IDS = {};
  PALMPRINT_POSES.forEach(function (p) { PALMPRINT_POSE_IDS[p.id] = true; });
  var POSE_DUP_SIM = 0.95;        // at/above this, two codes are the same capture re-banked
  var POSE_REDUNDANT_SIM = 0.55;  // at/above this, a pair is the most-redundant in a full profile
  var POSE_DESC_EPS = { fore: 0.04, ang: 5, span: 0.05 }; // same-presentation descriptor window

  function palmPoseDescriptor(landmarks) {
    if (!landmarks || landmarks.length !== 21) return null;
    var pts = [];
    for (var i = 0; i < 21; i++) {
      var p = landmarks[i];
      if (!p || !isFinite(Number(p.x)) || !isFinite(Number(p.y))) return null;
      pts.push({ x: Number(p.x), y: Number(p.y), z: isFinite(Number(p.z)) ? Number(p.z) : null });
    }
    function dist(a, b) { return Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y); }
    var span = dist(5, 17);
    if (!(span > 0.02)) return null;
    var fore = dist(0, 9) / span;
    var ang = Math.atan2(pts[17].y - pts[5].y, pts[17].x - pts[5].x) * 180 / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    var zm = null;
    var zs = [pts[5].z, pts[9].z, pts[13].z, pts[17].z, pts[0].z];
    if (zs.every(function (z) { return z !== null; })) {
      zm = (zs[0] + zs[1] + zs[2] + zs[3]) / 4 - zs[4];
    }
    return { fore: fore, ang: ang, span: span, zm: zm };
  }
  /* Classify a presentation against the session's flat baseline
     (ref = a palmPoseDescriptor of an early flat frame, or null
     before one exists — without a baseline, tilt and distance are
     not measurable and the frame reads 'flat' or an angle pose).
     Priority follows the diagnosis ranking: out-of-plane tilt
     first, then in-plane angle, then distance. The angle sign is
     the image-plane rotation of the knuckle line (index -> pinky);
     left/right are nominal — a front camera and a back camera
     mirror the user's own left/right, and the banking diversity
     does not depend on the label's handedness. */
  function palmPoseTag(landmarks, ref) {
    var d = palmPoseDescriptor(landmarks);
    if (!d) return null;
    if (ref && isFinite(ref.fore) && d.fore <= ref.fore * 0.92) {
      return (d.zm !== null && d.zm <= -0.015) ? 'tiltToward' : 'tiltAway';
    }
    if (d.ang >= 12) return 'angleRight';
    if (d.ang <= -12) return 'angleLeft';
    if (ref && isFinite(ref.span) && (d.span <= ref.span * 0.85 || d.span >= ref.span * 1.18)) return 'distance';
    return 'flat';
  }
  /* Two descriptors describe the same presentation when every axis
     sits inside its window — such codes cover the same geometry
     and banking both adds no range. */
  function palmPoseDescriptorsClose(a, b) {
    if (!a || !b) return false;
    return Math.abs(a.fore - b.fore) <= POSE_DESC_EPS.fore &&
      Math.abs(a.ang - b.ang) <= POSE_DESC_EPS.ang &&
      Math.abs(a.span - b.span) <= POSE_DESC_EPS.span;
  }
  /* Guided-enrolment selection: the sharpest usable fully-open
     frame per measured pose, in PALMPRINT_POSES order. A pose set
     counts only when the flat pose is banked and at least three
     poses are covered — anything less is the single-posture
     profile this rebuild exists to replace, and the caller falls
     back to selectPalmprintProfileCodes. Returns
     { codes (base64), poses (descriptor per code), tags } or null. */
  function selectPalmprintPoseCodes(frames) {
    var usable = palmprintUsableOpenFrames(frames);
    var byPose = {};
    usable.forEach(function (u) {
      if (!u.poseTag || !PALMPRINT_POSE_IDS[u.poseTag]) return;
      if (!byPose[u.poseTag] || u.sharpness > byPose[u.poseTag].sharpness) byPose[u.poseTag] = u;
    });
    var covered = PALMPRINT_POSES.map(function (p) { return p.id; }).filter(function (id) { return !!byPose[id]; });
    if (covered.indexOf('flat') === -1 || covered.length < 3) return null;
    var codes = [], poses = [];
    for (var i = 0; i < covered.length; i++) {
      var b64 = palmprintCodeToBase64(byPose[covered[i]].code);
      if (b64 === null) return null;
      codes.push(b64);
      poses.push(byPose[covered[i]].poseDesc || null);
    }
    return { codes: codes, poses: poses, tags: covered };
  }
  /* The victim when a full profile must make room: a code whose
     presentation another retained code already covers (descriptor
     window), else the later member of the pair with the highest
     mutual similarity at/above the redundancy bar. -1 when every
     banked code covers distinct geometry — nothing is replaceable
     and a new candidate must be skipped instead. */
  function palmprintRedundantVictim(bytes, poses) {
    var i, j, s;
    for (i = 0; i < bytes.length; i++) for (j = i + 1; j < bytes.length; j++) {
      if (poses[i] && poses[j] && palmPoseDescriptorsClose(poses[i], poses[j])) return j;
    }
    var bestSim = POSE_REDUNDANT_SIM, victim = -1;
    for (i = 0; i < bytes.length; i++) for (j = i + 1; j < bytes.length; j++) {
      s = palmprintSimilarity(bytes[i], bytes[j]);
      if (s !== null && isFinite(s) && s >= bestSim) { bestSim = s; victim = j; }
    }
    return victim;
  }
  /* v45 Add Angles candidates: the session's diverse sharp
     templates, in the packed format. Diversity comes first from
     the measured-pose selection (the sharpest fully-open frame
     per presented pose, packed); when no pose set banked, the
     burst selection (sharpest per time-third) is the candidate
     set. Returns { list: [{ b64, words, desc }], poseSet }. */
  function palmprintPackedCandidates(frames) {
    var list = [];
    var sel = selectPalmprintPoseCodes(frames);
    if (sel) {
      sel.codes.forEach(function (b64, i) {
        var packed = palmprintPackCode(b64);
        var packedB64 = packed && palmprintPackedToBase64(packed);
        if (packed && packedB64) list.push({ b64: packedB64, words: packed, desc: sel.poses[i] || null });
      });
      return { list: list, poseSet: list.length > 0 };
    }
    var burst = selectPalmprintBurstCodes(frames);
    if (burst) {
      burst.codes.forEach(function (b64) {
        var words = palmprintPackedWords(b64);
        if (words) list.push({ b64: b64, words: words, desc: null });
      });
    }
    return { list: list, poseSet: false };
  }
  /* The packed counterpart of palmprintRedundantVictim: same
     rule (descriptor-covered pair first, else the most similar
     pair at/above the redundancy bar), judged by the packed
     matcher. */
  function palmprintRedundantVictimPacked(wordsList, poses) {
    var i, j, s;
    for (i = 0; i < wordsList.length; i++) for (j = i + 1; j < wordsList.length; j++) {
      if (poses[i] && poses[j] && palmPoseDescriptorsClose(poses[i], poses[j])) return j;
    }
    var bestSim = POSE_REDUNDANT_SIM, victim = -1;
    for (i = 0; i < wordsList.length; i++) for (j = i + 1; j < wordsList.length; j++) {
      s = palmprintPackedSimilarity(wordsList[i], wordsList[j], { exhaustive: true });
      if (s !== null && isFinite(s) && s >= bestSim) { bestSim = s; victim = j; }
    }
    return victim;
  }
  /* Add-angles top-up (v43; v45 packed): merge a session's diverse
     sharp templates into an EXISTING profile, in the packed store.
     The stored templates are carried verbatim (the same base64
     strings, never re-encoded); the caller's person object is not
     touched — identity, Biom ID, wallet and points live outside
     this function and outside its result. A candidate is skipped
     when it adds no range: a literal re-capture (packed similarity
     >= POSE_DUP_SIM against any banked template) or a presentation
     a banked template's descriptor already covers. Under the cap,
     diverse candidates append. At the cap, a diverse candidate
     replaces only a redundant template; when nothing is redundant
     it is skipped and the profile stands. One floor always holds:
     at least two of the templates stored BEFORE the merge survive
     it — the stored enrolment is the identity anchor, and a top-up
     widens it, it does not re-found it.
     LEGACY profiles (v3 byte codes, flagged by the v45 migration):
     the merge IS the re-scan — the session's packed candidates
     become the profile's templates and the legacy flag clears.
     The old codes stay archived in the person record (the
     migration's legacyCodes field); they are never read by this
     pipeline. Returns { codes, poses, added, replaced, skipped,
     changed, poseSet, format, legacy, rebanked } or null when the
     stored profile is neither a sane packed profile nor a legacy
     one. */
  function mergePalmprintProfileCodes(profile, frames) {
    var format = palmprintProfileFormat(profile);
    if (!format) return null;
    var cand = palmprintPackedCandidates(frames);
    if (format === 'legacy') {
      if (!cand.list.length) {
        return { codes: profile.codes.slice(), poses: [], added: 0, replaced: 0, skipped: 0, changed: false, poseSet: cand.poseSet, format: 'legacy', legacy: true, rebanked: false };
      }
      var kept = cand.list.slice(0, PALMPRINT_PROFILE_MAX_CODES);
      return {
        codes: kept.map(function (c) { return c.b64; }),
        poses: kept.map(function (c) { return c.desc; }),
        added: kept.length, replaced: 0, skipped: cand.list.length - kept.length,
        changed: true, poseSet: cand.poseSet, format: PALMPRINT_FORMAT, legacy: true, rebanked: true
      };
    }
    var norm = normalisePalmprintProfile(profile);
    if (!norm) return null;
    var codes = profile.codes.slice();
    var wordsList = norm.codes.slice();
    var maxReplace = Math.max(0, codes.length - 2); // the retained-originals floor above
    var poses = [];
    for (var i = 0; i < codes.length; i++) {
      poses.push((Array.isArray(profile.poses) && profile.poses[i] && typeof profile.poses[i] === 'object') ? profile.poses[i] : null);
    }
    var out = { codes: codes, poses: poses, added: 0, replaced: 0, skipped: 0, changed: false, poseSet: cand.poseSet, format: PALMPRINT_FORMAT, legacy: false, rebanked: false };
    if (!cand.list.length) return out;
    cand.list.forEach(function (candItem) {
      var dup = false;
      for (var k = 0; k < wordsList.length; k++) {
        var s = palmprintPackedSimilarity(wordsList[k], candItem.words, { exhaustive: true });
        if (s !== null && isFinite(s) && s >= POSE_DUP_SIM) { dup = true; break; }
        if (candItem.desc && poses[k] && palmPoseDescriptorsClose(candItem.desc, poses[k])) { dup = true; break; }
      }
      if (dup) { out.skipped++; return; }
      if (wordsList.length < PALMPRINT_PROFILE_MAX_CODES) {
        codes.push(candItem.b64); wordsList.push(candItem.words); poses.push(candItem.desc);
        out.added++;
        return;
      }
      if (out.replaced >= maxReplace) { out.skipped++; return; }
      var victim = palmprintRedundantVictimPacked(wordsList, poses);
      if (victim === -1) { out.skipped++; return; }
      codes[victim] = candItem.b64; wordsList[victim] = candItem.words; poses[victim] = candItem.desc;
      out.replaced++;
    });
    out.codes = codes; out.poses = poses;
    out.changed = (out.added + out.replaced) > 0;
    return out;
  }

  /* ================= v43: live guidance pill ======================
     One concise status line for a scan view, mapped from the
     quality signals the pipelines already compute: the framing
     hint (hand cut off / too close / too far), the spoof sample's
     mean luma and glare fraction, openness, and the palm crop's
     sharpness. GUIDANCE ONLY — this function gates nothing; every
     rejection still comes from the gates that already exist.
     Bars: mean luma < 45 reads "too dark" (the spec's figure, and
     the spoof tracker's own 'dim' tag starts far above it); glare
     fraction > 0.15 of pixels blown out; sharpness is the
     laplacian variance palmFrameMeasures reports — measured on
     the fixture palms at 320-530 sharp, 62-93 after one 3x3 box
     blur and ~31 after two, so the bar sits at 100: under every
     sharp capture measured, over every blurred one. The line is
     advice only; a soft frame is never rejected for it.
     Returns a string, or null when the frame is clean and stable
     (the caller then shows its own scanning text). */
  var PALM_GUIDANCE_DARK_LUMA = 45;
  var PALM_GUIDANCE_GLARE_FRAC = 0.15;
  var PALM_GUIDANCE_BLUR = 100;
  function palmGuidance(info) {
    if (!info || !info.hasHand) return 'Show an open hand to the camera';
    // v53: the frame-completeness judgement (palmFrameCompleteness)
    // outranks the framing-hint mapping — a cropped or too-close
    // hand gets the one instruction that fixes it, in the words
    // the Chairman approved. Callers that pass no frameIssue (and
    // every pre-v53 fixture) see exactly the mapping below.
    if (info.frameIssue === 'cropped' || info.frameIssue === 'tooClose') return 'Move back — fit your whole palm in the frame';
    if (info.frameIssue === 'tooFar') return 'Move a little closer';
    if (info.framing) {
      var f = String(info.framing);
      if (f.indexOf('Whole hand in view') === 0) return 'Whole hand in view — move back a little';
      if (f.indexOf('Too close') === 0) return 'Move a little farther';
      if (f.indexOf('Move the palm a little closer') === 0) return 'Move slightly closer';
      return f;
    }
    if (typeof info.meanLuma === 'number' && isFinite(info.meanLuma) && info.meanLuma < PALM_GUIDANCE_DARK_LUMA) {
      return 'Too dark — turn on Flash';
    }
    if (typeof info.glareFrac === 'number' && isFinite(info.glareFrac) && info.glareFrac > PALM_GUIDANCE_GLARE_FRAC) {
      return 'Too much glare — angle the hand slightly';
    }
    if (typeof info.openness === 'number' && isFinite(info.openness) && info.openness < PALM_LIVE_OPEN_MIN) {
      return 'Hold open hand naturally — fingers spread';
    }
    if (typeof info.sharpness === 'number' && isFinite(info.sharpness) && info.sharpness > 0 && info.sharpness < PALM_GUIDANCE_BLUR) {
      return 'Hold steady — the image is blurred';
    }
    return info.stable ? null : 'Hold steady...';
  }

  /* ================= PalmNet neural matcher (v47) =================
     A SECOND palmprint matcher alongside EDCC, added 2026-11-24
     after PalmNet-Bench proved a trained neural embedding beats the
     EDCC encoder on identical EVAL inputs — above all under palm
     tilt, EDCC's known failure mode (bench report:
     ~/workspace/palmnet-bench/results.md, verified 20/20).

     The model: MobileNetV3-Small, full fine-tune with an ArcFace
     head, trained fresh on the Tongji Contactless Palmprint
     dataset (480 TRAIN palms; 9,600 unique real training images,
     153,600 augmented samples seen). Input: a 128x128 grayscale
     palm ROI. Output: a 256-d L2-normalised embedding; identity
     score = cosine similarity between embeddings.

     This section is the PURE half — preprocessing, the embedding
     codec, profile banking and the fused decision — so Node tests
     exercise exactly what the app runs. The runtime half (ONNX
     Runtime Web, the model bytes, the worker) lives in app.js
     (PalmNet) and FAILS SOFT: when it cannot load or run, every
     function here simply sees no neural evidence and the app
     behaves exactly as v46 — EDCC only.

     PREPROCESSING PARITY (the correctness gate): the bench's eval
     chain (code/04_eval_export.py load_raw, mirroring 03_train.py
     eval_tf) is: 128x128 grayscale uint8 -> /255 -> repeat to 3
     channels -> per-channel normalise (x - MEAN) / STD with the
     ImageNet MEAN/STD below. palmnetPreprocessRoi replicates it
     exactly. The app's v45 pipeline produces a 96x96 affine-warped
     ROI; the neural path resamples that same ROI to the model's
     128x128 contract with the codebase's bilinear resampler
     (resizeGrayBilinear, half-pixel centres — the same discipline
     PIL's BILINEAR resize uses; the parity suite in
     tests/v47-parity.test.js proves both the identity-size path
     and the 96->128 path against the Python pipeline).

     DECISION RULE (decision-level fusion, each system at its own
     calibrated bar): a palm verifies when EDCC similarity >= 0.32
     (the standing bar, NEVER lowered) OR the PalmNet cosine >=
     PALMNET_THRESHOLD. The EDCC path is untouched: every EDCC
     function above behaves exactly as in v46, and a profile with
     no banked neural embeddings verifies EDCC-only, exactly as
     before.

     PALMNET_THRESHOLD = 0.5773 — SOURCE: the EER threshold of the
     PalmNet-Bench EVAL clean protocol, computed by
     code/04_eval_export.py from 360 genuine and 42,840 impostor
     cosine scores (session-1 gallery captures 1-3 averaged into
     per-palm templates; probes = captures 4-6) and saved in
     ~/workspace/palmnet-bench/logs/neural_results.json
     (clean.eer_threshold = 0.5773, EER 0.004%). Independently
     recomputed from the same EVAL scores during the v47 build —
     same number. This is a LAB-DERIVED STARTING POINT, measured
     on Tongji lab ROIs (pre-extracted, controlled), NOT a proven
     phone threshold: phone frames are a different input
     distribution, and the Field Test gate (20 people / 200 scans,
     zero false accepts) is what calibrates it for real use. The
     genuine distribution at this bar: median 0.8950, p05 0.7414,
     min 0.5773; impostor: median 0.0337, p95 0.2791, max 0.5996.

     STORAGE: embeddings live INSIDE the existing palm profile
     object as profile.neural = { v: 1, dim: 256,
     model: 'palmnet-v1', embeddings: [base64 float32 LE, ...] }.
     No store shape changes; the v47 migration step is a pure
     adoption (see the chain below) and profiles written before
     v47 simply have no .neural field — they verify EDCC-only and
     the Registry offers a "Neural scan" capture that banks
     embeddings for them. Score rule inside the neural path: MAX
     cosine over banked embeddings x probe embeddings (the same
     score-level max discipline the EDCC side adopted in v33).
     Probes are embedded in BOTH orientations (ROI + mirror twin,
     like the EDCC probe pair) because enrolment and verification
     may use different cameras; the bench augmentation had no
     mirror twin, so the twin is probe-side insurance only —
     enrolment banks the palm as captured. */
  var PALMNET_INPUT_SIZE = 128;
  var PALMNET_EMBED_DIM = 256;
  var PALMNET_THRESHOLD = 0.5773;
  var PALMNET_MEAN = [0.485, 0.456, 0.406];
  var PALMNET_STD = [0.229, 0.224, 0.225];
  var PALMNET_PROFILE_MAX_EMBEDDINGS = 6;
  var PALMNET_DEDUPE_COSINE = 0.90;

  /* The bench eval preprocessing, replicated exactly. roi is an
     array-like of grayscale values (0..255) of length size*size —
     in the app, the v45 96x96 affine ROI. Returns a Float32Array
     of 3*128*128 (channel-planar) ready for the model's 'image'
     input, or null for an unusable patch. */
  function palmnetPreprocessRoi(roi, size) {
    if (!roi || typeof size !== 'number' || !(size > 0)) return null;
    if (typeof roi.length !== 'number' || roi.length !== size * size) return null;
    var gray = roi;
    if (size !== PALMNET_INPUT_SIZE) {
      gray = resizeGrayBilinear(roi, size, size, PALMNET_INPUT_SIZE);
      if (!gray || gray.length !== PALMNET_INPUT_SIZE * PALMNET_INPUT_SIZE) return null;
    }
    var N = PALMNET_INPUT_SIZE * PALMNET_INPUT_SIZE;
    var out = new Float32Array(3 * N);
    for (var c = 0; c < 3; c++) {
      var mean = PALMNET_MEAN[c], std = PALMNET_STD[c], base = c * N;
      for (var i = 0; i < N; i++) {
        var v = Number(gray[i]);
        if (!isFinite(v)) v = 0;
        if (v < 0) v = 0; else if (v > 255) v = 255;
        out[base + i] = (v / 255 - mean) / std;
      }
    }
    return out;
  }
  /* The source bundle the app's PalmNet worker is assembled from,
     so the worker's preprocessing is THIS code — the same single
     implementation the parity suite proves against Python. */
  function palmnetPreprocessSource() {
    var consts =
      'var PALMNET_INPUT_SIZE = ' + PALMNET_INPUT_SIZE + ';\n' +
      'var PALMNET_MEAN = ' + JSON.stringify(PALMNET_MEAN) + ';\n' +
      'var PALMNET_STD = ' + JSON.stringify(PALMNET_STD) + ';\n';
    return consts +
      'var resizeGrayBilinear = ' + resizeGrayBilinear.toString() + ';\n' +
      'var palmnetPreprocessRoi = ' + palmnetPreprocessRoi.toString() + ';\n';
  }

  function palmnetNormaliseEmbedding(emb) {
    if (!emb || typeof emb.length !== 'number' || emb.length !== PALMNET_EMBED_DIM) return null;
    var norm = 0, i, v;
    for (i = 0; i < PALMNET_EMBED_DIM; i++) {
      v = Number(emb[i]);
      if (!isFinite(v)) return null;
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    if (!(norm > 1e-6)) return null;
    var out = new Float32Array(PALMNET_EMBED_DIM);
    for (i = 0; i < PALMNET_EMBED_DIM; i++) out[i] = Number(emb[i]) / norm;
    return out;
  }
  /* Sane = right dimension, all finite, and a norm in the band a
     real L2-normalised embedding lives in (the model normalises
     its output; stored copies are re-normalised on decode, so the
     band only rejects corrupt data, never a real embedding). */
  function palmnetEmbeddingSane(emb) {
    if (!emb || typeof emb.length !== 'number' || emb.length !== PALMNET_EMBED_DIM) return false;
    var norm = 0;
    for (var i = 0; i < PALMNET_EMBED_DIM; i++) {
      var v = Number(emb[i]);
      if (!isFinite(v)) return false;
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    return norm >= 0.5 && norm <= 1.5;
  }
  function palmnetCosine(a, b) {
    var na = palmnetNormaliseEmbedding(a), nb = palmnetNormaliseEmbedding(b);
    if (!na || !nb) return null;
    var s = 0;
    for (var i = 0; i < PALMNET_EMBED_DIM; i++) s += na[i] * nb[i];
    return s;
  }
  /* Embedding storage codec: base64 of the Float32 little-endian
     bytes (256 floats = 1024 bytes = 1368 base64 chars), the same
     Buffer/btoa discipline as the packed EDCC codec. */
  function palmnetEmbeddingToBase64(emb) {
    var unit = palmnetNormaliseEmbedding(emb);
    if (!unit) return null;
    var bytes = new Uint8Array(unit.buffer, unit.byteOffset, PALMNET_EMBED_DIM * 4);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return typeof btoa === 'function' ? btoa(s) : null;
  }
  function palmnetEmbeddingFromBase64(str) {
    if (typeof str !== 'string' || !str.length) return null;
    try {
      var bytes;
      if (typeof Buffer !== 'undefined') bytes = new Uint8Array(Buffer.from(str, 'base64'));
      else if (typeof atob === 'function') {
        var bin = atob(str);
        bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else return null;
      if (bytes.length !== PALMNET_EMBED_DIM * 4) return null;
      var buf = new ArrayBuffer(PALMNET_EMBED_DIM * 4);
      new Uint8Array(buf).set(bytes);
      var emb = new Float32Array(buf);
      return palmnetEmbeddingSane(emb) ? palmnetNormaliseEmbedding(emb) : null;
    } catch (e) { return null; }
  }
  /* The banked embeddings of a stored palm profile (the profile
     object itself, person.palmProfile), decoded and sane only.
     Returns an array (possibly empty) or null when the profile
     carries no neural bank at all. */
  function palmnetProfileEmbeddings(stored) {
    if (!stored || typeof stored !== 'object') return null;
    var bank = stored.neural;
    if (!bank || typeof bank !== 'object' || !Array.isArray(bank.embeddings)) return null;
    var out = [];
    bank.embeddings.forEach(function (b64) {
      var emb = palmnetEmbeddingFromBase64(b64);
      if (emb) out.push(emb);
    });
    return out.length ? out : null;
  }
  function palmnetProfileSane(stored) {
    var embs = palmnetProfileEmbeddings(stored);
    return !!(embs && embs.length);
  }
  /* A current-format (packed96) EDCC profile with sane codes but
     no sane neural bank: it verifies EDCC-only, and the Registry
     shows the "Neural scan needed" state for it. Legacy profiles
     need a full palm re-scan first, not a neural scan, so they do
     not qualify here. */
  function palmnetNeedsScan(stored) {
    if (palmprintProfileFormat(stored) !== 'packed96') return false;
    if (!stored || !Array.isArray(stored.codes) || !stored.codes.length) return false;
    return !palmnetProfileSane(stored);
  }
  /* Build the profile.neural bank object from raw embeddings
     (normalises, drops insane ones, caps the bank). */
  function palmnetBankFromEmbeddings(embeddings) {
    if (!Array.isArray(embeddings)) return null;
    var enc = [];
    embeddings.forEach(function (emb) {
      if (enc.length >= PALMNET_PROFILE_MAX_EMBEDDINGS) return;
      var b64 = palmnetEmbeddingToBase64(emb);
      if (b64) enc.push(b64);
    });
    if (!enc.length) return null;
    return { v: 1, dim: PALMNET_EMBED_DIM, model: 'palmnet-v1', embeddings: enc };
  }
  /* Merge new candidate embeddings into an existing bank (the
     Add Angles / Neural scan path): a candidate within
     PALMNET_DEDUPE_COSINE of anything already banked (or already
     accepted from this batch) is a near-duplicate and is skipped;
     the bank is capped at PALMNET_PROFILE_MAX_EMBEDDINGS. Pure:
     returns the new bank object plus counts; when nothing was
     added the returned bank is the existing object by identity. */
  function mergePalmnetEmbeddings(existingBank, candidateEmbeddings) {
    var banked = [];
    if (existingBank && typeof existingBank === 'object' && Array.isArray(existingBank.embeddings)) {
      existingBank.embeddings.forEach(function (b64) {
        var emb = palmnetEmbeddingFromBase64(b64);
        if (emb) banked.push(emb);
      });
    }
    var added = 0, skipped = 0;
    (candidateEmbeddings || []).forEach(function (cand) {
      var unit = palmnetNormaliseEmbedding(cand);
      if (!unit) { skipped++; return; }
      if (banked.length >= PALMNET_PROFILE_MAX_EMBEDDINGS) { skipped++; return; }
      var dup = false;
      for (var i = 0; i < banked.length; i++) {
        var c = palmnetCosine(banked[i], unit);
        if (c !== null && c >= PALMNET_DEDUPE_COSINE) { dup = true; break; }
      }
      if (dup) { skipped++; return; }
      banked.push(unit);
      added++;
    });
    if (!added) {
      return { neural: existingBank || null, added: 0, skipped: skipped, total: banked.length, changed: false };
    }
    return { neural: palmnetBankFromEmbeddings(banked), added: added, skipped: skipped, total: banked.length, changed: true };
  }
  /* Neural score of a probe set against banked embeddings: MAX
     cosine over banked x probes, or null when either side has no
     sane embedding (no neural evidence — never a zero, never a
     guess). */
  function palmnetScoreEmbeddings(bankedEmbeddings, probeEmbeddings) {
    if (!Array.isArray(bankedEmbeddings) || !bankedEmbeddings.length) return null;
    if (!Array.isArray(probeEmbeddings) || !probeEmbeddings.length) return null;
    var best = null;
    bankedEmbeddings.forEach(function (b) {
      probeEmbeddings.forEach(function (p) {
        var c = palmnetCosine(b, p);
        if (c !== null && (best === null || c > best)) best = c;
      });
    });
    return best;
  }
  function palmnetScoreProfile(stored, probeEmbeddings) {
    return palmnetScoreEmbeddings(palmnetProfileEmbeddings(stored), probeEmbeddings);
  }
  /* THE FUSED DECISION. Takes the EDCC result object (the
     palmprintMatchResult shape, or null) and the neural score
     (a cosine, or null when the neural path produced no evidence)
     and returns a result in the same shape, extended with the
     neural fields and acceptedBy. Rules:
       - EDCC verified (similarity >= 0.32) accepts, as always.
       - A neural score >= PALMNET_THRESHOLD accepts on its own.
       - No neural evidence (null) => the EDCC verdict stands
         alone, bit-for-bit the v46 behaviour.
     The EDCC bar is never lowered and the EDCC similarity is
     reported unchanged, so diagnostics and the Field Test record
     always show both systems' evidence. */
  function fusePalmVerifyResults(edccResult, neuralScore) {
    var edccOk = !!(edccResult && edccResult.verified === true);
    var hasNeural = typeof neuralScore === 'number' && isFinite(neuralScore);
    var neuralOk = hasNeural && neuralScore >= PALMNET_THRESHOLD;
    var acceptedBy = null;
    if (edccOk && neuralOk) acceptedBy = 'both';
    else if (edccOk) acceptedBy = 'edcc';
    else if (neuralOk) acceptedBy = 'palmnet';
    var out = {
      ok: true,
      verified: edccOk || neuralOk,
      similarity: edccResult && typeof edccResult.similarity === 'number' ? edccResult.similarity : null,
      threshold: PALMPRINT_THRESHOLD,
      neuralScore: hasNeural ? neuralScore : null,
      neuralThreshold: PALMNET_THRESHOLD,
      acceptedBy: acceptedBy,
      reason: edccResult && edccResult.reason ? edccResult.reason : 'No EDCC result.'
    };
    if (neuralOk && !edccOk) {
      out.reason = 'PalmNet neural match accepted (cosine ' + neuralScore.toFixed(3) +
        ' >= ' + PALMNET_THRESHOLD + '); EDCC similarity ' +
        (out.similarity === null ? 'n/a' : out.similarity.toFixed(3)) + ' below its 0.32 bar.';
    }
    // The Field Test exhaustive shift log rides the EDCC result;
    // carry it through so fused panels keep showing it.
    if (edccResult && Array.isArray(edccResult.shiftLog)) out.shiftLog = edccResult.shiftLog;
    return out;
  }

  /* ================= v49: money-scan strict rule + banking guard ==
     Ordered 2026-11-24 after the Add Money audit
     (AUDIT-addmoney-v48.md). Two independent routes explained how
     an unregistered palm passed a money authorisation once:
     (a) the plain fused operating point (EER bar x max-fusion x
     mirror twin x 1-snap multi-frame) admits cross-person passes,
     and (c) the banking flows (Add Angles / Neural Scan / legacy
     Re-scan) banked ANY live palm into a profile with no identity
     check. v49 answers both WITHOUT touching the plain verify /
     identify operating point:

     1. BANKING GUARD (bankingGuardCheck): before any top-up
        merge, the session's captured palm must verify against
        the profile's existing readable bank at the standard
        fused bars — EDCC >= 0.32 and/or PalmNet cosine >=
        0.5773, the same OR rule as verification. The check is
        computed offline from the session's own captured
        templates/embeddings against the stored bank; no extra
        camera session. Where NO readable bank exists (the
        legacy re-bank case: archived pre-v45 codes cannot be
        scored by the current matchers) the guard honestly
        reports 'uncheckable' and the caller proceeds — it never
        pretends to have checked.

     2. STRICT MONEY RULE (createMoneyScanGate + moneyMarginCheck):
        money authorisations (wallet Add Money, wallet Send
        Money sender authorisation, wallet open on both routes,
        terminal Biom Pay verify) additionally require
          (i) TWO-FRAME CONFIRMATION — the fused win must occur
              on at least MONEY_CONFIRM_FRAMES distinct analysed
              frames (the gate below counts distinct frame
              indices per target; the app streams own the
              counting calls), and
          (ii) THE MARGIN RULE — on the accepting system, the
              target's score must beat the best score of every
              OTHER profile (the impostor-max the scan already
              computes) by a clear margin. With no other profile
              on the device the rule is vacuously satisfied.
        Plain verify/identify keeps the v45/v47 rules exactly;
        Field Test Mode keeps measuring the PLAIN fused verdict.

     MARGIN BASIS (measured, not chosen for comfort):
       PalmNet — MONEY_MARGIN_NEURAL = 0.15. PalmNet-Bench EVAL
       (logs/neural_results.json): clean genuine p05 = 0.7414
       vs impostor p95 = 0.2791, a typical separation of ~0.46;
       under the worst measured tilt (av = 0.80) genuine p05 =
       0.4334 vs impostor p95 = 0.2544, a separation of ~0.18.
       0.15 sits just under that worst-case band, so a genuine
       palm at the 5th percentile under heavy tilt still
       typically clears it, while a palm whose best OTHER-
       profile score comes within 0.15 of its target score is
       genuinely ambiguous and must not move money.
       EDCC — MONEY_MARGIN_EDCC = 0.10. The bench EDCC numbers
       are a different operating point (consensus gallery, EER
       threshold 0.1052) and do not transfer; the app's own
       fixture bands do: genuine scores ~0.50-0.59 (v41 tilt-fix
       fixtures; v44 analysis-grid fixtures 0.499-0.511 flat)
       against an impostor maximum of ~0.15 (0.146-0.150 across
       the same fixture families) — a typical separation of
       ~0.35. 0.10 is roughly a third of that separation: a
       visible, meaningful gap that the genuine band clears
       comfortably. Both margins are LAB/RIG numbers; only the
       Field Test gate (20 people / 200 scans) can calibrate
       them for real phone use. */
  var MONEY_CONFIRM_FRAMES = 2;
  var MONEY_MARGIN_EDCC = 0.10;
  var MONEY_MARGIN_NEURAL = 0.15;

  /* The two-frame half of the strict rule, as a tiny pure gate
     so the rule itself is unit-testable without a camera: the
     app streams call noteVerified(targetKey, frameIdx) whenever
     a frame's fused decision verifies for that target (the 1:1
     stream uses one key; the identification stream uses one key
     per candidate), and confirmed(key) answers whether the win
     has landed on at least MONEY_CONFIRM_FRAMES DISTINCT
     analysed frames. Repeat notes for the same frame (a neural
     score landing after the EDCC score re-takes the same frame's
     decision) never double-count. */
  function createMoneyScanGate() {
    var framesByKey = {};
    function count(key) {
      var set = framesByKey[key];
      return set ? Object.keys(set).length : 0;
    }
    return {
      noteVerified: function (key, frameIdx) {
        if (typeof frameIdx !== 'number' || !isFinite(frameIdx)) return count(key);
        var set = framesByKey[key] || (framesByKey[key] = {});
        set[frameIdx] = true;
        return count(key);
      },
      verifiedFrames: function (key) { return count(key); },
      confirmed: function (key) { return count(key) >= MONEY_CONFIRM_FRAMES; }
    };
  }

  /* The margin half of the strict rule. `fused` is the fused
     result that verified (B.fusePalmVerifyResults shape);
     edccImpostorMax / neuralImpostorMax are the best scores the
     SAME probe achieved against every OTHER profile on each
     system (null when no other profile has a readable bank on
     that system — the margin is then vacuously satisfied for
     that system). EVERY accepting system must clear its margin:
     a palm accepted by both systems that is ambiguous on one of
     them does not authorise money. Returns
     { applied, pass, edcc, palmnet, blockers } where each
     per-system entry is { pass, score, impostorMax, margin,
     gap, vacuous } or null when that system did not accept.
     A fused result that did not verify is never passed here by
     the app; if it is, applied stays false and pass false —
     fail closed. */
  function moneyMarginCheck(fused, edccImpostorMax, neuralImpostorMax) {
    var out = { applied: false, pass: false, edcc: null, palmnet: null, blockers: [] };
    if (!fused || fused.verified !== true) return out;
    out.applied = true;
    function judge(score, impMax, margin) {
      if (typeof score !== 'number' || !isFinite(score)) {
        return { pass: false, score: null, impostorMax: null, margin: margin, gap: null, vacuous: false };
      }
      if (typeof impMax !== 'number' || !isFinite(impMax)) {
        return { pass: true, score: score, impostorMax: null, margin: margin, gap: null, vacuous: true };
      }
      var gap = score - impMax;
      return { pass: gap >= margin, score: score, impostorMax: impMax, margin: margin, gap: gap, vacuous: false };
    }
    var by = fused.acceptedBy || null;
    if (by === 'edcc' || by === 'both') {
      out.edcc = judge(fused.similarity, edccImpostorMax, MONEY_MARGIN_EDCC);
      if (!out.edcc.pass) out.blockers.push('edcc');
    }
    if (by === 'palmnet' || by === 'both') {
      out.palmnet = judge(fused.neuralScore, neuralImpostorMax, MONEY_MARGIN_NEURAL);
      if (!out.palmnet.pass) out.blockers.push('palmnet');
    }
    out.pass = out.blockers.length === 0 && (out.edcc !== null || out.palmnet !== null);
    return out;
  }

  /* The same-person guard for banking (Add Angles / Neural
     Scan / legacy Re-scan). cand = { edccProbes: [packed words
     from THIS session's captured frames], neuralEmbeddings:
     [embeddings of THIS session's captured ROIs] } — the same
     candidates the merges would bank. The stored profile is
     judged with the standard matchers at the standard bars:
       EDCC checkable  — the profile is in the current packed96
         format (its bank can be scored) and the session produced
         sane packed probes: verifyPackedProbes decides.
       Neural checkable — the profile carries a readable neural
         bank and the session produced embeddings:
         palmnetScoreEmbeddings decides against 0.5773.
     Returns { status, via, edccChecked, edccScore,
     neuralChecked, neuralScore }:
       'pass'        — at least one checkable system verified
                       (via says which: 'edcc' | 'palmnet' |
                       'both'); the same OR rule as verify.
       'fail'        — at least one system could check and NONE
                       verified: the captured palm is not this
                       profile's palm; the caller must refuse
                       the merge entirely and bank nothing.
       'uncheckable' — no system could check (legacy profile
                       whose archived codes the current matchers
                       cannot score, or a session that produced
                       no candidates for the banked systems):
                       the caller proceeds, and must say so
                       honestly wherever it describes the flow. */
  function bankingGuardCheck(profile, cand) {
    var out = { status: 'uncheckable', via: null, edccChecked: false, edccScore: null, neuralChecked: false, neuralScore: null };
    if (!profile || typeof profile !== 'object') return out;
    cand = cand || {};
    // v51 HAND GATE (see the hand-separation section above):
    // a capture whose hand is known and differs from the
    // profile's recorded hand is definitively NOT this
    // profile's palm — the guard fails it before any scoring,
    // so the mirror twin cannot bank the other hand into this
    // profile. out gains probeHand / profileHand / handGate so
    // the caller can log the deciding evidence. Either hand
    // unknown => the score-based guard below, exactly as v49.
    out.probeHand = (cand.hand === 'left' || cand.hand === 'right') ? cand.hand : null;
    out.profileHand = palmProfileHand(profile);
    out.handGate = false;
    if (handGateBlocks(out.probeHand, out.profileHand)) {
      out.status = 'fail';
      out.handGate = true;
      return out;
    }
    if (palmprintProfileFormat(profile) === 'packed96' && Array.isArray(cand.edccProbes)) {
      var sane = [];
      cand.edccProbes.forEach(function (w) {
        var words = palmprintPackedWords(w);
        if (words && palmprintPackedSane(words)) sane.push(words);
      });
      if (sane.length) {
        var r = verifyPackedProbes(profile, sane);
        if (r && r.ok === true) {
          out.edccChecked = true;
          out.edccScore = typeof r.similarity === 'number' ? r.similarity : null;
          if (r.verified === true) { out.status = 'pass'; out.via = 'edcc'; }
        }
      }
    }
    var bank = palmnetProfileEmbeddings(profile);
    if (bank && Array.isArray(cand.neuralEmbeddings) && cand.neuralEmbeddings.length) {
      var s = palmnetScoreEmbeddings(bank, cand.neuralEmbeddings);
      if (s !== null) {
        out.neuralChecked = true;
        out.neuralScore = s;
        if (s >= PALMNET_THRESHOLD) {
          if (out.status === 'pass') out.via = 'both';
          else { out.status = 'pass'; out.via = 'palmnet'; }
        }
      }
    }
    if (out.status !== 'pass' && (out.edccChecked || out.neuralChecked)) out.status = 'fail';
    return out;
  }

  /* A promise that cannot hang forever (v49 freeze-proofing):
     settles exactly as `promise` settles, or rejects with an
     ETIMEOUT error after `ms`. The underlying operation is not
     cancelled (promises cannot be) — its late settlement is
     simply ignored, so callers must treat a timeout as "the
     operation's outcome is unknown" and fail soft / fail
     visibly, never as success. app.js routes every previously
     unbounded wait through this one helper (IndexedDB requests,
     the camera start, the PalmNet main-thread runtime load) so
     the bound is a single implementation the suites exercise. */
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var to = setTimeout(function () {
        if (done) return;
        done = true;
        var err = new Error('timed out after ' + ms + ' ms');
        err.code = 'ETIMEOUT';
        reject(err);
      }, ms);
      Promise.resolve(promise).then(function (v) {
        if (done) return;
        done = true;
        clearTimeout(to);
        resolve(v);
      }, function (e) {
        if (done) return;
        done = true;
        clearTimeout(to);
        reject(e);
      });
    });
  }

  /* ================= v43: hands-free scan session ================
     The auto-trigger / cooldown state machine the scan views run
     on. Pure logic (the caller passes timestamps), so the rules
     are unit-testable without a camera:
       enter()  — a scan view mounted: the session is scanning.
                  No click arms anything; the app starts the camera
                  and the stream on this transition.
       frame()  — one analysed frame's pose: stability is landmark
                  velocity at/below velocityMax across consecutive
                  frames; 'armed' once stableFrames consecutive
                  frames (counting the first tracked frame) show a
                  present, steady hand — the auto-trigger condition
                  the spec asks for (~3 frames).
       verdict()— a terminal verdict fired: accepted only from
                  'scanning'; the session enters cooldown for
                  cooldownMs, during which verdict() refuses — one
                  presentation can never be processed twice.
       reset()  — Next Customer: back to 'scanning' instantly,
                  cooldown cleared, stability forgotten.
       leave()  — the view closed: 'idle', where verdict() refuses
                  and frame() reports unarmed.
     The session judges NO biometric evidence: verdict rules,
     thresholds and gates stay exactly where they were. */
  function createScanSession(opts) {
    opts = opts || {};
    var cooldownMs = typeof opts.cooldownMs === 'number' ? opts.cooldownMs : 1500;
    var stableFramesNeeded = typeof opts.stableFrames === 'number' ? opts.stableFrames : 3;
    var velocityMax = typeof opts.velocityMax === 'number' ? opts.velocityMax : 0.01;
    var state = 'idle';
    var stableCount = 0;
    var lastPose = null;
    var cooldownUntil = 0;
    function now(t) { return typeof t === 'number' && isFinite(t) ? t : Date.now(); }
    function refresh(t) {
      if (state === 'cooldown' && now(t) >= cooldownUntil) {
        state = 'scanning'; stableCount = 0; lastPose = null;
      }
      return state;
    }
    return {
      enter: function (t) {
        state = 'scanning'; stableCount = 0; lastPose = null; cooldownUntil = 0;
        return state;
      },
      leave: function () {
        state = 'idle'; stableCount = 0; lastPose = null; cooldownUntil = 0;
        return state;
      },
      state: function (t) { return refresh(t); },
      frame: function (info, t) {
        if (refresh(t) !== 'scanning') return { state: state, armed: false, stableCount: 0 };
        if (!info || !info.hasHand || !info.pose || !isFinite(info.pose.cx) || !isFinite(info.pose.cy)) {
          stableCount = 0; lastPose = null;
          return { state: state, armed: false, stableCount: 0 };
        }
        if (!lastPose) {
          stableCount = 1;
        } else {
          var v = Math.hypot(info.pose.cx - lastPose.cx, info.pose.cy - lastPose.cy);
          stableCount = v <= velocityMax ? stableCount + 1 : 0;
        }
        lastPose = { cx: info.pose.cx, cy: info.pose.cy };
        return { state: state, armed: stableCount >= stableFramesNeeded, stableCount: stableCount };
      },
      verdict: function (t) {
        if (refresh(t) !== 'scanning') return false;
        state = 'cooldown';
        cooldownUntil = now(t) + cooldownMs;
        stableCount = 0; lastPose = null;
        return true;
      },
      reset: function (t) {
        if (state === 'idle') return state;
        state = 'scanning'; stableCount = 0; lastPose = null; cooldownUntil = 0;
        return state;
      },
      cooldownRemainingMs: function (t) {
        return state === 'cooldown' ? Math.max(0, cooldownUntil - now(t)) : 0;
      }
    };
  }

  // Verification codes from collected frames (v20): the ROI is
  // pre-aligned on the wrist -> middle-MCP axis at warp time, so each
  // frame needs only its own code and its mirror twin (a front-camera
  // enrolment and a back-camera verification capture mirror images of
  // the same palm). The v16 rotation twins are gone: alignment at the
  // source replaces tolerance by variant multiplication, cutting the
  // per-frame comparison count from 18 live codes to 2.
  /* v45: live selection in the packed format. The two sharpest
     usable frames (PALM_LIVE_OPEN_MIN gate) each contribute their
     packed probe pair (plain + mirror twin, from the ROI via
     palmprintProbePacked); a code-only frame contributes its
     packed code. The v30 live-side consensus appends are gone —
     score-level MAX over the individual templates is the rule
     (the same removal v33 made on the enrolment side). Returns
     packed base64 templates or null. */
  function selectPalmprintLiveCodes(frames) {
    var usable = palmprintUsableOpenFrames(frames, PALM_LIVE_OPEN_MIN);
    if (!usable.length) return null;
    usable.sort(function (a, b) { return b.sharpness - a.sharpness; });
    var top = usable.slice(0, 2);
    var out = [];
    top.forEach(function (u) {
      if (u.roi) {
        palmprintProbePacked(u.roi).forEach(function (p) { out.push(p); });
      } else if (u.code) {
        var packed = palmprintPackCode(u.code);
        var b64 = packed && palmprintPackedToBase64(packed);
        if (b64) out.push(b64);
      }
    });
    return out.length ? out : null;
  }

  /* v33: the live side of verification is ROIs, not pre-encoded
     codes — verifyPalmprintRois re-encodes each ROI at the 25
     image-level shifts itself. Selection keeps the same gate as the
     old code selection (PALM_LIVE_OPEN_MIN, sharpest first, top 3);
     a frame without a valid warped ROI cannot take part. */
  function selectPalmprintLiveRois(frames) {
    // v53 FULL-HAND FRAME RULE: a frame the completeness
    // judgement positively marked incomplete (frameComplete ===
    // false — cropped fingertips or too close, see
    // palmFrameCompleteness) never reaches the collected-set
    // judgement. Frames that carry no judgement (every pre-v53
    // fixture and caller) pass exactly as before.
    var complete = (frames || []).filter(function (f) { return !f || f.frameComplete !== false; });
    var usable = palmprintUsableOpenFrames(complete, PALM_LIVE_OPEN_MIN);
    var withRoi = usable.filter(function (u) { return !!u.roi; });
    if (!withRoi.length) return null;
    withRoi.sort(function (a, b) { return b.sharpness - a.sharpness; });
    return withRoi.slice(0, 3).map(function (u) { return u.roi; });
  }

  /* --- v20 streaming helpers (Show & Pay + auto-capture enrolment) --- */

  /* Palm pose from landmarks: centre = midpoint of the knuckle line,
     span = knuckle span, both in normalised frame coords. Used by the
     passive-liveness micro-shift check. */
  function palmFramePose(landmarks) {
    if (!landmarks || landmarks.length !== 21) return null;
    var a = landmarks[5], b = landmarks[17];
    if (!a || !b || !isFinite(Number(a.x)) || !isFinite(Number(a.y)) || !isFinite(Number(b.x)) || !isFinite(Number(b.y))) return null;
    return {
      cx: (Number(a.x) + Number(b.x)) / 2,
      cy: (Number(a.y) + Number(b.y)) / 2,
      span: Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y))
    };
  }
  /* Framing guidance for a live palm (v24): the failure this answers
     is a checkout palm held so close/high that fingertips leave the
     frame - MediaPipe then estimates the missing points, the warp is
     built on guessed geometry, and the print cannot match the
     enrolment no matter how good the encoder is (his phone,
     2026-11-20: enrolled, then no match with the palm overflowing
     the frame). Returns a plain instruction or null when the hand is
     wholly in view at a sane distance. */
  function palmFramingHint(landmarks) {
    if (!landmarks || landmarks.length !== 21) return null;
    var tips = [0, 8, 12, 16, 20], i, p;
    for (i = 0; i < tips.length; i++) {
      p = landmarks[tips[i]];
      if (!p || !isFinite(Number(p.x)) || !isFinite(Number(p.y))) continue;
      if (Number(p.x) < 0.02 || Number(p.x) > 0.98 || Number(p.y) < 0.02 || Number(p.y) > 0.98) {
        return 'Whole hand in view — part of the hand is being cut off. Move the palm back a little so the whole hand shows.';
      }
    }
    var pose = palmFramePose(landmarks);
    if (pose) {
      if (pose.span > 0.55) return 'Too close — move the palm back a little, about 30 cm away.';
      if (pose.span < 0.15) return 'Move the palm a little closer to the camera.';
    }
    return null;
  }

  /* ================= v53: full-hand frame rule =================
     The Chairman's phone failure (2026-11-24 20:17): his own
     left palm, good light, steady, hand detected — no verify.
     The presentation was a hand held so close that the
     fingertips left the top of the frame. Two mechanisms hurt:
     MediaPipe ESTIMATES off-frame points, so the affine ROI is
     warped from guessed geometry and the print cannot match
     the enrolment; and the chirality reading behind the v51
     hand gate is computed from the same degraded landmarks, so
     a cropped close-up can be read as the wrong hand and the
     owner's own profile is excluded before scoring. Until v53
     the framing hint above was guidance only — a cropped frame
     was coded and scored exactly like a whole one.

     THE RULE: a frame counts toward matching only when the
     hand is fully inside the frame. The numbers are not new —
     they are palmFramingHint's own, promoted from advice to
     judgement so the hint and the rule can never disagree:
       - every fingertip (landmarks 4, 8, 12, 16, 20) inside
         the frame with the hint's 0.02 margin on both axes;
       - the knuckle span (landmarks 5-17, palmFramePose) at or
         below the hint's too-close ceiling, 0.55 of frame
         width.
     A span under the hint's 0.15 floor is 'tooFar' — advice
     only ('Move a little closer'); the frame still counts,
     because the affine warp is scale-normalised and a small
     whole palm encodes honestly, while a cropped or
     overflowing one cannot. Returns null when the landmarks
     cannot support a judgement (not 21 finite points) — such a
     frame produces no code anyway. Otherwise returns
     { complete, issue, span } with issue null | 'cropped' |
     'tooClose' | 'tooFar'; complete is false exactly for
     'cropped' and 'tooClose'. */
  var PALM_FRAME_TIP_MARGIN = 0.02;  // palmFramingHint's in-frame margin
  var PALM_FRAME_MAX_SPAN = 0.55;    // palmFramingHint's 'Too close' span ceiling
  var PALM_FRAME_MIN_SPAN = 0.15;    // palmFramingHint's 'a little closer' span floor
  var PALM_FRAME_TIPS = [4, 8, 12, 16, 20];
  function palmFrameCompleteness(landmarks) {
    if (!landmarks || landmarks.length !== 21) return null;
    var i, p;
    for (i = 0; i < 21; i++) {
      p = landmarks[i];
      if (!p || !isFinite(Number(p.x)) || !isFinite(Number(p.y))) return null;
    }
    for (i = 0; i < PALM_FRAME_TIPS.length; i++) {
      p = landmarks[PALM_FRAME_TIPS[i]];
      if (Number(p.x) < PALM_FRAME_TIP_MARGIN || Number(p.x) > 1 - PALM_FRAME_TIP_MARGIN ||
          Number(p.y) < PALM_FRAME_TIP_MARGIN || Number(p.y) > 1 - PALM_FRAME_TIP_MARGIN) {
        return { complete: false, issue: 'cropped', span: null };
      }
    }
    var pose = palmFramePose(landmarks);
    var span = pose ? pose.span : null;
    if (span !== null && span > PALM_FRAME_MAX_SPAN) return { complete: false, issue: 'tooClose', span: span };
    if (span !== null && span < PALM_FRAME_MIN_SPAN) return { complete: true, issue: 'tooFar', span: span };
    return { complete: true, issue: null, span: span };
  }

  /* ================= v53: scan diagnosis lines =================
     The plain-language measured panel shown under a failed
     scan's message (the wallet card, the terminal). The values
     come from the SAME outcome fields the scan's log record is
     built from — the streams attach `diag` to the outcome in
     the same closure that calls fieldRec with the same fused
     similarity, the same PalmNet score and the same hand
     evidence, so the card and the log cannot disagree. This
     builder is the pure half: diag in, lines out. It reports
     the bars as facts (they are never presented as adjustable)
     and names the hand gate plainly when the gate, not a score,
     decided the rejection. British English throughout. */
  function scanDiagnosisLines(diag) {
    if (!diag || typeof diag !== 'object') return [];
    var lines = [];
    if (typeof diag.edcc === 'number' && isFinite(diag.edcc)) {
      lines.push('Best palm score: ' + diag.edcc.toFixed(3) + ' — the bar is ' + PALMPRINT_THRESHOLD.toFixed(2) + '.');
    } else {
      lines.push('Best palm score: no readable palm code was scored.');
    }
    if (typeof diag.neural === 'number' && isFinite(diag.neural)) {
      lines.push('PalmNet score: ' + diag.neural.toFixed(3) + ' — the bar is ' + PALMNET_THRESHOLD.toFixed(2) + '.');
    } else {
      lines.push('PalmNet: no neural evidence this scan.');
    }
    var hand = (diag.probeHand === 'left' || diag.probeHand === 'right') ? diag.probeHand : null;
    lines.push(hand ? 'Hand read: ' + hand + '.' : 'Hand read: not readable.');
    if (diag.handGate && hand) {
      if (diag.profileHand === 'left' || diag.profileHand === 'right') {
        lines.push('Your other hand is registered as a different identity — this profile is the ' + diag.profileHand + ' hand, but this scan was read as the ' + hand + ' hand, so it was not scored.');
      } else {
        lines.push('Your other hand is registered as a different identity — this scan was read as the ' + hand + ' hand' +
          (typeof diag.excludedCount === 'number' && diag.excludedCount > 0
            ? ', and ' + diag.excludedCount + ' registered profile' + (diag.excludedCount === 1 ? '' : 's') + ' recording the other hand ' + (diag.excludedCount === 1 ? 'was' : 'were') + ' excluded.'
            : ', and profiles recording the other hand were excluded.'));
      }
    }
    return lines;
  }

  /* Passive liveness over a few rapid frames (Show & Pay, v20): a live
     hand held toward a camera is never perfectly still - it drifts by
     small, natural amounts. A frozen digital frame (paused video,
     screen-held still image fed as a static picture) shows shifts at
     detector-noise level only; a waved printout or a swapped scene
     jumps wildly. Returns { pass, verdict, maxShift, spanChange }:
       'natural'      - micro-shift in the live range: pass.
       'static'       - no real movement: fail (photo / frozen frame).
       'erratic'      - jumps too large for one held hand: fail.
       'inconclusive' - between the bands: caller keeps collecting.
     Honest scope: this catches frozen/static presentations. The
     screen-lattice coherence gate is what blocks phone-screen replay;
     a high-quality printed photo of the enrolled palm remains the
     residual risk the field test exists to measure. */
  var PASSIVE_STATIC_EPS = 0.0006;   // max centre shift below this = frozen
  var PASSIVE_NATURAL_MIN = 0.0020;  // centre shift at/above this = natural
  var PASSIVE_ERRATIC_MAX = 0.09;    // centre shift above this = scene jump
  function passiveLivenessPoses(poses) {
    return (poses || []).filter(function (p) { return p && isFinite(p.cx) && isFinite(p.cy) && isFinite(p.span) && p.span > 0; });
  }
  /* The verdict maths over an already-filtered pose list of at
     least two: maxShift is the largest CONSECUTIVE-step centre
     shift, spanChange the largest span drift from the first pose,
     and the bands are the constants above. Shared verbatim by the
     3-pose check and the v39 pair path, so a single step is judged
     by exactly the same numbers in both paths. */
  function passiveLivenessEval(list) {
    var maxShift = 0, spanChange = 0;
    for (var i = 1; i < list.length; i++) {
      var d = Math.hypot(list[i].cx - list[i - 1].cx, list[i].cy - list[i - 1].cy);
      if (d > maxShift) maxShift = d;
    }
    for (var j = 0; j < list.length; j++) {
      var sc = Math.abs(list[j].span - list[0].span) / list[0].span;
      if (sc > spanChange) spanChange = sc;
    }
    if (maxShift > PASSIVE_ERRATIC_MAX || spanChange > 0.30) return { pass: false, verdict: 'erratic', maxShift: maxShift, spanChange: spanChange };
    if (maxShift < PASSIVE_STATIC_EPS && spanChange < 0.002) return { pass: false, verdict: 'static', maxShift: maxShift, spanChange: spanChange };
    if (maxShift >= PASSIVE_NATURAL_MIN || spanChange >= 0.006) return { pass: true, verdict: 'natural', maxShift: maxShift, spanChange: spanChange };
    return { pass: false, verdict: 'inconclusive', maxShift: maxShift, spanChange: spanChange };
  }
  function passiveLivenessCheck(poses) {
    var list = passiveLivenessPoses(poses);
    if (list.length < 3) return { pass: false, verdict: 'inconclusive', maxShift: 0, spanChange: 0 };
    return passiveLivenessEval(list);
  }
  /* v39 fast-win liveness: the SAME verdict maths over exactly the
     two matched frames' poses (the last two valid poses given).
     The pair passes only on 'natural' — a real micro-shift between
     the two instants the palm actually matched at, judged by the
     same per-step thresholds the 3-pose path uses. A static pair
     (a held photograph yields detector-noise displacement only)
     reads 'static' and does NOT pass: the scan simply keeps
     collecting frames and the 3-pose path can still complete it —
     never a hard fail for a live user holding still. No number is
     loosened: the EPS / NATURAL_MIN / ERRATIC_MAX constants and
     the span bands are shared with the 3-pose path, not copied. */
  function passiveLivenessPairCheck(poses) {
    var list = passiveLivenessPoses(poses);
    if (list.length < 2) return { pass: false, verdict: 'inconclusive', maxShift: 0, spanChange: 0 };
    return passiveLivenessEval(list.slice(-2));
  }

  /* v44 WALL-CLOCK SCAN BUDGET (ms) for the streaming verify /
     identify scans: the frame-count window (MAXF 24 in the app)
     stays as the backstop, but on a slow phone 24 frames at the
     measured ~490 ms per analysed frame (the Chairman's device,
     2026-11-23) is an 11.7 s no-match grind — the deadline, not
     the frame cap, is what a refused customer actually waits out.
     BASIS: across 18 fixture genuine sequences (flat, tilt band,
     span error, combined, tilted enrolment), every verdict landed
     at analysed frame 3 — the minimum the evidence rules allow
     (two matched frames inside the rolling window, at least three
     spoof-examined frames). The budget allows 12 analysed frames
     — 4x that count, absorbing hand-entry and blurred frames —
     at his phone's measured rate: 12 x ~490 ms ~ 5.9 s, set to
     6000 ms. Spoof and liveness rejections are untouched: they
     fire the moment their evidence completes, deadline or not. */
  var SCAN_TIME_BUDGET_MS = 6000;

  /* Streaming early-exit rule (v20): the checkout completes the
     millisecond TWO CONSECUTIVE analysed frames each score at or
     above the match threshold. A frame with no usable code (fist
     phase, hand withdrawn) or a below-threshold score breaks the
     streak - consecutiveness is in capture order, not best-of. Pure
     state transition so the rule is unit-testable without a camera. */
  function streamMatchUpdate(state, score) {
    var best = state && typeof state.best === 'number' ? state.best : null;
    var hist = state && Array.isArray(state.hist) ? state.hist.slice(-2) : [];
    var isNum = typeof score === 'number' && isFinite(score);
    var isMatch = isNum && score >= PALMPRINT_THRESHOLD;
    if (isNum && (best === null || score > best)) best = score;
    // History: the v32 rule required two matching frames within
    // a rolling three-frame window (measured need, 2026-11-20:
    // a genuine palm at 0.338 on one frame while its neighbours
    // jittered just below). The v45 spec replaces it — see below.
    // v45 (spec section 5): the win rule is the 1-snap rule — the
    // FIRST frame whose packed match reaches the threshold
    // completes the scan, and done latches. This replaces the v32
    // two-in-three rolling window (the user's explicit spec
    // override, 2026-11-23). The surrounding gates are unchanged
    // and live in the callers: the win is honoured only once the
    // spoof gate has examined at least three frames and passive
    // liveness passes on the streamed poses. hist/streak are kept
    // for the diagnostics record.
    var done = isMatch || !!(state && state.done);
    hist.push(isMatch);
    var streak = 0;
    for (var i = hist.length - 1; i >= 0 && hist[i]; i--) streak++;
    return { streak: streak, best: best, hist: hist.slice(-3), done: done };
  }

  /* v39 FAST WIN (Show & Pay): when streamMatchUpdate completes
     the two-frame match, the win may be honoured on the matched
     PAIR itself — at two analysed frames instead of three — when
     the pair carries its own complete evidence:
       - both frames matched (the caller passes the two frames the
         rolling-window rule paired, in capture order);
       - BOTH frames carry a CLEAN per-frame spoof sample: the
         screenSpoofCheck verdict for that exact frame (the v36
         palm-region grid gate plus glare/bezel), recorded as
         spoof === false. A flagged frame blocks the fast win, and
         so does a frame the detector never examined (spoof null) —
         unexamined is not clean. Fail-closed.
       - the pair's poses pass passiveLivenessPairCheck: a real
         micro-shift between the two matched instants, at the same
         thresholds as the 3-pose path.
     This function only decides how early a WIN may be honoured.
     It never contributes to a rejection: the spoof tracker's
     aggregation rule and the no-match path are untouched, and a
     pair that fails here simply keeps the scan collecting frames
     toward the standard three-frame honour. Pure function of the
     two evidence records so the rule is unit-testable without a
     camera, like streamMatchUpdate. Evidence record shape:
       { matched: bool, pose: palmFramePose|null,
         spoof: true (flagged) | false (examined, clean) |
                null (never examined) } */
  function streamFastWinCheck(a, b) {
    if (!a || !b || !a.matched || !b.matched) return { ok: false, reason: 'pair-not-matched', liveness: null };
    if (a.spoof !== false || b.spoof !== false) return { ok: false, reason: 'spoof-not-clean', liveness: null };
    var lv = passiveLivenessPairCheck([a.pose, b.pose]);
    if (!lv.pass) return { ok: false, reason: 'liveness-' + lv.verdict, liveness: lv };
    return { ok: true, reason: 'fast-win', liveness: lv };
  }

  /* Self-contained Web Worker source for palmprint matching (v20):
     assembled from the real functions above (their own source text),
     so the worker runs exactly the shipping comparer - no second
     implementation to drift. The app falls back to the main thread
     whenever a worker cannot start or answer. */
  function palmprintWorkerSource() {
    var consts = 'var PALMPRINT_SIZE=' + PALMPRINT_SIZE +
      ';var PALMPRINT_CODE_LEN=' + PALMPRINT_CODE_LEN +
      ';var PALMPRINT_DIRECTIONS=' + PALMPRINT_DIRECTIONS +
      ';var PALMPRINT_KERNEL_SIZE=' + PALMPRINT_KERNEL_SIZE +
      ';var PALMPRINT_ROI_SIZE=' + PALMPRINT_ROI_SIZE +
      ';var PALMPRINT_MAX_DIR_SHARE=' + PALMPRINT_MAX_DIR_SHARE +
      ';var PALMPRINT_THRESHOLD=' + PALMPRINT_THRESHOLD +
      ';var PALMPRINT_FORMAT=' + JSON.stringify(PALMPRINT_FORMAT) +
      ';var PALMPRINT_PACK_PLANES=' + PALMPRINT_PACK_PLANES +
      ';var PALMPRINT_PACK_WORDS_PER_ROW=' + PALMPRINT_PACK_WORDS_PER_ROW +
      ';var PALMPRINT_PACK_WORDS=' + PALMPRINT_PACK_WORDS +
      ';var PALMPRINT_PACK_LEN=' + PALMPRINT_PACK_LEN +
      ';var PALMPRINT_SHIFTS5=' + JSON.stringify(PALMPRINT_SHIFTS5) +
      ';var PALMPRINT_KERNELS=null;';
    // v45: the worker runs the packed pipeline end to end — the
    // EDCC encoder chain (with the CLAHE normalisation), the
    // bit-packing, and every template comparison (the 5-shift
    // popcount matcher) — so the camera preview thread never pays
    // for matching. Messages carrying liveRois encode the probes
    // inside the worker; messages carrying liveCodes keep the
    // code-pair path. d.exhaustive carries the Field Test Mode
    // toggle (no early exit; the answer carries the per-shift
    // log). The fast and multi-profile branches answer with their
    // stage-timing sink, as since v44.
    var fns = [reflect101, resizeGrayBilinear, convolveSeparable, convolve2d, gaborKernelReal, palmprintKernels, palmprintEnhance, palmprintNormaliseRoi, palmprintEncode, palmprintCodeFromBase64, palmprintCodeBytes, palmprintCodeSane, popcount32, palmprintPackCode, palmprintPackedBytes, palmprintPackedWords, palmprintPackedFromBase64, palmprintUnpackCode, palmprintPackedSane, edccPackedScoreAtShift, palmprintPackedMatchWords, palmprintPackedMatch, palmprintPackedSimilarity, flipGrayHorizontal, palmprintProfileFormat, normalisePalmprintProfile, palmprintProfileFailReason, palmProfileHand, handGateBlocks, palmprintMatchResult, palmprintMatchPackedProfile, verifyPackedProbes, verifyPalmprintProfile, palmprintProbePacked, verifyPalmprintRois, verifyPalmprintRoisFast, verifyPalmprintProfilesRois];
    var body = fns.map(function (f) { return f.toString(); }).join('\n');
    var handler = 'onmessage=function(e){var d=e.data||{};var r=null;var rs=null;var tm=null;' +
      'try{' +
      'if(d.profiles){tm={};rs=verifyPalmprintProfilesRois(d.profiles,d.liveRois,{exhaustive:!!d.exhaustive,timing:tm,probeHand:d.probeHand||null});}' +
      'else if(d.fast){tm={};r=verifyPalmprintRoisFast(d.profile,d.liveRois,{exhaustive:!!d.exhaustive,timing:tm,probeHand:d.probeHand||null});}' +
      'else{r=(d.liveRois?verifyPalmprintRois(d.profile,d.liveRois,{exhaustive:!!d.exhaustive,probeHand:d.probeHand||null}):verifyPalmprintProfile(d.profile,d.liveCodes,{exhaustive:!!d.exhaustive}));}' +
      '}catch(err){r=null;rs=null;tm=null;}' +
      'postMessage({id:d.id,result:r,results:rs,timing:tm});};';
    return consts + '\n' + body + '\n' + handler;
  }

  /* ---- Fingerprint through camera: image processing on real pixels ---- */

  // gray: array of 0..255, width w, height h (row-major)
  function laplacianVariance(gray, w, h) {
    if (!gray || gray.length < w * h || w < 3 || h < 3) return 0;
    var values = [];
    var mean = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
        values.push(lap);
        mean += lap;
      }
    }
    if (!values.length) return 0;
    mean /= values.length;
    var variance = 0;
    for (var j = 0; j < values.length; j++) variance += (values[j] - mean) * (values[j] - mean);
    return variance / values.length;
  }

  function contrastStretch(gray) {
    var min = 255, max = 0, i, v;
    for (i = 0; i < gray.length; i++) { v = gray[i]; if (v < min) min = v; if (v > max) max = v; }
    var range = max - min;
    var out = new Array(gray.length);
    if (range < 1) { for (i = 0; i < gray.length; i++) out[i] = gray[i]; return out; }
    for (i = 0; i < gray.length; i++) out[i] = Math.round(((gray[i] - min) / range) * 255);
    return out;
  }

  function sharpen(gray, w, h) {
    var out = gray.slice();
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var v = 5 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
        out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    return out;
  }

  // Adaptive threshold using a downscaled local-mean approximation (box blur radius r).
  function adaptiveThreshold(gray, w, h, radius, offset) {
    radius = radius || 8; offset = offset || 12;
    var blurred = boxBlur(gray, w, h, radius);
    var out = new Array(gray.length);
    for (var i = 0; i < gray.length; i++) out[i] = gray[i] < blurred[i] - offset ? 0 : 255;
    return out;
  }

  function boxBlur(gray, w, h, r) {
    var out = new Array(gray.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var sum = 0, count = 0;
        for (var dy = -r; dy <= r; dy += Math.max(1, Math.floor(r / 2))) {
          for (var dx = -r; dx <= r; dx += Math.max(1, Math.floor(r / 2))) {
            var xx = x + dx, yy = y + dy;
            if (xx >= 0 && xx < w && yy >= 0 && yy < h) { sum += gray[yy * w + xx]; count++; }
          }
        }
        out[y * w + x] = sum / count;
      }
    }
    return out;
  }

  function downscaleTemplate(gray, w, h, size) {
    size = size || 96;
    var out = new Array(size * size);
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var sx = Math.min(w - 1, Math.floor((x / size) * w));
        var sy = Math.min(h - 1, Math.floor((y / size) * h));
        out[y * size + x] = gray[sy * w + sx];
      }
    }
    return out;
  }

  // Local Binary Pattern histogram (256 bins, normalized) - a real texture descriptor.
  function lbpHistogram(gray, w, h) {
    var hist = new Array(256).fill(0);
    var count = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x, c = gray[i], code = 0;
        if (gray[i - w - 1] >= c) code |= 1;
        if (gray[i - w] >= c) code |= 2;
        if (gray[i - w + 1] >= c) code |= 4;
        if (gray[i + 1] >= c) code |= 8;
        if (gray[i + w + 1] >= c) code |= 16;
        if (gray[i + w] >= c) code |= 32;
        if (gray[i + w - 1] >= c) code |= 64;
        if (gray[i - 1] >= c) code |= 128;
        hist[code]++; count++;
      }
    }
    if (count) for (var j = 0; j < 256; j++) hist[j] /= count;
    return hist;
  }

  function imageStats(gray) {
    var mean = 0, i;
    for (i = 0; i < gray.length; i++) mean += Number(gray[i]);
    mean /= gray.length;
    return { mean: mean, std: vecStd(gray) };
  }

  /* Quality gate. IMPORTANT: `gray` must be the ORIGINAL camera grayscale,
     never a contrast-stretched copy - stretching amplifies sensor noise in
     dark/blank frames until it looks "sharp" (that was a false-accept
     hole: a covered camera in a dark room passed the old gate).
     Hard floors, all must pass:
       - brightness mean inside [12, 245] (not a black/white-out frame)
       - pixel std-dev >= 12 (a near-uniform frame has no print on it)
       - Laplacian sharpness >= 30 on the original pixels
       - binarized ridge density inside [0.15, 0.65]                     */
  function fingerprintQuality(gray, w, h, ridgeImage) {
    var stats = imageStats(gray);
    var sharpness = laplacianVariance(gray, w, h);
    var ridgeDensity = 0;
    if (ridgeImage && ridgeImage.length) {
      var dark = 0;
      for (var i = 0; i < ridgeImage.length; i++) if (ridgeImage[i] === 0) dark++;
      ridgeDensity = dark / ridgeImage.length;
    }
    var ridgeOk = ridgeDensity > 0.15 && ridgeDensity < 0.65;
    var sharpOk = sharpness >= 30;
    var stdOk = stats.std >= 12;
    var brightOk = stats.mean >= 12 && stats.mean <= 245;
    var ok = sharpOk && ridgeOk && stdOk && brightOk;
    var reason = 'Ridge quality accepted.';
    if (!brightOk) reason = 'Frame is almost completely dark or blown out - add light and keep the fingertip 5-8 cm away.';
    else if (!stdOk) reason = 'Frame is nearly uniform - no fingertip texture in view. Put the fingertip inside the guide, facing the camera.';
    else if (!sharpOk) reason = 'Image too blurry - keep the fingertip still, move closer (5-8 cm) and add light.';
    else if (!ridgeOk) reason = 'No clear ridge texture found - the fingertip must fill the guide, facing the camera.';
    return {
      sharpness: sharpness,
      ridgeDensity: ridgeDensity,
      stdDev: stats.std,
      meanBrightness: stats.mean,
      ok: ok,
      reason: reason
    };
  }

  function pearsonCorrelation(a, b) {
    if (!a || !b || a.length !== b.length || a.length === 0) return null;
    var ma = 0, mb = 0, i;
    for (i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
    ma /= a.length; mb /= b.length;
    var num = 0, da = 0, db = 0;
    for (i = 0; i < a.length; i++) {
      var xa = a[i] - ma, xb = b[i] - mb;
      num += xa * xb; da += xa * xa; db += xb * xb;
    }
    if (da === 0 || db === 0) return 0; // a flat/blank template correlates with nothing
    return num / Math.sqrt(da * db);
  }

  function histogramSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return null;
    var inter = 0, total = 0;
    for (var i = 0; i < a.length; i++) { inter += Math.min(a[i], b[i]); total += Math.max(a[i], b[i]); }
    return total === 0 ? 0 : inter / total;
  }

  /* BOTH-MUST-PASS: the template correlation must clear FINGER_CORR_MIN
     AND the texture similarity must clear FINGER_TEXTURE_MIN, each on its
     own. (The old weighted average let a high texture similarity - which
     unrelated fingerprints and even noise frames share - carry a weak
     template match over the line.) */
  function verifyFingerprint(stored, live) {
    var fail = function (reason, correlation, textureSimilarity) {
      return { ok: false, verified: false, correlation: correlation, textureSimilarity: textureSimilarity, score: correlation, threshold: FINGER_CORR_MIN, textureThreshold: FINGER_TEXTURE_MIN, reason: reason };
    };
    if (!fingerprintRecordSane(stored)) return fail('No usable fingerprint enrolled for this person - the stored print data is missing or invalid.', null, null);
    if (!fingerprintRecordSane(live)) return fail('The captured print is missing or invalid - no real fingerprint was captured.', null, null);
    var correlation = pearsonCorrelation(stored.template, live.template);
    var textureSimilarity = histogramSimilarity(stored.texture, live.texture);
    if (correlation === null || textureSimilarity === null || !isFinite(correlation) || !isFinite(textureSimilarity)) {
      return fail('Fingerprint comparison failed.', correlation, textureSimilarity);
    }
    var corrOk = correlation >= FINGER_CORR_MIN;
    var texOk = textureSimilarity >= FINGER_TEXTURE_MIN;
    var verified = corrOk && texOk;
    return {
      ok: true,
      verified: verified,
      correlation: correlation,
      textureSimilarity: textureSimilarity,
      score: correlation,
      threshold: FINGER_CORR_MIN,
      textureThreshold: FINGER_TEXTURE_MIN,
      reason: verified ? 'Fingerprint correlation and texture both pass.'
        : !corrOk ? 'Fingerprint template correlation too low - not the enrolled finger.'
        : 'Fingerprint texture does not match the enrolled finger.'
    };
  }

  /* ---- Wallet helpers (bKash / Nagad) ---- */
  function normaliseWalletNumber(raw) {
    if (!raw) return null;
    var digits = String(raw).replace(/[^\d]/g, '');
    if (digits.indexOf('880') === 0) digits = '0' + digits.slice(3);
    else if (digits.indexOf('88') === 0 && digits.length === 13) digits = '0' + digits.slice(2);
    if (!/^01\d{9}$/.test(digits)) return null;
    return digits;
  }

  function maskWalletNumber(normalised) {
    if (!normalised || normalised.length !== 11) return '';
    return normalised.slice(0, 5) + '-***' + normalised.slice(8);
  }

  /* ================= Demo wallet (v42) =================
     The demonstration wallet layer the Chairman ordered 2026-11-23:
     every registered person has a wallet whose account ID is their
     Biom ID, created at registration with balance 0. The wallet
     functions below are the STORE LAYER — pure functions over the
     plain person rows, so the app UI and this test suite exercise
     exactly the same rules. The UI never moves demo money except
     through walletApplyAddMoney / walletApplySend.

     HONESTY (standing real-only rule): this is DEMONSTRATION money
     inside the app. References are DEMO-prefixed and never shaped
     like a bKash / Nagad TrxID; real provider settlement remains
     biometric-authorised pending partner API, exactly as the
     terminal's Biom Pay records already state.

     THE RULES, enforced here (not just in the UI):
       - A wallet opens only for a verified palm scan; the scan is
         the key. These functions consume the verify pipeline's
         result as an authorisation object { verified, personId } —
         there is no second, weaker scan path for wallet actions.
       - Add Money credits only when the authorisation verifies as
         the wallet's OWN owner and a linked funding account is
         named. Another person's palm, or no match, credits nothing.
       - Send Money resolves the receiver from the identification
         scan. A palm matching NO registered Biom ID resolves to
         null and the send is impossible — even when the sender has
         an account and a balance.
       - Amount must be a positive number and no more than the
         sender's balance (a balance of 0 sends nothing). No partial
         transfer, no negative balance.
       - Sending to yourself is blocked.
       - A completed transfer is computed from ONE snapshot of the
         people store: the sender debit and the receiver credit and
         both statement entries come out of the same call, so the
         two sides can never disagree about amount or reference. */
  var WALLET_ACCOUNT_TYPES = ['bKash', 'Nagad', 'Bank', 'Card'];
  function walletRound(n) { return Math.round(n * 100) / 100; }
  function walletCopyRow(row) {
    var copy = {};
    if (row && typeof row === 'object') Object.keys(row).forEach(function (k) { copy[k] = row[k]; });
    return copy;
  }
  function walletNew() { return { balance: 0, statement: [], linkedAccounts: [] }; }
  function walletSane(w) {
    return !!w && typeof w === 'object' &&
      typeof w.balance === 'number' && isFinite(w.balance) && w.balance >= 0 &&
      Array.isArray(w.statement) && Array.isArray(w.linkedAccounts);
  }
  /* Fill a missing or partially-formed wallet, preserving whatever
     is already valid in it (a real balance, statement rows, linked
     accounts are never discarded). Returns the SAME person object
     when the wallet is already sane, so callers can detect the
     no-change case by identity — the v42 migration relies on it. */
  function walletEnsurePerson(person) {
    if (!person || typeof person !== 'object') return person;
    if (walletSane(person.wallet)) return person;
    var w = walletNew();
    var old = person.wallet;
    if (old && typeof old === 'object') {
      if (typeof old.balance === 'number' && isFinite(old.balance) && old.balance >= 0) w.balance = old.balance;
      if (Array.isArray(old.statement)) w.statement = old.statement;
      if (Array.isArray(old.linkedAccounts)) w.linkedAccounts = old.linkedAccounts;
    }
    var copy = walletCopyRow(person);
    copy.wallet = w;
    return copy;
  }
  function walletValidateAmount(raw) {
    var n = typeof raw === 'string' ? Number(raw.trim()) : raw;
    if (typeof n !== 'number' || isNaN(n) || !isFinite(n)) {
      return { ok: false, code: 'INVALID_AMOUNT', error: 'Enter the amount as a number.' };
    }
    n = walletRound(n);
    if (!(n > 0)) {
      return { ok: false, code: 'INVALID_AMOUNT', error: 'The amount must be more than zero.' };
    }
    return { ok: true, amount: n };
  }
  /* Demo references are honest demo references: DEMO-prefixed,
     never formatted to imitate a provider TrxID. */
  function walletDemoRef(seq) { return 'DEMO-' + seq; }
  /* The authorisation an action consumes is the EXISTING verify
     pipeline's outcome, modelled as { verified: true, personId }.
     Anything else — a failed scan, a spoof rejection, a scan that
     verified as somebody else — authorises nothing. */
  function walletAuthorised(authResult, personId) {
    return !!authResult && authResult.verified === true && !!personId && authResult.personId === personId;
  }
  function walletAddLinkedAccount(person, type, label, ts) {
    if (!person || typeof person !== 'object') return { ok: false, code: 'NO_PERSON', error: 'No wallet owner was found.' };
    if (WALLET_ACCOUNT_TYPES.indexOf(type) === -1) {
      return { ok: false, code: 'BAD_ACCOUNT_TYPE', error: 'Choose the account type: bKash, Nagad, Bank or Card.' };
    }
    var lbl = String(label == null ? '' : label).trim();
    if (!lbl) return { ok: false, code: 'BAD_ACCOUNT_LABEL', error: 'Give the account a name or number so you can recognise it.' };
    var p = walletEnsurePerson(person);
    var acct = {
      id: 'ACCT-' + (p.wallet.linkedAccounts.length + 1) + '-' + String(ts || 0),
      type: type, label: lbl, linkedAt: ts || 0
    };
    var copy = walletCopyRow(p);
    copy.wallet = { balance: p.wallet.balance, statement: p.wallet.statement, linkedAccounts: p.wallet.linkedAccounts.concat([acct]) };
    return { ok: true, person: copy, account: acct };
  }
  function walletApplyAddMoney(person, amountRaw, accountId, authResult, ts, ref) {
    if (!person || typeof person !== 'object') return { ok: false, code: 'NO_PERSON', error: 'No wallet owner was found.' };
    var amt = walletValidateAmount(amountRaw);
    if (!amt.ok) return amt;
    var p = walletEnsurePerson(person);
    var acct = null;
    p.wallet.linkedAccounts.forEach(function (a) { if (a && a.id === accountId) acct = a; });
    if (!acct) return { ok: false, code: 'NO_ACCOUNT', error: 'Link a funding account first — Add Money needs an account to add from.' };
    if (!walletAuthorised(authResult, p.id)) {
      return { ok: false, code: 'AUTH_FAILED', error: 'Your own palm did not verify, so no money was added. Only the wallet owner\'s palm can add money to this wallet.' };
    }
    var entry = {
      ref: ref, ts: ts, kind: 'add', amount: amt.amount,
      balanceAfter: walletRound(p.wallet.balance + amt.amount),
      accountType: acct.type, accountLabel: acct.label,
      note: 'Demo money added inside the app — not real funds.'
    };
    var copy = walletCopyRow(p);
    copy.wallet = { balance: entry.balanceAfter, statement: p.wallet.statement.concat([entry]), linkedAccounts: p.wallet.linkedAccounts };
    return { ok: true, person: copy, entry: entry };
  }
  /* The receiver of a send is whoever the identification scan
     resolved. A scan matching no registered palm resolves to null —
     and with no receiver there is nothing to send to. */
  function walletResolveReceiver(people, identifiedId) {
    if (!identifiedId || !Array.isArray(people)) return null;
    var found = null;
    people.forEach(function (p) { if (p && p.id === identifiedId) found = p; });
    return found;
  }
  function walletApplySend(people, senderId, receiverId, amountRaw, authResult, ts, ref) {
    if (!Array.isArray(people)) return { ok: false, code: 'NO_STORE', error: 'The people store could not be read.' };
    var sender = null;
    people.forEach(function (p) { if (p && p.id === senderId) sender = p; });
    if (!sender) return { ok: false, code: 'SENDER_NOT_FOUND', error: 'Your wallet could not be found. Open your wallet again and retry.' };
    var receiver = walletResolveReceiver(people, receiverId);
    if (!receiver) {
      return { ok: false, code: 'RECEIVER_NOT_REGISTERED', error: 'Receiver not registered: that palm matches no registered Biom ID on this device, so no money can be sent.' };
    }
    if (receiver.id === sender.id) {
      return { ok: false, code: 'SELF_SEND', error: 'You cannot send money to yourself.' };
    }
    var amt = walletValidateAmount(amountRaw);
    if (!amt.ok) return amt;
    var s = walletEnsurePerson(sender);
    var r = walletEnsurePerson(receiver);
    if (amt.amount > s.wallet.balance) {
      return { ok: false, code: 'INSUFFICIENT_BALANCE', error: 'Insufficient balance: your demo balance is BDT ' + s.wallet.balance + ', so BDT ' + amt.amount + ' cannot be sent. No money moved.' };
    }
    if (!walletAuthorised(authResult, s.id)) {
      return { ok: false, code: 'AUTH_FAILED', error: 'Your own palm did not verify, so nothing was sent.' };
    }
    var senderEntry = {
      ref: ref, ts: ts, kind: 'send', amount: amt.amount,
      counterpartyId: r.id, counterpartyName: r.name,
      balanceAfter: walletRound(s.wallet.balance - amt.amount),
      note: 'Demo transfer inside the app — not a real payment.'
    };
    var receiverEntry = {
      ref: ref, ts: ts, kind: 'receive', amount: amt.amount,
      counterpartyId: s.id, counterpartyName: s.name,
      balanceAfter: walletRound(r.wallet.balance + amt.amount),
      note: 'Demo transfer inside the app — not a real payment.'
    };
    var newSender = null, newReceiver = null;
    var newPeople = people.map(function (p) {
      if (p && p.id === s.id) {
        newSender = walletCopyRow(s);
        newSender.wallet = { balance: senderEntry.balanceAfter, statement: s.wallet.statement.concat([senderEntry]), linkedAccounts: s.wallet.linkedAccounts };
        return newSender;
      }
      if (p && p.id === r.id) {
        newReceiver = walletCopyRow(r);
        newReceiver.wallet = { balance: receiverEntry.balanceAfter, statement: r.wallet.statement.concat([receiverEntry]), linkedAccounts: r.wallet.linkedAccounts };
        return newReceiver;
      }
      return p;
    });
    return { ok: true, people: newPeople, sender: newSender, receiver: newReceiver, senderEntry: senderEntry, receiverEntry: receiverEntry };
  }

  /* ================= Flash (torch) control rules (v48) =============
     The pure half of the per-view Flash toggles in app.js. The app
     owns the camera and the DOM; these functions own the RULES, so
     the suites pin the behaviour and the screen can only follow:
       applyTorchToTrack(track, on) — the one place a torch
         constraint is applied: capability-gated on the track's own
         getCapabilities().torch, never throws, resolves true only
         when the track accepted the constraint.
       flashUiState(input) — a view's honest flash state: whether
         the toggle is disabled, the note to show, and whether the
         torch should be lit on the live track right now.
     The rules (the Chairman's order, 2026-11-24 — whenever the back
     camera is open, the flash control must work, functionally and
     smoothly):
       - The user's per-view choice is a PREFERENCE: it survives
         stream restarts, camera switches and view navigation. It
         is never cleared by the app's own machinery; the app
         re-applies it to every new track a view acquires.
       - The torch lights only on the BACK camera. On the front
         camera the choice stays set and the note says it will
         light on the back camera; switching back restores it.
       - If the active BACK camera reports no torch capability
         (most laptop webcams, desktop cameras), the toggle is
         DISABLED with the note 'Flash not available on this
         camera' — never a live-looking button that does nothing.
       - No camera yet: the choice can be set in advance and the
         note says it will light when the camera starts. */
  var FLASH_NOTE_NOT_AVAILABLE = 'Flash not available on this camera';
  var FLASH_NOTE_FRONT = 'Flash is set On - it will light on the back camera.';
  var FLASH_NOTE_PENDING = 'Flash is set On - it will light when this camera starts.';
  function applyTorchToTrack(track, on) {
    if (!track || !track.applyConstraints) return Promise.resolve(false);
    var caps = {};
    try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (e) {}
    if (!caps.torch) return Promise.resolve(false); // no torch on this camera/device
    return track.applyConstraints({ advanced: [{ torch: !!on }] })
      .then(function () { return true; })
      .catch(function () { return false; });
  }
  function flashUiState(input) {
    var o = input || {};
    if (!o.live) {
      return { disabled: false, applyTorch: false, note: o.prefOn ? FLASH_NOTE_PENDING : '' };
    }
    if (o.backChosen) {
      if (!o.torchSupported) return { disabled: true, applyTorch: false, note: FLASH_NOTE_NOT_AVAILABLE };
      return { disabled: false, applyTorch: !!o.prefOn, note: '' };
    }
    return { disabled: false, applyTorch: false, note: o.prefOn ? FLASH_NOTE_FRONT : '' };
  }

  /* ================= Stored-data migration (v38) =================
     STANDING RULE (the Chairman's order, 2026-11-23): "from now keep
     data dont wipe". App updates MIGRATE the on-device store forward
     and adopt it; they never clear it. Before v38 every version bump
     deleted the whole store on first open (people, palm codes,
     points, transactions, logs) and forced a fresh enrolment — that
     wipe is retired and must not come back.

     HOW IT WORKS: the app hands migrateBiomData() a plain snapshot
     of the four stores ({ people, logs, transactions, meta }, each an
     array of rows exactly as stored) plus the data version that
     wrote it, and gets back the migrated snapshot. Steps are keyed
     by the version they upgrade TO and run in BIOM_DATA_VERSIONS
     order; migrating from a version older than the list (or an
     unknown one) applies every step in order, so each step MUST be:
       - IDEMPOTENT: a no-op on data already in its output shape;
       - PRESERVING: convert fields, never drop a person, a palm
         code, points, a transaction or a log row to get there. A
         row the new build cannot read stays stored untouched — the
         app's readers already fail closed per record.
     A step that changes rows returns a NEW snapshot object (or sets
     changed on a store); the identity step returns its input
     untouched, and the caller writes back only stores whose array
     identity changed.

     v37 -> v38 is an ADOPTION, not a conversion: v38 changes no
     stored field (the person shape, the v3 palm-profile shape, the
     transaction and log shapes are all identical), so the step is
     the identity — it exists so the chain is explicit and the
     survival test exercises the real path a future conversion will
     take. When a future version DOES change a stored field, add its
     step here and its version to BIOM_DATA_VERSIONS; the app side
     needs no new plumbing.

     v38 -> v39 is likewise an ADOPTION: v39 changes only the Show
     & Pay win rule (the fast win on the matched pair) and startup
     pre-warming — no stored field changes shape, so its step is
     also the identity, and a v38 enrolment opens under v39 with
     the person, palm codes and points intact.

     v39 -> v40 is likewise an ADOPTION: v40 changes only the
     screen-spoof gate's sampling (palm-hull masking + the coverage
     requirement for grid-alone conviction) — no stored field
     changes shape, so its step is also the identity, and a v39
     enrolment opens under v40 with the person, palm codes and
     points intact.

     v40 -> v41 is likewise an ADOPTION: v41 changes only the
     PROBE side of palmprint verification (the geometric variant
     re-encodes in PALMPRINT_GEO_VARIANTS) — enrolled codes are
     read exactly as before and benefit from the fix unchanged,
     so its step is also the identity, and a v40 enrolment opens
     under v41 with the person, palm codes and points intact.

     v41 -> v42 is a CONVERSION, the first since the chain began:
     v42 adds the demonstration wallet, so every person row gains
     a wallet (balance 0, empty statement, no linked accounts) via
     walletEnsurePerson. Every existing field — name, palm codes,
     points, limits, the linked provider wallet — is carried over
     untouched; only the people store is rewritten, and only when
     at least one person actually lacked a sane wallet. A person
     who already HAS a sane wallet (any store written by v42
     itself) is returned by identity, so this step can never reset
     a balance or wipe a statement, and re-running it is a no-op.

     v42 -> v43 is an ADOPTION: v43 changes how scans are captured
     (hands-free auto-start/auto-trigger, the guidance pill, the
     cooldown session) and how enrolment banks codes (per-pose
     selection; a profile MAY gain an optional poses array aligned
     with its codes, written only by v43 enrolment/top-up saves —
     readers ignore it and profiles without it stay fully valid).
     No stored field changes shape, so its step is the identity,
     and a v42 store — wallet balance, statement and linked
     accounts included — opens under v43 byte-identical.

     v43 -> v44 is an ADOPTION: v44 changes only how long scans
     run and what they report (the wall-clock scan budget, the
     geometric-variant band gate, per-stage scan diagnostics, the
     320 px analysis copy) — matching semantics for judged frames,
     enrolment and wallet shapes are all unchanged, and no stored
     field changes shape, so its step is the identity, and a v43
     store — enrolment codes, wallet balance, statement and linked
     accounts included — opens under v44 byte-identical.

     v44 -> v45 is a CONVERSION of the palm-profile FORMAT only,
     ordered by the Chairman's Palm-X override (2026-11-23 18:21):
     v45 reads bit-packed templates from the 96x96 affine patch;
     a v3 byte-code profile cannot be read by that pipeline and
     cannot be converted (different patch, different packing).
     The step therefore does the honest minimum: every person
     record, Biom ID, wallet, balance, statement, linked account,
     points and every other field carries over BYTE-IDENTICAL,
     and each legacy palm profile is MARKED, never deleted — its
     codes move verbatim into the profile's legacyCodes archive
     field, codes becomes empty, format becomes 'legacy' and
     rescanNeeded is set, so the Registry shows "Palm re-scan
     needed" and the person re-banks the palm once (Registry →
     Add Angles) before scanning works again. Profiles already in
     the v4 packed format, and people without a palm profile, are
     returned by identity. The step is idempotent: a marked
     profile is recognised by its format + archive and skipped.

     v45 -> v46 is an ADOPTION: v46 changes no stored field. It
     adds the user-operated Delete All Data action (see the wipe
     section below) — a deliberate manual erase by the device
     owner, behind a type-to-confirm flow, ordered by the Chairman
     2026-11-23 21:40 so he can clear his own device's registry and
     re-register cleanly. That action is NOT a migration step and
     does not weaken the rule above: updates still migrate and
     never wipe; only the owner's own confirmed tap erases. The
     step here is the identity, and a v45 store — wallet balance,
     statement and linked accounts included — opens under v46
     byte-identical.

     v46 -> v47 is an ADOPTION: v47 adds the PalmNet neural
     matcher ALONGSIDE EDCC. Neural embeddings live in an OPTIONAL
     profile.neural field written only by v47 enrolment, Add
     Angles and the Registry's Neural scan capture — no existing
     field changes shape, nothing needs converting, and a profile
     without the field is fully valid (it verifies EDCC-only,
     exactly as under v46). The step is therefore the identity,
     and a v46 store — wallet balance, statement and linked
     accounts included — opens under v47 byte-identical.

     v47 -> v48 is an ADOPTION: v48 changes no stored field. It
     reworks only the per-view flash (torch) control in app.js —
     the choice becomes a preference that survives stream restarts
     and camera switches and is re-applied to each new back-camera
     track, with capability-honest disabling when a camera has no
     torch (the pure rules live in B.flashUiState /
     B.applyTorchToTrack above). Flash choices were never stored
     data, so the step is the identity, and a v47 store — neural
     banks, wallet balance, statement and linked accounts
     included — opens under v48 byte-identical.

     v48 -> v49 is an ADOPTION: v49 changes no stored field. It
     adds the same-person banking guard, the strict money-scan
     rule (two-frame confirmation + impostor margin) and the
     freeze-proofing bounds — all decision logic in this file
     and app.js, nothing about how a person, wallet or palm
     profile is stored. Field-test records gain OPTIONAL strict-
     rule fields written only by v49 terminal scans; older
     records simply lack them and every reader treats them as
     absent. The step is therefore the identity, and a v48
     store — neural banks, wallet balance, statement and linked
     accounts included — opens under v49 byte-identical.

     v49 -> v50 is an ADOPTION: v50 changes no stored field. It
     is a performance-only release (the enrolment watch loop is
     paced to the camera clock with explicit UI yields, burst
     analysis yields between frames, status text is written only
     on change, the measures scratch canvas is reused) plus one
     user-ordered correction: wallet OPEN no longer runs the
     strict money rule (opening a wallet is a login, not a money
     movement — the rule stays on Add Money, Send Money sender
     authorisation and terminal Biom Pay). No threshold, margin,
     fusion, guard or decision rule changes. The step is
     therefore the identity, and a v49 store — neural banks,
     wallet balance, statement and linked accounts included —
     opens under v50 byte-identical.

     v50 -> v51 is an ADOPTION: v51 changes no stored field's
     shape. It adds hand separation — a palm profile MAY gain an
     optional hand field ('left' | 'right'), written only by
     v51 enrolment and by the first guarded top-up that passes
     on a profile that lacks one; readers treat a missing hand
     as null (no hand evidence, v50 behaviour). Nothing needs
     converting, so the step is the identity, and a v50 store —
     neural banks, wallet balance, statement and linked
     accounts included — opens under v51 byte-identical.

     v51 -> v52 is an ADOPTION: v52 changes no stored field and
     no decision rule. It is a presentation-layer release: the
     regBIOM customer surfaces (wallet home / balance, My
     Account, palm scan, Send / Add Money) are rebuilt to the
     approved designs, reading only the existing stores — wallet
     balance, statement and linked accounts from the wallet,
     the palm identity (Biom ID, profile hand, format) from the
     person record. Matching, thresholds, fusion, the hand gate,
     the banking guard, the strict money rule, flash behaviour,
     enrolment, Field Test and Delete All Data are untouched.
     The step is therefore the identity, and a v51 store —
     neural banks, hand stamps, wallet balance, statement and
     linked accounts included — opens under v52 byte-identical.

     v52 -> v53 is an ADOPTION: v53 changes no stored field and
     no threshold, bar, fusion, guard or gate. It changes what
     a scan frame must be to count toward matching (the
     full-hand frame rule), what a failed scan reports (the
     measured diagnosis panel), and it adds the owner recovery
     path (guarded Add Angles from the failure card, then a
     confirmation-gated re-registration that replaces only the
     named profile's palm bank — an owner action in app.js,
     logged like every banking event; it writes the SAME
     profile shape v45-v52 enrolment writes). The step is
     therefore the identity, and a v52 store — neural banks,
     hand stamps, wallet balance, statement and linked
     accounts included — opens under v53 byte-identical. */
  var BIOM_DATA_VERSIONS = ['v37', 'v38', 'v39', 'v40', 'v41', 'v42', 'v43', 'v44', 'v45', 'v46', 'v47', 'v48', 'v49', 'v50', 'v51', 'v52', 'v53'];
  var BIOM_DATA_STEPS = {
    'v38': function (snap) { return snap; },
    'v39': function (snap) { return snap; },
    'v40': function (snap) { return snap; },
    'v41': function (snap) { return snap; },
    'v43': function (snap) { return snap; },
    'v44': function (snap) { return snap; },
    'v46': function (snap) { return snap; },
    'v47': function (snap) { return snap; },
    'v48': function (snap) { return snap; },
    'v49': function (snap) { return snap; },
    'v50': function (snap) { return snap; },
    'v51': function (snap) { return snap; },
    'v52': function (snap) { return snap; },
    'v53': function (snap) { return snap; },
    'v45': function (snap) {
      var changed = false;
      var people = snap.people.map(function (p) {
        if (!p || typeof p !== 'object') return p;
        var prof = p.palmProfile;
        if (!prof || typeof prof !== 'object') return p;
        if (palmprintProfileFormat(prof) !== 'legacy') return p;
        if (prof.format === 'legacy' && Array.isArray(prof.legacyCodes)) return p; // already marked
        var np = {};
        Object.keys(p).forEach(function (k) { np[k] = p[k]; });
        var nprof = {};
        Object.keys(prof).forEach(function (k) { nprof[k] = prof[k]; });
        nprof.legacyCodes = Array.isArray(prof.codes) ? prof.codes.slice() : [];
        nprof.codes = [];
        nprof.format = 'legacy';
        nprof.rescanNeeded = true;
        np.palmProfile = nprof;
        changed = true;
        return np;
      });
      if (!changed) return snap;
      return { people: people, logs: snap.logs, transactions: snap.transactions, meta: snap.meta };
    },
    'v42': function (snap) {
      var changed = false;
      var people = snap.people.map(function (p) {
        var ensured = walletEnsurePerson(p);
        if (ensured !== p) changed = true;
        return ensured;
      });
      if (!changed) return snap;
      return { people: people, logs: snap.logs, transactions: snap.transactions, meta: snap.meta };
    }
  };
  var BIOM_DATA_STORES = ['people', 'logs', 'transactions', 'meta'];
  function migrateBiomData(snapshot, fromVersion, toVersion) {
    var snap = {};
    BIOM_DATA_STORES.forEach(function (s) {
      snap[s] = snapshot && Array.isArray(snapshot[s]) ? snapshot[s] : [];
    });
    var fromIdx = BIOM_DATA_VERSIONS.indexOf(fromVersion);
    var toIdx = BIOM_DATA_VERSIONS.indexOf(toVersion);
    if (toIdx < 0) toIdx = BIOM_DATA_VERSIONS.length - 1;
    // Unknown/older-than-list writers: start before the first step.
    var start = fromIdx < 0 ? -1 : fromIdx;
    var applied = [];
    for (var i = start + 1; i <= toIdx; i++) {
      var v = BIOM_DATA_VERSIONS[i];
      var step = BIOM_DATA_STEPS[v];
      if (!step) continue;
      var next = step(snap);
      if (next && typeof next === 'object') snap = next;
      applied.push(v);
    }
    var changedStores = [];
    BIOM_DATA_STORES.forEach(function (s) {
      if (!snapshot || snap[s] !== snapshot[s]) changedStores.push(s);
    });
    return {
      snapshot: snap, appliedSteps: applied,
      changedStores: changedStores, changed: changedStores.length > 0
    };
  }

  /* ================= Delete All Data (v46) =======================
     The ONE sanctioned erase in this codebase, and it is not an
     update behaviour: it is the device OWNER's own deliberate
     action (the Chairman's order, 2026-11-23 21:40 — "so i can dlt
     my old registry"), reached from More → Delete All Data behind
     a type-to-confirm flow in app.js. The standing rule above is
     untouched: migrations adopt and preserve, always; nothing in
     the boot or update path calls this.

     wipeBiomData is the pure store-layer half: given the current
     snapshot it returns a fresh EMPTY snapshot in the current
     shape (every store an empty array — a valid first-run store
     that the load/migration path accepts unchanged at the current
     version) plus the per-store counts of what was removed, so
     the UI can state plainly what was deleted. The input snapshot
     is never mutated. The app half (DB.clearAll in app.js) clears
     both persistence backends and re-stamps the data version, so
     after the wipe the device holds exactly what a first run at
     the current version holds: nothing, at the current version. */
  function emptyBiomDataSnapshot() {
    var snap = {};
    BIOM_DATA_STORES.forEach(function (s) { snap[s] = []; });
    return snap;
  }
  function wipeBiomData(snapshot) {
    var removed = {};
    var removedTotal = 0;
    BIOM_DATA_STORES.forEach(function (s) {
      var n = snapshot && Array.isArray(snapshot[s]) ? snapshot[s].length : 0;
      removed[s] = n;
      removedTotal += n;
    });
    return { snapshot: emptyBiomDataSnapshot(), removed: removed, removedTotal: removedTotal };
  }

  var api = {
    FACE_THRESHOLD: FACE_THRESHOLD,
    FACE_MIN_NORM: FACE_MIN_NORM,
    PALM_THRESHOLD: PALM_THRESHOLD,
    FINGER_THRESHOLD: FINGER_THRESHOLD,
    FINGER_CORR_MIN: FINGER_CORR_MIN,
    FINGER_TEXTURE_MIN: FINGER_TEXTURE_MIN,
    euclidean: euclidean,
    faceDescriptorSane: faceDescriptorSane,
    palmDescriptorSane: palmDescriptorSane,
    fingerprintRecordSane: fingerprintRecordSane,
    verifyFace: verifyFace,
    palmDescriptorFromLandmarks: palmDescriptorFromLandmarks,
    verifyPalm: verifyPalm,
    PALM_TEXTURE_MIN: PALM_TEXTURE_MIN,
    PALM_OPEN_MIN: PALM_OPEN_MIN,
    PALM_LIVE_OPEN_MIN: PALM_LIVE_OPEN_MIN,
    PALM_CLOSED_MAX: PALM_CLOSED_MAX,
    PALM_MOVE_MIN_RANGE: PALM_MOVE_MIN_RANGE,
    palmTextureSane: palmTextureSane,
    palmProfileSane: palmProfileSane,
    verifyPalmProfile: verifyPalmProfile,
    palmOpenness: palmOpenness,
    evaluatePalmMovement: evaluatePalmMovement,
    palmUsableOpenFrames: palmUsableOpenFrames,
    selectPalmDescriptor: selectPalmDescriptor,
    selectPalmProfile: selectPalmProfile,
    PALMPRINT_THRESHOLD: PALMPRINT_THRESHOLD,
    PALMPRINT_ROI_SIZE: PALMPRINT_ROI_SIZE,
    palmprintEncode: palmprintEncode,
    palmprintNormaliseRoi: palmprintNormaliseRoi,
    flipGrayHorizontal: flipGrayHorizontal,
    rotateGray: rotateGray,
    palmSpread: palmSpread,
    palmTilt: palmTilt,
    palmStageMet: palmStageMet,
    evaluateMovementSequence: evaluateMovementSequence,
    evaluateMovementSequenceStreaming: evaluateMovementSequenceStreaming,
    screenSpoofCheck: screenSpoofCheck,
    palmRoiRegionPx: palmRoiRegionPx,
    palmHullRegionPx: palmHullRegionPx,
    dedupeSpoofReasons: dedupeSpoofReasons,
    fieldTestStats: fieldTestStats,
    fieldTestCsv: fieldTestCsv,
    PALM_SEQUENCES: PALM_SEQUENCES,
    PALM_STAGE_PROMPTS: PALM_STAGE_PROMPTS,
    PALM_SEQUENCE_WINDOW_MS: PALM_SEQUENCE_WINDOW_MS,
    PALM_SPREAD_MIN: PALM_SPREAD_MIN,
    PALM_TILT_MIN: PALM_TILT_MIN,
    palmprintCodeSane: palmprintCodeSane,
    palmprintSimilarity: palmprintSimilarity,
    edccScoreAtShift: edccScoreAtShift,
    palmRoiFromLandmarks: palmRoiFromLandmarks,
    palmRoiAffineFromLandmarks: palmRoiAffineFromLandmarks,
    PALMPRINT_AFFINE_DEST: PALMPRINT_AFFINE_DEST,
    PALMPRINT_FORMAT: PALMPRINT_FORMAT,
    PALMPRINT_PACK_WORDS: PALMPRINT_PACK_WORDS,
    PALMPRINT_PACK_LEN: PALMPRINT_PACK_LEN,
    PALMPRINT_SHIFTS5: PALMPRINT_SHIFTS5,
    popcount32: popcount32,
    palmprintPackCode: palmprintPackCode,
    palmprintPackedBytes: palmprintPackedBytes,
    palmprintPackedWords: palmprintPackedWords,
    palmprintPackedToBase64: palmprintPackedToBase64,
    palmprintPackedFromBase64: palmprintPackedFromBase64,
    palmprintUnpackCode: palmprintUnpackCode,
    palmprintPackedSane: palmprintPackedSane,
    edccPackedScoreAtShift: edccPackedScoreAtShift,
    palmprintPackedMatch: palmprintPackedMatch,
    palmprintPackedSimilarity: palmprintPackedSimilarity,
    palmBboxWidthFrac: palmBboxWidthFrac,
    palmprintQualityGate: palmprintQualityGate,
    PALMPRINT_QUALITY_MIN_BRIGHTNESS: PALMPRINT_QUALITY_MIN_BRIGHTNESS,
    PALMPRINT_QUALITY_MAX_GLARE_FRAC: PALMPRINT_QUALITY_MAX_GLARE_FRAC,
    PALMPRINT_QUALITY_BLUR_MIN: PALMPRINT_QUALITY_BLUR_MIN,
    PALMPRINT_BBOX_MIN_FRAC: PALMPRINT_BBOX_MIN_FRAC,
    PALMPRINT_BBOX_MAX_FRAC: PALMPRINT_BBOX_MAX_FRAC,
    PALMPRINT_BURST_MS: PALMPRINT_BURST_MS,
    PALMPRINT_BURST_MIN_FRAMES: PALMPRINT_BURST_MIN_FRAMES,
    PALMPRINT_BURST_MAX_FRAMES: PALMPRINT_BURST_MAX_FRAMES,
    PALMPRINT_BURST_TEMPLATES: PALMPRINT_BURST_TEMPLATES,
    palmprintBurstLiveness: palmprintBurstLiveness,
    selectPalmprintBurstCodes: selectPalmprintBurstCodes,
    palmprintProfileFormat: palmprintProfileFormat,
    palmprintProfileFailReason: palmprintProfileFailReason,
    palmprintProfileSane: palmprintProfileSane,
    verifyPalmprintProfile: verifyPalmprintProfile,
    palmprintProbePacked: palmprintProbePacked,
    shiftGrayClamped: shiftGrayClamped,
    PALMPRINT_SHIFT_RANGE: PALMPRINT_SHIFT_RANGE,
    palmprintProbeCodes: palmprintProbeCodes,
    scaleGrayCentre: scaleGrayCentre,
    PALMPRINT_GEO_VARIANTS: PALMPRINT_GEO_VARIANTS,
    palmprintProbeCodesGeo: palmprintProbeCodesGeo,
    verifyPalmprintRois: verifyPalmprintRois,
    verifyPalmprintRoisFast: verifyPalmprintRoisFast,
    verifyPalmprintProfilesRois: verifyPalmprintProfilesRois,
    PALMPRINT_GEO_FLOOR: PALMPRINT_GEO_FLOOR,
    SCAN_TIME_BUDGET_MS: SCAN_TIME_BUDGET_MS,
    palmprintUsableOpenFrames: palmprintUsableOpenFrames,
    selectPalmprintProfileCodes: selectPalmprintProfileCodes,
    PALMPRINT_POSES: PALMPRINT_POSES,
    PALMPRINT_PROFILE_MAX_CODES: PALMPRINT_PROFILE_MAX_CODES,
    palmPoseDescriptor: palmPoseDescriptor,
    palmPoseTag: palmPoseTag,
    palmPoseDescriptorsClose: palmPoseDescriptorsClose,
    selectPalmprintPoseCodes: selectPalmprintPoseCodes,
    mergePalmprintProfileCodes: mergePalmprintProfileCodes,
    palmGuidance: palmGuidance,
    createScanSession: createScanSession,
    palmprintConsensusCode: palmprintConsensusCode,
    selectPalmprintLiveCodes: selectPalmprintLiveCodes,
    selectPalmprintLiveRois: selectPalmprintLiveRois,
    palmFramePose: palmFramePose,
    palmFramingHint: palmFramingHint,
    palmFrameCompleteness: palmFrameCompleteness,
    scanDiagnosisLines: scanDiagnosisLines,
    PALM_FRAME_TIP_MARGIN: PALM_FRAME_TIP_MARGIN,
    PALM_FRAME_MAX_SPAN: PALM_FRAME_MAX_SPAN,
    PALM_FRAME_MIN_SPAN: PALM_FRAME_MIN_SPAN,
    passiveLivenessCheck: passiveLivenessCheck,
    passiveLivenessPairCheck: passiveLivenessPairCheck,
    streamMatchUpdate: streamMatchUpdate,
    streamFastWinCheck: streamFastWinCheck,
    palmprintWorkerSource: palmprintWorkerSource,
    PALMNET_INPUT_SIZE: PALMNET_INPUT_SIZE,
    PALMNET_EMBED_DIM: PALMNET_EMBED_DIM,
    PALMNET_THRESHOLD: PALMNET_THRESHOLD,
    PALMNET_MEAN: PALMNET_MEAN,
    PALMNET_STD: PALMNET_STD,
    PALMNET_PROFILE_MAX_EMBEDDINGS: PALMNET_PROFILE_MAX_EMBEDDINGS,
    PALMNET_DEDUPE_COSINE: PALMNET_DEDUPE_COSINE,
    palmnetPreprocessRoi: palmnetPreprocessRoi,
    palmnetPreprocessSource: palmnetPreprocessSource,
    palmnetNormaliseEmbedding: palmnetNormaliseEmbedding,
    palmnetEmbeddingSane: palmnetEmbeddingSane,
    palmnetCosine: palmnetCosine,
    palmnetEmbeddingToBase64: palmnetEmbeddingToBase64,
    palmnetEmbeddingFromBase64: palmnetEmbeddingFromBase64,
    palmnetProfileEmbeddings: palmnetProfileEmbeddings,
    palmnetProfileSane: palmnetProfileSane,
    palmnetNeedsScan: palmnetNeedsScan,
    palmnetBankFromEmbeddings: palmnetBankFromEmbeddings,
    mergePalmnetEmbeddings: mergePalmnetEmbeddings,
    palmnetScoreEmbeddings: palmnetScoreEmbeddings,
    palmnetScoreProfile: palmnetScoreProfile,
    fusePalmVerifyResults: fusePalmVerifyResults,
    palmprintPackedCandidates: palmprintPackedCandidates,
    palmAnatomicalHand: palmAnatomicalHand,
    palmMpHandedness: palmMpHandedness,
    palmProfileHand: palmProfileHand,
    handGateBlocks: handGateBlocks,
    palmConsensusHand: palmConsensusHand,
    HAND_CROSS_MIN_RATIO: HAND_CROSS_MIN_RATIO,
    MONEY_CONFIRM_FRAMES: MONEY_CONFIRM_FRAMES,
    MONEY_MARGIN_EDCC: MONEY_MARGIN_EDCC,
    MONEY_MARGIN_NEURAL: MONEY_MARGIN_NEURAL,
    createMoneyScanGate: createMoneyScanGate,
    moneyMarginCheck: moneyMarginCheck,
    bankingGuardCheck: bankingGuardCheck,
    withTimeout: withTimeout,
    laplacianVariance: laplacianVariance,
    contrastStretch: contrastStretch,
    sharpen: sharpen,
    adaptiveThreshold: adaptiveThreshold,
    downscaleTemplate: downscaleTemplate,
    lbpHistogram: lbpHistogram,
    imageStats: imageStats,
    fingerprintQuality: fingerprintQuality,
    pearsonCorrelation: pearsonCorrelation,
    histogramSimilarity: histogramSimilarity,
    verifyFingerprint: verifyFingerprint,
    normaliseWalletNumber: normaliseWalletNumber,
    maskWalletNumber: maskWalletNumber,
    WALLET_ACCOUNT_TYPES: WALLET_ACCOUNT_TYPES,
    walletNew: walletNew,
    walletSane: walletSane,
    walletEnsurePerson: walletEnsurePerson,
    walletValidateAmount: walletValidateAmount,
    walletDemoRef: walletDemoRef,
    walletAuthorised: walletAuthorised,
    walletAddLinkedAccount: walletAddLinkedAccount,
    walletApplyAddMoney: walletApplyAddMoney,
    walletResolveReceiver: walletResolveReceiver,
    walletApplySend: walletApplySend,
    applyTorchToTrack: applyTorchToTrack,
    flashUiState: flashUiState,
    FLASH_NOTE_NOT_AVAILABLE: FLASH_NOTE_NOT_AVAILABLE,
    FLASH_NOTE_FRONT: FLASH_NOTE_FRONT,
    FLASH_NOTE_PENDING: FLASH_NOTE_PENDING,
    migrateBiomData: migrateBiomData,
    wipeBiomData: wipeBiomData,
    emptyBiomDataSnapshot: emptyBiomDataSnapshot,
    BIOM_DATA_VERSIONS: BIOM_DATA_VERSIONS,
    BIOM_DATA_STORES: BIOM_DATA_STORES
  };

  global.TSGBiometrics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
