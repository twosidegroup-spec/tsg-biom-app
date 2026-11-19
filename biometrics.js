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
  var PALM_OPEN_MIN = 1.75;       // openness at/above this = open hand (open synthetic: 2.08)
  var PALM_CLOSED_MAX = 1.45;     // openness at/below this = closed hand (fist synthetic: 1.15)
  var PALM_MOVE_MIN_RANGE = 0.45; // openness must swing at least this far during the scan
  var PALM_MOVE_MIN_SAMPLES = 6;  // and be observed over at least this many samples

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
     range, and the hand ENDS open (the capture that follows is an open
     palm). A static image produces a near-constant series and fails. */
  function evaluatePalmMovement(samples) {
    var vals = (samples || []).filter(function (v) { return typeof v === 'number' && isFinite(v); });
    var out = { ok: false, pass: false, samples: vals.length, min: null, max: null, last: null, range: null, reason: 'Not enough hand movement observed.' };
    if (vals.length < PALM_MOVE_MIN_SAMPLES) { out.reason = 'Movement check needs a few seconds of hand movement - open, close, then open your palm.'; return out; }
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), last = vals[vals.length - 1];
    out.min = min; out.max = max; out.last = last; out.range = max - min;
    if (max < PALM_OPEN_MIN) out.reason = 'Open your palm wide, fingers spread, so the camera can see it fully.';
    else if (min > PALM_CLOSED_MAX) out.reason = 'Now close your hand into a loose fist, then open it again - a still image cannot pass this check.';
    else if (out.range < PALM_MOVE_MIN_RANGE) out.reason = 'The open-close movement was too small - close fully into a loose fist, then open wide.';
    else if (last < PALM_OPEN_MIN) out.reason = 'Finish with your palm open wide.';
    else { out.ok = true; out.pass = true; out.reason = 'Live hand movement confirmed (open - close - open).'; }
    return out;
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
    PALM_CLOSED_MAX: PALM_CLOSED_MAX,
    PALM_MOVE_MIN_RANGE: PALM_MOVE_MIN_RANGE,
    palmTextureSane: palmTextureSane,
    palmProfileSane: palmProfileSane,
    verifyPalmProfile: verifyPalmProfile,
    palmOpenness: palmOpenness,
    evaluatePalmMovement: evaluatePalmMovement,
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
    maskWalletNumber: maskWalletNumber
  };

  global.TSGBiometrics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
