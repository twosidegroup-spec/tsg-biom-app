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

     The single exception, and it is not a build behaviour: the
     device owner's own Delete All Data action (More page, v46,
     the Chairman's order 2026-11-23 21:40), behind a type-to-
     confirm flow — see wireWipeData below and B.wipeBiomData.
     Nothing automatic ever calls it.

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
  var APP_DATA_VERSION = 'v53';
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
  var DB_OP_TIMEOUT_MS = 8000; // v49: bound on every IndexedDB request (see DB.put)
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
    /* v49 freeze-proofing: an IndexedDB request whose transaction
       wedges (a blocked versionchange in another tab, a storage
       fault) fires NEITHER onsuccess nor onerror — the promise
       below would never settle, and every flow waiting on it
       (boot's migration + first render, a wallet credit, the
       terminal verdict card) froze with it: the Chairman's
       2026-11-24 report, "the site stuck then nothing works".
       Every IDB request now runs under B.withTimeout: after
       DB_OP_TIMEOUT_MS the caller sees a rejection it already
       knows how to surface, instead of silence forever. The
       request itself is not cancelled — a late write of the same
       value may still land, which is harmless for these stores. */
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
      return B.withTimeout(new Promise(function (resolve, reject) {
        var tx = self.db.transaction(store, 'readwrite');
        var req = tx.objectStore(store).put(value);
        req.onsuccess = function () { resolve(value); };
        req.onerror = function () { reject(req.error); };
      }), DB_OP_TIMEOUT_MS);
    },
    all: function (store) {
      var self = this;
      if (this.useLS || !this.db) return Promise.resolve(this.lsGet(store));
      return B.withTimeout(new Promise(function (resolve, reject) {
        var req = self.db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      }), DB_OP_TIMEOUT_MS);
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
    },
    /* Delete All Data (v46): clear EVERY data store in BOTH
       backends — the localStorage snapshot keys are set to empty
       arrays (a valid empty store, never removed keys) and the
       IndexedDB object stores are cleared — so no copy of the
       registry survives in the inactive backend either. Used ONLY
       by the owner's confirmed Delete All Data action
       (wireWipeData); nothing in boot or migration calls this.
       If this session fell back to localStorage while an IndexedDB
       database still exists from an earlier session, a fresh
       connection is opened just to clear it, so a later healthy
       launch cannot resurrect the wiped registry. */
    clearAll: function () {
      var self = this;
      B.BIOM_DATA_STORES.forEach(function (s) { self.lsSet(s, []); });
      var clearIn = function (db, closeAfter) {
        return new Promise(function (resolve) {
          try {
            var tx = db.transaction(B.BIOM_DATA_STORES, 'readwrite');
            B.BIOM_DATA_STORES.forEach(function (s) { tx.objectStore(s).clear(); });
            var done = function () { if (closeAfter) { try { db.close(); } catch (e) {} } resolve(); };
            tx.oncomplete = done;
            tx.onerror = done;
            tx.onabort = done;
          } catch (e) { if (closeAfter) { try { db.close(); } catch (e2) {} } resolve(); }
        });
      };
      if (this.db) return clearIn(this.db, false);
      if (!('indexedDB' in window)) return Promise.resolve();
      return new Promise(function (resolve) {
        var settled = false;
        var finish = function () { if (!settled) { settled = true; resolve(); } };
        var req;
        try { req = indexedDB.open('tsg-biom', 1); } catch (e) { finish(); return; }
        req.onsuccess = function () { clearIn(req.result, true).then(finish); };
        req.onerror = finish;
        req.onblocked = finish;
        setTimeout(finish, 2500);
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
  var CAM_START_TIMEOUT_MS = 12000; // v49: bound on a whole camera start (see Cam.start)
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
          // Capture tuning FIRST (v48): it issues its own
          // applyConstraints call, and a later call that does not
          // mention torch can drop an already-lit torch back off —
          // so the flash application below runs LAST, on the final
          // track state.
          return applyCaptureTuning(stream);
        }).then(function () {
          // Flash is MANUAL only - it is never turned on automatically.
          // The one exception to "only from the toggle": if the user had
          // already chosen Flash On for this view before the camera
          // started, honour that explicit choice now (via the same
          // apply helper the toggle uses) — this is also what
          // re-applies the choice to every re-acquired track (stream
          // restart, Front <-> Back switch). The toggle's honest
          // state (capability disabling + note) is then refreshed
          // for the view either way.
          if (viewKey && typeof flashState !== 'undefined' && typeof refreshFlashUi === 'function') {
            return applyFlashForKey(viewKey).then(function () {
              refreshFlashUi(flashGroupKey(viewKey));
              return stream;
            });
          }
          return stream;
        });
      });
      /* v49 freeze-proofing: the whole start chain — getUserMedia,
         play(), capture tuning, flash application — previously
         had NO overall bound. A getUserMedia promise that never
         settles (wedged driver, abandoned permission surface)
         left every caller waiting forever: camera-start handlers
         stuck on "Starting the camera...", and, worse, a scan
         loop's mid-scan camera swap never returned, so the scan
         blew past its own deadline without ever re-checking it
         and palmScanBusy stayed latched — every later scan on
         every view was blocked ("the site stuck then nothing
         works", 2026-11-24). The start now runs under
         B.withTimeout: on timeout the start is superseded (the
         token bump makes the chain's own guard stop any late
         stream) and any tracks it did attach are released, then
         the rejection reaches the caller's existing camera-error
         surface. 12 s is generous — a healthy start, including
         the NotReadableError retry ladder, lands in ~2 s. */
      var bounded = B.withTimeout(p, CAM_START_TIMEOUT_MS).catch(function (e) {
        if (e && e.code === 'ETIMEOUT' && Cam._starting === bounded) {
          Cam._token++;
          Cam.stop();
          throw new Error('The camera did not start within ' + Math.round(CAM_START_TIMEOUT_MS / 1000) + ' seconds. Close any other app using the camera, check the camera permission for this site, and try again.');
        }
        throw e;
      });
      this._starting = bounded;
      this._startVideo = video;
      this._startKey = viewKey || null;
      var clear = function () { if (Cam._starting === bounded) { Cam._starting = null; Cam._startVideo = null; Cam._startKey = null; } };
      bounded.then(clear, clear);
      return bounded;
    },
    stop: function () {
      if (this.stream) {
        this.stream.getTracks().forEach(function (t) { t.stop(); });
        this.stream = null;
        // v48: stopping the stream does NOT clear the view's flash
        // choice. The choice is a preference (see the flash section
        // below): it survives restarts and camera switches, and
        // Cam.start re-applies it to the next track this view
        // acquires. (Before v48 this reset the choice to Off, so
        // the app's own machinery silently destroyed it.)
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
          // v48: with no live restart, the flash toggle's note for
          // the new facing is refreshed here; with a restart,
          // Cam.start refreshes it when the new track lands. Either
          // way the stored flash choice itself is untouched — the
          // torch simply cannot light on the front camera and is
          // re-applied when the back camera returns.
          else refreshFlashUi(groupKey);
        });
      });
    });
  }

  /* ---------------- Per-view flash (torch) choice (v48) ------------------
     Flash is INDEPENDENT and MANUAL - never automatic. Every camera view
     has its own Flash Off | Flash On toggle next to its Front | Back
     toggle, default OFF, remembered per view in this state object -
     keyed exactly like camFacing. The Chairman's order (2026-11-24):
     whenever the BACK camera is open, the flash control must work —
     functionally and smoothly. The RULES live in biometrics.js
     (B.flashUiState / B.applyTorchToTrack) so the suites pin them;
     this section only wires them to the DOM and the live track:
       - The stored choice is a PREFERENCE. It is never reset by the
         app's own machinery: stream restarts, Front <-> Back
         switches and view navigation all keep it, and Cam.start
         re-applies it to every new track (after capture tuning, so
         nothing overwrites it).
       - The torch lights only while the BACK camera is chosen. On
         the front camera the choice stays set — the note says it
         will light on the back camera — and switching back
         restores it.
       - Capability honesty: when the live back camera reports no
         torch (most laptop webcams), refreshFlashUi disables the
         toggle with the note 'Flash not available on this camera'
         instead of leaving a live-looking button that does
         nothing. Flash never throws and never blocks a scan.
       - Toggling applies the constraint to the live track
         directly — the camera and the scan session are NEVER
         restarted by a flash tap, so an in-progress scan or
         enrolment burst continues untouched. */
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
  /* The live track serving a view's video element, or null when
     that view's camera is not the live one. */
  function flashLiveTrack(groupKey) {
    if (!Cam.stream || Cam.video !== $(flashVideoId(groupKey))) return null;
    return Cam.stream.getVideoTracks ? (Cam.stream.getVideoTracks()[0] || null) : null;
  }
  function trackTorchSupported(track) {
    if (!track) return false;
    try { var caps = track.getCapabilities ? track.getCapabilities() : {}; return !!caps.torch; } catch (e) { return false; }
  }
  /* Recompute a view's flash toggle from the pure rules: the
     highlighted choice, the disabled state and the note. Called
     after every camera start, camera switch and flash tap, so the
     toggle always tells the truth about the live track. */
  function refreshFlashUi(groupKey) {
    var key = flashKeyForGroup(groupKey);
    var track = flashLiveTrack(groupKey);
    var ui = B.flashUiState({
      prefOn: !!flashState[key],
      live: !!track,
      backChosen: camFacing[key] === 'environment',
      torchSupported: trackTorchSupported(track)
    });
    syncFlashToggle(groupKey);
    document.querySelectorAll('[data-flash-toggle="' + groupKey + '"] button').forEach(function (b) {
      b.disabled = !!ui.disabled;
    });
    setFlashNote(groupKey, ui.note);
    return ui;
  }
  /* The single place in the app that applies the torch constraint
     (the capability gate itself lives in B.applyTorchToTrack).
     Resolves true only when the live track actually accepted it. */
  function applyTorchToCurrentTrack(on) {
    var track = Cam.stream && Cam.stream.getVideoTracks ? Cam.stream.getVideoTracks()[0] : null;
    return B.applyTorchToTrack(track, on);
  }
  /* Honour a view key's stored Flash On against the live track.
     The pure rules decide whether the torch may light at all (this
     view's camera live, back camera chosen, torch supported); a
     view whose video is not the live one is left alone. The
     preference itself is NEVER changed here: a camera that cannot
     light the torch today does not erase the user's choice. */
  function applyFlashForKey(key) {
    var groupKey = flashGroupKey(key);
    if (!flashState[key]) return Promise.resolve(false);
    var track = flashLiveTrack(groupKey);
    if (!track) return Promise.resolve(false);
    var ui = B.flashUiState({
      prefOn: true, live: true,
      backChosen: camFacing[key] === 'environment',
      torchSupported: trackTorchSupported(track)
    });
    if (!ui.applyTorch) return Promise.resolve(false);
    return applyTorchToCurrentTrack(true);
  }
  function wireFlashToggles() {
    document.querySelectorAll('[data-flash-toggle]').forEach(function (group) {
      var groupKey = group.dataset.flashToggle;
      group.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          var key = flashKeyForGroup(groupKey);
          var wantOn = b.dataset.flash === 'on';
          if (!!flashState[key] === wantOn) { refreshFlashUi(groupKey); return; }
          flashState[key] = wantOn;
          if (!wantOn) {
            // Torch off on the live track when this view owns it —
            // applied in place; no camera or scan restart.
            if (flashLiveTrack(groupKey)) applyTorchToCurrentTrack(false);
            refreshFlashUi(groupKey);
            return;
          }
          // Torch on: applied to the live track immediately when
          // this view's back camera is live; on the front camera or
          // with no camera yet, the choice is remembered and
          // Cam.start applies it when a back camera starts.
          // refreshFlashUi sets the honest note either way.
          applyFlashForKey(key).then(function () { refreshFlashUi(groupKey); });
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
     and every pipeline awaits a call's results before the next.
     v44: the cap drops 480 -> 320 on a fixture measurement, not a
     guess (2026-11-23): landmarks quantised to the analysis grid
     (the rig-visible part of reading them from the smaller copy),
     warped from the full frame and scored under the full rule —
     genuine flat 0.499-0.511 at 320 vs 0.504-0.518 at 480, the
     tilt band (av 0.85) 0.518-0.522 vs 0.500-0.504, tilt av 0.90
     0.345-0.351 vs 0.338-0.341, impostor max 0.146 vs 0.142. The
     genuine band holds with the same margin; the saving is the
     smaller graph input handed over on every analysed frame. */
  var ANALYSIS_MAX = 320;
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
    hands: null, pending: null, _mpLabel: null,
    /* v51: MediaPipe's own handedness label from the most recent
       results event, exposed for the cross-check in
       analysePalmFrame (B.palmMpHandedness). Diagnostic only —
       the anatomical hand that gates is the geometric reading
       (B.palmAnatomicalHand); this label never decides anything. */
    lastHandedness: function () { return this._mpLabel || null; },
    init: function () {
      if (this.hands) return;
      var self = this;
      this.hands = new Hands({ locateFile: function (f) { return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/' + f; } });
      // v25 A/B: lite landmark model (complexity 0) - the full model
      // is the per-frame bottleneck on a budget phone CPU.
      this.hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      this.hands.onResults(function (res) {
        var p = self.pending; self.pending = null;
        self._mpLabel = (res.multiHandedness && res.multiHandedness[0] && res.multiHandedness[0].label) || null;
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
  var measuresScratch = null;
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
      // v50: reuse one scratch canvas (the discipline roiScratch
      // and spoofScratch already follow) instead of allocating a
      // fresh canvas on every analysed frame. The draw and the
      // pixel read below are identical and complete synchronously
      // before any other frame is measured, so the numbers a
      // frame produces are unchanged.
      if (!measuresScratch) measuresScratch = document.createElement('canvas');
      measuresScratch.width = size; measuresScratch.height = size;
      var canvas = measuresScratch;
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
  /* ================= scan streams =================
     Registration (v45) is a live watch stream: the moment a sharp
     open palm passes the quality gate, a single 900 ms burst runs
     and banks 3 packed templates; passive liveness is read across
     the burst. Checkout is Show & Pay: the customer holds an open
     palm like tapping a card; frames stream continuously, the
     v19 screen-lattice coherence gate samples them, passive
     liveness reads the natural micro-shift across the streamed
     poses, and matching runs per frame (in a Web Worker) with the
     spec's 1-snap packed match. */

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
    /* Verify from live ROIs. v45: the worker encodes each ROI's
       96x96 patch once (plus its mirror twin), packs it, and the
       5-shift popcount matcher judges it against the enrolled
       packed templates. The watchdog is longer than the code
       path's. Any failure falls back to the identical main-thread
       function.
       opts.fast routes to verifyPalmprintRoisFast — the same pairs,
       produced in priority order with the shift-level early exit;
       on a pass the reported score is the deciding pair's true
       score rather than the full max. The per-frame streaming call
       uses it; finalOut keeps the exact path.
       opts.exhaustive (Field Test Mode) disables the early exit in
       both paths and carries the per-shift log back on the result. */
    verifyRois: function (profile, liveRois, opts) {
      this.init();
      var fast = !!(opts && opts.fast);
      var exhaustive = !!(opts && opts.exhaustive);
      // v51: the probe's hand rides the call so the hand gate
      // (B.verifyPackedProbes) judges candidacy identically on
      // the worker and on the main-thread fallback.
      var probeHand = (opts && (opts.probeHand === 'left' || opts.probeHand === 'right')) ? opts.probeHand : null;
      var mainThread = function () {
        if (!fast) return B.verifyPalmprintRois(profile, liveRois, { exhaustive: exhaustive, probeHand: probeHand });
        var sink = {};
        var r = B.verifyPalmprintRoisFast(profile, liveRois, { exhaustive: exhaustive, timing: sink, probeHand: probeHand });
        if (r) r.timing = sink;
        return r;
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
        self.pending[id] = function (msg) {
          clearTimeout(to);
          var r = msg && msg.result;
          if (r && msg.timing) r.timing = msg.timing;
          finishWith(r);
        };
        try { self.w.postMessage({ id: id, profile: profile, liveRois: liveRois, fast: fast, exhaustive: exhaustive, probeHand: probeHand }); }
        catch (e) { clearTimeout(to); delete self.pending[id]; finishWith(null); }
      });
    },
    /* Verify the same live ROIs against several profiles in one
       worker call — the probe is encoded once inside the worker
       and scored against each profile, instead of one full
       re-encode per profile. Each result is the exact
       verifyPalmprintProfile result for that profile. Used by the
       impostor-max diagnostic and the identification stream. */
    verifyRoisMulti: function (profiles, liveRois, opts) {
      this.init();
      // One shared composition (B.verifyPalmprintProfilesRois) on
      // both sides of the worker boundary. opts.exhaustive disables
      // the shift early exit and carries per-shift logs back. The
      // stage-timing sink rides back as results.timing.
      // v51: opts.probeHand rides along — the gate is per-profile
      // inside the composition (each profile's own recorded hand
      // is judged against the one probe hand).
      var exhaustive = !!(opts && opts.exhaustive);
      var probeHand = (opts && (opts.probeHand === 'left' || opts.probeHand === 'right')) ? opts.probeHand : null;
      var mainThread = function () {
        var sink = {};
        var rs = B.verifyPalmprintProfilesRois(profiles, liveRois, { exhaustive: exhaustive, timing: sink, probeHand: probeHand });
        rs.timing = sink;
        return rs;
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
        self.pending[id] = function (msg) {
          clearTimeout(to);
          var rs = msg && msg.results;
          if (rs && msg.timing) rs.timing = msg.timing;
          finishWith(rs);
        };
        try { self.w.postMessage({ id: id, profiles: profiles, liveRois: liveRois, exhaustive: exhaustive, probeHand: probeHand }); }
        catch (e) { clearTimeout(to); delete self.pending[id]; finishWith(null); }
      });
    }
  };

  /* PalmNet neural runtime (v47): ONNX Runtime Web running the
     PalmNet model (see the PalmNet section in biometrics.js for
     what the model is and where its threshold came from). The
     runtime loads the way this app loads every third-party
     runtime — a pinned jsDelivr CDN build, the pattern MediaPipe
     Hands already uses — and the model itself lives IN THIS REPO
     under models/palmnet/ (base64 text parts + a manifest with
     the byte count and SHA-256; the snapshot-push channel that
     ships this app carries UTF-8 text only, so the binary model
     travels as text and is reassembled and verified in memory).

     Inference runs in a dedicated worker so it can never block
     the scan loop; the worker's preprocessing is assembled from
     B.palmnetPreprocessSource() — the very functions the parity
     suite proves against the Python training pipeline. If the
     worker cannot be built or dies, the same runtime is loaded
     on the main thread as a fallback (a batch-1 inference is a
     few milliseconds; it is a fallback, not the plan).

     FAIL-SOFT BY CONSTRUCTION: every failure — no Worker, no
     WASM, CDN unreachable, model fetch/size/hash failure, session
     error, a hung call — resolves to "no neural evidence" and
     flips state to 'failed' with a plain reason. The scan paths
     treat that exactly like a profile with no neural bank: the
     app behaves as v46, EDCC only, and diagnostics carry the
     honest status note (PalmNet.statusNote). Nothing here ever
     throws into a scan, an enrolment or a wallet flow. */
  function palmnetWorkerMain() {
    // Runs INSIDE the PalmNet worker. In scope there: ort (via
    // importScripts) and palmnetPreprocessRoi / PALMNET_INPUT_SIZE
    // (via B.palmnetPreprocessSource) — nothing from app.js.
    var session = null;
    function b64ToBytes(b64) {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    function loadModel(manifestUrl) {
      return fetch(manifestUrl).then(function (r) {
        if (!r.ok) throw new Error('model manifest HTTP ' + r.status);
        return r.json();
      }).then(function (man) {
        var base = manifestUrl.replace(/[^/]*$/, '');
        return Promise.all(man.parts.map(function (p) {
          return fetch(base + p).then(function (r) {
            if (!r.ok) throw new Error('model part HTTP ' + r.status);
            return r.text();
          });
        })).then(function (texts) {
          var bytes = b64ToBytes(texts.join(''));
          if (bytes.length !== man.bytes) throw new Error('model size mismatch (' + bytes.length + ' != ' + man.bytes + ')');
          var hashP = Promise.resolve();
          if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
            hashP = crypto.subtle.digest('SHA-256', bytes).then(function (h) {
              var hex = '';
              var hv = new Uint8Array(h);
              for (var i = 0; i < hv.length; i++) hex += ('0' + hv[i].toString(16)).slice(-2);
              if (hex !== man.sha256) throw new Error('model hash mismatch');
            });
          }
          return hashP.then(function () { return ort.InferenceSession.create(bytes); });
        });
      });
    }
    function runOne(roi, size) {
      var input = palmnetPreprocessRoi(roi, size);
      if (!input) return Promise.resolve(null);
      var tensor = new ort.Tensor('float32', input, [1, 3, PALMNET_INPUT_SIZE, PALMNET_INPUT_SIZE]);
      return session.run({ image: tensor }).then(function (out) {
        return Array.prototype.slice.call(out.embedding.data);
      }, function () { return null; });
    }
    onmessage = function (e) {
      var d = e.data || {};
      if (d.type === 'init') {
        loadModel(d.manifestUrl).then(function (s) {
          session = s;
          postMessage({ type: 'ready' });
        }, function (err) {
          postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
        });
      } else if (d.type === 'embed') {
        if (!session) { postMessage({ type: 'emb', id: d.id, emb: null, embM: null }); return; }
        runOne(d.roi, d.size).then(function (emb) {
          if (d.roiM) {
            return runOne(d.roiM, d.size).then(function (embM) {
              postMessage({ type: 'emb', id: d.id, emb: emb, embM: embM });
            });
          }
          postMessage({ type: 'emb', id: d.id, emb: emb, embM: null });
        }).catch(function () { postMessage({ type: 'emb', id: d.id, emb: null, embM: null }); });
      }
    };
  }
  var PalmNet = {
    state: 'idle', // idle | loading | ready | failed
    failReason: '',
    ortUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.wasm.min.js',
    wasmPath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/',
    modelManifest: 'models/palmnet/manifest.json',
    w: null, seq: 0, pending: {},
    session: null, // main-thread fallback session (window.ort)
    readyPromise: null,
    cache: (typeof WeakMap !== 'undefined') ? new WeakMap() : null, // roi array -> Promise<pair|null>
    init: function () {
      if (this.readyPromise) return this.readyPromise;
      this.state = 'loading';
      var self = this;
      this.readyPromise = this.initWorker()
        .catch(function () { return self.initMainThread(); })
        .then(function () { self.state = 'ready'; return true; })
        .catch(function (e) {
          self.state = 'failed';
          self.failReason = e && e.message ? e.message : String(e);
          return false;
        });
      return this.readyPromise;
    },
    initWorker: function () {
      var self = this;
      return new Promise(function (resolve, reject) {
        if (typeof Worker === 'undefined') { reject(new Error('Web Workers unavailable')); return; }
        var settled = false;
        var to = setTimeout(function () {
          if (settled) return;
          settled = true;
          try { if (self.w) self.w.terminate(); } catch (e) {}
          self.w = null;
          reject(new Error('neural worker start timed out'));
        }, 45000);
        try {
          var src = 'importScripts(' + JSON.stringify(self.ortUrl) + ');\n' +
            'ort.env.wasm.wasmPaths = ' + JSON.stringify(self.wasmPath) + ';\n' +
            'ort.env.wasm.numThreads = 1;\n' +
            B.palmnetPreprocessSource() +
            'var palmnetWorkerMain = ' + palmnetWorkerMain.toString() + ';\npalmnetWorkerMain();\n';
          var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
          self.w = new Worker(url);
          self.w.onmessage = function (e) {
            var d = e.data || {};
            if (d.type === 'ready') {
              if (settled) return;
              settled = true;
              clearTimeout(to);
              resolve();
            } else if (d.type === 'error') {
              if (settled) return;
              settled = true;
              clearTimeout(to);
              try { self.w.terminate(); } catch (err) {}
              self.w = null;
              reject(new Error(d.message || 'neural worker failed to load the model'));
            } else if (d.type === 'emb') {
              var p = self.pending[d.id];
              if (p) { delete self.pending[d.id]; p(d); }
            }
          };
          self.w.onerror = function () {
            if (!settled) {
              settled = true;
              clearTimeout(to);
              self.w = null;
              reject(new Error('neural worker error'));
            } else {
              // A live worker died mid-flight: pending embeds
              // resolve null through their own timeouts; future
              // embeds fail soft.
              self.w = null;
              if (self.state === 'ready') { self.state = 'failed'; self.failReason = 'neural worker error'; }
            }
          };
          self.w.postMessage({ type: 'init', manifestUrl: new URL(self.modelManifest, window.location.href).href });
        } catch (e) {
          if (!settled) { settled = true; clearTimeout(to); reject(e); }
        }
      });
    },
    loadOrtScript: function () {
      // v49 freeze-proofing: a stalled CDN connection can leave a
      // script element neither loaded nor errored — the promise
      // never settles. Bounded like every other wait in v49; the
      // rejection lands in init()'s fail-soft catch.
      return B.withTimeout(new Promise(function (resolve, reject) {
        if (typeof window !== 'undefined' && window.ort) { resolve(); return; }
        var s = document.createElement('script');
        s.src = PalmNet.ortUrl;
        s.onload = function () { resolve(); };
        s.onerror = function () { reject(new Error('ONNX Runtime Web failed to load from the CDN')); };
        document.head.appendChild(s);
      }), 20000);
    },
    fetchModelBytes: function () {
      var self = this;
      return fetch(self.modelManifest).then(function (r) {
        if (!r.ok) throw new Error('model manifest HTTP ' + r.status);
        return r.json();
      }).then(function (man) {
        var base = self.modelManifest.replace(/[^/]*$/, '');
        return Promise.all(man.parts.map(function (p) {
          return fetch(base + p).then(function (r) {
            if (!r.ok) throw new Error('model part HTTP ' + r.status);
            return r.text();
          });
        })).then(function (texts) {
          var bin = atob(texts.join(''));
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          if (bytes.length !== man.bytes) throw new Error('model size mismatch (' + bytes.length + ' != ' + man.bytes + ')');
          return bytes;
        });
      });
    },
    initMainThread: function () {
      var self = this;
      // v49 freeze-proofing: the worker path is bounded (45 s in
      // initWorker) and per-call embeds are bounded (4 s worker /
      // 6 s race in embedPair), but this main-thread fallback was
      // not: fetchModelBytes uses plain fetch (no timeout) and
      // InferenceSession.create can stall, so PalmNet.init()
      // could sit in 'loading' forever and the diagnostics note
      // lied about it. The whole chain now runs under a 60 s
      // bound; a timeout rejects into init()'s catch, the state
      // flips to 'failed' with the reason, and the app runs
      // EDCC-only — the designed fail-soft.
      return B.withTimeout(this.loadOrtScript().then(function () {
        window.ort.env.wasm.numThreads = 1;
        return self.fetchModelBytes();
      }).then(function (bytes) {
        return window.ort.InferenceSession.create(bytes);
      }).then(function (session) {
        self.session = session;
      }), 60000);
    },
    embedViaWorker: function (roi, roiM) {
      var self = this;
      var id = ++this.seq;
      return new Promise(function (resolve) {
        var done = false;
        var finishWith = function (pair) { if (!done) { done = true; resolve(pair); } };
        var to = setTimeout(function () { delete self.pending[id]; finishWith(null); }, 4000);
        self.pending[id] = function (msg) {
          clearTimeout(to);
          finishWith(self.pairFromRaw(msg && msg.emb, msg && msg.embM));
        };
        try {
          self.w.postMessage({ id: id, type: 'embed', roi: Array.prototype.slice.call(roi), roiM: roiM ? Array.prototype.slice.call(roiM) : null, size: B.PALMPRINT_ROI_SIZE });
        } catch (e) { clearTimeout(to); delete self.pending[id]; finishWith(null); }
      });
    },
    pairFromRaw: function (rawA, rawB) {
      var a = rawA ? B.palmnetNormaliseEmbedding(rawA) : null;
      var b = rawB ? B.palmnetNormaliseEmbedding(rawB) : null;
      if (!a && !b) return null;
      return [a, b];
    },
    embedOnMain: function (roi, roiM) {
      var self = this;
      function runOne(r) {
        var input = B.palmnetPreprocessRoi(r, B.PALMPRINT_ROI_SIZE);
        if (!input || !self.session) return Promise.resolve(null);
        var tensor = new window.ort.Tensor('float32', input, [1, 3, B.PALMNET_INPUT_SIZE, B.PALMNET_INPUT_SIZE]);
        return self.session.run({ image: tensor }).then(function (out) {
          return B.palmnetNormaliseEmbedding(Array.prototype.slice.call(out.embedding.data));
        }, function () { return null; });
      }
      return runOne(roi).then(function (a) {
        if (!roiM) return self.pairFromRaw(a, null);
        return runOne(roiM).then(function (b) { return self.pairFromRaw(a, b); });
      }).catch(function () { return null; });
    },
    /* Embed one ROI and its mirror twin (the probe pair). Resolves
       [embedding, mirrorEmbedding] (either may be null) or null
       when the neural path produced nothing. NEVER rejects, and
       the wait is bounded — a hung runtime cannot stall a scan. */
    embedPair: function (roi) {
      if (!roi || typeof roi.length !== 'number' || roi.length !== B.PALMPRINT_ROI_SIZE * B.PALMPRINT_ROI_SIZE) return Promise.resolve(null);
      if (this.cache) {
        var hit = this.cache.get(roi);
        if (hit) return hit;
      }
      var self = this;
      var p = this.init().then(function (ok) {
        if (!ok) return null;
        var flipped = B.flipGrayHorizontal(roi, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE);
        if (self.w) return self.embedViaWorker(roi, flipped);
        if (self.session) return self.embedOnMain(roi, flipped);
        return null;
      }).catch(function () { return null; });
      var bounded = Promise.race([p, waitMs(6000).then(function () { return null; })]);
      if (this.cache) this.cache.set(roi, bounded);
      return bounded;
    },
    /* Embed a list of ROIs (enrolment / top-up banking): resolves
       an aligned array of embeddings-or-null. Never rejects. */
    embedRois: function (rois) {
      var self = this;
      return Promise.all((rois || []).map(function (roi) {
        return self.embedPair(roi).then(function (pair) { return pair ? pair[0] : null; });
      })).catch(function () { return (rois || []).map(function () { return null; }); });
    },
    /* The honest one-liner diagnostics carry when the neural path
       is not producing scores. Empty when PalmNet is live. */
    statusNote: function () {
      if (this.state === 'ready') return '';
      if (this.state === 'failed') return 'PalmNet neural matcher unavailable (' + (this.failReason || 'failed to load') + ') — EDCC only.';
      return 'PalmNet neural matcher still loading — EDCC only for now.';
    }
  };
  /* The sharpest usable fully-open frames' ROIs of a capture —
     the neural banking candidates for Add Angles / Neural scan
     (the same usability gate the EDCC live selection uses). */
  function neuralCandidateRois(frames) {
    var usable = B.palmprintUsableOpenFrames(frames, B.PALM_LIVE_OPEN_MIN).filter(function (u) { return !!u.roi; });
    usable.sort(function (a, b) { return b.sharpness - a.sharpness; });
    return usable.slice(0, 6).map(function (u) { return u.roi; });
  }

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
    // v47: the PalmNet runtime + model load in the background too,
    // so the first neural score is not paying the download. Fully
    // fire-and-forget — a failure is recorded on PalmNet.state and
    // surfaces only as the diagnostics status note.
    try { PalmNet.init(); } catch (e) {}
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

  /* The facing of the camera ACTUALLY delivering frames right
     now, read from the live track (v51): the hand computation
     needs the true facing, and Cam.start's constraint ladder can
     land on a fallback camera, so the requested facing in
     camFacing[] is not evidence — the track's own settings are.
     Returns 'user' | 'environment' | null (unreported: the hand
     then reads null and the scan behaves exactly as v50). */
  function liveFacingMode() {
    try {
      var track = Cam.stream && Cam.stream.getVideoTracks()[0];
      var f = track && track.getSettings && track.getSettings().facingMode;
      if (f === 'user' || f === 'environment') return f;
    } catch (e) {}
    return null;
  }

  /* One streamed frame, analysed: landmarks, openness, EDCC codes
     (aligned + mirror), texture/sharpness, and the palm pose used by
     passive liveness. Same frame-result shape the clip pipeline used.
     v51: the frame also carries its hand evidence — hand, the
     ANATOMICAL hand from the landmark chirality corrected by the
     live camera's facing (B.palmAnatomicalHand; null when the
     frame cannot support a reading), and mpHand, MediaPipe's own
     label converted the same way (B.palmMpHandedness) as a
     cross-check that never gates anything. Enrolment, top-up and
     every scan path read the hand from HERE, so the convention
     is computed one way everywhere. */
  function analysePalmFrame(frame) {
    // v44: per-stage timing rides the frame result (lmMs = landmark
    // inference, encMs = ROI warp + base EDCC encodes) so the scan
    // diagnostics can report the phone's own per-frame stage costs
    // instead of one opaque total.
    var tLm = performance.now();
    return PalmProc.landmarks(frame).then(function (lm) {
      var lmMs = performance.now() - tLm;
      if (!lm) return { openness: null, descriptor: null, code: null, codeM: null, roi: null, sharpness: 0, texture: null, spread: null, tilt: null, pose: null, framing: null, lm: null, hand: null, mpHand: null, frameComplete: false, frameIssue: null, lmMs: lmMs, encMs: 0 };
      var facing = liveFacingMode();
      var hand = B.palmAnatomicalHand(lm, facing);
      // v53: the full-hand completeness judgement for this frame
      // (B.palmFrameCompleteness — fingertips in frame, knuckle
      // span under the too-close ceiling). The scan streams let
      // only complete frames count toward matching; the guidance
      // and the v52 indicators read the same judgement, so the
      // three can never disagree about a cropped hand.
      var comp = B.palmFrameCompleteness(lm);
      var mpHand = B.palmMpHandedness(PalmProc.lastHandedness(), facing);
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
      var tEnc = performance.now();
      var codes = (typeof openness === 'number' && openness >= B.PALM_LIVE_OPEN_MIN) ? palmCodesFromFrame(frame, lm) : null;
      var encMs = performance.now() - tEnc;
      return { openness: openness, descriptor: descriptor, code: codes ? codes.code : null, codeM: codes ? codes.codeM : null, roi: codes ? codes.roi : null, sharpness: meas.sharpness, texture: meas.texture, spread: B.palmSpread(lm), tilt: B.palmTilt(lm), pose: B.palmFramePose(lm), framing: B.palmFramingHint(lm), lm: lm, hand: hand, mpHand: mpHand, frameComplete: comp ? comp.complete : false, frameIssue: comp ? comp.issue : null, lmMs: lmMs, encMs: encMs };
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

  /* Registration (v45 — the Palm-X spec section 4, adopted by the
     Chairman's override 2026-11-23): a single automatic burst. The
     stream watches for a sharp, open palm whose warped 96x96 patch
     passes the per-frame quality gate on 2 consecutive analysed
     frames; the moment one is present it records a 900 ms burst
     (grabs at ~55 ms — 12-18 frames — with the circular progress
     indicator running), analyses the burst, judges passive
     liveness across it (Z-depth variance across the palm anchors
     plus >= 1.2% natural scale/angle micro-shift, via
     B.palmprintBurstLiveness, with the screen-spoof tracker
     sampled over the same frames), and the caller banks the 3
     sharpest time-spaced templates in the packed format
     (B.selectPalmprintBurstCodes). No movement sequence, no pose
     prompts, no button presses. The `sequence` parameter is kept
     for caller compatibility and is no longer used. Free-form, as
     since v34: no guide overlay, the landmark ROI follows the
     hand anywhere in the frame. Returns { results, burst:
     { frames, liveness } | null, spoof, lightTag, elapsedMs,
     stopped?, timedOut?, hint? }.
     v50: the watch loop is paced to the camera clock and yields
     to the UI every analysed frame, and burst analysis yields
     for a paint between frames — performance only; every gate,
     threshold and selection rule above is unchanged (the full
     measurement story is at the pacing note inside the stream). */
  function streamEnrolPalm(video, statusEl, sequence, swapCamera, control) {
    var t0 = Date.now();
    var tracker = makeSpoofTracker();
    var deadline = t0 + 180000;
    var swapped = false;
    var seenHand = false;
    var watchFrames = 0;
    var poseRef = null;
    var lastHint = 'Show open palm';
    var frameCanvas = null;
    /* v50 smoothness: the watch loop below is PACED and YIELDING.
       Before v50 it re-entered analysis the microtask the previous
       frame's landmarks landed — a self-chaining promise loop
       whose only await was the inference itself. Measured on the
       rig (tests/e2e/perf-enrol.js, no-hand watch): 95.4% of the
       wall clock inside landmark inference, ONE unbroken main-
       thread task of ~159 s, and requestAnimationFrame starved
       outright (zero completed 500 ms rAF buckets in 24 s) — the
       page could not paint, taps queued behind the loop, and a
       cancel could not even be observed for over 15 s. That is
       the Chairman's 2026-11-24 phone report ("registering it
       was stuck lag and got hang") in mechanism form. Two
       disciplines, both borrowed from the verify stream's v37
       pacing and hardened for a loop with no worker round-trip
       to hide behind:
       - waitFreshFrame(): grabs are paced to the camera clock
         (~100 ms of stream time between analysed frames), so no
         instant is analysed twice and a fast pipeline idles
         between frames instead of queueing stale work;
       - yieldToUi(): one real macrotask yield per analysed
         frame, so the browser gets a task boundary — and with
         it a chance to paint, composite the camera preview and
         deliver taps — even when analysis is SLOWER than the
         pace and the clock wait returns immediately.
       Neither changes what is analysed or judged: the same
       frames pass through the same analysePalmFrame, the same
       quality gate, the same 2-consecutive-qualify rule, the
       same spoof sampling; only the loop's manners change. */
    var lastGrabT = -1;
    var shownHint = null;
    function waitFreshFrame() {
      if (lastGrabT < 0) return Promise.resolve();
      var target = lastGrabT + 0.1;
      function poll() {
        if (video.currentTime >= target || Date.now() > deadline) return Promise.resolve();
        return waitMs(8).then(poll);
      }
      return poll();
    }
    function yieldToUi() { return waitMs(0); }
    function showHint() {
      if (statusEl && lastHint !== shownHint) { shownHint = lastHint; statusEl.textContent = lastHint; }
    }

    function setRing(pct) {
      var ring = $('palmBurstRing');
      if (!ring) return;
      if (pct === null || pct === undefined) { ring.classList.add('hidden'); return; }
      ring.classList.remove('hidden');
      ring.style.background = 'conic-gradient(#1B5FE0 ' + Math.round(Math.max(0, Math.min(1, pct)) * 360) + 'deg, rgba(27,95,224,0.15) 0deg)';
      var lbl = ring.querySelector('span');
      if (lbl) lbl.textContent = Math.round(Math.max(0, Math.min(1, pct)) * 100) + '%';
    }
    /* One watched frame: returns 'qualify' when the frame carries
       a sharp, fully-open palm whose warped patch passes the
       spec's quality gate, 'spoof' when the tracker has convicted
       the session, or null otherwise. The hint line is composed
       from the spec's own strings wherever the gate produced one. */
    function watchStep() {
      return waitFreshFrame().then(function () {
        if (!frameCanvas) frameCanvas = document.createElement('canvas');
        var frame = grabVideoFrameInto(video, frameCanvas);
        if (!frame) return waitMs(60).then(function () { return null; });
        lastGrabT = video.currentTime;
        return analysePalmFrame(frame).then(function (r) {
          watchFrames++;
          if (watchFrames % 2 === 1) tracker.add(frame, r.lm);
          if (tracker.state().spoof) return 'spoof';
          var hasHand = typeof r.openness === 'number';
          if (hasHand) seenHand = true;
          var gate = r.roi ? B.palmprintQualityGate(r.roi, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE, { hasHand: hasHand, bboxWidthFrac: B.palmBboxWidthFrac(r.lm) }) : null;
          if (!hasHand) lastHint = 'Show open palm';
          else if (gate && !gate.pass) lastHint = gate.hint || 'Hold steady...';
          // v53: completeness coaching, in the same words the
          // scan guidance uses — a cropped or too-close palm is
          // told to move back before the framing hint's longer
          // sentence is considered.
          else if (r.frameIssue === 'cropped' || r.frameIssue === 'tooClose') lastHint = 'Move back — fit your whole palm in the frame';
          else if (r.frameIssue === 'tooFar') lastHint = 'Move a little closer';
          else if (r.framing) lastHint = r.framing;
          else lastHint = 'Hold steady...';
          showHint();
          var qualifies = !!(r.roi && hasHand && r.openness >= B.PALM_OPEN_MIN && gate && gate.pass && r.code && B.palmprintCodeSane(r.code));
          // v50: the yield is part of the step, so EVERY analysed
          // watch frame ends at a task boundary (see the note at
          // the top of this stream) — including the qualifying
          // ones; the streak logic in watch() is untouched.
          return yieldToUi().then(function () { return qualifies ? 'qualify' : null; });
        });
      });
    }
    function watch() {
      var streak = 0;
      function step() {
        if (control && control.cancelled) return Promise.resolve('stopped');
        if (tracker.state().spoof) return Promise.resolve('spoof');
        if (Date.now() > deadline) return Promise.resolve('timeout');
        if (!swapped && swapCamera && watchFrames >= 18 && !seenHand) {
          swapped = true;
          lastGrabT = -1; // v50: the new stream's clock restarts (as in the verify stream)
          if (statusEl) statusEl.textContent = 'No hand was seen by this camera - switching to the other camera and trying once more.';
          shownHint = null; // the next analysed frame's hint replaces the swap note
          return swapCamera().then(step, step);
        }
        return watchStep().then(function (res) {
          if (res === 'spoof') return 'spoof';
          if (res === 'qualify') { streak++; if (streak >= 2) return 'burst'; }
          else streak = 0;
          return step();
        });
      }
      return step();
    }
    /* The burst itself: grabs at ~55 ms across the 900 ms window
       (12-18 frames), the circular indicator tracking elapsed
       time. Grabs use per-frame canvases — the frames are stored
       for analysis, exactly as the old burst chain required. */
    function recordBurst() {
      var frames = [];
      var started = Date.now();
      return new Promise(function (resolve) {
        var doneFlag = false;
        var finish = function () { if (doneFlag) return; doneFlag = true; clearInterval(iv); setRing(null); resolve(frames); };
        var iv = setInterval(function () {
          var f = grabVideoFrame(video);
          if (f) frames.push(f);
          setRing((Date.now() - started) / B.PALMPRINT_BURST_MS);
          if (frames.length >= B.PALMPRINT_BURST_MAX_FRAMES) finish();
        }, 55);
        setTimeout(finish, B.PALMPRINT_BURST_MS);
      });
    }
    /* v50: a paint yield for the burst analysis — wait for the
       next animation frame (raced against 60 ms so a throttled
       rAF can never stall the analysis) so the browser actually
       paints between burst frames. Before v50 the burst chain
       ran 12-18 full analyses back to back in one starved
       cascade (rig: one 12.7 s long task for 14 frames, zero
       rAF buckets) with the UI frozen on the capture message. */
    function yieldForPaint() {
      if (typeof requestAnimationFrame !== 'function') return waitMs(0);
      return Promise.race([
        new Promise(function (resolve) { requestAnimationFrame(function () { setTimeout(resolve, 0); }); }),
        waitMs(60)
      ]);
    }
    function analyseBurst(frames) {
      if (statusEl) statusEl.textContent = 'Palm captured — analysing the burst, hold on...';
      var results = [];
      var lmSets = [];
      var chain = Promise.resolve();
      frames.forEach(function (frame, i) {
        chain = chain.then(function () {
          if (control && control.cancelled) return;
          return analysePalmFrame(frame).then(function (r) {
            if (i % 2 === 0) tracker.add(frame, r.lm);
            results.push(r);
            if (r.lm) lmSets.push(r.lm);
            // Pose tags ride along for the Add Angles candidate
            // selection (diversity by measured presentation when
            // the burst produced it; time-thirds otherwise).
            var pdesc = B.palmPoseDescriptor(r.lm);
            if (pdesc) {
              if (!poseRef && typeof r.openness === 'number' && r.openness >= B.PALM_OPEN_MIN && Math.abs(pdesc.ang) < 12) {
                poseRef = { fore: pdesc.fore, span: pdesc.span };
              }
              r.poseDesc = pdesc;
              r.poseTag = B.palmPoseTag(r.lm, poseRef);
            }
          }).then(function () { return yieldForPaint(); }); // v50: paint between burst frames
        });
      });
      return chain.then(function () { return { results: results, lmSets: lmSets }; });
    }
    function out(extra) {
      var sp = tracker.state();
      var base = { results: [], burst: null, spoof: sp, lightTag: sp.lightTag, elapsedMs: Date.now() - t0 };
      if (extra) Object.keys(extra).forEach(function (k) { base[k] = extra[k]; });
      return base;
    }
    return watch().then(function (w) {
      if (w === 'stopped') { var o = out(); o.stopped = true; return o; }
      if (w === 'spoof') return out();
      if (w !== 'burst') return out({ timedOut: true, hint: lastHint });
      if (statusEl) statusEl.textContent = 'Palm found — capturing, hold steady...';
      return recordBurst().then(function (burstFrames) {
        // v50: a cancel that landed during the 900 ms burst or
        // the burst analysis ends the capture as 'stopped' here,
        // instead of banking a palm for a view nobody is on.
        if (control && control.cancelled) { var o = out(); o.stopped = true; return o; }
        return analyseBurst(burstFrames).then(function (a) {
          if (control && control.cancelled) { var o2 = out(); o2.stopped = true; return o2; }
          var lv = B.palmprintBurstLiveness(a.lmSets);
          return out({ results: a.results, burst: { frames: a.results.length, liveness: lv } });
        });
      });
    });
  }

  /* Field Test Mode's exhaustive-shift toggle (v45, spec section
     3): when ON, the matcher evaluates all five shifts for every
     pair (no early exit) and the result carries the per-shift log
     into the scan's measured text. Stored beside the field-mode
     flag; read fresh at every match call so toggling mid-session
     takes effect on the next frame. */
  function fieldExhaustiveOn() { try { return localStorage.getItem('biomFieldExhaustive') === '1'; } catch (e) { return false; } }
  function shiftLogStr(res) {
    if (!res || !Array.isArray(res.shiftLog) || !res.shiftLog.length) return '';
    return ' Exhaustive shift log: ' + res.shiftLog.map(function (e) {
      return '(' + e.dx + ',' + e.dy + ')=' + (typeof e.score === 'number' ? e.score.toFixed(3) : 'n/a');
    }).join(' ') + '.';
  }

  /* Show & Pay checkout: no movement sequence. Per-frame matching
     in the worker; passive liveness on the streamed poses; the
     coherence spoof gate sampled per frame. Fail-closed throughout.
     v34: free-form scanning - no guide overlay; the customer simply
     shows an open hand anywhere in the frame and the landmark ROI
     follows the hand.
     v37: frames stream continuously, paced only by the camera
     clock; each frame's match overlaps the next frame's analysis
     and results apply in capture order.
     v45 (the Palm-X spec section 5): the judgement is the 1-snap
     packed match — one frame whose packed probe reaches the
     threshold against the enrolled templates IS the match (the
     spec's rule replaces the v32 two-frame rolling window and the
     v39 fast win). The win is honoured once the surrounding
     evidence is complete: the spoof gate has examined at least
     three frames and passive liveness passes on the streamed
     poses (the spec's micro-parallax check). A match the liveness
     cannot confirm is denied with that reason stated — the gates
     around the match are unchanged, only the match rule itself
     follows the spec. MAXF and the wall-clock deadline bound the
     scan as before. */
  /* v49: the exact refusal every money scan ends with when the
     palm matched the PLAIN bars but the strict money rule
     (two-frame confirmation + impostor margin, see the v49
     section in biometrics.js) was not satisfied. It authorises
     nothing, and it does not claim the palm failed to match —
     it says precisely what happened. */
  var MONEY_STRICT_FAIL_MSG = 'Matched, but not clearly enough to authorise money — please scan again';

  function streamVerifyPalm(video, statusEl, person, people, swapCamera, fieldRec, control, opts) {
    var t0 = Date.now();
    var tracker = makeSpoofTracker();
    var frames = [];
    var poses = [];
    // Per-frame spoof verdicts, kept in lockstep with frames[] —
    // frameSpoof[i] is frame i's own detector verdict (true
    // flagged / false examined-clean / null never examined).
    var frameSpoof = [];
    var matchState = { streak: 0, best: null };
    var win = null;
    var analysed = 0, swapped = false, locked = false;
    var lastHint = null, coded = 0;
    // v43: the latest frame's quality signals, feeding the live
    // guidance pill (B.palmGuidance) and the caller's scan session.
    var lastOpen = null, lastSampleB = null, lastGlare = null, lastSharp = null;
    // v53: the latest frame's completeness issue, feeding the
    // guidance pill alongside the framing hint.
    var lastFrameIssue = null;
    // v44: the no-match grind is bounded by the wall clock, not
    // only by the frame count — MAXF stays as the backstop (it
    // binds first on fast devices), the budget binds first on a
    // slow phone. Basis at B.SCAN_TIME_BUDGET_MS.
    var MAXF = 24, deadline = t0 + B.SCAN_TIME_BUDGET_MS;
    // v49: money authorisations run this same stream with
    // opts.strictMoney — the PLAIN fused verdict is computed
    // exactly as before (and is what Field Test Mode records),
    // but the money verdict is issued only when the strict rule
    // also holds: the fused win on at least two distinct
    // analysed frames (moneyGate) AND the margin over every
    // other profile (checked in verifiedOut / finalOut against
    // the impostor-maxima those paths already compute).
    var strictMoney = !!(opts && opts.strictMoney);
    var moneyGate = B.createMoneyScanGate();
    // v44: per-stage timing accumulators for the result-panel
    // diagnostics — the phone's own numbers, measured on-device:
    // landmark inference + ROI/base encode from analysePalmFrame,
    // matching from the matcher's sink.
    var stLm = 0, stEnc = 0, stMatch = 0, stGeo = 0, geoFrames = 0;
    function diagStr() {
      var wall = Date.now() - t0;
      var n = Math.max(1, analysed);
      var s = 'Scan timing: ' + analysed + ' frames analysed in ' + wall + ' ms (' + (analysed / Math.max(1, wall) * 1000).toFixed(1) + ' frames/s); per frame — landmarks ' + Math.round(stLm / n) + ' ms, palm code ' + Math.round(stEnc / n) + ' ms, matching ' + Math.round(stMatch / n) + ' ms';
      if (geoFrames) s += ' (extra variant encodes ' + Math.round(stGeo) + ' ms in total, on ' + geoFrames + ' of ' + analysed + ' frames)';
      return s + '.' + neuralDiagSuffix();
    }
    // v37 continuous pipeline state: one reused capture canvas (each
    // frame is fully analysed before the next grab), the video-clock
    // time of the last grab (pacing), and the previous frame's match
    // still running in the worker while the next frame is analysed.
    var frameCanvas = null;
    var lastGrabT = -1;
    var prevMatch = null;
    // v50: status text is written only when it changes — the
    // loop re-derives the same guidance line on most frames, and
    // re-assigning an identical textContent still replaces the
    // text node and invalidates layout on every frame.
    var shownStatus = null;
    function setStatus(txt) { if (statusEl && txt !== shownStatus) { shownStatus = txt; statusEl.textContent = txt; } }

    /* v47 PalmNet fusion state. The neural path runs ALONGSIDE
       the EDCC pipeline, never inside its critical path: each
       analysed frame's ROI is embedded off-thread (PalmNet) and
       the score lands in frameNeural whenever it lands; the fused
       decision (B.fusePalmVerifyResults — EDCC at its 0.32 bar OR
       PalmNet at its 0.5773 bar) is taken per frame from whichever
       evidence has arrived, in tryWin. A profile with no banked
       embeddings (neuralBanked null) or a failed neural runtime
       leaves every frame's neural slot null, and the scan is then
       exactly the v46 scan. */
    var neuralBanked = B.palmnetProfileEmbeddings(person.palmProfile);
    var frameEdcc = {};   // frameIdx -> EDCC result object (or null once applied)
    var frameNeural = {}; // frameIdx -> neural cosine | null (absent = still pending)
    var frameRoiByIdx = {}; // frameIdx -> the frame's ROI array
    var bestNeural = null;
    /* v51 HAND SEPARATION state: this profile's recorded hand
       (null for every pre-v51 profile) and the scan's probe hand
       — the consensus of the analysed frames' own readings
       (B.palmConsensusHand; null when the frames cannot agree,
       which excludes nobody). The EDCC gate itself lives inside
       B.verifyPackedProbes (the probe's hand rides each match
       call); the neural path is gated HERE by never scoring a
       gated comparison, because PalmNet scoring is app-side.
       Either side unknown => exactly the v50 scan. */
    var profileHand = B.palmProfileHand(person.palmProfile);
    // v53: the consensus reads only COMPLETE frames' hands — a
    // cropped close-up's chirality is exactly the misread the
    // frame rule keeps out of the gate. When no complete frame
    // exists, nothing was scored anyway and the consensus is
    // null, which excludes nobody (the v51 rule, unchanged).
    function scanHand() { return B.palmConsensusHand(frames.filter(function (f) { return f.frameComplete === true; }).map(function (f) { return f.hand; })); }
    function handEvidenceStr(probeHand) {
      if (probeHand && profileHand) {
        return ' Probe hand: ' + probeHand + '; profile hand: ' + profileHand + (probeHand !== profileHand ? ' — the other hand is a different identity, so this profile was excluded by the hand gate.' : '.');
      }
      if (probeHand) return ' Probe hand: ' + probeHand + '; profile hand not recorded (pre-v51 enrolment) — matched exactly as before.';
      if (profileHand) return ' Probe hand could not be determined; profile hand: ' + profileHand + ' — no hand exclusion applied.';
      return '';
    }
    function tryWin(frameIdx) {
      if (frameEdcc[frameIdx] === undefined) return;
      var ns = frameNeural[frameIdx] === undefined ? null : frameNeural[frameIdx];
      var fused = B.fusePalmVerifyResults(frameEdcc[frameIdx], ns);
      // v49: every frame whose fused decision verifies is
      // recorded for the strict money rule's two-frame
      // confirmation — including frames after the win latched
      // (they are the confirmation) and re-takes of a frame when
      // its neural score lands (the gate counts distinct frames,
      // so a re-take never double-counts).
      if (fused.verified) moneyGate.noteVerified('target', frameIdx);
      if (win) {
        // The win already stands; if it came from THIS frame
        // before the neural score landed, refresh its evidence so
        // the panels and the field record show both systems.
        if (win.frameIdx === frameIdx) win.res = fused;
        return;
      }
      if (fused.verified) {
        win = { res: fused, rois: [frameRoiByIdx[frameIdx]], fast: false, frameIdx: frameIdx, probeHand: frames[frameIdx] ? frames[frameIdx].hand : null };
      }
    }
    function neuralScoreForRois(rois) {
      if (!neuralBanked || !rois || !rois.length) return Promise.resolve(null);
      return Promise.all(rois.map(function (roi) { return PalmNet.embedPair(roi); })).then(function (pairs) {
        var probes = [];
        pairs.forEach(function (pr) { if (pr) pr.forEach(function (e) { if (e) probes.push(e); }); });
        return probes.length ? B.palmnetScoreEmbeddings(neuralBanked, probes) : null;
      }).catch(function () { return null; });
    }
    function neuralImpostorMaxFor(rois, probeHand) {
      // v51: profiles the hand gate excludes are not candidates
      // for the impostor-max either — a cross-hand profile's
      // twin-driven score must not shrink the money margin.
      var others = (people || []).filter(function (p) {
        return p.id !== person.id && B.palmnetProfileSane(p.palmProfile) && !B.handGateBlocks(probeHand, B.palmProfileHand(p.palmProfile));
      });
      if (!others.length || !rois || !rois.length) return Promise.resolve(null);
      return Promise.all(rois.map(function (roi) { return PalmNet.embedPair(roi); })).then(function (pairs) {
        var probes = [];
        pairs.forEach(function (pr) { if (pr) pr.forEach(function (e) { if (e) probes.push(e); }); });
        if (!probes.length) return null;
        var cur = null;
        others.forEach(function (p) {
          var s = B.palmnetScoreProfile(p.palmProfile, probes);
          if (s !== null && (cur === null || s > cur)) cur = s;
        });
        return cur;
      }).catch(function () { return null; });
    }
    /* The PalmNet sentence for measured/diagnostics text: both
       scores and the accepting path when a score exists, the
       honest reason when it does not. */
    function neuralMeasuredStr(res) {
      if (res && typeof res.neuralScore === 'number') {
        var by = res.acceptedBy === 'both' ? 'EDCC and PalmNet' : (res.acceptedBy === 'palmnet' ? 'PalmNet' : 'EDCC');
        return ' PalmNet cosine ' + res.neuralScore.toFixed(3) + ' (threshold ' + B.PALMNET_THRESHOLD + '); accepted by ' + by + '.';
      }
      if (!neuralBanked) return ' PalmNet: no neural embeddings banked for this palm — EDCC only' + (B.palmnetNeedsScan(person.palmProfile) ? ' (Registry → Neural Scan banks them)' : '') + '.';
      var note = PalmNet.statusNote();
      return ' PalmNet: no neural score this scan' + (note ? ' — ' + note : '') + '.';
    }
    function neuralDiagSuffix() {
      if (!neuralBanked) return '';
      if (PalmNet.state === 'ready') return ' PalmNet neural matching active (threshold ' + B.PALMNET_THRESHOLD + '); best neural cosine this scan ' + (bestNeural !== null ? bestNeural.toFixed(3) : 'n/a') + '.';
      return ' ' + PalmNet.statusNote();
    }

    function finish(out) { return out; }
    function impostorMaxFor(rois, probeHand) {
      // v35: one multi-profile call — the probe codes are encoded
      // once and scored against every other enrolled profile,
      // instead of a full 50-encode expansion per person. Each
      // per-profile result is the exact one the v34 chain computed;
      // the max taken over them is unchanged.
      // v51: the probe hand rides the call — a profile the hand
      // gate excludes returns no similarity and so contributes
      // nothing to the max (it is not an impostor candidate).
      var others = (people || []).filter(function (p) {
        return p.id !== person.id && B.palmprintProfileSane(p.palmProfile);
      });
      if (!others.length) return Promise.resolve(null);
      return Match.verifyRoisMulti(others.map(function (p) { return p.palmProfile; }), rois, { probeHand: probeHand || null }).then(function (results) {
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
      fieldRec(null, null, 'fail', 'rejected', sp.lightTag, { probeHand: scanHand(), profileHand: profileHand });
      Snd.buzz();
      return finish({ fail: 'Spoof / Screen Replay Detected — the scan showed a screen or a recording, not a live hand (' + sp.reasons.join('; ') + '). Nothing was verified. Present the real hand, live in front of the camera.' });
    }
    function livenessFailOut(lv) {
      fieldRec(null, null, 'fail', 'rejected', tracker.state().lightTag, { probeHand: scanHand(), profileHand: profileHand });
      Snd.buzz();
      return finish({ fail: lv.verdict === 'static'
        ? 'Liveness check failed: the palm did not move naturally at all — a still photo or a frozen image cannot be used. Nothing was verified. Present the real hand, held live in front of the camera.'
        : 'Liveness check failed: the view changed too abruptly for one held hand. Nothing was verified. Hold one open palm steady in front of the camera.' });
    }
    function verifiedOut() {
      // v51: the impostor-maxima are judged against the winning
      // frame's hand (the scan consensus as fallback) — profiles
      // the hand gate excludes contribute nothing to either max.
      var winHand = win.probeHand || scanHand();
      return impostorMaxFor(win.rois, winHand).then(function (impMax) {
        return neuralImpostorMaxFor(win.rois, winHand).then(function (nImpMax) {
          var extras = { neuralScore: typeof win.res.neuralScore === 'number' ? win.res.neuralScore : null, neuralImpostorMax: nImpMax, acceptedBy: win.res.acceptedBy || null, probeHand: winHand, profileHand: profileHand };
          var measured = 'Palmprint similarity ' + (typeof win.res.similarity === 'number' ? win.res.similarity.toFixed(3) : 'n/a') + ' (threshold ' + win.res.threshold + ', 1-snap packed match: the winning frame\'s bit-packed template scored by the 5-shift popcount matcher against ' + person.palmProfile.codes.length + ' enrolled packed templates), passive liveness passed (natural micro-shift across rapid frames), Show & Pay streaming scan.' + neuralMeasuredStr(win.res) + handEvidenceStr(winHand) + ' Scan latency: ' + (Date.now() - t0) + ' ms.' + shiftLogStr(win.res) + ' ' + diagStr();
          if (strictMoney) {
            // v49 margin rule, judged on the accepting system(s)
            // against the impostor-maxima computed just above for
            // this same probe. Field Test Mode still records the
            // PLAIN fused verdict ('pass' / 'verified'); the
            // strict outcome rides the record as extra fields.
            var mc = B.moneyMarginCheck(win.res, impMax, nImpMax);
            extras.strictMoney = true;
            extras.strictPass = mc.pass;
            if (!mc.pass) extras.strictBlock = 'margin';
            fieldRec(win.res.similarity, impMax, 'pass', 'verified', tracker.state().lightTag, extras);
            if (!mc.pass) {
              Snd.buzz();
              measured += ' Money authorisation rule applied: the match was confirmed on ' + moneyGate.verifiedFrames('target') + ' distinct frames but did NOT beat every other enrolled palm by the money margin (EDCC ' + B.MONEY_MARGIN_EDCC + ' / PalmNet ' + B.MONEY_MARGIN_NEURAL + '), so nothing was authorised.';
              return finish({ fail: MONEY_STRICT_FAIL_MSG, measured: measured, strictMoney: { applied: true, pass: false, block: 'margin' }, diag: { edcc: win.res.similarity, neural: typeof win.res.neuralScore === 'number' ? win.res.neuralScore : null, probeHand: winHand, profileHand: profileHand, handGate: false, strictBlock: 'margin' } });
            }
            measured += ' Money authorisation rule applied: the match was confirmed on ' + moneyGate.verifiedFrames('target') + ' distinct frames and beat every other enrolled palm by at least the money margin (EDCC ' + B.MONEY_MARGIN_EDCC + ' / PalmNet ' + B.MONEY_MARGIN_NEURAL + ') — authorised under the strict rule.';
            return finish({ r: win.res, measured: measured, latencyMs: Date.now() - t0, strictMoney: { applied: true, pass: true } });
          }
          fieldRec(win.res.similarity, impMax, 'pass', 'verified', tracker.state().lightTag, extras);
          return finish({ r: win.res, measured: measured, latencyMs: Date.now() - t0 });
        });
      });
    }
    function finalOut(timedOut) {
      var sp = tracker.state();
      if (sp.spoof) return spoofOut(sp);
      var lv = B.passiveLivenessCheck(poses);
      var liveRois = B.selectPalmprintLiveRois(frames);
      if (!liveRois) { fieldRec(null, null, lv.pass ? 'pass' : 'fail', 'rejected', sp.lightTag, { probeHand: scanHand(), profileHand: profileHand }); return finish({ fail: 'No usable open palm with readable print detail found in the scan. Nothing was verified. Show one open palm to the camera, fingers spread, in good light, and run the scan again. (' + analysed + ' frames scanned, ' + coded + ' produced a readable palm code.' + (lastHint ? ' Last guidance shown: ' + lastHint : '') + (timedOut ? ' No match was found within the ' + Math.round(B.SCAN_TIME_BUDGET_MS / 1000) + '-second scan limit.' : '') + ' ' + diagStr() + ')' }); }
      // v51: the collected-set judgement is judged under the
      // scan's consensus hand — the EDCC call carries it into the
      // gate, and a gated profile is never embedded by PalmNet
      // either (its neural score is forced to "no evidence").
      var probeHand = scanHand();
      var gated = B.handGateBlocks(probeHand, profileHand);
      return Match.verifyRois(person.palmProfile, liveRois, { exhaustive: fieldExhaustiveOn(), probeHand: probeHand }).then(function (res) {
        // v47: the exact collected-set judgement is FUSED — the
        // EDCC result at its 0.32 bar OR the PalmNet cosine over
        // the same ROIs at its threshold (null when the neural
        // path has no evidence, which leaves res untouched).
        return (gated ? Promise.resolve(null) : neuralScoreForRois(liveRois)).then(function (nScore) {
          var fused = B.fusePalmVerifyResults(res, nScore);
          return impostorMaxFor(liveRois, probeHand).then(function (impMax) {
            return neuralImpostorMaxFor(liveRois, probeHand).then(function (nImpMax) {
              if (fused.verified && lv.pass) {
                if (strictMoney) {
                  // v49: the collected-set judgement matched (the
                  // PLAIN verdict, recorded as such), but a money
                  // authorisation needs the win confirmed on two
                  // distinct STREAMED frames — a set judgement over
                  // the top-3 ROIs is not that evidence, and no
                  // streaming frame verified (win is null here).
                  // The strict rule blocks; nothing is authorised.
                  fieldRec(fused.similarity, impMax, 'pass', 'verified', sp.lightTag, { neuralScore: nScore, neuralImpostorMax: nImpMax, acceptedBy: fused.acceptedBy || null, strictMoney: true, strictPass: false, strictBlock: 'frames', probeHand: probeHand, profileHand: profileHand });
                  Snd.buzz();
                  return finish({ fail: MONEY_STRICT_FAIL_MSG, strictMoney: { applied: true, pass: false, block: 'frames' }, diag: { edcc: fused.similarity, neural: nScore, probeHand: probeHand, profileHand: profileHand, handGate: false, strictBlock: 'frames' } });
                }
                // The collected set matched and liveness passed — the
                // win the streaming rule would have honoured.
                win = { res: fused, rois: liveRois, fast: false };
                return verifiedOut();
              }
              var out = fused;
              if (fused.verified && !lv.pass) {
                // The palm matched but the micro-parallax evidence did
                // not confirm a live hand: denied, reason stated.
                out = { ok: true, verified: false, similarity: fused.similarity, threshold: fused.threshold, neuralScore: fused.neuralScore, neuralThreshold: fused.neuralThreshold, acceptedBy: null, reason: 'The palm matched, but liveness could not be confirmed — no natural micro-movement was observed. Nothing was verified. Present the real hand, held live in front of the camera.' };
                if (fused.shiftLog) out.shiftLog = fused.shiftLog;
              }
              // v51: when the hand gate blocked this profile, the
              // rejection was DECIDED by the exclusion (both
              // systems gated) — the record says so via handGate.
              var rejExtras = { neuralScore: nScore, neuralImpostorMax: nImpMax, acceptedBy: fused.acceptedBy || null, probeHand: probeHand, profileHand: profileHand };
              if (gated) rejExtras.handGate = true;
              fieldRec(fused.similarity, impMax, lv.pass ? 'pass' : 'fail', 'rejected', sp.lightTag, rejExtras);
              // v53: the failure card's diagnosis — built from
              // the very values fieldRec just recorded (the
              // fused similarity, this set's PalmNet score, the
              // same hand evidence), so card and log agree.
              var rejDiag = { edcc: fused.similarity, neural: nScore, probeHand: probeHand, profileHand: profileHand, handGate: gated === true };
              var measured = 'Palmprint similarity ' + (typeof fused.similarity === 'number' ? fused.similarity.toFixed(3) : 'n/a') + ' (threshold ' + B.PALMPRINT_THRESHOLD + ', 1-snap packed match: ' + liveRois.length + ' live frames\' bit-packed templates scored by the 5-shift popcount matcher against ' + person.palmProfile.codes.length + ' enrolled packed templates), passive liveness ' + lv.verdict + ', Show & Pay streaming scan.' + neuralMeasuredStr(fused) + handEvidenceStr(probeHand) + ' Scan latency: ' + (Date.now() - t0) + ' ms.' + shiftLogStr(fused) + ' Diagnostics: ' + analysed + ' frames scanned, ' + coded + ' with a readable code, best single-frame score ' + (matchState.best !== null ? matchState.best.toFixed(3) : 'n/a') + (bestNeural !== null ? ', best PalmNet cosine ' + bestNeural.toFixed(3) : '') + '.' + (timedOut ? ' No match was found within the ' + Math.round(B.SCAN_TIME_BUDGET_MS / 1000) + '-second scan limit.' : '') + ' ' + diagStr();
              return finish({ r: out, measured: measured, latencyMs: Date.now() - t0, diag: rejDiag });
            });
          });
        });
      });
    }
    /* Apply one frame's match result, in capture order (v37:
       extracted so the pipelined loop applies results in exactly
       the order frames were captured). A code-less or ROI-less
       frame applies a null score, as before. v45: the win is the
       spec's 1-snap rule — the first frame whose packed match
       verifies is the win; streamMatchUpdate now only tracks the
       best score for the diagnostics text. */
    function applyMatch(res, roi, frameIdx) {
      // v44: fold this frame's matcher stage costs into the scan
      // diagnostics (the sink rides on the result as r.timing).
      if (res && res.timing) {
        stMatch += (res.timing.baseMs || 0) + (res.timing.geoMs || 0) + (res.timing.matchMs || 0);
        stGeo += res.timing.geoMs || 0;
        if (res.timing.geoEncodes > 0) geoFrames++;
      }
      var score = res && typeof res.similarity === 'number' ? res.similarity : null;
      matchState = B.streamMatchUpdate(matchState, score);
      // v47: record the frame's EDCC evidence and take the FUSED
      // decision for the frame (tryWin also honours a neural score
      // that landed earlier; a neural score landing later re-enters
      // tryWin from its own continuation in step()).
      if (typeof frameIdx === 'number') {
        frameEdcc[frameIdx] = res || null;
        if (roi) frameRoiByIdx[frameIdx] = roi;
        tryWin(frameIdx);
      } else if (res && res.verified && !win) {
        win = { res: B.fusePalmVerifyResults(res, null), rois: [roi], fast: false };
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
          stLm += r.lmMs || 0; stEnc += r.encMs || 0;
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
          lastFrameIssue = r.frameIssue || null;
          // v43: publish the frame's quality signals — the scan
          // session reads stability from the pose, the guidance
          // pill from the rest. Guidance only; no gate reads these.
          lastOpen = typeof r.openness === 'number' ? r.openness : null;
          lastSharp = typeof r.sharpness === 'number' ? r.sharpness : null;
          lastSampleB = sample && typeof sample.meanBrightness === 'number' ? sample.meanBrightness : null;
          lastGlare = sample && typeof sample.glare === 'number' ? sample.glare : null;
          if (control && control.onFrame) {
            try { control.onFrame({ hasHand: typeof r.openness === 'number', pose: r.pose || null, openness: lastOpen, framing: lastHint, sharpness: lastSharp, meanLuma: lastSampleB, glareFrac: lastGlare, frameComplete: r.frameComplete === true, frameIssue: r.frameIssue || null }); } catch (e) {}
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
            // v53 FULL-HAND FRAME RULE: an incomplete frame
            // (cropped fingertips / too close) is never matched
            // or embedded — it falls into the else below and
            // applies a null score, exactly like a code-less
            // frame. It still fed the spoof tracker, the poses
            // and the guidance above: liveness and coaching read
            // every frame, matching reads only whole palms.
            if (sane && r.roi && r.frameComplete) {
              // v45: the frame's 96x96 patch is the probe — the
              // worker encodes it once (plus its mirror twin),
              // packs it, and the 5-shift popcount matcher judges
              // it against the enrolled packed templates. The call
              // overlaps the NEXT frame's analysis instead of
              // blocking this frame's step (v37 pipelining, kept).
              prevMatch = { roi: r.roi, frameIdx: myIdx, promise: Match.verifyRois(person.palmProfile, [r.roi], { fast: true, exhaustive: fieldExhaustiveOn(), probeHand: r.hand }) };
              // v47: the same patch is ALSO embedded by PalmNet,
              // off-thread and unpipelined — the score lands in
              // frameNeural whenever it lands and tryWin re-takes
              // this frame's fused decision with it. It never
              // delays the EDCC pipeline above.
              // v51: a frame whose hand is known and differs from
              // this profile's recorded hand is never embedded —
              // the frame's neural slot is settled null at once
              // (the twin-scope for PalmNet: the embedPair mirror
              // only ever scores same-hand or unknown-hand
              // comparisons).
              if (neuralBanked) {
                frameRoiByIdx[myIdx] = r.roi;
                if (B.handGateBlocks(r.hand, profileHand)) {
                  frameNeural[myIdx] = null;
                } else {
                  PalmNet.embedPair(r.roi).then(function (pair) {
                    var s = pair ? B.palmnetScoreEmbeddings(neuralBanked, pair) : null;
                    frameNeural[myIdx] = s;
                    if (s !== null && (bestNeural === null || s > bestNeural)) bestNeural = s;
                    tryWin(myIdx);
                  });
                }
              }
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
      // A match may not be honoured until the spoof gate has examined
      // at least three frames. A 1-snap match can complete inside
      // the first frames, before the tracker's aggregation rule (at
      // least two flagged frames) can ever fire - found by the E2E
      // replay leg, 2026-11-20: a screen replay of the enrolled palm
      // was VERIFIED at 0.445 while every replay frame, checked
      // directly against the detector, trips it. The detector was
      // right; the win simply outran the gate. The aggregate
      // rejection above also runs first: if the tracker has
      // convicted the scan on the frames examined so far, no win
      // is honoured.
      if (win && lv.pass && sp.framesChecked >= 3 && (!strictMoney || moneyGate.confirmed('target'))) return verifiedOut();
      if (win && lv.pass && statusEl) setStatus('Palm matched — confirming this is a live hand, not a screen…');
      // v49: in a money scan, a latched win that still lacks its
      // second confirming frame says so — the scan keeps running
      // and the palm simply stays in view a moment longer.
      if (strictMoney && win && lv.pass && sp.framesChecked >= 3 && statusEl) setStatus('Palm matched — money authorisation needs the match confirmed on a second frame. Keep the palm there…');
      // v37: the burst-era "two bursts" static guard is the same
      // evidence in continuous terms — six analysed frames.
      if (lv.verdict === 'static' && analysed >= 6) return livenessFailOut(lv);
      if (lv.verdict === 'erratic') return livenessFailOut(lv);
      if (analysed >= MAXF || Date.now() > deadline) {
        // A match from the last analysed frame may still be in the
        // worker: its score belongs to the record (the best-score
        // diagnostics, the finalOut set), so drain it before any
        // cap outcome — the burst chain applied every match before
        // loop() ever saw the caps.
        if (prevMatch) {
          var prev = prevMatch; prevMatch = null;
          return prev.promise.then(function (res) { applyMatch(res, prev.roi, prev.frameIdx); return loop(); });
        }
        if (strictMoney && win && lv.pass) {
          // v49: the palm matched and liveness passed (the PLAIN
          // verdict, recorded as such), but the win never reached
          // two distinct verified frames before the cap — a money
          // authorisation needs that confirmation. Strict block,
          // not a liveness failure: the message says which.
          fieldRec(win.res.similarity, null, 'pass', 'verified', sp.lightTag, { neuralScore: typeof win.res.neuralScore === 'number' ? win.res.neuralScore : null, neuralImpostorMax: null, acceptedBy: win.res.acceptedBy || null, strictMoney: true, strictPass: false, strictBlock: 'frames', probeHand: scanHand(), profileHand: profileHand });
          Snd.buzz();
          return finish({ fail: MONEY_STRICT_FAIL_MSG, strictMoney: { applied: true, pass: false, block: 'frames' }, diag: { edcc: win.res.similarity, neural: typeof win.res.neuralScore === 'number' ? win.res.neuralScore : null, probeHand: scanHand(), profileHand: profileHand, handGate: false, strictBlock: 'frames' } });
        }
        if (win) {
          fieldRec(win.res.similarity, null, 'fail', 'rejected', sp.lightTag, { neuralScore: typeof win.res.neuralScore === 'number' ? win.res.neuralScore : null, neuralImpostorMax: null, acceptedBy: win.res.acceptedBy || null, probeHand: scanHand(), profileHand: profileHand });
          Snd.buzz();
          return finish({ fail: 'Liveness could not be confirmed: the palm matched, but no natural micro-movement was observed. Nothing was verified. Present the real hand, held live — do not use a photo or a recording.', diag: { edcc: win.res.similarity, neural: typeof win.res.neuralScore === 'number' ? win.res.neuralScore : null, probeHand: scanHand(), profileHand: profileHand, handGate: false } });
        }
        return finalOut(Date.now() > deadline);
      }
      // v37: the burst-era fallback (six bursts without a single
      // hand reading) is eighteen analysed frames in continuous
      // terms — the same amount of evidence, the same single swap.
      if (!swapped && swapCamera && analysed >= 18 && frames.every(function (x) { return typeof x.openness !== 'number'; })) {
        swapped = true;
        lastGrabT = -1; // the new stream's clock restarts
        if (statusEl) setStatus('No hand was seen by this camera - switching to the other camera and trying once more.');
        shownStatus = null; // v50: the next guidance line always replaces the swap note
        return swapCamera().then(function () { return loop(); }, function () { return loop(); });
      }
      if (statusEl) {
        var seenHandNow = frames.some(function (x) { return typeof x.openness === 'number'; });
        // v43: the live guidance pill — one concise line mapped
        // from the quality signals this frame already produced.
        var guide = B.palmGuidance({ hasHand: seenHandNow, framing: lastHint, frameIssue: lastFrameIssue, openness: lastOpen, meanLuma: lastSampleB, glareFrac: lastGlare, sharpness: lastSharp, stable: false });
        setStatus(guide || (seenHandNow ? 'Hand detected — hold steady.' : 'Show & Pay scanning — show an open hand to the camera.'));
      }
      return step().then(loop);
    }
    return loop();
  }

  /* Wallet identification (v42; v45 match rule): WHO is this
     palm? The same streaming gates as Show & Pay — the coherence
     spoof tracker, passive liveness on the streamed poses, MAXF
     and the deadline — but each frame's probe is scored against
     EVERY enrolled profile in one multi-profile call. The match
     rule is the spec's 1-snap rule, identical to the 1:1 stream:
     the first candidate whose packed match verifies on a frame
     is the identified person (each candidate's streamMatchUpdate
     state is still kept for the best-score diagnostics). This is
     not a second, weaker scan path: the frame-level gates are
     shared evidence, the per-candidate match rule is identical,
     and a scan matching no enrolled palm identifies nobody. Used
     by the demo wallet (open wallet, find a send receiver). */
  function streamIdentifyPalm(video, statusEl, people, swapCamera, control, opts) {
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
    // v49 built this stream's opts.strictMoney for wallet open:
    // the identification must ALSO satisfy the strict rule before
    // loop() honours it — the same candidate's fused win on two
    // distinct analysed frames (moneyGate, one key per candidate)
    // and, on the confirming frame, the margin over every other
    // candidate's same-frame score (judged in tryWinIdentify,
    // where that frame's per-candidate results are in hand); a
    // margin failure is terminal for the scan (strictFail).
    // v50 (the Chairman's correction, 2026-11-24): wallet open is
    // a login, not a money movement, so NO caller passes the
    // option any more — the strict rule lives only on the three
    // money-moving verify authorisations. The machinery stays in
    // place, unused by this stream, rather than being ripped out
    // of a shipped stream; with the option absent every path
    // below is exactly the plain v48 identification.
    var strictMoney = !!(opts && opts.strictMoney);
    var moneyGate = B.createMoneyScanGate();
    var strictFail = null; // { block: 'margin' }
    var analysed = 0, swapped = false, locked = false;
    var lastHint = null, coded = 0;
    // v43: the latest frame's quality signals, feeding the live
    // guidance pill (B.palmGuidance) and the caller's scan session.
    var lastOpen = null, lastSampleB = null, lastGlare = null, lastSharp = null;
    // v53: the latest frame's completeness issue, feeding the
    // guidance pill alongside the framing hint.
    var lastFrameIssue = null;
    // v44: same wall-clock budget as the verify stream (MAXF is
    // the backstop), and the same per-stage diagnostics sinks.
    var MAXF = 24, deadline = t0 + B.SCAN_TIME_BUDGET_MS;
    var stLm = 0, stEnc = 0, stMatch = 0, stGeo = 0, geoFrames = 0;
    function diagStr() {
      var wall = Date.now() - t0;
      var n = Math.max(1, analysed);
      var s = 'Scan timing: ' + analysed + ' frames analysed in ' + wall + ' ms (' + (analysed / Math.max(1, wall) * 1000).toFixed(1) + ' frames/s); per frame — landmarks ' + Math.round(stLm / n) + ' ms, palm code ' + Math.round(stEnc / n) + ' ms, matching ' + Math.round(stMatch / n) + ' ms';
      if (geoFrames) s += ' (extra variant encodes ' + Math.round(stGeo) + ' ms in total, on ' + geoFrames + ' of ' + analysed + ' frames)';
      return s + '.' + neuralDiagSuffix();
    }
    var frameCanvas = null;
    var lastGrabT = -1;
    var prevMatch = null;
    // v50: status text is written only when it changes (same
    // discipline as the 1:1 stream — identical re-writes still
    // replace the text node and invalidate layout every frame).
    var shownStatus = null;
    function setStatus(txt) { if (statusEl && txt !== shownStatus) { shownStatus = txt; statusEl.textContent = txt; } }

    /* v47 PalmNet fusion state (same discipline as the 1:1
       stream): each frame's probe is embedded ONCE off-thread and
       scored against every candidate's banked embeddings in pure
       JS; the per-candidate decision is the fused one. Candidates
       without a bank simply have no neural evidence. */
    var banksById = {};
    var anyNeuralBank = false;
    candidates.forEach(function (p) {
      var bank = B.palmnetProfileEmbeddings(p.palmProfile);
      if (bank) { banksById[p.id] = bank; anyNeuralBank = true; }
    });
    var frameResults = {};       // frameIdx -> per-candidate EDCC results array
    var frameNeuralScores = {};  // frameIdx -> { personId: cosine|null } (absent = pending)
    function tryWinIdentify(frameIdx) {
      if (win || strictFail) return;
      var results = frameResults[frameIdx];
      if (!results) return;
      var scores = frameNeuralScores[frameIdx] || null;
      for (var i = 0; i < candidates.length; i++) {
        var p = candidates[i];
        var fused = B.fusePalmVerifyResults(results[i] || null, scores ? scores[p.id] : null);
        if (!fused.verified) continue;
        if (!strictMoney) { win = { person: p, res: fused, fast: false, frameIdx: frameIdx }; return; }
        // v49 strict: record this frame for this candidate; only
        // the SECOND distinct verified frame can confirm, and on
        // that frame the margin is judged against the other
        // candidates' scores from the SAME frame (one shared
        // probe — the exact impostor comparison the rule names).
        moneyGate.noteVerified(p.id, frameIdx);
        if (!moneyGate.confirmed(p.id)) continue;
        var edccOthers = null, neuralOthers = null;
        for (var j = 0; j < candidates.length; j++) {
          if (j === i) continue;
          var rj = results[j];
          if (rj && typeof rj.similarity === 'number' && (edccOthers === null || rj.similarity > edccOthers)) edccOthers = rj.similarity;
          var ns = scores ? scores[candidates[j].id] : null;
          if (typeof ns === 'number' && (neuralOthers === null || ns > neuralOthers)) neuralOthers = ns;
        }
        var mc = B.moneyMarginCheck(fused, edccOthers, neuralOthers);
        if (mc.pass) win = { person: p, res: fused, fast: false, strictMargin: mc, frameIdx: frameIdx };
        else strictFail = { block: 'margin' };
        return;
      }
    }
    function neuralScoresForRois(rois, probeHand) {
      if (!anyNeuralBank || !rois || !rois.length) return Promise.resolve(null);
      return Promise.all(rois.map(function (roi) { return PalmNet.embedPair(roi); })).then(function (pairs) {
        var probes = [];
        pairs.forEach(function (pr) { if (pr) pr.forEach(function (e) { if (e) probes.push(e); }); });
        if (!probes.length) return null;
        var out = {};
        candidates.forEach(function (p) {
          // v51: a candidate the hand gate excludes is not
          // scored at all — its entry stays absent, which the
          // fusion reads as "no neural evidence".
          if (banksById[p.id] && !B.handGateBlocks(probeHand, B.palmProfileHand(p.palmProfile))) out[p.id] = B.palmnetScoreEmbeddings(banksById[p.id], probes);
        });
        return out;
      }).catch(function () { return null; });
    }
    function neuralMeasuredStrId(res) {
      if (res && typeof res.neuralScore === 'number') {
        var by = res.acceptedBy === 'both' ? 'EDCC and PalmNet' : (res.acceptedBy === 'palmnet' ? 'PalmNet' : 'EDCC');
        return ' PalmNet cosine ' + res.neuralScore.toFixed(3) + ' (threshold ' + B.PALMNET_THRESHOLD + '); accepted by ' + by + '.';
      }
      if (!anyNeuralBank) return ' PalmNet: no neural embeddings banked on this device — EDCC only.';
      var note = PalmNet.statusNote();
      return ' PalmNet: no neural score this scan' + (note ? ' — ' + note : '') + '.';
    }
    function neuralDiagSuffix() {
      if (!anyNeuralBank) return '';
      if (PalmNet.state === 'ready') return ' PalmNet neural matching active (threshold ' + B.PALMNET_THRESHOLD + ').';
      return ' ' + PalmNet.statusNote();
    }

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
      // v51: the measured string states the hand evidence — the
      // winning frame's hand and the identified profile's hand.
      var winHand = (typeof win.frameIdx === 'number' && frames[win.frameIdx]) ? frames[win.frameIdx].hand : null;
      var winnerHand = B.palmProfileHand(win.person.palmProfile);
      var handStrId = '';
      if (winHand && winnerHand) handStrId = ' Probe hand: ' + winHand + '; identified profile hand: ' + winnerHand + '.';
      else if (winHand) handStrId = ' Probe hand: ' + winHand + '; identified profile hand not recorded (pre-v51 enrolment).';
      else if (winnerHand) handStrId = ' Probe hand could not be determined; identified profile hand: ' + winnerHand + ' — no hand exclusion applied.';
      var measured = 'Palmprint similarity ' + (typeof win.res.similarity === 'number' ? win.res.similarity.toFixed(3) : 'n/a') + ' (threshold ' + win.res.threshold + ', 1-snap packed match: the winning frame\'s bit-packed template scored by the 5-shift popcount matcher against ' + win.person.palmProfile.codes.length + ' enrolled packed templates), passive liveness passed (natural micro-shift across rapid frames), wallet identification scan (1:N over ' + candidates.length + ' enrolled palms).' + neuralMeasuredStrId(win.res) + handStrId + ' Scan latency: ' + (Date.now() - t0) + ' ms.' + shiftLogStr(win.res) + ' ' + diagStr();
      if (strictMoney) {
        measured += ' Money authorisation rule applied: the match was confirmed on ' + moneyGate.verifiedFrames(win.person.id) + ' distinct frames and beat every other enrolled palm by at least the money margin (EDCC ' + B.MONEY_MARGIN_EDCC + ' / PalmNet ' + B.MONEY_MARGIN_NEURAL + ') — authorised under the strict rule.';
        return { person: win.person, r: win.res, measured: measured, latencyMs: Date.now() - t0, strictMoney: { applied: true, pass: true } };
      }
      return { person: win.person, r: win.res, measured: measured, latencyMs: Date.now() - t0 };
    }
    function finalOut(timedOut) {
      var sp = tracker.state();
      if (sp.spoof) return spoofOut(sp);
      var lv = B.passiveLivenessCheck(poses);
      var liveRois = B.selectPalmprintLiveRois(frames);
      if (!liveRois) {
        return { fail: 'No usable open palm with readable print detail found in the scan. Nothing was verified. Show one open palm to the camera, fingers spread, in good light, and run the scan again. (' + analysed + ' frames scanned, ' + coded + ' produced a readable palm code.' + (lastHint ? ' Last guidance shown: ' + lastHint : '') + (timedOut ? ' No match was found within the ' + Math.round(B.SCAN_TIME_BUDGET_MS / 1000) + '-second scan limit.' : '') + ' ' + diagStr() + ')' };
      }
      // v51: the collected-set judgement runs under the scan's
      // consensus hand — the EDCC composition gates per profile,
      // and gated candidates are not PalmNet-scored either.
      // v53: the consensus reads only COMPLETE frames' hands —
      // a cropped close-up's chirality is the misread the frame
      // rule keeps out of the gate.
      var probeHand = B.palmConsensusHand(frames.filter(function (f) { return f.frameComplete === true; }).map(function (f) { return f.hand; }));
      return Match.verifyRoisMulti(candidates.map(function (p) { return p.palmProfile; }), liveRois, { exhaustive: fieldExhaustiveOn(), probeHand: probeHand }).then(function (results) {
        // v47: fuse each candidate's exact result with its PalmNet
        // cosine over the same ROIs. A candidate verified by
        // EITHER system at its own bar wins over the EDCC-best
        // also-ran; with no neural evidence the fused list is the
        // EDCC list and the choice below is the v46 choice.
        return neuralScoresForRois(liveRois, probeHand).then(function (scoresById) {
          var fusedList = (results || []).map(function (ro, i) {
            return B.fusePalmVerifyResults(ro, scoresById ? scoresById[candidates[i].id] : null);
          });
          var best = null, bestPerson = null;
          fusedList.forEach(function (ro, i) {
            if (ro && typeof ro.similarity === 'number' && (best === null || ro.similarity > best.similarity)) { best = ro; bestPerson = candidates[i]; }
          });
          var bestVerified = null, bestVerifiedPerson = null;
          fusedList.forEach(function (ro, i) {
            if (ro && ro.verified && (bestVerified === null || (typeof ro.similarity === 'number' ? ro.similarity : 0) > (typeof bestVerified.similarity === 'number' ? bestVerified.similarity : 0))) { bestVerified = ro; bestVerifiedPerson = candidates[i]; }
          });
          if (bestVerified && lv.pass) {
            if (strictMoney) {
              // v49: the collected-set judgement matched, but a
              // money authorisation needs one candidate's win
              // confirmed on two distinct STREAMED frames — the
              // set judgement is not that evidence. Strict block;
              // nothing is opened.
              Snd.buzz();
              return { fail: MONEY_STRICT_FAIL_MSG, strictMoney: { applied: true, pass: false, block: 'frames' } };
            }
            win = { person: bestVerifiedPerson, res: bestVerified, fast: false };
            return identifiedOut();
          }
          if (bestVerified && !lv.pass) {
            return { fail: 'That palm matched ' + bestVerifiedPerson.name + ', but liveness could not be confirmed — no natural micro-movement was observed. Nothing was opened. Present the real hand, held live in front of the camera.' };
          }
          // v51: when the hand gate excluded candidates, the
          // no-match copy says so briefly and factually — the
          // scanned hand is the other hand of the excluded
          // profiles, and the other hand is a different identity.
          var excludedCount = probeHand ? candidates.filter(function (p) { return B.handGateBlocks(probeHand, B.palmProfileHand(p.palmProfile)); }).length : 0;
          var handNote = excludedCount ? ' The scanned palm is the ' + probeHand + ' hand; ' + excludedCount + ' enrolled profile' + (excludedCount === 1 ? '' : 's') + ' recorded the other hand and ' + (excludedCount === 1 ? 'was' : 'were') + ' excluded.' : (probeHand ? ' Probe hand: ' + probeHand + '.' : '');
          // v53: the structured diagnosis for the failure card —
          // the same best score the sentence above reports, the
          // best PalmNet cosine across candidates, and the same
          // hand evidence, so the panel and this record agree.
          var bestNeuralAny = null;
          fusedList.forEach(function (ro) { if (ro && typeof ro.neuralScore === 'number' && (bestNeuralAny === null || ro.neuralScore > bestNeuralAny)) bestNeuralAny = ro.neuralScore; });
          return { fail: 'This palm did not match any registered palm on this device, so nothing was opened and no one was identified. (' + analysed + ' frames scanned, ' + coded + ' with a readable code, best score ' + (best && typeof best.similarity === 'number' ? best.similarity.toFixed(3) : 'n/a') + ' against any enrolled palm.' + neuralMeasuredStrId(best) + handNote + (timedOut ? ' No match was found within the ' + Math.round(B.SCAN_TIME_BUDGET_MS / 1000) + '-second scan limit.' : '') + ' ' + diagStr() + ')',
            diag: { edcc: best && typeof best.similarity === 'number' ? best.similarity : null, neural: bestNeuralAny, probeHand: probeHand, profileHand: null, handGate: excludedCount > 0, excludedCount: excludedCount } };
        });
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
      // v44: fold the composition's stage costs into the scan
      // diagnostics (the sink rides on the results array).
      if (results && results.timing) {
        stMatch += (results.timing.baseMs || 0) + (results.timing.geoMs || 0) + (results.timing.matchMs || 0);
        stGeo += results.timing.geoMs || 0;
        if (results.timing.geoEncodes > 0) geoFrames++;
      }
      candidates.forEach(function (p, i) {
        var res = results ? results[i] : null;
        var score = res && typeof res.similarity === 'number' ? res.similarity : null;
        states[p.id] = B.streamMatchUpdate(states[p.id], score);
        pushApplied(p, score, frameIdx);
      });
      // v45: the 1-snap rule — the first candidate whose match
      // verifies on this frame is the identification. v47: the
      // match judged here is the FUSED one (EDCC at 0.32 OR
      // PalmNet at its threshold), taken by tryWinIdentify from
      // this frame's EDCC results plus whatever neural scores
      // have landed for it; a neural score landing later re-enters
      // tryWinIdentify from its own continuation in step().
      if (typeof frameIdx === 'number') {
        frameResults[frameIdx] = results || null;
        tryWinIdentify(frameIdx);
      }
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
          stLm += r.lmMs || 0; stEnc += r.encMs || 0;
          var sample = tracker.add(frame, r.lm);
          frames.push(r);
          frameSpoof.push(sample ? !!sample.spoof : null);
          var myIdx = frames.length - 1;
          if (typeof r.openness === 'number') lastHint = r.framing || null;
          lastFrameIssue = r.frameIssue || null;
          // v43: publish the frame's quality signals — the scan
          // session reads stability from the pose, the guidance
          // pill from the rest. Guidance only; no gate reads these.
          lastOpen = typeof r.openness === 'number' ? r.openness : null;
          lastSharp = typeof r.sharpness === 'number' ? r.sharpness : null;
          lastSampleB = sample && typeof sample.meanBrightness === 'number' ? sample.meanBrightness : null;
          lastGlare = sample && typeof sample.glare === 'number' ? sample.glare : null;
          if (control && control.onFrame) {
            try { control.onFrame({ hasHand: typeof r.openness === 'number', pose: r.pose || null, openness: lastOpen, framing: lastHint, sharpness: lastSharp, meanLuma: lastSampleB, glareFrac: lastGlare, frameComplete: r.frameComplete === true, frameIssue: r.frameIssue || null }); } catch (e) {}
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
            // v53 FULL-HAND FRAME RULE: an incomplete frame
            // (cropped fingertips / too close) is never matched
            // or embedded — it applies a null score below,
            // exactly like a code-less frame. It still fed the
            // spoof tracker, the poses and the guidance above.
            if (sane && r.roi && r.frameComplete) {
              // v45: the per-frame identify call is the packed
              // composition — the probe is encoded once inside the
              // worker and scored against every candidate.
              prevMatch = { roi: r.roi, frameIdx: myIdx, promise: Match.verifyRoisMulti(candidates.map(function (p) { return p.palmProfile; }), [r.roi], { exhaustive: fieldExhaustiveOn(), probeHand: r.hand }) };
              // v47: the same frame is embedded ONCE by PalmNet
              // and scored against every banked candidate in pure
              // JS when it lands — off the EDCC pipeline's path.
              // v51: candidates the hand gate excludes for THIS
              // frame's hand are scored null (never embedded
              // against) — the twin-scope for PalmNet candidacy.
              if (anyNeuralBank) {
                PalmNet.embedPair(r.roi).then(function (pair) {
                  if (!pair) { frameNeuralScores[myIdx] = null; return; }
                  var scores = {};
                  candidates.forEach(function (p) {
                    if (banksById[p.id]) scores[p.id] = B.handGateBlocks(r.hand, B.palmProfileHand(p.palmProfile)) ? null : B.palmnetScoreEmbeddings(banksById[p.id], pair);
                  });
                  frameNeuralScores[myIdx] = scores;
                  tryWinIdentify(myIdx);
                });
              }
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
      // v49: a strict margin failure ends the money scan at once
      // — the palm matched the plain bars but ambiguously, and
      // no later frame can un-ambiguate an authorisation.
      if (strictFail) { Snd.buzz(); return { fail: MONEY_STRICT_FAIL_MSG, strictMoney: { applied: true, pass: false, block: strictFail.block } }; }
      var lv = B.passiveLivenessCheck(poses);
      if (win && lv.pass && sp.framesChecked >= 3) return identifiedOut();
      if (win && lv.pass && statusEl) setStatus('Palm identified — confirming this is a live hand, not a screen…');
      // v49: one candidate has a first verified frame but not yet
      // its confirming second — say so while the scan runs on.
      if (strictMoney && !win && lv.pass && statusEl && candidates.some(function (p) { return moneyGate.verifiedFrames(p.id) === 1; })) setStatus('Palm matched — money authorisation needs the match confirmed on a second frame. Keep the palm there…');
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
        return finalOut(Date.now() > deadline);
      }
      if (!swapped && swapCamera && analysed >= 18 && frames.every(function (x) { return typeof x.openness !== 'number'; })) {
        swapped = true;
        lastGrabT = -1;
        if (statusEl) setStatus('No hand was seen by this camera - switching to the other camera and trying once more.');
        shownStatus = null; // v50: the next guidance line always replaces the swap note
        return swapCamera().then(function () { return loop(); }, function () { return loop(); });
      }
      if (statusEl) {
        var seenHandNow = frames.some(function (x) { return typeof x.openness === 'number'; });
        // v43: the live guidance pill — one concise line mapped
        // from the quality signals this frame already produced.
        var guide = B.palmGuidance({ hasHand: seenHandNow, framing: lastHint, frameIssue: lastFrameIssue, openness: lastOpen, meanLuma: lastSampleB, glareFrac: lastGlare, sharpness: lastSharp, stable: false });
        setStatus(guide || (seenHandNow ? 'Hand detected — hold steady.' : 'Show an open hand to the camera.'));
      }
      return step().then(loop);
    }
    return loop();
  }

  var palmScanBusy = false;

  /* ---------------- Navigation ------------------------------------------- */
  function go(page) {
    var navPage = page === 'topup' ? 'registry' : page === 'account' ? 'wallet' : (page === 'stores' || page === 'logs' || page === 'partner') ? 'more' : page;
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
    if (page === 'account') { renderAccount(); }
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

  /* Palm enroll (v45): the app watches the camera; the moment a
     sharp open palm passes the quality gate, a single 900 ms
     burst runs by itself and banks 3 packed templates (profile
     v4). Passive liveness is read across the burst — a photo
     cannot produce natural micro-motion or depth variance. */
  function resetPalmEnroll() { /* burst enrolment keeps no partial state */ }
  /* Hands-free enrolment entry (v43, kept): entering the palm
     step starts the camera AND the capture automatically. The
     Start Camera and Auto-Capture buttons remain as
     fallback/re-trigger only. runPalmCapture's busy guard makes
     a re-trigger during a running capture a no-op. */
  var enrollControl = null;
  function startPalmCamera(autoCapture) {
    return Cam.start($('palmVideo'), camFacing.enrollPalm, 'enrollPalm').then(function () {
      Pipeline.enterScanView();
      $('palmCapture').disabled = false;
      if (autoCapture) { runPalmCapture(); return; }
      $('palmStatus').textContent = 'Camera on — show your open hand to the camera, anywhere in the frame, or tap Auto-Capture Palm. The app watches live: the moment a sharp open palm is seen, a 900 ms capture burst runs by itself and the palm is banked.';
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
    var control = { cancelled: false };
    enrollControl = control;
    streamEnrolPalm($('palmVideo'), $('palmStatus'), null, function () {
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
      if (!res.burst) {
        $('palmMsg').innerHTML = '<div class="error">No sharp open palm was captured' + (res.hint ? ' — last guidance shown: ' + esc(res.hint) : '') + '. Nothing was stored. Show one open palm to the camera, fingers spread, in good light, and hold it steady — the burst starts by itself the moment a sharp palm is seen.</div>';
        $('palmCapture').disabled = false;
        Snd.buzz();
        return;
      }
      if (!res.burst.liveness.pass) {
        $('palmMsg').innerHTML = '<div class="error">Liveness check failed: ' + esc(res.burst.liveness.reason) + ' Nothing was stored. Enrol with the real hand, held live in front of the camera.</div>';
        $('palmCapture').disabled = false;
        Snd.buzz();
        return;
      }
      // v45: bank the burst's 3 sharpest time-spaced templates in
      // the packed format — the spec's single-burst banking.
      var sel = B.selectPalmprintBurstCodes(res.results);
      if (!sel) {
        $('palmMsg').innerHTML = '<div class="error">No usable open palm with readable print detail was captured in the burst. Nothing was stored. Show one open palm to the camera, fingers spread, in good light, and try again.</div>';
        $('palmCapture').disabled = false;
        return;
      }
      // v51: the profile records the palm's ANATOMICAL hand —
      // the consensus of this capture's own frames (each frame
      // computed it the same way, in analysePalmFrame). null
      // when the capture could not determine one: the profile
      // then matches exactly as a pre-v51 profile until a later
      // Add Angles capture stamps it.
      var capHand = B.palmConsensusHand(res.results.map(function (r) { return r.hand; }));
      enroll.palm = { v: 4, format: B.PALMPRINT_FORMAT, codes: sel.codes, hand: capHand };
      // v47: bank PalmNet neural embeddings from the SAME frames
      // the EDCC burst banked (sel.picks are their indices into
      // res.results), so a new profile carries both template
      // types from one capture. Fail-soft: if the neural runtime
      // cannot produce embeddings, the enrolment still completes
      // EDCC-only and the Registry offers a Neural Scan for this
      // profile later — the message below states which happened.
      var pickRois = (sel.picks || []).map(function (i) { return res.results[i] && res.results[i].roi; }).filter(function (r) { return !!r; });
      PalmNet.embedRois(pickRois).then(function (embs) {
        var good = (embs || []).filter(function (e) { return !!e; });
        var bank = good.length ? B.palmnetBankFromEmbeddings(good) : null;
        var neuralNote;
        if (bank) {
          enroll.palm.neural = bank;
          neuralNote = ' PalmNet neural embeddings banked too (' + bank.embeddings.length + '), so this palm can also match through the neural matcher.';
        } else {
          neuralNote = ' PalmNet neural embeddings were not banked (' + (PalmNet.state === 'failed' ? PalmNet.failReason : 'the neural runtime did not produce embeddings') + ') — this palm verifies by EDCC, and the Registry will offer a Neural Scan to add them.';
        }
        Cam.stop();
        $('palmStatus').textContent = 'Palm captured.';
        // v51: the enrolment states which hand was recorded —
        // from now on the OTHER hand is a different identity to
        // this profile and will not match it.
        var handNote = capHand
          ? ' ' + (capHand === 'left' ? 'Left' : 'Right') + ' palm recorded — this profile is the ' + capHand + ' hand; the other hand will not match it.'
          : ' The hand (left or right) could not be determined from this capture, so this profile is not hand-stamped yet — a later Add Angles capture will record it.';
        $('palmMsg').innerHTML = '<div class="success">Palm enrolled hands-free in ' + (res.elapsedMs / 1000).toFixed(1) + ' s: one automatic 900 ms burst (' + res.burst.frames + ' frames) banked ' + sel.codes.length + ' palmprint templates (bit-packed EDCC — the palm\'s own print pattern), and passive liveness passed (natural micro-shift ' + (res.burst.liveness.microShift * 100).toFixed(1) + '% across the burst).' + esc(neuralNote) + esc(handNote) + '</div>';
        Snd.chime();
        Snd.speak('Palm captured');
        advanceFrom('palm');
      });
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
  // Palm-only: the note states the selected person's palm status.
  function fillTermMethodNote() {
    var person = termPeopleCache.find(function (p) { return p.id === $('termPerson').value; }) || null;
    $('termMethodNote').textContent = person
      ? (personHasMethod(person) ? person.name + ' enrolled: Palm — Palmprint.' : (B.palmprintProfileFormat(person.palmProfile) === 'legacy' ? person.name + ' — Palm re-scan needed: this palm was enrolled in the previous template format. Re-scan it from the Registry (Re-scan Palm) before scanning works.' : person.name + ' has no usable palm enrolled - re-enroll this person first.'))
      : '';
    $('termScan').disabled = true;
    syncCamToggle('terminal');
    refreshFlashUi('terminal');
    applyMirror('termVideo', camFacing[termFacingKey()]);
  }
  function personHasMethod(person) {
    // An enrollment only counts if the stored data is present AND sane -
    // a missing, empty or degenerate profile can never be verified against.
    if (!person) return false;
    return B.palmprintProfileSane(person.palmProfile);
  }
  function notEnrolledMessage(person) {
    if (person && B.palmprintProfileFormat(person.palmProfile) === 'legacy') {
      return 'Palm re-scan needed: this palm was enrolled in the previous template format, which the current packed matcher cannot read. Re-scan it from the Registry (Re-scan Palm) — one burst re-banks it, and nothing else about this person changes.';
    }
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
    // v49: the log write is best-effort — it must never gate the
    // verdict card. A wedged store (now bounded in DB.put) rejects
    // here and the terminal still renders its verdict.
    return DB.put('logs', { ts: Date.now(), personId: person.id, personName: person.name, store: $('termStore').value, method: method, measured: measured, result: result }).catch(function () { return null; });
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
  /* Exhaustive shift logging (v45, spec section 3): a Field Test
     sub-toggle — when ON the matcher evaluates all five shifts for
     every pair and each scan's measured text carries the per-shift
     log. Both checkbox copies stay in sync. */
  function setFieldExhaustive(on) {
    try { localStorage.setItem('biomFieldExhaustive', on ? '1' : '0'); } catch (e) {}
    if ($('fieldExhaustiveToggle')) $('fieldExhaustiveToggle').checked = on;
    if ($('fieldExhaustiveToggle2')) $('fieldExhaustiveToggle2').checked = on;
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
      var fieldRec = function (genuineScore, impostorMax, liveness, result, lightTag, neural) {
        if (!fieldModeOn()) return;
        var rec = {
          ts: Date.now(), biomId: person.id, camera: currentCameraTag(termFacingKey()),
          lighting: lightTag || '', genuineScore: genuineScore, impostorMax: impostorMax,
          liveness: liveness, spoofTag: $('fieldAttemptTag').value, result: result
        };
        // v47: the PalmNet per-system evidence rides the record
        // (the result above is the FUSED verdict). The CSV export
        // keeps its pinned v18 columns; these fields live on the
        // record and feed fieldTestStats' fused FAR.
        if (neural) {
          rec.neuralScore = typeof neural.neuralScore === 'number' ? neural.neuralScore : null;
          rec.neuralImpostorMax = typeof neural.neuralImpostorMax === 'number' ? neural.neuralImpostorMax : null;
          rec.acceptedBy = neural.acceptedBy || null;
          // v49: the strict money rule's outcome rides the record
          // the same way — the record's result above stays the
          // PLAIN fused verdict Field Test Mode measures, and the
          // pinned CSV columns are untouched.
          if (neural.strictMoney) {
            rec.strictMoney = true;
            rec.strictPass = neural.strictPass === true;
            rec.strictBlock = neural.strictBlock || null;
          }
          // v51: the hand evidence rides the record the same way
          // (extra fields only — the pinned CSV columns are
          // untouched): the probe's hand, the target profile's
          // recorded hand, and handGate when a cross-hand
          // exclusion decided the outcome. The pentest reads
          // these to see how often chirality was readable and
          // how often the gate did the rejecting.
          if (neural.probeHand) rec.probeHand = neural.probeHand;
          if (neural.profileHand) rec.profileHand = neural.profileHand;
          if (neural.handGate) rec.handGate = true;
        }
        writeFieldRecord(rec);
      };
      var control = { cancelled: false, onFrame: function (info) { termSession.frame({ hasHand: info.hasHand, pose: info.pose }); } };
      termControl = control;
      var attempt = streamVerifyPalm($('termVideo'), $('termStatus'), person, people, function () {
        var k = termFacingKey();
        camFacing[k] = camFacing[k] === 'user' ? 'environment' : 'user';
        syncCamToggle('terminal');
        // v48: the viewKey must be the terminal's flash key (k),
        // not the group name — with 'terminal' Cam.start found no
        // flash choice to honour, so a mid-scan camera swap killed
        // the torch and never re-applied it on the new track.
        return Cam.start($('termVideo'), camFacing[k], k);
      }, fieldRec, control, { strictMoney: true }).then(function (out) {
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
        if (out.fail) { Snd.buzz(); $('termResult').innerHTML = '<div class="error">' + esc(out.fail) + '</div>' + scanDiagHTML(out.diag); return; }
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
            $('termResult').innerHTML = html + scanDiagHTML(out.diag);
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
          var hand = B.palmProfileHand(p.palmProfile);
          return '<button class="profilecard" data-open-wallet="' + esc(p.id) + '"><span class="pc-name">' + esc(p.name) + '</span><span class="pc-id">' + esc(p.id) + '</span><span class="pc-sub">Tap, then scan this person\'s palm — the wallet opens only for their own palm' + (hand ? ' · ' + (hand === 'left' ? 'Left' : 'Right') + ' palm registered' : '') + '</span></button>';
        }).join('')
      : '<p class="sub" style="margin:0">No palm is registered on this device yet. Register a palm first — registration issues the Biom ID and creates the wallet automatically.</p>';
    document.querySelectorAll('[data-open-wallet]').forEach(function (b) {
      b.addEventListener('click', function () { openWalletForPerson(b.dataset.openWallet); });
    });
  }
  /* v52: the balance card's hide/show eye is a view preference
     for this session only — the stored balance never changes. */
  var balanceHidden = false;
  function initialsOf(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '--';
    return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  }
  function brandChipClass(type) {
    var t = String(type || '').toLowerCase();
    if (t.indexOf('bkash') !== -1) return 'bkash';
    if (t.indexOf('nagad') !== -1) return 'nagad';
    if (t.indexOf('bank') !== -1) return 'bank';
    if (t.indexOf('card') !== -1) return 'card';
    return 'pay';
  }
  function renderWalletHome(me) {
    var w = B.walletEnsurePerson(me).wallet;
    $('wHomeName').textContent = me.name;
    $('wHomeId').textContent = me.id;
    $('wHomeAvatar').textContent = initialsOf(me.name);
    $('wHomeBalance').textContent = balanceHidden ? 'BDT ••••••••' : fmtBDT(w.balance);
    $('wBalEye').classList.toggle('off', balanceHidden);
    var linkRows = w.linkedAccounts.map(function (a) {
      return '<div class="linkrow"><span class="brandchip ' + brandChipClass(a.type) + '">' + esc(String(a.type || '?').charAt(0)) + '</span>' +
        '<div class="lr-main"><div class="lr-name">' + esc(a.type) + '</div><div class="lr-sub">' + esc(a.label) + '</div></div>' +
        '<span class="badge ok">Linked</span></div>';
    });
    if (me.walletProvider) {
      linkRows.push('<div class="linkrow"><span class="brandchip pay"><svg viewBox="0 0 24 24" aria-hidden="true" style="width:24px;height:24px;stroke:#fff;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round"><path d="M7 11.8V6.2a1.5 1.5 0 0 1 3 0v4.3m0-5.8a1.5 1.5 0 0 1 3 0v5.3m0-4.8a1.5 1.5 0 0 1 3 0v5.8m0-3.6a1.5 1.5 0 0 1 3 0v4.7c0 4.3-3 6.9-6.9 6.9-3.4 0-5.7-1.9-7.1-5L3.7 12c-.4-.9.7-1.8 1.5-1.2L7 12.4"/></svg></span>' +
        '<div class="lr-main"><div class="lr-name">' + esc(me.walletProvider) + ' — Biom Pay</div><div class="lr-sub">' + esc(B.maskWalletNumber(me.walletNumber)) + '</div></div>' +
        '<span class="badge ok">Linked</span></div>');
    }
    $('wHomeAccounts').innerHTML = linkRows.length
      ? linkRows.join('')
      : '<p class="sub" style="margin:0">No wallet linked yet — Add Money will ask you to link a funding account.</p>';
    var downArrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v13m0 0 5-5m-5 5-5-5"/></svg>';
    var upArrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V7m0 0 5 5m-5-5-5 5"/></svg>';
    var rows = w.statement.slice().reverse().map(function (e) {
      var meta = '<div class="ar-meta">' + esc(fmtTime(e.ts)) + ' · Ref ' + esc(e.ref) + ' · Balance after: ' + fmtBDT(e.balanceAfter) + '</div>';
      if (e.kind === 'add') {
        return '<div class="actrow"><span class="acticon in">' + downArrow + '</span><div class="ar-main"><div class="ar-title">Money added (demo)</div><div class="ar-meta">From ' + esc(e.accountType) + ' — ' + esc(e.accountLabel) + '</div>' + meta + '</div><div class="amt in">+ ' + fmtBDT(e.amount) + '</div></div>';
      }
      if (e.kind === 'send') {
        return '<div class="actrow"><span class="acticon out">' + upArrow + '</span><div class="ar-main"><div class="ar-title">Sent (demo)</div><div class="ar-meta">To ' + esc(e.counterpartyName) + ' (' + esc(e.counterpartyId) + ')</div>' + meta + '</div><div class="amt out">− ' + fmtBDT(e.amount) + '</div></div>';
      }
      return '<div class="actrow"><span class="acticon in">' + downArrow + '</span><div class="ar-main"><div class="ar-title">Received (demo)</div><div class="ar-meta">From ' + esc(e.counterpartyName) + ' (' + esc(e.counterpartyId) + ')</div>' + meta + '</div><div class="amt in">+ ' + fmtBDT(e.amount) + '</div></div>';
    }).join('');
    $('wHomeStatement').innerHTML = rows || '<p class="sub" style="margin:0">No activity yet — add or send demo money and it will appear here.</p>';
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
  /* v52: the scan card's three status indicators are a pure
     presentation mirror of the live pipeline — hand presence and
     light come from the same per-frame info the guidance pill
     reads (dark below mean luma 45, glare above 0.15, exactly the
     B.palmGuidance thresholds), steadiness from the scan
     session's own stability count. They gate nothing. */
  var scanIndKey = '';
  function setScanInd(id, state, text) {
    var el = $(id);
    if (!el) return;
    el.classList.toggle('ok', state === 'ok');
    el.classList.toggle('warn', state === 'warn');
    var t = el.querySelector('.indtxt');
    if (t) t.textContent = text;
  }
  function updateScanIndicators(info, frameRes) {
    var hand = !!(info && info.hasHand);
    // v53: the hand indicator is tied to the completeness
    // judgement — a cropped or too-close hand is present but
    // cannot be scored, so it must not show green. It warns and
    // says what to do instead, in the guidance's own terms.
    var handState = 'wait', handText = 'No hand yet';
    if (hand && info.frameComplete === false) {
      handState = 'warn';
      handText = info.frameIssue === 'tooClose' ? 'Too close — move back' : 'Hand cropped — move back';
    } else if (hand) { handState = 'ok'; handText = 'Hand detected'; }
    var lightState = 'wait', lightText = 'Light —';
    if (info && typeof info.meanLuma === 'number' && isFinite(info.meanLuma)) {
      if (info.meanLuma < 45) { lightState = 'warn'; lightText = 'Too dark'; }
      else if (typeof info.glareFrac === 'number' && info.glareFrac > 0.15) { lightState = 'warn'; lightText = 'Glare'; }
      else { lightState = 'ok'; lightText = 'Good light'; }
    }
    var steady = !!(frameRes && frameRes.armed);
    var key = handState + handText + '|' + lightState + '|' + (steady ? '1' : '0');
    if (key === scanIndKey) return;
    scanIndKey = key;
    setScanInd('wIndHand', handState, handText);
    setScanInd('wIndLight', lightState, lightText);
    setScanInd('wIndSteady', steady ? 'ok' : 'wait', steady ? 'Holding steady' : 'Hold steady');
  }
  function resetScanIndicators() {
    scanIndKey = '';
    setScanInd('wIndHand', 'wait', 'No hand yet');
    setScanInd('wIndLight', 'wait', 'Light —');
    setScanInd('wIndSteady', 'wait', 'Hold steady');
  }
  function showWalletScan(ctx) {
    walletScanCtx = ctx;
    walletSession.enter();
    resetScanIndicators();
    $('walletScanCard').classList.remove('hidden');
    $('wScanTitle').textContent = ctx.title;
    $('wScanPrompt').textContent = ctx.prompt;
    $('wScanMsg').innerHTML = '';
    $('wScanDiag').innerHTML = '';
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
    walletControl = { cancelled: false, onFrame: function (info) { var fr = walletSession.frame({ hasHand: info.hasHand, pose: info.pose }); updateScanIndicators(info, fr); } };
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
  /* v53: the measured diagnosis panel rendered under a failed
     scan's message — on the wallet card and at the terminal.
     The lines come from B.scanDiagnosisLines over the outcome's
     diag, which the streams build from the same values the
     scan's log record carries. No diag (a spoof verdict, a
     camera failure, a scan with no scored frame) -> no panel. */
  function scanDiagHTML(diag) {
    var lines = B.scanDiagnosisLines(diag);
    if (!lines.length) return '';
    return '<div class="diagpanel"><div class="diagtitle">Why this scan failed</div>' +
      lines.map(function (l) { return '<div class="diagrow">' + esc(l) + '</div>'; }).join('') + '</div>';
  }
  function walletScanFailed(out) {
    // v43: a scan cancelled by navigation/close ends silently —
    // the card closes instead of showing a failure for a scan
    // nobody is looking at any more.
    if (out && out.stopped) { hideWalletScan(); renderWallet(); return; }
    $('wScanMsg').innerHTML = '<div class="error">' + esc(out && out.fail ? out.fail : 'The scan did not verify. Nothing was authorised.') + '</div>';
    // v53: under the message, the measured panel — and, on the
    // wallet-OPEN scans, the owner recovery entry. A money
    // authorisation failure gets the panel only: recovery from
    // a failed payment scan is the wallet-open path, not a
    // button beside the amount.
    var diagHtml = scanDiagHTML(out && out.diag);
    var ctx = walletScanCtx;
    if (ctx && ctx.recoverable) diagHtml += renderWalletRecovery(ctx);
    $('wScanDiag').innerHTML = diagHtml;
    wireWalletRecovery(ctx);
    $('wScanRun').disabled = false;
    Snd.buzz();
  }
  /* v53 OWNER RECOVERY (wallet-open failures only): the
     lockout this breaks — a genuine owner whose thin bank
     scores just under the bar is refused by the same bars at
     Add Angles (the v49 banking guard), so the bank that is
     failing him can never grow. "Strengthen my palm" runs the
     existing guided Add Angles capture for his profile under
     that same guard; only a guard refusal there unlocks the
     confirmation-gated re-registration (see runTopupCapture).
     The 1:1 open names its person; the 1:N open cannot (the
     palm matched nobody), so it offers the profile picker —
     name + Biom ID, the owner's own knowledge doing the
     identifying the scan could not. */
  function renderWalletRecovery(ctx) {
    if (ctx.recoverPersonId) {
      return '<div class="diagpanel"><div class="diagtitle">Is this your palm?</div>' +
        '<div class="diagrow">If this is your own palm and it keeps failing, you can strengthen its stored profile — the guided capture adds angles under the same safety check as always.</div>' +
        '<button class="btn primary" id="wStrengthen" style="margin-top:10px">Strengthen my palm</button></div>';
    }
    var people = walletPeopleCache.filter(function (p) { return B.palmprintProfileSane(p.palmProfile); });
    if (!people.length) return '';
    return '<div class="diagpanel"><div class="diagtitle">Is this your palm?</div>' +
      '<div class="diagrow">If this is your own palm and it keeps failing, choose your profile to strengthen its stored palm — the guided capture adds angles under the same safety check as always.</div>' +
      people.map(function (p) {
        return '<button class="btn" data-strengthen="' + esc(p.id) + '" style="margin-top:8px">' + esc(p.name) + ' — ' + esc(p.id) + '</button>';
      }).join('') + '</div>';
  }
  function wireWalletRecovery(ctx) {
    if (!ctx || !ctx.recoverable) return;
    var one = $('wStrengthen');
    if (one) one.addEventListener('click', function () { var id = ctx.recoverPersonId; hideWalletScan(); openRecoveryTopup(id); });
    document.querySelectorAll('[data-strengthen]').forEach(function (b) {
      b.addEventListener('click', function () { var id = b.dataset.strengthen; hideWalletScan(); openRecoveryTopup(id); });
    });
  }
  $('wScanStart').addEventListener('click', startWalletCamera);
  camRestarters.walletAct = function () {
    // v49: this restarter was the one camera-start caller with no
    // rejection path — a failed restart vanished silently and the
    // scan card sat dead. It now surfaces the same camera error
    // as startWalletCamera.
    Cam.start($('wScanVideo'), camFacing.walletAct, 'walletAct').then(function () { runWalletScan(); }).catch(function (e) { $('wScanMsg').innerHTML = cameraErrorHTML(e); $('wScanStatus').textContent = 'Camera blocked.'; });
  };
  $('wScanRun').addEventListener('click', runWalletScan);
  $('wScanCancel').addEventListener('click', function () {
    if (palmScanBusy) { if (walletControl) walletControl.cancelled = true; return; }
    hideWalletScan();
    renderWallet();
  });

  /* Open a wallet: the scan is the key, always. The generic route
     identifies the palm (1:N); a profile card names the person and
     the scan must verify as THAT person (1:1).
     v50 (the Chairman's correction, 2026-11-24): opening a wallet
     is a LOGIN, not a money movement — v49's strict money rule
     ran here too and blocked the owner opening his own wallet
     ("Matched, but not clearly enough to authorise money" at
     wallet entry). Both routes below therefore run the PLAIN
     fused verify, exactly as before v49. The strict rule stays
     on the three money-moving authorisations only: Add Money,
     Send Money sender authorisation, terminal Biom Pay. */
  $('walletOpenScan').addEventListener('click', function () {
    showWalletScan({
      title: 'Open your wallet — palm scan',
      recoverable: true, // v53: a failed open offers the owner recovery (profile picker — the palm matched nobody)
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
      recoverable: true, recoverPersonId: personId, // v53: a failed open offers the owner recovery for this named profile
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
  function closeWalletSession() {
    walletSessionId = null;
    Cam.stop();
    renderWallet();
    toast('Wallet closed.');
  }
  $('wCloseWallet').addEventListener('click', closeWalletSession);

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
    $('wAddBalance').textContent = fmtBDT(B.walletEnsurePerson(me).wallet.balance);
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
          return streamVerifyPalm($('wScanVideo'), $('wScanStatus'), fresh, people, walletSwapCamera, function () {}, walletControl, { strictMoney: true }).then(function (out) {
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
    $('wSendBalance').textContent = fmtBDT(B.walletEnsurePerson(me).wallet.balance);
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
      '<div class="recvcard"><div class="rc-head"><span class="avatarbtn" style="background:var(--blue);border:none;cursor:default">' + esc(initialsOf(sendDraft.receiverName)) + '</span>' +
      '<div><div class="rc-name">' + esc(sendDraft.receiverName) + '</div><div class="rc-id">' + esc(sendDraft.receiverId) + '</div></div>' +
      '<span class="badge ok" style="margin-left:auto">Palm verified</span></div>' +
      '<div class="rc-rows"><b>Amount:</b> ' + fmtBDT(sendDraft.amount) + ' (demo money)<br>' +
      '<b>Your demo balance:</b> ' + fmtBDT(w.balance) + (sendDraft.amount > w.balance ? '<br><b>That is more than your balance — the send will be blocked.</b>' : '') + '</div></div>' +
      '<button class="btn primary big" id="wSendAuthorise" style="margin-top:12px">Scan Palm to Send</button>';
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
          return streamVerifyPalm($('wScanVideo'), $('wScanStatus'), freshSender, people, walletSwapCamera, function () {}, walletControl, { strictMoney: true }).then(function (out) {
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

  /* ---------------- My Account (v52) --------------------------------
     The customer account surface: every value is read live from
     the open wallet's person record and wallet — nothing here is
     stored separately, and nothing here writes. Palm actions are
     the REAL existing flows (Add Angles / re-scan / Neural Scan
     via openTopup, other-hand registration via enrolment). */
  function renderAccount() {
    return loadWalletPeople().then(function () {
      var me = walletSessionPerson();
      $('accountLocked').classList.toggle('hidden', !!me);
      $('accountOpen').classList.toggle('hidden', !me);
      if (!me) return;
      var w = B.walletEnsurePerson(me).wallet;
      var hand = B.palmProfileHand(me.palmProfile);
      var format = B.palmprintProfileFormat(me.palmProfile);
      var enrolled = personHasMethod(me);
      $('acAvatar').textContent = initialsOf(me.name);
      $('acName').textContent = me.name;
      $('acPhone').textContent = me.phone || 'No phone number recorded';
      $('acVerified').innerHTML = !enrolled
        ? '<span class="badge bad">Not enrolled</span>'
        : format === 'legacy'
          ? '<span class="badge bad">Palm re-scan needed</span>'
          : '<span class="badge ok">Verified</span>';
      $('acPalmStatus').innerHTML = !enrolled
        ? '<span class="badge bad">Not enrolled</span>'
        : format === 'legacy'
          ? '<span class="badge bad">Re-scan needed</span>'
          : '<span class="badge ok">Active</span>';
      $('acBiomId').textContent = me.id;
      $('acPalmHand').textContent = !enrolled
        ? 'No palm registered yet'
        : hand
          ? (hand === 'left' ? 'Left' : 'Right') + ' palm'
          : 'Palm registered — hand not recorded (enrolled before hand recording began)';
      var actions = '';
      if (enrolled) actions += '<div><button class="btn primary" data-acct-topup="angles">Add Angles</button></div>';
      if (format === 'legacy') actions += '<div><button class="btn primary" data-acct-topup="angles">Re-scan Palm</button></div>';
      if (B.palmnetNeedsScan(me.palmProfile)) actions += '<div><button class="btn" data-acct-topup="neural">Neural Scan</button></div>';
      actions += '<div><button class="btn" id="acOtherHand">Register Other Hand</button></div>';
      $('acPalmActions').innerHTML = actions;
      document.querySelectorAll('[data-acct-topup]').forEach(function (b) {
        b.addEventListener('click', function () { openTopup(me.id, b.dataset.acctTopup === 'neural' ? 'neural' : undefined); });
      });
      var oh = $('acOtherHand');
      if (oh) oh.addEventListener('click', function () { go('enroll'); });
      $('acInfoBody').innerHTML =
        '<b>Name:</b> ' + esc(me.name) + '<br>' +
        '<b>Phone:</b> ' + esc(me.phone || 'No phone number recorded') + '<br>' +
        '<b>Person type:</b> ' + esc(me.type || '') + '<br>' +
        '<b>Home store:</b> ' + esc(me.store || '') + '<br>' +
        '<b>Biom ID:</b> ' + esc(me.id) + '<br>' +
        '<b>Loyalty points:</b> ' + Number(me.loyaltyPoints || 0);
      var linkedParts = w.linkedAccounts.map(function (a) { return a.type; });
      if (me.walletProvider) linkedParts.push(me.walletProvider + ' (Biom Pay)');
      $('acLinkedVal').textContent = linkedParts.length ? linkedParts.join(', ') : 'None linked';
      var lim = me.limits || {};
      $('acLimitsVal').textContent = lim.daily ? fmtBDT(lim.daily) + ' / day' : 'No daily limit set';
      $('acLimitsBody').innerHTML =
        '<b>Per-transaction limit:</b> ' + (lim.perTx ? fmtBDT(lim.perTx) : 'No limit') + '<br>' +
        '<b>Daily limit:</b> ' + (lim.daily ? fmtBDT(lim.daily) : 'No limit') + '<br>' +
        '<span style="color:var(--muted)">Limits are chosen at registration. Above a limit, a Biom Pay payment is not created on palm alone — PIN confirmation is required.</span>';
      $('acSecBody').innerHTML =
        'Palm templates are stored only on this device — nothing about your palm leaves it.<br>' +
        '<b>Registered palm:</b> ' + (hand ? (hand === 'left' ? 'Left' : 'Right') + ' hand' : 'hand not recorded') + '<br>' +
        '<b>Money scans:</b> Add Money, Send Money and Biom Pay use the strict money rule — a two-frame confirmation that must clearly beat every other enrolled palm.<br>' +
        '<span style="color:var(--muted)">Erase everything on this device from More → Delete All Data.</span>';
    });
  }
  $('acBack').addEventListener('click', function () { go('wallet'); });
  $('acOpenWallet').addEventListener('click', function () { go('wallet'); });
  $('acRowLinked').addEventListener('click', function () { go('wallet'); });
  $('acRowHelp').addEventListener('click', function () { go('more'); });
  $('acLogout').addEventListener('click', function () { closeWalletSession(); go('wallet'); });
  document.querySelectorAll('[data-acct-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var d = $('acDetail-' + b.dataset.acctToggle);
      if (d) d.classList.toggle('hidden');
    });
  });

  /* ---------------- v52 wallet home wiring --------------------------
     Eye toggle, avatar, quick actions and amount chips — all
     presentation wiring over the existing flows. */
  $('wBalEye').addEventListener('click', function () {
    balanceHidden = !balanceHidden;
    var me = walletSessionPerson();
    if (me) renderWalletHome(me);
  });
  $('wHomeAvatar').addEventListener('click', function () { go('account'); });
  $('wQuickHistory').addEventListener('click', function () {
    var card = $('wActivityCard');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('wQuickScan').addEventListener('click', function () {
    var me = walletSessionPerson();
    if (!me) return;
    showWalletScan({
      title: 'Scan Palm — verify it is you',
      prompt: 'Show your open palm. This is a plain identity check on the open wallet — it authorises nothing and moves no money.',
      run: function () {
        return DB.all('people').then(function (people) {
          var fresh = people.find(function (p) { return p.id === me.id; }) || me;
          return streamVerifyPalm($('wScanVideo'), $('wScanStatus'), fresh, people, walletSwapCamera, function () {}, walletControl).then(function (out) {
            var auth = authFromVerify(out, fresh.id);
            if (!auth.verified) { walletScanFailed(out); return; }
            hideWalletScan();
            return renderWallet().then(function () {
              $('wHomeMsg').innerHTML = '<div class="success">Palm verified — this wallet belongs to ' + esc(fresh.name) + ' (' + esc(fresh.id) + ').<br><span style="color:var(--muted)">' + esc(out.measured) + '</span></div>';
              Snd.chime();
            });
          });
        });
      }
    });
  });
  document.querySelectorAll('[data-chips]').forEach(function (group) {
    var input = $(group.dataset.chips);
    group.querySelectorAll('[data-amt]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        if (input) { input.value = chip.dataset.amt; input.focus(); }
      });
    });
  });

  /* ---------------- Registry & logs -------------------------------------- */
  function renderRegistry() {
    var q = ($('registrySearch').value || '').toLowerCase();
    return DB.all('people').then(function (people) {
      var rows = people.filter(function (p) {
        return !q || p.name.toLowerCase().indexOf(q) >= 0 || p.id.toLowerCase().indexOf(q) >= 0 || (p.phone || '').indexOf(q) >= 0;
      }).map(function (p) {
        return '<tr><td><b>' + esc(p.name) + '</b><br><span style="color:var(--muted)">' + esc(p.phone || '') + '</span>' + (p.loyaltyPoints ? '<br><span style="color:var(--muted)">Loyalty: ' + p.loyaltyPoints + ' pts</span>' : '') + '</td>' +
          '<td>' + esc(p.id) + '</td><td>' + esc(p.type) + '<br><span style="color:var(--muted)">' + esc(p.store) + '</span></td>' +
          '<td>' + (personHasMethod(p) ? '<span class="badge ok">Enrolled</span>' : (B.palmprintProfileFormat(p.palmProfile) === 'legacy' ? '<span class="badge bad">Palm re-scan needed</span>' : '<span class="badge bad">Not enrolled</span>')) + (B.palmnetNeedsScan(p.palmProfile) ? '<br><span class="badge warn">Neural scan needed</span>' : '') + (personHasMethod(p) && B.palmProfileHand(p.palmProfile) ? '<br><span style="color:var(--muted)">' + (B.palmProfileHand(p.palmProfile) === 'left' ? 'Left' : 'Right') + ' palm</span>' : '') + '</td>' +
          '<td>' + (p.walletProvider ? esc(p.walletProvider) + '<br>' + esc(B.maskWalletNumber(p.walletNumber)) : '—') + '</td>' +
          '<td><button class="btn small" data-verify="' + esc(p.id) + '">Verify</button>' + (personHasMethod(p) ? ' <button class="btn small" data-topup="' + esc(p.id) + '">Add Angles</button>' : '') + (B.palmprintProfileFormat(p.palmProfile) === 'legacy' ? ' <button class="btn small" data-topup="' + esc(p.id) + '">Re-scan Palm</button>' : '') + (B.palmnetNeedsScan(p.palmProfile) ? ' <button class="btn small" data-neural="' + esc(p.id) + '">Neural Scan</button>' : '') + '</td></tr>';
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
      document.querySelectorAll('[data-neural]').forEach(function (b) {
        b.addEventListener('click', function () { openTopup(b.dataset.neural, 'neural'); });
      });
    });
  }
  $('registrySearch').addEventListener('input', renderRegistry);

  /* ---------------- Add-angles top-up (v43; v45 format) ----------
     An existing profile gains diverse sharp templates WITHOUT
     re-registering: a burst session runs, and its candidates MERGE
     into the stored profile (B.mergePalmprintProfileCodes) —
     stored templates carried verbatim, the cap respected, and at
     the cap only a redundant template is replaced. For a LEGACY
     profile (pre-v45 byte-format codes, flagged Palm re-scan
     needed), the same flow RE-BANKS the palm in the current
     packed format; the old codes stay archived in the record's
     legacyCodes field. Identity, Biom ID, wallet (balance,
     statement, linked accounts) and points are never touched:
     the save writes back the same person record with only the
     palm profile changed. */
  var topupControl = null;
  var topupPersonId = null;
  var topupBusy = false;
  var topupMode = 'angles'; // 'angles' (EDCC + neural) | 'neural' (neural only, v47)
  /* v53 owner recovery state: recoveryPersonId is set ONLY by
     openRecoveryTopup (reached from a failed wallet-open scan)
     and cleared by every ordinary openTopup call, by Back, and
     when a re-registration completes. While it names a profile,
     a banking-guard refusal in that profile's capture offers
     the confirmation-gated re-registration; reregPerson is the
     record that refusal was judged against. */
  var recoveryPersonId = null;
  var reregPerson = null;
  function openRecoveryTopup(personId) { openTopup(personId, 'angles', true); }
  function openTopup(personId, mode, viaRecovery) {
    // v53: every ordinary entry (Registry, My Account, Neural
    // Scan) clears the recovery state — the re-registration
    // offer can only ever follow a recovery-launched capture.
    recoveryPersonId = viaRecovery ? personId : null;
    reregPerson = null;
    if ($('topRereg')) $('topRereg').classList.add('hidden');
    DB.all('people').then(function (people) {
      var person = people.find(function (p) { return p.id === personId; }) || null;
      if (!person) return;
      var fmt = B.palmprintProfileFormat(person.palmProfile);
      if (fmt !== 'packed96' && fmt !== 'legacy') return;
      if (mode === 'neural' && fmt !== 'packed96') return; // a legacy palm needs the full re-scan first
      topupPersonId = personId;
      topupMode = mode === 'neural' ? 'neural' : 'angles';
      go('topup');
      if ($('topTitle')) $('topTitle').textContent = topupMode === 'neural' ? 'Neural Scan — add PalmNet embeddings' : 'Add Angles — widen a palm profile';
      if ($('topSub')) $('topSub').textContent = topupMode === 'neural'
        ? 'Runs the same burst capture as enrolment and banks PalmNet neural embeddings for this person\'s palm, so it can match through the neural matcher as well as EDCC. Their EDCC templates, Biom ID, wallet, balance, statement, linked accounts and loyalty points do not change.'
        : 'Runs the same burst capture as enrolment and adds diverse sharp templates to this person\'s stored profile — or re-banks the palm in the current format when it was enrolled in the previous one. Their Biom ID, wallet, balance, statement, linked accounts and loyalty points do not change — only the palm profile gains templates.';
      if (topupMode === 'neural') {
        $('topWho').innerHTML = '<b>' + esc(person.name) + '</b> — ' + esc(person.id) + '<br><span style="color:var(--muted)">Neural scan: this palm is enrolled for the EDCC matcher but has no PalmNet neural embeddings yet, so it verifies EDCC-only. One burst banks neural embeddings for the same palm; the EDCC templates, Biom ID, wallet and points do not change. Before anything is banked, the burst is checked against the palm already banked for this profile — a different palm is refused and nothing is added.</span>';
      } else if (fmt === 'legacy') {
        $('topWho').innerHTML = '<b>' + esc(person.name) + '</b> — ' + esc(person.id) + '<br><span style="color:var(--muted)">Palm re-scan needed: this palm was enrolled in the previous template format, which the current packed matcher cannot read. One burst re-banks it in the current format; the old codes stay archived in this record, and nothing else about this person changes. Honest limit: because the old templates cannot be read, this re-scan cannot check the presented palm against them — it banks the palm that is presented, so only run it with this person\'s own palm.</span>';
      } else {
        $('topWho').innerHTML = '<b>' + esc(person.name) + '</b> — ' + esc(person.id) + '<br><span style="color:var(--muted)">Currently banked: ' + person.palmProfile.codes.length + ' packed palm templates' + (Array.isArray(person.palmProfile.poses) ? ' with pose data.' : ' from a single-posture enrolment — no pose data yet.') + ' The burst adds diverse sharp templates; nothing else about this person changes. Before anything is added, the burst is checked against the palm already banked — a different palm is refused and nothing is added.</span>';
      }
      $('topMsg').innerHTML = '';
      if (viaRecovery) $('topMsg').innerHTML = '<div class="notice">You came here from a failed wallet-open scan. This guided capture tries to add angles to ' + esc(person.name) + '\'s stored palm under the usual safety check. If the check refuses — because the stored templates are the ones failing — you will be offered a confirmed re-registration instead.</div>';
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
    var control = { cancelled: false };
    topupControl = control;
    streamEnrolPalm($('topVideo'), $('topStatus'), null, function () {
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
      if (!res.burst) {
        $('topMsg').innerHTML = '<div class="error">No capture burst ran' + (res.hint ? ' (' + esc(res.hint) + ')' : '') + ' — nothing was changed. Show one open palm to the camera and run it again.</div>';
        Snd.buzz();
        return;
      }
      if (!res.burst.liveness.pass) {
        $('topMsg').innerHTML = '<div class="error">Liveness check failed: ' + esc(res.burst.liveness.reason) + ' Nothing was changed. Run it again with the real hand held live in front of the camera.</div>';
        Snd.buzz();
        return;
      }
      return DB.all('people').then(function (people) {
        var person = people.find(function (p) { return p.id === topupPersonId; }) || null;
        if (!person) { $('topMsg').innerHTML = '<div class="error">That person is no longer in the registry — nothing was changed.</div>'; return; }
        // v49 SAME-PERSON GUARD (audit AUDIT-addmoney-v48.md,
        // hypothesis (c)): before ANY merge below, the captured
        // palm must verify against this profile's existing
        // readable bank at the standard fused bars
        // (B.bankingGuardCheck) — computed offline from THIS
        // burst's own candidates (the packed candidates the EDCC
        // merge would bank, the embeddings the neural merge would
        // bank), with no extra camera session. A palm that does
        // not match is refused whole: nothing is banked, in
        // either system, and the refusal is logged. The one case
        // the guard cannot cover is the legacy re-bank — archived
        // pre-v45 codes cannot be scored by the current matchers,
        // so the guard reports 'uncheckable' and the flow
        // proceeds; that limitation is stated in the flow's own
        // copy (openTopup) and never hidden.
        var candProbes = B.palmprintPackedCandidates(res.results).list.map(function (c) { return c.words; });
        return PalmNet.embedRois(neuralCandidateRois(res.results)).then(function (embs) {
          var good = (embs || []).filter(function (e) { return !!e; });
          // v51: the capture's hand rides the guard — a known
          // cross-hand capture fails the guard before any
          // scoring (the twin cannot bank the other hand in).
          var captureHand = B.palmConsensusHand(res.results.map(function (r) { return r.hand; }));
          var guard = B.bankingGuardCheck(person.palmProfile, { edccProbes: candProbes, neuralEmbeddings: good, hand: captureHand });
          if (guard.status === 'fail') {
            DB.put('logs', { ts: Date.now(), personId: person.id, personName: person.name, store: '', method: 'palm', measured: 'Banking refused by the v49 same-person guard: the captured palm did not verify against this profile (EDCC ' + (guard.edccChecked ? guard.edccScore.toFixed(3) : 'not checkable') + ', PalmNet ' + (guard.neuralChecked ? guard.neuralScore.toFixed(3) : 'not checkable') + '). Nothing was banked.' + (guard.handGate ? ' Hand gate: the captured palm is the ' + guard.probeHand + ' hand; this profile recorded the ' + guard.profileHand + ' hand — the other hand is a different identity.' : ''), result: 'Banking Refused — Palm Mismatch' });
            $('topMsg').innerHTML = '<div class="error">This palm does not match this profile — nothing was added</div>';
            // v53: when this capture was launched from the
            // wallet-open recovery path, the refusal is the
            // lockout case — the stored bank is what is failing,
            // so no guarded top-up can ever fix it. Offer the
            // owner-confirmed remedy. An ordinary Add Angles
            // refusal (recoveryPersonId unset or naming another
            // profile) shows nothing more: re-registration is
            // reachable ONLY from here, only for the recovery
            // profile, only after this refusal.
            if (recoveryPersonId && recoveryPersonId === person.id) {
              reregPerson = person;
              $('topMsg').innerHTML += '<div class="diagpanel"><div class="diagtitle">This profile cannot be strengthened this way</div>' +
                '<div class="diagrow">The safety check compares the captured palm against the templates already stored — and those stored templates are the ones that are failing. If you are ' + esc(person.name) + ' and this is your own palm, you can re-register it: a fresh guided enrolment replaces this profile\'s palm bank. Nothing else about the profile changes.</div>' +
                '<button class="btn danger" id="topReregOpen" style="margin-top:10px">Re-register this palm</button></div>';
              $('topReregOpen').addEventListener('click', function () { openReregConfirm(); });
            }
            Snd.buzz();
            return;
          }
          // v51 HAND STAMP: the first guarded top-up that passes
          // on a profile with no recorded hand stamps the
          // profile with THIS capture's hand (when the capture
          // determined one). From then on the profile's other
          // hand is a different identity to every gate. A
          // profile that already carries a hand keeps it.
          var stampHand = B.palmProfileHand(person.palmProfile) ? null : captureHand;
          var stampNote = stampHand ? ' This capture also recorded the profile\'s hand: ' + stampHand + ' — the other hand will no longer match this profile.' : '';
        // v47 Neural scan mode: bank PalmNet embeddings only —
        // the EDCC profile is carried over untouched.
        if (topupMode === 'neural') {
            if (!good.length) {
              $('topMsg').innerHTML = '<div class="error">The PalmNet neural matcher produced no embeddings for this burst (' + (PalmNet.state === 'failed' ? esc(PalmNet.failReason) : 'the model may still be loading') + '). Nothing was changed. Run it again in a few seconds.</div>';
              Snd.buzz();
              return;
            }
            var nMerge = B.mergePalmnetEmbeddings(person.palmProfile.neural || null, good);
            if (!nMerge.changed) {
              $('topMsg').innerHTML = '<div class="notice">No new neural embeddings were added: ' + nMerge.skipped + ' candidate(s) were near-duplicates of embeddings already banked, or the bank is full. The stored profile is unchanged.</div>';
              return;
            }
            var nProfile = Object.assign({}, person.palmProfile, { neural: nMerge.neural });
            if (stampHand) nProfile.hand = stampHand;
            var nUpdated = Object.assign({}, person, { palmProfile: nProfile });
            return DB.put('people', nUpdated).then(function () {
              $('topMsg').innerHTML = '<div class="success">Neural embeddings banked for ' + esc(person.name) + ': ' + nMerge.added + ' new embedding(s), ' + nMerge.total + ' in the bank. This palm now matches through EDCC and PalmNet. EDCC templates, Biom ID, wallet, balance, statement, linked accounts and points are untouched.' + esc(stampNote) + '</div>';
              Snd.chime();
              Snd.speak('Neural scan banked');
            });
          return;
        }
        var merged = B.mergePalmprintProfileCodes(person.palmProfile, res.results);
        if (!merged) {
          $('topMsg').innerHTML = '<div class="error">The burst did not bank enough usable templates — three time-spaced sharp templates are needed. Nothing was changed. Run it again and hold the palm steady.</div>';
          return;
        }
        // v47: Add Angles banks BOTH template types from the same
        // burst — the EDCC merge above and the neural merge here.
        // v49: the embeddings are the ones already computed for
        // the same-person guard above (`good`) — one embed pass
        // serves the guard and this merge.
          var nMerge = good.length
            ? B.mergePalmnetEmbeddings(person.palmProfile.neural || null, good)
            : { neural: person.palmProfile.neural || null, added: 0, skipped: 0, total: 0, changed: false };
          var neuralNote = '';
          if (nMerge.changed) neuralNote = ' PalmNet neural embeddings updated too: ' + nMerge.added + ' new, ' + nMerge.total + ' banked.';
          else if (!person.palmProfile.neural && !good.length) neuralNote = ' PalmNet neural embeddings were not banked (' + (PalmNet.state === 'failed' ? PalmNet.failReason : 'the neural runtime produced none') + ') — the Registry will offer a Neural Scan.';
          else if (good.length) neuralNote = ' Neural embeddings unchanged (' + nMerge.skipped + ' near-duplicate candidate(s) skipped).';
          if (merged.rebanked) {
            // v51: the re-banked profile records the hand of the
            // capture that re-banked it (the legacy bank it
            // replaces carried no hand — its codes were
            // unscorable, so this capture is the first hand
            // evidence the profile has).
            var reProfile = { v: 4, format: B.PALMPRINT_FORMAT, codes: merged.codes, hand: captureHand };
            if (person.palmProfile.legacyCodes) reProfile.legacyCodes = person.palmProfile.legacyCodes;
            if (merged.poses.some(function (d) { return !!d; })) reProfile.poses = merged.poses;
            if (nMerge.neural) reProfile.neural = nMerge.neural;
            var reUpdated = Object.assign({}, person, { palmProfile: reProfile });
            return DB.put('people', reUpdated).then(function () {
              $('topMsg').innerHTML = '<div class="success">Palm re-banked for ' + esc(person.name) + ': ' + merged.codes.length + ' packed templates banked in the current format. The previous codes stay archived in this record. Biom ID, wallet, balance, statement, linked accounts and points are untouched.' + esc(neuralNote) + (captureHand ? ' This capture recorded the profile\'s hand: ' + captureHand + ' — the other hand will not match this profile.' : '') + '</div>';
              Snd.chime();
              Snd.speak('Palm re-banked');
            });
          }
          if (!merged.changed && !nMerge.changed) {
            // v51: even when no template changes, a passing
            // guarded capture on a hand-less profile still
            // stamps the hand — otherwise a duplicate-only burst
            // (the likely first Add Angles on a pre-v51 profile)
            // would leave the profile unstamped forever.
            if (stampHand) {
              var stampOnlyProfile = Object.assign({}, person.palmProfile, { hand: stampHand });
              var stampOnlyUpdated = Object.assign({}, person, { palmProfile: stampOnlyProfile });
              return DB.put('people', stampOnlyUpdated).then(function () {
                $('topMsg').innerHTML = '<div class="notice">No new templates were added: ' + merged.skipped + ' candidate template(s) were skipped as duplicates or poses already covered, and no banked template was redundant enough to replace. The stored templates are unchanged.' + esc(neuralNote) + esc(stampNote) + '</div>';
              });
            }
            $('topMsg').innerHTML = '<div class="notice">No new templates were added: ' + merged.skipped + ' candidate template(s) were skipped as duplicates or poses already covered, and no banked template was redundant enough to replace. The stored profile is unchanged.' + esc(neuralNote) + '</div>';
            return;
          }
          if (!merged.changed && nMerge.changed) {
            var keepProfile = Object.assign({}, person.palmProfile, { neural: nMerge.neural });
            if (stampHand) keepProfile.hand = stampHand;
            var keepUpdated = Object.assign({}, person, { palmProfile: keepProfile });
            return DB.put('people', keepUpdated).then(function () {
              $('topMsg').innerHTML = '<div class="success">Neural embeddings added for ' + esc(person.name) + ': ' + nMerge.added + ' new embedding(s), ' + nMerge.total + ' in the bank. The EDCC templates were already covered by this burst, so they are unchanged. Biom ID, wallet, balance, statement, linked accounts and points are untouched.' + esc(stampNote) + '</div>';
              Snd.chime();
              Snd.speak('Neural embeddings added');
            });
          }
          var profile = { v: 4, format: B.PALMPRINT_FORMAT, codes: merged.codes };
          if (merged.poses.some(function (d) { return !!d; })) profile.poses = merged.poses;
          if (person.palmProfile.legacyCodes) profile.legacyCodes = person.palmProfile.legacyCodes;
          if (nMerge.neural) profile.neural = nMerge.neural;
          // v51: the rebuilt profile carries the recorded hand —
          // the profile's own when it has one, else this
          // capture's (the stamp).
          profile.hand = B.palmProfileHand(person.palmProfile) || captureHand;
          var updated = Object.assign({}, person, { palmProfile: profile });
          return DB.put('people', updated).then(function () {
            $('topMsg').innerHTML = '<div class="success">Templates added for ' + esc(person.name) + ': ' + merged.added + ' new template(s) appended' + (merged.replaced ? ', ' + merged.replaced + ' redundant template(s) replaced at the cap' : '') + (merged.skipped ? ', ' + merged.skipped + ' skipped (duplicate or already covered)' : '') + '. The profile now holds ' + merged.codes.length + ' templates. Biom ID, wallet, balance, statement, linked accounts and points are untouched.' + esc(neuralNote) + esc(stampNote) + '</div>';
            Snd.chime();
            Snd.speak('Templates added');
          });
        });
      });
    }).catch(function (e) {
      topupBusy = false; palmScanBusy = false;
      $('topCapture').disabled = false;
      $('topMsg').innerHTML = '<div class="error">Add-angles capture failed: ' + esc(e && e.message ? e.message : e) + ' Nothing was changed.</div>';
    });
  }
  /* ---------------- v53 owner re-registration ------------------
     The remedy for the lockout, behind the same style of gate
     as Delete All Data: the offer exists only after a banking-
     guard refusal inside a recovery-launched capture; the
     confirmation panel names the profile, states the stored
     bank's size, and the owner must type REPLACE before the
     distinct confirm button enables. The capture itself is
     enrolment-grade and guided: two bursts — natural distance,
     then a little farther back — and the new bank is built
     from the COMPLETE frames of both (the frame rule applies
     to banking here: a re-registration founded on cropped
     frames would rebuild the same failure). The bank build
     mirrors enrolment exactly (pose-diverse packed candidates,
     PalmNet bank from the same frames, consensus hand stamp)
     and replaces ONLY this profile's palmProfile — the save
     writes back the same person record with that one field
     changed, so Biom ID, wallet, balance, statement, linked
     accounts, limits and points are byte-identical. The event
     is logged with the old bank's template counts. */
  function openReregConfirm() {
    if (!reregPerson) return;
    DB.all('people').then(function (people) {
      var fresh = people.find(function (p) { return p.id === reregPerson.id; }) || reregPerson;
      reregPerson = fresh;
      var edcc = fresh.palmProfile && Array.isArray(fresh.palmProfile.codes) ? fresh.palmProfile.codes.length : 0;
      var neural = (B.palmnetProfileEmbeddings(fresh.palmProfile) || []).length;
      $('topReregCounts').textContent = 'Profile: ' + fresh.name + ' (' + fresh.id + '). Its stored palm bank — ' +
        edcc + ' EDCC template' + (edcc === 1 ? '' : 's') + (neural ? ' and ' + neural + ' PalmNet embedding' + (neural === 1 ? '' : 's') : '') +
        ' — will be replaced by the new capture. The Biom ID, wallet, balance, statement, linked accounts, limits and loyalty points do not change.';
      $('topRereg').classList.remove('hidden');
      $('topReregInput').value = '';
      $('topReregConfirm').disabled = true;
      $('topRereg').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  function reregFail(html) {
    topupBusy = false; palmScanBusy = false;
    $('topCapture').disabled = false;
    $('topMsg').innerHTML = html;
    Snd.buzz();
  }
  function runReRegistration() {
    if (!reregPerson || recoveryPersonId !== reregPerson.id) return;
    var personId = reregPerson.id;
    $('topRereg').classList.add('hidden');
    DB.all('people').then(function (people) {
      var person = people.find(function (p) { return p.id === personId; });
      if (!person) { reregFail('<div class="error">That person is no longer in the registry — nothing was changed.</div>'); return; }
      topupBusy = true; palmScanBusy = true;
      $('topCapture').disabled = true;
      var control = { cancelled: false };
      topupControl = control;
      var swap = function () {
        camFacing.topup = camFacing.topup === 'user' ? 'environment' : 'user';
        syncCamToggle('topup');
        return Cam.start($('topVideo'), camFacing.topup, 'topup');
      };
      function burstError(res, stepName) {
        if (res.stopped) return 'Capture stopped — nothing was changed.';
        if (res.spoof && res.spoof.spoof) {
          DB.put('logs', { ts: Date.now(), personId: '', personName: '(re-registration attempt)', store: '', method: 'palm', measured: 'Spoof score ' + res.spoof.score.toFixed(2) + ' - ' + res.spoof.reasons.join('; '), result: 'Spoof / Screen Replay Detected' });
          return 'Spoof / Screen Replay Detected — the ' + stepName + ' capture showed a screen or a recording, not a live hand (' + res.spoof.reasons.join('; ') + '). Nothing was changed.';
        }
        if (!res.burst) return 'No capture burst ran in the ' + stepName + ' step' + (res.hint ? ' (' + res.hint + ')' : '') + ' — nothing was changed. Run the re-registration again.';
        if (!res.burst.liveness.pass) return 'Liveness check failed in the ' + stepName + ' step: ' + res.burst.liveness.reason + ' Nothing was changed.';
        return null;
      }
      $('topMsg').innerHTML = '<div class="notice">Re-registration step 1 of 2 — hold your palm flat, facing the camera, at your natural distance. The capture runs by itself when a sharp open palm is seen.</div>';
      streamEnrolPalm($('topVideo'), $('topStatus'), null, swap, control).then(function (res1) {
        var e1 = burstError(res1, 'first');
        if (e1) { reregFail('<div class="error">' + esc(e1) + '</div>'); return; }
        $('topMsg').innerHTML = '<div class="notice">Re-registration step 2 of 2 — now move your palm a little farther back and hold it there, still open and facing the camera.</div>';
        return streamEnrolPalm($('topVideo'), $('topStatus'), null, swap, control).then(function (res2) {
          var e2 = burstError(res2, 'second');
          if (e2) { reregFail('<div class="error">' + esc(e2) + '</div>'); return; }
          bankReRegistration(person, res1, res2);
        });
      }).catch(function (e) {
        reregFail('<div class="error">Re-registration capture failed: ' + esc(e && e.message ? e.message : e) + ' Nothing was changed.</div>');
      });
    });
  }
  function bankReRegistration(person, res1, res2) {
    var results = (res1.results || []).concat(res2.results || []);
    // Only complete frames bank: the whole point of the remedy
    // is a bank founded on whole palms at honest distances.
    var complete = results.filter(function (r) { return r.frameComplete === true; });
    var cand = B.palmprintPackedCandidates(complete);
    if (!cand.list.length) {
      reregFail('<div class="error">No complete-palm templates could be banked from those captures — every usable frame was cropped or too close. Nothing was changed. Move back so your whole palm fits the frame and run the re-registration again.</div>');
      return;
    }
    var kept = cand.list.slice(0, B.PALMPRINT_PROFILE_MAX_CODES);
    var codes = kept.map(function (c) { return c.b64; });
    var poses = kept.map(function (c) { return c.desc; });
    var hand = B.palmConsensusHand(complete.map(function (r) { return r.hand; }));
    var oldEdcc = person.palmProfile && Array.isArray(person.palmProfile.codes) ? person.palmProfile.codes.length : 0;
    var oldNeural = (B.palmnetProfileEmbeddings(person.palmProfile) || []).length;
    PalmNet.embedRois(neuralCandidateRois(complete)).then(function (embs) {
      var good = (embs || []).filter(function (e) { return !!e; });
      var bank = good.length ? B.palmnetBankFromEmbeddings(good) : null;
      var profile = { v: 4, format: B.PALMPRINT_FORMAT, codes: codes, hand: hand };
      if (poses.some(function (d) { return !!d; })) profile.poses = poses;
      if (bank) profile.neural = bank;
      if (person.palmProfile && person.palmProfile.legacyCodes) profile.legacyCodes = person.palmProfile.legacyCodes;
      var updated = Object.assign({}, person, { palmProfile: profile });
      return DB.put('people', updated).then(function () {
        return DB.put('logs', { ts: Date.now(), personId: person.id, personName: person.name, store: '', method: 'palm',
          measured: 'Owner re-registration: after the banking guard refused an Add Angles top-up in the wallet recovery path, the owner confirmed (typed REPLACE) replacement of this profile\'s palm bank. Old bank: ' + oldEdcc + ' EDCC template(s), ' + oldNeural + ' PalmNet embedding(s). New bank: ' + codes.length + ' EDCC template(s), ' + (bank ? bank.embeddings.length : 0) + ' PalmNet embedding(s), hand recorded: ' + (hand || 'not determined') + '. Biom ID, wallet, balance, statement, linked accounts, limits and points unchanged.',
          result: 'Owner Re-registration' });
      }).then(function () {
        recoveryPersonId = null;
        reregPerson = null;
        topupBusy = false; palmScanBusy = false;
        $('topCapture').disabled = false;
        $('topMsg').innerHTML = '<div class="success">Palm re-registered for ' + esc(person.name) + ': ' + codes.length + ' new template' + (codes.length === 1 ? '' : 's') + ' banked from two guided captures (natural distance, then a little farther back)' +
          (bank ? ', with ' + bank.embeddings.length + ' PalmNet embedding' + (bank.embeddings.length === 1 ? '' : 's') : ' (PalmNet embeddings were not banked — the Registry will offer a Neural Scan)') +
          (hand ? '. ' + (hand === 'left' ? 'Left' : 'Right') + ' palm recorded — the other hand will not match this profile.' : '. The hand could not be determined from these captures.') +
          ' Biom ID, wallet, balance, statement, linked accounts, limits and points are untouched. Go to My Wallet and open it with this palm.</div>';
        Snd.chime();
        Snd.speak('Palm re-registered');
      });
    }).catch(function (e) {
      reregFail('<div class="error">Re-registration could not be saved: ' + esc(e && e.message ? e.message : e) + ' Nothing was changed.</div>');
    });
  }
  function wireRereg() {
    var panel = $('topRereg'), input = $('topReregInput'),
      confirmBtn = $('topReregConfirm'), cancelBtn = $('topReregCancel');
    if (!panel || !input || !confirmBtn || !cancelBtn) return;
    input.addEventListener('input', function () {
      confirmBtn.disabled = input.value.trim() !== 'REPLACE';
    });
    cancelBtn.addEventListener('click', function () {
      panel.classList.add('hidden');
      input.value = '';
      confirmBtn.disabled = true;
    });
    confirmBtn.addEventListener('click', function () {
      if (input.value.trim() !== 'REPLACE') return;
      confirmBtn.disabled = true;
      runReRegistration();
    });
  }
  wireRereg();

  $('topStart').addEventListener('click', function () { startTopupCamera(); });
  $('topCapture').addEventListener('click', runTopupCapture);
  $('topBack').addEventListener('click', function () { recoveryPersonId = null; reregPerson = null; if ($('topRereg')) $('topRereg').classList.add('hidden'); go('registry'); });
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
  if ($('fieldExhaustiveToggle')) $('fieldExhaustiveToggle').addEventListener('change', function () { setFieldExhaustive(this.checked); toast(this.checked ? 'Exhaustive shift logging ON — every scan evaluates all five shifts and logs them.' : 'Exhaustive shift logging OFF.'); });
  if ($('fieldExhaustiveToggle2')) $('fieldExhaustiveToggle2').addEventListener('change', function () { setFieldExhaustive(this.checked); toast(this.checked ? 'Exhaustive shift logging ON — every scan evaluates all five shifts and logs them.' : 'Exhaustive shift logging OFF.'); });
  setFieldExhaustive(fieldExhaustiveOn());

  /* ---------------- Delete All Data (v46) -------------------------------
     The device owner's own erase, ordered by the Chairman
     (2026-11-23 21:40) so he can clear an old registry and
     re-register cleanly. Deliberate by construction: the button
     only OPENS the confirmation; the wipe runs only after the
     owner types DELETE and taps the distinct "Delete everything"
     button. The counts in the confirmation come from the live
     store, so what will be deleted is stated, not implied. On
     completion both backends are empty (DB.clearAll), the data
     version stamps are set to the current version (the post-wipe
     store is a valid empty store AT this version, so no migration
     runs against it), a plain confirmation is shown, and the app
     reloads into its clean first-run state. */
  function loadSnapshot() {
    return Promise.all(B.BIOM_DATA_STORES.map(function (s) { return DB.all(s); })).then(function (rows) {
      var snap = {};
      B.BIOM_DATA_STORES.forEach(function (s, i) { snap[s] = rows[i]; });
      return snap;
    });
  }
  function wireWipeData() {
    var btn = $('wipeDataBtn');
    if (!btn) return;
    var panel = $('wipeConfirm'), input = $('wipeConfirmInput'),
      confirmBtn = $('wipeConfirmBtn'), cancelBtn = $('wipeCancelBtn'), msg = $('wipeMsg');
    function closePanel() {
      panel.classList.add('hidden');
      btn.disabled = false;
      input.value = '';
      confirmBtn.disabled = true;
    }
    btn.addEventListener('click', function () {
      msg.innerHTML = '';
      loadSnapshot().then(function (snap) {
        var removed = B.wipeBiomData(snap).removed;
        $('wipeCounts').textContent = 'Currently stored on this device: ' +
          removed.people + (removed.people === 1 ? ' registered person' : ' registered people') +
          ' (with their palm templates, wallets, balances, statements and linked accounts), ' +
          removed.transactions + (removed.transactions === 1 ? ' transaction' : ' transactions') + ' and ' +
          removed.logs + (removed.logs === 1 ? ' log entry' : ' log entries') + '.';
        panel.classList.remove('hidden');
        btn.disabled = true;
        input.value = '';
        confirmBtn.disabled = true;
        input.focus();
      });
    });
    input.addEventListener('input', function () {
      confirmBtn.disabled = input.value.trim() !== 'DELETE';
    });
    cancelBtn.addEventListener('click', closePanel);
    confirmBtn.addEventListener('click', function () {
      if (input.value.trim() !== 'DELETE') return;
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      loadSnapshot().then(function (snap) {
        var wiped = B.wipeBiomData(snap);
        return DB.clearAll().then(function () { return wiped; });
      }).then(function (wiped) {
        try { localStorage.setItem(DV_KEY, APP_DATA_VERSION); } catch (e) {}
        try { localStorage.setItem(DBV_KEY, APP_DATA_VERSION); } catch (e) {}
        closePanel();
        cancelBtn.disabled = false;
        msg.innerHTML = '<div class="success">All data deleted — ' + wiped.removedTotal +
          (wiped.removedTotal === 1 ? ' stored record' : ' stored records') +
          ' removed. This device now holds an empty registry. Reloading…</div>';
        toast('All data deleted. The app is empty.');
        setTimeout(function () { location.reload(); }, 1500);
      }).catch(function () {
        msg.innerHTML = '<div class="error">Delete failed — nothing was erased. Your data is unchanged; please try again.</div>';
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
      });
    });
  }
  wireWipeData();

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
