/* TSG Biom PWA - app logic. Real scanning only; every verification result in
   this file comes from TSGBiometrics comparisons of real captured data. */
(function () {
  'use strict';
  var B = window.TSGBiometrics;
  var STORES = ['GreenCare Pharmacy (CVS)', 'FreshMart Supermarket', 'UrbanStyle Retail', 'City Centre Mall'];
  var PAY_STATUS = 'Biometric Authorised — Pending Provider Settlement';

  /* ---------------- Data migration (standing order, 2026-11-23) -----
     "from now keep data dont wipe": an app update NEVER clears the
     on-device store. When APP_DATA_VERSION moves, the stored people,
     enrolled palm codes, points, transactions and logs are MIGRATED
     forward and adopted — B.migrateBiomData (biometrics.js) holds
     the version chain and the contract every future step must obey
     (idempotent, preserving; convert fields, never drop rows).
     Bump APP_DATA_VERSION together with the service-worker shell on
     any build that changes enrolment or matching, and add a step in
     biometrics.js if — and only if — the build changes a stored
     field's shape.

     DO NOT reintroduce a wipe here. The pre-v38 behaviour (every
     build started empty; the whole IndexedDB database was deleted
     on first open) was retired by the Chairman's direct order after
     it forced a fresh enrolment on every update. There is no build
     mode that wipes: development and commercial builds migrate
     identically.

     Mechanics: the localStorage snapshot is migrated here, before
     boot, and only stores the migration actually changed are
     written back. The IndexedDB copy holds the same record shapes;
     it is migrated in boot, right after DB.open() (see
     migrateDbStores below), and likewise only changed stores are
     written back. The version stamp is written only after the
     localStorage migration has run; if anything throws, the stamp
     is skipped, nothing is deleted, and the next launch retries —
     the app boots on the un-migrated data either way, because its
     readers fail closed per record. */
  var APP_DATA_VERSION = 'v43';
  var DV_KEY = 'tsgbiom_data_version';
  var dataMigratedFrom = null;
  try {
    var storedDv = localStorage.getItem(DV_KEY);
    if (storedDv !== APP_DATA_VERSION) {
      var lsSnap = {};
      B.BIOM_DATA_STORES.forEach(function (s) {
        try { lsSnap[s] = JSON.parse(localStorage.getItem('tsgbiom_' + s) || '[]'); }
        catch (e) { lsSnap[s] = []; }
        if (!Array.isArray(lsSnap[s])) lsSnap[s] = [];
      });
      var lsMig = B.migrateBiomData(lsSnap, storedDv, APP_DATA_VERSION);
      lsMig.changedStores.forEach(function (s) {
        // 'logs' rows are plain array entries in the localStorage
        // form, so a changed logs array writes back like any store.
        try { localStorage.setItem('tsgbiom_' + s, JSON.stringify(lsMig.snapshot[s])); } catch (e) {}
      });
      dataMigratedFrom = storedDv;
      try { localStorage.setItem(DV_KEY, APP_DATA_VERSION); } catch (e) {}
    }
  } catch (e) { dataMigratedFrom = null; }

  /* ---------------- Storage: IndexedDB with localStorage fallback -------- */
  var DB = {
    db: null, useLS: false,
    open: function () {
      var self = this;
      return new Promise(function (resolve) {
        if (!('indexedDB' in window)) { self.useLS = true; resolve(); return; }
        // v31: an open() that never settles (blocked by a pending
        // deletion or another instance) previously left db null with
        // useLS false, and the first save threw a raw null error.
        // Fall back to localStorage for the session on blocked, on
        // error, or after 2.5 s unsettled - the app stays fully
        // functional either way.
        var settled = false;
        var settle = function (useLS, db) {
          if (settled) { if (db) try { db.close(); } catch (e) {} return; }
          settled = true;
          if (db) self.db = db; else self.useLS = true;
          resolve();
        };
        var req;
        try { req = indexedDB.open('tsg-biom', 1); } catch (e) { settle(true); return; }
        req.onupgradeneeded = function () {
          var db = req.result;
          db.createObjectStore('people', { keyPath: 'id' });
          db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
          db.createObjectStore('transactions', { keyPath: 'id' });
          db.createObjectStore('meta', { keyPath: 'key' });
        };
        req.onsuccess = function () { settle(false, req.result); };
        req.onerror = function () { settle(true); };
        req.onblocked = function () { settle(true); };
        setTimeout(function () { settle(true); }, 2500);
      });
    },
    lsGet: function (store) { try { return JSON.parse(localStorage.getItem('tsgbiom_' + store) || '[]'); } catch (e) { return []; } },
    lsSet: function (store, rows) { try { localStorage.setItem('tsgbiom_' + store, JSON.stringify(rows)); } catch (e) {} },
    put: function (store, value) {
      var self = this;
      if (this.useLS || !this.db) {
        var rows = this.lsGet(store);
        if (store === 'meta') {
          var i = rows.findIndex(function (r) { return r.key === value.key; });
          if (i >= 0) rows[i] = value; else rows.push(value);
        } else if (value.id) {
          var j = rows.findIndex(function (r) { return r.id === value.id; });
          if (j >= 0) rows[j] = value; else rows.push(value);
        } else rows.push(value);
        this.lsSet(store, rows);
        return Promise.resolve(value);
      }
      return new Promise(function (resolve, reject) {
        var tx = self.db.transaction(store, 'readwrite');
        var req = tx.objectStore(store).put(value);
        req.onsuccess = function () { resolve(value); };
        req.onerror = function () { reject(req.error); };
      });
    },
    all: function (store) {
      var self = this;
      if (this.useLS || !this.db) return Promise.resolve(this.lsGet(store));
      return new Promise(function (resolve, reject) {
        var req = self.db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    },
    getMeta: function (key, fallback) {
      return this.all('meta').then(function (rows) {
        var row = rows.find(function (r) { return r.key === key; });
        return row ? row.value : fallback;
      });
    },
    setMeta: function (key, value) { return this.put('meta', { key: key, value: value }); },
    nextSeq: function (key, base) {
      var self = this;
      return this.getMeta(key, base).then(function (v) {
        return self.setMeta(key, v + 1).then(function () { return v; });
      });
    }
  };

  /* IndexedDB-side data migration (v38, see the standing order at
     APP_DATA_VERSION): runs once per data version, right after
     DB.open(), under its own stamp ('tsgbiom_db_version') so a
     launch interrupted between the localStorage migration and this
     one retries here instead of skipping. Loads the four stores,
     runs the same B.migrateBiomData chain, and writes back ONLY the
     stores the migration changed. 'logs' is never written back from
     here: its IndexedDB store uses autoIncrement keys that getAll()
     does not return, so putting rows back would duplicate them —
     a future step that must change log rows needs a dedicated
     clear-and-rewrite path, not this hook. When DB fell back to
     localStorage for the session this re-runs over the snapshot the
     startup block already migrated; the chain is idempotent, so it
     changes nothing and writes nothing. Resolves true when it ran. */
  var DBV_KEY = 'tsgbiom_db_version';
  function migrateDbStores() {
    var stamped = null;
    try { stamped = localStorage.getItem(DBV_KEY); } catch (e) {}
    if (stamped === APP_DATA_VERSION && !dataMigratedFrom) return Promise.resolve(false);
    return Promise.all(B.BIOM_DATA_STORES.map(function (s) { return DB.all(s); })).then(function (rows) {
      var snap = {};
      B.BIOM_DATA_STORES.forEach(function (s, i) { snap[s] = rows[i]; });
      var mig = B.migrateBiomData(snap, stamped || dataMigratedFrom, APP_DATA_VERSION);
      var writes = mig.changedStores.filter(function (s) { return s !== 'logs'; }).map(function (s) {
        return Promise.all(mig.snapshot[s].map(function (row) { return DB.put(s, row); }));
      });
      return Promise.all(writes).then(function () {
        try { localStorage.setItem(DBV_KEY, APP_DATA_VERSION); } catch (e) {}
        return true;
      });
    }).catch(function () { return false; });
  }

  /* ---------------- Small helpers ---------------------------------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    setTimeout(function () { t.classList.add('hidden'); }, 4200);
  }
  function fmtTime(ts) { return new Date(ts).toLocaleString(); }
  function isToday(ts) { var d = new Date(ts), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); }

  /* ---------------- Camera manager --------------------------------------- */
  var Cam = {
    stream: null, video: null, viewKey: null, _token: 0, _starting: null, _startVideo: null, _startKey: null,
    start: function (video, facingMode, viewKey) {
      // A second start for the same view while one is already in flight
      // (double tap, or a camera/flash toggle restarting the view) joins
      // the in-flight start instead of racing it - racing starts are
      // what produced "The play() request was interrupted by a new load
      // request" on the phone (2026-11-20).
      if (this._starting && this._startVideo === video && this._startKey === (viewKey || null)) return this._starting;
      var token = ++this._token;
      this.stop();
      this.video = video;
      this.viewKey = viewKey || null;
      // Preview mirroring is DISPLAY ONLY and only for the front camera.
      // Captures always use the raw video frame (drawImage / detectors read
      // the untransformed pixels), so enrolling on one camera and verifying
      // on the other still compares consistently.
      video.classList.toggle('mirror', facingMode === 'user');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Promise.reject(new Error('This browser does not expose a camera (getUserMedia unavailable). Open TSG Biom over HTTPS in Chrome or Safari.'));
      }
      function playWithRetry() {
        return video.play().catch(function (err) {
          // AbortError = play() was interrupted by a load/srcObject
          // change. If this start is still the current one and the
          // stream is still attached, one short-delay retry recovers it.
          if (err && err.name === 'AbortError' && token === Cam._token && video.srcObject) {
            return new Promise(function (res) { setTimeout(res, 300); }).then(function () { return video.play(); });
          }
          throw err;
        });
      }
      // Constraint ladder (v17): a bare-string facingMode is an EXACT
      // requirement, and on multi-lens Android phones the exact request
      // is the classic OverconstrainedError - the camera "troubles" on
      // both front and back. Try exact first, then the same facing as a
      // preference, then any camera at all - a working camera on the
      // other side beats no camera. NotReadableError means the previous
      // camera has not released yet: wait briefly and retry the ladder
      // once before giving up.
      function gum(facing, exact) {
        // v38: scanner-appropriate resolution. The scan only ever
        // reads the palm square (warped to a fixed 128x128 ROI from
        // landmark geometry, which is scale-normalised), so a
        // 1280x720 sensor stream bought pixels the pipeline never
        // uses while every grab, copy and analysis moved them.
        // 640x480 keeps the palm square at several hundred source
        // pixels at checkout distance — multiples of the ROI size.
        var v = { width: { ideal: 640 }, height: { ideal: 480 } };
        if (facing) v.facingMode = exact ? facing : { ideal: facing };
        return navigator.mediaDevices.getUserMedia({ video: v, audio: false });
      }
      function openCamera() {
        return gum(facingMode, true).catch(function (e1) {
          if (e1 && (e1.name === 'OverconstrainedError' || e1.name === 'NotFoundError')) return gum(facingMode, false);
          throw e1;
        }).catch(function (e2) {
          if (e2 && (e2.name === 'OverconstrainedError' || e2.name === 'NotFoundError')) return gum(null, false);
          throw e2;
        }).catch(function (e3) {
          if (e3 && e3.name === 'NotReadableError') {
            return new Promise(function (res) { setTimeout(res, 700); }).then(function () { return gum(facingMode, false); });
          }
          throw e3;
        });
      }
      // Capture tuning (v21): ask the track for continuous auto-focus
      // and continuous auto-exposure, metered on the centre of the
      // frame, so palm creases stay sharp instead of the lens hunting
      // to the background. Every key is
      // capability-gated: Android Chrome exposes focusMode on many
      // devices, iOS Safari exposes almost none of this - unsupported
      // keys are skipped silently and the stream runs as before.
      function applyCaptureTuning(stream) {
        try {
          var track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
          if (!track || !track.getCapabilities || !track.applyConstraints) return Promise.resolve();
          var caps = track.getCapabilities() || {};
          var adv = {};
          if (caps.focusMode && caps.focusMode.indexOf('continuous') !== -1) adv.focusMode = 'continuous';
          if (caps.exposureMode && caps.exposureMode.indexOf('continuous') !== -1) adv.exposureMode = 'continuous';
          if (caps.pointsOfInterest) adv.pointsOfInterest = [{ x: 0.5, y: 0.5 }];
          if (!Object.keys(adv).length) return Promise.resolve();
          return track.applyConstraints({ advanced: [adv] }).catch(function () {});
        } catch (e) { return Promise.resolve(); }
      }
      var p = openCamera().then(function (stream) {
        if (token !== Cam._token) { // a newer start superseded this one
          stream.getTracks().forEach(function (t) { t.stop(); });
          return null;
        }
        Cam.stream = stream;
        video.srcObject = stream;
        return playWithRetry().then(function () {
          // Flash is MANUAL only - it is never turned on automatically.
          // The one exception to "only from the toggle": if the user had
          // already chosen Flash On for this view before the camera
          // started, honour that explicit choice now (via the same
          // apply helper the toggle uses).
          if (viewKey && typeof flashState !== 'undefined' && flashState[viewKey]) {
            return applyFlashForKey(viewKey).then(function () { return stream; });
          }
          return stream;
        }).then(function () {
          return applyCaptureTuning(stream).then(function () { return stream; });
        });
      });
      this._starting = p;
      this._startVideo = video;
      this._startKey = viewKey || null;
      var clear = function () { if (Cam._starting === p) { Cam._starting = null; Cam._startVideo = null; Cam._startKey = null; } };
      p.then(clear, clear);
      return p;
    },
    stop: function () {
      if (this.stream) {
        this.stream.getTracks().forEach(function (t) { t.stop(); });
        this.stream = null;
        // The old track is gone, so that view's flash choice resets to Off.
        if (this.viewKey && typeof resetFlash === 'function') resetFlash(this.viewKey);
      }
      if (this.video) { try { this.video.srcObject = null; } catch (e) {} }
    }
  };

  function cameraErrorHTML(err) {
    return '<div class="error">Camera unavailable: ' + esc(err && err.message ? err.message : err) +
      '<br>Allow camera permission for this site and retry. TSG Biom does not simulate a scan when the camera is blocked.</div>';
  }

  /* ---------------- Per-step camera choice (Front / Back) -----------------
     Every camera view has its own independent Front | Back toggle.
     Palm-only product (v33): the enrolment palm step and the terminal
     each keep their own choice for the whole session. Default Front. */
  var camFacing = {
    enrollPalm: 'user', termPalm: 'user', walletOpen: 'user', walletAct: 'user', topup: 'user'
  };
  /* v43: every camera view's video element, by toggle group key —
     the wallet scan card and the add-angles view gained toggles of
     their own, so the old two-way choice became this map. */
  var CAM_VIDEO_IDS = { enrollPalm: 'palmVideo', terminal: 'termVideo', walletAct: 'wScanVideo', walletOpen: 'wScanVideo', topup: 'topVideo' };
  function camVideoId(groupKey) { return CAM_VIDEO_IDS[groupKey] || 'termVideo'; }
  var camRestarters = {}; // key -> function that (re)starts that view's camera
  function termFacingKey() { return 'termPalm'; }
  function syncCamToggle(key) {
    document.querySelectorAll('[data-cam-toggle="' + key + '"] button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.facing === camFacing[key === 'terminal' ? termFacingKey() : key]);
    });
  }
  function applyMirror(videoId, facing) { var v = $(videoId); if (v) v.classList.toggle('mirror', facing === 'user'); }
  function wireCamToggles() {
    document.querySelectorAll('[data-cam-toggle]').forEach(function (group) {
      var groupKey = group.dataset.camToggle;
      group.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          var key = groupKey === 'terminal' ? termFacingKey() : groupKey;
          if (camFacing[key] === b.dataset.facing) return;
          camFacing[key] = b.dataset.facing;
          syncCamToggle(groupKey);
          // If this view's camera is live, restart it on the new camera.
          var restart = camRestarters[groupKey];
          var videoId = camVideoId(groupKey);
          applyMirror(videoId, b.dataset.facing);
          if (restart && Cam.stream && Cam.video === $(videoId)) restart();
        });
      });
    });
  }

  /* ---------------- Per-view flash (torch) choice -------------------------
     Flash is INDEPENDENT and MANUAL - never automatic. Every camera view
     has its own Flash Off | Flash On toggle next to its Front | Back
     toggle, default OFF, remembered per view in
     this state object - keyed exactly like camFacing. The ONLY code that
     ever lights the torch is applyTorchToCurrentTrack below, and it is
     only ever called from the flash toggle handler or, when a camera
     starts, to honour a Flash On the user had already chosen for that
     view. Switching camera or stopping the camera resets that view's
     flash to Off (see Cam.stop). */
  var flashState = {
    enrollPalm: false, termPalm: false, walletOpen: false, walletAct: false, topup: false
  };
  function flashGroupKey(key) { return key.indexOf('term') === 0 ? 'terminal' : key; }
  function flashKeyForGroup(groupKey) { return groupKey === 'terminal' ? termFacingKey() : groupKey; }
  function flashVideoId(groupKey) {
    return camVideoId(groupKey);
  }
  function syncFlashToggle(groupKey) {
    var key = flashKeyForGroup(groupKey);
    document.querySelectorAll('[data-flash-toggle="' + groupKey + '"] button').forEach(function (b) {
      b.classList.toggle('on', (b.dataset.flash === 'on') === !!flashState[key]);
    });
  }
  function setFlashNote(groupKey, text) {
    var n = document.querySelector('[data-flash-note="' + groupKey + '"]');
    if (n) n.textContent = text || '';
  }
  function resetFlash(key) {
    if (!key || !(key in flashState)) return;
    flashState[key] = false;
    syncFlashToggle(flashGroupKey(key));
    setFlashNote(flashGroupKey(key), '');
  }
  /* The single place in the app that applies the torch constraint.
     Resolves true only when the live track actually accepted it. */
  function applyTorchToCurrentTrack(on) {
    var track = Cam.stream && Cam.stream.getVideoTracks ? Cam.stream.getVideoTracks()[0] : null;
    if (!track || !track.applyConstraints) return Promise.resolve(false);
    var caps = {};
    try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (e) {}
    if (!caps.torch) return Promise.resolve(false); // not supported on this camera/device
    return track.applyConstraints({ advanced: [{ torch: !!on }] })
      .then(function () { return true; })
      .catch(function () { return false; });
  }
  /* Honour view key's stored Flash On against the live track. If the
     camera/device has no torch, say so plainly and leave flash Off. */
  function applyFlashForKey(key) {
    var groupKey = flashGroupKey(key);
    if (!flashState[key]) { setFlashNote(groupKey, ''); return Promise.resolve(); }
    return applyTorchToCurrentTrack(true).then(function (ok) {
      if (!ok) {
        flashState[key] = false;
        syncFlashToggle(groupKey);
        setFlashNote(groupKey, 'Flash is not available on this camera/device.');
      } else {
        setFlashNote(groupKey, '');
      }
    });
  }
  function wireFlashToggles() {
    document.querySelectorAll('[data-flash-toggle]').forEach(function (group) {
      var groupKey = group.dataset.flashToggle;
      group.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          var key = flashKeyForGroup(groupKey);
          var wantOn = b.dataset.flash === 'on';
          if (!!flashState[key] === wantOn) { syncFlashToggle(groupKey); return; }
          flashState[key] = wantOn;
          syncFlashToggle(groupKey);
          var live = Cam.stream && Cam.video === $(flashVideoId(groupKey));
          if (!wantOn) {
            setFlashNote(groupKey, '');
            if (live) applyTorchToCurrentTrack(false);
            return;
          }
          if (live) {
            applyFlashForKey(key);
          } else {
            // Camera not started yet: remember the choice; it is applied
            // when the camera starts - because the user chose it.
            setFlashNote(groupKey, 'Flash is set On - it will light when this camera starts.');
          }
        });
      });
    });
  }

  /* ---------------- Palm CLIP capture (recorded-clip path) --------------
     Why this exists: the live-stream palm path kept failing on a real
     phone (camera start races, inference lag behind the real hand, and
     the mixed-frame averaging trap after the movement check). The clip
     path records a few seconds of real frames first, then analyses
     them one by one with a dedicated Hands processor: movement
     liveness from the openness series, and (v9) a palmprint code from
     each genuine open-palm frame — the landmarks locate the palm
     square, the EDCC encoder reads the print inside it. Legacy v2
     geometry descriptors are still computed per frame so older
     enrolments keep verifying. A single still photo is NOT accepted
     anywhere: with no movement series there is no liveness, so there
     is no scan. */
  /* Analysis-resolution cap (v38): MediaPipe's palm detector reads
     a 256px resize of whatever it is sent and the landmark model a
     fixed-size crop, so input resolution past ~480px on the long
     side buys almost no landmark quality — but the image is handed
     to the graph at full size on every analysed frame, and moving
     those pixels is a real per-frame cost on a phone. Landmarks come
     back NORMALISED (0..1 of the sent image), so landmarks read from
     a downscaled copy of a frame address the original frame with
     the same coordinates: the ROI warp, the texture measures and
     the spoof region all keep reading the full grabbed frame,
     unchanged. Only the detector's input shrinks. The scratch
     canvas follows the same discipline as the verify loop's reused
     capture canvas: it is redrawn only inside a landmarks() call,
     and every pipeline awaits a call's results before the next. */
  var ANALYSIS_MAX = 480;
  var analysisScratch = null;
  function analysisImage(image) {
    var w = image && image.width, h = image && image.height;
    if (!w || !h || Math.max(w, h) <= ANALYSIS_MAX) return image;
    var scale = ANALYSIS_MAX / Math.max(w, h);
    if (!analysisScratch) analysisScratch = document.createElement('canvas');
    analysisScratch.width = Math.round(w * scale);
    analysisScratch.height = Math.round(h * scale);
    analysisScratch.getContext('2d').drawImage(image, 0, 0, analysisScratch.width, analysisScratch.height);
    return analysisScratch;
  }

  var PalmProc = {
    hands: null, pending: null,
    init: function () {
      if (this.hands) return;
      var self = this;
      this.hands = new Hands({ locateFile: function (f) { return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/' + f; } });
      // v25 A/B: lite landmark model (complexity 0) - the full model
      // is the per-frame bottleneck on a budget phone CPU.
      this.hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      this.hands.onResults(function (res) {
        var p = self.pending; self.pending = null;
        if (p) p((res.multiHandLandmarks && res.multiHandLandmarks[0]) ? res.multiHandLandmarks[0] : null);
      });
    },
    landmarks: function (image) {
      var self = this;
      this.init();
      return new Promise(function (resolve) {
        // Orphan guard: a caller still waiting when a new call arrives
        // is released with null - a silently replaced resolver would
        // hang that caller forever.
        if (self.pending) { var stale = self.pending; self.pending = null; stale(null); }
        var doneFlag = false;
        var finish = function (lm) {
          if (doneFlag) return;
          doneFlag = true;
          clearTimeout(to);
          if (self.pending === finish) self.pending = null;
          resolve(lm);
        };
        // Dropped-frame timeout + rebuild: if onResults never fires
        // for a frame (the MediaPipe graph can drop one), the old code
        // waited forever and the whole scan froze with no message -
        // the v21 phone enrolment stall, 2026-11-20. After 4 s the
        // frame counts as no-hand and the Hands instance is rebuilt,
        // because a wedged graph stays wedged.
        var to = setTimeout(function () {
          try { if (self.hands && self.hands.close) self.hands.close(); } catch (e) {}
          self.hands = null;
          finish(null);
        }, 4000);
        self.pending = finish;
        self.hands.send({ image: analysisImage(image) }).catch(function () { finish(null); });
      });
    }
  };

  function grabVideoFrame(video) {
    var w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    // v38: grab cap matches the scanner resolution requested from
    // the camera (640) — a device that negotiates a larger stream
    // anyway is still analysed at scanner size, never at 960.
    var scale = Math.min(1, 640 / Math.max(w, h));
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /* Same grab into a caller-owned canvas (v37). Only safe when the
     frame is fully analysed before the next grab — the Show & Pay
     verify loop guarantees that (analysis is awaited per frame), so
     it reuses one canvas instead of allocating a full-frame canvas
     per snap. Enrolment keeps grabVideoFrame: its bursts STORE the
     frames for later analysis, so each needs its own canvas. */
  function grabVideoFrameInto(video, canvas) {
    var w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    var scale = Math.min(1, 640 / Math.max(w, h));
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /* Palm texture + sharpness from any image source (a recorded frame
     here; the same maths the live captureTexture used), cropped around
     the detected hand so it is the palm's own texture. */
  function palmFrameMeasures(source, sw, sh, lm) {
    try {
      if (!lm || !sw || !sh) return { texture: null, sharpness: 0 };
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      lm.forEach(function (p) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      });
      var cx = (minX + maxX) / 2 * sw, cy = (minY + maxY) / 2 * sh;
      var side = Math.max(maxX - minX, maxY - minY) * 1.15 * Math.max(sw, sh);
      side = Math.min(side, sw, sh);
      if (!(side >= 40)) return { texture: null, sharpness: 0 };
      var sx = Math.max(0, Math.min(sw - side, cx - side / 2));
      var sy = Math.max(0, Math.min(sh - side, cy - side / 2));
      var size = 128;
      var canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
      var img = ctx.getImageData(0, 0, size, size).data;
      var gray = new Array(size * size);
      for (var i = 0; i < size * size; i++) gray[i] = Math.round(0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2]);
      var tex = B.lbpHistogram(gray, size, size);
      return { texture: B.palmTextureSane(tex) ? tex : null, sharpness: B.laplacianVariance(gray, size, size) };
    } catch (e) { return { texture: null, sharpness: 0 }; }
  }

  /* Palmprint ROI + EDCC codes from a recorded frame (v9): the landmarks
     locate the palm square, the warp cuts it out, the encoder reads the
     print itself. Returns { code, codeM } (codeM = the mirror twin's
     code, v15) or null. */
  var roiScratch = null;
  function palmCodesFromFrame(frame, lm) {
    try {
      var w = frame.width, h = frame.height;
      if (!w || !h || !lm || lm.length !== 21) return null;
      // v25: crop around the hand (landmark bbox + 1.3 knuckle-spans of
      // margin, which covers the whole ROI square) and run the
      // grayscale pass on the crop only. The old code converted every
      // pixel of a ~960px frame on every analysed frame - a real cost
      // on a phone CPU, for a warp that only ever reads the palm area.
      // Landmarks are re-based into crop space; the warp output is the
      // same palm square.
      var minX = 1, minY = 1, maxX = 0, maxY = 0, i, p;
      for (i = 0; i < 21; i++) {
        p = lm[i];
        if (!p || !isFinite(Number(p.x)) || !isFinite(Number(p.y))) return null;
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      var spanPx = Math.hypot((Number(lm[17].x) - Number(lm[5].x)) * w, (Number(lm[17].y) - Number(lm[5].y)) * h);
      if (!(spanPx > 0)) return null;
      var margin = spanPx * 1.3;
      var ox = Math.max(0, Math.floor(minX * w - margin)), oy = Math.max(0, Math.floor(minY * h - margin));
      var ex = Math.min(w, Math.ceil(maxX * w + margin)), ey = Math.min(h, Math.ceil(maxY * h + margin));
      var cw = ex - ox, ch = ey - oy;
      if (!(cw >= 40 && ch >= 40)) return null;
      if (!roiScratch) roiScratch = document.createElement('canvas');
      roiScratch.width = cw; roiScratch.height = ch;
      var ctx = roiScratch.getContext('2d');
      ctx.drawImage(frame, ox, oy, cw, ch, 0, 0, cw, ch);
      var img = ctx.getImageData(0, 0, cw, ch).data;
      var gray = new Array(cw * ch);
      for (i = 0; i < cw * ch; i++) gray[i] = Math.round(0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2]);
      var clm = lm.map(function (q) { return { x: (Number(q.x) * w - ox) / cw, y: (Number(q.y) * h - oy) / ch, z: q.z }; });
      var roi = B.palmRoiFromLandmarks(gray, cw, ch, clm);
      if (!roi) return null;
      var code = B.palmprintEncode(roi, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE);
      var flipped = B.flipGrayHorizontal(roi, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE);
      var codeM = flipped ? B.palmprintEncode(flipped, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE) : null;
      return { code: code, codeM: codeM, roi: roi };
    } catch (e) { return null; }
  }

  var spoofScratch = null;
  /* Downscale a recorded frame and run the screen-spoof detector on
     it (v18). Returns the detector result plus the frame's mean
     brightness (used for the field-test lighting tag), or null.
     v36: the frame's landmarks scope the detector's grid analysis to
     the palm region - a screen replay carries its pixel grid in the
     palm image itself, while patterned surfaces elsewhere in the room
     must not convict a live scan.
     v40: the scope is now the palm HULL (palmHullRegionPx: the convex
     hull of the palm-body landmarks, eroded 10%), not the ROI square.
     The square admitted the surface the hand hovers over, and a glossy
     printed page inside it convicted a live scan on 2026-11-23. Inside
     the hull the detector additionally requires the grid to cover a
     clear majority of the palm before it may convict on grid alone.
     No landmarks (or no usable hull) passes a null region: that frame
     then carries no grid evidence either way - the gate never falls
     back to the square or the whole frame. Bezel and glare stay
     whole-frame. */
  function spoofSample(frame, lm) {
    try {
      if (!spoofScratch) spoofScratch = document.createElement('canvas');
      var w = 160, h = Math.max(48, Math.round(160 * frame.height / frame.width));
      spoofScratch.width = w; spoofScratch.height = h;
      var ctx = spoofScratch.getContext('2d');
      ctx.drawImage(frame, 0, 0, w, h);
      var img = ctx.getImageData(0, 0, w, h).data;
      var gray = new Array(w * h), sum = 0;
      for (var i = 0; i < w * h; i++) { var v = Math.round(0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2]); gray[i] = v; sum += v; }
      var region = lm ? B.palmHullRegionPx(w, h, lm) : null;
      var chk = B.screenSpoofCheck(gray, w, h, region);
      chk.meanBrightness = sum / (w * h);
      return chk;
    } catch (e) { return null; }
  }
  /* ================= v20: instant speed + Show & Pay =================
     Registration is a live auto-capture stream (no fixed clips): the
     issued movement sequence is still required - it is the enrolment
     liveness - but the app captures continuously and finishes the
     moment the sequence completes with enough fully-open codes.
     Checkout is Show & Pay: no movement sequence at all. The customer
     holds an open palm like tapping a card; frames stream in rapid
     bursts of three, the v19 screen-lattice coherence gate samples
     them, passive liveness reads the natural micro-shift across the
     burst poses, and matching runs per frame (in a Web Worker) with
     an early exit the moment two consecutive frames match. */

  function waitMs(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  /* Instant audio (Web Audio, no files) + voice confirmation. Every
     call is guarded: a device without audio simply stays silent. */
  var Snd = {
    ctx: null,
    ac: function () {
      try {
        if (!this.ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; this.ctx = new AC(); }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      } catch (e) { return null; }
    },
    tone: function (freq, at, dur, type, vol) {
      var ac = this.ac(); if (!ac) return;
      try {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = type || 'sine'; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(vol || 0.15, at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        o.connect(g); g.connect(ac.destination);
        o.start(at); o.stop(at + dur + 0.03);
      } catch (e) {}
    },
    chime: function () { var ac = this.ac(); if (!ac) return; var t = ac.currentTime; this.tone(987.77, t, 0.10, 'sine', 0.16); this.tone(1318.51, t + 0.085, 0.16, 'sine', 0.16); },
    tick: function () { var ac = this.ac(); if (!ac) return; this.tone(1567.98, ac.currentTime, 0.035, 'sine', 0.07); },
    buzz: function () {
      var ac = this.ac();
      if (ac) { var t = ac.currentTime; this.tone(164.81, t, 0.08, 'square', 0.08); this.tone(164.81, t + 0.13, 0.08, 'square', 0.08); }
      try { if (navigator.vibrate) navigator.vibrate([50, 40, 50]); } catch (e) {}
    },
    speak: function (text) {
      try {
        if (!('speechSynthesis' in window)) return;
        var u = new SpeechSynthesisUtterance(text);
        u.rate = 1.05;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } catch (e) {}
    }
  };

  /* Palmprint matching in a Web Worker (source assembled from the
     real biometrics functions, so the worker runs the shipping
     comparer). Any worker failure or silence falls back to the main
     thread - the verdict is identical either way. */
  var Match = {
    w: null, tried: false, seq: 0, pending: {},
    init: function () {
      if (this.tried) return;
      this.tried = true;
      try {
        var url = URL.createObjectURL(new Blob([B.palmprintWorkerSource()], { type: 'text/javascript' }));
        this.w = new Worker(url);
        var self = this;
        this.w.onmessage = function (e) {
          var p = self.pending[e.data.id];
          if (p) { delete self.pending[e.data.id]; p(e.data); }
        };
        this.w.onerror = function () { self.w = null; };
      } catch (e) { this.w = null; }
    },
    verify: function (profile, liveCodes) {
      this.init();
      if (!this.w) return Promise.resolve(B.verifyPalmprintProfile(profile, liveCodes));
      var self = this;
      var id = ++this.seq;
      return new Promise(function (resolve) {
        var done = false;
        var finishWith = function (r) {
          if (done) return;
          done = true;
          resolve(r || B.verifyPalmprintProfile(profile, liveCodes));
        };
        var to = setTimeout(function () { delete self.pending[id]; finishWith(null); }, 5000);
        self.pending[id] = function (msg) { clearTimeout(to); finishWith(msg && msg.result); };
        try { self.w.postMessage({ id: id, profile: profile, liveCodes: liveCodes }); }
        catch (e) { clearTimeout(to); delete self.pending[id]; finishWith(null); }
      });
    },
    /* v33: verify from live ROIs — the worker re-encodes each ROI at
       the 25 image-level shifts and applies the max rule. The
       watchdog is longer than the code path's: a single ROI expands
       to 50 encodes plus up to 300 code comparisons. Any failure
       falls back to the identical main-thread function.
       v35: opts.fast routes to verifyPalmprintRoisFast — the same
       max rule over the same pairs, produced lazily in priority
       order with a threshold short-circuit (see biometrics.js).
       Same verdict; on a pass the reported score is the deciding
       pair's true score rather than the full max. The per-frame
       streaming call uses it; finalOut keeps the exact path. */
    verifyRois: function (profile, liveRois, opts) {
      this.init();
      var fast = !!(opts && opts.fast);
      var mainThread = function () {
        return fast ? B.verifyPalmprintRoisFast(profile, liveRois) : B.verifyPalmprintRois(profile, liveRois);
      };
      if (!this.w) return Promise.resolve(mainThread());
      var self = this;
      var id = ++this.seq;
      return new Promise(function (resolve) {
        var done = false;
        var finishWith = function (r) {
          if (done) return;
          done = true;
          resolve(r || mainThread());
        };
        var to = setTimeout(function () { delete self.pending[id]; finishWith(null); }, 20000);
        self.pending[id] = function (msg) { clearTimeout(to); finishWith(msg && msg.result); };
        try { self.w.postMessage({ id: id, profile: profile, liveRois: liveRois, fast: fast }); }
        catch (e) { clearTimeout(to); delete self.pending[id]; finishWith(null); }
      });
    },
    /* v35: verify the same live ROIs against several profiles in
       one worker call — the probe codes are encoded once inside
       the worker and scored against each profile, instead of one
       full re-encode per profile. Each result is the exact
       verifyPalmprintProfile result for that profile. Used by the
       impostor-max diagnostic in streamVerifyPalm. */
    verifyRoisMulti: function (profiles, liveRois) {
      this.init();
      var mainThread = function () {
        var codes = [];
        (liveRois || []).forEach(function (roi) {
          B.palmprintProbeCodes(roi).forEach(function (c) { codes.push(c); });
          B.palmprintProbeCodesGeo(roi).forEach(function (c) { codes.push(c); });
        });
        return profiles.map(function (p) { return B.verifyPalmprintProfile(p, codes); });
      };
      if (!this.w) return Promise.resolve(mainThread());
      var self = this;
      var id = ++this.seq;
      return new Promise(function (resolve) {
        var done = false;
        var finishWith = function (rs) {
          if (done) return;
          done = true;
          resolve(rs || mainThread());
        };
        var to = setTimeout(function () { delete self.pending[id]; finishWith(null); }, 20000);
        self.pending[id] = function (msg) { clearTimeout(to); finishWith(msg && msg.results); };
        try { self.w.postMessage({ id: id, profiles: profiles, liveRois: liveRois }); }
        catch (e) { clearTimeout(to); delete self.pending[id]; finishWith(null); }
      });
    }
  };

  /* Pipeline pre-warm (v37): the first MediaPipe Hands call pays the
     WASM + model load — measured at ~10 s on the slow test rig when
     it landed inside the first scan, against ~0.7 s per frame once
     warm. Both camera-start handlers call this so the load happens
     while the camera is opening and the customer is still raising
     their hand, not after SCAN is tapped. v39: opening the takeBIOM
     view (go('terminal')) calls it too, so the load starts when the
     operator reaches the terminal — before a person is even
     selected, let alone the camera started. Fire-and-forget: a warmup
     failure is silent (the scan path initialises everything itself),
     and if a real scan starts first, PalmProc's orphan guard hands
     the pending slot to the scan's call — the warmup can never block
     or corrupt a scan. The match worker is constructed here too, so
     its spin-up is also off the scan path. */
  var palmPrewarmStarted = false;
  /* Warm singleton pipeline (v43): MediaPipe Hands (PalmProc) and
     the match worker (Match) are created ONCE for the app's whole
     lifetime and kept warm across every view — tab switches never
     tear them down or reload the model. Pipeline.start() is the
     single entry point: boot calls it, and every scan view calls
     enterScanView() when it mounts. Both are idempotent — the
     underlying objects guard their own construction — so the only
     Hands rebuild that exists anywhere is PalmProc's dropped-frame
     recovery (a wedged MediaPipe graph stays wedged; it is rebuilt
     after a 4 s frame timeout, never on a view switch). */
  var Pipeline = {
    started: false,
    start: function () {
      if (this.started) return;
      this.started = true;
      prewarmPalmPipeline();
    },
    enterScanView: function () { this.start(); }
  };
  function prewarmPalmPipeline() {
    try { PalmProc.init(); } catch (e) {}
    try { Match.init(); } catch (e) {}
    if (palmPrewarmStarted) return;
    palmPrewarmStarted = true;
    try {
      var c = document.createElement('canvas');
      c.width = 96; c.height = 96;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#888888'; ctx.fillRect(0, 0, 96, 96);
      PalmProc.landmarks(c).then(function () {}, function () {});
    } catch (e) {}
  }

  /* One streamed frame, analysed: landmarks, openness, EDCC codes
     (aligned + mirror), texture/sharpness, and the palm pose used by
     passive liveness. Same frame-result shape the clip pipeline used. */
  function analysePalmFrame(frame) {
    return PalmProc.landmarks(frame).then(function (lm) {
      if (!lm) return { openness: null, descriptor: null, code: null, codeM: null, roi: null, sharpness: 0, texture: null, spread: null, tilt: null, pose: null, framing: null, lm: null };
      var openness = B.palmOpenness(lm);
      var descriptor = B.palmDescriptorFromLandmarks(lm);
      var meas = descriptor ? palmFrameMeasures(frame, frame.width, frame.height, lm) : { texture: null, sharpness: 0 };
      // EDCC codes are gated on landmarks + openness + the ROI/code
      // sanity checks inside palmCodesFromFrame — NOT on the legacy
      // geometry descriptor. That descriptor's strict reach bands
      // reject most genuinely open palms on real camera landmarks
      // (measured in E2E, 2026-11-20: 24/24 frames had landmarks but
      // only 4/24 passed the descriptor gate), which starved both
      // enrolment and verification of codes. The descriptor is still
      // computed for legacy geometry profiles only.
      // v24: codes are PRODUCED from the live bar (1.55) so a natural
      // checkout palm yields candidates; enrolment still BANKS only
      // fully-open frames (its selection gate stays at PALM_OPEN_MIN).
      var codes = (typeof openness === 'number' && openness >= B.PALM_LIVE_OPEN_MIN) ? palmCodesFromFrame(frame, lm) : null;
      return { openness: openness, descriptor: descriptor, code: codes ? codes.code : null, codeM: codes ? codes.codeM : null, roi: codes ? codes.roi : null, sharpness: meas.sharpness, texture: meas.texture, spread: B.palmSpread(lm), tilt: B.palmTilt(lm), pose: B.palmFramePose(lm), framing: B.palmFramingHint(lm), lm: lm };
    });
  }

  /* Spoof sampling shared by both v20 streams: the scan is a screen
     replay when at least half the sampled frames (and at least two)
     carry screen traces - the v18/v19 aggregation rule, unchanged. */
  function makeSpoofTracker() {
    var checks = [];
    return {
      // Returns the frame's own sample (or null when the detector
      // could not run on it) so the verify stream can record the
      // per-frame verdict alongside the frame — the v39 fast win
      // reads the two matched frames' own samples, not just the
      // aggregate. Aggregation behaviour is unchanged.
      add: function (frame, lm) { var s = spoofSample(frame, lm); if (s) checks.push(s); return s || null; },
      state: function () {
        var flagged = checks.filter(function (c) { return c.spoof; });
        var meanB = checks.length ? checks.reduce(function (s, c) { return s + c.meanBrightness; }, 0) / checks.length : null;
        return {
          spoof: checks.length > 0 && flagged.length >= Math.max(2, Math.ceil(checks.length / 2)),
          score: checks.reduce(function (m, c) { return Math.max(m, c.score); }, 0),
          // v36: one entry per reason kind - two flagged frames no
          // longer repeat the same reason with different numbers.
          reasons: B.dedupeSpoofReasons(flagged.reduce(function (acc, c) { return acc.concat(c.reasons); }, [])),
          framesChecked: checks.length, framesFlagged: flagged.length,
          lightTag: meanB === null ? null : meanB > 150 ? 'bright' : meanB >= 80 ? 'indoor' : 'dim'
        };
      }
    };
  }

  /* Instant auto-capture registration (v20): streams frames from the
     live camera; the issued randomised sequence remains the enrolment
     liveness gate, judged on the streamed measures with the same
     index-based window as the clip pipeline. Finishes the moment the
     sequence passes with at least two usable fully-open codes banked.
     Returns the same shape capturePalmResults returned.
     v34: free-form scanning - there is no guide overlay and nothing
     to line up; the user simply shows an open hand anywhere in the
     frame and the landmark ROI follows the hand. */
  function streamEnrolPalm(video, statusEl, sequence, swapCamera, control) {
    var t0 = Date.now();
    var results = [];
    var measures = [];
    var tracker = makeSpoofTracker();
    var analysed = 0, swapped = false, locked = false;
    var deadline = t0 + 180000;
    // v43: the session's flat baseline for the pose classifier —
    // set from the first fully-open, un-angled frame's descriptor;
    // until then tilt/distance are not measurable and frames read
    // 'flat' or an angle pose.
    var poseRef = null;
    function poseCoverage() {
      var usable = B.palmprintUsableOpenFrames(results);
      var seen = {};
      usable.forEach(function (u) { if (u.poseTag) seen[u.poseTag] = true; });
      return B.PALMPRINT_POSES.map(function (p) { return p.id; }).filter(function (id) { return seen[id]; });
    }
    // Burst-chain capture (v20.2): each burst RECORDS ~3 s of frames at
    // 250 ms with no inference running (grabs stay phase-true), then
    // analyses them in order while the next burst records. Separating
    // capture from analysis in time is not optional on slow processors:
    // concurrent inference starves the grab timer and phase-locks the
    // sampling to one point of the movement cycle (measured on the test
    // rig: 44 grabs in 100 s, openness frozen at ~1.88, the fist phase
    // never sampled). The user simply keeps following the prompts; the
    // chain finishes the moment the accumulated measures complete the
    // sequence with two usable open-palm codes banked.
    function recordBurst(ms) {
      var frames = [];
      return new Promise(function (resolve) {
        var iv = setInterval(function () {
          var f = grabVideoFrame(video);
          if (f) frames.push(f);
        }, 250);
        setTimeout(function () { clearInterval(iv); resolve(frames); }, ms);
      });
    }
    function stageIdxNow() {
      var idx = 0;
      for (var i = 0; i < measures.length && idx < sequence.stages.length; i++) if (B.palmStageMet(sequence.stages[idx], measures[i])) idx++;
      return Math.min(idx, sequence.stages.length - 1);
    }
    function done() {
      // Finish only when the profile selector would bank at least 3
      // codes (v27): usable frames within the selector's own band
      // (maxOpen - 0.30). On the verified rig, enrolments that banked
      // 2 codes verified at 0.310-0.353 against the same palm, while
      // the 3-code enrolment verified at 0.513 - the extra enrolled
      // code is real matching headroom, bought with extra bursts.
      if (!B.evaluateMovementSequenceStreaming(measures, sequence).pass) return false;
      var usable = B.palmprintUsableOpenFrames(results);
      if (usable.length < 3) return false;
      // v43 primary finish: the guided pose set is banked — the
      // flat pose plus at least three more MEASURED poses (four of
      // the six), so the profile carries codes for the tilted and
      // angled presentations the v41 diagnosis indicted. This is
      // the normal exit and it is reached inside one sitting: the
      // poses bank opportunistically while the movement sequence
      // runs, and the angle prompts follow it.
      var covered = poseCoverage();
      if (covered.indexOf('flat') !== -1 && covered.length >= 4) return true;
      var maxOpen = Math.max.apply(null, usable.map(function (u) { return u.openness; }));
      var inBand = usable.filter(function (u) { return u.openness >= maxOpen - 0.30; }).length;
      // v30: bank a FULL set, not the minimum. done() previously fired
      // the moment 3 in-band frames existed; on the user's phone that
      // produced a 3-single profile (4 codes with fusion) whose best
      // verification pair scored 0.266, while a 6-single enrolment
      // scored 0.302. The selector caps at 6 singles, so require 6
      // in-band - with a late fallback: past 150 analysed frames a
      // 3-code profile is better than grinding on to the deadline.
      // v43 keeps that late ladder and adds a thinner pose set
      // (flat + two more) at the same late point; the caller tries
      // pose selection first and falls back to the classic selector
      // when no pose set banked, so a difficult session still
      // enrols instead of grinding to the deadline.
      if (analysed >= 150) {
        if (covered.indexOf('flat') !== -1 && covered.length >= 3) return true;
        return inBand >= 6 || inBand >= 3;
      }
      return false;
    }
    function finish() {
      var sp = tracker.state();
      return {
        results: results,
        movement: B.evaluateMovementSequenceStreaming(measures, sequence),
        spoof: sp,
        lightTag: sp.lightTag,
        posesCovered: poseCoverage(),
        elapsedMs: Date.now() - t0
      };
    }
    function analyseBurst(frames) {
      var live = true;
      var chain = Promise.resolve();
      frames.forEach(function (frame) {
        chain = chain.then(function () {
          if (!live || (control && control.cancelled) || tracker.state().spoof || done()) return;
          // v36: the spoof sample is taken AFTER analysis so it can
          // carry the frame's landmarks and scope its grid analysis
          // to the palm region; the every-3rd-frame cadence is kept.
          var sampleThis = (analysed % 3 === 0);
          return analysePalmFrame(frame).then(function (r) {
            if (sampleThis) tracker.add(frame, r.lm);
            analysed++;
            results.push(r);
            // v43: tag the frame with its MEASURED pose (classifier
            // over the landmarks, against the session's flat
            // baseline once one exists) so banking groups by what
            // was actually presented, not by which prompt was up.
            var pdesc = B.palmPoseDescriptor(r.lm);
            if (pdesc) {
              if (!poseRef && typeof r.openness === 'number' && r.openness >= B.PALM_OPEN_MIN && Math.abs(pdesc.ang) < 12) {
                poseRef = { fore: pdesc.fore, span: pdesc.span };
              }
              r.poseDesc = pdesc;
              r.poseTag = B.palmPoseTag(r.lm, poseRef);
            }
            // Movement measures come from EVERY frame with landmarks:
            // the descriptor gate only accepts open-hand geometry, so
            // gating measures on it silently drops the fist frames the
            // close stage exists to see (found in E2E, 2026-11-20: the
            // open stage registered, close never could). The sequence
            // evaluator is the liveness judge, not the descriptor gate.
            if (typeof r.openness === 'number') measures.push({ openness: r.openness, spread: r.spread, tilt: r.tilt });
            var isLock = !!(r.code && B.palmprintCodeSane(r.code));
            if (isLock && !locked) { locked = true; Snd.tick(); }
            if (!isLock) locked = false;
            if (statusEl) statusEl.textContent = 'Step ' + (stageIdxNow() + 1) + ' of ' + sequence.stages.length + ' — ' + (B.PALM_STAGE_PROMPTS[sequence.stages[stageIdxNow()]] || '');
          });
        });
      });
      // Watchdog: a burst normally finishes in seconds (each frame is
      // bounded by the PalmProc timeout). If anything still wedges,
      // abandon the burst instead of freezing the enrolment silently;
      // the live flag stops the abandoned chain pushing late results.
      var watchdog = waitMs(75000).then(function () { live = false; });
      return Promise.race([chain, watchdog]);
    }
    function cycle() {
      if (control && control.cancelled) { var stopped = finish(); stopped.stopped = true; return stopped; }
      if (tracker.state().spoof || done()) return finish();
      if (Date.now() > deadline) return finish();
      if (!swapped && swapCamera && analysed >= 12 && results.every(function (x) { return typeof x.openness !== 'number'; })) {
        swapped = true;
        if (statusEl) statusEl.textContent = 'No hand was seen by this camera - switching to the other camera and trying once more.';
        return swapCamera().then(function () { return cycle(); }, function () { return cycle(); });
      }
      if (statusEl) {
        // Live feedback, not a frozen prompt (v22): say plainly whether
        // a hand has been seen and what is missing, so a stall is
        // visible and correctable instead of silent.
        var seenHand = results.some(function (x) { return typeof x.openness === 'number'; });
        var lastResult = results.length ? results[results.length - 1] : null;
        if (B.evaluateMovementSequenceStreaming(measures, sequence).pass) {
          // Movement done, print codes still banking (v28): say so,
          // with the count - at Step 3 the app previously kept showing
          // the stage prompt while silently collecting codes, which
          // read as 'stuck' on the user's phone.
          var usableNow = B.palmprintUsableOpenFrames(results);
          var maxOpenNow = usableNow.length ? Math.max.apply(null, usableNow.map(function (u) { return u.openness; })) : 0;
          var bankedNow = usableNow.filter(function (u) { return u.openness >= maxOpenNow - 0.30; }).length;
          // v43: once the movement proof passes, the prompts walk
          // the remaining poses — one continuous sitting, banking
          // the sharpest fully-open frame per measured pose.
          var coveredNow = poseCoverage();
          var nextPose = B.PALMPRINT_POSES.filter(function (p) { return coveredNow.indexOf(p.id) === -1; })[0];
          if (!nextPose) {
            statusEl.textContent = 'All angles captured — hold steady, palm open, fingers spread wide.';
          } else if (coveredNow.length >= 1) {
            statusEl.textContent = 'Movement complete. Angle ' + (coveredNow.length + 1) + ' of ' + B.PALMPRINT_POSES.length + ' (' + nextPose.label + '): ' + nextPose.prompt;
          } else {
            statusEl.textContent = 'Hand detected — hold steady, palm open, fingers spread wide. Capturing print detail: ' + Math.min(bankedNow, 6) + ' of 6 codes.';
          }
        } else if (analysed >= 12 && !seenHand) {
          statusEl.textContent = 'No hand seen yet — show your open hand to the camera, fingers spread.';
        } else if (lastResult && lastResult.framing) {
          statusEl.textContent = lastResult.framing;
        } else if (analysed >= 24 && seenHand && stageIdxNow() === 0) {
          statusEl.textContent = 'Hand detected — now open it wide: fingers spread, palm flat, facing the camera.';
        } else {
          statusEl.textContent = 'Step ' + (stageIdxNow() + 1) + ' of ' + sequence.stages.length + ' — ' + (B.PALM_STAGE_PROMPTS[sequence.stages[stageIdxNow()]] || '');
        }
      }
      // Persona-style pacing (v27, his order): short 1.5 s capture
      // bursts analysed immediately, so the step prompt advances
      // every couple of seconds and the flow finishes the moment the
      // last step ticks - guided and automatic, no long dead waits.
      // Capture and analysis stay separated in time on purpose: the
      // v20.2 rig measurement showed concurrent inference starving
      // the grab timer on slow processors and phase-locking the
      // sampling to one point of the movement cycle.
      return recordBurst(1000).then(analyseBurst).then(cycle);
    }
    return cycle();
  }

  /* Show & Pay checkout (v20): no movement sequence. Per-frame
     matching in the worker with the two-frame early exit; passive
     liveness on the streamed poses; the coherence spoof gate sampled
     per frame. Fail-closed throughout.
     v34: free-form scanning - no guide overlay; the customer simply
     shows an open hand anywhere in the frame and the landmark ROI
     follows the hand.
     v37: the burst pacing is gone — frames stream continuously,
     paced only by the camera clock; each frame's match overlaps the
     next frame's analysis and results apply in capture order; the
     win is honoured the moment the deciding score lands. Every gate
     (two-frame rolling window, passive liveness, spoof aggregation,
     MAXF, deadline) judges the same evidence as the burst design.
     v39: FAST WIN (the Chairman's authorised trade after his v38
     phone verdict — still too slow at payment time): the win may
     be honoured on the matched PAIR at two analysed frames when
     both frames carry clean per-frame spoof samples and the pair's
     poses show a real micro-shift (B.streamFastWinCheck). The
     standard honour — 3-pose liveness plus at least three spoof-
     gate frames — still completes any scan the fast path does not,
     and every rejection path is exactly as before: this change
     only moves how early a WIN may be honoured, never how a
     rejection is reached. */
  function streamVerifyPalm(video, statusEl, person, people, swapCamera, fieldRec, control) {
    var t0 = Date.now();
    var tracker = makeSpoofTracker();
    var frames = [];
    var poses = [];
    // v39: per-frame evidence for the fast win, kept in lockstep
    // with the other streams — frameSpoof[i] is frame i's own
    // detector verdict (true flagged / false examined-clean / null
    // never examined), and applied[] holds one evidence record per
    // applyMatch call, in the same capture order streamMatchUpdate
    // judges, so the matched pair can be found exactly as the
    // rolling-window rule paired it.
    var frameSpoof = [];
    var applied = [];
    var matchState = { streak: 0, best: null };
    var win = null;
    var analysed = 0, swapped = false, locked = false;
    var lastHint = null, coded = 0;
    // v43: the latest frame's quality signals, feeding the live
    // guidance pill (B.palmGuidance) and the caller's scan session.
    var lastOpen = null, lastSampleB = null, lastGlare = null, lastSharp = null;
    var MAXF = 24, deadline = t0 + 90000;
    // v37 continuous pipeline state: one reused capture canvas (each
    // frame is fully analysed before the next grab), the video-clock
    // time of the last grab (pacing), and the previous frame's match
    // still running in the worker while the next frame is analysed.
    var frameCanvas = null;
    var lastGrabT = -1;
    var prevMatch = null;

    function finish(out) { return out; }
    function impostorMaxFor(rois) {
      // v35: one multi-profile call — the probe codes are encoded
      // once and scored against every other enrolled profile,
      // instead of a full 50-encode expansion per person. Each
      // per-profile result is the exact one the v34 chain computed;
      // the max taken over them is unchanged.
      var others = (people || []).filter(function (p) {
        return p.id !== person.id && B.palmprintProfileSane(p.palmProfile);
      });
      if (!others.length) return Promise.resolve(null);
      return Match.verifyRoisMulti(others.map(function (p) { return p.palmProfile; }), rois).then(function (results) {
        var cur = null;
        (results || []).forEach(function (ro) {
          var s = ro && typeof ro.similarity === 'number' ? ro.similarity : null;
          if (s !== null && (cur === null || s > cur)) cur = s;
        });
        return cur;
      });
    }
    function spoofOut(sp) {
      logVerification(person, 'palm', 'Spoof score ' + sp.score.toFixed(2) + ' - ' + sp.reasons.join('; '), 'Spoof / Screen Replay Detected');
      fieldRec(null, null, 'fail', 'rejected', sp.lightTag);
      Snd.buzz();
      return finish({ fail: 'Spoof / Screen Replay Detected — the scan showed a screen or a recording, not a live hand (' + sp.reasons.join('; ') + '). Nothing was verified. Present the real hand, live in front of the camera.' });
    }
    function livenessFailOut(lv) {
      fieldRec(null, null, 'fail', 'rejected', tracker.state().lightTag);
      Snd.buzz();
      return finish({ fail: lv.verdict === 'static'
        ? 'Liveness check failed: the palm did not move naturally at all — a still photo or a frozen image cannot be used. Nothing was verified. Present the real hand, held live in front of the camera.'
        : 'Liveness check failed: the view changed too abruptly for one held hand. Nothing was verified. Hold one open palm steady in front of the camera.' });
    }
    function verifiedOut() {
      return impostorMaxFor(win.rois).then(function (impMax) {
        fieldRec(win.res.similarity, impMax, 'pass', 'verified', tracker.state().lightTag);
        var measured = 'Palmprint similarity ' + win.res.similarity.toFixed(3) + ' (threshold ' + win.res.threshold + ', score-level max: best pair of the winning frame re-encoded at 25 image-level shifts plus the v41 geometric variants against ' + person.palmProfile.codes.length + ' individual enrolled print codes), passive liveness passed (' + (win.fast ? 'natural micro-shift between the two matched frames; fast win honoured on the matched pair, both frames spoof-clean' : 'natural micro-shift across rapid frames') + '), Show & Pay streaming scan with two-frame early exit';
        return finish({ r: win.res, measured: measured, latencyMs: Date.now() - t0 });
      });
    }
    function finalOut() {
      var sp = tracker.state();
      if (sp.spoof) return spoofOut(sp);
      var lv = B.passiveLivenessCheck(poses);
      var liveRois = B.selectPalmprintLiveRois(frames);
      if (!liveRois) { fieldRec(null, null, lv.pass ? 'pass' : 'fail', 'rejected', sp.lightTag); return finish({ fail: 'No usable open palm with readable print detail found in the scan. Nothing was verified. Show one open palm to the camera, fingers spread, in good light, and run the scan again. (' + analysed + ' frames scanned, ' + coded + ' produced a readable palm code.' + (lastHint ? ' Last guidance shown: ' + lastHint : '') + ')' }); }
      return Match.verifyRois(person.palmProfile, liveRois).then(function (res) {
        return impostorMaxFor(liveRois).then(function (impMax) {
          var out = res;
          if (res && res.verified) {
            // Threshold reached on the collected set without two
            // matching frames inside the rolling window: Show & Pay
            // does not upgrade a single-frame match into a payment.
            // Denial, reason stated.
            out = { ok: true, verified: false, similarity: res.similarity, threshold: res.threshold, reason: 'Matched on a single frame only - Show & Pay requires two matching frames close together. Hold the palm steady a moment longer and scan again.' };
          }
          fieldRec(res ? res.similarity : null, impMax, lv.pass ? 'pass' : 'fail', 'rejected', sp.lightTag);
          var measured = 'Palmprint similarity ' + (res && typeof res.similarity === 'number' ? res.similarity.toFixed(3) : 'n/a') + ' (threshold ' + B.PALMPRINT_THRESHOLD + ', score-level max: ' + liveRois.length + ' live frames each re-encoded at 25 image-level shifts plus the v41 geometric variants against ' + person.palmProfile.codes.length + ' individual enrolled print codes), passive liveness ' + lv.verdict + ', Show & Pay streaming scan. Diagnostics: ' + analysed + ' frames scanned, ' + coded + ' with a readable code, best single-frame score ' + (matchState.best !== null ? matchState.best.toFixed(3) : 'n/a') + '.';
          return finish({ r: out, measured: measured, latencyMs: Date.now() - t0 });
        });
      });
    }
    /* Apply one frame's match result to the rolling-window rule, in
       capture order (v37: extracted so the pipelined loop applies
       results in exactly the order the burst chain did). A code-less
       or ROI-less frame applies a null score, as before.
       v39: each application also records the frame's evidence
       (matched at the same threshold streamMatchUpdate uses, the
       frame's pose, the frame's own spoof verdict). When the rule
       completes the match, the partner is the most recent matched
       record within the same two-back window the rule itself
       reads, and B.streamFastWinCheck decides whether the win may
       be honoured on that pair at two frames. */
    function applyMatch(res, roi, frameIdx) {
      var score = res && typeof res.similarity === 'number' ? res.similarity : null;
      matchState = B.streamMatchUpdate(matchState, score);
      var entry = {
        matched: typeof score === 'number' && score >= B.PALMPRINT_THRESHOLD,
        pose: (typeof frameIdx === 'number' && frames[frameIdx]) ? frames[frameIdx].pose : null,
        spoof: (typeof frameIdx === 'number' && frameIdx < frameSpoof.length) ? frameSpoof[frameIdx] : null
      };
      applied.push(entry);
      if (matchState.done && !win) {
        win = { res: res, rois: [roi], fast: false };
        var partner = null;
        for (var k = applied.length - 2; k >= applied.length - 3 && k >= 0; k--) {
          if (applied[k].matched) { partner = applied[k]; break; }
        }
        if (partner && B.streamFastWinCheck(partner, entry).ok) win.fast = true;
      }
    }
    /* Pace grabs to the camera clock (v37): at least ~100 ms of
       stream time between analysed frames, so consecutive poses are
       genuinely different instants — the passive-liveness micro-shift
       signal is read across them — and no instant is analysed twice.
       Analysis slower than the pace (the common case) never waits at
       all. Bounded by the scan deadline so a stalled stream falls
       through to the MAXF/deadline guards instead of hanging. */
    function waitFreshFrame() {
      if (lastGrabT < 0) return Promise.resolve();
      var target = lastGrabT + 0.1;
      function poll() {
        if (video.currentTime >= target || Date.now() > deadline) return Promise.resolve();
        return waitMs(8).then(poll);
      }
      return poll();
    }
    /* One continuous step (v37): grab one fresh frame, analyse it,
       feed every gate in the same order the burst chain did, drain
       the PREVIOUS frame's worker match (it ran while this frame was
       being analysed) so scores apply in capture order, then start
       this frame's match and return — the win is honoured by loop()
       the moment the deciding score lands, not a burst later. */
    function step() {
      return waitFreshFrame().then(function () {
        if (!frameCanvas) frameCanvas = document.createElement('canvas');
        var frame = grabVideoFrameInto(video, frameCanvas);
        if (!frame) return waitMs(60); // stream not producing frames yet
        lastGrabT = video.currentTime;
        return analysePalmFrame(frame).then(function (r) {
          analysed++;
          // Every analysed frame feeds the spoof tracker, carrying
          // its landmarks so the v36 grid gate reads the palm region
          // only — same evidence, same aggregation as the bursts.
          // v39: the frame's own sample verdict is also recorded
          // against its frame index for the fast-win pair check.
          var sample = tracker.add(frame, r.lm);
          frames.push(r);
          frameSpoof.push(sample ? !!sample.spoof : null);
          var myIdx = frames.length - 1;
          if (typeof r.openness === 'number') lastHint = r.framing || null;
          // v43: publish the frame's quality signals — the scan
          // session reads stability from the pose, the guidance
          // pill from the rest. Guidance only; no gate reads these.
          lastOpen = typeof r.openness === 'number' ? r.openness : null;
          lastSharp = typeof r.sharpness === 'number' ? r.sharpness : null;
          lastSampleB = sample && typeof sample.meanBrightness === 'number' ? sample.meanBrightness : null;
          lastGlare = sample && typeof sample.glare === 'number' ? sample.glare : null;
          if (control && control.onFrame) {
            try { control.onFrame({ hasHand: typeof r.openness === 'number', pose: r.pose || null, openness: lastOpen, framing: lastHint, sharpness: lastSharp, meanLuma: lastSampleB, glareFrac: lastGlare }); } catch (e) {}
          }
          if (r.pose) { poses.push(r.pose); if (poses.length > 6) poses.shift(); }
          var sane = !!(r.code && B.palmprintCodeSane(r.code));
          if (sane) coded++;
          if (sane && !locked) { locked = true; Snd.tick(); }
          var prev = prevMatch; prevMatch = null;
          var drained = prev
            ? prev.promise.then(function (res) { applyMatch(res, prev.roi, prev.frameIdx); })
            : Promise.resolve();
          return drained.then(function () {
            if (sane && r.roi) {
              // v33: the frame's ROI is the probe — the matcher
              // re-encodes it at the 25 image-level shifts and takes
              // the best pair against the enrolled codes. v35: the
              // fast path — same pairs, same max rule, lazily ordered
              // with a threshold short-circuit. v37: the call now
              // overlaps the NEXT frame's analysis instead of
              // blocking this frame's step.
              prevMatch = { roi: r.roi, frameIdx: myIdx, promise: Match.verifyRois(person.palmProfile, [r.roi], { fast: true }) };
            } else {
              applyMatch(null, null, myIdx);
            }
          });
        });
      });
    }
    function loop() {
      // v43: the owning view went away (navigation, Next Customer
      // re-arm, wallet close) — end silently with no verdict, no
      // log, no field record.
      if (control && control.cancelled) return finish({ stopped: true, fail: 'Scan stopped.' });
      var sp = tracker.state();
      if (sp.spoof) return spoofOut(sp);
      var lv = B.passiveLivenessCheck(poses);
      // v39 FAST WIN: the matched pair carried its own complete
      // evidence — both frames' own spoof samples clean, a real
      // micro-shift between their poses — so the win is honoured
      // at two analysed frames. The aggregate rejection above
      // still runs first: if the tracker has convicted the scan on
      // the frames examined so far, no win of either kind is
      // honoured. A replay whose frames trip the detector can
      // never take this path, because each matched frame's own
      // sample must be clean — stricter for the pair than the
      // aggregation rule (half the frames, at least two) that
      // governs rejection.
      if (win && win.fast) return verifiedOut();
      // A match may not be honoured until the spoof gate has examined
      // at least three frames. The two-frame win can complete inside
      // the first burst, before the tracker's aggregation rule (at
      // least two flagged frames) can ever fire - found by the E2E
      // replay leg, 2026-11-20: a screen replay of the enrolled palm
      // was VERIFIED at 0.445 while every replay frame, checked
      // directly against the detector, trips it. The detector was
      // right; the win simply outran the gate. (The v39 fast win
      // above does not outrun anything: it reads the two matched
      // frames' own already-recorded samples directly.)
      if (win && lv.pass && sp.framesChecked >= 3) return verifiedOut();
      if (win && lv.pass && statusEl) statusEl.textContent = 'Palm matched — confirming this is a live hand, not a screen…';
      // v37: the burst-era "two bursts" static guard is the same
      // evidence in continuous terms — six analysed frames.
      if (lv.verdict === 'static' && analysed >= 6) return livenessFailOut(lv);
      if (lv.verdict === 'erratic') return livenessFailOut(lv);
      if (analysed >= MAXF || Date.now() > deadline) {
        // A match from the last analysed frame may still be in the
        // worker: its score belongs to the record (the rolling
        // window, the best-score diagnostics, the finalOut set), so
        // drain it before any cap outcome — the burst chain applied
        // every match before loop() ever saw the caps.
        if (prevMatch) {
          var prev = prevMatch; prevMatch = null;
          return prev.promise.then(function (res) { applyMatch(res, prev.roi, prev.frameIdx); return loop(); });
        }
        if (win) {
          fieldRec(win.res.similarity, null, 'fail', 'rejected', sp.lightTag);
          Snd.buzz();
          return finish({ fail: 'Liveness could not be confirmed: the palm matched, but no natural micro-movement was observed. Nothing was verified. Present the real hand, held live — do not use a photo or a recording.' });
        }
        return finalOut();
      }
      // v37: the burst-era fallback (six bursts without a single
      // hand reading) is eighteen analysed frames in continuous
      // terms — the same amount of evidence, the same single swap.
      if (!swapped && swapCamera && analysed >= 18 && frames.every(function (x) { return typeof x.openness !== 'number'; })) {
        swapped = true;
        lastGrabT = -1; // the new stream's clock restarts
        if (statusEl) statusEl.textContent = 'No hand was seen by this camera - switching to the other camera and trying once more.';
        return swapCamera().then(function () { return loop(); }, function () { return loop(); });
      }
      if (statusEl) {
        var seenHandNow = frames.some(function (x) { return typeof x.openness === 'number'; });
        // v43: the live guidance pill — one concise line mapped
        // from the quality signals this frame already produced.
        var guide = B.palmGuidance({ hasHand: seenHandNow, framing: lastHint, openness: lastOpen, meanLuma: lastSampleB, glareFrac: lastGlare, sharpness: lastSharp, stable: false });
        statusEl.textContent = guide || (seenHandNow ? 'Hand detected — hold steady.' : 'Show & Pay scanning — show an open hand to the camera.');
      }
      return step().then(loop);
    }
    return loop();
  }

  /* Wallet identification (v42): WHO is this palm? The same
     streaming gates as Show & Pay — the coherence spoof tracker,
     passive liveness on the streamed poses, the two-frame rolling
     window, the v39 fast win on a spoof-clean naturally-shifting
     pair, MAXF and the deadline — but each frame's probe is scored
     against EVERY enrolled profile in one multi-profile call, and
     each candidate keeps its own rolling-window state, updated by
     the same B.streamMatchUpdate rule the 1:1 stream uses. The
     candidate whose state completes is the identified person.
     This is not a second, weaker scan path: the frame-level gates
     are shared evidence, the per-candidate match rule is identical,
     and a scan matching no enrolled palm identifies nobody. Used
     by the demo wallet (open wallet, find a send receiver). */
  function streamIdentifyPalm(video, statusEl, people, swapCamera, control) {
    var t0 = Date.now();
    var candidates = (people || []).filter(function (p) { return B.palmprintProfileSane(p.palmProfile); });
    if (!candidates.length) {
      return Promise.resolve({ fail: 'No palm is registered on this device yet — register a palm first. Registration issues the Biom ID and creates the wallet.' });
    }
    var tracker = makeSpoofTracker();
    var frames = [];
    var poses = [];
    var frameSpoof = [];
    var states = {};
    var appliedBy = {};
    candidates.forEach(function (p) { states[p.id] = { streak: 0, best: null }; appliedBy[p.id] = []; });
    var win = null; // { person, res, fast }
    var analysed = 0, swapped = false, locked = false;
    var lastHint = null, coded = 0;
    // v43: the latest frame's quality signals, feeding the live
    // guidance pill (B.palmGuidance) and the caller's scan session.
    var lastOpen = null, lastSampleB = null, lastGlare = null, lastSharp = null;
    var MAXF = 24, deadline = t0 + 90000;
    var frameCanvas = null;
    var lastGrabT = -1;
    var prevMatch = null;

    function spoofOut(sp) {
      DB.put('logs', { ts: Date.now(), personId: '', personName: '(wallet scan)', store: '', method: 'palm', measured: 'Spoof score ' + sp.score.toFixed(2) + ' - ' + sp.reasons.join('; '), result: 'Spoof / Screen Replay Detected' });
      Snd.buzz();
      return { fail: 'Spoof / Screen Replay Detected — the scan showed a screen or a recording, not a live hand (' + sp.reasons.join('; ') + '). Nothing was verified. Present the real hand, live in front of the camera.' };
    }
    function livenessFailOut(lv) {
      Snd.buzz();
      return { fail: lv.verdict === 'static'
        ? 'Liveness check failed: the palm did not move naturally at all — a still photo or a frozen image cannot be used. Nothing was verified. Present the real hand, held live in front of the camera.'
        : 'Liveness check failed: the view changed too abruptly for one held hand. Nothing was verified. Hold one open palm steady in front of the camera.' };
    }
    function identifiedOut() {
      var measured = 'Palmprint similarity ' + win.res.similarity.toFixed(3) + ' (threshold ' + win.res.threshold + ', score-level max: best pair of the winning frame re-encoded at 25 image-level shifts plus the v41 geometric variants against ' + win.person.palmProfile.codes.length + ' individual enrolled print codes), passive liveness passed (' + (win.fast ? 'natural micro-shift between the two matched frames; fast win honoured on the matched pair, both frames spoof-clean' : 'natural micro-shift across rapid frames') + '), wallet identification scan (1:N over ' + candidates.length + ' enrolled palms)';
      return { person: win.person, r: win.res, measured: measured, latencyMs: Date.now() - t0 };
    }
    function finalOut() {
      var sp = tracker.state();
      if (sp.spoof) return spoofOut(sp);
      var lv = B.passiveLivenessCheck(poses);
      var liveRois = B.selectPalmprintLiveRois(frames);
      if (!liveRois) {
        return { fail: 'No usable open palm with readable print detail found in the scan. Nothing was verified. Show one open palm to the camera, fingers spread, in good light, and run the scan again. (' + analysed + ' frames scanned, ' + coded + ' produced a readable palm code.' + (lastHint ? ' Last guidance shown: ' + lastHint : '') + ')' };
      }
      return Match.verifyRoisMulti(candidates.map(function (p) { return p.palmProfile; }), liveRois).then(function (results) {
        var best = null, bestPerson = null;
        (results || []).forEach(function (ro, i) {
          if (ro && typeof ro.similarity === 'number' && (best === null || ro.similarity > best.similarity)) { best = ro; bestPerson = candidates[i]; }
        });
        if (best && best.verified) {
          // Same rule as Show & Pay: a single-frame match is not an
          // identification — the rolling window must complete.
          return { fail: 'That palm matched ' + bestPerson.name + ' on a single frame only — identification requires two matching frames close together. Hold the palm steady a moment longer and scan again. Nothing was opened.' };
        }
        return { fail: 'This palm did not match any registered palm on this device, so nothing was opened and no one was identified. (' + analysed + ' frames scanned, ' + coded + ' with a readable code, best score ' + (best && typeof best.similarity === 'number' ? best.similarity.toFixed(3) : 'n/a') + ' against any enrolled palm.)' };
      });
    }
    function pushApplied(p, score, frameIdx) {
      var entry = {
        matched: typeof score === 'number' && score >= B.PALMPRINT_THRESHOLD,
        pose: (typeof frameIdx === 'number' && frames[frameIdx]) ? frames[frameIdx].pose : null,
        spoof: (typeof frameIdx === 'number' && frameIdx < frameSpoof.length) ? frameSpoof[frameIdx] : null
      };
      appliedBy[p.id].push(entry);
      return entry;
    }
    function applyMatch(results, roi, frameIdx) {
      candidates.forEach(function (p, i) {
        var res = results ? results[i] : null;
        var score = res && typeof res.similarity === 'number' ? res.similarity : null;
        states[p.id] = B.streamMatchUpdate(states[p.id], score);
        var entry = pushApplied(p, score, frameIdx);
        if (states[p.id].done && !win) {
          win = { person: p, res: res, fast: false };
          var arr = appliedBy[p.id];
          var partner = null;
          for (var k = arr.length - 2; k >= arr.length - 3 && k >= 0; k--) {
            if (arr[k].matched) { partner = arr[k]; break; }
          }
          if (partner && B.streamFastWinCheck(partner, entry).ok) win.fast = true;
        }
      });
    }
    function waitFreshFrame() {
      if (lastGrabT < 0) return Promise.resolve();
      var target = lastGrabT + 0.1;
      function poll() {
        if (video.currentTime >= target || Date.now() > deadline) return Promise.resolve();
        return waitMs(8).then(poll);
      }
      return poll();
    }
    function step() {
      return waitFreshFrame().then(function () {
        if (!frameCanvas) frameCanvas = document.createElement('canvas');
        var frame = grabVideoFrameInto(video, frameCanvas);
        if (!frame) return waitMs(60);
        lastGrabT = video.currentTime;
        return analysePalmFrame(frame).then(function (r) {
          analysed++;
          var sample = tracker.add(frame, r.lm);
          frames.push(r);
          frameSpoof.push(sample ? !!sample.spoof : null);
          var myIdx = frames.length - 1;
          if (typeof r.openness === 'number') lastHint = r.framing || null;
          // v43: publish the frame's quality signals — the scan
          // session reads stability from the pose, the guidance
          // pill from the rest. Guidance only; no gate reads these.
          lastOpen = typeof r.openness === 'number' ? r.openness : null;
          lastSharp = typeof r.sharpness === 'number' ? r.sharpness : null;
          lastSampleB = sample && typeof sample.meanBrightness === 'number' ? sample.meanBrightness : null;
          lastGlare = sample && typeof sample.glare === 'number' ? sample.glare : null;
          if (control && control.onFrame) {
            try { control.onFrame({ hasHand: typeof r.openness === 'number', pose: r.pose || null, openness: lastOpen, framing: lastHint, sharpness: lastSharp, meanLuma: lastSampleB, glareFrac: lastGlare }); } catch (e) {}
          }
          if (r.pose) { poses.push(r.pose); if (poses.length > 6) poses.shift(); }
          var sane = !!(r.code && B.palmprintCodeSane(r.code));
          if (sane) coded++;
          if (sane && !locked) { locked = true; Snd.tick(); }
          var prev = prevMatch; prevMatch = null;
          var drained = prev
            ? prev.promise.then(function (results) { applyMatch(results, prev.roi, prev.frameIdx); })
            : Promise.resolve();
          return drained.then(function () {
            if (sane && r.roi) {
              prevMatch = { roi: r.roi, frameIdx: myIdx, promise: Match.verifyRoisMulti(candidates.map(function (p) { return p.palmProfile; }), [r.roi]) };
            } else {
              applyMatch(null, null, myIdx);
            }
          });
        });
      });
    }
    function loop() {
      // v43: the owning view went away (wallet closed, navigation)
      // — end silently with no identification and no log.
      if (control && control.cancelled) return { stopped: true, fail: 'Scan stopped.' };
      var sp = tracker.state();
      if (sp.spoof) return spoofOut(sp);
      var lv = B.passiveLivenessCheck(poses);
      if (win && win.fast) return identifiedOut();
      if (win && lv.pass && sp.framesChecked >= 3) return identifiedOut();
      if (win && lv.pass && statusEl) statusEl.textContent = 'Palm identified — confirming this is a live hand, not a screen…';
      if (lv.verdict === 'static' && analysed >= 6) return livenessFailOut(lv);
      if (lv.verdict === 'erratic') return livenessFailOut(lv);
      if (analysed >= MAXF || Date.now() > deadline) {
        if (prevMatch) {
          var prev = prevMatch; prevMatch = null;
          return prev.promise.then(function (results) { applyMatch(results, prev.roi, prev.frameIdx); return loop(); });
        }
        if (win) {
          Snd.buzz();
          return { fail: 'Liveness could not be confirmed: the palm matched, but no natural micro-movement was observed. Nothing was verified. Present the real hand, held live — do not use a photo or a recording.' };
        }
        return finalOut();
      }
      if (!swapped && swapCamera && analysed >= 18 && frames.every(function (x) { return typeof x.openness !== 'number'; })) {
        swapped = true;
        lastGrabT = -1;
        if (statusEl) statusEl.textContent = 'No hand was seen by this camera - switching to the other camera and trying once more.';
        return swapCamera().then(function () { return loop(); }, function () { return loop(); });
      }
      if (statusEl) {
        var seenHandNow = frames.some(function (x) { return typeof x.openness === 'number'; });
        // v43: the live guidance pill — one concise line mapped
        // from the quality signals this frame already produced.
        var guide = B.palmGuidance({ hasHand: seenHandNow, framing: lastHint, openness: lastOpen, meanLuma: lastSampleB, glareFrac: lastGlare, sharpness: lastSharp, stable: false });
        statusEl.textContent = guide || (seenHandNow ? 'Hand detected — hold steady.' : 'Show an open hand to the camera.');
      }
      return step().then(loop);
    }
    return loop();
  }

  var palmScanBusy = false;

  /* ---------------- Navigation ------------------------------------------- */
  function go(page) {
    var navPage = page === 'topup' ? 'registry' : (page === 'stores' || page === 'logs' || page === 'partner') ? 'more' : page;
    document.querySelectorAll('#mainNav button').forEach(function (b) { b.classList.toggle('active', b.dataset.page === navPage); });
    document.querySelectorAll('section.page').forEach(function (s) { s.classList.toggle('active', s.id === 'page-' + page); });
    if (page !== 'enroll' && page !== 'terminal') { Cam.stop(); }
    // v43 hands-free lifecycle: leaving a scan view cancels its
    // running scan silently — no verdict can land on a view that is
    // no longer on screen, and no presentation is processed twice.
    if (page !== 'terminal') { cancelTermScan(); termSession.leave(); }
    if (page !== 'enroll' && enrollControl) enrollControl.cancelled = true;
    if (page !== 'topup' && topupControl) topupControl.cancelled = true;
    if (page !== 'wallet') { if (walletControl) walletControl.cancelled = true; walletSession.leave(); }
    if (page === 'wallet') { renderWallet(); Pipeline.enterScanView(); }
    if (page === 'dashboard') renderDashboard();
    if (page === 'registry') renderRegistry();
    if (page === 'logs') renderLogs();
    if (page === 'terminal') { fillTerminalPeople().then(function () { maybeAutoStartTerminal(); }); Pipeline.enterScanView(); }
    if (page === 'enroll') { Pipeline.enterScanView(); maybeAutoStartEnroll(); }
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('#mainNav button').forEach(function (b) {
    b.addEventListener('click', function () { go(b.dataset.page); });
  });
  document.querySelectorAll('[data-launch]').forEach(function (b) {
    b.addEventListener('click', function () { go('terminal'); $('termStore').value = b.dataset.launch; toast('Terminal set to ' + b.dataset.launch); });
  });
  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { go(b.dataset.go); });
  });

  /* ---------------- Dashboard -------------------------------------------- */
  function renderDashboard() {
    return Promise.all([DB.all('people'), DB.all('logs'), DB.all('transactions')]).then(function (r) {
      var people = r[0], logs = r[1], txs = r[2];
      var todayLogs = logs.filter(function (l) { return isToday(l.ts); });
      var verified = todayLogs.filter(function (l) { return l.result === 'Verified'; }).length;
      $('statPeople').textContent = people.length;
      $('statVerifs').textContent = todayLogs.length;
      $('statRate').textContent = todayLogs.length ? Math.round((verified / todayLogs.length) * 100) + '%' : '—';
      $('statWallets').textContent = people.filter(function (p) { return p.walletProvider; }).length;
      var vol = txs.filter(function (t) { return isToday(t.ts); }).reduce(function (s, t) { return s + Number(t.amount || 0); }, 0);
      $('statVolume').textContent = 'BDT ' + vol.toLocaleString();
      var feed = logs.slice(-6).reverse().map(function (l) {
        return '<div><b>' + esc(fmtTime(l.ts)) + '</b> — ' + esc(l.personName) + ' · ' + esc(l.method) + ' · ' + esc(l.measured) + ' · <span class="badge ' + (l.result === 'Verified' ? 'ok' : 'bad') + '">' + esc(l.result) + '</span></div>';
      }).join('');
      $('liveFeed').innerHTML = feed || 'No activity yet on this device.';
    });
  }

  /* ---------------- Enroll flow ------------------------------------------
     Palm-only (v33): a Biom ID is created from the palm enrolment
     alone — details, one movement-checked palm scan, done. */
  var ENROLL_ORDER = ['palm'];
  var METHOD_LABEL = { palm: 'Palm' };
  var enroll = { details: null, palm: null, types: { palm: true } };
  var STEP_LABEL = { details: 'Details + Wallet', palm: 'Palm Scan', done: 'Biom ID' };
  function setStep(step) {
    ['details', 'palm', 'done'].forEach(function (s) {
      $('enroll-' + s).classList.toggle('hidden', s !== step);
    });
    var flow = ['details', 'palm', 'done'];
    var idx = flow.indexOf(step);
    if (idx >= 0) {
      $('enrollProgress').textContent = 'Step ' + (idx + 1) + ' of ' + flow.length + ' — ' + STEP_LABEL[step];
      $('enrollProgressBar').style.width = Math.round(((idx + 1) / flow.length) * 100) + '%';
    }
  }
  function capturedCount() { return enroll.palm ? 1 : 0; }
  function advanceFrom(step) {
    finishEnrollment(step);
  }
  function finishEnrollment(fromStep) {
    function fail(html) {
      if ($('palmMsg')) $('palmMsg').innerHTML = html;
      toast('Enrollment not finished - the palm was not captured.');
      Snd.buzz();
      Snd.speak('Registration failed');
    }
    if (!enroll.details) { fail('<div class="error">Enrollment is incomplete - details are missing. Go back and start again.</div>'); return; }
    if (capturedCount() === 0) {
      fail('<div class="error">No palm was captured, so no Biom ID was issued. A Biom ID is created from the palm scan — complete the palm capture above.</div>');
      return;
    }
    Cam.stop();
    DB.nextSeq('biomSeq', 2841).then(function (seq) {
      var person = {
        id: 'TSG-BIO-' + seq,
        name: enroll.details.name, phone: enroll.details.phone, type: enroll.details.type, store: enroll.details.store,
        walletProvider: enroll.details.walletProvider, walletNumber: enroll.details.walletNumber,
        limits: { perTx: enroll.details.limitPerTx || null, daily: enroll.details.limitDaily || null },
        loyaltyPoints: 0,
        // v42: registration also creates the person's demonstration
        // wallet — the Biom ID is the wallet account, balance 0.
        wallet: B.walletNew(),
        palmProfile: enroll.palm || null,
        enrolledAt: Date.now()
      };
      return DB.put('people', person).then(function () {
        setStep('done');
        $('enrollDoneBody').innerHTML =
          '<b>Name:</b> ' + esc(person.name) + '<br><b>Biom ID:</b> ' + esc(person.id) + '<br>' +
          '<b>Store:</b> ' + esc(person.store) + '<br>' +
          '<b>Palm:</b> ' + (person.palmProfile && person.palmProfile.v === 3 ? 'Enrolled (palmprint — EDCC competitive code, ' + person.palmProfile.codes.length + ' individual captures, movement-checked)' : 'Not enrolled') + '<br>' +
          '<b>Wallet:</b> ' + (person.walletProvider ? esc(person.walletProvider) + ' ' + esc(B.maskWalletNumber(person.walletNumber)) : 'Not linked') + '<br>' +
          '<b>Biometric-only limits:</b> ' + (person.limits.perTx ? 'BDT ' + person.limits.perTx.toLocaleString() + ' per transaction' : 'No per-transaction limit') + (person.limits.daily ? ', BDT ' + person.limits.daily.toLocaleString() + ' per day' : '') + '<br>' +
          '<b>Palm Loyalty:</b> Active — 0 points<br>' +
          '<b>Demo wallet:</b> Created — this Biom ID is the wallet account, balance BDT 0. Open My Wallet and scan this palm to use it. Demo money inside the app, not real funds.';
        enroll = { details: null, palm: null, types: { palm: true } };
        toast('Enrolled: ' + person.id);
        // Voice verdict (v23, his order): spoken ONLY here, after the
        // record is actually saved - never on a step, never early.
        Snd.chime();
        Snd.speak('Registration done successfully');
      });
    }).catch(function (e) { fail('<div class="error">Could not save enrollment on this device: ' + esc(e.message || e) + '</div>'); });
  }
  function fillStoreSelects() {
    ['enStore', 'termStore'].forEach(function (id) {
      $(id).innerHTML = STORES.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
    });
  }

  $('enrollDetailsNext').addEventListener('click', function () {
    var name = $('enName').value.trim();
    var provider = $('enWalletProvider').value;
    var walletRaw = $('enWalletNumber').value.trim();
    var wallet = null;
    var err = '';
    if (!name) err = 'Enter the person\'s full name.';
    if (!err && provider) {
      wallet = B.normaliseWalletNumber(walletRaw);
      if (!wallet) err = 'Wallet number is not a valid Bangladeshi mobile number (01 + 9 digits). It was not saved.';
    }
    if (!err && !provider && walletRaw) err = 'Choose bKash or Nagad, or clear the wallet number.';
    if (err) { $('enrollDetailsError').innerHTML = '<div class="error">' + esc(err) + '</div>'; return; }
    $('enrollDetailsError').innerHTML = '';
    enroll.palm = null;
    resetPalmEnroll();
    enroll.details = {
      name: name, phone: $('enPhone').value.trim(), type: $('enType').value, store: $('enStore').value,
      walletProvider: provider || '', walletNumber: wallet || '',
      limitPerTx: Number($('enLimitPerTx').value) > 0 ? Number($('enLimitPerTx').value) : null,
      limitDaily: Number($('enLimitDaily').value) > 0 ? Number($('enLimitDaily').value) : null
    };
    setStep('palm');
    // v43 hands-free: the palm step starts its camera and the
    // guided capture by itself — no Start Camera or Capture tap.
    startPalmCamera(true);
  });

  /* Palm enroll - live auto-capture: the app watches the camera,
     runs a random movement sequence (a photo cannot perform one),
     and banks the individual palmprint codes (profile v3) read from
     the best fully-open frames — v33 stores those individual capture
     codes only, no fused template. */
  function resetPalmEnroll() { /* clip enrolment keeps no partial state */ }
  /* v43 hands-free enrolment entry: entering the palm step starts
     the camera AND the guided capture automatically. The Start
     Camera and Auto-Capture buttons remain as fallback/re-trigger
     only. runPalmCapture's busy guard makes a re-trigger during a
     running capture a no-op. */
  var enrollControl = null;
  function startPalmCamera(autoCapture) {
    return Cam.start($('palmVideo'), camFacing.enrollPalm, 'enrollPalm').then(function () {
      Pipeline.enterScanView();
      $('palmCapture').disabled = false;
      if (autoCapture) { runPalmCapture(); return; }
      $('palmStatus').textContent = 'Camera on — show your open hand to the camera, anywhere in the frame, or tap Auto-Capture Palm. The app watches live and captures by itself: follow the movement prompts, then the angle prompts, and it finishes by itself.';
    }).catch(function (e) { $('palmMsg').innerHTML = cameraErrorHTML(e); $('palmStatus').textContent = 'Camera blocked.'; });
  }
  function maybeAutoStartEnroll() {
    if (!enroll.details) return;
    if ($('enroll-palm').classList.contains('hidden')) return;
    startPalmCamera(true);
  }
  $('palmStart').addEventListener('click', function () { startPalmCamera(true); });
  camRestarters.enrollPalm = function () { startPalmCamera(true); };
  function runPalmCapture() {
    if (palmScanBusy) return;
    if (!enroll.details) return;
    palmScanBusy = true;
    $('palmCapture').disabled = true;
    $('palmMsg').innerHTML = '';
    var sequence = B.PALM_SEQUENCES[Math.floor(Math.random() * B.PALM_SEQUENCES.length)];
    var control = { cancelled: false };
    enrollControl = control;
    streamEnrolPalm($('palmVideo'), $('palmStatus'), sequence, function () {
      camFacing.enrollPalm = camFacing.enrollPalm === 'user' ? 'environment' : 'user';
      syncCamToggle('enrollPalm');
      return Cam.start($('palmVideo'), camFacing.enrollPalm, 'enrollPalm');
    }, control).then(function (res) {
      palmScanBusy = false;
      if (res.stopped) { $('palmCapture').disabled = false; $('palmStatus').textContent = 'Capture stopped.'; return; }
      if (res.spoof && res.spoof.spoof) {
        DB.put('logs', { ts: Date.now(), personId: '', personName: '(enrolment attempt)', store: '', method: 'palm', measured: 'Spoof score ' + res.spoof.score.toFixed(2) + ' - ' + res.spoof.reasons.join('; '), result: 'Spoof / Screen Replay Detected' });
        $('palmMsg').innerHTML = '<div class="error">Spoof / Screen Replay Detected — the scan showed a screen or a recording, not a live hand (' + esc(res.spoof.reasons.join('; ')) + '). Nothing was stored. Enrolment requires the real hand, live in front of the camera.</div>';
        $('palmCapture').disabled = false;
        Snd.buzz();
        return;
      }
      if (!res.movement.pass) {
        $('palmMsg').innerHTML = '<div class="error">Movement check failed: ' + esc(res.movement.reason) + ' Nothing was stored. Try again and complete the movement sequence shown in the prompts, in order, while the app watches.</div>';
        $('palmCapture').disabled = false;
        Snd.buzz();
        return;
      }
      // v43: bank per MEASURED pose first — the sharpest fully-open
      // code for each pose the hand actually presented — so the
      // profile carries the tilted and angled presentations the
      // v41 diagnosis indicted. When no pose set banked (a hard
      // session), the classic selector still enrols the palm.
      var poseSel = B.selectPalmprintPoseCodes(res.results);
      var codes = poseSel ? poseSel.codes : B.selectPalmprintProfileCodes(res.results);
      if (!codes) {
        $('palmMsg').innerHTML = '<div class="error">No usable open palm with readable print detail was captured. Nothing was stored. Show one open palm to the camera, fingers spread, in good light, and try again.</div>';
        $('palmCapture').disabled = false;
        return;
      }
      enroll.palm = { v: 3, codes: codes };
      if (poseSel) enroll.palm.poses = poseSel.poses;
      Cam.stop();
      $('palmStatus').textContent = 'Palm captured.';
      $('palmMsg').innerHTML = '<div class="success">Palm enrolled by hands-free guided capture in ' + (res.elapsedMs / 1000).toFixed(1) + ' s: movement check passed, and ' + codes.length + ' palmprint codes (EDCC competitive code — the palm\'s own print pattern) were banked' + (poseSel ? ' across ' + poseSel.tags.length + ' measured poses (' + esc(poseSel.tags.join(', ')) + '), the best fully-open frame of each' : ' from the best fully-open frames') + '.</div>';
      Snd.chime();
      Snd.speak('Palm captured');
      advanceFrom('palm');
    }).catch(function (e) {
      palmScanBusy = false;
      $('palmCapture').disabled = false;
      $('palmMsg').innerHTML = '<div class="error">Palm capture failed: ' + esc(e && e.message ? e.message : e) + ' Nothing was stored.</div>';
    });
  }
  $('palmCapture').addEventListener('click', runPalmCapture);
  /* ---------------- Terminal --------------------------------------------- */
  var termPeopleCache = [];
  function renderTermPeople() {
    var q = ($('termSearch').value || '').toLowerCase();
    var current = $('termPerson').value;
    var list = termPeopleCache.filter(function (p) {
      return !q || p.name.toLowerCase().indexOf(q) >= 0 || p.id.toLowerCase().indexOf(q) >= 0 || (p.phone || '').indexOf(q) >= 0;
    });
    $('termPerson').innerHTML = list.length
      ? list.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' — ' + esc(p.id) + '</option>'; }).join('')
      : '<option value="">' + (termPeopleCache.length ? 'No one matches that search' : 'No one enrolled on this device yet') + '</option>';
    if (list.some(function (p) { return p.id === current; })) $('termPerson').value = current;
    else if (list.length) $('termPerson').value = list[0].id; // first fill: select the first person explicitly - an innerHTML rebuild can otherwise leave the dropdown showing a name while its value stays empty (found by the 2026-11-20 end-to-end test)
    fillTermMethodNote();
  }
  function fillTerminalPeople() {
    return DB.all('people').then(function (people) {
      termPeopleCache = people;
      renderTermPeople();
    });
  }
  // Palm-only (v33): the note states the selected person's palm status.
  function fillTermMethodNote() {
    var person = termPeopleCache.find(function (p) { return p.id === $('termPerson').value; }) || null;
    $('termMethodNote').textContent = person
      ? (personHasMethod(person) ? person.name + ' enrolled: Palm — Palmprint.' : person.name + ' has no usable palm enrolled - re-enroll this person first.')
      : '';
    $('termScan').disabled = true;
    syncCamToggle('terminal');
    syncFlashToggle('terminal');
    setFlashNote('terminal', flashState[termFacingKey()] ? 'Flash is set On - it will light when this camera starts.' : '');
    applyMirror('termVideo', camFacing[termFacingKey()]);
  }
  function personHasMethod(person) {
    // An enrollment only counts if the stored data is present AND sane -
    // a missing, empty or degenerate profile can never be verified against.
    if (!person) return false;
    return B.palmprintProfileSane(person.palmProfile);
  }
  function notEnrolledMessage(person) {
    return 'This person has no usable palmprint enrolled - re-enroll this person first.';
  }
  function getTerminalPerson() {
    var personId = $('termPerson').value;
    return DB.all('people').then(function (people) {
      return people.find(function (p) { return p.id === personId; }) || null;
    });
  }
  /* v43 hands-free terminal: a scan session governs the view —
     it tracks hand stability, enforces the post-verdict cooldown
     (no second verdict can fire inside it, so one presentation is
     never processed twice), and Next Customer re-arms instantly. */
  var termSession = B.createScanSession();
  var termControl = null;
  function cancelTermScan() { if (termControl) termControl.cancelled = true; }
  function maybeAutoStartTerminal() {
    if (!$('page-terminal').classList.contains('active')) return;
    termSession.enter();
    var person = termPeopleCache.find(function (p) { return p.id === $('termPerson').value; }) || null;
    if (!person || !personHasMethod(person)) return;
    if (palmScanBusy) return;
    startTermCamera();
  }
  $('termPerson').addEventListener('change', function () {
    // A different customer: cancel any running scan silently,
    // re-arm the session, and start the new customer's scan.
    cancelTermScan();
    termSession.reset();
    $('termNext').classList.add('hidden');
    fillTermMethodNote();
    startTermCamera();
  });
  $('termSearch').addEventListener('input', renderTermPeople);
  function startTermCamera() {
    var status = $('termStatus');
    getTerminalPerson().then(function (person) {
      if (!person) { $('termResult').innerHTML = '<div class="error">Select an enrolled person first. Enroll on this device if the registry is empty.</div>'; return; }
      if (!personHasMethod(person)) {
        Cam.stop();
        $('termScan').disabled = true;
        status.textContent = 'Camera not started.';
        $('termResult').innerHTML = '<div class="error">' + notEnrolledMessage(person) + '</div>';
        return;
      }
      Cam.start($('termVideo'), camFacing[termFacingKey()], termFacingKey()).then(function () {
        Pipeline.enterScanView();
        $('termScan').disabled = false;
        status.textContent = 'Camera on — scanning. The customer simply holds an open palm toward the camera, anywhere in the frame — like tapping a card. No tap needed and no movement routine at checkout: Show & Pay reads the palm as it streams.';
        // v43: the scan starts by itself; SCAN stays as fallback.
        runTermScan();
      }).catch(function (e) { $('termResult').innerHTML = cameraErrorHTML(e); status.textContent = 'Camera blocked.'; });
    });
  }
  $('termStart').addEventListener('click', startTermCamera);
  camRestarters.terminal = startTermCamera;
  $('termNext').addEventListener('click', function () {
    // Next Customer: instant clean reset — verdict card cleared,
    // cooldown cleared, scanning again for the next presentation.
    termSession.reset();
    $('termNext').classList.add('hidden');
    $('termResult').innerHTML = '';
    $('termStatus').textContent = 'Ready — scanning for the next customer.';
    if (Cam.stream && Cam.video === $('termVideo')) runTermScan();
    else startTermCamera();
  });

  function logVerification(person, method, measured, result) {
    return DB.put('logs', { ts: Date.now(), personId: person.id, personName: person.name, store: $('termStore').value, method: method, measured: measured, result: result });
  }

  /* ---------------- Field Test Mode (v18) -------------------------------
     When ON, every terminal palm scan also writes a field-test record
     (kind 'fieldtest' in the logs store): camera, auto lighting tag,
     genuine score, highest score against any OTHER enrolled palm,
     liveness result, operator-set attempt type, and the outcome. The
     Logs panel turns those records into GAR / FAR / spoof-rejection
     metrics and the exportable CSV via the pure functions in
     biometrics.js, so screen, CSV and tests always agree. */
  function fieldModeOn() { try { return localStorage.getItem('biomFieldMode') === '1'; } catch (e) { return false; } }
  function setFieldMode(on) {
    try { localStorage.setItem('biomFieldMode', on ? '1' : '0'); } catch (e) {}
    if ($('fieldModeToggle')) $('fieldModeToggle').checked = on;
    if ($('fieldModeToggle2')) $('fieldModeToggle2').checked = on;
    if ($('fieldRow')) $('fieldRow').classList.toggle('hidden', !on);
  }
  function currentCameraTag(viewKey) {
    try {
      var track = Cam.stream && Cam.stream.getVideoTracks()[0];
      var f = track && track.getSettings && track.getSettings().facingMode;
      if (f === 'user') return 'front';
      if (f === 'environment') return 'back';
    } catch (e) {}
    return camFacing[viewKey] === 'environment' ? 'back' : 'front';
  }
  function writeFieldRecord(rec) {
    rec.kind = 'fieldtest';
    return DB.put('logs', rec).then(function () { renderFieldPanel(); });
  }

  function runTermScan() {
    var personId = $('termPerson').value;
    var method = 'palm';
    var amount = Number($('termAmount').value || 0);
    $('termNext').classList.add('hidden');
    $('termResult').innerHTML = '<div class="notice">Scanning — comparing against the stored enrollment...</div>';
    DB.all('people').then(function (people) {
      var person = people.find(function (p) { return p.id === personId; });
      if (!person) { $('termResult').innerHTML = '<div class="error">Select an enrolled person first. Enroll on this device if the registry is empty.</div>'; return null; }
      if (!personHasMethod(person)) {
        $('termResult').innerHTML = '<div class="error">' + notEnrolledMessage(person) + ' No scan was run and nothing was verified.</div>';
        return null;
      }

      if (palmScanBusy) return null;
      palmScanBusy = true;
      $('termScan').disabled = true;
      $('termResult').innerHTML = '<div class="notice">Show &amp; Pay — the customer simply holds an open palm toward the camera, like tapping a card. Scanning...</div>';
      var fieldRec = function (genuineScore, impostorMax, liveness, result, lightTag) {
        if (!fieldModeOn()) return;
        writeFieldRecord({
          ts: Date.now(), biomId: person.id, camera: currentCameraTag(termFacingKey()),
          lighting: lightTag || '', genuineScore: genuineScore, impostorMax: impostorMax,
          liveness: liveness, spoofTag: $('fieldAttemptTag').value, result: result
        });
      };
      var control = { cancelled: false, onFrame: function (info) { termSession.frame({ hasHand: info.hasHand, pose: info.pose }); } };
      termControl = control;
      var attempt = streamVerifyPalm($('termVideo'), $('termStatus'), person, people, function () {
        var k = termFacingKey();
        camFacing[k] = camFacing[k] === 'user' ? 'environment' : 'user';
        syncCamToggle('terminal');
        return Cam.start($('termVideo'), camFacing[k], 'terminal');
      }, fieldRec, control).then(function (out) {
        palmScanBusy = false;
        $('termScan').disabled = false;
        return out;
      }).catch(function (e) {
        palmScanBusy = false;
        $('termScan').disabled = false;
        return { fail: 'Palm scan failed: ' + (e && e.message ? e.message : e) + ' Nothing was verified.' };
      });

      return Promise.resolve(attempt).then(function (out) {
        if (!out) return;
        if (out.stopped) return; // v43: the view moved on — no verdict shown, nothing logged, nothing processed twice
        // v43: a terminal verdict fired — the session enters its
        // cooldown and the terminal offers Next Customer.
        termSession.verdict();
        $('termNext').classList.remove('hidden');
        if (out.fail) { Snd.buzz(); $('termResult').innerHTML = '<div class="error">' + esc(out.fail) + '</div>'; return; }
        var r = out.r;
        var verified = r.ok === true && r.verified === true; // fail closed: only an explicit pass verifies
        return logVerification(person, method, out.measured, verified ? 'Verified' : 'Denied').then(function () {
          var html;
          // v20 latency line: the exact end-to-end scan time, shown on
          // the confirmation card (palm streaming scans carry it).
          var latencyLine = (typeof out.latencyMs === 'number')
            ? '<div class="who">' + (verified ? 'Verified' : 'Scanned') + ' in ' + out.latencyMs.toLocaleString() + ' ms' + (r && typeof r.similarity === 'number' ? ' • Score ' + r.similarity.toFixed(2) : '') + '</div>'
            : '';
          if (!verified) {
            html = '<div class="resultbig bad"><div class="verdict">NOT VERIFIED</div><div class="who">' + esc(person.name) + ' — Palm scan did not match</div>' + latencyLine + '<div class="meas">' + esc(r.reason) + '<br>Measured: ' + esc(out.measured) + '</div></div>';
            $('termResult').innerHTML = html;
            Snd.buzz();
            return;
          }
          Snd.chime();
          html = '<div class="resultbig ok"><div class="verdict">VERIFIED</div><div class="who">' + esc(person.name) + ' (' + esc(person.id) + ')</div>' + latencyLine + '<div class="meas">Measured: ' + esc(out.measured) + '</div></div>';
          // Palm Loyalty (live mode, v18): every verified palm scan
          // earns points - 1 per BDT 10 on a payment, 5 for a visit
          // scan - credited to the customer's Biom ID record.
          var loyaltyLine = '';
          var pts = amount > 0 ? Math.floor(amount / 10) : 5;
          if (pts > 0) {
            person.loyaltyPoints = (person.loyaltyPoints || 0) + pts;
            loyaltyLine = '<div class="notice" style="margin-top:10px">Palm Loyalty: +' + pts + ' points awarded — balance ' + person.loyaltyPoints + ' points.</div>';
            DB.put('people', person);
          }
          if (amount > 0) {
            if (!person.walletProvider) {
              $('termResult').innerHTML = html + loyaltyLine + '<div class="error" style="margin-top:10px">Biom Pay not created: this person has no linked bKash / Nagad wallet.</div>';
              Snd.speak('Palm recognized');
              return;
            }
            var createPay = function () {
              return DB.nextSeq('paySeq', 1001).then(function (seq) {
                var tx = {
                  id: 'BIOM-PAY-' + seq, ts: Date.now(), personId: person.id, personName: person.name,
                  provider: person.walletProvider, walletMasked: B.maskWalletNumber(person.walletNumber),
                  store: $('termStore').value, amount: amount, method: method, measured: out.measured, status: PAY_STATUS
                };
                return DB.put('transactions', tx).then(function () {
                  $('termResult').innerHTML = html + loyaltyLine +
                    '<div class="receipt"><div class="rhead">Biom Pay — Payment Authorized</div><div class="kv">' +
                    '<b>Amount:</b> BDT ' + tx.amount.toLocaleString() + '<br>' +
                    '<b>Paid by:</b> ' + esc(person.name) + '<br>' +
                    '<b>Wallet:</b> ' + esc(tx.provider) + ' ' + esc(tx.walletMasked) + '<br>' +
                    '<b>Record ID:</b> ' + esc(tx.id) + ' (TSG Biom record — not a ' + esc(tx.provider) + ' TrxID)<br>' +
                    '<b>Store:</b> ' + esc(tx.store) + '<br><b>Authorized by:</b> ' + 'Palm' + ' scan — ' + esc(out.measured) + '<br>' +
                    '<b>Status:</b> ' + esc(tx.status) + '</div></div>';
                  toast('Biom Pay authorized: ' + tx.id);
                  Snd.speak('Payment complete');
                });
              });
            };
            // Biometric-only limits set at registration (regBIOM): above
            // a limit the palm alone does not create a payment - PIN
            // confirmation is required, so nothing is recorded as paid.
            if (person.limits && person.limits.perTx && amount > person.limits.perTx) {
              $('termResult').innerHTML = html + loyaltyLine + '<div class="error" style="margin-top:10px">Biom Pay not created: BDT ' + amount.toLocaleString() + ' exceeds this customer\'s biometric-only per-transaction limit of BDT ' + person.limits.perTx.toLocaleString() + '. PIN confirmation is required above the limit.</div>';
              Snd.speak('Palm recognized');
              return;
            }
            if (person.limits && person.limits.daily) {
              return DB.all('transactions').then(function (txs) {
                var dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
                var todaySum = txs.filter(function (t) { return t.personId === person.id && t.ts >= dayStart.getTime(); }).reduce(function (s, t) { return s + Number(t.amount || 0); }, 0);
                if (todaySum + amount > person.limits.daily) {
                  $('termResult').innerHTML = html + loyaltyLine + '<div class="error" style="margin-top:10px">Biom Pay not created: this payment would take today\'s total to BDT ' + (todaySum + amount).toLocaleString() + ', above this customer\'s biometric-only daily limit of BDT ' + person.limits.daily.toLocaleString() + '. PIN confirmation is required above the limit.</div>';
                  Snd.speak('Palm recognized');
                  return;
                }
                return createPay();
              });
            }
            return createPay();
          }
          $('termResult').innerHTML = html + loyaltyLine;
          Snd.speak('Palm recognized');
        });
      });
    }).catch(function (e) { $('termResult').innerHTML = '<div class="error">Scan failed: ' + esc(e && e.message ? e.message : e) + '</div>'; });
  }
  $('termScan').addEventListener('click', runTermScan);

  /* ---------------- Demo wallet (v42) --------------------------------
     The wallet layer the Chairman ordered 2026-11-23. Every rule
     about the money itself lives in the B.wallet* store layer in
     biometrics.js — this section only runs scans and renders. The
     scans are the EXISTING pipelines: streamIdentifyPalm (1:N) to
     open a wallet or find a receiver, streamVerifyPalm (1:1) to
     authorise as a named person. Their outcomes are converted to
     the authorisation object the store layer consumes
     ({ verified, personId }); a failed or spoof-rejected scan
     produces { verified: false } and authorises nothing. */
  var walletSessionId = null; // Biom ID whose wallet is open (this session only)
  var walletPeopleCache = [];
  var walletScanCtx = null;   // { title, prompt, run } for the shared scan card
  var sendDraft = { amount: null, receiverId: null, receiverName: null };

  function loadWalletPeople() {
    return DB.all('people').then(function (people) { walletPeopleCache = people; return people; });
  }
  function walletSessionPerson() {
    return walletPeopleCache.find(function (p) { return p.id === walletSessionId; }) || null;
  }
  function fmtBDT(n) { return 'BDT ' + Number(n || 0).toLocaleString(); }
  function walletSwapCamera() {
    camFacing.walletAct = camFacing.walletAct === 'user' ? 'environment' : 'user';
    return Cam.start($('wScanVideo'), camFacing.walletAct, 'walletAct');
  }
  function authFromVerify(out, personId) {
    return (out && !out.fail && out.r && out.r.verified === true)
      ? { verified: true, personId: personId }
      : { verified: false, personId: null };
  }

  function renderWallet() {
    if (walletControl) walletControl.cancelled = true; // v43: re-rendering the wallet supersedes any scan still running for it
    return loadWalletPeople().then(function (people) {
      var me = walletSessionPerson();
      $('walletLocked').classList.toggle('hidden', !!me);
      $('walletHome').classList.toggle('hidden', !me);
      $('walletAdd').classList.add('hidden');
      $('walletSend').classList.add('hidden');
      $('walletScanCard').classList.add('hidden');
      walletScanCtx = null;
      if (me) { renderWalletHome(me); return; }
      renderWalletProfiles(people);
    });
  }
  function renderWalletProfiles(people) {
    var withPalm = people.filter(function (p) { return personHasMethod(p); });
    $('walletProfiles').innerHTML = withPalm.length
      ? withPalm.map(function (p) {
          return '<button class="profilecard" data-open-wallet="' + esc(p.id) + '"><span class="pc-name">' + esc(p.name) + '</span><span class="pc-id">' + esc(p.id) + '</span><span class="pc-sub">Tap, then scan this person\'s palm — the wallet opens only for their own palm</span></button>';
        }).join('')
      : '<p class="sub" style="margin:0">No palm is registered on this device yet. Register a palm first — registration issues the Biom ID and creates the wallet automatically.</p>';
    document.querySelectorAll('[data-open-wallet]').forEach(function (b) {
      b.addEventListener('click', function () { openWalletForPerson(b.dataset.openWallet); });
    });
  }
  function renderWalletHome(me) {
    var w = B.walletEnsurePerson(me).wallet;
    $('wHomeName').textContent = me.name;
    $('wHomeId').textContent = me.id;
    $('wHomeBalance').textContent = fmtBDT(w.balance);
    $('wHomeAccounts').innerHTML = w.linkedAccounts.length
      ? w.linkedAccounts.map(function (a) { return '<div><b>' + esc(a.type) + '</b> — ' + esc(a.label) + '</div>'; }).join('')
      : '<span style="color:var(--muted)">No funding account linked yet — Add Money will ask you to link one.</span>';
    var rows = w.statement.slice().reverse().map(function (e) {
      var when = '<div class="smeta">' + esc(fmtTime(e.ts)) + ' · Ref ' + esc(e.ref) + ' · Balance after: ' + fmtBDT(e.balanceAfter) + '</div>';
      if (e.kind === 'add') {
        return '<div class="stmtrow"><div><b>Money added (demo)</b><div class="smeta">From ' + esc(e.accountType) + ' — ' + esc(e.accountLabel) + '</div>' + when + '</div><div class="amt in">+ ' + fmtBDT(e.amount) + '</div></div>';
      }
      if (e.kind === 'send') {
        return '<div class="stmtrow"><div><b>Sent (demo)</b><div class="smeta">To ' + esc(e.counterpartyName) + ' (' + esc(e.counterpartyId) + ')</div>' + when + '</div><div class="amt out">− ' + fmtBDT(e.amount) + '</div></div>';
      }
      return '<div class="stmtrow"><div><b>Received (demo)</b><div class="smeta">From ' + esc(e.counterpartyName) + ' (' + esc(e.counterpartyId) + ')</div>' + when + '</div><div class="amt in">+ ' + fmtBDT(e.amount) + '</div></div>';
    }).join('');
    $('wHomeStatement').innerHTML = rows || '<p class="sub" style="margin:0">No demo transactions yet.</p>';
  }

  /* Shared wallet scan card: one camera surface, the caller's run()
     performs the scan and its outcome handling.
     v43 hands-free: showing the card starts the camera AND the
     scan by itself — Start Camera and Scan remain as fallback /
     re-trigger only. A scan session tracks stability and the
     post-verdict cooldown; closing the card cancels the running
     scan silently. */
  var walletSession = B.createScanSession();
  var walletControl = null;
  function showWalletScan(ctx) {
    walletScanCtx = ctx;
    walletSession.enter();
    $('walletScanCard').classList.remove('hidden');
    $('wScanTitle').textContent = ctx.title;
    $('wScanPrompt').textContent = ctx.prompt;
    $('wScanMsg').innerHTML = '';
    $('wScanStatus').textContent = 'Starting the camera...';
    $('wScanRun').disabled = true;
    $('walletScanCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    syncCamToggle('walletAct');
    syncFlashToggle('walletAct');
    startWalletCamera();
  }
  function startWalletCamera() {
    return Cam.start($('wScanVideo'), camFacing.walletAct, 'walletAct').then(function () {
      Pipeline.enterScanView();
      $('wScanRun').disabled = false;
      $('wScanStatus').textContent = 'Camera on — scanning. Show the open palm to the camera, anywhere in the frame.';
      runWalletScan();
    }).catch(function (e) { $('wScanMsg').innerHTML = cameraErrorHTML(e); $('wScanStatus').textContent = 'Camera blocked.'; });
  }
  function runWalletScan() {
    if (!walletScanCtx || palmScanBusy) return;
    palmScanBusy = true;
    $('wScanRun').disabled = true;
    var ctx = walletScanCtx;
    walletControl = { cancelled: false, onFrame: function (info) { walletSession.frame({ hasHand: info.hasHand, pose: info.pose }); } };
    Promise.resolve()
      .then(function () { return ctx.run(); })
      .catch(function (e) { walletScanFailed({ fail: 'Scan failed: ' + (e && e.message ? e.message : e) }); })
      .then(function () { palmScanBusy = false; walletSession.verdict(); });
  }
  function hideWalletScan() {
    if (walletControl) walletControl.cancelled = true;
    walletSession.leave();
    $('walletScanCard').classList.add('hidden');
    walletScanCtx = null;
    Cam.stop();
  }
  function walletScanFailed(out) {
    // v43: a scan cancelled by navigation/close ends silently —
    // the card closes instead of showing a failure for a scan
    // nobody is looking at any more.
    if (out && out.stopped) { hideWalletScan(); renderWallet(); return; }
    $('wScanMsg').innerHTML = '<div class="error">' + esc(out && out.fail ? out.fail : 'The scan did not verify. Nothing was authorised.') + '</div>';
    $('wScanRun').disabled = false;
    Snd.buzz();
  }
  $('wScanStart').addEventListener('click', startWalletCamera);
  camRestarters.walletAct = function () {
    Cam.start($('wScanVideo'), camFacing.walletAct, 'walletAct').then(function () { runWalletScan(); });
  };
  $('wScanRun').addEventListener('click', runWalletScan);
  $('wScanCancel').addEventListener('click', function () {
    if (palmScanBusy) { if (walletControl) walletControl.cancelled = true; return; }
    hideWalletScan();
    renderWallet();
  });

  /* Open a wallet: the scan is the key, always. The generic route
     identifies the palm (1:N); a profile card names the person and
     the scan must verify as THAT person (1:1). */
  $('walletOpenScan').addEventListener('click', function () {
    showWalletScan({
      title: 'Open your wallet — palm scan',
      prompt: 'Show your open palm to the camera. If it matches a registered palm, that person\'s wallet opens. A palm that is not registered opens nothing.',
      run: function () {
        return DB.all('people').then(function (people) {
          return streamIdentifyPalm($('wScanVideo'), $('wScanStatus'), people, walletSwapCamera, walletControl).then(function (out) {
            if (!out || out.fail || !out.person) { walletScanFailed(out); return; }
            walletSessionId = out.person.id;
            hideWalletScan();
            return renderWallet().then(function () {
              $('wHomeMsg').innerHTML = '<div class="success">Wallet opened for ' + esc(out.person.name) + ' (' + esc(out.person.id) + ').<br><span style="color:var(--muted)">' + esc(out.measured) + '</span></div>';
              toast('Wallet opened: ' + out.person.id);
              Snd.chime();
              Snd.speak('Wallet open');
            });
          });
        });
      }
    });
  });
  function openWalletForPerson(personId) {
    var person = walletPeopleCache.find(function (p) { return p.id === personId; });
    if (!person) return;
    showWalletScan({
      title: 'Open ' + person.name + '\'s wallet',
      prompt: 'Scan ' + person.name + '\'s palm. The wallet opens only if the palm verifies as ' + person.name + ' (' + person.id + ') — nobody else\'s palm can open it.',
      run: function () {
        return DB.all('people').then(function (people) {
          var fresh = people.find(function (p) { return p.id === personId; }) || person;
          return streamVerifyPalm($('wScanVideo'), $('wScanStatus'), fresh, people, walletSwapCamera, function () {}, walletControl).then(function (out) {
            var auth = authFromVerify(out, personId);
            if (!auth.verified) { walletScanFailed(out); return; }
            walletSessionId = personId;
            hideWalletScan();
            return renderWallet().then(function () {
              $('wHomeMsg').innerHTML = '<div class="success">Wallet opened for ' + esc(fresh.name) + ' (' + esc(fresh.id) + ').<br><span style="color:var(--muted)">' + esc(out.measured) + '</span></div>';
              toast('Wallet opened: ' + fresh.id);
              Snd.chime();
              Snd.speak('Wallet open');
            });
          });
        });
      }
    });
  }
  $('wCloseWallet').addEventListener('click', function () {
    walletSessionId = null;
    Cam.stop();
    renderWallet();
    toast('Wallet closed.');
  });

  /* Add Money: amount -> funding account -> OWN palm authorises. */
  function renderAddAccounts(me, selectedId) {
    var w = B.walletEnsurePerson(me).wallet;
    $('wAddAccountSelect').innerHTML = w.linkedAccounts.length
      ? w.linkedAccounts.map(function (a) { return '<option value="' + esc(a.id) + '"' + (a.id === selectedId ? ' selected' : '') + '>' + esc(a.type) + ' — ' + esc(a.label) + '</option>'; }).join('')
      : '<option value="">No funding account linked yet — add one below</option>';
  }
  $('wAddOpen').addEventListener('click', function () {
    var me = walletSessionPerson();
    if (!me) return;
    $('walletHome').classList.add('hidden');
    $('walletAdd').classList.remove('hidden');
    $('wAddMsg').innerHTML = '';
    renderAddAccounts(me, null);
  });
  $('wAddBack').addEventListener('click', function () { renderWallet(); });
  $('wLinkAccount').addEventListener('click', function () {
    var me = walletSessionPerson();
    if (!me) return;
    var res = B.walletAddLinkedAccount(me, $('wAddType').value, $('wAddLabel').value, Date.now());
    if (!res.ok) { $('wAddMsg').innerHTML = '<div class="error">' + esc(res.error) + '</div>'; return; }
    DB.put('people', res.person).then(function () { return loadWalletPeople(); }).then(function () {
      renderAddAccounts(walletSessionPerson(), res.account.id);
      $('wAddLabel').value = '';
      $('wAddMsg').innerHTML = '<div class="success">Funding account linked: ' + esc(res.account.type) + ' — ' + esc(res.account.label) + ' (demo link — no real account was contacted).</div>';
    }).catch(function (e) { $('wAddMsg').innerHTML = '<div class="error">Could not save the account on this device: ' + esc(e.message || e) + '</div>'; });
  });
  $('wAddScan').addEventListener('click', function () {
    var me = walletSessionPerson();
    if (!me) return;
    var amt = B.walletValidateAmount($('wAddAmount').value);
    if (!amt.ok) { $('wAddMsg').innerHTML = '<div class="error">' + esc(amt.error) + '</div>'; return; }
    var accountId = $('wAddAccountSelect').value;
    if (!accountId) { $('wAddMsg').innerHTML = '<div class="error">Link a funding account first — Add Money needs an account to add from.</div>'; return; }
    showWalletScan({
      title: 'Add money — confirm with your own palm',
      prompt: 'Scan YOUR OWN palm to add ' + fmtBDT(amt.amount) + ' of demo money to your wallet. Another person\'s palm, or no match, adds nothing.',
      run: function () {
        return DB.all('people').then(function (people) {
          var fresh = people.find(function (p) { return p.id === me.id; }) || me;
          return streamVerifyPalm($('wScanVideo'), $('wScanStatus'), fresh, people, walletSwapCamera, function () {}, walletControl).then(function (out) {
            var auth = authFromVerify(out, fresh.id);
            if (!auth.verified) { walletScanFailed(out); return; }
            return DB.nextSeq('demoSeq', 1).then(function (seq) {
              var res = B.walletApplyAddMoney(fresh, amt.amount, accountId, auth, Date.now(), B.walletDemoRef(seq));
              if (!res.ok) { $('wScanMsg').innerHTML = '<div class="error">' + esc(res.error) + '</div>'; $('wScanRun').disabled = false; return; }
              return DB.put('people', res.person).then(function () {
                hideWalletScan();
                return renderWallet();
              }).then(function () {
                $('wHomeMsg').innerHTML = '<div class="success">' + fmtBDT(res.entry.amount) + ' of demo money added from ' + esc(res.entry.accountType) + ' — ' + esc(res.entry.accountLabel) + '. New demo balance: ' + fmtBDT(res.entry.balanceAfter) + '.<br>Reference: ' + esc(res.entry.ref) + ' (demo reference — not a ' + esc(res.entry.accountType) + ' transaction ID).</div>';
                toast('Demo money added');
                Snd.chime();
              });
            });
          });
        });
      }
    });
  });

  /* Send Money: amount -> RECEIVER's palm identifies them -> the
     sender's OWN palm authorises. The store layer re-checks every
     rule at apply time (receiver registered, not self, amount
     within balance, authorisation is the sender). */
  $('wSendOpen').addEventListener('click', function () {
    var me = walletSessionPerson();
    if (!me) return;
    sendDraft = { amount: null, receiverId: null, receiverName: null };
    $('walletHome').classList.add('hidden');
    $('walletSend').classList.remove('hidden');
    $('wSendMsg').innerHTML = '';
    $('wSendConfirm').classList.add('hidden');
    $('wSendConfirm').innerHTML = '';
  });
  $('wSendBack').addEventListener('click', function () { renderWallet(); });
  $('wSendScanReceiver').addEventListener('click', function () {
    var me = walletSessionPerson();
    if (!me) return;
    var amt = B.walletValidateAmount($('wSendAmount').value);
    if (!amt.ok) { $('wSendMsg').innerHTML = '<div class="error">' + esc(amt.error) + '</div>'; return; }
    sendDraft.amount = amt.amount;
    showWalletScan({
      title: 'Send money — scan the receiver\'s palm',
      prompt: 'The RECEIVER shows their open palm. The scan finds their Biom ID — if the palm matches no registered palm, no money can be sent.',
      run: function () {
        return DB.all('people').then(function (people) {
          return streamIdentifyPalm($('wScanVideo'), $('wScanStatus'), people, walletSwapCamera, walletControl).then(function (out) {
            if (!out || out.fail || !out.person) { walletScanFailed(out); return; }
            if (out.person.id === me.id) {
              $('wScanMsg').innerHTML = '<div class="error">That is your own palm — you cannot send money to yourself. Scan the receiver\'s palm.</div>';
              $('wScanRun').disabled = false;
              Snd.buzz();
              return;
            }
            sendDraft.receiverId = out.person.id;
            sendDraft.receiverName = out.person.name;
            hideWalletScan();
            $('walletSend').classList.remove('hidden');
            renderSendConfirm();
          });
        });
      }
    });
  });
  function renderSendConfirm() {
    var me = walletSessionPerson();
    if (!me || !sendDraft.receiverId) return;
    var w = B.walletEnsurePerson(me).wallet;
    $('wSendConfirm').classList.remove('hidden');
    $('wSendConfirm').innerHTML =
      '<div class="notice"><b>Receiver found:</b> ' + esc(sendDraft.receiverName) + ' (' + esc(sendDraft.receiverId) + ')<br>' +
      '<b>Amount:</b> ' + fmtBDT(sendDraft.amount) + ' (demo money)<br>' +
      '<b>Your demo balance:</b> ' + fmtBDT(w.balance) + (sendDraft.amount > w.balance ? '<br><b>That is more than your balance — the send will be blocked.</b>' : '') + '</div>' +
      '<button class="btn primary big" id="wSendAuthorise" style="margin-top:12px">Scan My Palm to Send</button>';
    $('wSendAuthorise').addEventListener('click', authoriseSend);
  }
  function authoriseSend() {
    var me = walletSessionPerson();
    if (!me || !sendDraft.receiverId) return;
    showWalletScan({
      title: 'Send money — authorise with your own palm',
      prompt: 'Scan YOUR OWN palm to send ' + fmtBDT(sendDraft.amount) + ' of demo money to ' + sendDraft.receiverName + ' (' + sendDraft.receiverId + '). Only your palm can authorise a send from your wallet.',
      run: function () {
        return DB.all('people').then(function (people) {
          var freshSender = people.find(function (p) { return p.id === me.id; }) || me;
          return streamVerifyPalm($('wScanVideo'), $('wScanStatus'), freshSender, people, walletSwapCamera, function () {}, walletControl).then(function (out) {
            var auth = authFromVerify(out, freshSender.id);
            if (!auth.verified) { walletScanFailed(out); return; }
            return DB.nextSeq('demoSeq', 1).then(function (seq) {
              var res = B.walletApplySend(people, freshSender.id, sendDraft.receiverId, sendDraft.amount, auth, Date.now(), B.walletDemoRef(seq));
              if (!res.ok) { $('wScanMsg').innerHTML = '<div class="error">' + esc(res.error) + '</div>'; $('wScanRun').disabled = false; return; }
              // The transfer was computed atomically from the one
              // snapshot above; persist both updated records.
              return DB.put('people', res.sender).then(function () { return DB.put('people', res.receiver); }).then(function () {
                var sentAmount = sendDraft.amount, sentTo = sendDraft.receiverName, sentToId = sendDraft.receiverId, sentRef = res.senderEntry.ref, newBal = res.senderEntry.balanceAfter;
                sendDraft = { amount: null, receiverId: null, receiverName: null };
                hideWalletScan();
                return renderWallet().then(function () {
                  $('wHomeMsg').innerHTML = '<div class="success">Sent ' + fmtBDT(sentAmount) + ' of demo money to ' + esc(sentTo) + ' (' + esc(sentToId) + '). New demo balance: ' + fmtBDT(newBal) + '.<br>Reference: ' + esc(sentRef) + ' (demo reference — not a real payment).</div>';
                  toast('Demo money sent');
                  Snd.chime();
                });
              });
            });
          });
        });
      }
    });
  }

  /* ---------------- Registry & logs -------------------------------------- */
  function renderRegistry() {
    var q = ($('registrySearch').value || '').toLowerCase();
    return DB.all('people').then(function (people) {
      var rows = people.filter(function (p) {
        return !q || p.name.toLowerCase().indexOf(q) >= 0 || p.id.toLowerCase().indexOf(q) >= 0 || (p.phone || '').indexOf(q) >= 0;
      }).map(function (p) {
        return '<tr><td><b>' + esc(p.name) + '</b><br><span style="color:var(--muted)">' + esc(p.phone || '') + '</span>' + (p.loyaltyPoints ? '<br><span style="color:var(--muted)">Loyalty: ' + p.loyaltyPoints + ' pts</span>' : '') + '</td>' +
          '<td>' + esc(p.id) + '</td><td>' + esc(p.type) + '<br><span style="color:var(--muted)">' + esc(p.store) + '</span></td>' +
          '<td>' + (personHasMethod(p) ? '<span class="badge ok">Enrolled</span>' : '<span class="badge bad">Not enrolled</span>') + '</td>' +
          '<td>' + (p.walletProvider ? esc(p.walletProvider) + '<br>' + esc(B.maskWalletNumber(p.walletNumber)) : '—') + '</td>' +
          '<td><button class="btn small" data-verify="' + esc(p.id) + '">Verify</button>' + (personHasMethod(p) ? ' <button class="btn small" data-topup="' + esc(p.id) + '">Add Angles</button>' : '') + '</td></tr>';
      }).join('');
      $('registryBody').innerHTML = rows || '<tr><td colspan="6" style="color:var(--muted)">No enrollments on this device yet.</td></tr>';
      document.querySelectorAll('[data-verify]').forEach(function (b) {
        b.addEventListener('click', function () {
          go('terminal');
          $('termSearch').value = '';
          renderTermPeople();
          $('termPerson').value = b.dataset.verify;
          fillTermMethodNote();
        });
      });
      document.querySelectorAll('[data-topup]').forEach(function (b) {
        b.addEventListener('click', function () { openTopup(b.dataset.topup); });
      });
    });
  }
  $('registrySearch').addEventListener('input', renderRegistry);

  /* ---------------- Add-angles top-up (v43) ---------------------------
     An existing profile gains the multi-angle range WITHOUT
     re-registering: the same guided flow runs, and its per-pose
     codes MERGE into the stored profile (B.mergePalmprintProfileCodes)
     — stored codes carried verbatim, the cap respected, and at the
     cap only a redundant code is replaced. Identity, Biom ID,
     wallet (balance, statement, linked accounts) and points are
     never touched: the save writes back the same person record
     with only the palm profile's codes/poses changed. */
  var topupControl = null;
  var topupPersonId = null;
  var topupBusy = false;
  function openTopup(personId) {
    DB.all('people').then(function (people) {
      var person = people.find(function (p) { return p.id === personId; }) || null;
      if (!person || !personHasMethod(person)) return;
      topupPersonId = personId;
      go('topup');
      $('topWho').innerHTML = '<b>' + esc(person.name) + '</b> — ' + esc(person.id) + '<br><span style="color:var(--muted)">Currently banked: ' + person.palmProfile.codes.length + ' palmprint codes' + (Array.isArray(person.palmProfile.poses) ? ' with pose data.' : ' from a single-posture enrolment — no pose data yet.') + ' The guided flow adds the missing angles; nothing else about this person changes.</span>';
      $('topMsg').innerHTML = '';
      $('topStatus').textContent = 'Starting the camera...';
      startTopupCamera();
    });
  }
  function startTopupCamera() {
    return Cam.start($('topVideo'), camFacing.topup, 'topup').then(function () {
      Pipeline.enterScanView();
      syncCamToggle('topup');
      syncFlashToggle('topup');
      $('topCapture').disabled = false;
      runTopupCapture();
    }).catch(function (e) { $('topMsg').innerHTML = cameraErrorHTML(e); $('topStatus').textContent = 'Camera blocked.'; });
  }
  function runTopupCapture() {
    if (topupBusy || palmScanBusy || !topupPersonId) return;
    topupBusy = true; palmScanBusy = true;
    $('topCapture').disabled = true;
    $('topMsg').innerHTML = '';
    var sequence = B.PALM_SEQUENCES[Math.floor(Math.random() * B.PALM_SEQUENCES.length)];
    var control = { cancelled: false };
    topupControl = control;
    streamEnrolPalm($('topVideo'), $('topStatus'), sequence, function () {
      camFacing.topup = camFacing.topup === 'user' ? 'environment' : 'user';
      syncCamToggle('topup');
      return Cam.start($('topVideo'), camFacing.topup, 'topup');
    }, control).then(function (res) {
      topupBusy = false; palmScanBusy = false;
      $('topCapture').disabled = false;
      if (res.stopped) { $('topStatus').textContent = 'Capture stopped.'; return; }
      if (res.spoof && res.spoof.spoof) {
        DB.put('logs', { ts: Date.now(), personId: '', personName: '(add-angles attempt)', store: '', method: 'palm', measured: 'Spoof score ' + res.spoof.score.toFixed(2) + ' - ' + res.spoof.reasons.join('; '), result: 'Spoof / Screen Replay Detected' });
        $('topMsg').innerHTML = '<div class="error">Spoof / Screen Replay Detected — the scan showed a screen or a recording, not a live hand (' + esc(res.spoof.reasons.join('; ')) + '). Nothing was changed.</div>';
        Snd.buzz();
        return;
      }
      if (!res.movement.pass) {
        $('topMsg').innerHTML = '<div class="error">Movement check failed: ' + esc(res.movement.reason) + ' Nothing was changed. Run it again and complete the movement sequence shown in the prompts, in order.</div>';
        Snd.buzz();
        return;
      }
      return DB.all('people').then(function (people) {
        var person = people.find(function (p) { return p.id === topupPersonId; }) || null;
        if (!person) { $('topMsg').innerHTML = '<div class="error">That person is no longer in the registry — nothing was changed.</div>'; return; }
        var merged = B.mergePalmprintProfileCodes(person.palmProfile, res.results);
        if (!merged || !merged.poseSet) {
          $('topMsg').innerHTML = '<div class="error">The guided session did not bank a pose set — the flat pose plus at least two more measured poses are needed. Nothing was changed. Run it again and follow the angle prompts through to the end.</div>';
          return;
        }
        if (!merged.changed) {
          $('topMsg').innerHTML = '<div class="notice">No new angles were added: ' + merged.skipped + ' candidate code(s) were skipped as duplicates or poses already covered, and no banked code was redundant enough to replace. The stored profile is unchanged.</div>';
          return;
        }
        var profile = { v: 3, codes: merged.codes };
        if (merged.poses.some(function (d) { return !!d; })) profile.poses = merged.poses;
        var updated = Object.assign({}, person, { palmProfile: profile });
        return DB.put('people', updated).then(function () {
          $('topMsg').innerHTML = '<div class="success">Angles added for ' + esc(person.name) + ': ' + merged.added + ' new code(s) appended' + (merged.replaced ? ', ' + merged.replaced + ' redundant code(s) replaced at the cap' : '') + (merged.skipped ? ', ' + merged.skipped + ' skipped (duplicate or already covered)' : '') + '. The profile now holds ' + merged.codes.length + ' codes. Biom ID, wallet, balance, statement, linked accounts and points are untouched.</div>';
          Snd.chime();
          Snd.speak('Angles added');
        });
      });
    }).catch(function (e) {
      topupBusy = false; palmScanBusy = false;
      $('topCapture').disabled = false;
      $('topMsg').innerHTML = '<div class="error">Add-angles capture failed: ' + esc(e && e.message ? e.message : e) + ' Nothing was changed.</div>';
    });
  }
  $('topStart').addEventListener('click', function () { startTopupCamera(); });
  $('topCapture').addEventListener('click', runTopupCapture);
  $('topBack').addEventListener('click', function () { go('registry'); });
  camRestarters.topup = function () { startTopupCamera(); };

  function renderFieldPanel() {
    if (!$('fieldStats')) return Promise.resolve();
    return DB.all('logs').then(function (logs) {
      var recs = logs.filter(function (l) { return l.kind === 'fieldtest'; });
      var st = B.fieldTestStats(recs);
      var fmt = function (v) { return v === null ? '—' : v + '%'; };
      $('fieldStats').innerHTML = '<b>Scans recorded:</b> ' + recs.length + ' of 200<br>' +
        '<b>Genuine Accept Rate (GAR):</b> ' + fmt(st.genuine.gar) + ' — ' + st.genuine.accepted + ' of ' + st.genuine.attempts + ' real-hand attempts verified<br>' +
        '<b>False Accept Rate (FAR):</b> ' + fmt(st.impostor.far) + ' — ' + st.impostor.falseAccepts + ' of ' + st.impostor.attempts + ' genuine attempts reached the threshold against another enrolled palm<br>' +
        '<b>Spoof Rejection Rate:</b> ' + fmt(st.spoof.rejectionRate) + ' — ' + st.spoof.rejected + ' of ' + st.spoof.attempts + ' photo / video attempts rejected';
    });
  }

  function renderLogs() {
    return Promise.all([DB.all('transactions'), DB.all('logs')]).then(function (r) {
      var txs = r[0].slice().sort(function (a, b) { return b.ts - a.ts; });
      var logs = r[1].filter(function (l) { return l.kind !== 'fieldtest'; }).sort(function (a, b) { return b.ts - a.ts; });
      var dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      var todayTxs = txs.filter(function (t) { return t.ts >= dayStart.getTime(); });
      var todayTotal = todayTxs.reduce(function (s, t) { return s + Number(t.amount || 0); }, 0);
      $('dailySheet').innerHTML = '<b>Biom Pay transactions today:</b> ' + todayTxs.length + '<br><b>Total authorised today:</b> BDT ' + todayTotal.toLocaleString() + '<br><b>Status of all:</b> ' + esc(PAY_STATUS);
      $('txBody').innerHTML = txs.map(function (t) {
        return '<tr><td>' + esc(t.id) + '</td><td>' + esc(fmtTime(t.ts)) + '</td><td>' + esc(t.personName) + '</td><td>' + esc(t.provider) + '</td><td>' + esc(t.walletMasked) + '</td><td>' + esc(t.store) + '</td><td>BDT ' + Number(t.amount).toLocaleString() + '</td><td>' + esc(t.status) + '</td></tr>';
      }).join('') || '<tr><td colspan="8" style="color:var(--muted)">No Biom Pay transactions yet.</td></tr>';
      $('logBody').innerHTML = logs.map(function (l) {
        return '<tr><td>' + esc(fmtTime(l.ts)) + '</td><td>' + esc(l.personName) + '</td><td>' + esc(l.store) + '</td><td>' + esc(l.method) + '</td><td>' + esc(l.measured) + '</td><td><span class="badge ' + (l.result === 'Verified' ? 'ok' : 'bad') + '">' + esc(l.result) + '</span></td></tr>';
      }).join('') || '<tr><td colspan="6" style="color:var(--muted)">No verifications yet.</td></tr>';
      return renderFieldPanel();
    });
  }

  $('fieldExportBtn').addEventListener('click', function () {
    DB.all('logs').then(function (logs) {
      var recs = logs.filter(function (l) { return l.kind === 'fieldtest'; }).sort(function (a, b) { return a.ts - b.ts; });
      var blob = new Blob([B.fieldTestCsv(recs)], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'tsg-biom-field-test.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      toast(recs.length ? 'Field test CSV exported — ' + recs.length + ' scans.' : 'No field-test scans recorded yet; the CSV holds only its header.');
    });
  });
  $('fieldModeToggle').addEventListener('change', function () { setFieldMode(this.checked); toast(this.checked ? 'Field Test Mode ON — terminal palm scans are being recorded for the gate.' : 'Field Test Mode OFF.'); });
  $('fieldModeToggle2').addEventListener('change', function () { setFieldMode(this.checked); toast(this.checked ? 'Field Test Mode ON — terminal palm scans are being recorded for the gate.' : 'Field Test Mode OFF.'); });

  /* ---------------- Install (PWA) ---------------------------------------- */
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; });
  function install() {
    if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then(function () { deferredPrompt = null; }); return; }
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    toast(isIOS ? 'To install: tap Share, then "Add to Home Screen".' : 'To install: open the Chrome menu and choose "Install app" / "Add to Home screen". If it does not appear, this page may already be installed or opened in an in-app browser - open it in Chrome.');
  }
  $('installBtn').addEventListener('click', install);
  $('installBtn2').addEventListener('click', install);

  /* ---------------- Boot --------------------------------------------------- */
  window.TSGApp = { go: go };
  wireCamToggles();
  wireFlashToggles();
  Pipeline.start(); // v43: warm the singleton pipeline from the first moment — MediaPipe Hands + the match worker load once, here, and stay warm across every view
  setFieldMode(fieldModeOn());
  syncCamToggle('terminal');
  ['enrollPalm', 'terminal'].forEach(function (g) { syncFlashToggle(g); });
  fillStoreSelects();
  DB.open().then(function () { return migrateDbStores(); }).then(function () { renderDashboard(); fillTerminalPeople(); renderWallet(); });
})();
