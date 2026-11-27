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
     readers fail closed per record.

     v56 adds the Scan Sync (the Chairman's order 2026-11-24
     22:20): a DEFAULT-OFF, owner-configured mirror of scan
     records and encoded palm banks to his own TSG Biom API.
     It is not a data-shape change — sync preferences are
     localStorage prefs and the outbox is one 'syncOutbox' meta
     row — so the v56 migration step is a pure adoption like
     the others, and with sync off the app is v55 exactly.

     v57 (2026-11-25) is a camera-layer release: the Front/Back
     switch no longer blanks the preview (the outgoing stream
     is released only once its replacement is live), a switch
     asks for the new facing as a preference first, the
     in-flight-start join is facing-aware, the scan loops
     accept a replaced stream's restarted clock, the preview
     mirror follows the attached track's own facing, and the
     "too dark" guidance stops naming Flash on the front
     camera, where the torch cannot light. No data-shape
     change — the v57 migration step is a pure adoption.

     v58 (2026-11-25) is the MANUAL SCAN release (the
     Chairman's order): scanning never starts by itself.
     Entering any scan view — wallet scan card, terminal,
     enrolment palm step, Add Angles top-up — opens the camera
     preview and arms the view; analysis, verdicts and scan
     records begin only when the Scan button is tapped, and
     after a verdict the view re-arms instead of re-scanning.
     The pipelines behind the tap are unchanged. No data-shape
     change — the v58 migration step is a pure adoption.

     v59 (2026-11-25) is the Phase A step-0 truth pass (team
     plan, step 0): copy stops calling the palm templates
     "encrypted" — they are encoded palm codes, never a palm
     image, and encryption arrives in the security release;
     the Delete All Data copy states plainly that a device
     wipe does not erase copies already synced to the server;
     Palm Loyalty payment points are credited only AFTER a
     payment actually resolves (the 5-point visit award is
     unchanged); the enrolment Done buttons and the service-
     worker registration lose their inline handlers/scripts
     (CSP prerequisite); and the committed www/ staging is
     regenerated from these sources with a drift check, so
     no stale copy of the app remains. No data-shape change
     — the v59 migration step is a pure adoption.

     v60 (2026-11-25) removes the palm scan from WALLET ENTRY
     (the Chairman's direct order: "entering our own wallet
     no need scan"). The wallet belongs to a profile on this
     device: with exactly one enrolled profile it opens
     straight to that wallet's home; with several, a plain
     tap-to-choose picker (name, Biom ID, hand) opens the
     tapped wallet — a picker, not a security gate, and no
     scan, verdict or scan record happens at entry. With no
     enrolled profile the wallet page points at enrolment,
     as before. The v53 owner-recovery entries that used to
     hang off wallet-open scan failures (Strengthen my palm,
     Neural Scan, the confirmed re-registration) move to
     My Account → Palm Identity, routing to the same guarded
     top-up flows with the same grants. Every money
     authorisation — Add Money, Send Money sender auth,
     terminal Biom Pay — keeps its palm scan, strict rule
     and all, exactly as before; quick verify stays an
     explicit scan. No data-shape change — the v60
     migration step is a pure adoption.

     v61 (2026-11-25) is Phase B item B1, shipping ALONE:
     envelope encryption of the stored palm templates
     (Seat 2's spec, seam corrected by Seat 3, boundary per
     coordinator decision CD-2). Every stored template
     string — packed EDCC codes, PalmNet embeddings and the
     archived legacy codes — is wrapped in an AES-GCM
     envelope (enc.v1.<kid>.<nonce||ciphertext||tag>) under
     a per-Biom-ID key derived (HKDF) from this device's
     vault key, so the store, the sync records and the
     server's data repo hold ciphertext, not readable palm
     templates. The envelope lives at the storage boundary
     (the DB funnel below): banks are decrypted as they load
     and encrypted as they save and as sync emits them, so
     the synchronous matchers, the banking guard, the strict
     money rule and the worker read exactly the plaintext
     they always read — the bytes reaching both matchers are
     bit-identical to v60, which the parity gate in
     tests/v61-b1.test.js proves with EXACT score equality
     (not tolerance). Existing banks convert in the first
     v61 boot (Vault.convertBanks over B.convertBanksV61)
     and are re-pushed so the server copies become
     ciphertext too; the vault card (More → Biom Vault)
     reports how many converted and shows each bank's state.
     Fail-safe throughout: if WebCrypto or the vault key is
     unavailable, banks stay in their encoded form and keep
     working — nothing is ever bricked by a crypto failure.
     CODEC FREEZE: from v61 the template CONTENT is frozen —
     thresholds, model bytes, fusion, the hand gate, the
     frame rule, the guard, the strict rule, flash, quality
     gates, the v57 camera switching, the v58 manual scan
     gating and the v60 wallet entry are all untouched, and
     any future template-content change requires a full
     calibration re-run. The migration step is the identity
     (representation, not shape — see biometrics.js).

     v62 (2026-11-25) is the Phase B SERVER TRUST batch (Seat 2
     Specs B2–B5 + B7, Seat 1's dashboard summary switch and the
     key-UI revision): the sync connection stops trusting a
     single shared key and a last-writer-wins server. This
     device registers its OWN credential with the server (the
     shared key is used once, as a bootstrap, and stays working
     for v61 devices — nobody is bricked mid-rollout), signs its
     writes with a per-device sequence (replay and desync are
     refused server-side), and writes banks compare-and-swap:
     every bank carries the version this device last saw, a
     stale write is refused with a 409 instead of silently
     overwriting a newer bank, and ownership is stamped by the
     server. Delete All Data becomes true for the whole system:
     the wipe queues a tombstone for every synced bank and the
     server drops the templates; other devices pull the
     tombstone and remove their copy. The server adds its fraud
     penalty regime (auth lockouts, rate limits, denied-payment
     velocity holds, revocation as a blacklist) and this app
     surfaces those states honestly in the sync status line.
     The profile shape gains the additive walletLink field
     (shape only — no linking ceremony, no bKash calls), and
     the copy that promised a PIN confirmation flow stops
     promising it: the Chairman deferred the PIN fallback
     (2026-11-25), so above-limit payments are simply refused,
     and the copy now says exactly that. Matching is untouched:
     thresholds 0.32 / 0.5895, the model, fusion, the hand
     gate, the frame rule, the banking guard, the strict money
     rule and its three sites, flash, the v57 camera switching,
     the v58 manual gating, the v60 wallet entry and the v61
     envelope + CODEC FREEZE all stand exactly as they were.
     The migration step is the identity (see biometrics.js).

     v63 (2026-11-25) is the TWO-FACE release (the Chairman's
     order, 2026-11-25 10:36 + the 10:47 scope additions; Seat 1
     front-end design, Seat 2 sync/bootstrap). One app, two
     faces. The CUSTOMER face is the default: entry resolves
     exactly as v60 (one profile straight to its wallet home,
     several tap-to-choose, none to registration), and a
     customer session sees only the wallet home, the money
     flows, their own activity and a light My Account — the
     Desk, Registry, terminal/store modes, global logs,
     partner integration, Field Test Mode, Biom Vault, Scan
     Sync settings and Delete All Data are not rendered and
     not reachable (their DOM is detached at boot and the
     navigation gate refuses their pages). The OWNER face is
     everything the app has today, opened by a discreet unlock
     (five taps on the My Account version line, or a long-press
     on the app logo): a manual-gated palm scan at plain verify
     bars whose match must carry the new profile owner flag
     (person.owner === true). If no profile carries the flag,
     the first successful match CLAIMS it (first claim wins,
     written to Logs); granting or revoking it afterwards
     lives only in owner mode (Registry). Owner mode lasts for
     the session until Lock or app close. Registration is
     presented as the one-time wallet form it is — name, phone
     number, then the palm step — with the owner-only fields
     (person type, home store, wallet linking, limits) hidden
     on the customer face. Send Money runs in the Chairman's
     order: receiver's palm first, then the amount, then the
     sender's own palm authorises. The wallet gains a Biom Pay
     flow: choose a partner store, enter the amount, scan your
     own palm — a fourth strict-money site, added by the
     Chairman's explicit order (2026-11-25 10:47); it creates
     the same BIOM-PAY record, limits and points behaviour as
     the terminal payment it mirrors. Sync is ON by default:
     the endpoint is baked in and the app ships a
     registration-only bootstrap key whose ONLY server power
     is POST /api/devices — the device registers itself, then
     signs with its own credential exactly as v62; the legacy
     shared key is gone from the app entirely. Until the
     server's BOOTSTRAP_KEY env var is set, registration fails
     closed and the queue simply holds (honest status, no
     misleading key-rejected latch, nothing blocked). Matching
     is untouched: thresholds 0.32 / 0.5895, the model, fusion,
     the hand gate, the frame rule, the banking guard, flash,
     the v57 camera switching, the v58 manual gating, the v60
     wallet entry, the v61 envelope + CODEC FREEZE and the v62
     signing/CAS/tombstones/penalty regime all stand exactly
     as they were. The migration step is the identity (see
     biometrics.js).

     v65 (2026-11-25) is the TSG PALM ENGINE release (the
     Chairman's TSG-ONLY property directive, 2026-11-25 12:43;
     head + Seat 3 engine design, Seat 1 integration surface,
     Seat 2 licence/portability record). ONNX Runtime Web is
     REMOVED: the PalmNet model now runs on TwoSide Group's own
     inference engine (createTsgPalmEngine in biometrics.js),
     dedicated to this one network, reading the model from
     TSG's own TSGP container (program.json + weights parts).
     The container is a byte-exact repack of the same Round 3
     weights (per-tensor max diff 0.0) and the engine passed
     the parity gate against both ONNX Runtime references on
     the full bench EVAL protocol — 720 ROIs, 360 genuine +
     42,840 impostor scores, max embedding diff 1.3e-6, zero
     verdict differences at the 0.5895 bar — so the bar, the
     fusion, and every banked embedding stand exactly as they
     were; the embedding byte format is unchanged and NO
     migration beyond the identity step exists. Engine failure
     fails soft to EDCC-only with the reason stated, exactly
     as the old runtime's failures did. MediaPipe Hands still
     provides hand detection in this release (self-hosted,
     as v64 arranged); its TSG replacement is Stage 2 of the
     same programme and this build does not claim otherwise.
     The migration step is the identity (see biometrics.js).

     v66 (2026-11-25) is the DESIGN OVERHAUL release (House
     System v2; team record V66-DESIGN-RESEARCH-2026-11-25.md):
     presentation only. One blue token system replaces the
     teal/blue split, the shell adapts per form (bottom tab bar
     under 1024px, a 248px sidebar at or above it), wallet home
     gains a two-pane desktop composition, Activity becomes
     list–detail on desktop, the money flows present as centred
     sheets on desktop, enrolment splits on desktop, and the
     owner face runs at compact density. No flow, step order,
     bar, model pin, guard, strict-money site, encryption,
     signing or copy truth changes. The migration step is the
     identity (see biometrics.js).

     v67 (2026-11-26) is the PROTOTYPE release (the Chairman's
     approved design set, v67-mobile-design): the app opens on
     a role choice — Customer or Merchant. The customer face
     becomes registration-first, then a wallet home with
     exactly three actions (Add Money, Send Money, Payment —
     the existing flows untouched), an Inbox tab fed ONLY by
     real money events (add / send / payment / received,
     written on the success paths and nowhere else, persisted
     per profile in the meta store with unread state), and a
     Settings tab (switch account, create another account,
     use as Merchant, log out to the role choice). The
     merchant face lands on the terminal scanner and gains a
     Balance tab whose receipts and running balance are
     computed from the real BIOM-PAY records. The owner face
     and the whole live system stay intact behind the v63
     gates — the prototype simplifies the front, it deletes
     nothing. Scan speed programme for the Chairman's
     2-second bar: a deep pre-warm at boot (a second landmarks
     pass for the tracking branch and one dummy PalmNet
     embedding, both on dummy inputs, nothing recorded) and
     the two impostor maxima in the verify verdict now run
     concurrently — the same values, the same v49 judgement,
     computed in parallel instead of in sequence. No bar,
     model pin, guard, strict-money site, encryption,
     signing, sync or copy truth changes. The migration step
     is the identity (see biometrics.js).

     v68 (2026-11-26) is the DETECTOR DELIVERY release: the five
     MediaPipe binary runtime files could not travel through
     the text-only channel that ships this app, so on the live
     host they answered 404 and the hand detector could never
     run — every real scan ended at the v67 honest detector
     message (the Chairman's screenshot, 2026-11-26 05:11).
     The binaries now travel the way the PalmNet weights
     already do: base64 text parts under vendor/.../parts/,
     reassembled and SHA-256-verified in the browser against
     pins held in code (MpRuntime, below), and handed to
     MediaPipe as Blob URLs through locateFile — everything
     served from this origin, no CDN, no third-party hotlink.
     PalmProc construction now waits on that assembly; the
     v67 detector-health behaviour is unchanged (per-call
     health, honest end-state at three consecutive failures,
     no camera ever switches itself, a still-loading instance
     is never torn down). One CSP word changes, recorded
     plainly: connect-src gains blob: — the runtime fetches
     its files from the assembled Blob URLs, and Chromium
     refuses blob: fetches without it (proven in the v68
     rig). blob: names no network endpoint and its URLs are
     minted only by this origin's own scripts; the policy
     already carries blob: for worker-src, img-src and
     media-src, and the M-7 API endpoint pin is unchanged.
     No bar, model pin, guard, strict-money site,
     encryption, signing, sync or copy truth changes. The
     migration step is the identity (see biometrics.js).

     v69 (2026-11-26) carries two Chairman orders from his
     first live v68 scan session. (1) DELETE MY DATA in the
     customer Settings: one customer deletes THEIR OWN profile
     — palm bank and wallet — from this device, through the
     existing v62 tombstone machinery (tombstones queued and
     flushed BEFORE any local erase, exactly the Delete All
     Data order of operations, scoped to one person), behind
     the same typed-DELETE confirmation strength as the
     owner's wipe; other profiles on the device are untouched.
     (2) SCAN-VERDICT FRICTION fixes in the wallet money
     authorisation, from his report of one session cycling
     "unauthorised" → "antispoof" → "no hand" → recognised:
     the anti-spoof tracker is now fed ONLY by frames where a
     hand was actually read (a handless frame's whole-frame
     bezel/glare evidence could previously convict a scan —
     two such frames outranked everything else); detector
     failure is judged FIRST in the verify loop, before the
     spoof and liveness exits, so a detector that cannot run
     can no longer be overwritten by a later, less accurate
     state; detector-failed frames no longer burn the scan's
     frame cap; the static-liveness exit counts hand poses,
     not analysed frames; every wallet scan failure now names
     its cause's own next step (SCAN-GUIDANCE below); and a
     thin bank (B.palmBankThin — enrolled once, never
     strengthened) is offered the existing Strengthen flow
     from the failure sheet and once after enrolment. No bar,
     model pin, guard, strict-money rule, encryption,
     signing, sync or copy truth changes — the frozen rules
     are untouched; only the evidence the verdicts are
     allowed to rest on, and the order they are judged in,
     changed. The migration step is the identity (see
     biometrics.js).

     v74 (2026-11-26) is the ON-SCREEN SCAN TIMER release
     (Chairman's order, 2026-11-26: "add a timer so that I
     can understand how much time needed for the system to
     scan or detect registered palm or how much time needed
     for a registration"). Every scan surface — the wallet
     scan card (Add Money, Send Money identification and
     authorisation, Wallet Pay, quick verify, owner unlock),
     the merchant terminal, enrolment palm capture and the
     Add Angles / Strengthen capture — carries a live elapsed
     readout inside its scan pill: it starts on the scan tap
     (the v58 manual-scan moment analysis actually begins),
     ticks in tenths off performance.now(), and freezes at
     the verdict with the total stated ("Scanned in 1.8s" /
     "Captured in 1.8s"); where a success closes the wallet
     scan card, the same measured time rides the success
     message the flow already shows. The timer is display
     only — it reads no frame, touches no verdict and adds
     one textContent write per 100 ms tick outside the scan
     loop. No bar, model pin, guard, strict-money rule,
     encryption, signing, sync or copy truth changes. The
     migration step is a pure adoption (see biometrics.js).
     Scope extension (Chairman, 2026-11-26 19:40): the same
     measured duration is stamped on every scan's sync record
     (all kinds, via the sync engine's optional scanDurationMs
     dep and B.syncScanRecord's additive field) and shown on
     the dashboard — Scan Log Duration column, scans over the
     2.0 s bar flagged, and the person detail carrying the
     registration record (the profile record now also carries
     the person's phone, additively) plus their scan history
     with durations. A scan with no timer reading rides
     unmeasured — never estimated.

     v75 (2026-11-26) is the FLASH-FIX release (Chairman's
     reports the same evening: the old design still flashes
     under v74, repeatedly, and the boot splash itself can
     stick). The boot splash is now HELD until the boot chain
     has rendered the first coherent screen — v71 dropped it
     at app.js parse, so the un-routed static document (the
     wallet-locked page and skeleton cards) painted for the
     whole boot on every load, and update reloads repeated
     the paint. A 6 s watchdog guarantees the splash can
     never stick; the service worker times its shell fetch
     (3.5 s) and falls back to its cache, so app.js always
     arrives; the shell assets are version-stamped in
     index.html (?b=v75) so a document can never pull another
     build's assets out of the HTTP cache; the coherence
     reload and the service-worker update delivery now spend
     ONE shared boot-reload guard; and SW registration uses
     updateViaCache 'none'. No bar, model pin, guard,
     strict-money rule, encryption, signing, sync or copy
     truth changes. The migration step is a pure adoption
     (see biometrics.js). */
  var APP_DATA_VERSION = 'v79';
  /* ---------------- boot splash lifecycle (v71, rebuilt v75) ------
     index.html stamps its build in <meta name="biom-build"> and
     paints a neutral boot splash before any app code runs.

     v75 rebuild, from the Chairman's two reports of 2026-11-26
     (the old design still flashing under v74, and the splash
     itself sometimes sticking): the v71 lifecycle removed the
     splash HERE, at app.js parse — but nothing of the app has
     rendered at parse time. The static document underneath
     (top bar, full nav, the wallet-locked page with skeleton
     cards) then painted for the WHOLE boot chain — IndexedDB,
     vault, migration, first renders and the network sync that
     precede face/role routing — on every load, and the update
     reloads repeated that paint two or three times on upgrade
     loads. That un-routed shell is the "old design" flash.

     The v75 lifecycle:
     (1) The splash is HELD until the boot chain completes —
         dropBootSplash is called at the end of the boot chain
         (and on its error path), when the first coherent screen
         has actually rendered. Every reload in between repaints
         the splash, never a design.
     (2) A watchdog armed below, before anything that can stall,
         force-drops the splash after SPLASH_MAX_MS no matter
         what: if app.js is running at all, the splash can never
         stick. The delivery layer has its own bound (the
         service worker times its shell fetch and falls back to
         cache), so app.js itself always arrives.
     (3) Coherence: if the document that painted and the app.js
         that is running disagree about the build, the app does
         not run: the splash stays up and ONE cache-bypassing
         reload is forced through the boot-reload guard shared
         with the service-worker update delivery (bootReloadSpent,
         keyed by the newest build involved), so the two
         mechanisms can never stack into a second reload for the
         same upgrade; if the guard is already spent, the app
         runs rather than brick the device.
     SPLASH_MAX_MS = 6000: the rig measures boot-to-routed at
     ~2 s on a fast local network; a mid-range phone doing real
     API sync is allowed three times that. Beyond it the user
     gains nothing by waiting — the app underneath is already
     usable — while a splash that outlives it reads as a dead
     app. */
  var SPLASH_MAX_MS = 6000;
  var bootSplashEl = document.getElementById('bootSplash');
  function dropBootSplash() {
    if (bootSplashEl && bootSplashEl.parentNode) bootSplashEl.parentNode.removeChild(bootSplashEl);
    bootSplashEl = null;
    schedulePipelinePrewarm(); // v77: first screen is up — warm the pipeline on idle time
  }
  setTimeout(function () { dropBootSplash(); }, SPLASH_MAX_MS);
  /* v77: search boxes re-render a full list from IndexedDB on
     every keystroke — a guaranteed jank generator on a large
     registry. Debouncing collapses a typing burst into one
     render at the end of the burst; the render itself is
     unchanged. */
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var self = this, args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
    };
  }
  /* v77 (performance pass): every network wait in this app gets a
     bound. An unbounded fetch on a stalled connection is a hang
     the user cannot escape (the stuck-splash lesson, applied to
     every layer): sync, the payments rail, the model loaders and
     the build-coherence probe all ride this helper. Aborting a
     sync request mid-flight is safe — the sync engine's sequence
     discipline already treats a failed send as unsent and the
     server's SEQ_DESYNC recovery covers the rare case where the
     server consumed a sequence the client never saw confirmed. */
  function fetchWithTimeout(url, opts, ms) {
    if (typeof AbortController === 'undefined' || typeof fetch === 'undefined') return fetch(url, opts);
    var ctl = new AbortController();
    var timer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, ms || 20000);
    var o = {};
    if (opts) for (var k in opts) o[k] = opts[k];
    o.signal = ctl.signal;
    return fetch(url, o).then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; });
  }
  /* v77: the detector/model pre-warm (Pipeline.start) no longer
     fires synchronously during init, where its assembly decode
     and WASM load raced the boot chain and produced the long-task
     storm measured on the rig (27 long tasks, 4.5 s of blocking
     in the throttled boot profile). It is scheduled once the
     first coherent screen is up — from dropBootSplash — on idle
     time, and the first real interaction starts it immediately.
     Scan views still call Pipeline.enterScanView() as before, so
     a scan tapped before the idle slot pays the same awaited
     init it always did (PalmProc.ensureHands), never a hang. */
  var pipelinePrewarmScheduled = false;
  function schedulePipelinePrewarm() {
    if (pipelinePrewarmScheduled) return;
    pipelinePrewarmScheduled = true;
    var run = function () { try { Pipeline.start(); } catch (e) {} };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2500 });
    else setTimeout(run, 1200);
    var kick = function () {
      window.removeEventListener('pointerdown', kick, true);
      window.removeEventListener('keydown', kick, true);
      run();
    };
    window.addEventListener('pointerdown', kick, true);
    window.addEventListener('keydown', kick, true);
  }
  function newestBuild(a, b) {
    if (!a) return b;
    if (!b) return a;
    return parseInt(a.slice(1), 10) >= parseInt(b.slice(1), 10) ? a : b;
  }
  function bootReloadSpent(targetBuild) {
    /* The ONE boot-reload guard (v75). Returns true when a boot
       reload for this target build has already been spent this
       session (or storage is unavailable — never reload blind).
       Shared by the coherence reload below and the service-
       worker update delivery, so an upgrade costs at most one
       boot reload per session. EVERY caller passes the CANONICAL
       key — the newest build involved in the upgrade
       (bootReloadKey, extended by the incoming SW build in the
       update delivery) — never a raw single stamp: keying one
       path by the old document stamp and another by the new
       build would spend two different keys for one upgrade and
       stack two reloads (Seat 1, v75 review). */
    var key = 'biomBootReload:' + targetBuild;
    try {
      if (sessionStorage.getItem(key)) return true;
      sessionStorage.setItem(key, '1');
      return false;
    } catch (e) { return true; }
  }
  var buildMetaEl = document.querySelector('meta[name="biom-build"]');
  var buildStamp = buildMetaEl ? buildMetaEl.getAttribute('content') : null;
  /* The canonical boot-reload key for this page: the newest
     build involved — the document's stamp or the running app,
     whichever is newer. Both reload mechanisms spend THIS key
     (the update delivery may extend it with the incoming SW
     build), so one upgrade can never spend twice. */
  var bootReloadKey = newestBuild(buildStamp, APP_DATA_VERSION);
  if (buildStamp && buildStamp !== APP_DATA_VERSION) {
    if (!bootReloadSpent(bootReloadKey)) {
      var cohSearch = location.search ? '&' + location.search.replace(/^\?/, '') : '';
      location.replace(location.pathname + '?_coh=' + Date.now() + cohSearch + location.hash);
      return;
    }
  }
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
      /* v73 (Seat 1 F3): the version stamp advances ONLY when
         every changed store's write-back actually landed —
         mirroring the IDB path (migrateDbStores stamps only
         after its writes resolve). Before v73 a swallowed
         setItem failure (e.g. quota) still stamped, so that
         store's conversion was silently skipped forever. */
      var lsWriteOk = true;
      lsMig.changedStores.forEach(function (s) {
        // 'logs' rows are plain array entries in the localStorage
        // form, so a changed logs array writes back like any store.
        try { localStorage.setItem('tsgbiom_' + s, JSON.stringify(lsMig.snapshot[s])); } catch (e) { lsWriteOk = false; }
      });
      dataMigratedFrom = storedDv;
      if (lsWriteOk) { try { localStorage.setItem(DV_KEY, APP_DATA_VERSION); } catch (e) {} }
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
    /* v61 (B1): the people store crosses the vault boundary
       here — the ONE funnel every people read/write in the app
       passes through, on both backends. put() seals a COPY of
       the row (the caller's in-memory person stays plaintext);
       all() opens the rows it returns. Both are pass-through
       when no vault key is available (fail-safe: the encoded
       form keeps working) and for every other store. The raw
       pair below keeps the exact v49-bounded bodies; the vault
       conversion pass uses them directly, because it must see
       the at-rest form the funnel exists to hide. */
    put: function (store, value) {
      var self = this;
      if (store !== 'people') return self._putRaw(store, value);
      return vaultEncryptRow(value).then(function (sealed) { return self._putRaw(store, sealed); });
    },
    all: function (store) {
      var self = this;
      if (store !== 'people') return self._allRaw(store);
      return self._allRaw(store).then(function (rows) { return vaultDecryptRows(rows); });
    },
    _putRaw: function (store, value) {
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
    _allRaw: function (store) {
      var self = this;
      if (this.useLS || !this.db) return Promise.resolve(this.lsGet(store));
      return B.withTimeout(new Promise(function (resolve, reject) {
        var req = self.db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      }), DB_OP_TIMEOUT_MS);
    },
    /* v62: remove ONE row by key (people/logs/transactions by
       id, meta by key) on whichever backend is live, under the
       same timeout discipline as put. Used by the sync pull:
       when the server says a bank was tombstoned on another
       device, this device removes its copy of that person.
       Removal is by key only — the row is never read, so a
       sealed bank needs no vault key to be removed. */
    remove: function (store, id) {
      var self = this;
      if (this.useLS || !this.db) {
        var rows = this.lsGet(store).filter(function (r) {
          return store === 'meta' ? r.key !== id : r.id !== id;
        });
        this.lsSet(store, rows);
        return Promise.resolve();
      }
      return B.withTimeout(new Promise(function (resolve, reject) {
        var tx = self.db.transaction(store, 'readwrite');
        var req = tx.objectStore(store).delete(id);
        req.onsuccess = function () { resolve(); };
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

  /* ---------------- Scan Sync (v56) ----------------------------------
     The Chairman's order 2026-11-24 22:20: "make a connection to
     u whenever i scan palm it will be seen by u" — every scan on
     this device becomes visible on his own TSG Biom API (his
     Vercel, TSG's code, a private data repo behind it), so real
     palms and real results can be reviewed off-device.

     Design rules, all pinned by tests/v56-sync.test.js:
     - DEFAULT OFF. With sync off or unconfigured there are ZERO
       network calls and ZERO behaviour change — the app is v55
       exactly. noteScan/noteProfile return before touching the
       queue when the gate is closed.
     - Matching never waits on the network: enrol/verify/money
       paths call note* fire-and-forget; the flush runs in the
       background (on boot, debounced after each enqueue, and on
       the Sync now button) and removes an item only on a 2xx.
       A failure leaves the queue intact for the next attempt.
     - A 401 (key rejected) latches: the status line says so and
       no further attempt is made until the settings are saved
       again — no retry storm against a wrong key.
     - Records are built by B.syncScanRecord / B.syncProfileRecord
       from the SAME measured values the Logs entry / Field Test
       record of the event carries, in the same closure that
       writes the log (the v53 card<->log equality discipline).
     - Templates only, never images. The device key lives ONLY
       in the device localStorage prefs below — never in a synced
       record, never in a log.
     - Delete All Data sends NO delete-all record: the outbox is
       a meta row, so DB.clearAll erases it with everything else,
       and wireWipeData also clears the sync prefs and resets
       this engine — a queued record would be wiped unsent
       anyway, so the wipe stays exactly the v46 wipe.

     v62 rewrites the trust side of this engine (Phase B items
     B2–B5 + B7; the queueing discipline above is unchanged and
     still pinned by tests/v56-sync.test.js, whose rig drives
     this factory WITHOUT the new deps — every v62 dep is
     optional and defaults to the v56 behaviour):
     - Per-device credential (B2): when the prefs carry no
       device credential but do carry the shared key, the first
       flush registers this device once (POST /api/devices) and
       stores the returned credential; from then on the shared
       key is never sent again. Devices still on v61 keep using
       the shared key — the server accepts it as a bootstrap
       credential, so the rollout bricks nobody.
     - Signing + replay defence (B4): with a credential and a
       signRequest dep, every write carries x-device-id /
       x-device-seq / x-device-sig (HMAC over the canonical
       request, lib/canonical.js on the server, the SYNC-SIGNER
       block below here). The sequence is committed locally
       only when the server answers past authentication, so a
       lost network request burns nothing; a server desync
       answer triggers ONE automatic re-registration (a fresh
       credential, sequence restarts) before the engine latches
       the honest "needs re-registering" state.
     - Compare-and-swap banks (B3): with the versions deps
       wired, profile and tombstone bodies gain baseVersion at
       SEND time (queued items stay byte-identical to v61) and
       the acknowledged version is stored per Biom ID. A 409
       drops the stale item, adopts the server's version and
       surfaces "Bank changed on another device" — a stale
       device can no longer overwrite a newer bank.
     - Tombstones + pull (B7): queueTombstones (the wipe) posts
       {deleted:true} per bank; pull() reads the summary
       endpoint and applies server tombstones newer than the
       version this device knows, removing the local copy.
       Delete All Data is now true for the whole system — see
       wireWipeData for the exact flow and its honest fallbacks.
     - Server penalties, surfaced honestly: a 403 latches
       "revoked" (the blacklist) — EXCEPT a 403 carrying
       blocked:true (v78), which is an ACCOUNT block, not a
       device revocation: the refused item is dropped, the
       flush continues for everyone else, and a separate
       "blocked" latch engages only for this device's own
       Biom ID (the ownBiomId dep; the pull learns and clears
       it from the person's own summary row too). A 429 backs
       off honouring Retry-After and never latches, and the settings card's
       Test connection button reads /api/devices/me and says in
       plain words what the server answered. */
  /* SYNC-ENGINE-BEGIN — createBiomSync is a pure factory over its
     deps (no DOM, no globals beyond Date/JSON/setTimeout) so the
     test suite can extract and drive it with stub deps. */
  function createBiomSync(deps) {
    var queue = null;        // null until the outbox has loaded
    var loadPromise = null;
    var saveChain = Promise.resolve();
    var flushing = false;
    var keyRejected = false;
    var revoked = false;     // v62: the server has revoked (blacklisted) this device
    var blocked = false;     // v78: the server has blocked this device's OWN account (its Biom ID is blockedBiomId)
    var blockedBiomId = '';
    var seqDesync = false;   // v62: signing sequence out of step and re-registration failed
    var lastSyncTs = 0;
    var lastError = '';
    var flushTimer = null;
    var retryTimer = null;
    var versions = null;     // v62: biomId -> last server-acknowledged bank version
    var versionsPromise = null;
    var bootstrapping = null;
    var tombstonedIds = {};  // v62: biomIds this engine knows are tombstoned server-side
    /* v79: biomId -> true for accounts this device knows are
       blocked — OTHER people's, learned from pull summary rows
       and from blocked flush refusals, persisted through the
       optional loadBlockedIds/saveBlockedIds deps (in-memory
       only when the wiring provides none, the v62 optional-dep
       discipline). The v78 latch above is this device's OWN
       account state; this set is what lets a merchant terminal
       answer a blocked customer's scan with the blocked verdict
       immediately, before any payment is attempted. Server
       truth wins both ways: a pull row without the flag clears
       the entry again (an unblock reaches terminals here). */
    var blockedIds = null;
    var blockedIdsPromise = null;
    function ensureBlockedIds() {
      if (blockedIds !== null) return Promise.resolve(blockedIds);
      if (!deps.loadBlockedIds) { blockedIds = {}; return Promise.resolve(blockedIds); }
      if (!blockedIdsPromise) {
        blockedIdsPromise = Promise.resolve().then(function () { return deps.loadBlockedIds(); })
          .then(function (m) { blockedIds = m && typeof m === 'object' && !Array.isArray(m) ? m : {}; return blockedIds; })
          .catch(function () {
            /* A failed load must not fail the set open for the
               whole session (seat review): this call resolves
               with whatever is held, blockedIds stays null and
               the cached promise is dropped, so the next ensure
               (every flush runs one) retries the persisted set. */
            blockedIdsPromise = null;
            return blockedIds || {};
          });
      }
      return blockedIdsPromise;
    }
    function persistBlockedIds() {
      if (!deps.saveBlockedIds || !blockedIds) return;
      try { deps.saveBlockedIds(JSON.parse(JSON.stringify(blockedIds))); } catch (e) {}
    }
    function learnBlocked(biomId, isNowBlocked) {
      if (!biomId) return;
      ensureBlockedIds().then(function () {
        if (isNowBlocked && blockedIds[biomId] !== true) { blockedIds[biomId] = true; persistBlockedIds(); }
        else if (!isNowBlocked && blockedIds[biomId]) { delete blockedIds[biomId]; persistBlockedIds(); }
      }).catch(function () {});
    }
    function isBlocked(biomId) {
      return !!(blockedIds && biomId && blockedIds[biomId] === true);
    }

    function prefs() { return deps.getPrefs(); }
    function hasCred(p) { return !!(p.deviceKey || (p.deviceId && p.deviceSecret)); }
    function configured() { var p = prefs(); return !!(p.endpoint && hasCred(p)); }
    function active() { var p = prefs(); return !!(p.on && p.endpoint && hasCred(p)); }
    function credentialed(p) { return !!(p.deviceId && p.deviceSecret); }

    function ensureLoaded() {
      if (queue !== null) return Promise.resolve(queue);
      if (!loadPromise) {
        loadPromise = deps.loadOutbox().then(function (items) {
          queue = Array.isArray(items) ? items.slice() : [];
          return queue;
        }).catch(function () { queue = []; return queue; });
      }
      return loadPromise;
    }
    function persist() {
      var snap = queue ? queue.slice() : [];
      saveChain = saveChain.then(function () { return deps.saveOutbox(snap); }).catch(function () {});
      return saveChain;
    }
    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(function () { flushTimer = null; flush(); }, 900);
    }
    function scheduleRetry(seconds) {
      if (retryTimer) return;
      var wait = typeof seconds === 'number' && isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) : 30;
      retryTimer = setTimeout(function () { retryTimer = null; flush(); }, wait * 1000);
    }
    function fillRecord(core, ts) {
      var p = prefs();
      var rec = { id: deps.uuid(), ts: ts, deviceLabel: p.label || '', modelId: deps.modelId, appVersion: deps.appVersion };
      Object.keys(core).forEach(function (k) { rec[k] = core[k]; });
      return rec;
    }
    function noteScan(fields) {
      if (!active()) return false;
      /* v74: stamp the record with the scan's real measured
         duration when the wiring supplies it (the optional
         scanDurationMs dep — rigs without it keep the pre-v74
         record shape, the v62 optional-dep discipline). The
         caller's own durationMs always wins; a scan with no
         timer reading rides unmeasured, never estimated. */
      if (fields && fields.durationMs === undefined && typeof deps.scanDurationMs === 'function') {
        try {
          var measured = deps.scanDurationMs(fields.kind);
          if (typeof measured === 'number' && isFinite(measured) && measured >= 0) {
            fields = Object.assign({}, fields, { durationMs: measured });
          }
        } catch (e) {}
      }
      var core = deps.B.syncScanRecord(fields);
      if (!core) return false;
      var rec = fillRecord(core, fields && typeof fields.ts === 'number' ? fields.ts : deps.now());
      ensureLoaded().then(function () {
        queue.push({ type: 'scan', record: rec });
        persist();
        scheduleFlush();
      });
      return true;
    }
    var profileNoteSeq = 0;
    var profilePushedSeq = {};
    function noteProfile(person) {
      if (!active()) return false;
      var core = deps.B.syncProfileRecord(person, deps.now());
      if (!core) return false;
      /* v61 (B1): the emit boundary seals the bank before it is
         queued, via the optional deps.encryptProfileCore (the
         app wires the vault there; rigs that do not provide it
         get the pre-v61 plaintext core, byte-identical). If
         sealing fails, NOTHING is queued — a mirror update is
         deferred rather than letting a plaintext bank reach the
         server by accident; the next bank change re-emits.
         ORDER: the push stays inside the same ensureLoaded slot
         noteScan uses, so with no sealing dep the queue order is
         exactly the v56 call order. With a dep, sealing starts
         immediately and the push waits for the seal (cross-type
         order can then slip, which carries no server semantics —
         profiles upsert by Biom ID, scans are append-only); the
         per-person sequence guard keeps the LAST call's bank the
         queued one even if an earlier seal resolves late. */
      var mySeq = ++profileNoteSeq;
      var sealing = deps.encryptProfileCore ? deps.encryptProfileCore(core) : null;
      function pushNow(sealedCore) {
        if (!sealedCore) return;
        if ((profilePushedSeq[sealedCore.biomId] || 0) > mySeq) return; // a newer note already queued
        profilePushedSeq[sealedCore.biomId] = mySeq;
        // Only the newest bank per person matters: an older queued
        // upsert for the same Biom ID is replaced, never duplicated.
        queue = queue.filter(function (it) { return !(it.type === 'profile' && it.record.biomId === sealedCore.biomId); });
        queue.push({ type: 'profile', record: sealedCore });
        persist();
        scheduleFlush();
      }
      ensureLoaded().then(function () {
        if (!sealing) { pushNow(core); return; }
        return sealing.then(pushNow);
      }).catch(function () {});
      return true;
    }

    /* ---------- v62: versions, bootstrap, signing ---------- */
    function ensureVersions() {
      if (!deps.loadVersions) return Promise.resolve(null);
      if (versions) return Promise.resolve(versions);
      if (!versionsPromise) {
        versionsPromise = Promise.resolve().then(function () { return deps.loadVersions(); })
          .then(function (v) { versions = v && typeof v === 'object' ? v : {}; return versions; })
          .catch(function () { versions = {}; return versions; });
      }
      return versionsPromise;
    }
    function knownVersion(biomId) {
      return versions && typeof versions[biomId] === 'number' ? versions[biomId] : 0;
    }
    function persistVersions() {
      if (!deps.saveVersions || !versions) return;
      try { deps.saveVersions(JSON.parse(JSON.stringify(versions))); } catch (e) {}
    }
    function readJsonSafe(res) {
      if (!res || typeof res.json !== 'function') return Promise.resolve(null);
      return res.json().catch(function () { return null; });
    }
    /* Register this device once, from the shared key. Resolves
       true when a credential is now held. The wiring's
       saveCredential writes the prefs, so prefs() changes under
       us — callers re-read them. */
    function bootstrap() {
      var p = prefs();
      if (!deps.saveCredential || !p.deviceKey || !p.endpoint) return Promise.resolve(false);
      if (bootstrapping) return bootstrapping;
      var base = String(p.endpoint || '').replace(/\/+$/, '');
      bootstrapping = Promise.resolve().then(function () {
        return deps.fetchFn(base + '/api/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-device-key': p.deviceKey },
          body: JSON.stringify({ label: p.label || '' })
        });
      }).then(function (res) {
        if (!res || res.status < 200 || res.status >= 300) return false;
        return readJsonSafe(res).then(function (j) {
          if (j && j.deviceId && j.deviceKey) {
            deps.saveCredential(j.deviceId, j.deviceKey);
            if (deps.setSeq) deps.setSeq(0);
            seqDesync = false;
            return true;
          }
          return false;
        });
      }).catch(function () { return false; })
        .then(function (ok) { bootstrapping = null; return ok; });
      return bootstrapping;
    }
    /* Build the auth headers for one request. In credentialed
       mode with a signer dep, the request is signed with the
       NEXT sequence; the caller commits that sequence via
       commitSeq only when the server answers past auth, so a
       request the network swallowed burns nothing. GET requests
       pass sign:false — the server does not verify signatures
       on reads, and no sequence is spent on them. */
    function authHeaders(item, bodyObj, sign) {
      var p = prefs();
      if (credentialed(p)) {
        var headers = { 'Content-Type': 'application/json', 'x-device-id': p.deviceId, 'x-device-key': p.deviceSecret };
        if (!sign || !deps.signRequest) return Promise.resolve({ headers: headers, seq: null });
        var seq = (deps.getSeq ? deps.getSeq() : 0) + 1;
        var path = item.type === 'scan' ? '/api/scans' : '/api/profiles';
        return Promise.resolve()
          .then(function () { return deps.signRequest(p.deviceSecret, p.deviceId, seq, 'POST', path, bodyObj); })
          .then(function (sig) {
            if (sig) { headers['x-device-seq'] = String(seq); headers['x-device-sig'] = sig; return { headers: headers, seq: seq }; }
            return { headers: headers, seq: null };
          })
          .catch(function () { return { headers: headers, seq: null }; });
      }
      return Promise.resolve({ headers: { 'Content-Type': 'application/json', 'x-device-key': p.deviceKey }, seq: null });
    }
    function commitSeq(seq) {
      if (seq !== null && seq !== undefined && deps.setSeq) deps.setSeq(seq);
    }
    function retryAfterOf(res, body) {
      try {
        if (res && res.headers && typeof res.headers.get === 'function') {
          var h = Number(res.headers.get('Retry-After'));
          if (isFinite(h) && h > 0) return h;
        }
      } catch (e) {}
      if (body && typeof body.retryAfter === 'number' && body.retryAfter > 0) return body.retryAfter;
      return null;
    }

    function flush() {
      if (flushing || keyRejected || revoked || seqDesync || !active()) return Promise.resolve(state());
      flushing = true;
      return ensureLoaded().then(function () { return ensureVersions(); }).then(function () { return ensureBlockedIds(); }).then(async function () {
        var p = prefs();
        var base = String(p.endpoint || '').replace(/\/+$/, '');
        if (!credentialed(p) && p.deviceKey && deps.saveCredential) {
          await bootstrap();
          p = prefs();
        }
        if (!credentialed(p) && deps.registrationOnlyKey) {
          /* v63: the only key this build ships is
             registration-only — it can register this device
             and nothing else. When registration produced no
             credential (the server's BOOTSTRAP_KEY env var is
             not set yet, or the network is down), the queue
             simply HOLDS: no write is attempted with the
             bootstrap key, and no misleading "key rejected"
             latch is set. Registration retries on the next
             flush; scanning and the wallet are never blocked. */
          lastError = 'device not registered yet — scans are queued safely on this device';
          scheduleRetry(120);
          flushing = false;
          deps.onStatus();
          return state();
        }
        var reissued = false;
        /* v78 (Seat 2 F2): tombstones refused by a block are
           deferred to here and re-queued at the end of the run —
           see the blocked branch below. */
        var deferredTombstones = [];
        while (queue.length) {
          var item = queue[0];
          var isProfile = item.type === 'profile' || item.type === 'tombstone';
          var url = base + (isProfile ? '/api/profiles' : '/api/scans');
          var bodyObj = item.record;
          if (isProfile && deps.loadVersions) {
            bodyObj = Object.assign({}, item.record, { baseVersion: knownVersion(item.record.biomId) });
            if (item.type === 'profile' && tombstonedIds[item.record.biomId]) bodyObj.reenrol = true;
          }
          var auth = await authHeaders(item, bodyObj, true);
          var res = null;
          try {
            res = await deps.fetchFn(url, { method: 'POST', headers: auth.headers, body: JSON.stringify(bodyObj) });
          } catch (e) {
            lastError = 'network unreachable — will retry';
            break;
          }
          if (res && res.status >= 200 && res.status < 300) {
            commitSeq(auth.seq);
            queue.shift();
            lastSyncTs = deps.now();
            lastError = '';
            if (isProfile && versions) {
              var ack = await readJsonSafe(res);
              versions[item.record.biomId] = ack && typeof ack.version === 'number' ? ack.version : (bodyObj.baseVersion || 0) + 1;
              if (item.type === 'tombstone') tombstonedIds[item.record.biomId] = true;
              if (item.type === 'profile') delete tombstonedIds[item.record.biomId];
              persistVersions();
            }
            /* v78: a profile write for the blocked ID just went
               through — the block was lifted server-side (an
               unblock never un-revokes devices, but a credential
               that can write again is no longer refused), so the
               latch clears on the server's own evidence. */
            if (isProfile && blocked && item.record.biomId === blockedBiomId) { blocked = false; blockedBiomId = ''; }
            await persist();
            continue;
          }
          var errBody = await readJsonSafe(res);
          if (res && res.status === 409 && isProfile) {
            /* CAS conflict (or a tombstone state): this device's
               item is stale. Drop it, adopt the server's version,
               and surface the divergence — the bank is re-emitted
               by the next local change, now based on the truth. */
            commitSeq(auth.seq);
            queue.shift();
            if (errBody && typeof errBody.currentVersion === 'number' && versions) {
              versions[item.record.biomId] = errBody.currentVersion;
              persistVersions();
            }
            if (errBody && errBody.deleted) tombstonedIds[item.record.biomId] = true;
            lastError = 'Bank changed on another device — re-checking before update';
            if (deps.onProfileConflict) { try { deps.onProfileConflict(item.record.biomId, errBody); } catch (e) {} }
            await persist();
            continue;
          }
          if (res && res.status === 403 && errBody && errBody.blocked === true) {
            /* v78: an account block is NOT a device revocation.
               The server refuses this Biom ID's writes (the block
               also revoked the person's owner device server-side,
               but the account state is the truth the app must
               show). The refused item can never succeed, so it is
               dropped — the sequence WAS consumed (auth passed;
               the refusal is past auth, exactly like the 409
               path) — and the flush CONTINUES: other people's
               queued items on a shared terminal are not this
               account's hostage. The latch engages only when the
               blocked ID is this device's own profile (the
               ownBiomId dep); a terminal that scanned a blocked
               customer drops that one item and carries on
               unlatched. */
            commitSeq(auth.seq);
            var blockedId = errBody.biomId || (item.record && item.record.biomId) || '';
            /* v79: EVERY blocked refusal teaches this device
               the ID for its terminal set — a terminal that just
               had a blocked customer's scan refused will answer
               that customer's next scan with the blocked verdict
               at once, without waiting for a pull. */
            learnBlocked(blockedId, true);
            if (item.type === 'tombstone') {
              /* v78 (Seat 2 F2): a tombstone is a Delete All
                 promise, not data — dropping it would silently
                 un-complete the wipe (the local erase stands, the
                 server bank survives the block). It is the ONE
                 item retained: deferred and re-queued at the end
                 of this run, so the deletion lands after an
                 unblock instead of never. Scans and profile
                 upserts keep the drop semantics above — they
                 self-heal on the next local change. */
              queue.shift();
              deferredTombstones.push(item);
            } else {
              queue.shift();
            }
            var ownIdOnFlush = null;
            try { ownIdOnFlush = deps.ownBiomId ? deps.ownBiomId() : null; } catch (e) {}
            if (!deps.ownBiomId || ownIdOnFlush === blockedId) { blocked = true; blockedBiomId = blockedId; }
            lastError = 'account blocked';
            await persist();
            continue;
          }
          if (res && res.status === 403) {
            revoked = true;
            lastError = 'device revoked';
            break;
          }
          if (res && res.status === 401) {
            if (errBody && errBody.code === 'SEQ_DESYNC' && !reissued && deps.saveCredential && prefs().deviceKey) {
              reissued = true;
              var ok = await bootstrap();
              if (ok) continue; // retry the same item under the fresh credential
            }
            if (errBody && errBody.code === 'SEQ_DESYNC') { seqDesync = true; lastError = 'signing sequence out of step'; }
            else { keyRejected = true; lastError = 'key rejected'; }
            break;
          }
          if (res && res.status === 429) {
            lastError = 'server is rate-limiting this device — will retry';
            scheduleRetry(retryAfterOf(res, errBody));
            break;
          }
          lastError = 'server answered ' + (res ? res.status : 'no response') + ' — will retry';
          break;
        }
        if (deferredTombstones.length) {
          for (var dt = 0; dt < deferredTombstones.length; dt++) queue.push(deferredTombstones[dt]);
          await persist();
        }
        flushing = false;
        deps.onStatus();
        return state();
      }).catch(function () { flushing = false; return state(); });
    }

    /* B7 pull: read the counts-only summary and apply server
       tombstones newer than the version this device knows —
       the local copy of a wiped bank is removed here. Live-row
       version drift is deliberately NOT adopted: if this device
       later writes that bank, the CAS conflict path surfaces
       the divergence instead of silently rebasing. Runs only
       when the wiring provides applyTombstone. */
    function pull() {
      if (!active() || !deps.applyTombstone) return Promise.resolve(state());
      return ensureLoaded().then(function () { return ensureVersions(); }).then(function () { return ensureBlockedIds(); }).then(async function () {
        var p = prefs();
        var base = String(p.endpoint || '').replace(/\/+$/, '');
        if (!credentialed(p) && p.deviceKey && deps.saveCredential) {
          await bootstrap();
          p = prefs();
        }
        if (!credentialed(p) && deps.registrationOnlyKey) {
          /* v63: a registration-only key cannot read the
             summary either — pull waits for a credential. */
          return state();
        }
        var auth = await authHeaders({ type: 'summary' }, null, false);
        var res = null;
        try {
          res = await deps.fetchFn(base + '/api/profiles?summary=1', { method: 'GET', headers: auth.headers });
        } catch (e) { return state(); }
        if (res && res.status === 403) {
          /* v78 (Seat 1 fix): honour a blocked body on the read
             path too — if the refusal names this device's own
             account as blocked, the state shown is the blocked
             state, not a device revocation. The shipped API
             refuses a revoked device WITHOUT a blocked marker,
             so a plain 403 keeps the v62 behaviour exactly. */
          var pullErr = await readJsonSafe(res);
          var pullOwn = null;
          try { pullOwn = deps.ownBiomId ? deps.ownBiomId() : null; } catch (e) {}
          if (pullErr && pullErr.blocked === true && (!deps.ownBiomId || pullOwn === (pullErr.biomId || ''))) {
            blocked = true; blockedBiomId = pullErr.biomId || pullOwn || '';
          } else { revoked = true; }
          deps.onStatus(); return state();
        }
        if (!res || res.status !== 200) return state();
        var j = await readJsonSafe(res);
        var rows = j && Array.isArray(j.profiles) ? j.profiles : [];
        /* v78: this device's own Biom ID, resolved once per pull
           (the wiring's wallet session). Only the own row may
           move the blocked latch — a shared terminal pulls every
           customer's summary and must never latch a stranger's
           block as its own account state. */
        var ownIdOnPull = null;
        try { ownIdOnPull = deps.ownBiomId ? deps.ownBiomId() : null; } catch (e) {}
        var blockedChanged = false;
        var blockedIdsChanged = false;
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          if (!row || !row.biomId || typeof row.version !== 'number') continue;
          /* v78: the lean summary carries the block flag both
             ways, so the app learns a block — and an unblock —
             from the pull, before any write is refused. Server
             truth wins in both directions. */
          if (ownIdOnPull && row.biomId === ownIdOnPull) {
            if (row.blocked === true && !blocked) { blocked = true; blockedBiomId = row.biomId; blockedChanged = true; }
            else if (row.blocked !== true && blocked && blockedBiomId === row.biomId) { blocked = false; blockedBiomId = ''; blockedChanged = true; }
          }
          /* v79: the SAME rows teach the terminal set — every
             customer's flag, not only this device's own. A
             blocked customer is answered with the blocked
             verdict at the till; an unblocked one scans
             normally again. The map mutates in place here (the
             pull already awaited ensureBlockedIds) and persists
             once, after the loop. */
          if (blockedIds) {
            if (row.blocked === true && blockedIds[row.biomId] !== true) { blockedIds[row.biomId] = true; blockedIdsChanged = true; }
            else if (row.blocked !== true && blockedIds[row.biomId]) { delete blockedIds[row.biomId]; blockedIdsChanged = true; }
          }
          if (row.deleted && row.version > knownVersion(row.biomId)) {
            tombstonedIds[row.biomId] = true;
            try { await deps.applyTombstone(row.biomId); } catch (e) {}
            if (versions) { versions[row.biomId] = row.version; persistVersions(); }
          } else if (row.deleted) {
            tombstonedIds[row.biomId] = true;
          }
        }
        if (blockedIdsChanged) persistBlockedIds();
        if (blockedChanged) deps.onStatus();
        return state();
      }).catch(function () { return state(); });
    }

    /* Queue one tombstone per person (the Delete All Data flow).
       Resolves the number queued. Existing queued profile items
       for the same Biom ID are replaced — a tombstone is the
       newest truth about that bank. */
    function queueTombstones(people) {
      if (!active()) return Promise.resolve(0);
      var list = Array.isArray(people) ? people : [];
      return ensureLoaded().then(function () {
        var n = 0;
        list.forEach(function (person) {
          if (!person || !person.id) return;
          queue = queue.filter(function (it) { return !(it.type !== 'scan' && it.record && it.record.biomId === person.id); });
          queue.push({ type: 'tombstone', record: { biomId: person.id, deleted: true, deletedTs: deps.now() } });
          n++;
        });
        if (n) persist();
        return n;
      });
    }
    /* v73 (Seat 1 F2): drop every queued NON-SCAN item for one
       Biom ID (profile upserts and tombstones alike) and persist.
       Profile deletion calls this in EVERY branch: a queued
       upsert left behind by a sync-off delete would otherwise
       flush the deleted bank back to the server when sync
       returns. Scan items carry no bank and are untouched,
       mirroring the queueTombstones filter. Resolves the
       number of items removed. */
    function purgeProfile(biomId) {
      if (!biomId) return Promise.resolve(0);
      return ensureLoaded().then(function () {
        var before = queue.length;
        queue = queue.filter(function (it) { return !(it.type !== 'scan' && it.record && it.record.biomId === biomId); });
        var removed = before - queue.length;
        if (removed) persist();
        return removed;
      });
    }
    function pendingItems() { return queue ? queue.slice() : []; }

    /* The settings card's Test connection: ask the server who
       this device is (GET /api/devices/me — a read that writes
       nothing and reveals nothing about other devices) and
       answer in plain words. In shared-key mode there is no
       credential to test yet — the honest answer says the
       device registers on its next sync. */
    function testConnection() {
      var p = prefs();
      if (!p.endpoint) return Promise.resolve({ ok: false, message: 'No server endpoint is set yet.' });
      var base = String(p.endpoint || '').replace(/\/+$/, '');
      var start = Promise.resolve(false);
      if (!credentialed(p) && p.deviceKey && deps.saveCredential) start = bootstrap();
      return start.then(async function () {
        p = prefs();
        if (!credentialed(p)) {
          if (deps.registrationOnlyKey) return { ok: false, message: 'This device could not register with the server yet. Registration is automatic and retries in the background — scans stay queued safely on this device meanwhile, and nothing is lost.' };
          if (p.deviceKey) return { ok: true, message: 'Shared-key mode: this device registers its own credential on the next sync — tap Sync now to register it now.' };
          return { ok: false, message: 'No device credential and no shared key are set.' };
        }
        var res = null;
        try {
          res = await deps.fetchFn(base + '/api/devices/me', {
            method: 'GET',
            headers: { 'x-device-id': p.deviceId, 'x-device-key': p.deviceSecret }
          });
        } catch (e) {
          return { ok: false, message: 'Network unreachable — check the endpoint URL and try again.' };
        }
        if (res && res.status === 200) {
          var j = await readJsonSafe(res);
          return { ok: true, message: 'Connected — this device is registered' + (j && j.label ? ' as "' + j.label + '"' : '') + ' and is not revoked.' };
        }
        if (res && res.status === 403) {
          /* v79 (F1): the /me denial now carries the block when
             the revocation is a block's side effect — the words
             here must name the ACCOUNT, not only the device. */
          var j403 = await readJsonSafe(res);
          var own403 = null;
          try { own403 = deps.ownBiomId ? deps.ownBiomId() : null; } catch (e) {}
          if (j403 && j403.blocked === true && (!deps.ownBiomId || own403 === (j403.biomId || ''))) {
            blocked = true; blockedBiomId = j403.biomId || own403 || '';
            deps.onStatus();
            return { ok: false, message: 'This account has been blocked on the server. Scans, payments and sync for this account are stopped until an admin unblocks it.' };
          }
          revoked = true;
          deps.onStatus();
          return { ok: false, message: 'This device has been revoked on the server. Sync is stopped until the server admin un-revokes it, or you register again with the shared key.' };
        }
        if (res && res.status === 401) return { ok: false, message: 'The server refused this device credential — check the device ID and secret, or clear them and register again with the shared key.' };
        return { ok: false, message: 'The server answered ' + (res ? res.status : 'no response') + ' — try again shortly.' };
      });
    }

    function state() {
      return {
        on: !!prefs().on, configured: configured(),
        queued: queue ? queue.length : 0,
        keyRejected: keyRejected, revoked: revoked, seqDesync: seqDesync,
        blocked: blocked, blockedBiomId: blockedBiomId,
        lastSyncTs: lastSyncTs, lastError: lastError
      };
    }
    function statusText() {
      var s = state();
      if (!s.on) return 'Off';
      if (!s.configured) return 'On — endpoint URL and device key needed';
      if (s.blocked) return 'This account has been blocked — the server refuses its scans, profile updates and payments, and sync for this account is stopped, until an admin unblocks it';
      if (s.revoked) return 'This device has been revoked on the server — sync is stopped until the server admin un-revokes it or this device registers again';
      if (s.keyRejected) return 'Key rejected by the server — check the device key, then Save settings';
      if (s.seqDesync) return 'This device needs re-registering — its signing sequence is out of step. Save settings, then tap Sync now';
      var base = s.lastSyncTs ? ('Last synced ' + new Date(s.lastSyncTs).toLocaleTimeString()) : 'Not synced yet';
      return base + ' · ' + s.queued + ' queued' + (s.lastError ? ' · ' + s.lastError : '');
    }
    function settingsChanged() {
      keyRejected = false;
      revoked = false;
      seqDesync = false;
      blocked = false;
      blockedBiomId = '';
      if (lastError === 'key rejected' || lastError === 'device revoked' || lastError === 'signing sequence out of step' || lastError === 'account blocked') lastError = '';
      deps.onStatus();
    }
    function reset() {
      queue = [];
      keyRejected = false;
      revoked = false;
      seqDesync = false;
      blocked = false;
      blockedBiomId = '';
      blockedIds = {};
      blockedIdsPromise = null;
      persistBlockedIds();
      versions = null;
      versionsPromise = null;
      tombstonedIds = {};
      lastSyncTs = 0;
      lastError = '';
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      // Persist AFTER any in-flight persist of the old queue, so
      // the emptied outbox is the final state (see wireWipeData).
      persist();
    }
    return {
      noteScan: noteScan, noteProfile: noteProfile, flush: flush, pull: pull,
      queueTombstones: queueTombstones, purgeProfile: purgeProfile, pendingItems: pendingItems,
      testConnection: testConnection,
      scheduleFlush: scheduleFlush, state: state, statusText: statusText,
      settingsChanged: settingsChanged, reset: reset, ensureLoaded: ensureLoaded,
      isBlocked: isBlocked,
      ensureBlockedIds: ensureBlockedIds
    };
  }

  /* SYNC-ENGINE-END */

  /* SYNC-SIGNER-BEGIN — the app-side request signer (v62, B4).
     Must produce byte-identical signatures to the server's
     lib/canonical.js; tests/v62-server-trust.test.js pins one
     HMAC test vector through BOTH implementations. Canonical
     JSON: object keys sorted recursively, arrays in order, no
     whitespace. The HMAC key is the raw SHA-256 of the device
     secret; the signed message is
       deviceId \n seq \n METHOD \n path \n sha256hex(canonical body)
     The secret itself never leaves the device — only the
     signature does. WebCrypto only; without it the signer
     returns null and the engine sends the credential unsigned
     (the server then refuses, if the device requires signing,
     and the status line says so — fail-closed, never silent). */
  function biomCanonicalJson(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(biomCanonicalJson).join(',') + ']';
    if (typeof v === 'object') {
      return '{' + Object.keys(v).sort().map(function (k) {
        return JSON.stringify(k) + ':' + biomCanonicalJson(v[k]);
      }).join(',') + '}';
    }
    return 'null';
  }
  function biomHex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }
  function biomSignRequest(secret, deviceId, seq, method, path, body) {
    if (!window.crypto || !crypto.subtle || !window.TextEncoder) return Promise.resolve(null);
    var enc = new TextEncoder();
    return crypto.subtle.digest('SHA-256', enc.encode(String(secret))).then(function (keyBytes) {
      return crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    }).then(function (key) {
      return crypto.subtle.digest('SHA-256', enc.encode(body === null || body === undefined ? '' : biomCanonicalJson(body))).then(function (bodyHash) {
        var msg = String(deviceId) + '\n' + String(seq) + '\n' + String(method) + '\n' + String(path) + '\n' + biomHex(bodyHash);
        return crypto.subtle.sign('HMAC', key, enc.encode(msg)).then(function (sig) { return biomHex(sig); });
      });
    }).catch(function () { return null; });
  }
  /* SYNC-SIGNER-END */

  function syncPrefGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function syncPrefSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  function syncUuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  /* v63 (Seat 2): sync is ON by default and zero-setup. The
     endpoint is baked in (it is not a secret), and the app
     ships a REGISTRATION-ONLY bootstrap key: its only server
     power is POST /api/devices, after which this device signs
     with its own credential exactly as v62. The legacy shared
     DEVICE_KEY is no longer read by the app at all — a stored
     biomSyncDeviceKey pref from v62 is ignored (the credential
     it registered is what the device uses). The bootstrap key
     value below must match the BOOTSTRAP_KEY env var on the
     API project; until that env var exists, registration fails
     closed and the sync queue holds (see the engine guard). */
  /* v79: the blocked-state copy, in one place so every surface
     says the same thing. The terminal line is the Chairman's
     own sentence (2026-11-27): a blocked palm at a merchant
     must be told plainly that its palm scanning is blocked —
     never a vague failure. */
  var BLOCKED_TERMINAL_LINE = 'Palm scanning failed — your palm scanning is blocked.';
  var BLOCKED_ACCOUNT_LINE = 'This account has been blocked. Palm scans, payments, sending and adding money are stopped until an admin unblocks it.';
  var SYNC_DEFAULT_ENDPOINT = 'https://tsg-biom-api.vercel.app';
  var SYNC_BOOTSTRAP_KEY = '7d969f9a4e4a3a232477d952cbfe3c2a4271d41d83071aec';
  var Sync = createBiomSync({
    B: B,
    modelId: B.PALMNET_MODEL_ID,
    appVersion: APP_DATA_VERSION,
    /* v74: the sync engine stamps each scan record with the
       real duration its on-screen timer measured. */
    scanDurationMs: function (kind) { return scanDurationForKind(kind); },
    registrationOnlyKey: true,
    /* v78: the sync engine latches its blocked state only for
       THIS device's own profile — the signed-in wallet person.
       A merchant terminal pulling summaries for every customer
       must never latch a stranger's block as its own. */
    ownBiomId: function () { var me = walletSessionPerson(); return me ? me.id : null; },
    getPrefs: function () {
      return {
        on: syncPrefGet('biomSyncOn') !== '0',
        endpoint: syncPrefGet('biomSyncEndpoint') || SYNC_DEFAULT_ENDPOINT,
        deviceKey: SYNC_BOOTSTRAP_KEY,
        deviceId: syncPrefGet('biomSyncDeviceId'),
        deviceSecret: syncPrefGet('biomSyncDeviceSecret'),
        label: syncPrefGet('biomSyncLabel') || 'Chairman phone'
      };
    },
    loadOutbox: function () { return DB.getMeta('syncOutbox', []); },
    saveOutbox: function (items) { return DB.setMeta('syncOutbox', items); },
    /* v62: the bank versions this device last saw acknowledged
       by the server, one meta row beside the outbox. */
    loadVersions: function () { return DB.getMeta('syncVersions', {}); },
    saveVersions: function (v) { return DB.setMeta('syncVersions', v); },
    /* v79: the terminal blocked set — Biom IDs this device
       knows are blocked (learned from pulls and blocked flush
       refusals), one meta row beside the versions. */
    loadBlockedIds: function () { return DB.getMeta('syncBlockedIds', {}); },
    saveBlockedIds: function (m) { return DB.setMeta('syncBlockedIds', m); },
    /* v62: the signing sequence is a device pref — it must
       survive restarts exactly, or every boot would desync. */
    getSeq: function () { var n = parseInt(syncPrefGet('biomSyncSeq'), 10); return isFinite(n) && n > 0 ? n : 0; },
    setSeq: function (n) { syncPrefSet('biomSyncSeq', String(n)); },
    saveCredential: function (deviceId, secret) {
      syncPrefSet('biomSyncDeviceId', deviceId);
      syncPrefSet('biomSyncDeviceSecret', secret);
      if ($('syncDeviceId')) $('syncDeviceId').value = deviceId;
      if ($('syncDeviceSecret')) $('syncDeviceSecret').value = secret;
    },
    signRequest: function (secret, deviceId, seq, method, path, body) {
      return biomSignRequest(secret, deviceId, seq, method, path, body);
    },
    /* v62 (B7): the server says this bank was wiped on another
       device — remove this device's copy and say so. */
    applyTombstone: function (biomId) {
      return DB.remove('people', biomId).then(function () {
        renderDashboard();
        fillTerminalPeople();
        renderWallet();
        toast('A palm bank was deleted on another device and has been removed here too.');
      });
    },
    onProfileConflict: function () { renderSyncStatus(); },
    fetchFn: function (url, opts) { return fetchWithTimeout(url, opts, 20000); }, // v77: bounded — a stalled sync can never hang the app
    now: function () { return Date.now(); },
    uuid: syncUuid,
    onStatus: function () { renderSyncStatus(); },
    encryptProfileCore: function (core) { return Vault.encryptProfileCore(core); }
  });
  /* v78: the money-moment profile emit. Add Money, Send Money
     and Biom Pay change the WALLET, not the palm bank, so the
     ordinary bank emits never fire for them — and until v78 the
     server (and therefore the dashboard dossier) never saw a
     balance or a ledger at all. noteMoneyProfile attaches the
     person's Biom Pay records (from the transactions store,
     chronological tail) to a TRANSIENT copy of the person and
     runs the normal profile emit: B.syncProfileRecord shapes
     the wallet + pays mirrors onto the record, and the copy is
     never stored, so payRecords never lands on the person row.
     Fire-and-forget like noteScan: a failed read simply skips
     this emit — the money itself has already landed locally,
     and the next money moment re-mirrors everything. */
  function noteMoneyProfile(person) {
    if (!person || !person.id) return Promise.resolve(false);
    return DB.all('transactions').then(function (txs) {
      var mine = (Array.isArray(txs) ? txs : []).filter(function (t) { return t && t.personId === person.id; });
      mine.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
      var copy = {};
      Object.keys(person).forEach(function (k) { copy[k] = person[k]; });
      copy.payRecords = mine.slice(-50);
      Sync.noteProfile(copy);
      return true;
    }).catch(function () { return false; });
  }
  /* ---------------- v71 bKash sandbox rail ------------------------------
     The Phase E rail, sandbox scope (Chairman's order 2026-11-26
     13:05). The palm authorisation is unchanged and still gates
     INITIATION; the money ceremony (wallet, OTP, PIN) happens on
     bKash's own hosted page — this app never sees a bKash PIN or
     OTP, and the API refuses any request body that carries one.
     Settlement truth comes only from the API's execute/query
     relays of bKash's own responses. Modes are hard-separated by
     the API: 'sandbox' here means the API answered mode
     'sandbox' on BOTH the probe and the payment calls; anything
     else fails closed — there is NO fallback from a failed or
     unreachable sandbox rail into the demo ledger. Transport
     reuses the device credential and the SHARED sync sequence
     counter (a second counter would desync the device). */
  var BkashRail = (function () {
    function endpoint() { return syncPrefGet('biomSyncEndpoint') || SYNC_DEFAULT_ENDPOINT; }
    function creds() {
      return {
        deviceId: syncPrefGet('biomSyncDeviceId'),
        deviceSecret: syncPrefGet('biomSyncDeviceSecret'),
        legacyKey: syncPrefGet('biomSyncDeviceKey')
      };
    }
    /* v71 Seat 2 RC-2/RC-3: the payments rail NEVER falls back
       to the registration-only bootstrap key. In Sync's model
       that key exists solely to register a device (POST
       /api/devices); spending it on payment routes would widen
       its blast radius to money initiation. Transport exists
       only with a registered device credential, or with an
       owner-configured legacy device key — and a half-written
       credential (an id with no secret) is refused outright,
       never silently downgraded to a weaker auth. */
    function hasTransport() {
      var c = creds();
      return !!((c.deviceId && c.deviceSecret) || c.legacyKey);
    }
    function fetchJson(url, opts) {
      return fetchWithTimeout(url, opts, 20000).then(function (r) { // v77: bounded — the payments rail can never wait forever
        var seqConsumed = null;
        try { seqConsumed = r.headers && typeof r.headers.get === 'function' ? r.headers.get('x-biom-seq-consumed') : null; } catch (e) {}
        return r.text().then(function (t) {
          var j = null;
          try { j = JSON.parse(t); } catch (e) {}
          return { status: r.status, json: j, seqConsumed: seqConsumed };
        });
      });
    }
    /* v71 Seat 2 re-review changes 1+2: this transport speaks
       the API's REAL contract — the same header names Sync uses
       (x-device-id / x-device-key / x-device-seq / x-device-sig;
       lib/auth.js reads nothing else) and the signer called in
       its defined argument order over the body OBJECT (the
       server canonicalises the parsed body, lib/canonical.js).
       The first v71 build invented X-Biom-* headers and called
       the signer with shifted arguments, so no payment call
       from the app could ever have authenticated; the API suite
       could not see it because it drives the API with hand-built
       fetches. The contract is now pinned end-to-end by the API
       repo's tests/v71-app-contract.test.js, which evals THIS
       code against the real server. */
    function authHeaders(c, seq, sig) {
      var h = { 'Content-Type': 'application/json' };
      if (c.deviceId && c.deviceSecret) {
        h['x-device-id'] = c.deviceId;
        h['x-device-key'] = c.deviceSecret;
        if (seq !== null && seq !== undefined) {
          h['x-device-seq'] = String(seq);
          h['x-device-sig'] = sig;
        }
      } else if (c.legacyKey) {
        h['x-device-key'] = c.legacyKey;
      }
      return h;
    }
    function mode() {
      var c = creds();
      if (c.deviceId && !c.deviceSecret) return Promise.reject(new Error('device credential incomplete — payments unavailable on this device'));
      if (!hasTransport()) return Promise.reject(new Error('no device credential for the payments rail'));
      return fetchJson(endpoint() + '/api/payments/mode', { headers: authHeaders(c) }).then(function (r) {
        if (!r.json || r.json.ok !== true) throw new Error('mode probe failed');
        return r.json; // { provider:'bkash', mode:'demo'|'sandbox'|'production', bkashConfigured }
      });
    }
    /* v71 Seat 2 re-review change 3: the sequence commit rule
       is the server's own marker, never a status-code guess.
       The API sets X-Biom-Seq-Consumed on every payments
       response written after a signed sequence was spent —
       including a revoked device's 403, where auth consumed
       the number before the revocation check — and on nothing
       else (never on the pre-auth bucket 429 / 413 / PIN-OTP
       400, never on a 401). The local counter advances if and
       only if the marker names the sequence this call sent.
       This rail's own calls are serialised on payChain, and
       each call first drains Sync (Sync.flush) — Sync and this
       rail share ONE counter, so their signed writes never
       allocate concurrently; Sync self-serialises its flush
       the same way. */
    var payChain = Promise.resolve();
    function signedPost(path, bodyObj) {
      var run = payChain.then(function () { return signedPostOnce(path, bodyObj, false); });
      payChain = run.then(function () {}, function () {});
      return run;
    }
    function signedPostOnce(path, bodyObj, retried) {
      var c0 = creds();
      if (c0.deviceId && !c0.deviceSecret) return Promise.reject(new Error('device credential incomplete — payments unavailable on this device'));
      if (!hasTransport()) return Promise.reject(new Error('no device credential for the payments rail'));
      return Sync.flush().then(function () {
        var c = creds();
        var body = JSON.stringify(bodyObj);
        if (c.deviceId && c.deviceSecret) {
          var seq = (parseInt(syncPrefGet('biomSyncSeq'), 10) || 0) + 1;
          return biomSignRequest(c.deviceSecret, c.deviceId, seq, 'POST', path, bodyObj).then(function (sig) {
            if (!sig) throw new Error('could not sign the payment request on this device');
            return fetchJson(endpoint() + path, {
              method: 'POST',
              headers: authHeaders(c, seq, sig),
              body: body
            }).then(function (r) {
              if (r.seqConsumed === String(seq)) {
                try { syncPrefSet('biomSyncSeq', String(seq)); } catch (e) {}
              }
              /* One heal-and-retry on a sequence desync: Sync's
                 next flush re-registers the device through its
                 v62 reissue path when it pushes; if that replaced
                 the credential (and reset the shared counter),
                 retry this call once under the fresh credential.
                 If nothing changed, the error is Sync's own
                 honest wording — no loop, no silent downgrade. */
              if (r.status === 401 && r.json && r.json.code === 'SEQ_DESYNC' && !retried) {
                return Sync.flush().then(function () {
                  var c2 = creds();
                  if (c2.deviceId && c2.deviceId !== c.deviceId) return signedPostOnce(path, bodyObj, true);
                  throw new Error('device signing is out of step — open Settings, check Scan Sync, tap Sync now, then try the payment again');
                });
              }
              return r;
            });
          });
        }
        return fetchJson(endpoint() + path, {
          method: 'POST',
          headers: authHeaders(c),
          body: body
        });
      });
    }
    function relay(path, bodyObj) {
      return signedPost(path, bodyObj).then(function (r) {
        if (!r.json) throw new Error('payment server unreachable');
        return r.json;
      });
    }
    return {
      hasTransport: hasTransport,
      mode: mode,
      create: function (args) { return relay('/api/payments', args); },
      execute: function (paymentID) { return relay('/api/payments/execute', { paymentID: paymentID }); },
      query: function (paymentID) { return relay('/api/payments/query', { paymentID: paymentID }); }
    };
  })();
  /* The only bKash page the app will ever navigate to: the
     sandbox hosted checkout on bKash's own sandbox host, over
     https. Anything else in a create response is refused. */
  /* v73 (Chairman's live phone failure, 2026-11-26): when the
     payments API relays a bKash provider refusal, its body
     carries the provider's own statusCode + statusMessage
     (e.g. 2049 / 'Invalid Merchant Callback URL'). The error
     lines must surface those two fields — sanitised: ONLY
     those fields, trimmed and length-capped, never a raw
     response dump — instead of a generic refusal that hides
     the real cause. Returns '' when the response carries no
     provider fields, so callers fall back to today's generic
     wording exactly. */
  function bkashProviderRefusal(res) {
    if (!res || typeof res !== 'object') return '';
    var code = (typeof res.statusCode === 'string' || typeof res.statusCode === 'number') ? String(res.statusCode).trim().slice(0, 16) : '';
    var msg = typeof res.statusMessage === 'string' ? res.statusMessage.trim().slice(0, 120) : '';
    if (!code && !msg) return '';
    return code && msg ? code + ': ' + msg : (msg || code);
  }
  function bkashSandboxUrlOk(u) {
    try {
      var url = new URL(u);
      return url.protocol === 'https:' && url.hostname === 'sandbox.payment.bkash.com';
    } catch (e) { return false; }
  }
  function renderSyncStatus() {
    var el = $('syncStatus');
    if (el) el.textContent = Sync.statusText();
  }
  function fillSyncSettings() {
    if ($('syncEndpoint')) $('syncEndpoint').value = syncPrefGet('biomSyncEndpoint') || SYNC_DEFAULT_ENDPOINT;
    if ($('syncDeviceId')) $('syncDeviceId').value = syncPrefGet('biomSyncDeviceId');
    if ($('syncDeviceSecret')) $('syncDeviceSecret').value = syncPrefGet('biomSyncDeviceSecret');
    if ($('syncLabel')) $('syncLabel').value = syncPrefGet('biomSyncLabel');
    if ($('syncOn')) $('syncOn').checked = syncPrefGet('biomSyncOn') !== '0';
    renderSyncStatus();
  }
  function wireSyncSettings() {
    var save = $('syncSaveBtn'), nowBtn = $('syncNowBtn'), testBtn = $('syncTestBtn');
    if (save) save.addEventListener('click', function () {
      syncPrefSet('biomSyncEndpoint', $('syncEndpoint').value.trim());
      syncPrefSet('biomSyncDeviceId', $('syncDeviceId') ? $('syncDeviceId').value.trim() : '');
      syncPrefSet('biomSyncDeviceSecret', $('syncDeviceSecret') ? $('syncDeviceSecret').value.trim() : '');
      syncPrefSet('biomSyncLabel', $('syncLabel').value.trim());
      /* v63: sync defaults ON, so OFF must be stored explicitly
         ('0') — an absent pref means ON. */
      syncPrefSet('biomSyncOn', $('syncOn').checked ? '1' : '0');
      Sync.settingsChanged();
      renderSyncStatus();
      toast(Sync.state().on ? 'Scan Sync settings saved.' : 'Scan Sync is off. Settings saved.');
      Sync.flush();
    });
    if (nowBtn) nowBtn.addEventListener('click', function () {
      Sync.flush().then(function () { return Sync.pull(); }).then(function () { renderSyncStatus(); });
    });
    if (testBtn) testBtn.addEventListener('click', function () {
      var out = $('syncTestResult');
      if (out) out.textContent = 'Testing…';
      Sync.testConnection().then(function (r) {
        if (out) out.textContent = r.message;
        renderSyncStatus();
      });
    });
    /* Show/hide toggle for the device secret field — the value
       stays on this device either way; the toggle only changes
       whether it is visible on this screen. (v63: the shared-key
       field and its toggle are gone — registration is automatic
       via the built-in registration-only key.) */
    [['syncDeviceSecretToggle', 'syncDeviceSecret']].forEach(function (pair) {
      var t = $(pair[0]), field = $(pair[1]);
      if (t && field) t.addEventListener('click', function () {
        var show = field.type === 'password';
        field.type = show ? 'text' : 'password';
        t.textContent = show ? 'Hide' : 'Show';
        t.setAttribute('aria-pressed', show ? 'true' : 'false');
      });
    });
  }

  /* ---------------- Biom Vault (v61, Phase B item B1) ------------------
     Custody for the envelope key the DB funnel and the sync emit
     boundary seal banks with (the crypto itself lives in
     biometrics.js — see its envelope section for the design, the
     seam list and the parity argument).

     The vault key is a random 256-bit key generated ON this
     device at the first v61 run (Seat 2: "generated on the owner
     device at first Phase B run"). It is held in its own
     IndexedDB database ('tsg-biom-vault') as a CryptoKey —
     non-extractable once setup completes — or, where IndexedDB
     is unavailable and the app runs on its localStorage store,
     as raw key material in device storage (the disclosed
     fallback for a platform with no key store). The key never
     syncs, is never sent to the API and never enters a log.

     Setup window: a freshly created key starts EXTRACTABLE with
     its raw bytes held in the vault record, so the recovery
     sheet can always be produced until the owner completes
     setup (passphrase + typed acknowledgement). Completing
     setup wraps the raw key under the passphrase (the re-export
     path), re-imports the key non-extractable and destroys the
     held raw bytes. Key loss without the recovery sheet means
     the sealed banks cannot be opened and each person
     re-enrols — the designed, disclosed consequence, stated on
     the vault card in plain words.

     Delete All Data does NOT destroy the vault: the key is not
     biometric data, and keeping it means banks re-enrolled
     after a wipe seal under the same key the owner's recovery
     sheet restores. */
  var Vault = {
    key: null, kid: null, ready: false, pendingAck: false,
    unavailable: false, createdTs: 0, hasWrap: false,
    lastConversion: null, _deriveCache: {}
  };
  var vaultRawHeld = null; // raw key bytes, setup window only
  var VAULT_LS_KEY = 'tsgbiom_vault_v1';
  var VAULT_REPORT_KEY = 'tsgbiom_vault_report';

  function vaultStoreRead() {
    if (DB.useLS || !('indexedDB' in window)) {
      try {
        var raw = localStorage.getItem(VAULT_LS_KEY);
        return Promise.resolve(raw ? JSON.parse(raw) : null);
      } catch (e) { return Promise.resolve(null); }
    }
    return new Promise(function (resolve) {
      var settled = false;
      var done = function (rec) { if (!settled) { settled = true; resolve(rec || null); } };
      var req;
      try { req = indexedDB.open('tsg-biom-vault', 1); } catch (e) { done(null); return; }
      req.onupgradeneeded = function () { req.result.createObjectStore('vault', { keyPath: 'key' }); };
      req.onsuccess = function () {
        var db = req.result;
        try {
          var get = db.transaction('vault', 'readonly').objectStore('vault').get('main');
          get.onsuccess = function () { var rec = get.result || null; try { db.close(); } catch (e) {} done(rec); };
          get.onerror = function () { try { db.close(); } catch (e) {} done(null); };
        } catch (e) { try { db.close(); } catch (e2) {} done(null); }
      };
      req.onerror = function () { done(null); };
      req.onblocked = function () { done(null); };
      setTimeout(function () { done(null); }, 2500);
    });
  }
  function vaultStoreWrite(rec) {
    if (DB.useLS || !('indexedDB' in window)) {
      try {
        localStorage.setItem(VAULT_LS_KEY, JSON.stringify({
          kid: rec.kid, rawB64: rec.raw ? B.bankEncBytesToB64(rec.raw) : null,
          wrapped: rec.wrapped || null, pendingAck: !!rec.pendingAck, createdTs: rec.createdTs || 0
        }));
      } catch (e) {}
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      var settled = false;
      var done = function () { if (!settled) { settled = true; resolve(); } };
      var req;
      try { req = indexedDB.open('tsg-biom-vault', 1); } catch (e) { done(); return; }
      req.onupgradeneeded = function () { req.result.createObjectStore('vault', { keyPath: 'key' }); };
      req.onsuccess = function () {
        var db = req.result;
        try {
          var put = db.transaction('vault', 'readwrite').objectStore('vault').put({
            key: 'main', kid: rec.kid, cryptoKey: rec.cryptoKey || null,
            raw: rec.raw || null, wrapped: rec.wrapped || null,
            pendingAck: !!rec.pendingAck, createdTs: rec.createdTs || 0
          });
          put.onsuccess = function () { try { db.close(); } catch (e) {} done(); };
          put.onerror = function () { try { db.close(); } catch (e) {} done(); };
        } catch (e) { try { db.close(); } catch (e2) {} done(); }
      };
      req.onerror = done;
      req.onblocked = done;
      setTimeout(done, 2500);
    });
  }
  function vaultApplyRecord(rec, importedKey) {
    Vault.kid = rec.kid;
    Vault.key = importedKey || rec.cryptoKey || null;
    Vault.pendingAck = !!rec.pendingAck;
    Vault.createdTs = rec.createdTs || 0;
    Vault.hasWrap = !!rec.wrapped;
    Vault._deriveCache = {};
    vaultRawHeld = rec.raw ? new Uint8Array(rec.raw) : null;
    Vault.ready = !!Vault.key;
  }
  Vault.init = function () {
    if (!B.bankEncAvailable()) { Vault.unavailable = true; return Promise.resolve(false); }
    return vaultStoreRead().then(function (rec) {
      if (rec && rec.kid) {
        if (rec.rawB64 && !rec.cryptoKey) {
          // localStorage form: re-import the held raw key.
          var raw = B.bankEncB64ToBytes(rec.rawB64);
          if (!raw) { Vault.unavailable = true; return false; }
          return B.vaultImportKey(raw, false).then(function (key) {
            vaultApplyRecord({ kid: rec.kid, wrapped: rec.wrapped, pendingAck: rec.pendingAck, createdTs: rec.createdTs, raw: rec.pendingAck ? raw : null }, key);
            return true;
          }).catch(function () { Vault.unavailable = true; return false; });
        }
        vaultApplyRecord(rec, null);
        return Vault.ready;
      }
      // First v61 run on this device: generate the vault key.
      var rawNew = B.vaultGenerateRaw();
      return B.vaultKeyId(rawNew).then(function (kid) {
        return B.vaultImportKey(rawNew, true).then(function (key) {
          var fresh = { kid: kid, cryptoKey: key, raw: rawNew, wrapped: null, pendingAck: true, createdTs: Date.now() };
          return vaultStoreWrite(fresh).then(function () {
            vaultApplyRecord(fresh, key);
            return true;
          });
        });
      }).catch(function () { Vault.unavailable = true; return false; });
    }).catch(function () { Vault.unavailable = true; return false; });
  };
  function vaultDerive(biomId) {
    if (!Vault.key) return Promise.reject(new Error('no vault key'));
    var id = String(biomId || '');
    if (!Vault._deriveCache[id]) Vault._deriveCache[id] = B.vaultDeriveBankKey(Vault.key, id);
    return Vault._deriveCache[id];
  }
  /* The DB funnel's two transforms. Both are total: any failure
     resolves the row(s) unchanged, so a crypto problem degrades
     to the encoded form and never breaks a save or a load. */
  function vaultEncryptRow(person) {
    if (!Vault.ready || !person || typeof person !== 'object') return Promise.resolve(person);
    return B.bankEncryptPerson(person, vaultDerive, Vault.kid)
      .then(function (res) { return res.person; })
      .catch(function () { return person; });
  }
  function vaultDecryptRows(rows) {
    if (!Vault.ready || !Array.isArray(rows) || !rows.length) return Promise.resolve(rows);
    return Promise.all(rows.map(function (row) {
      if (!row || typeof row !== 'object' || !row.palmProfile) return row;
      if (B.bankTemplateState(row).sealed === 0) return row;
      return B.bankDecryptPerson(row, vaultDerive)
        .then(function (res) { return res.person; })
        .catch(function () { return row; });
    }));
  }
  /* v73 (Seat 1 F1): the SYNC seal path fails CLOSED. When the
     vault is not ready there is no key to seal with, so this
     resolves null and the sync engine queues NOTHING (its
     pushNow already returns early on a falsy core) — an
     unsealed bank must never be queued or posted. This is
     deliberately NOT the DB funnel's behaviour: vaultEncryptRow
     above still resolves the row unchanged when the vault is
     not ready, so LOCAL on-device saves keep working exactly
     as before; only the off-device copy is refused. The sole
     caller of this function is the sync engine wiring. */
  Vault.encryptProfileCore = function (core) {
    if (!Vault.ready) return Promise.resolve(null);
    return B.bankEncryptProfileCore(core, vaultDerive, Vault.kid);
  };
  /* The v61 conversion sweep: seal every still-encoded bank in
     the raw store, write back only the rows that changed, then
     re-push the converted banks so the server copies become
     ciphertext too (through the normal sync engine — with sync
     off this queues nothing and calls nothing). Idempotent: a
     sweep over sealed banks writes nothing. Runs at every boot;
     after the first v61 boot it is a read-only check. */
  Vault.convertBanks = function () {
    if (!Vault.ready) {
      Vault.lastConversion = { ts: Date.now(), skipped: Vault.unavailable ? 'webcrypto-unavailable' : 'no-vault-key' };
      return Promise.resolve(Vault.lastConversion);
    }
    return DB._allRaw('people').then(function (rows) {
      return B.convertBanksV61(rows, vaultDerive, Vault.kid).then(function (res) {
        var changedIds = {};
        var writes = res.people.map(function (row, i) {
          if (row === rows[i]) return null;
          changedIds[rows[i].id] = true;
          return DB._putRaw('people', row);
        }).filter(Boolean);
        return Promise.all(writes).then(function () {
          var report = {
            ts: Date.now(), banksConverted: res.banksConverted,
            banksAlreadySealed: res.banksAlreadySealed, banksFailed: res.banksFailed,
            templatesSealed: res.templatesSealed
          };
          Vault.lastConversion = report;
          try { localStorage.setItem(VAULT_REPORT_KEY, JSON.stringify(report)); } catch (e) {}
          if (!res.banksConverted) return report;
          return DB.all('people').then(function (people) {
            people.forEach(function (p) { if (changedIds[p.id]) Sync.noteProfile(p); });
            return Sync.flush();
          }).then(function () { return report; }).catch(function () { return report; });
        });
      });
    }).catch(function () { return Vault.lastConversion; });
  };
  Vault.statusMap = function () {
    return DB._allRaw('people').then(function (rows) {
      var map = {};
      rows.forEach(function (row) {
        if (!row || typeof row !== 'object' || !row.palmProfile) return;
        var st = B.bankTemplateState(row);
        var kid = null;
        var prof = row.palmProfile;
        var firstSealed = null;
        [prof.codes, prof.neural && prof.neural.embeddings, prof.legacyCodes].forEach(function (arr) {
          if (firstSealed || !Array.isArray(arr)) return;
          for (var i = 0; i < arr.length; i++) if (B.bankEncIsSealed(arr[i])) { firstSealed = arr[i]; break; }
        });
        if (firstSealed) kid = B.bankEncKidOf(firstSealed);
        var state = st.state;
        if (state === 'sealed' && kid && Vault.kid && kid !== Vault.kid) state = 'sealed-other';
        if (state === 'sealed' && !Vault.ready) state = 'sealed-other';
        map[row.id] = { state: state, total: st.total, sealed: st.sealed, name: row.name || '', kid: kid };
      });
      return map;
    }).catch(function () { return {}; });
  };
  Vault.statusFor = function (biomId) {
    return Vault.statusMap().then(function (map) {
      return map[biomId] ? map[biomId].state : 'none';
    });
  };
  Vault.completeSetup = function (passphrase) {
    if (!vaultRawHeld) return Promise.reject(new Error('The recovery sheet is no longer held on this device — import the sheet to restore the vault.'));
    var raw = vaultRawHeld;
    return B.vaultWrapKey(raw, passphrase).then(function (wrapped) {
      if (DB.useLS || !('indexedDB' in window)) {
        return vaultStoreWrite({ kid: Vault.kid, raw: raw, wrapped: wrapped, pendingAck: false, createdTs: Vault.createdTs })
          .then(function () {
            Vault.pendingAck = false; Vault.hasWrap = true;
            vaultRawHeld = null; // the sheet now opens only via the passphrase wrap
            return true;
          });
      }
      return B.vaultImportKey(raw, false).then(function (hardKey) {
        return vaultStoreWrite({ kid: Vault.kid, cryptoKey: hardKey, raw: null, wrapped: wrapped, pendingAck: false, createdTs: Vault.createdTs })
          .then(function () {
            Vault.key = hardKey;
            Vault._deriveCache = {};
            vaultRawHeld = null;
            Vault.pendingAck = false; Vault.hasWrap = true;
            return true;
          });
      });
    });
  };
  Vault.showRecovery = function (passphrase) {
    if (vaultRawHeld) return Promise.resolve(B.vaultRecoveryEncode(vaultRawHeld));
    return vaultStoreRead().then(function (rec) {
      if (!rec || !rec.wrapped) return null;
      return B.vaultUnwrapKey(rec.wrapped, passphrase).then(function (raw) {
        return raw ? B.vaultRecoveryEncode(raw) : null;
      });
    });
  };
  Vault.importSheet = function (codeText, passphrase) {
    var raw = B.vaultRecoveryDecode(codeText);
    if (!raw) return Promise.resolve({ ok: false, msg: 'That recovery sheet did not decode — check it and try again.' });
    return B.vaultKeyId(raw).then(function (kid) {
      if (Vault.ready && Vault.kid === kid) return { ok: true, msg: 'That is already this device\'s vault key.' };
      return Vault.statusMap().then(function (map) {
        var conflict = Object.keys(map).some(function (id) {
          var e = map[id];
          return (e.state === 'sealed' || e.state === 'sealed-other' || e.state === 'mixed') && e.kid && e.kid !== kid;
        });
        if (conflict) {
          return { ok: false, msg: 'This device holds banks sealed under a different vault key. Importing this sheet would leave them unreadable, so nothing was changed.' };
        }
        return B.vaultImportKey(raw, false).then(function (key) {
          var wrapP = passphrase ? B.vaultWrapKey(raw, passphrase) : Promise.resolve(null);
          return wrapP.then(function (wrapped) {
            var lsMode = DB.useLS || !('indexedDB' in window);
            return vaultStoreWrite({ kid: kid, cryptoKey: key, raw: lsMode ? raw : null, wrapped: wrapped, pendingAck: false, createdTs: Date.now() })
              .then(function () {
                Vault.key = key; Vault.kid = kid; Vault.ready = true;
                Vault.pendingAck = false; Vault.hasWrap = !!wrapped;
                Vault.createdTs = Date.now(); Vault._deriveCache = {};
                vaultRawHeld = null;
                return Vault.convertBanks().then(function () {
                  return { ok: true, msg: 'Vault restored from the recovery sheet. Banks sealed under this key open again; any encoded banks were sealed now.' };
                });
              });
          });
        });
      });
    }).catch(function () { return { ok: false, msg: 'The import failed — nothing was changed.' }; });
  };
  function vaultStateLabel(state) {
    return {
      'sealed': 'Encrypted (this device\'s vault key)',
      'sealed-other': 'Sealed under a different key — this device cannot open it',
      'encoded': 'Encoded only — not yet encrypted',
      'mixed': 'Partly encrypted — run the conversion to finish',
      'none': 'No palm bank'
    }[state] || state;
  }
  function renderVaultCard() {
    var st = $('vaultStatus');
    if (!st) return;
    var rep = Vault.lastConversion;
    if (!rep) { try { rep = JSON.parse(localStorage.getItem(VAULT_REPORT_KEY) || 'null'); } catch (e) { rep = null; } }
    var repEl = $('vaultReport');
    if (repEl) {
      repEl.textContent = !rep ? 'No conversion has run yet'
        : rep.skipped ? 'Skipped (' + rep.skipped + ')'
        : rep.banksConverted + ' bank(s) sealed, ' + rep.templatesSealed + ' template(s), ' +
          rep.banksAlreadySealed + ' already sealed, ' + rep.banksFailed + ' failed — ' + new Date(rep.ts).toLocaleString();
    }
    var setup = $('vaultSetup'), actions = $('vaultActions');
    if (Vault.unavailable) {
      st.textContent = 'Unavailable — this browser has no WebCrypto, so banks stay in their encoded form. Everything keeps working; nothing is sealed.';
      if (setup) setup.classList.add('hidden');
      if (actions) actions.classList.add('hidden');
    } else if (!Vault.ready) {
      st.textContent = 'Not available — the vault key could not be loaded. Banks stay in their encoded form and keep working.';
      if (setup) setup.classList.add('hidden');
      if (actions) actions.classList.add('hidden');
    } else {
      st.textContent = Vault.pendingAck
        ? 'Key created on this device — setup is NOT complete until you save the recovery sheet below.'
        : 'Active — banks are sealed as they save and opened as they load. Key id ' + String(Vault.kid).slice(0, 6) + '…';
      if (setup) setup.classList.toggle('hidden', !Vault.pendingAck);
      if (actions) actions.classList.remove('hidden');
      if (Vault.pendingAck && vaultRawHeld) {
        var sheetEl = $('vaultSheetSetup');
        if (sheetEl) sheetEl.textContent = B.vaultRecoveryEncode(vaultRawHeld) || '';
      }
    }
    Vault.statusMap().then(function (map) {
      var box = $('vaultBanks');
      if (!box) return;
      var ids = Object.keys(map);
      if (!ids.length) { box.innerHTML = '<p class="sub" style="margin:0">No enrolled banks on this device yet.</p>'; return; }
      box.innerHTML = ids.map(function (id) {
        var e = map[id];
        return '<div class="kv"><b>' + esc(e.name || id) + '</b> (' + esc(id) + '): ' + esc(vaultStateLabel(e.state)) +
          (e.total ? ' — ' + e.sealed + '/' + e.total + ' templates sealed' : '') + '</div>';
      }).join('');
    });
  }
  function wireVault() {
    var ackBtn = $('vaultAckBtn');
    if (ackBtn) ackBtn.addEventListener('click', function () {
      var msg = $('vaultSetupMsg');
      var p1 = $('vaultPass1') ? $('vaultPass1').value : '';
      var p2 = $('vaultPass2') ? $('vaultPass2').value : '';
      var typed = $('vaultAckInput') ? $('vaultAckInput').value.trim() : '';
      if (p1.length < 6) { if (msg) msg.textContent = 'Choose a passphrase of at least 6 characters.'; return; }
      if (p1 !== p2) { if (msg) msg.textContent = 'The two passphrases do not match.'; return; }
      if (typed !== 'SAVED') { if (msg) msg.textContent = 'Type SAVED to confirm you have saved the recovery sheet.'; return; }
      Vault.completeSetup(p1).then(function () {
        toast('Vault setup complete — the recovery sheet is now protected by your passphrase.');
        renderVaultCard();
      }).catch(function (e) { if (msg) msg.textContent = String(e && e.message || e); });
    });
    var convBtn = $('vaultConvertBtn');
    if (convBtn) convBtn.addEventListener('click', function () {
      Vault.convertBanks().then(function (rep) {
        toast(rep && rep.banksConverted ? 'Sealed ' + rep.banksConverted + ' bank(s).' : 'Conversion run — nothing new to seal.');
        renderVaultCard();
      });
    });
    var showBtn = $('vaultShowBtn');
    if (showBtn) showBtn.addEventListener('click', function () {
      var msg = $('vaultShowMsg');
      var pass = $('vaultShowPass') ? $('vaultShowPass').value : '';
      Vault.showRecovery(pass).then(function (sheet) {
        var view = $('vaultSheetView'), hide = $('vaultHideBtn');
        if (!sheet) { if (msg) msg.textContent = 'That passphrase did not open the sheet. If no passphrase was set at setup, the sheet exists only on the copy you saved.'; return; }
        if (msg) msg.textContent = '';
        if (view) { view.textContent = sheet; view.classList.remove('hidden'); }
        if (hide) hide.classList.remove('hidden');
      });
    });
    var hideBtn = $('vaultHideBtn');
    if (hideBtn) hideBtn.addEventListener('click', function () {
      var view = $('vaultSheetView');
      if (view) { view.textContent = ''; view.classList.add('hidden'); }
      hideBtn.classList.add('hidden');
    });
    var impBtn = $('vaultImportBtn');
    if (impBtn) impBtn.addEventListener('click', function () {
      var msg = $('vaultImportMsg');
      var code = $('vaultImportCode') ? $('vaultImportCode').value : '';
      var pass = $('vaultImportPass') ? $('vaultImportPass').value : '';
      Vault.importSheet(code, pass).then(function (res) {
        if (msg) msg.textContent = res.msg;
        if (res.ok) { toast('Vault import complete.'); renderVaultCard(); }
      });
    });
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
    stream: null, video: null, viewKey: null, _token: 0, _starting: null, _startVideo: null, _startKey: null, _startFacing: null,
    start: function (video, facingMode, viewKey) {
      // A second start for the same view AND the same facing while
      // one is already in flight (a double tap on the same toggle)
      // joins the in-flight start instead of racing it - racing
      // starts are what produced "The play() request was interrupted
      // by a new load request" on the phone (2026-11-20). v57: the
      // join is facing-aware — before, a quick Front->Back->Front
      // tap joined the FIRST start and the camera landed on the
      // opposite facing from the button state, which read as a
      // stuck switch. A start for a different facing now
      // supersedes; the token guard below stops the loser's
      // stream when it lands.
      if (this._starting && this._startVideo === video && this._startKey === (viewKey || null) && this._startFacing === facingMode) return this._starting;
      var token = ++this._token;
      // v57 NO BLACK GAP: the outgoing stream is NOT stopped up
      // front. It keeps rendering into the preview while the
      // replacement is acquired, and its tracks stop only once
      // the new stream is attached and playing — a Front/Back
      // switch is a clean cut between two live previews, never a
      // frozen black screen while the camera ladder runs. The
      // outgoing stream is released early in exactly two cases:
      // the ladder's NotReadableError retry (the old camera may
      // still hold the device — the precondition the pre-v57
      // entry stop() used to provide) and a start that fails
      // before attaching (a failed start leaves no camera
      // running, exactly as before v57).
      var prevVideo = this.video;
      var prevStream = this.stream;
      var replacing = !!(prevStream && prevVideo === video);
      var attached = false;
      var outgoingReleased = false;
      var self = this;
      function releaseOutgoing() {
        if (outgoingReleased) return;
        outgoingReleased = true;
        if (prevStream) prevStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        if (self.stream === prevStream) self.stream = null;
        if (prevVideo && prevVideo !== video && prevVideo.srcObject === prevStream) { try { prevVideo.srcObject = null; } catch (e) {} }
      }
      this.video = video;
      this.viewKey = viewKey || null;
      // Preview mirroring is DISPLAY ONLY and only for the front
      // camera. Captures always use the raw video frame (drawImage
      // / detectors read the untransformed pixels), so enrolling on
      // one camera and verifying on the other still compares
      // consistently. v57: the class is applied when the new stream
      // ATTACHES (in the chain below), from the attached track's
      // own reported facing when the device reports one — the
      // constraint ladder can land on a fallback camera, and
      // flipping the class at request time would mirror the
      // still-running outgoing preview for the whole switch.
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
        // v57: when this start REPLACES a live stream on the same
        // element (a Front/Back switch), the new facing is asked
        // as a preference FIRST and the exact request second —
        // the exact-first order pays the multi-lens Android
        // OverconstrainedError round trip (the v17 note above) on
        // every tap, before the camera that works is even asked.
        // A cold start keeps the v17 order exactly. Either way
        // the ladder then falls to any camera, and the
        // NotReadableError retry releases the outgoing camera
        // before waiting, restoring the precondition the pre-v57
        // entry stop() provided.
        var firstExact = !replacing;
        return gum(facingMode, firstExact).catch(function (e1) {
          if (e1 && (e1.name === 'OverconstrainedError' || e1.name === 'NotFoundError')) return gum(facingMode, !firstExact);
          throw e1;
        }).catch(function (e2) {
          if (e2 && (e2.name === 'OverconstrainedError' || e2.name === 'NotFoundError')) return gum(null, false);
          throw e2;
        }).catch(function (e3) {
          if (e3 && e3.name === 'NotReadableError') {
            releaseOutgoing();
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
        attached = true;
        // v57: the mirror follows the camera that actually
        // attached — the track's own reported facing when it
        // reports one, else the requested facing. The ladder's
        // fallback can land on the other side, and the preview
        // must never sit mirrored for a camera that is not the
        // front one (or unmirrored for the front one).
        var track0 = stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
        var trackFacing = null;
        try { trackFacing = track0 && track0.getSettings ? track0.getSettings().facingMode : null; } catch (e) {}
        video.classList.toggle('mirror', (trackFacing === 'user' || trackFacing === 'environment') ? trackFacing === 'user' : facingMode === 'user');
        return playWithRetry().then(function () {
          // v57: the new stream is on screen — the outgoing
          // stream's tracks stop now, and not a moment before.
          releaseOutgoing();
          // Capture tuning FIRST (v48): it issues its own
          // applyConstraints call, and a later call that does not
          // mention torch can drop an already-lit torch back off —
          // so the flash application below runs LAST, on the final
          // track state.
          return applyCaptureTuning(stream);
        }, function (err) {
          releaseOutgoing();
          throw err;
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
        // v57: a start that failed BEFORE attaching leaves no
        // camera running (the guarantee the pre-v57 entry stop()
        // gave, restored on the failure path now that the entry
        // no longer stops anything). A superseded start touches
        // nothing — the newer start owns the outgoing stream.
        if (!attached && token === Cam._token) releaseOutgoing();
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
      this._startFacing = facingMode;
      var clear = function () { if (Cam._starting === bounded) { Cam._starting = null; Cam._startVideo = null; Cam._startKey = null; Cam._startFacing = null; } };
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
      var on = b.dataset.facing === camFacing[key === 'terminal' ? termFacingKey() : key];
      b.classList.toggle('on', on);
      /* v64 (Seat 1 A-1): the toggle state is published to assistive
         tech, not carried by the .on class alone. */
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
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
          var liveRestart = !!(restart && Cam.stream && Cam.video === $(videoId));
          // v57: with a live restart the mirror is NOT flipped
          // here — Cam.start applies it when the new stream
          // attaches, from the attached track's own facing.
          // Flipping it at tap time would mirror the still-running
          // outgoing camera's preview for the whole switch.
          if (!liveRestart) applyMirror(videoId, b.dataset.facing);
          if (liveRestart) restart();
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
      var on = (b.dataset.flash === 'on') === !!flashState[key];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
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
    /* v77: assigning canvas.width (even the same value) clears
       and reallocates the backing store — only assign on change.
       The computed size is identical to before, so the analysed
       frame is pixel-identical. */
    var aw = Math.round(w * scale), ah = Math.round(h * scale);
    if (analysisScratch.width !== aw) analysisScratch.width = aw;
    if (analysisScratch.height !== ah) analysisScratch.height = ah;
    analysisScratch.getContext('2d').drawImage(image, 0, 0, analysisScratch.width, analysisScratch.height);
    return analysisScratch;
  }

  /* ---------------- Detector runtime assembly (v68) --------------
     The five MediaPipe BINARY runtime files (the two WASM
     binaries, the packed-assets data file, the landmark model
     and the graph) cannot travel through the text-only channel
     that ships this app, so on the live host they answered 404
     and the detector could never run at all — every detector
     failure then looked exactly like "no hand" (the root cause
     of the Chairman's 2026-11-26 camera-loop report, and of the
     honest detector-blocked state his screenshot showed once
     v67 stopped the looping). The binaries now travel the way
     the PalmNet weights already do: base64 text parts under
     vendor/mediapipe-hands-0.4.1675469240/parts/, reassembled
     here in the browser before the Hands solution is
     constructed, and handed to MediaPipe as one Blob URL per
     file through locateFile. Everything is served from this
     origin — no CDN, no third-party hotlink (TSG-ONLY
     directive). Each file's byte length and SHA-256 are pinned
     IN CODE below, exactly as the PalmNet pins are held: the
     parts manifest is checked against the pins before any part
     is fetched, and every assembled file is length- and
     hash-verified before its Blob URL exists. Any failure —
     manifest or part fetch, a pin disagreement, a size or hash
     mismatch, no SubtleCrypto — resolves to "not ready" and
     PalmProc's calls land in the v67 detector-health path: the
     honest detector message, never a silent "no hand". */
  var MP_PARTS_DIR = 'vendor/mediapipe-hands-0.4.1675469240/parts/';
  var MP_EXPECTED_FILES = [
    { name: 'hands.binarypb', bytes: 550, sha256: 'ab76c4215fca99cc2db1b5885cb8398d210e59ebe685245f72e692b4b58421e4', mime: 'application/octet-stream' },
    { name: 'hand_landmark_lite.tflite', bytes: 2071408, sha256: 'd7fde8ac11f8ce03f8663775bfc323f4fc9f2a38062b4f4efa142874ef5b2a48', mime: 'application/octet-stream' },
    { name: 'hands_solution_packed_assets.data', bytes: 4326731, sha256: 'bdce7b66bfc5b39ba86a47775c98e0b186fe73f8308c2279f852af4c89ffdf42', mime: 'application/octet-stream' },
    { name: 'hands_solution_simd_wasm_bin.wasm', bytes: 6026259, sha256: '78ef7eb86ebc6424ac06b13f89b9a1fc01ff35e07520e37de98887cf88c06653', mime: 'application/wasm' },
    { name: 'hands_solution_wasm_bin.wasm', bytes: 5917209, sha256: '4e70eaf8063e0e9ac10e682d9d6b55c08d0788f0a8d49925e2e484636526e157', mime: 'application/wasm' }
  ];
  function mpB64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  /* v77: chunked twin of mpB64ToBytes for the assembly path.
     The five pinned files carry ~21 MB of base64; the one-shot
     atob + per-char copy measured as the boot profile's worst
     long tasks (622 ms / 540 ms / 432 ms at 4x CPU throttle).
     This decoder walks the base64 text in 256 KB quanta-aligned
     slices and yields to the main thread between slices, so no
     single task exceeds a frame storm while the detector loads.
     It is byte-exact by construction (standard base64 arithmetic,
     padding handled by the output-length guard) and the result
     still faces the same length check and the pinned SHA-256
     verification before any Blob URL exists — a decoder bug
     would fail closed exactly like a corrupted part. */
  var MP_B64_TABLE = null;
  function mpB64ToBytesChunked(b64) {
    if (!MP_B64_TABLE) {
      MP_B64_TABLE = new Int16Array(128).fill(-1);
      var alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      for (var t = 0; t < alpha.length; t++) MP_B64_TABLE[alpha.charCodeAt(t)] = t;
      MP_B64_TABLE[61] = 0; // '=' padding contributes zero bits; the output-length guard drops its bytes (a -1 here would smear 1-bits into the final group)
    }
    var table = MP_B64_TABLE;
    var len = b64.length;
    var pad = 0;
    if (len >= 1 && b64.charCodeAt(len - 1) === 61) pad++;
    if (len >= 2 && b64.charCodeAt(len - 2) === 61) pad++;
    var out = new Uint8Array((len / 4) * 3 - pad);
    var SLICE = 262144; // chars per task — a multiple of 4 (one quantum = 4 chars)
    var i = 0, o = 0;
    function step() {
      var end = Math.min(i + SLICE, len);
      for (; i < end; i += 4) {
        var n = (table[b64.charCodeAt(i)] << 18) | (table[b64.charCodeAt(i + 1)] << 12) |
                (table[b64.charCodeAt(i + 2)] << 6) | table[b64.charCodeAt(i + 3)];
        if (o < out.length) out[o++] = (n >> 16) & 255;
        if (o < out.length) out[o++] = (n >> 8) & 255;
        if (o < out.length) out[o++] = n & 255;
      }
      if (i < len) return new Promise(function (res) { setTimeout(res, 0); }).then(step);
      return out;
    }
    return Promise.resolve().then(step);
  }
  function mpSha256Hex(bytes) {
    if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.subtle.digest) {
      return Promise.reject(new Error('detector integrity check unavailable (no SubtleCrypto) — the detector is disabled for this load rather than run unverified'));
    }
    return crypto.subtle.digest('SHA-256', bytes).then(function (h) {
      var hex = ''; var hv = new Uint8Array(h);
      for (var i = 0; i < hv.length; i++) hex += ('0' + hv[i].toString(16)).slice(-2);
      return hex;
    });
  }
  var MpRuntime = {
    state: 'idle', // idle | loading | ready | failed
    failReason: '',
    urls: null, // filename -> Blob URL, exactly the five pinned names
    promise: null,
    /* Resolves true once every pinned file is assembled and
       verified; false on any failure. A failed attempt clears
       its own promise so a LATER scan can retry (a transient
       network failure must not brick the detector for the whole
       session — the honest message itself invites a retry);
       concurrent calls share the one in-flight attempt. */
    ensure: function () {
      if (this.urls) return Promise.resolve(true);
      if (this.promise) return this.promise;
      var self = this;
      this.state = 'loading';
      this.promise = this.assemble().then(function (urls) {
        self.urls = urls;
        self.state = 'ready';
        self.promise = null;
        return true;
      }, function (e) {
        self.state = 'failed';
        self.failReason = e && e.message ? e.message : String(e);
        self.promise = null;
        return false;
      });
      return this.promise;
    },
    assemble: function () {
      var self = this;
      var work = fetch(MP_PARTS_DIR + 'manifest.json').then(function (r) {
        if (!r.ok) throw new Error('detector parts manifest HTTP ' + r.status);
        return r.json();
      }).then(function (man) {
        var listed = {};
        (man.files || []).forEach(function (f) { listed[f.name] = f; });
        /* The manifest must name exactly the pinned set, with
           the pinned sizes and hashes — checked before any part
           is fetched, on the same fail-closed terms as the
           PalmNet manifest pre-check. */
        var jobs = MP_EXPECTED_FILES.map(function (exp) {
          var f = listed[exp.name];
          if (!f) throw new Error('detector parts manifest is missing ' + exp.name);
          if (f.bytes !== exp.bytes || f.sha256 !== exp.sha256) {
            throw new Error('detector parts manifest disagrees with this build for ' + exp.name + ' — the detector is disabled for this load');
          }
          delete listed[exp.name];
          return self.assembleFile(exp, f);
        });
        if (Object.keys(listed).length) throw new Error('detector parts manifest lists files this build does not run');
        return Promise.all(jobs);
      }).then(function (urlsArr) {
        var urls = {};
        MP_EXPECTED_FILES.forEach(function (exp, i) { urls[exp.name] = urlsArr[i]; });
        return urls;
      });
      /* One bound for the whole assembly: a scan must never
         wait forever on runtime files (the v67 doctrine). */
      return Promise.race([work, new Promise(function (resolve, reject) {
        setTimeout(function () { reject(new Error('detector runtime assembly timed out')); }, 90000);
      })]);
    },
    assembleFile: function (exp, f) {
      return Promise.all((f.parts || []).map(function (p) {
        return fetch(MP_PARTS_DIR + p).then(function (r) {
          if (!r.ok) throw new Error('detector part HTTP ' + r.status + ' (' + p + ')');
          return r.text();
        });
      })).then(function (texts) {
        return mpB64ToBytesChunked(texts.join('').replace(/\s+/g, ''));
      }).then(function (bytes) {
        if (bytes.length !== exp.bytes) throw new Error('detector file size mismatch (' + exp.name + ': ' + bytes.length + ' != ' + exp.bytes + ')');
        return mpSha256Hex(bytes).then(function (hex) {
          if (hex !== exp.sha256) throw new Error('detector file hash mismatch (' + exp.name + ')');
          return URL.createObjectURL(new Blob([bytes], { type: exp.mime }));
        });
      });
    }
  };

  var PalmProc = {
    hands: null, pending: null, _mpLabel: null, _frameFailed: false, _everResulted: false,
    /* v67: per-call detector health. lastCallFailed() tells
       whether the most recent landmarks call actually RAN the
       detector (its results callback fired — hand found or
       genuinely no hand) or FAILED (the send rejected, the
       results never arrived, the runtime would not construct).
       Each scan stream counts its OWN consecutive failed frames
       and ends with the honest detector message at three —
       never a "no hand" verdict for a detector that could not
       look. The count is deliberately per-stream, not global:
       warm-up calls made while the runtime is still loading
       can fail without poisoning a scan that starts later
       (measured in the rig, 2026-11-26: boot warm-up failures
       during the ~10 s cold load otherwise ended every first
       scan instantly with a false detector verdict). */
    lastCallFailed: function () { return this._frameFailed; },
    /* v51: MediaPipe's own handedness label from the most recent
       results event, exposed for the cross-check in
       analysePalmFrame (B.palmMpHandedness). Diagnostic only —
       the anatomical hand that gates is the geometric reading
       (B.palmAnatomicalHand); this label never decides anything. */
    lastHandedness: function () { return this._mpLabel || null; },
    init: function () {
      /* v68: construction waits on the runtime assembly
         (MpRuntime) — init() is now the fire-and-forget warm-up
         the pre-warm call sites have always treated it as; the
         scan path itself awaits ensureHands() inside
         landmarks(). */
      this.ensureHands();
    },
    /* Resolves true once the Hands instance exists (runtime
       assembled + verified, solution constructed); false when
       the detector cannot run — the caller marks the frame
       failed and the v67 per-stream counting ends the scan
       with the honest detector message. A failed attempt is
       not cached, so a later scan retries the assembly. */
    ensureHands: function () {
      if (this.hands) return Promise.resolve(true);
      if (this._initPromise) return this._initPromise;
      var self = this;
      this._initPromise = MpRuntime.ensure().then(function (ok) {
        self._initPromise = null;
        if (!ok) return false;
        try { self.construct(); } catch (e) { return false; }
        return !!self.hands;
      }, function () { self._initPromise = null; return false; });
      return this._initPromise;
    },
    construct: function () {
      if (this.hands) return;
      var self = this;
      /* v64 (Phase A Step 5.1, Seat 2 H-1): MediaPipe is SELF-HOSTED
         under vendor/ — no third-party code executes in this origin.
         v68: the five binary files resolve to their assembled,
         hash-verified Blob URLs; every other file keeps its
         vendored path. */
      this.hands = new Hands({ locateFile: function (f) {
        var assembled = MpRuntime.urls && MpRuntime.urls[f];
        return assembled || ('vendor/mediapipe-hands-0.4.1675469240/' + f);
      } });
      // v25 A/B: lite landmark model (complexity 0) - the full model
      // is the per-frame bottleneck on a budget phone CPU.
      this.hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      this.hands.onResults(function (res) {
        self._everResulted = true; // v67: the runtime finished loading and ran
        self._frameFailed = false; // v67: this call ran the detector — healthy, hand or no hand
        var p = self.pending; self.pending = null;
        self._mpLabel = (res.multiHandedness && res.multiHandedness[0] && res.multiHandedness[0].label) || null;
        if (p) p((res.multiHandLandmarks && res.multiHandLandmarks[0]) ? res.multiHandLandmarks[0] : null);
      });
    },
    landmarks: function (image) {
      var self = this;
      // v68: the call first waits for the runtime assembly +
      // construction (ensureHands). A detector that cannot run
      // — assembly failed, or the Hands global missing so
      // construction threw — marks the call failed and answers
      // no-landmarks, never throws into the scan (the v67 rule,
      // unchanged).
      return this.ensureHands().then(function (ok) {
        if (!ok) { self._frameFailed = true; return null; }
        if (self._everResulted) return self.sendFrame(image);
        /* v77 (Seat 3, single-flight warm-up): MediaPipe's
           SolutionBase.initialize() is NOT re-entrancy-safe
           while its first load is in flight — every send()
           that arrives during the cold load re-enters it and
           runs a complete second initialise pass, and the
           racing passes corrupt each other's bookkeeping
           (the boot page-error family: the packed-assets
           loader's dataFileDownloads read, and the Emscripten
           FS 'buffer' collision — reproduced live by Seat 3,
           2026-11-27). Until the first result lands, sends
           therefore CHAIN: each caller waits for the previous
           send to settle, then sends its own frame. The
           initialise runs exactly once; after warm-up this
           branch is never taken again. Scan streams already
           await each frame, so the chain costs them nothing;
           what it removes is the duplicate 4.3 MB package
           downloads, duplicate WASM compiles, and the wedged-
           instance risk the race carried. */
        var run = function () { return self.sendFrame(image); };
        var p = (self._warmChain || Promise.resolve()).then(run, run);
        self._warmChain = p.then(function () {}, function () {});
        return p;
      });
    },
    sendFrame: function (image) {
      var self = this;
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
        // v67 (Chairman's scan-reliability order, 2026-11-26): the
        // rebuild now applies ONLY to a graph that has already
        // delivered results — a wedged live graph. An instance
        // still in its FIRST load (runtime files still arriving:
        // ~10 s cold on a slow device, measured in the rig) is
        // never torn down: the rebuild's asset preload raced the
        // first load's preload inside the shared runtime module
        // and corrupted it, after which no construction in the
        // page session could ever detect a hand — the detector
        // silently reported "no hand" on every camera forever.
        // A still-loading frame simply waits (45 s bound) and
        // counts as no-hand if the load truly never lands; the
        // failure counter feeds the honest detector message.
        var to = setTimeout(function () {
          self._frameFailed = true; // v67: results never arrived — the detector did not run
          if (self._everResulted) {
            try { if (self.hands && self.hands.close) self.hands.close(); } catch (e) {}
            self.hands = null;
          }
          finish(null);
        }, self._everResulted ? 4000 : 45000);
        self.pending = finish;
        self.hands.send({ image: analysisImage(image) }).catch(function () { self._frameFailed = true; finish(null); });
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
    var gw = Math.round(w * scale), gh = Math.round(h * scale);
    if (canvas.width !== gw) canvas.width = gw; // v77: no backing-store realloc when the size is unchanged
    if (canvas.height !== gh) canvas.height = gh;
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
      /* v77: size-guarded assignment — the same two assignments,
         made only when the size actually changed (assigning
         canvas.width clears and reallocates the backing store). */
      if (measuresScratch.width !== size || measuresScratch.height !== size) { measuresScratch.width = size; measuresScratch.height = size; }
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
      if (roiScratch.width !== cw) roiScratch.width = cw; // v77: size-guarded (see analysisImage)
      if (roiScratch.height !== ch) roiScratch.height = ch;
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

  /* PalmNet neural runtime (v47; v65 engine): the PalmNet model
     (see the PalmNet section in biometrics.js for what the model
     is and where its threshold came from) runs on TSG's OWN Palm
     Engine — the dedicated inference runtime in biometrics.js.
     v47–v64 ran it on ONNX Runtime Web (CDN, then self-hosted);
     v65 removes that third-party runtime entirely under the
     TSG-ONLY property directive, through the parity gate (zero
     verdict differences at the 0.5895 bar on the full bench EVAL
     protocol). The model lives IN THIS REPO under models/palmnet/
     as the TSGP container (program.json + base64 text parts of
     the weights blob + a manifest; the snapshot-push channel
     that ships this app carries UTF-8 text only, so the weights
     travel as text and are reassembled and verified in memory
     against the hashes pinned in code below).

     Inference runs in a dedicated worker so it can never block
     the scan loop; the worker is assembled from TSG source only
     (B.palmEngineSource + B.palmnetPreprocessSource — the very
     functions the parity suite proves against the Python
     training pipeline). If the worker cannot be built or dies,
     the same engine is created on the main thread as a fallback
     (it is a fallback, not the plan).

     FAIL-SOFT BY CONSTRUCTION: every failure — no Worker, model
     fetch/size/hash failure, engine error, a hung call —
     resolves to "no neural evidence" and flips state to 'failed'
     with a plain reason. The scan paths treat that exactly like
     a profile with no neural bank: the app behaves as v46, EDCC
     only, and diagnostics carry the honest status note
     (PalmNet.statusNote). Nothing here ever throws into a scan,
     an enrolment or a wallet flow. */
  function palmnetWorkerMain() {
    // Runs INSIDE the PalmNet worker. In scope there:
    // createTsgPalmEngine (via B.palmEngineSource — TSG's own
    // inference runtime, v65) and palmnetPreprocessRoi /
    // PALMNET_INPUT_SIZE (via B.palmnetPreprocessSource) —
    // nothing from app.js, and no third-party code at all.
    var engine = null;
    /* v77: bounded fetch, defined INSIDE the worker main. This
       function is stringified into the worker (initWorker), so
       it must stay fully self-contained — no app.js helpers
       exist in that scope. (An earlier v77 edit referenced the
       main thread's fetchWithTimeout here; the v55 harness,
       which runs this function exactly as the worker does,
       caught it before it shipped.) */
    function fetchBounded(url, ms) {
      if (typeof AbortController === 'undefined') return fetch(url);
      var ctl = new AbortController();
      var timer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, ms || 30000);
      return fetch(url, { signal: ctl.signal }).then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; });
    }
    function b64ToBytes(b64) {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    function sha256Hex(bytes) {
      if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.subtle.digest) {
        return Promise.reject(new Error('model integrity check unavailable (no SubtleCrypto) — neural matching is disabled for this load'));
      }
      return crypto.subtle.digest('SHA-256', bytes).then(function (h) {
        var hex = '';
        var hv = new Uint8Array(h);
        for (var i = 0; i < hv.length; i++) hex += ('0' + hv[i].toString(16)).slice(-2);
        return hex;
      });
    }
    function loadModel(manifestUrl, expectedModelId, expectedWeightsSha256, expectedWeightsBytes, expectedProgramSha256) {
      return fetchBounded(manifestUrl, 30000).then(function (r) { // v77: bounded
        if (!r.ok) throw new Error('model manifest HTTP ' + r.status);
        return r.json();
      }).then(function (man) {
        // v55 (AUDIT-v54.md, Defect 3): a manifest that NAMES a
        // different model than this build runs is refused here,
        // before any part is fetched — the engine is never
        // created, the rejection lands in PalmNet's fail-soft
        // state with this reason, and the app runs EDCC-only
        // with the mismatch stated in the status note. A
        // manifest with NO modelId keeps the pre-v55 behaviour
        // (older manifests stay loadable).
        if (man.modelId && expectedModelId && man.modelId !== expectedModelId) {
          throw new Error('PalmNet model mismatch: this build runs ' + expectedModelId + ' but the served model is ' + man.modelId + ' — neural matching is disabled for this load rather than run a model under the wrong bar');
        }
        // v64 (Seat 2 H-5): a manifest whose recorded hash disagrees
        // with the hash pinned in this build's code is refused before
        // any part is fetched, on the same fail-soft terms. v65: the
        // pin is the TSGP container's weights hash.
        if (man.weightsSha256 && expectedWeightsSha256 && man.weightsSha256 !== expectedWeightsSha256) {
          throw new Error('PalmNet model hash mismatch: the served manifest records a different model than this build runs — neural matching is disabled for this load');
        }
        var base = manifestUrl.replace(/[^/]*$/, '');
        // The program (the engine's schedule) is integrity-checked
        // against its own code pin before the weights are fetched:
        // the schedule IS code, exactly as the weights are.
        return fetchBounded(base + man.programFile, 30000).then(function (r) { // v77: bounded
          if (!r.ok) throw new Error('model program HTTP ' + r.status);
          return r.text();
        }).then(function (programText) {
          var programBytes = new TextEncoder().encode(programText);
          return sha256Hex(programBytes).then(function (phex) {
            if (expectedProgramSha256 && phex !== expectedProgramSha256) throw new Error('model program hash mismatch');
            var program = JSON.parse(programText);
            return Promise.all(man.parts.map(function (p) {
              return fetchBounded(base + p, 30000).then(function (r) { // v77: bounded
                if (!r.ok) throw new Error('model part HTTP ' + r.status);
                return r.text();
              });
            })).then(function (texts) {
              var bytes = b64ToBytes(texts.join(''));
              if (bytes.length !== man.weightsBytes) throw new Error('model size mismatch (' + bytes.length + ' != ' + man.weightsBytes + ')');
              if (expectedWeightsBytes && bytes.length !== expectedWeightsBytes) throw new Error('model size mismatch (' + bytes.length + ' != pinned ' + expectedWeightsBytes + ')');
              return sha256Hex(bytes).then(function (hex) {
                if (hex !== (expectedWeightsSha256 || man.weightsSha256)) throw new Error('model hash mismatch');
                return createTsgPalmEngine().load(program, bytes.buffer);
              });
            });
          });
        });
      });
    }
    function runOne(roi, size) {
      var input = palmnetPreprocessRoi(roi, size);
      if (!input) return Promise.resolve(null);
      try {
        var out = engine.run(input, [1, 3, PALMNET_INPUT_SIZE, PALMNET_INPUT_SIZE]);
        return Promise.resolve(Array.prototype.slice.call(out.data));
      } catch (e) { return Promise.resolve(null); }
    }
    onmessage = function (e) {
      var d = e.data || {};
      if (d.type === 'init') {
        loadModel(d.manifestUrl, d.expectedModelId, d.expectedWeightsSha256, d.expectedWeightsBytes, d.expectedProgramSha256).then(function (eng) {
          engine = eng;
          postMessage({ type: 'ready' });
        }, function (err) {
          postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
        });
      } else if (d.type === 'embed') {
        if (!engine) { postMessage({ type: 'emb', id: d.id, emb: null, embM: null }); return; }
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
  /* v55 (AUDIT-v54.md, Defect 3): the model id this build
     runs — the same named constant that stamps every bank
     (B.PALMNET_MODEL_ID, defined beside PALMNET_THRESHOLD in
     biometrics.js). Both load paths check the served
     manifest against it: a manifest naming any other model
     is refused (fail-soft to EDCC with the mismatch in the
     status note), so a mixed update can never run a model
     under the wrong bar or write banks under the wrong
     stamp. A manifest with no modelId loads as before. */
  var PALMNET_EXPECTED_MODEL_ID = B.PALMNET_MODEL_ID;
  /* v64 (Seat 2 H-5): the model's expected SHA-256 and byte length are
     pinned IN CODE, beside the model id — not read from the runtime-
     fetched manifest. The 0.5895 bar is specific to these exact bytes,
     so the model IS code: a model change requires a code change. Both
     loader paths (worker + main-thread fallback) verify length AND
     hash against these constants before any engine is created, and a
     context without SubtleCrypto fails soft to EDCC-only — the check
     is never silently skipped.
     v65 (TSG-ONLY programme): the pinned values are now the TSGP
     container's — the WEIGHTS blob hash/length and the PROGRAM
     (schedule) hash. The weights are a byte-exact repack of the
     v54 Round 3 ONNX model (per-tensor max diff 0.0), and the
     engine passed the parity gate at these pins, so the bar and
     every banked embedding stand unchanged. */
  var PALMNET_EXPECTED_SHA256 = 'e050a574a8b32c3e6ca234c6590c2e1a2f0dd6d4858400f74335a3967bb2812d';
  var PALMNET_EXPECTED_BYTES = 4278756;
  var PALMNET_EXPECTED_PROGRAM_SHA256 = 'ebbf5a29d98f882f14960bd6ac7a8045b5195d07e76d0a584b7f50b5dc4b8aad';
  var PalmNet = {
    state: 'idle', // idle | loading | ready | failed
    failReason: '',
    /* v65: the model runs on TSG's own Palm Engine (biometrics.js);
       there is no runtime URL and no third-party code to load. */
    modelManifest: 'models/palmnet/manifest.json',
    w: null, seq: 0, pending: {},
    engine: null, // main-thread fallback engine (B.createTsgPalmEngine)
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
          /* v65: the worker source is TSG code only — the Palm
             Engine factory and the preprocess functions, both
             stringified from biometrics.js, plus the worker main.
             (v64's absolutised vendor URLs are gone with the
             runtime they loaded.) */
          var src = B.palmEngineSource() +
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
          self.w.postMessage({ type: 'init', manifestUrl: new URL(self.modelManifest, window.location.href).href, expectedModelId: PALMNET_EXPECTED_MODEL_ID, expectedWeightsSha256: PALMNET_EXPECTED_SHA256, expectedWeightsBytes: PALMNET_EXPECTED_BYTES, expectedProgramSha256: PALMNET_EXPECTED_PROGRAM_SHA256 });
        } catch (e) {
          if (!settled) { settled = true; clearTimeout(to); reject(e); }
        }
      });
    },
    /* v65: fetch + verify the TSGP container (program + weights)
       for the main-thread fallback. The checks are the worker
       loader's, verbatim in effect: model id, manifest weights
       hash vs the code pin, program hash vs its code pin, weights
       length vs manifest AND pin, weights SHA-256 vs the pin —
       and without SubtleCrypto the load fails soft to EDCC-only
       instead of running unverified bytes (v64 H-5 discipline). */
    fetchModelContainer: function () {
      var self = this;
      function sha256Hex(bytes) {
        if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.subtle.digest) {
          return Promise.reject(new Error('model integrity check unavailable (no SubtleCrypto) — neural matching is disabled for this load'));
        }
        return crypto.subtle.digest('SHA-256', bytes).then(function (h) {
          var hex = '';
          var hv = new Uint8Array(h);
          for (var i = 0; i < hv.length; i++) hex += ('0' + hv[i].toString(16)).slice(-2);
          return hex;
        });
      }
      return fetchWithTimeout(self.modelManifest, null, 30000).then(function (r) { // v77: bounded
        if (!r.ok) throw new Error('model manifest HTTP ' + r.status);
        return r.json();
      }).then(function (man) {
        // v55: the same model-id check as the worker loader —
        // a manifest naming a different model than this build
        // runs is refused before any part is fetched, and the
        // rejection surfaces through PalmNet's fail-soft state.
        if (man.modelId && man.modelId !== PALMNET_EXPECTED_MODEL_ID) {
          throw new Error('PalmNet model mismatch: this build runs ' + PALMNET_EXPECTED_MODEL_ID + ' but the served model is ' + man.modelId + ' — neural matching is disabled for this load rather than run a model under the wrong bar');
        }
        // v64 (Seat 2 H-5): the same code-pinned hash screen as the
        // worker loader — a manifest recording a different hash than
        // the build's pin is refused before any part is fetched.
        if (man.weightsSha256 && man.weightsSha256 !== PALMNET_EXPECTED_SHA256) {
          throw new Error('PalmNet model hash mismatch: the served manifest records a different model than this build runs — neural matching is disabled for this load');
        }
        var base = self.modelManifest.replace(/[^/]*$/, '');
        return fetchWithTimeout(base + man.programFile, null, 30000).then(function (r) { // v77: bounded
          if (!r.ok) throw new Error('model program HTTP ' + r.status);
          return r.text();
        }).then(function (programText) {
          return sha256Hex(new TextEncoder().encode(programText)).then(function (phex) {
            if (phex !== PALMNET_EXPECTED_PROGRAM_SHA256) throw new Error('model program hash mismatch');
            var program = JSON.parse(programText);
            return Promise.all(man.parts.map(function (p) {
              return fetchWithTimeout(base + p, null, 30000).then(function (r) { // v77: bounded
                if (!r.ok) throw new Error('model part HTTP ' + r.status);
                return r.text();
              });
            })).then(function (texts) {
              var bin = atob(texts.join(''));
              var bytes = new Uint8Array(bin.length);
              for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              if (bytes.length !== man.weightsBytes) throw new Error('model size mismatch (' + bytes.length + ' != ' + man.weightsBytes + ')');
              if (bytes.length !== PALMNET_EXPECTED_BYTES) throw new Error('model size mismatch (' + bytes.length + ' != pinned ' + PALMNET_EXPECTED_BYTES + ')');
              return sha256Hex(bytes).then(function (hex) {
                if (hex !== PALMNET_EXPECTED_SHA256) throw new Error('model hash mismatch');
                return { program: program, bytes: bytes };
              });
            });
          });
        });
      });
    },
    initMainThread: function () {
      var self = this;
      // v49 freeze-proofing: the worker path is bounded (45 s in
      // initWorker) and per-call embeds are bounded (4 s worker /
      // 6 s race in embedPair); this main-thread fallback keeps
      // the same 60 s bound, so PalmNet.init() can never sit in
      // 'loading' forever — a timeout rejects into init()'s catch,
      // the state flips to 'failed' with the reason, and the app
      // runs EDCC-only: the designed fail-soft. v65: the fallback
      // engine is TSG's own (B.createTsgPalmEngine), created
      // synchronously from the verified container.
      return B.withTimeout(this.fetchModelContainer().then(function (c) {
        self.engine = B.createTsgPalmEngine().load(c.program, c.bytes.buffer);
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
        if (!input || !self.engine) return Promise.resolve(null);
        try {
          var out = self.engine.run(input, [1, 3, B.PALMNET_INPUT_SIZE, B.PALMNET_INPUT_SIZE]);
          return Promise.resolve(B.palmnetNormaliseEmbedding(Array.prototype.slice.call(out.data)));
        } catch (e) { return Promise.resolve(null); }
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
        if (self.engine) return self.embedOnMain(roi, flipped);
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
    /* v67 deep pre-warm (the 2-second scan programme): the
       first landmarks call above pays MediaPipe's detection
       branch; a SECOND call pays the tracking branch a real
       scan would otherwise meet first, and one PalmNet
       embedding on a flat-grey dummy ROI pays the TSG
       engine's first-run cost (worker spin-up beyond init,
       kernel JIT) off the scan path entirely. Dummy inputs
       only — nothing is recorded, matched, logged or stored,
       and every failure is silent: the scan path initialises
       everything itself, exactly as before. */
    try {
      var dc = document.createElement('canvas');
      dc.width = 96; dc.height = 96;
      var dctx = dc.getContext('2d');
      dctx.fillStyle = '#7a7a7a'; dctx.fillRect(0, 0, 96, 96);
      PalmProc.landmarks(dc).then(function () { return PalmProc.landmarks(dc); }).then(function () {}, function () {});
    } catch (e) {}
    try {
      var dummyRoi = new Uint8Array(B.PALMPRINT_ROI_SIZE * B.PALMPRINT_ROI_SIZE);
      for (var di = 0; di < dummyRoi.length; di++) dummyRoi[di] = 128;
      PalmNet.init().then(function (ok) {
        if (ok) return PalmNet.embedPair(dummyRoi);
      }).then(function () {}, function () {});
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
      // v67: whether the detector itself failed on this frame
      // (vs ran and found nothing) rides the frame result; the
      // scan streams count their own consecutive failures.
      var detFailed = PalmProc.lastCallFailed();
      if (!lm) return { openness: null, descriptor: null, code: null, codeM: null, roi: null, sharpness: 0, texture: null, spread: null, tilt: null, pose: null, framing: null, lm: null, hand: null, mpHand: null, frameComplete: false, frameIssue: null, lmMs: lmMs, encMs: 0, detFailed: detFailed };
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
      return { openness: openness, descriptor: descriptor, code: codes ? codes.code : null, codeM: codes ? codes.codeM : null, roi: codes ? codes.roi : null, sharpness: meas.sharpness, texture: meas.texture, spread: B.palmSpread(lm), tilt: B.palmTilt(lm), pose: B.palmFramePose(lm), framing: B.palmFramingHint(lm), lm: lm, hand: hand, mpHand: mpHand, frameComplete: comp ? comp.complete : false, frameIssue: comp ? comp.issue : null, lmMs: lmMs, encMs: encMs, detFailed: detFailed };
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
      // v69: a frame is only ever sampled when a hand was
      // actually READ on it (landmarks present). Before v69
      // every analysed frame was sampled, hand or not: with no
      // landmarks the palm-grid evidence is correctly absent,
      // but the detector's whole-frame bezel and glare terms
      // still run — a television across the room, a window
      // frame, a bright wall in a handless positioning frame
      // could flag, and two flagged handless frames met the
      // aggregation bar and convicted the whole scan as a
      // spoof before any hand was judged (the middle verdict
      // of the Chairman's 2026-11-26 friction report). A
      // handless frame now carries no spoof evidence either
      // way — it returns null and is never recorded, exactly
      // like a frame the sampler could not run on.
      add: function (frame, lm) { if (!lm) return null; var s = spoofSample(frame, lm); if (s) checks.push(s); return s || null; },
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
    // v67: no 'swapped' state exists — the camera never swaps.
    var seenHand = false;
    var watchFrames = 0;
    var detFails = 0; // v67: this watch's own consecutive detector failures
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
        if (video.currentTime >= target || video.currentTime < lastGrabT - 0.05 || Date.now() > deadline) return Promise.resolve();
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
      if (pct === null || pct === undefined) { ring.classList.add('hidden'); ring._v77pct = null; return; }
      ring.classList.remove('hidden');
      /* v77: the burst calls this per frame, but the ring only
         ever displays whole percents — repainting the conic
         gradient on every sub-percent tick was a full style
         recalc + paint per frame in the hottest loop in the app.
         Now the style and label are written only when the whole
         percent actually changes, and the label node is cached. */
      var whole = Math.round(Math.max(0, Math.min(1, pct)) * 100);
      if (ring._v77pct === whole) return;
      ring._v77pct = whole;
      ring.style.background = 'conic-gradient(#1B5FE0 ' + (whole * 3.6) + 'deg, rgba(27,95,224,0.15) 0deg)';
      if (!ring._v77lbl) ring._v77lbl = ring.querySelector('span');
      if (ring._v77lbl) ring._v77lbl.textContent = whole + '%';
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
          if (r.detFailed) detFails++; else detFails = 0;
          if (watchFrames % 2 === 1) tracker.add(frame, r.lm);
          if (tracker.state().spoof) return 'spoof';
          var hasHand = typeof r.openness === 'number';
          if (hasHand) seenHand = true;
          var gate = r.roi ? B.palmprintQualityGate(r.roi, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE, { hasHand: hasHand, bboxWidthFrac: B.palmBboxWidthFrac(r.lm), facing: liveFacingMode() }) : null;
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
        // v67 (Chairman's order, 2026-11-26): the auto camera
        // swap is DELETED. The camera never changes on its own —
        // the facing the user chose stays until the user taps
        // the manual switch. A handless stretch is guidance, not
        // a trigger; a detector that failed on this watch's own
        // frames three times running ends the watch honestly
        // instead of masquerading as "no hand".
        if (detFails >= 3) return Promise.resolve('detector');
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
      if (w === 'detector') return out({ detectorFailed: true });
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
  /* v67 (Chairman's order, 2026-11-26): the honest detector
     message. Shown when the hand detector itself cannot run —
     never dressed up as "no hand detected", which sent the user
     hunting for a hand problem that did not exist. */
  var DETECTOR_FAIL_MSG = 'The hand detector could not run on this device, so this scan could not look for a hand. This usually means the detector files have not loaded — check the connection, wait a few seconds, and try the scan again.';

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
    var analysed = 0, locked = false, detFails = 0; // v67: no swapped state — the camera never swaps; detFails = this stream's own consecutive detector failures
    // v69: detTotal counts this scan's detector-failed frames
    // across the whole run (they are excluded from the frame
    // cap — a frame the detector never judged is not evidence
    // the scan spent); handFrames counts frames that carried a
    // pose (a hand was read), which is what the static-liveness
    // exit is allowed to rest on.
    var detTotal = 0, handFrames = 0;
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
       PalmNet at its PALMNET_THRESHOLD bar) is taken per frame from whichever
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
      /* v67: the two impostor maxima are independent — the
         EDCC maximum rides the match worker, the PalmNet
         maximum rides the neural worker — so they now run
         CONCURRENTLY instead of in sequence. The values, the
         v49 margin judgement below and every recorded field
         are exactly the ones the sequential chain produced;
         only the verdict tail's wall-clock cost changes. */
      return Promise.all([impostorMaxFor(win.rois, winHand), neuralImpostorMaxFor(win.rois, winHand)]).then(function (both) {
        var impMax = both[0], nImpMax = both[1];
        {
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
        }
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
       through to the MAXF/deadline guards instead of hanging.
       v57: the poll also accepts a BACKWARD clock — a replaced
       stream (a manual Front/Back toggle, which restarts the
       camera under a running scan) restarts currentTime near
       zero, and before v57 the loop then waited for the new
       clock to climb back to the old stream's timestamp,
       stalling the scan for exactly that long (bounded only by
       the deadline). The mid-scan camera swap always reset
       lastGrabT by hand; a manual switch has no handle on this
       closure, so the poll itself now treats a backward clock
       as a fresh frame. The same line lives in all three stream
       loops (enrol, verify, identify). */
    function waitFreshFrame() {
      if (lastGrabT < 0) return Promise.resolve();
      var target = lastGrabT + 0.1;
      function poll() {
        if (video.currentTime >= target || video.currentTime < lastGrabT - 0.05 || Date.now() > deadline) return Promise.resolve();
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
          if (r.detFailed) { detFails++; detTotal++; } else detFails = 0;
          if (r.pose) handFrames++;
          stLm += r.lmMs || 0; stEnc += r.encMs || 0;
          // Every analysed frame feeds the spoof tracker, carrying
          // its landmarks so the v36 grid gate reads the palm region
          // only — same evidence, same aggregation as the bursts.
          // v69: the tracker itself now refuses handless frames
          // (see makeSpoofTracker) — a frame with no hand read
          // carries no spoof evidence.
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
      // v69: detector failure is judged FIRST — before the spoof
      // and liveness exits below. Before v69 this check sat at
      // the bottom of the loop, after both: a detector that
      // could not run produced handless frames, those frames'
      // whole-frame evidence (and the plain passage of the
      // frame cap) could end the scan as a spoof, a liveness
      // failure or a no-usable-palm verdict, and the accurate
      // state — the detector never ran — was overwritten by
      // whichever later check fired first. Three consecutive
      // detector failures are the v67 rule; what changed is
      // only that no other verdict may outrank it.
      if (detFails >= 3) {
        return finish({ fail: DETECTOR_FAIL_MSG + ' Nothing was verified.', detectorFailed: true, diag: { edcc: null, neural: null, probeHand: null, profileHand: profileHand, handGate: false } });
      }
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
      // v69: the six frames must be frames a hand was READ on
      // (handFrames — poses exist only on hand frames). Before
      // v69 the counter was analysed frames, handless ones
      // included, so positioning frames burned the guard's
      // budget while contributing no pose evidence at all.
      if (lv.verdict === 'static' && handFrames >= 6) return livenessFailOut(lv);
      if (lv.verdict === 'erratic') return livenessFailOut(lv);
      // v69: the frame cap counts frames the detector actually
      // judged (analysed minus detector-failed) — a detector
      // warm-up stretch at the top of a scan no longer spends
      // the matching budget. The wall-clock deadline is
      // unchanged and still bounds every scan.
      if (analysed - detTotal >= MAXF || Date.now() > deadline) {
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
      // v67 (Chairman's order, 2026-11-26): the v37 auto camera
      // swap is DELETED — the camera never changes on its own
      // during or between scans; the facing the user chose
      // stays until the user taps the manual switch. A handless
      // stretch simply keeps the guidance coming on this
      // camera. A detector that cannot run ends the scan with
      // the honest detector message, never a "no hand" verdict
      // (v69: that judgement now sits at the TOP of this loop,
      // before the spoof and liveness exits — see there).
      if (statusEl) {
        var seenHandNow = frames.some(function (x) { return typeof x.openness === 'number'; });
        // v43: the live guidance pill — one concise line mapped
        // from the quality signals this frame already produced.
        var guide = B.palmGuidance({ hasHand: seenHandNow, framing: lastHint, frameIssue: lastFrameIssue, openness: lastOpen, meanLuma: lastSampleB, glareFrac: lastGlare, sharpness: lastSharp, stable: false, facing: liveFacingMode() });
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
    var analysed = 0, locked = false, detFails = 0;
    var handFrames = 0; // v73 (Seat 3 F4): frames a hand was READ on (poses exist only on hand frames) — the static-liveness counter, mirroring the verify stream // v67: no swapped state — the camera never swaps; detFails = this stream's own consecutive detector failures
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
      scanTimerStop('w'); // v74 (Seat 1 fix): freeze at the verdict determination, before the record stamps
      Sync.noteScan({ kind: 'identify', profileName: '', biomId: '', result: 'Spoof / Screen Replay Detected' });
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
        if (video.currentTime >= target || video.currentTime < lastGrabT - 0.05 || Date.now() > deadline) return Promise.resolve();
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
          if (r.detFailed) detFails++; else detFails = 0;
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
          if (r.pose) { handFrames++; poses.push(r.pose); if (poses.length > 6) poses.shift(); }
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
      // v73 (Seat 3 F4): detector failure is judged FIRST,
      // mirroring the verify stream's v69 ordering. Before v73
      // this check sat at the bottom of this loop, after the
      // spoof/liveness/cap exits, so a dead detector ended an
      // identification as a liveness failure or a no-usable-palm
      // verdict instead of the honest detector message. Only
      // the ORDER changed — no judgement value did.
      if (detFails >= 3) {
        return { fail: DETECTOR_FAIL_MSG + ' Nothing was identified.', detectorFailed: true };
      }
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
      if (lv.verdict === 'static' && handFrames >= 6) return livenessFailOut(lv); // v73 (Seat 3 F4): hand-frames only, as in the verify stream — handless frames carry no pose evidence
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
      // v67 (Chairman's order, 2026-11-26): the auto camera
      // swap is DELETED here too — same law as the verify
      // stream: the camera never changes on its own, and a
      // detector that cannot run is reported honestly (the
      // detector-failure exit itself sits at the TOP of this
      // loop since v73 — Seat 3 F4).
      if (statusEl) {
        var seenHandNow = frames.some(function (x) { return typeof x.openness === 'number'; });
        // v43: the live guidance pill — one concise line mapped
        // from the quality signals this frame already produced.
        var guide = B.palmGuidance({ hasHand: seenHandNow, framing: lastHint, frameIssue: lastFrameIssue, openness: lastOpen, meanLuma: lastSampleB, glareFrac: lastGlare, sharpness: lastSharp, stable: false, facing: liveFacingMode() });
        setStatus(guide || (seenHandNow ? 'Hand detected — hold steady.' : 'Show an open hand to the camera.'));
      }
      return step().then(loop);
    }
    return loop();
  }

  var palmScanBusy = false;
  /* v71: a money commit is in flight — set alongside
     palmScanBusy by the wallet scan runner and the terminal,
     held until the flow's final write/render settles. The
     service-worker update reload (below) waits for BOTH flags:
     a scan ending is not the flow ending when the payment
     writes are still landing. */
  var moneyCommitBusy = false;

  /* ---------------- Navigation ------------------------------------------- */
  function go(page) {
    /* v71: navigation is a flow boundary — a held service-worker
       update reload is delivered here if nothing is in flight. */
    checkPendingSwReload();
    /* v63 two-face gate: in customer mode the owner pages do
       not exist (their DOM is detached) and navigation to them
       resolves to the wallet instead. The 'activity' target is
       the wallet page scrolled to its activity card. */
    var requestedPage = page;
    if (!FaceMode.isOwner() && FaceMode.OWNER_PAGES.indexOf(page) !== -1) page = 'wallet';
    /* v67 role routing: the merchant's Scanner tab IS the
       terminal page under its merchant name (the one owner
       surface the role layer re-attaches), and any other
       owner page requested in the merchant role resolves to
       the scanner rather than the customer wallet. In the
       customer role the scanner resolves to the wallet, like
       every owner page. */
    if (requestedPage === 'scanner') {
      page = (!FaceMode.isOwner() && RoleMode.isMerchant()) || FaceMode.isOwner() ? 'terminal' : 'wallet';
    } else if (!FaceMode.isOwner() && RoleMode.isMerchant() && FaceMode.OWNER_PAGES.indexOf(requestedPage) !== -1) {
      page = 'terminal';
    }
    var scrollActivity = page === 'activity';
    if (scrollActivity) page = 'wallet';
    var navPage = scrollActivity ? 'activity' : page === 'topup' ? 'registry' : page === 'account' ? (FaceMode.isOwner() ? 'wallet' : 'account') : (page === 'stores' || page === 'logs' || page === 'partner') ? 'more' : page;
    if (requestedPage === 'scanner' && page === 'terminal') navPage = 'scanner'; // v67: the merchant tab keeps its own name lit
    document.querySelectorAll('#mainNav button').forEach(function (b) {
      var on = b.dataset.page === navPage;
      b.classList.toggle('active', on);
      /* v64 (Seat 1 N-1): the current page is named for assistive tech. */
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('section.page').forEach(function (s) { s.classList.toggle('active', s.id === 'page-' + page); });
    if (page !== 'enroll' && page !== 'terminal') { Cam.stop(); }
    // v43 hands-free lifecycle: leaving a scan view cancels its
    // running scan silently — no verdict can land on a view that is
    // no longer on screen, and no presentation is processed twice.
    if (page !== 'terminal') { cancelTermScan(); termSession.leave(); }
    if (page !== 'enroll' && enrollControl) enrollControl.cancelled = true;
    if (page !== 'topup' && topupControl) topupControl.cancelled = true;
    if (page !== 'wallet') { if (walletControl) walletControl.cancelled = true; walletSession.leave(); }
    // v74: leaving a scan view freezes its timer readout — no
    // tick is left running on a page that is no longer shown.
    if (page !== 'wallet') scanTimerStop('w');
    if (page !== 'enroll') scanTimerStop('e');
    if (page !== 'terminal') scanTimerStop('t');
    if (page !== 'topup') scanTimerStop('u');
    if (page === 'wallet') { renderWallet(); Pipeline.enterScanView(); }
    if (page === 'more') { fillSyncSettings(); }
    if (page === 'account') { renderAccount(); }
    if (page === 'inbox') { renderInbox(); }
    if (page === 'settings') { renderSettings(); }
    if (page === 'balance') { renderMerchantBalance(); }
    if (page === 'dashboard') renderDashboard();
    if (page === 'registry') renderRegistry();
    if (page === 'logs') renderLogs();
    if (page === 'terminal') { ensureTerminalPeople().then(function () { maybeArmTerminal(); }); Pipeline.enterScanView(); }
    if (page === 'enroll') {
      /* v67: after a completed enrolment the page rests on its
         Done step for the rest of the session (the shipped
         behaviour) — but the prototype's routes into enrolment
         (Settings -> Create another account, the role choice)
         promise a NEW registration. Arriving with no enrolment
         in progress and the Done step showing therefore
         presents the fresh form with cleared fields, exactly
         as a fresh page load does. An in-progress enrolment
         (details captured, palm step open) is never disturbed:
         its details object is non-null and this stays a no-op. */
      if (!enroll.details && !$('enroll-done').classList.contains('hidden')) {
        ['enName', 'enPhone', 'enWalletNumber'].forEach(function (id) { if ($(id)) $(id).value = ''; });
        if ($('enWalletProvider')) $('enWalletProvider').value = '';
        if ($('enrollDetailsError')) $('enrollDetailsError').innerHTML = '';
        setStep('details');
      }
      Pipeline.enterScanView(); maybeArmEnroll();
    }
    window.scrollTo(0, 0);
    if (scrollActivity) {
      setTimeout(function () {
        var card = $('wActivityCard');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 350);
    }
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
    /* v63: the Desk is an owner surface — in customer mode it is
       detached and never rendered. */
    if (!FaceMode.isOwner()) return Promise.resolve();
    return Promise.all([DB.all('people'), DB.all('logs'), DB.all('transactions')]).then(function (r) {
      var people = r[0], logs = r[1], txs = r[2];
      var todayLogs = logs.filter(function (l) { return isToday(l.ts); });
      var verified = todayLogs.filter(function (l) { return l.result === 'Verified'; }).length;
      $('statPeople').textContent = people.length;
      $('statVerifs').textContent = todayLogs.length;
      $('statRate').textContent = todayLogs.length ? Math.round((verified / todayLogs.length) * 100) + '%' : '—';
      $('statWallets').textContent = people.filter(function (p) { return p.walletProvider; }).length;
      /* v71: sandbox-rail records are excluded — test money
         never inflates the demo volume figure. */
      var vol = txs.filter(function (t) { return isToday(t.ts) && t.rail !== 'bkash-sandbox'; }).reduce(function (s, t) { return s + Number(t.amount || 0); }, 0);
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
      /* v64 (Seat 1 M-1): progress moves by transform (scaleX), never
         by animating width — the bar's CSS transition targets
         transform only. */
      $('enrollProgressBar').style.transform = 'scaleX(' + ((idx + 1) / flow.length) + ')';
      /* v67: the design's numbered step dots ride the same
         step index — presentation only, the flow is unchanged. */
      document.querySelectorAll('.enrolldot').forEach(function (d, di) {
        d.classList.toggle('on', di === idx);
        d.classList.toggle('done', di < idx);
      });
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
        // v56 Scan Sync: the new bank upserts and the enrol scan
        // record queues (no-ops when sync is off).
        Sync.noteProfile(person);
        Sync.noteScan({ kind: 'enrol', profileName: person.name, biomId: person.id, hand: B.palmProfileHand(person.palmProfile), result: 'Enrolled' });
        setStep('done');
        $('enrollDoneBody').innerHTML =
          '<b>Name:</b> ' + esc(person.name) + '<br><b>Biom ID:</b> ' + esc(person.id) + '<br>' +
          '<b>Store:</b> ' + esc(person.store) + '<br>' +
          '<b>Palm:</b> ' + (person.palmProfile && person.palmProfile.v === 3 ? 'Enrolled (palmprint — EDCC competitive code, ' + person.palmProfile.codes.length + ' individual captures, movement-checked)' : person.palmProfile ? 'Enrolled (palmprint — ' + (Array.isArray(person.palmProfile.codes) ? person.palmProfile.codes.length : 0) + ' bit-packed templates banked, movement-checked)' : 'Not enrolled') + '<br>' +
          '<b>Wallet:</b> ' + (person.walletProvider ? esc(person.walletProvider) + ' ' + esc(B.maskWalletNumber(person.walletNumber)) : 'Not linked') + '<br>' +
          '<b>Biometric-only limits:</b> ' + (person.limits.perTx ? 'BDT ' + Number(person.limits.perTx).toLocaleString() + ' per transaction' : 'No per-transaction limit') + (person.limits.daily ? ', BDT ' + Number(person.limits.daily).toLocaleString() + ' per day' : '') + '<br>' +
          '<b>Palm Loyalty:</b> Active — 0 points<br>' +
          (ScanTimers.e.hasRun() ? '<b>Palm capture time:</b> ' + ScanTimers.e.elapsedText() + ' (the palm-capture step of this registration, measured on this device)<br>' : '') + // v74: the registration timer's total, stated on the completion screen (only when a capture actually ran this session)
          '<b>Demo wallet:</b> Created — this Biom ID is the wallet account, balance BDT 0. Open My Wallet to use it; your palm is asked for only when money moves. Demo money inside the app, not real funds.';
        enroll = { details: null, palm: null, types: { palm: true } };
        /* v69: a fresh enrolment is a thin bank by definition
           (B.palmBankThin — one burst, never strengthened).
           Offer the Strengthen path ONCE, here on the Done
           screen: the offer is shown at most once per profile
           (a meta flag records that it was shown), and both
           buttons retire it — Strengthen routes to the same
           Add Angles flow My Account uses; Not now simply
           hides it. It never reappears for this profile. */
        var offerEl = $('enrollStrengthenOffer');
        if (offerEl) {
          offerEl.classList.add('hidden');
          if (B.palmBankThin(person.palmProfile)) {
            DB.getMeta('strengthenOffered:' + person.id, false).then(function (shown) {
              if (shown) return;
              return DB.setMeta('strengthenOffered:' + person.id, true).then(function () {
                offerEl.classList.remove('hidden');
                /* v77: onclick ASSIGNMENT, not addEventListener —
                   these two buttons are persistent static elements,
                   so every enrolment used to stack one more click
                   listener on them for the rest of the session and
                   a later tap fired openTopup once per past
                   enrolment. Assignment keeps exactly one handler,
                   bound to the latest person. */
                var goBtn = $('enrollStrengthenBtn'), noBtn = $('enrollStrengthenDismiss');
                if (goBtn) goBtn.onclick = function () { offerEl.classList.add('hidden'); openTopup(person.id); };
                if (noBtn) noBtn.onclick = function () { offerEl.classList.add('hidden'); };
              });
            }).catch(function () {});
          }
        }
        toast('Enrolled: ' + person.id);
        // Voice verdict (v23, his order): spoken ONLY here, after the
        // record is actually saved - never on a step, never early.
        Snd.chime();
        Snd.speak('Registration done successfully');
      });
    }).catch(function (e) { fail('<div class="error">Could not save enrollment on this device: ' + esc(e.message || e) + '</div>'); });
  }
  function fillStoreSelects() {
    ['enStore', 'termStore', 'wPayStore'].forEach(function (id) {
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
    // v58 MANUAL SCAN: the palm step opens its camera and arms
    // — the guided capture begins only on the Scan Palm tap.
    // (v43-v57 started the camera AND the capture here by
    // themselves; retired by the Chairman's 2026-11-25 order.)
    startPalmCamera();
  });

  /* Palm enroll (v45): once a capture is started, the app
     watches the camera; the moment a sharp open palm passes
     the quality gate, a single 900 ms burst runs and banks 3
     packed templates (profile v4). Passive liveness is read
     across the burst — a photo cannot produce natural
     micro-motion or depth variance. */
  function resetPalmEnroll() { /* burst enrolment keeps no partial state */ }
  /* Manual enrolment entry (v58): entering the palm step opens
     the camera and ARMS the step only — the guided capture
     begins on the Scan Palm tap (runPalmCapture, whose busy
     guard makes a re-tap during a running capture a no-op).
     Start Camera re-opens the camera, still armed. At v43-v57
     entry started the camera AND the capture automatically;
     the Chairman's 2026-11-25 order retired that — a sudden
     capture catches the hand unpositioned. */
  var enrollControl = null;
  function startPalmCamera() {
    return Cam.start($('palmVideo'), camFacing.enrollPalm, 'enrollPalm').then(function () {
      Pipeline.enterScanView();
      $('palmCapture').disabled = false;
      $('palmStatus').textContent = 'Camera on — show your open hand in the frame, anywhere in view, at a natural distance, then tap Scan Palm. Nothing is captured until you tap: on the tap the app watches live, and the moment a sharp open palm is seen a 900 ms capture burst runs and the palm is banked.';
    }).catch(function (e) { $('palmMsg').innerHTML = cameraErrorHTML(e); $('palmStatus').textContent = 'Camera blocked.'; });
  }
  function maybeArmEnroll() {
    if (!enroll.details) return;
    if ($('enroll-palm').classList.contains('hidden')) return;
    startPalmCamera();
  }
  $('palmStart').addEventListener('click', function () { startPalmCamera(); });
  camRestarters.enrollPalm = function () { startPalmCamera(); };
  /* v71: enrolment/topup capture settle — clears the money-commit
     hold and delivers a held service-worker update reload. */
  function settleCaptureReload() { moneyCommitBusy = false; checkPendingSwReload(); }
  function runPalmCapture() {
    if (palmScanBusy) return;
    if (!enroll.details) return;
    palmScanBusy = true;
    moneyCommitBusy = true; // v71: held until the capture's outcome is fully applied
    $('palmCapture').disabled = true;
    $('palmMsg').innerHTML = '';
    var control = { cancelled: false, onFrame: function (info) { var fr = enrolSession.frame({ hasHand: info.hasHand, pose: info.pose }); enrolInds.update(info, fr); } };
    enrollControl = control;
    enrolSession.enter();
    enrolInds.reset();
    setSurfacePill('e', 'Scanning');
    scanTimerStart('e', 'Captured in '); // v74: the Scan Palm tap starts the capture — and its timer
    // v67: no swap callback — enrolment watches on the chosen
    // camera only (auto-swap deleted, Chairman's order).
    streamEnrolPalm($('palmVideo'), $('palmStatus'), null, null, control).then(function (res) {
      palmScanBusy = false;
      scanTimerStop('e'); // v74: the capture outcome is known — freeze the capture time (banking continues below)
      setSurfacePill('e', 'Ready');
      if (res.stopped) { $('palmCapture').disabled = false; $('palmStatus').textContent = 'Capture stopped.'; settleCaptureReload(); return; }
      if (res.spoof && res.spoof.spoof) {
        DB.put('logs', { ts: Date.now(), personId: '', personName: '(enrolment attempt)', store: '', method: 'palm', measured: 'Spoof score ' + res.spoof.score.toFixed(2) + ' - ' + res.spoof.reasons.join('; '), result: 'Spoof / Screen Replay Detected' });
        Sync.noteScan({ kind: 'enrol', profileName: '', biomId: '', result: 'Spoof / Screen Replay Detected' });
        $('palmMsg').innerHTML = '<div class="error">Spoof / Screen Replay Detected — the scan showed a screen or a recording, not a live hand (' + esc(res.spoof.reasons.join('; ')) + '). Nothing was stored. Enrolment requires the real hand, live in front of the camera.</div>';
        $('palmCapture').disabled = false;
        Snd.buzz();
        settleCaptureReload();
        return;
      }
      if (res.detectorFailed) {
        $('palmMsg').innerHTML = '<div class="error">' + esc(DETECTOR_FAIL_MSG) + ' Nothing was stored.</div>';
        $('palmCapture').disabled = false;
        Snd.buzz();
        settleCaptureReload();
        return;
      }
      if (!res.burst) {
        $('palmMsg').innerHTML = '<div class="error">No sharp open palm was captured' + (res.hint ? ' — last guidance shown: ' + esc(res.hint) : '') + '. Nothing was stored. Show one open palm to the camera, fingers spread, in good light, and hold it steady, then tap Scan Palm again — on the tap, the burst runs the moment a sharp palm is seen.</div>';
        $('palmCapture').disabled = false;
        Snd.buzz();
        settleCaptureReload();
        return;
      }
      if (!res.burst.liveness.pass) {
        $('palmMsg').innerHTML = '<div class="error">Liveness check failed: ' + esc(res.burst.liveness.reason) + ' Nothing was stored. Enrol with the real hand, held live in front of the camera.</div>';
        $('palmCapture').disabled = false;
        Snd.buzz();
        settleCaptureReload();
        return;
      }
      // v45: bank the burst's 3 sharpest time-spaced templates in
      // the packed format — the spec's single-burst banking.
      var sel = B.selectPalmprintBurstCodes(res.results);
      if (!sel) {
        $('palmMsg').innerHTML = '<div class="error">No usable open palm with readable print detail was captured in the burst. Nothing was stored. Show one open palm to the camera, fingers spread, in good light, and try again.</div>';
        $('palmCapture').disabled = false;
        settleCaptureReload();
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
        $('palmMsg').innerHTML = '<div class="success">Palm enrolled in ' + (res.elapsedMs / 1000).toFixed(1) + ' s: one 900 ms burst (' + res.burst.frames + ' frames) banked ' + sel.codes.length + ' palmprint templates (bit-packed EDCC — the palm\'s own print pattern), and passive liveness passed (natural micro-shift ' + (res.burst.liveness.microShift * 100).toFixed(1) + '% across the burst).' + esc(neuralNote) + esc(handNote) + '</div>';
        Snd.chime();
        Snd.speak('Palm captured');
        advanceFrom('palm');
        settleCaptureReload(); // v71: enrolment outcome fully applied
      });
    }).catch(function (e) {
      palmScanBusy = false;
      scanTimerStop('e'); // v74
      $('palmCapture').disabled = false;
      $('palmMsg').innerHTML = '<div class="error">Palm capture failed: ' + esc(e && e.message ? e.message : e) + ' Nothing was stored.</div>';
      settleCaptureReload();
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
    /* v63: the terminal is an owner surface — in customer mode
       its DOM is detached and it is never populated. */
    if (!FaceMode.isOwner()) return Promise.resolve();
    return loadTerminalPeople();
  }
  function loadTerminalPeople() {
    return DB.all('people').then(function (people) {
      termPeopleCache = people;
      renderTermPeople();
    });
  }
  /* v67: the terminal's people load for whichever face may
     use it — the owner face, or the merchant role (where the
     role layer has re-attached the terminal page). In the
     plain customer role it stays a no-op, exactly as v63. */
  function ensureTerminalPeople() {
    if (!FaceMode.isOwner() && !RoleMode.isMerchant()) return Promise.resolve();
    return loadTerminalPeople();
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
  /* v74 (Seat 1 re-review): runTermScan's in-flight claim — set
     synchronously at the SCAN tap, before the registry lookup,
     so a second tap during the lookup window returns without
     touching the running scan's timer. Round 2 of the re-review
     showed the claim must be held for the WHOLE invocation —
     tap to that invocation's settle — because the verdict's
     log/payment writes continue after both scan guards drop:
     the claim is a per-invocation TOKEN (an object only that
     invocation captured), and the settle handler acts only
     when the live claim is still its own token, so a stale
     chain can never reset, stop or release a newer scan's
     timer or claim. */
  var termScanClaim = null;
  function cancelTermScan() { if (termControl) termControl.cancelled = true; }
  /* v58 MANUAL SCAN: entering the terminal ARMS it — the
     session is entered and the camera opens on the selected
     customer, but no scan runs until SCAN is tapped. (At v57
     this function auto-started the scan itself; the Chairman's
     2026-11-25 order retired that: a sudden scan catches the
     palm half-positioned and reads as a spoof / not-verified
     failure.) */
  function maybeArmTerminal() {
    if (!$('page-terminal').classList.contains('active')) return;
    termSession.enter();
    var person = termPeopleCache.find(function (p) { return p.id === $('termPerson').value; }) || null;
    if (!person || !personHasMethod(person)) return;
    if (palmScanBusy) return;
    startTermCamera();
  }
  $('termPerson').addEventListener('change', function () {
    // A different customer: cancel any running scan silently,
    // re-arm the session, and open the camera for the new
    // customer — armed, not scanning (v58).
    cancelTermScan();
    termSession.reset();
    scanTimerReset('t'); // v74: a different customer starts from a blank timer
    $('termNext').classList.add('hidden');
    fillTermMethodNote();
    startTermCamera();
  });
  $('termSearch').addEventListener('input', debounce(renderTermPeople, 150)); // v77: debounced (was: full re-render per keystroke)
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
        // v58 MANUAL SCAN: the camera opening never starts the
        // scan. The terminal is armed — the customer positions
        // an open palm in the frame, then SCAN is tapped and
        // Show & Pay reads the palm as it streams, exactly as
        // before. (v43-v57 auto-started here; retired by the
        // Chairman's 2026-11-25 order.)
        status.textContent = 'Camera on — the customer positions an open palm in the frame, anywhere in view, then tap SCAN.';
      }).catch(function (e) { $('termResult').innerHTML = cameraErrorHTML(e); status.textContent = 'Camera blocked.'; });
    });
  }
  $('termStart').addEventListener('click', startTermCamera);
  camRestarters.terminal = startTermCamera;
  $('termNext').addEventListener('click', function () {
    // Next Customer: instant clean reset — verdict card cleared,
    // cooldown cleared, and the terminal re-ARMED for the next
    // presentation. v58: it does not start the next scan — the
    // customer positions their palm, then SCAN is tapped.
    termSession.reset();
    scanTimerReset('t'); // v74: the next customer starts from a blank timer
    $('termNext').classList.add('hidden');
    $('termResult').innerHTML = '';
    $('termStatus').textContent = 'Ready — tap SCAN when the next customer has positioned their palm.';
    if (!(Cam.stream && Cam.video === $('termVideo'))) startTermCamera();
  });

  function logVerification(person, method, measured, result) {
    // v49: the log write is best-effort — it must never gate the
    // verdict card. A wedged store (now bounded in DB.put) rejects
    // here and the terminal still renders its verdict.
    // v67: the store is read through a guard — in the customer
    // face the terminal page (and its store select) is detached
    // from the DOM, so the bare read threw and a refused wallet
    // scan surfaced as a script error instead of its verdict
    // (found by the v67 gate's wrong-palm authorisation test).
    // Terminal scans, which own the select, record it exactly
    // as before; wallet scans record no store, as they mean.
    var storeEl = $('termStore');
    return DB.put('logs', { ts: Date.now(), personId: person.id, personName: person.name, store: storeEl ? storeEl.value : '', method: method, measured: measured, result: result }).catch(function () { return null; });
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
    /* v74 (Seat 1 re-review): a scan (or this tap's own lookup)
       is already in flight — a second tap changes nothing and
       must not touch the running scan's timer. The claim is a
       token this invocation alone holds until its own settle:
       a tap during the verdict/log/payment window after the
       verdict also returns here, because the session is not
       over until the chain settles. */
    if (termScanClaim || palmScanBusy) return;
    var myClaim = {};
    termScanClaim = myClaim;
    var tookOver = false; // did this invocation reach the scan proper?
    function releaseClaim() { if (termScanClaim === myClaim) termScanClaim = null; }
    var personId = $('termPerson').value;
    var method = 'palm';
    var amount = Number($('termAmount').value || 0);
    $('termNext').classList.add('hidden');
    $('termResult').innerHTML = '<div class="notice">Scanning — comparing against the stored enrollment...</div>';
    /* v74 (Seat 1 fix): the timer starts at the tap, exactly as
       on the wallet card — the registry lookup is part of the
       scan session the user experiences. The exits below that
       start no scan release the claim and reset it again, so a
       rejected tap never leaves a ticking or frozen readout
       behind. */
    setSurfacePill('t', 'Scanning');
    scanTimerStart('t', 'Scanned in ');
    /* v79 (seat review): the blocked-ID set loads asynchronously
       at boot; await it before the pre-scan gate below so a cold
       first scan cannot slip through the not-yet-loaded window.
       The post-verdict re-check further down stands regardless. */
    Promise.resolve().then(function () { return Sync.ensureBlockedIds(); }).catch(function () {}).then(function () { return DB.all('people'); }).then(function (people) {
      var person = people.find(function (p) { return p.id === personId; });
      if (!person) { releaseClaim(); scanTimerReset('t'); setSurfacePill('t', 'Ready'); $('termResult').innerHTML = '<div class="error">Select an enrolled person first. Enroll on this device if the registry is empty.</div>'; return null; }
      if (!personHasMethod(person)) {
        releaseClaim(); scanTimerReset('t'); setSurfacePill('t', 'Ready');
        $('termResult').innerHTML = '<div class="error">' + notEnrolledMessage(person) + ' No scan was run and nothing was verified.</div>';
        return null;
      }
      /* v79 (the Chairman's merchant message rule): a person
         this device knows is blocked gets the blocked verdict
         immediately — no scan is run, nothing can be verified
         and no payment is attempted. The local terminal log
         records the attempt as Blocked; no sync scan record is
         queued (the server refuses scan writes naming a blocked
         ID by design, and an unjudged attempt is not a scan). */
      if (Sync.isBlocked(person.id)) {
        releaseClaim(); scanTimerReset('t'); setSurfacePill('t', 'Ready');
        termSession.verdict();
        $('termNext').classList.remove('hidden');
        $('termResult').innerHTML = '<div class="resultbig bad"><div class="verdict">PALM SCANNING BLOCKED</div><div class="who">' +
          esc(person.name) + ' (' + esc(person.id) + ')</div><div class="meas">' + BLOCKED_TERMINAL_LINE +
          ' No payment can be taken from a blocked account.</div></div>';
        Snd.buzz();
        return logVerification(person, method, 'Blocked — account blocked', 'Blocked');
      }

      if (palmScanBusy) { releaseClaim(); scanTimerReset('t'); setSurfacePill('t', 'Ready'); return null; }
      tookOver = true; // the scan proper runs under the shared claim; THIS invocation's token stays held until its settle
      palmScanBusy = true;
      moneyCommitBusy = true; // v71: held until the pay writes settle (createPay runs after the scan promise)
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
          // v54: the running neural model's id rides the record
          // the same way (extra field only — the pinned CSV
          // columns are untouched): after a model swap, the
          // pentest can tell which model's evidence a record's
          // neural scores are, and records written under the
          // Round 1 model simply lack the field.
          rec.neuralModel = B.PALMNET_MODEL_ID;
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
        // v56 Scan Sync: the same measured values, in the same
        // closure, queue the wire record (no-op when sync is off).
        Sync.noteScan({ kind: 'field-test', profileName: person.name, biomId: person.id, hand: neural && neural.probeHand ? neural.probeHand : null, edccScore: genuineScore, palmnetScore: neural && typeof neural.neuralScore === 'number' ? neural.neuralScore : null, result: result, fieldTest: fieldModeOn() });
      };
      var control = { cancelled: false, onFrame: function (info) { var fr = termSession.frame({ hasHand: info.hasHand, pose: info.pose }); termInds.update(info, fr); } };
      termControl = control;
      termInds.reset();
      setSurfacePill('t', 'Scanning');
      /* v74: the timer already runs from the tap (see the head
         of this function) — it is NOT restarted here, so the
         measured span covers the whole session. */
      // v67: no swap callback — the terminal scan runs on the
      // camera the user chose, start to finish (the v37-v66
      // mid-scan auto-swap is deleted, Chairman's order).
      var attempt = streamVerifyPalm($('termVideo'), $('termStatus'), person, people, null, fieldRec, control, { strictMoney: true }).then(function (out) {
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
        scanTimerStop('t'); // v74: the verdict is determined — freeze the total in the pill
        setSurfacePill('t', 'Ready');
        $('termNext').classList.remove('hidden');
        if (out.fail) {
          /* v79 (abuse category: spoofing): a spoof verdict
             against a selected person is ATTRIBUTED — the sync
             record names the target Biom ID and carries the
             spoof result, so presentation attacks are countable
             on the server (owner-device ones feed the auto-block
             ladder; Field Test Mode ones are flagged fieldTest
             and never count). Pre-v79 the terminal queued
             nothing for a failed scan, so a spoof at the till
             left no server trace at all. */
          if (typeof out.fail === 'string' && out.fail.indexOf('Spoof / Screen Replay') === 0) {
            Sync.noteScan({ kind: amount > 0 ? 'money-auth' : 'verify', profileName: person.name, biomId: person.id, hand: out.diag ? out.diag.probeHand : null, edccScore: out.diag ? out.diag.edcc : null, palmnetScore: out.diag ? out.diag.neural : null, result: 'Spoof / Screen Replay Detected', fieldTest: fieldModeOn() });
          }
          Snd.buzz(); $('termResult').innerHTML = '<div class="error">' + esc(out.fail) + '</div>' + scanDiagHTML(out.diag); return;
        }
        var r = out.r;
        var verified = r.ok === true && r.verified === true; // fail closed: only an explicit pass verifies
        /* v79: the block may have been learned while the scan
           ran (a pull landed, or a flush refusal arrived). A
           blocked person is never verified at the till and never
           reaches payment, whatever the palm scored — the same
           blocked verdict as the pre-scan check. */
        if (Sync.isBlocked(person.id)) {
          $('termResult').innerHTML = '<div class="resultbig bad"><div class="verdict">PALM SCANNING BLOCKED</div><div class="who">' +
            esc(person.name) + ' (' + esc(person.id) + ')</div><div class="meas">' + BLOCKED_TERMINAL_LINE +
            ' No payment can be taken from a blocked account.</div></div>';
          Snd.buzz();
          return logVerification(person, method, 'Blocked — account blocked', 'Blocked');
        }
        // v56 Scan Sync: queued in the same closure that writes the
        // terminal log below, from the same outcome values.
        // v79: fieldTest rides when Field Test Mode is on, so the
        // server never counts a test exercise as production abuse.
        Sync.noteScan({ kind: amount > 0 ? 'money-auth' : 'verify', profileName: person.name, biomId: person.id, hand: out.diag ? out.diag.probeHand : null, edccScore: out.diag ? out.diag.edcc : null, palmnetScore: out.diag ? out.diag.neural : null, result: verified ? 'Verified' : 'Denied', fieldTest: fieldModeOn() });
        return logVerification(person, method, out.measured, verified ? 'Verified' : 'Denied').then(function () {
          var html;
          // v20 latency line: the exact end-to-end scan time, shown on
          // the confirmation card (palm streaming scans carry it).
          /* v74 (Seat 1 fix): this line is the stream's internal
             engine span (first frame to verdict), NOT the scan
             total — the pill's frozen "Scanned in Xs" is the one
             total for the scan, so the engine line is labelled
             as what it is and can no longer be read as a second,
             different total on the same screen. */
          var latencyLine = (typeof out.latencyMs === 'number')
            ? '<div class="who">Engine match time: ' + out.latencyMs.toLocaleString() + ' ms' + (r && typeof r.similarity === 'number' ? ' • Score ' + r.similarity.toFixed(2) : '') + '</div>'
            : '';
          if (!verified) {
            html = '<div class="resultbig bad"><div class="verdict">NOT VERIFIED</div><div class="who">' + esc(person.name) + ' — Palm scan did not match</div>' + latencyLine + '<div class="meas">' + esc(r.reason) + '<br>Measured: ' + esc(out.measured) + '</div></div>';
            $('termResult').innerHTML = html + scanDiagHTML(out.diag);
            Snd.buzz();
            return;
          }
          Snd.chime();
          html = '<div class="resultbig ok"><div class="verdict">VERIFIED</div><div class="who">' + esc(person.name) + ' (' + esc(person.id) + ')</div>' + latencyLine + '<div class="meas">Measured: ' + esc(out.measured) + '</div></div>';
          // Palm Loyalty (live mode, v18): a verified visit scan
          // earns 5 points, credited here — the verified scan has
          // already happened, so the award is earned. Payment
          // points (1 per BDT 10) are different: since v59 they
          // are credited ONLY after the payment actually resolves,
          // inside createPay below, from the created transaction's
          // amount (defect D6: before v59 the payment award ran
          // here, before the no-wallet and limit refusals, from
          // the typed amount — points were banked for payments
          // that never happened).
          var loyaltyLine = '';
          if (!(amount > 0)) {
            person.loyaltyPoints = (person.loyaltyPoints || 0) + 5;
            loyaltyLine = '<div class="notice" style="margin-top:10px">Palm Loyalty: +5 points awarded — balance ' + person.loyaltyPoints + ' points.</div>';
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
                  /* v67: the paying customer's Inbox event, on
                     the success path only — the payment record
                     now exists. Refused payments (no linked
                     wallet, over a biometric-only limit) never
                     reach this line and never notify. */
                  Inbox.add(person.id, Inbox.event('pay', { amount: tx.amount, ref: tx.id, detail: 'At ' + tx.store + ' · ' + tx.id + ' · Demo money' }));
                  noteMoneyProfile(person); // v78: mirror the pay record + wallet to the dashboard dossier
                  // v59 (defect D6): the payment has resolved — only
                  // now are its Palm Loyalty points credited, from
                  // the created transaction's amount, never the
                  // typed field. Refused payments never reach here
                  // and earn no payment points.
                  var payPts = Math.floor(tx.amount / 10);
                  if (payPts > 0) {
                    person.loyaltyPoints = (person.loyaltyPoints || 0) + payPts;
                    loyaltyLine = '<div class="notice" style="margin-top:10px">Palm Loyalty: +' + payPts + ' points awarded — balance ' + Number(person.loyaltyPoints || 0) + ' points.</div>';
                    DB.put('people', person);
                  }
                  $('termResult').innerHTML = html + loyaltyLine +
                    '<div class="receipt"><div class="rhead">Biom Pay — Payment Authorized</div><div class="kv">' +
                    '<b>Amount:</b> BDT ' + Number(tx.amount || 0).toLocaleString() + '<br>' +
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
            // a limit the palm alone does not create a payment, so
            // nothing is recorded as paid. (v62 copy truth: there is
            // no PIN confirmation flow — the Chairman deferred it —
            // so the refusal copy promises nothing beyond refusal.)
            if (person.limits && person.limits.perTx && amount > person.limits.perTx) {
              $('termResult').innerHTML = html + loyaltyLine + '<div class="error" style="margin-top:10px">Biom Pay not created: BDT ' + amount.toLocaleString() + ' exceeds this customer\'s biometric-only per-transaction limit of BDT ' + person.limits.perTx.toLocaleString() + '. Payments above the limit are not created.</div>';
              Snd.speak('Palm recognized');
              return;
            }
            if (person.limits && person.limits.daily) {
              return DB.all('transactions').then(function (txs) {
                var dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
                var todaySum = txs.filter(function (t) { return t.personId === person.id && t.ts >= dayStart.getTime() && t.rail !== 'bkash-sandbox'; }).reduce(function (s, t) { return s + Number(t.amount || 0); }, 0);
                if (todaySum + amount > person.limits.daily) {
                  $('termResult').innerHTML = html + loyaltyLine + '<div class="error" style="margin-top:10px">Biom Pay not created: this payment would take today\'s total to BDT ' + (todaySum + amount).toLocaleString() + ', above this customer\'s biometric-only daily limit of BDT ' + person.limits.daily.toLocaleString() + '. Payments above the limit are not created.</div>';
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
    }).catch(function (e) { $('termResult').innerHTML = '<div class="error">Scan failed: ' + esc(e && e.message ? e.message : e) + '</div>'; })
    /* v74 (Seat 1 re-review, round 2): the settle acts ONLY on
       its own invocation's token. If the live claim is still
       this invocation's, release it — and if the scan never
       took over (the lookup failed), blank the timer too, so
       the terminal can never wedge shut. If a newer invocation
       somehow held the claim, this stale settle would touch
       nothing of its timer or claim. (With the claim held to
       settle, a newer invocation cannot in fact start until
       this settle has run.) */
    .then(function () { if (termScanClaim === myClaim) { termScanClaim = null; if (!tookOver) { scanTimerReset('t'); setSurfacePill('t', 'Ready'); } } scanTimerStop('t'); moneyCommitBusy = false; checkPendingSwReload(); }); // v71: the terminal flow has fully settled // v74: backstop stop for the no-verdict exits (stopped / early return)
  }
  $('termScan').addEventListener('click', runTermScan);

  /* ---------------- Demo wallet (v42) --------------------------------
     The wallet layer the Chairman ordered 2026-11-23. Every rule
     about the money itself lives in the B.wallet* store layer in
     biometrics.js — this section only runs scans and renders. The
     scans are the EXISTING pipelines: streamIdentifyPalm (1:N) to
     find a Send Money receiver, streamVerifyPalm (1:1) to
     authorise as a named person. (v60: neither opens a wallet
     any more — entry is a tap, see resolveWalletEntry.) Their
     outcomes are converted to the authorisation object the
     store layer consumes ({ verified, personId }); a failed or
     spoof-rejected scan produces { verified: false } and
     authorises nothing. */
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
  /* v67: walletSwapCamera is DELETED (Chairman's order,
     2026-11-26) — it was the wallet scans' auto-swap callback,
     flipping the facing mid-scan whenever no hand was seen.
     The wallet scan card now runs every scan on the camera the
     user chose; the manual Front/Back toggle above the card is
     the only way the facing ever changes. */
  function authFromVerify(out, personId) {
    return (out && !out.fail && out.r && out.r.verified === true)
      ? { verified: true, personId: personId }
      : { verified: false, personId: null };
  }

  /* v60 WALLET ENTRY (the Chairman's direct order, 2026-11-25:
     "entering our own wallet no need scan"): entry is NOT a
     scan and NOT a security gate. The wallet belongs to a
     profile enrolled on this device; resolveWalletEntry names
     the profile entry should open — the only enrolled profile,
     or the one already open this session — and returns null
     when entry must show the tap-to-choose picker (several
     profiles) or the enrolment pointer (none). No camera is
     started, no verdict is produced and no scan record is
     queued by entry: records come only from judged scans.
     The palm still authorises every money movement (Add
     Money, Send Money, Biom Pay) — those scans are untouched. */
  function resolveWalletEntry(people) {
    if (walletSessionId) {
      var open = people.find(function (p) { return p.id === walletSessionId; });
      if (open) return open;
      walletSessionId = null;
    }
    var withPalm = people.filter(function (p) { return personHasMethod(p); });
    return withPalm.length === 1 ? withPalm[0] : null;
  }
  function renderWallet() {
    if (walletControl) walletControl.cancelled = true; // v43: re-rendering the wallet supersedes any scan still running for it
    return loadWalletPeople().then(function (people) {
      var entry = resolveWalletEntry(people);
      if (entry) walletSessionId = entry.id;
      var me = walletSessionPerson();
      $('walletLocked').classList.toggle('hidden', !!me);
      $('walletHome').classList.toggle('hidden', !me);
      $('walletAdd').classList.add('hidden');
      $('walletSend').classList.add('hidden');
      /* v71: walletPay joins the sheets closed on returning
         home — pre-v71 it stayed open under the home view
         (its Back button appeared to do nothing). */
      $('walletPay').classList.add('hidden');
      $('walletScanCard').classList.add('hidden');
      walletScanCtx = null;
      if (me) { renderWalletHome(me); updateInboxBadge(); return; }
      renderWalletProfiles(people);
      updateInboxBadge();
    });
  }
  /* v60: the profile list on the closed wallet is a plain
     tap-to-choose picker — name, Biom ID and registered hand;
     tapping a card opens that wallet directly. It is not
     dressed as a security check and runs no scan: the palm
     is asked for when money moves, not when a wallet opens. */
  function renderWalletProfiles(people) {
    /* v64 (Seat 1 L-1): the static skeleton retires the moment real
       content renders — the chooser is never a blank frame. */
    var skel = $('walletProfilesSkeleton');
    if (skel) skel.classList.add('hidden');
    var withPalm = people.filter(function (p) { return personHasMethod(p); });
    $('walletProfiles').innerHTML = withPalm.length
      ? withPalm.map(function (p) {
          var hand = B.palmProfileHand(p.palmProfile);
          return '<button class="profilecard" data-open-wallet="' + esc(p.id) + '"><span class="pc-name">' + esc(p.name) + '</span><span class="pc-id">' + esc(p.id) + '</span><span class="pc-sub">Tap to open this wallet' + (hand ? ' · ' + (hand === 'left' ? 'Left' : 'Right') + ' palm registered' : '') + '</span></button>';
        }).join('')
      : '<p class="sub" style="margin:0">No palm is registered on this device yet. Register a palm first — registration issues the Biom ID and creates the wallet automatically.</p>';
    document.querySelectorAll('[data-open-wallet]').forEach(function (b) {
      b.addEventListener('click', function () { openWalletDirect(b.dataset.openWallet); });
    });
  }
  /* v60: open the tapped profile's wallet — session only.
     No camera, no scan, no record: entry is a tap. */
  function openWalletDirect(personId) {
    var person = walletPeopleCache.find(function (p) { return p.id === personId; });
    if (!person) return;
    walletSessionId = personId;
    hideWalletScan();
    renderWallet();
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
    /* v64 (Seat 1 L-2): after a completed Add / Send / Pay, the new
       balance pulses once. Display only — the value itself was set
       by the money flow, and the flag is raised only on its success
       paths. */
    if (balanceFlashPending) {
      balanceFlashPending = false;
      var balEl = $('wHomeBalance');
      balEl.classList.remove('balflash');
      void balEl.offsetWidth;
      balEl.classList.add('balflash');
      balEl.addEventListener('animationend', function h() { balEl.classList.remove('balflash'); balEl.removeEventListener('animationend', h); });
    }
    $('wBalEye').classList.toggle('off', balanceHidden);
    if ($('wHomePoints')) $('wHomePoints').textContent = Number(me.loyaltyPoints || 0).toLocaleString() + ' pts';
    /* v67: the prototype wallet home's greeting and the
       "Your wallet" facts card — read live from the same
       record, like everything else on this page. */
    if ($('wHomeGreet')) {
      var hrNow = new Date().getHours();
      var greetWord = hrNow < 12 ? 'Good morning' : hrNow < 17 ? 'Good afternoon' : 'Good evening';
      $('wHomeGreet').innerHTML = greetWord + ', <b>' + esc(me.name) + '</b>';
    }
    if ($('wFactId')) $('wFactId').textContent = me.id;
    if ($('wFactPalm')) {
      var factHand = B.palmProfileHand(me.palmProfile);
      $('wFactPalm').textContent = personHasMethod(me)
        ? (factHand === 'left' ? 'Left palm registered' : factHand === 'right' ? 'Right palm registered' : 'Palm registered')
        : 'No palm registered';
    }
    if ($('wFactPhone')) $('wFactPhone').textContent = me.phone || 'No phone number recorded';
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
    var stmtDesc = w.statement.slice().reverse();
    var rows = stmtDesc.map(function (e, actIdx) {
      var meta = '<div class="ar-meta">' + esc(fmtTime(e.ts)) + ' · Ref ' + esc(e.ref) + ' · Balance after: ' + fmtBDT(e.balanceAfter) + '</div>';
      var open = ' data-act-idx="' + actIdx + '" tabindex="0" role="button" aria-label="Show activity detail"';
      if (e.kind === 'add') {
        return '<div class="actrow"' + open + '><span class="acticon in">' + downArrow + '</span><div class="ar-main"><div class="ar-title">Money added (demo)</div><div class="ar-meta">From ' + esc(e.accountType) + ' — ' + esc(e.accountLabel) + '</div>' + meta + '</div><div class="amt in num">+ ' + fmtBDT(e.amount) + '</div></div>';
      }
      if (e.kind === 'send') {
        return '<div class="actrow"' + open + '><span class="acticon out">' + upArrow + '</span><div class="ar-main"><div class="ar-title">Sent (demo)</div><div class="ar-meta">To ' + esc(e.counterpartyName) + ' (' + esc(e.counterpartyId) + ')</div>' + meta + '</div><div class="amt out num">− ' + fmtBDT(e.amount) + '</div></div>';
      }
      return '<div class="actrow"' + open + '><span class="acticon in">' + downArrow + '</span><div class="ar-main"><div class="ar-title">Received (demo)</div><div class="ar-meta">From ' + esc(e.counterpartyName) + ' (' + esc(e.counterpartyId) + ')</div>' + meta + '</div><div class="amt in num">+ ' + fmtBDT(e.amount) + '</div></div>';
    }).join('');
    $('wHomeStatement').innerHTML = rows || '<p class="sub" style="margin:0">No activity yet — add or send demo money and it will appear here.</p>';
    /* v66: Activity list–detail on desktop — selecting a record
       fills the inspector panel beside the list; on mobile the
       rows keep today's behaviour (no panel, no navigation). */
    document.querySelectorAll('#wHomeStatement .actrow').forEach(function (row) {
      var openDetail = function () { showActivityDetail(stmtDesc[Number(row.dataset.actIdx)], me); };
      row.addEventListener('click', openDetail);
      row.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDetail(); } });
    });
  }
  function showActivityDetail(e, me) {
    var panel = $('activityInspector');
    if (!panel || !e) return;
    if (!window.matchMedia || !window.matchMedia('(min-width: 1024px)').matches) return;
    var kindLabel = e.kind === 'add' ? 'Money added (demo)' : e.kind === 'send' ? 'Sent (demo)' : e.kind === 'receive' ? 'Received (demo)' : String(e.kind || '');
    var party = e.kind === 'add'
      ? '<b>From:</b> ' + esc(e.accountType || '') + ' — ' + esc(e.accountLabel || '') + '<br><b>Biom ID:</b> ' + esc(me.id)
      : '<b>Counterparty:</b> ' + esc(e.counterpartyName || '') + '<br><b>Biom ID:</b> ' + esc(e.counterpartyId || '');
    $('activityDetailBody').innerHTML =
      '<b>Kind:</b> ' + esc(kindLabel) + '<br>' + party + '<br>' +
      '<b>Amount:</b> <span class="num">' + fmtBDT(e.amount) + '</span><br>' +
      '<b>Time:</b> <span class="num">' + esc(fmtTime(e.ts)) + '</span><br>' +
      '<b>Reference:</b> ' + esc(e.ref || '') + '<br>' +
      '<b>Balance after:</b> <span class="num">' + fmtBDT(e.balanceAfter) + '</span><br>' +
      '<b>Device:</b> This device — wallet records are kept on this device<br>' +
      '<b>Settlement:</b> ' + esc(e.note || 'Demo money inside this app — not real funds.');
    panel.classList.remove('hidden');
  }

  /* Shared wallet scan card: one camera surface, the caller's run()
     performs the scan and its outcome handling.
     v58 manual: showing the card starts the camera and ARMS
     the card — the caller's run() performs the scan only when
     Scan is tapped. (At v43-v57 showing the card started the
     scan by itself.) A scan session tracks stability and the
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
  function setScanInd(id, state, text) {
    var el = $(id);
    if (!el) return;
    el.classList.toggle('ok', state === 'ok');
    el.classList.toggle('warn', state === 'warn');
    var t = el.querySelector('.indtxt');
    if (t) t.textContent = text;
  }
  /* v64 (Seat 1 G-1, closes R-24): the wallet card's indicator set is
     now a factory — every scan surface gets the same pill + Hand /
     Light / Steady indicators, driven by the SAME per-frame info its
     stream already emits through control.onFrame (both stream loops
     emit hasHand / meanLuma / glareFrac / frameComplete / frameIssue)
     and the surface's own scan session for steadiness. Presentation
     only: the indicators gate nothing, exactly as on the wallet card. */
  function makeScanIndicators(prefix) {
    var key = '';
    return {
      update: function (info, frameRes) {
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
        var k = handState + handText + '|' + lightState + '|' + (steady ? '1' : '0');
        if (k === key) return;
        key = k;
        setScanInd(prefix + 'IndHand', handState, handText);
        setScanInd(prefix + 'IndLight', lightState, lightText);
        setScanInd(prefix + 'IndSteady', steady ? 'ok' : 'wait', steady ? 'Holding steady' : 'Hold steady');
      },
      reset: function () {
        key = '';
        setScanInd(prefix + 'IndHand', 'wait', 'No hand yet');
        setScanInd(prefix + 'IndLight', 'wait', 'Light —');
        setScanInd(prefix + 'IndSteady', 'wait', 'Hold steady');
      }
    };
  }
  var balanceFlashPending = false;
  var walletInds = makeScanIndicators('w');
  var enrolInds = makeScanIndicators('e');
  var termInds = makeScanIndicators('t');
  var topupInds = makeScanIndicators('u');
  var enrolSession = B.createScanSession();
  var topupSession = B.createScanSession();
  function updateScanIndicators(info, frameRes) { walletInds.update(info, frameRes); }
  function resetScanIndicators() { walletInds.reset(); }
  /* v64: the per-surface scan pills — 'Ready' while a surface is armed
     (preview live, waiting for the Scan tap), 'Scanning' only while a
     tapped scan is actually running. The wallet pill predates this
     (v58); enrolment, terminal and Add Angles now carry the same pill. */
  function setSurfacePill(prefix, text) {
    var t = $(prefix + 'ScanPillText');
    if (t) t.textContent = text;
  }
  /* v58: the wallet card's state pill — 'Ready' while the view
     is armed (preview live, waiting for the Scan tap) and
     'Scanning' only while a tapped scan is actually running. */
  function setScanPill(text) {
    var t = $('wScanPillText');
    if (t) t.textContent = text;
  }
  function showWalletScan(ctx) {
    walletScanCtx = ctx;
    walletSession.enter();
    resetScanIndicators();
    setScanPill('Ready');
    scanTimerReset('w'); // v74: a fresh card never shows a previous scan's time
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
    /* v79: every flow on this shared card authorises as the
       signed-in account (Add Money, Send Money, Biom Pay,
       Verify). When that account is blocked, the card shows the
       blocked state and the camera never starts — no scan is
       run, nothing can be authorised, and the person is told
       plainly why instead of meeting a vague failure after a
       scan. The test (walletBlockedActive) consults the sync
       engine's own-account latch AND the persisted blocked-ID
       set: the latch alone is memory-only (a Settings save
       clears it until the next pull), while the set survives
       restarts and settings changes. */
    if (walletBlockedActive()) {
      $('wScanStatus').textContent = 'Account blocked';
      $('wScanMsg').innerHTML = '<div class="error">' + BLOCKED_ACCOUNT_LINE + '</div>';
      $('wScanStart').disabled = true;
      return;
    }
    $('wScanStart').disabled = false;
    startWalletCamera();
  }
  /* v79 (seat review): the single blocked test for every
     wallet camera/scan entry point — the card, Start Camera,
     the camera switch and Scan itself all run it, so a blocked
     account cannot be re-armed through the camera buttons
     after the card has shown the blocked state, and a block
     learned while the card is open is honoured at Scan time. */
  function walletBlockedActive() {
    if (Sync.state().blocked) return true;
    var me = null;
    try { me = walletSessionPerson(); } catch (e) { me = null; }
    return !!me && Sync.isBlocked(me.id);
  }
  function startWalletCamera() {
    if (walletBlockedActive()) { if (walletScanCtx) showWalletScan(walletScanCtx); return Promise.resolve(); }
    return Cam.start($('wScanVideo'), camFacing.walletAct, 'walletAct').then(function () {
      Pipeline.enterScanView();
      $('wScanRun').disabled = false;
      // v58 MANUAL SCAN (the Chairman's order, 2026-11-25):
      // opening the camera NEVER starts a scan. The card is
      // armed — preview live, guide frame up, Scan enabled —
      // and analysis begins only on the Scan tap
      // (runWalletScan). An untapped preview analyses nothing,
      // can produce no verdict and queues no scan record.
      $('wScanStatus').textContent = 'Camera on — position the open palm in the frame, then tap Scan.';
    }).catch(function (e) { $('wScanMsg').innerHTML = cameraErrorHTML(e); $('wScanStatus').textContent = 'Camera blocked.'; });
  }
  function runWalletScan() {
    if (!walletScanCtx || palmScanBusy) return;
    if (walletBlockedActive()) { showWalletScan(walletScanCtx); return; }
    palmScanBusy = true;
    moneyCommitBusy = true; // v71: held until the flow's writes settle, not just the scan
    $('wScanRun').disabled = true;
    setScanPill('Scanning');
    scanTimerStart('w', 'Scanned in '); // v74: the tap is where analysis begins (v58) — the timer starts here
    var ctx = walletScanCtx;
    walletControl = { cancelled: false, onFrame: function (info) { var fr = walletSession.frame({ hasHand: info.hasHand, pose: info.pose }); updateScanIndicators(info, fr); } };
    Promise.resolve()
      .then(function () { return ctx.run(); })
      .catch(function (e) { walletScanFailed({ fail: 'Scan failed: ' + (e && e.message ? e.message : e) }); })
      .then(function () {
        palmScanBusy = false; moneyCommitBusy = false; walletSession.verdict();
        scanTimerStop('w'); // v74: the verdict is rendered by now — freeze the total in the pill
        // v58: a judged scan leaves the card ARMED, not
        // re-scanning — the next scan needs a fresh tap.
        if (!$('walletScanCard').classList.contains('hidden')) setScanPill('Ready');
        checkPendingSwReload(); // v71: deliver a held update reload now the flow has settled
      });
  }
  function hideWalletScan() {
    if (walletControl) walletControl.cancelled = true;
    scanTimerStop('w'); // v74: leaving the card ends any still-ticking readout (a frozen verdict time is kept)
    walletSession.leave();
    $('walletScanCard').classList.add('hidden');
    walletScanCtx = null;
    Cam.stop();
    checkPendingSwReload(); // v71: closing the scan card is a flow boundary
  }
  /* SCAN-TIMER-BEGIN — v74: the on-screen scan timer (Chairman's
     order, 2026-11-26, quoted in the header note). Pure and
     injectable — the v74 suite drives it over a fake clock and
     fake interval timers. One timer per scan surface (w/e/t/u,
     bound to that surface's pill readout). The measured span is
     the user-facing scan: start() is called at the scan tap —
     the v58 manual-scan moment analysis actually begins — and
     stop() at the verdict; the displayed value is the real
     elapsed milliseconds on THIS device, rendered in tenths by
     toFixed(1) (nearest tenth of the true value — never floored,
     never cached, never carried between scans). The tick is one
     textContent write every 100 ms on a pill element OUTSIDE the
     frame loop: the scan pipeline never reads the timer, so it
     cannot slow a scan or change a verdict. */
  function createScanTimer(deps) {
    deps = deps || {};
    var nowFn = typeof deps.now === 'function' ? deps.now : function () { return performance.now(); };
    var setInt = typeof deps.setInterval === 'function' ? deps.setInterval : function (fn, ms) { return setInterval(fn, ms); };
    var clearInt = typeof deps.clearInterval === 'function' ? deps.clearInterval : function (id) { clearInterval(id); };
    var TICK_MS = 100;
    var el = null, startMs = null, frozenMs = null, tickId = null, stopLabel = '', stopStampMs = null;
    function elapsedMs() {
      if (startMs === null) return 0;
      if (frozenMs !== null) return frozenMs;
      var d = nowFn() - startMs;
      return d > 0 ? d : 0;
    }
    function fmt(ms) { return (ms / 1000).toFixed(1) + 's'; }
    function paint() { if (el && frozenMs === null) el.textContent = fmt(elapsedMs()); }
    function clearTick() { if (tickId !== null) { clearInt(tickId); tickId = null; } }
    return {
      bind: function (element) { el = element || null; },
      start: function (label) {
        clearTick();
        stopLabel = typeof label === 'string' ? label : '';
        startMs = nowFn(); frozenMs = null; stopStampMs = null;
        paint();
        tickId = setInt(paint, TICK_MS);
      },
      stop: function () {
        if (startMs === null) return 0;
        if (frozenMs === null) {
          frozenMs = elapsedMs();
          stopStampMs = nowFn();
          clearTick();
          if (el) el.textContent = stopLabel + fmt(frozenMs);
        }
        return frozenMs;
      },
      reset: function () {
        clearTick(); startMs = null; frozenMs = null; stopStampMs = null;
        if (el) el.textContent = '';
      },
      elapsedMs: elapsedMs,
      elapsedText: function () { return fmt(elapsedMs()); },
      running: function () { return startMs !== null && frozenMs === null; },
      hasRun: function () { return startMs !== null; },
      startedAtMs: function () { return startMs; },
      stoppedAtMs: function () { return stopStampMs; },
      TICK_MS: TICK_MS
    };
  }
  /* SCAN-TIMER-END */
  var ScanTimers = { w: createScanTimer(), e: createScanTimer(), t: createScanTimer(), u: createScanTimer() };
  function scanTimerStart(prefix, label) {
    var tm = ScanTimers[prefix]; if (!tm) return;
    tm.bind($(prefix + 'ScanTimer')); tm.start(label);
  }
  function scanTimerStop(prefix) { var tm = ScanTimers[prefix]; if (tm) tm.stop(); }
  function scanTimerReset(prefix) { var tm = ScanTimers[prefix]; if (tm) tm.reset(); }
  /* v74 (scope extension): which surface timer measured the scan
     a sync record describes, so noteScan can stamp the record
     with the same real duration the on-screen timer showed.
     Kind-unique surfaces answer directly. verify / money-auth /
     identify run on BOTH the wallet card and the terminal: the
     scan in progress — or, for records written just after a
     verdict, the surface that stopped most recently — is the
     measurement (palmScanBusy serialises scans, so at most one
     surface is mid-scan when a record is written). No live timer
     reading -> null: the record rides unmeasured, never
     estimated. */
  function scanDurationForKind(kind) {
    var direct = { 'enrol': 'e', 'topup': 'u', 're-register': 'u', 'owner-unlock': 'w', 'field-test': 't' }[kind];
    if (direct) {
      var tm = ScanTimers[direct];
      return tm && tm.hasRun() ? Math.round(tm.elapsedMs()) : null;
    }
    var cands = [ScanTimers.w, ScanTimers.t].filter(function (t) { return t && t.hasRun(); });
    if (!cands.length) return null;
    var running = cands.filter(function (t) { return t.running(); });
    var pool = running.length ? running : cands;
    pool.sort(function (a, b) {
      var av = running.length ? (a.startedAtMs() || 0) : (a.stoppedAtMs() || 0);
      var bv = running.length ? (b.startedAtMs() || 0) : (b.stoppedAtMs() || 0);
      return bv - av;
    });
    return Math.round(pool[0].elapsedMs());
  }

  /* SCAN-GUIDANCE-BEGIN — v69: per-cause guidance for a failed
     wallet scan. The Chairman's 2026-11-26 friction report was
     one session cycling "unauthorised" → "antispoof" → "no
     hand" → recognised: three different alarming labels, none
     of which told him what to DO next. The verdict text itself
     is unchanged (honesty of verdicts is not negotiable — a
     genuine non-match still reads as a non-match); what this
     factory adds is the cause's own calm next step, derived
     from the same outcome object the verdict was built from,
     so the guidance can never contradict the verdict. Pure:
     the suite drives it over fabricated outcomes. */
  function createScanGuidance() {
    var LINES = {
      'detector': 'Wait a few seconds, then tap Scan again — the detector loads once and then stays ready.',
      'spoof': 'Use the real hand itself, live in front of the camera — not a photo, a screen or a recording of it.',
      'liveness-static': 'Hold your real hand live in front of the camera and let it settle naturally — a tiny natural movement is expected.',
      'liveness-erratic': 'Hold one open palm steady in the frame and keep it there while the scan runs.',
      'strict-margin': 'Your palm matched, but not clearly enough above every other palm on this device. Scan again in brighter light, palm flat and fully in frame.',
      'strict-frames': 'Keep the palm in view a moment longer — a money scan needs the match confirmed on a second frame.',
      'hand-gate': 'This profile is registered to your other hand — present that hand, or switch to its profile.',
      'unreadable': 'Fit the whole palm in the frame, fingers spread, in brighter light, and hold it steady.',
      'nomatch': 'That palm did not match this profile. Use the registered hand, flat and fully in frame, in good light.',
      'generic': 'Position the open palm fully in the frame, in good light, hold it steady, and tap Scan again.'
    };
    function causeOf(out) {
      if (!out || typeof out !== 'object') return 'generic';
      if (out.detectorFailed) return 'detector';
      var fail = typeof out.fail === 'string' ? out.fail : '';
      if (fail.indexOf('Spoof / Screen Replay') === 0) return 'spoof';
      if (fail.indexOf('Liveness check failed') === 0) {
        return (fail.indexOf('did not move') !== -1 || fail.indexOf('still photo') !== -1) ? 'liveness-static' : 'liveness-erratic';
      }
      if (fail.indexOf('Liveness could not be confirmed') === 0) return 'liveness-static';
      if (out.r && typeof out.r.reason === 'string' && out.r.reason.indexOf('liveness could not be confirmed') !== -1) return 'liveness-static';
      if (out.strictMoney && out.strictMoney.block === 'margin') return 'strict-margin';
      if (out.strictMoney && out.strictMoney.block === 'frames') return 'strict-frames';
      if (out.diag && out.diag.strictBlock === 'margin') return 'strict-margin';
      if (out.diag && out.diag.strictBlock === 'frames') return 'strict-frames';
      if (out.diag && out.diag.handGate) return 'hand-gate';
      if (fail.indexOf('No usable open palm') === 0) return 'unreadable';
      if (fail.indexOf('Matched, but not clearly enough') === 0) return 'strict-margin';
      if (out.diag && (typeof out.diag.edcc === 'number' || typeof out.diag.neural === 'number')) return 'nomatch';
      return 'generic';
    }
    function lineFor(out) {
      var c = causeOf(out);
      return { cause: c, line: LINES[c] };
    }
    /* The causes for which a thin bank is the plausible root
       and the Strengthen offer belongs on the failure sheet:
       scored-but-refused outcomes. A detector failure, a spoof
       conviction or a wrong-hand scan is not a thin-bank
       problem and never carries the offer. */
    var STRENGTHEN_CAUSES = { 'nomatch': true, 'strict-margin': true, 'strict-frames': true, 'unreadable': true };
    function strengthenApplies(out) { return STRENGTHEN_CAUSES[causeOf(out)] === true; }
    return { causeOf: causeOf, lineFor: lineFor, strengthenApplies: strengthenApplies, LINES: LINES };
  }
  /* SCAN-GUIDANCE-END */
  var ScanGuidance = createScanGuidance();

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
    // v53: under the message, the measured diagnosis panel.
    // v60: the panel is ALL a failed scan shows here — the
    // v53 owner-recovery entry that used to hang off the
    // wallet-open failures moved to My Account → Palm
    // Identity (Strengthen my palm / Neural scan /
    // Re-register this palm), because wallet entry is no
    // longer a scan and so can no longer fail as one. The
    // panel itself stays where it belongs: on actual scan
    // failures — terminal, money auth, quick verify.
    var diagHtml = scanDiagHTML(out && out.diag);
    var ctx = walletScanCtx;
    // v56 Scan Sync: a judged scan that failed queues its record
    // too — the Chairman asked to see every scan, not only passes.
    // (No diag = no judged scan — a camera failure queues nothing.)
    /* v79 (abuse category: spoofing): a SPOOF verdict on a
       wallet authorisation is attributed to the signed-in
       account — someone is presenting a photo or a screen to
       this phone's money scan, and the server counts those
       (owner-device, attributed) toward its spoof auto-block.
       It replaces the anonymous Denied record below for this
       scan: the attributed record is strictly more informative,
       and one scan must not write two records. The ordinary
       Denied record keeps its v53 shape untouched. */
    var spoofAttributed = false;
    if (ctx && ctx.syncKind && out && typeof out.fail === 'string' && out.fail.indexOf('Spoof / Screen Replay') === 0) {
      var meSpoof = walletSessionPerson();
      if (meSpoof) {
        scanTimerStop('w');
        Sync.noteScan({ kind: ctx.syncKind, profileName: meSpoof.name, biomId: meSpoof.id, hand: out.diag ? (out.diag.probeHand || null) : null, edccScore: out.diag && typeof out.diag.edcc === 'number' ? out.diag.edcc : null, palmnetScore: out.diag && typeof out.diag.neural === 'number' ? out.diag.neural : null, result: 'Spoof / Screen Replay Detected', fieldTest: fieldModeOn() });
        spoofAttributed = true;
      }
    }
    if (!spoofAttributed && ctx && ctx.syncKind && out && out.diag) {
      scanTimerStop('w'); // v74 (Seat 1 fix): freeze first, so the record stamps the shown total
      Sync.noteScan({ kind: ctx.syncKind, profileName: '', biomId: '', hand: out.diag.probeHand || null, edccScore: typeof out.diag.edcc === 'number' ? out.diag.edcc : null, palmnetScore: typeof out.diag.neural === 'number' ? out.diag.neural : null, result: 'Denied' });
    }
    /* v69: under the verdict, the cause's own next step — and,
       when this profile's bank is thin and the cause is a
       scored-but-refused one, the Strengthen offer into the
       existing Add Angles flow (the same door My Account's
       "Strengthen my palm" opens). The verdict text above is
       untouched; this panel only ever adds guidance. */
    var guide = ScanGuidance.lineFor(out);
    var extraHtml = '<div class="diagpanel"><div class="diagtitle">What to try next</div><div class="diagrow">' + esc(guide.line) + '</div></div>';
    var meNow = walletSessionPerson();
    if (meNow && personHasMethod(meNow) && B.palmBankThin(meNow.palmProfile) && ScanGuidance.strengthenApplies(out)) {
      extraHtml += '<div style="margin-top:10px"><button class="btn primary" id="wScanStrengthen">Strengthen your palm</button>' +
        '<div class="sub" style="margin-top:6px">This palm was enrolled once and never strengthened. Adding angles gives the scanner more of your palm to recognise, so scans like this one pass more reliably.</div></div>';
    }
    $('wScanDiag').innerHTML = diagHtml + extraHtml;
    var strengthenBtn = $('wScanStrengthen');
    if (strengthenBtn) strengthenBtn.addEventListener('click', function () {
      var p = walletSessionPerson();
      hideWalletScan();
      if (p) openTopup(p.id);
    });
    $('wScanRun').disabled = false;
    Snd.buzz();
  }
  /* v53 OWNER RECOVERY — v60 RELOCATED: the lockout this
     breaks is unchanged — a genuine owner whose thin bank
     scores just under the bar is refused by the same bars at
     Add Angles (the v49 banking guard), so the bank that is
     failing him can never grow. What moved is only the ENTRY:
     at v53-v59 the entry hung off a failed wallet-open scan;
     at v60 wallet entry is no longer a scan, so the same
     actions live on the owner's own Palm Identity card
     (My Account): "Strengthen my palm" runs the existing
     guided Add Angles capture under that same guard, and
     "Re-register this palm" enters through openRecoveryTopup
     so a guard refusal inside that capture offers the same
     confirmation-gated re-registration (see runTopupCapture).
     The guards, the grant and the typed REPLACE are the
     v53/v55 machinery, untouched — only the door moved. */
  $('wScanStart').addEventListener('click', startWalletCamera);
  camRestarters.walletAct = function () {
    // v49: this restarter was the one camera-start caller with no
    // rejection path — a failed restart vanished silently and the
    // scan card sat dead. It now surfaces the same camera error
    // as startWalletCamera.
    // v58: a camera switch re-arms the card — it never starts a
    // scan. (Mid-scan, the running stream simply continues on
    // the new camera, exactly as the v57 switch behaves; the
    // busy branch below leaves its status line alone.)
    // v79: a blocked account is never re-armed by a camera switch.
    if (walletBlockedActive()) { if (walletScanCtx) showWalletScan(walletScanCtx); return; }
    Cam.start($('wScanVideo'), camFacing.walletAct, 'walletAct').then(function () {
      if (!palmScanBusy && walletScanCtx) {
        $('wScanRun').disabled = false;
        $('wScanStatus').textContent = 'Camera on — position the open palm in the frame, then tap Scan.';
      }
    }).catch(function (e) { $('wScanMsg').innerHTML = cameraErrorHTML(e); $('wScanStatus').textContent = 'Camera blocked.'; });
  };
  $('wScanRun').addEventListener('click', runWalletScan);
  $('wScanCancel').addEventListener('click', function () {
    if (palmScanBusy) { if (walletControl) walletControl.cancelled = true; return; }
    hideWalletScan();
    renderWallet();
  });

  /* v60: the two wallet-open scan routes that stood here
     (the generic 1:N identify and the per-profile 1:1 verify)
     are REMOVED — wallet entry is no longer a scan at all.
     Entry lives in renderWallet / resolveWalletEntry /
     openWalletDirect above: one enrolled profile opens
     directly, several show the tap-to-choose picker, none
     points at enrolment. The v50 history is worth keeping
     in one line: the strict money rule never belonged on
     entry either — it stays on the three money-moving
     authorisations only (Add Money, Send Money sender
     authorisation, terminal Biom Pay), and those scans,
     plus the Send receiver identify and quick verify, keep
     using the shared wallet scan card exactly as before.
     Entry queues no 'wallet-open' scan record any more;
     the sync engine still accepts the kind (old records
     already on the server keep it) — it simply has no
     producer left in the app. */
  function closeWalletSession() {
    walletSessionId = null;
    Cam.stop();
    // v60: closing returns to the entry state renderWallet
    // resolves — the picker when several profiles are
    // enrolled (a real switch), the enrolment pointer when
    // none are. With exactly one profile there is nothing
    // to switch to and no lock to return to: the only wallet
    // simply stays the open one, so no 'closed' toast lies
    // about it.
    var withPalm = walletPeopleCache.filter(function (p) { return personHasMethod(p); });
    renderWallet();
    if (withPalm.length !== 1) toast('Wallet closed.');
  }
  $('wCloseWallet').addEventListener('click', closeWalletSession);

  /* Add Money: amount -> funding account -> OWN palm authorises. */
  function renderAddAccounts(me, selectedId) {
    var w = B.walletEnsurePerson(me).wallet;
    $('wAddAccountSelect').innerHTML = w.linkedAccounts.length
      ? w.linkedAccounts.map(function (a) { return '<option value="' + esc(a.id) + '"' + (a.id === selectedId ? ' selected' : '') + '>' + esc(a.type) + ' — ' + esc(a.label) + '</option>'; }).join('')
      : '<option value="">No funding account linked yet — add one below</option>';
  }
  /* v64 (Seat 3 R-UX2 + Seat 1 M-3): projected post-transaction
     balance on the amount screens — display-only arithmetic from the
     balance captured when the card opened and the amount as typed;
     it authorises nothing and is never written anywhere. And the
     Send step bar: the same transform-driven progress the enrolment
     flow uses, advanced at the flow's existing step boundaries. */
  var projBase = { add: 0, send: 0, pay: 0 };
  function updateProjected(amountId, lineId, key, dir) {
    var line = $(lineId);
    if (!line) return;
    var field = $(amountId);
    var raw = field ? field.value : '';
    var n = Number(raw);
    if (raw === '' || !isFinite(n) || n <= 0) { line.textContent = ''; return; }
    line.textContent = 'Balance after: ' + fmtBDT(projBase[key] + dir * n);
  }
  [['wAddAmount', 'wAddProjected', 'add', 1], ['wSendAmount', 'wSendProjected', 'send', -1], ['wPayAmount', 'wPayProjected', 'pay', -1]].forEach(function (cfg) {
    var field = $(cfg[0]);
    if (field) field.addEventListener('input', function () { updateProjected(cfg[0], cfg[1], cfg[2], cfg[3]); });
  });
  function setSendProgress(step) {
    var bar = $('wSendProgressBar');
    if (bar) bar.style.transform = 'scaleX(' + (step / 3) + ')';
    var lbl = $('wSendProgressLabel');
    if (lbl) lbl.textContent = step === 1 ? 'Step 1 of 3 — Receiver' : step === 2 ? 'Step 2 of 3 — Amount' : 'Step 3 of 3 — Review and confirm with your palm';
  }
  $('wAddOpen').addEventListener('click', function () {
    var me = walletSessionPerson();
    if (!me) return;
    $('walletHome').classList.add('hidden');
    $('walletAdd').classList.remove('hidden');
    $('wAddMsg').innerHTML = '';
    $('wAddBalance').textContent = fmtBDT(B.walletEnsurePerson(me).wallet.balance);
    projBase.add = B.walletEnsurePerson(me).wallet.balance;
    updateProjected('wAddAmount', 'wAddProjected', 'add', 1);
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
      syncKind: 'money-auth', // v56 Scan Sync kind for this context
      prompt: 'Scan YOUR OWN palm to add ' + fmtBDT(amt.amount) + ' of demo money to your wallet. Another person\'s palm, or no match, adds nothing.',
      run: function () {
        return DB.all('people').then(function (people) {
          var fresh = people.find(function (p) { return p.id === me.id; }) || me;
          return streamVerifyPalm($('wScanVideo'), $('wScanStatus'), fresh, people, null, function () {}, walletControl, { strictMoney: true }).then(function (out) {
            var auth = authFromVerify(out, fresh.id);
            if (!auth.verified) { walletScanFailed(out); return; }
            return DB.nextSeq('demoSeq', 1).then(function (seq) {
              var res = B.walletApplyAddMoney(fresh, amt.amount, accountId, auth, Date.now(), B.walletDemoRef(seq));
              if (!res.ok) { $('wScanMsg').innerHTML = '<div class="error">' + esc(res.error) + '</div>'; $('wScanRun').disabled = false; return; }
              return DB.put('people', res.person).then(function () {
                /* v67: the Inbox event is written HERE — on the
                   success path only, after the updated record is
                   stored. A refused scan or a failed apply never
                   reaches this line, so it can never notify. */
                Inbox.add(res.person.id, Inbox.event('add', { amount: res.entry.amount, balanceAfter: res.entry.balanceAfter, ref: res.entry.ref, detail: 'From ' + res.entry.accountType + ' — ' + res.entry.accountLabel + ' · Demo money' }));
                scanTimerStop('w'); // v74 (Seat 1 fix): freeze first, so the record stamps the shown total
                Sync.noteScan({ kind: 'money-auth', profileName: fresh.name, biomId: fresh.id, hand: out.diag ? out.diag.probeHand : null, edccScore: out.diag ? out.diag.edcc : null, palmnetScore: out.diag ? out.diag.neural : null, result: 'Verified' });
                noteMoneyProfile(res.person); // v78: mirror the new balance + ledger to the dashboard dossier
                balanceFlashPending = true;
                hideWalletScan();
                return renderWallet();
              }).then(function () {
                $('wHomeMsg').innerHTML = '<div class="success">' + fmtBDT(res.entry.amount) + ' of demo money added from ' + esc(res.entry.accountType) + ' — ' + esc(res.entry.accountLabel) + '. New demo balance: ' + fmtBDT(res.entry.balanceAfter) + '.<br>Reference: ' + esc(res.entry.ref) + ' (demo reference — not a ' + esc(res.entry.accountType) + ' transaction ID).<br>Scanned in ' + ScanTimers.w.elapsedText() + '.</div>';
                toast('Demo money added');
                Snd.chime();
              });
            });
          });
        });
      }
    });
  });

  /* Send Money (v63 order, the Chairman 2026-11-25 10:47):
     (1) the RECEIVER's palm identifies them, (2) the amount is
     entered, (3) the sender's OWN palm authorises — then the
     payment completes. (Before v63 the amount came first.) The
     store layer re-checks every rule at apply time (receiver
     registered, not self, amount within balance, authorisation
     is the sender). */
  $('wSendOpen').addEventListener('click', function () {
    var me = walletSessionPerson();
    if (!me) return;
    sendDraft = { amount: null, receiverId: null, receiverName: null };
    $('walletHome').classList.add('hidden');
    $('walletSend').classList.remove('hidden');
    $('wSendBalance').textContent = fmtBDT(B.walletEnsurePerson(me).wallet.balance);
    projBase.send = B.walletEnsurePerson(me).wallet.balance;
    setSendProgress(1);
    $('wSendMsg').innerHTML = '';
    $('wSendAmount').value = '';
    updateProjected('wSendAmount', 'wSendProjected', 'send', -1);
    $('wSendReceiverLine').innerHTML = '';
    $('wSendAmountBlock').classList.add('hidden');
    $('wSendConfirm').classList.add('hidden');
    $('wSendConfirm').innerHTML = '';
  });
  $('wSendBack').addEventListener('click', function () { renderWallet(); });
  $('wSendScanReceiver').addEventListener('click', function () {
    var me = walletSessionPerson();
    if (!me) return;
    showWalletScan({
      title: 'Send money — scan the receiver\'s palm',
      syncKind: 'identify', // v56 Scan Sync kind for this context
      prompt: 'The RECEIVER shows their open palm. The scan finds their Biom ID — if the palm matches no registered palm, no money can be sent.',
      run: function () {
        return DB.all('people').then(function (people) {
          return streamIdentifyPalm($('wScanVideo'), $('wScanStatus'), people, null, walletControl).then(function (out) {
            if (!out || out.fail || !out.person) { walletScanFailed(out); return; }
            if (out.person.id === me.id) {
              $('wScanMsg').innerHTML = '<div class="error">That is your own palm — you cannot send money to yourself. Scan the receiver\'s palm.</div>';
              $('wScanRun').disabled = false;
              Snd.buzz();
              return;
            }
            /* v79 (seat review): a blocked account cannot
               receive either — the block is total and its wallet
               is seized, so a Send to it stops at identification,
               with the reason stated plainly. Same treatment as
               the merchant terminal gives a blocked palm. */
            if (Sync.isBlocked(out.person.id)) {
              $('wScanMsg').innerHTML = '<div class="error">' + BLOCKED_TERMINAL_LINE + ' Money cannot be sent to a blocked account.</div>';
              $('wScanRun').disabled = false;
              Snd.buzz();
              return;
            }
            sendDraft.receiverId = out.person.id;
            sendDraft.receiverName = out.person.name;
            sendDraft.amount = null;
                        scanTimerStop('w'); // v74 (Seat 1 fix): freeze first, so the record stamps the shown total
Sync.noteScan({ kind: 'identify', profileName: out.person.name, biomId: out.person.id, hand: out.diag ? out.diag.probeHand : null, edccScore: out.diag ? out.diag.edcc : null, palmnetScore: out.diag ? out.diag.neural : null, result: 'Verified' });
            hideWalletScan();
            $('walletSend').classList.remove('hidden');
            /* v63 step 2: the receiver is known — now the
               amount is entered against their verified card. */
            $('wSendReceiverLine').innerHTML =
              '<div class="recvcard"><div class="rc-head"><span class="avatarbtn" style="background:var(--blue);border:none;cursor:default">' + esc(initialsOf(out.person.name)) + '</span>' +
              '<div><div class="rc-name">' + esc(out.person.name) + '</div><div class="rc-id">' + esc(out.person.id) + '</div></div>' +
              '<span class="badge ok" style="margin-left:auto">Palm verified</span></div></div>';
            $('wSendReceiverLine').innerHTML += '<div class="sub" style="margin-top:6px">Receiver palm scanned in ' + ScanTimers.w.elapsedText() + '.</div>'; // v74: the identification scan's measured time, stated where its result lands
            $('wSendAmountBlock').classList.remove('hidden');
            setSendProgress(2);
            $('wSendConfirm').classList.add('hidden');
            $('wSendConfirm').innerHTML = '';
            $('wSendMsg').innerHTML = '';
          });
        });
      }
    });
  });
  function renderSendConfirm() {
    var me = walletSessionPerson();
    if (!me || !sendDraft.receiverId) return;
    setSendProgress(3);
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
    /* v73 (Seat 3 F2): snapshot the draft NOW, at authorise
       entry. The Send card stays live during the scan and its
       Continue handler overwrites sendDraft, so reading the
       draft at apply time (as before v73) could move a
       different amount than the one the prompt below names.
       The snapshot — and only the snapshot — is used through
       the prompt and the apply. */
    var sendSnap = { receiverId: sendDraft.receiverId, receiverName: sendDraft.receiverName, amount: sendDraft.amount };
    showWalletScan({
      title: 'Send money — authorise with your own palm',
      syncKind: 'money-auth', // v56 Scan Sync kind for this context
      prompt: 'Scan YOUR OWN palm to send ' + fmtBDT(sendSnap.amount) + ' of demo money to ' + sendSnap.receiverName + ' (' + sendSnap.receiverId + '). Only your palm can authorise a send from your wallet.',
      run: function () {
        return DB.all('people').then(function (people) {
          var freshSender = people.find(function (p) { return p.id === me.id; }) || me;
          return streamVerifyPalm($('wScanVideo'), $('wScanStatus'), freshSender, people, null, function () {}, walletControl, { strictMoney: true }).then(function (out) {
            var auth = authFromVerify(out, freshSender.id);
            if (!auth.verified) { walletScanFailed(out); return; }
            return DB.nextSeq('demoSeq', 1).then(function (seq) {
              var res = B.walletApplySend(people, freshSender.id, sendSnap.receiverId, sendSnap.amount, auth, Date.now(), B.walletDemoRef(seq));
              if (!res.ok) { $('wScanMsg').innerHTML = '<div class="error">' + esc(res.error) + '</div>'; $('wScanRun').disabled = false; return; }
              // The transfer was computed atomically from the one
              // snapshot above; persist both updated records.
              return DB.put('people', res.sender).then(function () { return DB.put('people', res.receiver); }).then(function () {
                /* v67: both Inbox events are written HERE — on
                   the success path only, after BOTH updated
                   records are stored: the sender's "Send money
                   successful" and the receiver's "You received
                   money". A refused authorisation never reaches
                   this line. */
                Inbox.add(res.sender.id, Inbox.event('send', { amount: res.senderEntry.amount, balanceAfter: res.senderEntry.balanceAfter, ref: res.senderEntry.ref, counterpartyName: res.receiver.name, detail: 'To ' + res.receiver.name + ' (' + res.receiver.id + ') · Demo money' }));
                Inbox.add(res.receiver.id, Inbox.event('receive', { amount: res.receiverEntry.amount, balanceAfter: res.receiverEntry.balanceAfter, ref: res.receiverEntry.ref, counterpartyName: freshSender.name, detail: 'From ' + freshSender.name + ' (' + freshSender.id + ') · Demo money' }));
                                scanTimerStop('w'); // v74 (Seat 1 fix): freeze first, so the record stamps the shown total
Sync.noteScan({ kind: 'money-auth', profileName: freshSender.name, biomId: freshSender.id, hand: out.diag ? out.diag.probeHand : null, edccScore: out.diag ? out.diag.edcc : null, palmnetScore: out.diag ? out.diag.neural : null, result: 'Verified' });
                noteMoneyProfile(res.sender); // v78: mirror both sides of the transfer to the dashboard dossier
                noteMoneyProfile(res.receiver);
                var sentAmount = sendSnap.amount, sentTo = sendSnap.receiverName, sentToId = sendSnap.receiverId, sentRef = res.senderEntry.ref, newBal = res.senderEntry.balanceAfter;
                sendDraft = { amount: null, receiverId: null, receiverName: null };
                balanceFlashPending = true;
                hideWalletScan();
                return renderWallet().then(function () {
                  $('wHomeMsg').innerHTML = '<div class="success">Sent ' + fmtBDT(sentAmount) + ' of demo money to ' + esc(sentTo) + ' (' + esc(sentToId) + '). New demo balance: ' + fmtBDT(newBal) + '.<br>Reference: ' + esc(sentRef) + ' (demo reference — not a real payment).<br>Scanned in ' + ScanTimers.w.elapsedText() + '.</div>';
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

  /* v63 Send step 2: the amount is entered only after the
     receiver's palm has identified them; Continue validates it
     and builds the review card whose button runs step 3 (the
     sender's authorising scan, authoriseSend above). */
  $('wSendContinue').addEventListener('click', function () {
    var me = walletSessionPerson();
    if (!me || !sendDraft.receiverId) return;
    var amt = B.walletValidateAmount($('wSendAmount').value);
    if (!amt.ok) { $('wSendMsg').innerHTML = '<div class="error">' + esc(amt.error) + '</div>'; return; }
    $('wSendMsg').innerHTML = '';
    sendDraft.amount = amt.amount;
    renderSendConfirm();
  });
  $('wSendChangeReceiver').addEventListener('click', function () {
    sendDraft = { amount: null, receiverId: null, receiverName: null };
    setSendProgress(1);
    $('wSendReceiverLine').innerHTML = '';
    $('wSendAmountBlock').classList.add('hidden');
    $('wSendConfirm').classList.add('hidden');
    $('wSendConfirm').innerHTML = '';
    $('wSendMsg').innerHTML = '';
  });

  /* ---------------- Wallet Biom Pay (v63) --------------------------
     The Chairman's wallet Pay (2026-11-25 10:47): the customer
     chooses a PARTNER STORE first — from the store list this app
     already knows (the same STORES the enrolment home-store and
     the terminal use; if that list were empty the card shows an
     honest empty state and invents nothing) — then enters the
     amount, then scans their OWN palm under the strict money
     rule: a fourth strict site, added by his explicit order.
     The payment completes exactly as a terminal Biom Pay does
     today — same linked-wallet requirement, same biometric-only
     limits, same BIOM-PAY record and status — and Palm Loyalty
     points (1 per BDT 10) are credited only after the payment
     record exists (the v59 D6 rule). */
  $('wPayOpen').addEventListener('click', function () {
    var me = walletSessionPerson();
    if (!me) return;
    $('walletHome').classList.add('hidden');
    $('walletPay').classList.remove('hidden');
    $('wPayBalance').textContent = fmtBDT(B.walletEnsurePerson(me).wallet.balance);
    projBase.pay = B.walletEnsurePerson(me).wallet.balance;
    updateProjected('wPayAmount', 'wPayProjected', 'pay', -1);
    $('wPayMsg').innerHTML = '';
    var hasStores = $('wPayStore').options.length > 0;
    $('wPayEmpty').classList.toggle('hidden', hasStores);
    $('wPayScan').disabled = !hasStores;
    /* v71: for a bKash-linked profile, say which rail will
       settle BEFORE the palm is scanned — sandbox, demo, or
       unreachable — from the API's own mode answer. */
    $('wPayRailLine').textContent = '';
    if (me.walletProvider === 'bKash' && BkashRail.hasTransport()) {
      BkashRail.mode().then(function (m) {
        if (m && m.mode === 'sandbox') $('wPayRailLine').textContent = 'Settlement rail: bKash Sandbox (test mode) — after your palm authorises, you confirm on bKash\u2019s own sandbox page. No real money.';
        else if (m && m.mode === 'demo') $('wPayRailLine').textContent = 'Settlement rail: demo ledger — the bKash sandbox is not connected on the payment server yet.';
        else $('wPayRailLine').textContent = 'Settlement rail: the payments rail answered an unexpected mode — a bKash payment cannot start.';
      }).catch(function () {
        $('wPayRailLine').textContent = 'Settlement rail: payment server unreachable — a bKash payment cannot start right now.';
      });
    }
  });
  $('wPayBack').addEventListener('click', function () { renderWallet(); });
  $('wPayScan').addEventListener('click', function () {
    var me = walletSessionPerson();
    if (!me) return;
    var amt = B.walletValidateAmount($('wPayAmount').value);
    if (!amt.ok) { $('wPayMsg').innerHTML = '<div class="error">' + esc(amt.error) + '</div>'; return; }
    var amount = amt.amount;
    var store = $('wPayStore').value;
    /* v71 Seat 3 RC-3: for a bKash-linked profile the rail's
       mode is probed BEFORE the scan opens, so the words the
       user authorises under name the rail that will actually
       settle — sandbox test money is never called demo money.
       ONE probe governs the whole attempt: the prompt now and
       the branch after authorisation. A failed probe or an
       unexpected mode stops here: no scan, no settlement. */
    var openPayScan = function (probedMode) {
    showWalletScan({
      title: 'Biom Pay — authorise with your palm',
      syncKind: 'money-auth', // v56 Scan Sync kind for this context
      prompt: probedMode === 'sandbox'
        ? 'Scan YOUR OWN palm to pay ' + fmtBDT(amount) + ' at ' + store + ' through the bKash Sandbox (TEST MODE — no real money). Only your palm can start a payment from your wallet.'
        : 'Scan YOUR OWN palm to pay ' + fmtBDT(amount) + ' of demo money at ' + store + '. Only your palm can authorise a payment from your wallet.',
      run: function () {
        return DB.all('people').then(function (people) {
          var fresh = people.find(function (p) { return p.id === me.id; }) || me;
          return streamVerifyPalm($('wScanVideo'), $('wScanStatus'), fresh, people, null, function () {}, walletControl, { strictMoney: true }).then(function (out) {
            var auth = authFromVerify(out, fresh.id);
            if (!auth.verified) { walletScanFailed(out); return; }
            scanTimerStop('w'); // v74 (Seat 1 fix): freeze first, so the record stamps the shown total
            Sync.noteScan({ kind: 'money-auth', profileName: fresh.name, biomId: fresh.id, hand: out.diag ? out.diag.probeHand : null, edccScore: out.diag ? out.diag.edcc : null, palmnetScore: out.diag ? out.diag.neural : null, result: 'Verified' });
            if (!fresh.walletProvider) {
              $('wScanMsg').innerHTML = '<div class="error">Biom Pay not created: your profile has no linked bKash / Nagad wallet.</div>';
              $('wScanRun').disabled = false;
              return;
            }
            if (fresh.limits && fresh.limits.perTx && amount > fresh.limits.perTx) {
              $('wScanMsg').innerHTML = '<div class="error">Biom Pay not created: ' + fmtBDT(amount) + ' exceeds your biometric-only per-transaction limit of ' + fmtBDT(fresh.limits.perTx) + '. Payments above the limit are not created.</div>';
              $('wScanRun').disabled = false;
              return;
            }
            var createWalletPay = function () {
              return DB.nextSeq('paySeq', 1001).then(function (seq) {
                var tx = {
                  id: 'BIOM-PAY-' + seq, ts: Date.now(), personId: fresh.id, personName: fresh.name,
                  provider: fresh.walletProvider, walletMasked: B.maskWalletNumber(fresh.walletNumber),
                  store: store, amount: amount, method: 'palm', measured: out.measured, status: PAY_STATUS
                };
                return DB.put('transactions', tx).then(function () {
                  /* v59 D6 rule, same as the terminal: points are
                     credited only now, from the created
                     transaction's amount — never the typed field. */
                  var payPts = Math.floor(tx.amount / 10);
                  if (payPts > 0) fresh.loyaltyPoints = (fresh.loyaltyPoints || 0) + payPts;
                  return DB.put('people', fresh).then(function () {
                    /* v67: the Inbox event is written HERE — on
                       the success path only: the payment record
                       exists and the updated profile is stored.
                       Every refusal above returns before this
                       line, so a refused payment never notifies. */
                    Inbox.add(fresh.id, Inbox.event('pay', { amount: tx.amount, ref: tx.id, detail: 'At ' + store + ' · ' + tx.id + ' · Demo money' }));
                    noteMoneyProfile(fresh); // v78: mirror the pay record + wallet to the dashboard dossier
                    balanceFlashPending = true;
                    hideWalletScan();
                    return renderWallet().then(function () {
                      $('wHomeMsg').innerHTML = '<div class="success">Biom Pay complete — ' + fmtBDT(amount) + ' of demo money at ' + esc(store) + '.' +
                        (payPts > 0 ? ' Palm Loyalty: +' + payPts + ' points awarded — balance ' + Number(fresh.loyaltyPoints || 0) + ' points.' : '') +
                        '<br>Scanned in ' + ScanTimers.w.elapsedText() + '.<br>Record ID: ' + esc(tx.id) + ' (TSG Biom record — not a ' + esc(tx.provider) + ' TrxID)<br>Status: ' + esc(tx.status) + '</div>';
                      toast('Biom Pay complete: ' + tx.id);
                      Snd.chime();
                    });
                  });
                });
              });
            };
            var settleDemoPay = function () {
              if (fresh.limits && fresh.limits.daily) {
                return DB.all('transactions').then(function (txs) {
                  var dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
                  var todaySum = txs.filter(function (t) { return t.personId === fresh.id && t.ts >= dayStart.getTime() && t.rail !== 'bkash-sandbox'; }).reduce(function (s, t) { return s + Number(t.amount || 0); }, 0);
                  if (todaySum + amount > fresh.limits.daily) {
                    $('wScanMsg').innerHTML = '<div class="error">Biom Pay not created: this payment would take today\'s total to ' + fmtBDT(todaySum + amount) + ', above your biometric-only daily limit of ' + fmtBDT(fresh.limits.daily) + '. Payments above the limit are not created.</div>';
                    $('wScanRun').disabled = false;
                    return;
                  }
                  return createWalletPay();
                });
              }
              return createWalletPay();
            };
            /* v71 bKash sandbox rail: the mode probed before
               this scan opened (Seat 3 RC-3 — one probe governs
               the attempt) decides where the authorised payment
               settles. 'sandbox' hands off to the sandbox flow
               (interstitial, then bKash's own hosted page) and
               the demo record is NOT written; 'demo' or no probe
               keeps the exact pre-v71 behaviour. Create, execute
               and query responses must still each carry mode
               'sandbox' — the probe alone never settles
               anything. The palm authorisation above has
               already passed: the rail never weakens it. */
            if (fresh.walletProvider === 'bKash' && probedMode === 'sandbox') return startSandboxPay(fresh, store, amount);
            return settleDemoPay();
          });
        });
      }
    });
    };
    if (me.walletProvider === 'bKash' && BkashRail.hasTransport()) {
      $('wPayMsg').innerHTML = '<div class="notice">Checking the payment rail…</div>';
      BkashRail.mode().then(function (m) {
        if (m && (m.mode === 'sandbox' || m.mode === 'demo')) { $('wPayMsg').innerHTML = ''; openPayScan(m.mode); return; }
        $('wPayMsg').innerHTML = '<div class="error">Biom Pay cannot start: the payments rail answered an unexpected mode — nothing was charged.</div>';
      }, function () {
        $('wPayMsg').innerHTML = '<div class="error">Biom Pay cannot start: the payment server is unreachable — nothing was charged. Check the connection and try again.</div>';
      });
      return;
    }
    openPayScan(null);
  });

  /* ---------------- v71 bKash sandbox payment flow --------------------
     Runs only after the strict palm authorisation above has
     passed and the API has answered mode 'sandbox'. The user
     authorised under demo wording, so BEFORE anything is
     created the interstitial restates the amount, the store
     and the sandbox truth, and waits for an explicit tap.
     Continue creates the payment through the API, persists a
     pending record on-device, and only then navigates to
     bKash's own sandbox page — the ceremony (wallet, OTP, PIN)
     is bKash's; this app never sees it. */
  function startSandboxPay(fresh, store, amount) {
    /* v73 (Seat 3 F1): bind the authorised amount + store NOW,
       and lock the fields behind the interstitial (defence in
       depth — the binding is the real fix). */
    sandboxAttempt = { amount: amount, store: store, personId: fresh.id };
    $('wPayAmount').disabled = true;
    $('wPayStore').disabled = true;
    hideWalletScan();
    $('walletHome').classList.add('hidden');
    $('walletPay').classList.remove('hidden');
    $('wPaySandboxText').textContent = 'Pay ' + fmtBDT(amount) + ' to ' + store + ' from the bKash wallet linked to this profile (' + (fresh.walletNumber || '') + ').';
    $('wPaySandbox').classList.remove('hidden');
    $('wPayMsg').innerHTML = '';
    $('wPaySandboxGo').disabled = false;
    $('wPaySandboxCancel').disabled = false;
    sandboxInterstitialOpen = true;
    return Promise.resolve();
  }
  function closeSandboxInterstitial(note) {
    sandboxInterstitialOpen = false;
    sandboxAttempt = null;
    $('wPayAmount').disabled = false;
    $('wPayStore').disabled = false;
    $('wPaySandbox').classList.add('hidden');
    if (note) $('wPayMsg').innerHTML = '<div class="notice">' + esc(note) + '</div>';
    checkPendingSwReload();
  }
  $('wPaySandboxCancel').addEventListener('click', function () {
    closeSandboxInterstitial('Sandbox payment cancelled before anything was created — nothing was charged.');
  });
  $('wPaySandboxGo').addEventListener('click', function () {
    var fresh = walletSessionPerson();
    /* v73 (Seat 3 F1): use ONLY the values bound at palm
       authorisation time. Before v73 this handler re-read the
       still-editable amount/store fields, so editing them
       while the interstitial was up created — and recorded in
       bkashPending — a different payment than the one the palm
       authorised, defeating the per-Tx limit that was checked
       against the authorised amount. The DOM fields are never
       read here any more. */
    var bound = sandboxAttempt;
    if (!fresh || fresh.walletProvider !== 'bKash' || !bound || bound.personId !== fresh.id || !bound.store || !(Number(bound.amount) > 0)) {
      closeSandboxInterstitial('The payment details changed — nothing was created. Reopen Biom Pay to start again.');
      return;
    }
    var store = bound.store;
    var amount = bound.amount;
    $('wPaySandboxGo').disabled = true;
    $('wPaySandboxCancel').disabled = true;
    BkashRail.create({ biomId: fresh.id, amount: amount, payerReference: fresh.walletNumber }).then(function (res) {
      if (!res || res.mode !== 'sandbox' || res.ok !== true || !res.paymentID || !bkashSandboxUrlOk(res.bkashURL)) {
        var refusal = bkashProviderRefusal(res);
        throw new Error(refusal || (res && res.error ? res.error : 'the sandbox refused to create the payment'));
      }
      /* The pending record is persisted BEFORE the redirect:
         the return is matched against it, and it is cleared
         before anything is credited, so a refresh or a replayed
         return can never execute or credit twice. */
      return DB.setMeta('bkashPending', {
        paymentID: res.paymentID, personId: fresh.id, amount: amount, store: store,
        invoice: res.merchantInvoiceNumber || '', ts: Date.now()
      }).then(function () { return res; });
    }).then(function (res) {
      sandboxInterstitialOpen = false;
      window.location.assign(res.bkashURL);
    }).catch(function (e) {
      $('wPaySandboxGo').disabled = false;
      $('wPaySandboxCancel').disabled = false;
      $('wPayMsg').innerHTML = '<div class="error">bKash Sandbox could not start this payment (' + esc(e && e.message ? e.message : e) + '). Nothing was charged, and nothing was settled in the demo ledger.</div>';
    });
  });
  /* The return from bKash's page. The callback parameters are
     NEVER trusted: the paymentID must match the pending record
     persisted before the redirect, and the outcome is read
     from the API's execute + query relays of bKash's own
     responses. The URL parameters are stripped immediately. */
  function bkashReturnMessage(html) {
    toast('bKash Sandbox: payment update');
    /* Always written, even when the wallet home is not the
       visible page at return time (a multi-profile device
       boots to the picker): the message waits on the wallet
       home and is what the payer sees when they open the
       wallet — the settlement outcome is never carried by
       the transient toast alone. (Found by the v71 gate,
       Phase BK3: with the visibility condition the message
       silently vanished on picker-first boots.) */
    $('wHomeMsg').innerHTML = html;
  }
  function handleBkashReturn() {
    var params = new URLSearchParams(location.search);
    if (!params.get('bkashReturn') && !params.get('paymentID')) return Promise.resolve();
    var paymentID = params.get('paymentID') || '';
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    return DB.getMeta('bkashPending', null).then(function (pending) {
      if (!pending || !pending.paymentID || pending.paymentID !== paymentID) {
        bkashReturnMessage('<div class="error">bKash Sandbox return could not be matched to a payment started on this device — nothing was recorded and nothing was credited.</div>');
        return null;
      }
      /* v71 Seat 3 RC-4: a pending record older than the
         sandbox session's useful life is abandoned, not
         executed — the link has expired. */
      if (pending.ts && Date.now() - pending.ts > 30 * 60 * 1000) {
        return DB.setMeta('bkashPending', null).then(function () {
          bkashReturnMessage('<div class="error">This bKash Sandbox payment link has expired — it was started more than 30 minutes ago and is no longer being tracked. Nothing was recorded and nothing was credited. If you completed it in the sandbox, check the sandbox result before paying again.</div>');
          return null;
        });
      }
      return BkashRail.execute(paymentID).then(function (ex) {
        return BkashRail.query(paymentID).then(function (q) { return { ex: ex, q: q }; });
      }).then(function (both) {
        var ex = both.ex, q = both.q;
        /* v73 micro-fix (combined re-review, provider-refusal
           residual): a GRANT failure on execute/query comes back
           in the API's bkashFail shape — {error, statusCode,
           statusMessage} with NO mode field — so the mode check
           below stopped it before the refusal further down was
           ever read, and the payer saw only the generic wording.
           The provider refusal is therefore extracted FIRST:
           when the mode check fails AND a refusal is present,
           the refusal (provider code + message) is what the
           failure reports. With no refusal fields the mode check
           behaves exactly as before. Display ordering only —
           the mode predicate itself and every Completed leg
           below are untouched. */
        var refusal0 = bkashProviderRefusal(q) || bkashProviderRefusal(ex);
        if (!ex || ex.mode !== 'sandbox' || !q || q.mode !== 'sandbox') {
          if (refusal0) throw new Error('the payment provider refused the request — bKash answered: ' + refusal0);
          throw new Error('the rail answered an unexpected mode');
        }
        /* v71 Seat 2 re-review change 6 + Seat 3 re-review
           change 4: "Completed" is a checked predicate, not
           one trusted field. Both relays must report success,
           for THIS payment, with agreeing amounts, in BDT,
           against the invoice this device created, and the
           query must show verification Complete. Anything less
           records nothing. */
        if ((ex.paymentID && ex.paymentID !== paymentID) || (q.paymentID && q.paymentID !== paymentID)) {
          throw new Error('the rail answered for a different payment than the one started on this device');
        }
        var relayedInvoice = q.merchantInvoiceNumber || ex.merchantInvoiceNumber || q.merchantInvoice || ex.merchantInvoice || ''; // v73 (Seat 3 F3): bKash's real field name first — the leg was dead against the real response shape
        if (relayedInvoice && pending.invoice && relayedInvoice !== pending.invoice) {
          throw new Error('the rail answered for a different invoice than the one created on this device');
        }
        if ((ex.currency && ex.currency !== 'BDT') || (q.currency && q.currency !== 'BDT')) {
          throw new Error('the rail answered in an unexpected currency');
        }
        var exAmt = ex.amount != null ? Number(ex.amount) : null;
        var qAmt = q.amount != null ? Number(q.amount) : null;
        if (exAmt !== null && qAmt !== null && exAmt !== qAmt) {
          throw new Error('execute and query disagree on the amount');
        }
        var finalStatus = q.transactionStatus || ex.transactionStatus || '';
        if (ex.ok !== true || q.ok !== true || finalStatus !== 'Completed' || q.verificationStatus !== 'Complete') {
          var refusal2 = bkashProviderRefusal(q) || bkashProviderRefusal(ex);
          return DB.setMeta('bkashPending', null).then(function () {
            bkashReturnMessage('<div class="error">bKash Sandbox payment did not complete (status: ' + esc(finalStatus || 'unknown') + ')' + (refusal2 ? ' — bKash answered: ' + esc(refusal2) : '') + '. No money moved, nothing was recorded and no points were awarded.</div>');
            return null;
          });
        }
        var executedAmount = exAmt !== null ? exAmt : qAmt;
        /* v73 hardening (Seat 1 residual): the executed amount
           must equal the amount this device authorised and
           stored in the pending record — compared DIRECTLY,
           not only indirectly via paymentID + invoice. A
           mismatch is refused here, before any record: nothing
           is recorded as Completed and no points are awarded;
           the payer is told the two amounts plainly. */
        if (executedAmount === null || executedAmount !== Number(pending.amount)) {
          return DB.setMeta('bkashPending', null).then(function () {
            bkashReturnMessage('<div class="error">bKash Sandbox executed ' + fmtBDT(Number(executedAmount || 0)) + ' but this device authorised ' + fmtBDT(Number(pending.amount)) + ' — the amounts do not match, so the payment is NOT recorded as completed here and no points were awarded. Check the bKash sandbox result before paying again.</div>');
            return null;
          });
        }
        var trxID = ex.trxID || q.trxID || '';
        return Promise.all([DB.all('people'), DB.all('transactions')]).then(function (rr) {
          var person = rr[0].find(function (p) { return p.id === pending.personId; }) || null;
          if (!person) {
            return DB.setMeta('bkashPending', null).then(function () {
              bkashReturnMessage('<div class="error">bKash Sandbox reports the payment completed, but the wallet profile is no longer on this device — it could not be recorded here.</div>');
              return null;
            });
          }
          /* v71 Seat 3 RC-2: the write is idempotent by
             paymentID. If this payment is already recorded —
             an earlier return wrote it and a later step was
             interrupted — it is NOT written or credited a
             second time; the pending record is simply
             retired. */
          var existing = rr[1].find(function (t) { return t && t.rail === 'bkash-sandbox' && t.paymentID === paymentID; }) || null;
          if (existing) {
            return DB.setMeta('bkashPending', null).then(function () {
              bkashReturnMessage('<div class="success">bKash Sandbox — TEST MODE — no real money moved.<br>This payment was already recorded on this device (bKash Sandbox TrxID: ' + esc(existing.trxID || '') + ') — it has not been credited twice.</div>');
              return null;
            });
          }
          /* A Completed answer with NO TrxID from either
             response is recorded as what it is — completed
             but unreferenced (Seat 3 re-review change 4) —
             never dressed as a normal referenced record. */
          var rec = {
            id: 'BKASH-SANDBOX-' + (trxID || paymentID), ts: Date.now(), personId: person.id, personName: person.name,
            provider: 'bKash', walletMasked: B.maskWalletNumber(person.walletNumber),
            store: pending.store, amount: executedAmount, method: 'palm', rail: 'bkash-sandbox',
            trxID: trxID, paymentID: paymentID,
            status: trxID ? 'Completed — bKash Sandbox (TEST MODE)' : 'Completed — bKash Sandbox (TEST MODE) · TrxID not returned by bKash'
          };
          return DB.put('transactions', rec).then(function () {
            /* Points follow the v59 D6 rule — credited only
               now, from the EXECUTED amount the API returned.
               The v73 direct comparison above has already
               refused any executed amount that differs from
               the authorised one, so this amount IS the
               authorised amount. */
            var pts = Math.floor(executedAmount / 10);
            if (pts > 0) person.loyaltyPoints = (person.loyaltyPoints || 0) + pts;
            return DB.put('people', person).then(function () {
              Inbox.add(person.id, Inbox.event('bkash', {
                amount: executedAmount, ref: rec.id,
                detail: 'At ' + pending.store + ' · bKash Sandbox TrxID ' + trxID + ' · TEST MODE — no real money'
              }));
              noteMoneyProfile(person); // v78: the recorded sandbox pay rides the same mirror
              /* The pending record is retired only now that
                 the payment is fully recorded — a crash
                 anywhere above leaves it in place, and the
                 idempotent write above makes the re-run
                 safe. */
              return DB.setMeta('bkashPending', null).then(function () {
                return renderWallet().then(function () {
                  bkashReturnMessage('<div class="success">bKash Sandbox — TEST MODE — no real money moved.<br>Payment of ' + fmtBDT(executedAmount) + ' at ' + esc(pending.store) + ' completed in the bKash sandbox.' +
                    (trxID ? '<br>bKash Sandbox TrxID: ' + esc(trxID) : '<br>bKash did not return a TrxID for this payment — the completion is recorded from its Execute and Query answers.') +
                    (pts > 0 ? '<br>Palm Loyalty: +' + pts + ' points awarded — balance ' + Number(person.loyaltyPoints || 0) + ' points.' : '') +
                    '</div>');
                  Snd.chime();
                });
              });
            });
          });
        });
      }).catch(function (e) {
        bkashReturnMessage('<div class="error">The sandbox payment could not be confirmed with the payment server (' + esc(e && e.message ? e.message : e) + '). It is NOT recorded here — check the bKash sandbox result before paying again.</div>');
        return null;
      });
    });
  }

  /* ---------------- My Account (v52) --------------------------------
     The customer account surface: every value is read live from
     the open wallet's person record and wallet — nothing here is
     stored separately, and nothing here writes. Palm actions are
     the REAL existing flows (Add Angles / re-scan / Neural Scan
     via openTopup, other-hand registration via enrolment).
     v60: My Account resolves the wallet session by the same
     entry rule as the wallet (resolveWalletEntry — one enrolled
     profile opens directly; several wait for the wallet-page
     picker tap), and the Palm Identity card is now the home of
     the v53 owner-recovery actions that used to hang off
     wallet-open scan failures: Strengthen my palm, Neural scan
     and Re-register this palm, routing to the same guarded
     top-up flows (openTopup / openRecoveryTopup) as before. */
  function renderAccount() {
    return loadWalletPeople().then(function (people) {
      var entry = resolveWalletEntry(people);
      if (entry) walletSessionId = entry.id;
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
      /* v60: the Palm Identity actions, in the owner's own
         terms. Strengthen my palm is the v43 Add Angles flow;
         Neural scan is the v47 neural top-up; Re-register
         this palm is the v53 recovery entry (openRecoveryTopup
         — the recovery grant, so a banking-guard refusal
         inside that capture offers the typed-REPLACE
         re-registration exactly as it did from the old
         wallet-open failure path). Same flows, same guards —
         only the door moved, from a failed entry scan to the
         owner's own account page. */
      var actions = '';
      if (enrolled) actions += '<div><button class="btn primary" data-acct-topup="angles">Strengthen my palm</button></div>';
      if (format === 'legacy') actions += '<div><button class="btn primary" data-acct-topup="angles">Re-scan Palm</button></div>';
      if (B.palmnetNeedsScan(me.palmProfile)) actions += '<div><button class="btn" data-acct-topup="neural">Neural scan</button></div>';
      if (enrolled) actions += '<div><button class="btn" id="acRereg">Re-register this palm</button></div>';
      actions += '<div><button class="btn" id="acOtherHand">Register Other Hand</button></div>';
      $('acPalmActions').innerHTML = actions;
      document.querySelectorAll('[data-acct-topup]').forEach(function (b) {
        b.addEventListener('click', function () { openTopup(me.id, b.dataset.acctTopup === 'neural' ? 'neural' : undefined); });
      });
      var rr = $('acRereg');
      if (rr) rr.addEventListener('click', function () { openRecoveryTopup(me.id); });
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
        '<span style="color:var(--muted)">Limits are chosen at registration. Above a limit, a Biom Pay payment is not created on palm alone — it is refused.</span>';
      /* v61 (B1): the security lines state THIS bank's actual
         state — sealed under the vault key, sealed under another
         key, or still in its encoded form — never a blanket
         claim. The state comes from the at-rest store, so what
         the owner reads is what is stored. */
      Vault.statusFor(me.id).then(function (bankState) {
        /* v63: the pointers in this copy are mode-aware — the
           Biom Vault, Scan Sync settings and Delete All Data
           live behind owner mode, so the customer face names
           them as owner tools instead of pointing at a More
           page that no longer shows them. */
        var ownerUi = FaceMode.isOwner();
        var vaultWhere = ownerUi ? 'More → Biom Vault' : 'owner mode → More → Biom Vault';
        var firstLine = bankState === 'sealed'
          ? 'Palm templates are stored on this device encrypted under its Biom Vault key (AES-GCM) — never a palm image. Matching always happens on this device, on the opened bank.'
          : bankState === 'sealed-other'
          ? 'This palm bank is sealed under a different vault key, so this device cannot open it — the device owner restores the vault from its recovery sheet (' + vaultWhere + '). Matching always happens on this device.'
          : 'Palm templates are stored on this device as encoded palm codes — never a palm image. This bank is not yet encrypted — the Biom Vault (' + vaultWhere + ') seals banks under a key held only on this device. Matching always happens on this device.';
        $('acSecBody').innerHTML =
          firstLine + '<br>' +
          '<b>Scan sync:</b> ' + (Sync.state().on && Sync.state().configured
            ? 'ON — scan records and palm codes also sync in the background to the TSG Biom server, sealed under this device\'s vault key once the vault is set up, so your scans stay backed up. The palm image itself is never sent — there is no image in what syncs. Sync settings live in owner mode.'
            : 'OFF — the device owner has switched sync off (owner mode → More → Scan Sync), so nothing about your palm leaves this device. When sync is on, scan records and palm codes sync to the TSG Biom server, sealed under this device\'s vault key once the vault is set up; the palm image itself is never sent.') + '<br>' +
          '<b>Registered palm:</b> ' + (hand ? (hand === 'left' ? 'Left' : 'Right') + ' hand' : 'hand not recorded') + '<br>' +
          '<b>Money scans:</b> Add Money, Send Money and Biom Pay use the strict money rule — a two-frame confirmation that must clearly beat every other enrolled palm.<br>' +
          '<span style="color:var(--muted)">' + (ownerUi ? 'Erase everything on this device from More → Delete All Data.' : 'Only the device owner can erase this device (owner mode → More → Delete All Data).') + '</span>';
      });
    });
  }
  $('acBack').addEventListener('click', function () { go('wallet'); });
  $('acOpenWallet').addEventListener('click', function () { go('wallet'); });
  $('acRowLinked').addEventListener('click', function () { go('wallet'); });
  $('acRowHelp').addEventListener('click', function () { go('more'); });
  $('acLogout').addEventListener('click', function () { closeWalletSession(); go('wallet'); });
  document.querySelectorAll('[data-acct-toggle]').forEach(function (b) {
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', function () {
      var d = $('acDetail-' + b.dataset.acctToggle);
      if (d) {
        d.classList.toggle('hidden');
        /* v64 (Seat 1 A-1): expansion state is published, not visual-only. */
        b.setAttribute('aria-expanded', d.classList.contains('hidden') ? 'false' : 'true');
      }
    });
  });

  /* ---------------- v52 wallet home wiring --------------------------
     Eye toggle, avatar, quick actions and amount chips — all
     presentation wiring over the existing flows. */
  $('wBalEye').addEventListener('click', function () {
    balanceHidden = !balanceHidden;
    /* v64 (Seat 1 A-1): pressed = the balance is hidden. */
    $('wBalEye').setAttribute('aria-pressed', balanceHidden ? 'true' : 'false');
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
      syncKind: 'verify', // v56 Scan Sync kind for this context
      prompt: 'Show your open palm. This is a plain identity check on the open wallet — it authorises nothing and moves no money.',
      run: function () {
        return DB.all('people').then(function (people) {
          var fresh = people.find(function (p) { return p.id === me.id; }) || me;
          return streamVerifyPalm($('wScanVideo'), $('wScanStatus'), fresh, people, null, function () {}, walletControl).then(function (out) {
            var auth = authFromVerify(out, fresh.id);
            if (!auth.verified) { walletScanFailed(out); return; }
            scanTimerStop('w'); // v74 (Seat 1 fix): freeze first, so the record stamps the shown total
            Sync.noteScan({ kind: 'verify', profileName: fresh.name, biomId: fresh.id, hand: out.diag ? out.diag.probeHand : null, edccScore: out.diag ? out.diag.edcc : null, palmnetScore: out.diag ? out.diag.neural : null, result: 'Verified' });
            hideWalletScan();
            return renderWallet().then(function () {
              /* v74 (Seat 1 fix): the muted line is the scan's
                 diagnostic sentence; its engine-latency clause
                 is left off THIS rendering so the message states
                 exactly one scan total — the timer's. The log
                 record keeps the full measured string verbatim
                 (the v45 pin); nothing is invented, a clause is
                 omitted from one display only. */
              $('wHomeMsg').innerHTML = '<div class="success">Palm verified — this wallet belongs to ' + esc(fresh.name) + ' (' + esc(fresh.id) + ').<br><span style="color:var(--muted)">' + esc(out.measured.replace(/ Scan latency: \d+ ms\./, '')) + '</span><br>Scanned in ' + ScanTimers.w.elapsedText() + '.</div>';
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
        if (input) {
          input.value = chip.dataset.amt;
          input.focus();
          /* v64: a chip tap is an amount entry like any other — the
             projected-balance lines listen for 'input'. */
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });
  });

  /* ---------------- Registry & logs -------------------------------------- */
  function renderRegistry() {
    var q = ($('registrySearch').value || '').toLowerCase();
    return DB.all('people').then(function (people) {
      var filteredPeople = people.filter(function (p) {
        return !q || p.name.toLowerCase().indexOf(q) >= 0 || p.id.toLowerCase().indexOf(q) >= 0 || (p.phone || '').indexOf(q) >= 0;
      });
      var rows = filteredPeople.map(function (p) {
        return '<tr><td><b>' + esc(p.name) + '</b>' + (p.owner === true ? ' <span class="badge ok">Owner</span>' : '') + '<br><span style="color:var(--muted)">' + esc(p.phone || '') + '</span>' + (p.loyaltyPoints ? '<br><span style="color:var(--muted)">Loyalty: ' + Number(p.loyaltyPoints || 0) + ' pts</span>' : '') + '</td>' +
          '<td>' + esc(p.id) + '</td><td>' + esc(p.type) + '<br><span style="color:var(--muted)">' + esc(p.store) + '</span></td>' +
          '<td>' + (personHasMethod(p) ? '<span class="badge ok">Enrolled</span>' : (B.palmprintProfileFormat(p.palmProfile) === 'legacy' ? '<span class="badge bad">Palm re-scan needed</span>' : '<span class="badge bad">Not enrolled</span>')) + (B.palmnetNeedsScan(p.palmProfile) ? '<br><span class="badge warn">Neural scan needed</span>' : '') + (personHasMethod(p) && B.palmProfileHand(p.palmProfile) ? '<br><span style="color:var(--muted)">' + (B.palmProfileHand(p.palmProfile) === 'left' ? 'Left' : 'Right') + ' palm</span>' : '') + '</td>' +
          '<td>' + (p.walletProvider ? esc(p.walletProvider) + '<br>' + esc(B.maskWalletNumber(p.walletNumber)) : '—') + '</td>' +
          '<td><button class="btn small" data-verify="' + esc(p.id) + '">Verify</button>' + (personHasMethod(p) ? ' <button class="btn small" data-topup="' + esc(p.id) + '">Add Angles</button>' : '') + (B.palmprintProfileFormat(p.palmProfile) === 'legacy' ? ' <button class="btn small" data-topup="' + esc(p.id) + '">Re-scan Palm</button>' : '') + (B.palmnetNeedsScan(p.palmProfile) ? ' <button class="btn small" data-neural="' + esc(p.id) + '">Neural Scan</button>' : '') + ' <button class="btn small" data-owner-toggle="' + esc(p.id) + '">' + (p.owner === true ? 'Remove owner' : 'Make owner') + '</button></td></tr>';
      }).join('');
      $('registryBody').innerHTML = rows || '<tr><td colspan="6" class="emptycell">No enrollments on this device yet. New registrations appear here as soon as their palm is enrolled.</td></tr>';
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
      /* v63: the owner flag is granted or revoked ONLY here —
         inside owner mode, in the Registry. The flag is
         device-local by design: it is not part of the synced
         bank shape, so it never travels. */
      document.querySelectorAll('[data-owner-toggle]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!FaceMode.isOwner()) return;
          DB.all('people').then(function (freshPeople) {
            var p = freshPeople.find(function (x) { return x.id === b.dataset.ownerToggle; });
            if (!p) return;
            if (p.owner === true) { delete p.owner; } else { p.owner = true; }
            return DB.put('people', p).then(function () {
              toast(p.owner === true ? p.name + ' is now an owner of this device.' : p.name + ' is no longer an owner of this device.');
              renderRegistry();
            });
          });
        });
      });
      /* v66: Registry list–detail — selecting a row (outside its
         action buttons) opens the detail panel; grant/revoke in
         the panel routes through the row's own toggle button, so
         the behaviour is the existing one, unchanged. */
      document.querySelectorAll('#registryBody tr').forEach(function (tr, i) {
        tr.addEventListener('click', function (ev) {
          if (ev.target && ev.target.closest && ev.target.closest('button')) return;
          if (filteredPeople[i]) showRegistryDetail(filteredPeople[i]);
        });
      });
    });
  }
  function showRegistryDetail(p) {
    var panel = $('registryDetail');
    if (!panel || !p) return;
    var hand = B.palmProfileHand(p.palmProfile);
    $('registryDetailName').textContent = p.name;
    $('registryDetailBody').innerHTML =
      '<b>Biom ID:</b> ' + esc(p.id) + '<br>' +
      '<b>Phone:</b> ' + esc(p.phone || '') + '<br>' +
      '<b>Type / Store:</b> ' + esc(p.type || '') + ' / ' + esc(p.store || '') + '<br>' +
      '<b>Palm:</b> ' + (personHasMethod(p) ? 'Enrolled' + (hand ? ' — ' + (hand === 'left' ? 'Left' : 'Right') + ' palm' : '') : 'Not enrolled') + '<br>' +
      '<b>Wallet:</b> ' + (p.walletProvider ? esc(p.walletProvider) + ' — ' + esc(B.maskWalletNumber(p.walletNumber)) : '—') + '<br>' +
      '<b>Loyalty:</b> <span class="num">' + Number(p.loyaltyPoints || 0).toLocaleString() + ' pts</span><br>' +
      '<b>Owner:</b> ' + (p.owner === true ? 'Owner of this device' : 'Not an owner');
    var btn = $('registryDetailOwnerBtn');
    btn.textContent = p.owner === true ? 'Remove owner' : 'Make owner';
    btn.dataset.personId = p.id;
    panel.classList.remove('hidden');
  }
  $('registrySearch').addEventListener('input', debounce(renderRegistry, 150)); // v77: debounced (was: full re-render per keystroke)
  $('registryDetailClose').addEventListener('click', function () { $('registryDetail').classList.add('hidden'); });
  $('registryDetailOwnerBtn').addEventListener('click', function () {
    var id = $('registryDetailOwnerBtn').dataset.personId;
    var rowBtn = document.querySelector('[data-owner-toggle="' + id + '"]');
    if (rowBtn) rowBtn.click();
    setTimeout(function () {
      DB.all('people').then(function (fresh) {
        var p = fresh.find(function (x) { return x.id === id; });
        if (p) showRegistryDetail(p);
      });
    }, 350);
  });
  $('activityDetailClose').addEventListener('click', function () { $('activityInspector').classList.add('hidden'); });

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
     openRecoveryTopup and cleared by every ordinary openTopup
     call, by Back, and when a re-registration completes.
     While it names a profile, a banking-guard refusal in that
     profile's capture offers the confirmation-gated
     re-registration; reregPerson is the record that refusal
     was judged against. (v60: openRecoveryTopup is reached
     from My Account → Palm Identity → "Re-register this
     palm" — at v53-v59 it was reached from a failed
     wallet-open scan, which no longer exists.)
     v55 (AUDIT-v54.md, Defect 1): a SECOND grant exists.
     v54's model swap left every pre-v54 profile with a stale
     neural bank, and the Neural Scan the app prescribes for
     exactly those profiles could be refused by the guard —
     its neural leg uncheckable by construction — with no way
     forward. So a Neural Scan launched for a profile whose
     bank is stale at launch (B.palmnetNeedsScan true) is ALSO
     recovery-eligible for that profile, granted inside
     openTopup once the record is loaded; recoveryVia records
     which grant is live ('wallet' | 'neural') so the refusal
     offer and the re-registration log say the true reason.
     The guard itself does not change, and a Neural Scan on a
     CURRENT-stamp bank — like every Add Angles / Re-scan —
     grants nothing: a refusal there stays a plain refusal. */
  var recoveryPersonId = null;
  var recoveryVia = null;
  var reregPerson = null;
  function openRecoveryTopup(personId) { openTopup(personId, 'angles', true); }
  function openTopup(personId, mode, viaRecovery) {
    // v53: every ordinary entry (Registry, My Account, Neural
    // Scan) clears the recovery state — the re-registration
    // offer can only ever follow a recovery-launched capture.
    // v55: the clear still happens here for every entry; the
    // stale-bank Neural Scan grant is applied afterwards,
    // inside the record load below, and nowhere else.
    recoveryPersonId = viaRecovery ? personId : null;
    recoveryVia = viaRecovery ? 'wallet' : null;
    reregPerson = null;
    if ($('topRereg')) $('topRereg').classList.add('hidden');
    /* v64 (Seat 1 C-1): the Back label and destination are face-aware —
       this page is reachable from My Account in customer mode, where
       "Back to Registry" named a surface the customer cannot see. */
    if ($('topBack')) $('topBack').textContent = FaceMode.isOwner() ? 'Back to Registry' : 'Back to My Account';
    DB.all('people').then(function (people) {
      var person = people.find(function (p) { return p.id === personId; }) || null;
      if (!person) return;
      /* v79: Strengthen / Add Angle / Neural Scan are profile
         writes — a blocked person's are refused by the server,
         so the surface says so up front and the camera never
         starts, instead of banking angles locally that can
         never sync. Applies to any blocked ID this device knows
         (its own account included), via the sync engine's set. */
      if (Sync.isBlocked(personId) || (Sync.state().blocked && Sync.state().blockedBiomId === personId)) {
        topupPersonId = null;
        go('topup');
        if ($('topTitle')) $('topTitle').textContent = mode === 'neural' ? 'Neural Scan — add PalmNet embeddings' : 'Add Angles — widen a palm profile';
        if ($('topSub')) $('topSub').textContent = '';
        if ($('topWho')) $('topWho').innerHTML = '<b>' + esc(person.name) + '</b> — ' + esc(person.id);
        $('topMsg').innerHTML = '<div class="error">' + BLOCKED_ACCOUNT_LINE + (mode === 'neural' ? ' Neural Scan is stopped while the block stands.' : ' Strengthen and Add Angle are stopped while the block stands.') + '</div>';
        $('topStatus').textContent = 'Account blocked';
        if ($('topCapture')) $('topCapture').disabled = true;
        return;
      }
      var fmt = B.palmprintProfileFormat(person.palmProfile);
      if (fmt !== 'packed96' && fmt !== 'legacy') return;
      if (mode === 'neural' && fmt !== 'packed96') return; // a legacy palm needs the full re-scan first
      topupPersonId = personId;
      topupMode = mode === 'neural' ? 'neural' : 'angles';
      // v55 (AUDIT-v54.md, Defect 1): the stale-bank Neural
      // Scan grant. palmnetNeedsScan is true for this profile
      // exactly when its neural bank cannot be scored by the
      // running model — for a bank that EXISTS in storage
      // (B.palmnetBankStale) that means the guard's neural leg
      // is uncheckable by construction, so a refusal inside
      // this capture must offer the owner the same confirmed
      // re-registration the owner-recovery path offers, or the
      // prescribed remedy dead-ends. A never-banked profile
      // also has needsScan true, and the grant is harmless
      // there in the same way: the offer still requires a
      // guard refusal first and a typed REPLACE after. A
      // CURRENT-stamp bank (needsScan false) grants nothing.
      var neuralStaleGrant = topupMode === 'neural' && B.palmnetNeedsScan(person.palmProfile);
      if (neuralStaleGrant) { recoveryPersonId = personId; recoveryVia = 'neural'; }
      go('topup');
      if ($('topTitle')) $('topTitle').textContent = topupMode === 'neural' ? 'Neural Scan — add PalmNet embeddings' : 'Add Angles — widen a palm profile';
      if ($('topSub')) $('topSub').textContent = topupMode === 'neural'
        ? 'Runs the same burst capture as enrolment and banks PalmNet neural embeddings for this person\'s palm, so it can match through the neural matcher as well as EDCC. Their EDCC templates, Biom ID, wallet, balance, statement, linked accounts and loyalty points do not change.'
        : 'Runs the same burst capture as enrolment and adds diverse sharp templates to this person\'s stored profile — or re-banks the palm in the current format when it was enrolled in the previous one. Their Biom ID, wallet, balance, statement, linked accounts and loyalty points do not change — only the palm profile gains templates.';
      if (topupMode === 'neural' && B.palmnetBankStale(person.palmProfile)) {
        $('topWho').innerHTML = '<b>' + esc(person.name) + '</b> — ' + esc(person.id) + '<br><span style="color:var(--muted)">Neural scan: this palm is enrolled for the EDCC matcher, and it does hold PalmNet neural embeddings — but they were banked by the previous model (' + esc(B.palmnetProfileModelId(person.palmProfile) || 'unstamped') + '), and embeddings from different models cannot be compared, so this profile currently verifies EDCC-only. One burst banks fresh neural embeddings under the current model (' + esc(B.PALMNET_MODEL_ID) + ') for the same palm; the EDCC templates, Biom ID, wallet and points do not change. Before anything is banked, the burst is checked against the palm already banked for this profile — the EDCC side of that check can run, the neural side cannot (the stored bank belongs to the previous model). A different palm is refused and nothing is added.</span>';
      } else if (topupMode === 'neural') {
        $('topWho').innerHTML = '<b>' + esc(person.name) + '</b> — ' + esc(person.id) + '<br><span style="color:var(--muted)">Neural scan: this palm is enrolled for the EDCC matcher but has no PalmNet neural embeddings yet, so it verifies EDCC-only. One burst banks neural embeddings for the same palm; the EDCC templates, Biom ID, wallet and points do not change. Before anything is banked, the burst is checked against the palm already banked for this profile — a different palm is refused and nothing is added.</span>';
      } else if (fmt === 'legacy') {
        $('topWho').innerHTML = '<b>' + esc(person.name) + '</b> — ' + esc(person.id) + '<br><span style="color:var(--muted)">Palm re-scan needed: this palm was enrolled in the previous template format, which the current packed matcher cannot read. One burst re-banks it in the current format; the old codes stay archived in this record, and nothing else about this person changes. Honest limit: because the old templates cannot be read, this re-scan cannot check the presented palm against them — it banks the palm that is presented, so only run it with this person\'s own palm.</span>';
      } else {
        $('topWho').innerHTML = '<b>' + esc(person.name) + '</b> — ' + esc(person.id) + '<br><span style="color:var(--muted)">Currently banked: ' + person.palmProfile.codes.length + ' packed palm templates' + (Array.isArray(person.palmProfile.poses) ? ' with pose data.' : ' from a single-posture enrolment — no pose data yet.') + ' The burst adds diverse sharp templates; nothing else about this person changes. Before anything is added, the burst is checked against the palm already banked — a different palm is refused and nothing is added.</span>';
      }
      $('topMsg').innerHTML = '';
      if (viaRecovery) $('topMsg').innerHTML = '<div class="notice">You came here from My Account → Palm Identity (Re-register this palm). This guided capture tries to add angles to ' + esc(person.name) + '\'s stored palm under the usual safety check. If the check refuses — because the stored templates are the ones failing — you will be offered a confirmed re-registration instead.</div>';
      if (neuralStaleGrant && B.palmnetBankStale(person.palmProfile)) $('topMsg').innerHTML = '<div class="notice">This profile\'s stored PalmNet bank belongs to the previous model, so the safety check cannot compare this capture against it — the check judges on the EDCC templates alone. If the check refuses for that reason, you will be offered a confirmed re-registration instead: a fresh enrolment under the current model restores full EDCC + PalmNet verify.</div>';
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
      // v58 MANUAL SCAN: opening the top-up camera ARMS the
      // capture only — the guided burst begins on the Run
      // Guided Capture tap (runTopupCapture). At v43-v57 the
      // capture started by itself here; the Chairman's
      // 2026-11-25 order retired that.
      $('topStatus').textContent = 'Camera on — position the open palm in the frame, then tap Run Guided Capture.';
    }).catch(function (e) { $('topMsg').innerHTML = cameraErrorHTML(e); $('topStatus').textContent = 'Camera blocked.'; });
  }
  function runTopupCapture() {
    if (topupBusy || palmScanBusy || !topupPersonId) return;
    topupBusy = true; palmScanBusy = true;
    moneyCommitBusy = true; // v71: the bank writes land after the scan flags clear — hold the update reload until they settle
    $('topCapture').disabled = true;
    $('topMsg').innerHTML = '';
    var control = { cancelled: false, onFrame: function (info) { var fr = topupSession.frame({ hasHand: info.hasHand, pose: info.pose }); topupInds.update(info, fr); } };
    topupControl = control;
    topupSession.enter();
    topupInds.reset();
    setSurfacePill('u', 'Scanning');
    scanTimerStart('u', 'Captured in '); // v74: the guided capture — and its timer — start on the tap
    // v67: no swap callback — the chosen camera only (auto-swap
    // deleted, Chairman's order).
    streamEnrolPalm($('topVideo'), $('topStatus'), null, null, control).then(function (res) {
      topupBusy = false; palmScanBusy = false;
      scanTimerStop('u'); // v74: the capture outcome is known — freeze the capture time (the guard + merge continue below)
      /* v74 (Seat 3 fix): snapshot THIS capture's frozen duration
         now. The guard/merge below awaits (DB reads, PalmNet
         embedding) with the capture button live again — a second
         capture could restart the timer before this flow's
         records are written, and those records must carry THIS
         capture's duration, so they pass it explicitly (a
         caller's own durationMs wins over the engine's stamp). */
      var captureMs = Math.round(ScanTimers.u.elapsedMs());
      setSurfacePill('u', 'Ready');
      $('topCapture').disabled = false;
      if (res.stopped) { $('topStatus').textContent = 'Capture stopped.'; return; }
      if (res.spoof && res.spoof.spoof) {
        DB.put('logs', { ts: Date.now(), personId: '', personName: '(add-angles attempt)', store: '', method: 'palm', measured: 'Spoof score ' + res.spoof.score.toFixed(2) + ' - ' + res.spoof.reasons.join('; '), result: 'Spoof / Screen Replay Detected' });
        Sync.noteScan({ kind: 'topup', profileName: '', biomId: '', result: 'Spoof / Screen Replay Detected' });
        $('topMsg').innerHTML = '<div class="error">Spoof / Screen Replay Detected — the scan showed a screen or a recording, not a live hand (' + esc(res.spoof.reasons.join('; ')) + '). Nothing was changed.</div>';
        Snd.buzz();
        return;
      }
      if (res.detectorFailed) {
        $('topMsg').innerHTML = '<div class="error">' + esc(DETECTOR_FAIL_MSG) + ' Nothing was changed.</div>';
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
            Sync.noteScan({ kind: 'topup', durationMs: captureMs, profileName: person.name, biomId: person.id, hand: guard.probeHand || null, edccScore: guard.edccChecked ? guard.edccScore : null, palmnetScore: guard.neuralChecked ? guard.neuralScore : null, result: 'Banking Refused — Palm Mismatch' });
            // v55 (AUDIT-v54.md, Defect 1): the refusal wording
            // must not claim a checked mismatch when the neural
            // leg never ran. When the profile's stored neural
            // bank is stale (banked by a previous model) the
            // guard's neural leg is uncheckable by construction,
            // so the refusal says exactly that — what WAS
            // checked (the EDCC score against its bar) and what
            // could NOT be checked — instead of the flat
            // mismatch claim. Every other refusal (a checked
            // EDCC mismatch, a checked neural mismatch, the
            // v51 hand gate) keeps the exact v49 string.
            var refusalStaleUncheckable = !guard.handGate && !guard.neuralChecked && B.palmnetBankStale(person.palmProfile);
            if (refusalStaleUncheckable) {
              $('topMsg').innerHTML = '<div class="error">This capture could not be confirmed for this profile — nothing was added. The EDCC check did not pass' +
                (guard.edccChecked && typeof guard.edccScore === 'number' ? ' (best score ' + guard.edccScore.toFixed(3) + ' against the ' + B.PALMPRINT_THRESHOLD + ' bar)' : '') +
                ', and the PalmNet check could not run: the neural bank stored for this profile was banked by the previous model (' + esc(B.palmnetProfileModelId(person.palmProfile) || 'unstamped') + ') and cannot be compared with the current one.</div>';
            } else {
              $('topMsg').innerHTML = '<div class="error">This palm does not match this profile — nothing was added</div>';
            }
            // v53: when this capture was launched from the
            // owner recovery path (v60: My Account → Palm
            // Identity → Re-register this palm), the refusal is the
            // lockout case — the stored bank is what is failing,
            // so no guarded top-up can ever fix it. Offer the
            // owner-confirmed remedy. An ordinary Add Angles
            // refusal (recoveryPersonId unset or naming another
            // profile) shows nothing more: re-registration is
            // reachable ONLY from here, only for the recovery
            // profile, only after this refusal.
            // v55: the same offer follows a refusal inside a
            // stale-bank Neural Scan capture (recoveryVia
            // 'neural') — there the stored bank is not failing,
            // it is UNCHECKABLE, and the offer text says so.
            if (recoveryPersonId && recoveryPersonId === person.id) {
              reregPerson = person;
              var reregWhy = recoveryVia === 'neural'
                ? 'The safety check could not pass this capture: this profile\'s stored PalmNet bank was banked by the previous model, so the neural check cannot run on it at all, and the EDCC templates alone did not pass. If you are ' + esc(person.name) + ' and this is your own palm, you can re-register it: a fresh guided enrolment replaces this profile\'s palm bank — EDCC and PalmNet together — under the current model, which restores full verify. Nothing else about the profile changes.'
                : 'The safety check compares the captured palm against the templates already stored — and those stored templates are the ones that are failing. If you are ' + esc(person.name) + ' and this is your own palm, you can re-register it: a fresh guided enrolment replaces this profile\'s palm bank. Nothing else about the profile changes.';
              $('topMsg').innerHTML += '<div class="diagpanel"><div class="diagtitle">This profile cannot be strengthened this way</div>' +
                '<div class="diagrow">' + reregWhy + '</div>' +
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
              Sync.noteProfile(nUpdated);
              Sync.noteScan({ kind: 'topup', durationMs: captureMs, profileName: person.name, biomId: person.id, hand: B.palmProfileHand(nUpdated.palmProfile), result: 'Banked' });
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
              Sync.noteProfile(reUpdated);
              Sync.noteScan({ kind: 'topup', durationMs: captureMs, profileName: person.name, biomId: person.id, hand: B.palmProfileHand(reUpdated.palmProfile), result: 'Banked' });
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
                Sync.noteProfile(stampOnlyUpdated);
                Sync.noteScan({ kind: 'topup', durationMs: captureMs, profileName: person.name, biomId: person.id, hand: B.palmProfileHand(stampOnlyUpdated.palmProfile), result: 'Banked' });
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
              Sync.noteProfile(keepUpdated);
              Sync.noteScan({ kind: 'topup', durationMs: captureMs, profileName: person.name, biomId: person.id, hand: B.palmProfileHand(keepUpdated.palmProfile), result: 'Banked' });
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
            Sync.noteProfile(updated);
            Sync.noteScan({ kind: 'topup', durationMs: captureMs, profileName: person.name, biomId: person.id, hand: B.palmProfileHand(updated.palmProfile), result: 'Banked' });
            $('topMsg').innerHTML = '<div class="success">Templates added for ' + esc(person.name) + ': ' + merged.added + ' new template(s) appended' + (merged.replaced ? ', ' + merged.replaced + ' redundant template(s) replaced at the cap' : '') + (merged.skipped ? ', ' + merged.skipped + ' skipped (duplicate or already covered)' : '') + '. The profile now holds ' + merged.codes.length + ' templates. Biom ID, wallet, balance, statement, linked accounts and points are untouched.' + esc(neuralNote) + esc(stampNote) + '</div>';
            Snd.chime();
            Snd.speak('Templates added');
          });
        });
      });
    }).catch(function (e) {
      topupBusy = false; palmScanBusy = false;
      scanTimerStop('u'); // v74: a rejected capture still ends the timer
      $('topCapture').disabled = false;
      $('topMsg').innerHTML = '<div class="error">Add-angles capture failed: ' + esc(e && e.message ? e.message : e) + ' Nothing was changed.</div>';
    }).then(function () { settleCaptureReload(); }); // v71: topup flow fully settled (success or failure)
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
      // v55 (AUDIT-v54.md, Defect 2): the panel must state the
      // bank that will actually be discarded — the STORED
      // embeddings (B.storedPalmnetCount), not the
      // staleness-judging reader, which reads a stale bank as
      // zero and silently understated it.
      var neural = B.storedPalmnetCount(fresh.palmProfile);
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
    scanTimerStop('u');
    setSurfacePill('u', 'Ready');
    $('topCapture').disabled = false;
    $('topMsg').innerHTML = html;
    Snd.buzz();
  }
  function runReRegistration() {
    if (!reregPerson || recoveryPersonId !== reregPerson.id) return;
    var personId = reregPerson.id;
    $('topRereg').classList.add('hidden');
    /* v74 (Seat 1 fix): the timer starts at the confirm action
       — the registry lookup is part of the span the user
       experiences. Every exit passes through reregFail (which
       stops it) or the success tail (which stops it before its
       record stamps). */
    setSurfacePill('u', 'Scanning');
    scanTimerStart('u', 'Captured in ');
    DB.all('people').then(function (people) {
      var person = people.find(function (p) { return p.id === personId; });
      if (!person) { reregFail('<div class="error">That person is no longer in the registry — nothing was changed.</div>'); return; }
      topupBusy = true; palmScanBusy = true;
      $('topCapture').disabled = true;
      var control = { cancelled: false };
      topupControl = control;
      // v67: no swap callback exists any more — both capture
      // steps run on the chosen camera (auto-swap deleted,
      // Chairman's order), so the steps pass null below.
      var swap = null;
      function burstError(res, stepName) {
        if (res.stopped) return 'Capture stopped — nothing was changed.';
        if (res.detectorFailed) return DETECTOR_FAIL_MSG + ' Nothing was changed.';
        if (res.spoof && res.spoof.spoof) {
          DB.put('logs', { ts: Date.now(), personId: '', personName: '(re-registration attempt)', store: '', method: 'palm', measured: 'Spoof score ' + res.spoof.score.toFixed(2) + ' - ' + res.spoof.reasons.join('; '), result: 'Spoof / Screen Replay Detected' });
          scanTimerStop('u'); // v74 (Seat 1 fix): freeze first, so the record stamps the shown total
          Sync.noteScan({ kind: 're-register', profileName: '', biomId: '', result: 'Spoof / Screen Replay Detected' });
          return 'Spoof / Screen Replay Detected — the ' + stepName + ' capture showed a screen or a recording, not a live hand (' + res.spoof.reasons.join('; ') + '). Nothing was changed.';
        }
        if (!res.burst) return 'No capture burst ran in the ' + stepName + ' step' + (res.hint ? ' (' + res.hint + ')' : '') + ' — nothing was changed. Run the re-registration again.';
        if (!res.burst.liveness.pass) return 'Liveness check failed in the ' + stepName + ' step: ' + res.burst.liveness.reason + ' Nothing was changed.';
        return null;
      }
      $('topMsg').innerHTML = '<div class="notice">Re-registration step 1 of 2 — hold your palm flat, facing the camera, at your natural distance. The capture runs by itself when a sharp open palm is seen.</div>';
      /* v74: the timer already runs from the confirm action
         (see runReRegistration) — both guided steps are the one
         timed span, so it is NOT restarted here. */
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
    // v55 (AUDIT-v54.md, Defect 2): the accountability record
    // counts the STORED bank (B.storedPalmnetCount) — a stale
    // bank's embeddings are really discarded here, and the log
    // must say how many there were.
    var oldNeural = B.storedPalmnetCount(person.palmProfile);
    PalmNet.embedRois(neuralCandidateRois(complete)).then(function (embs) {
      var good = (embs || []).filter(function (e) { return !!e; });
      var bank = good.length ? B.palmnetBankFromEmbeddings(good) : null;
      var profile = { v: 4, format: B.PALMPRINT_FORMAT, codes: codes, hand: hand };
      if (poses.some(function (d) { return !!d; })) profile.poses = poses;
      if (bank) profile.neural = bank;
      if (person.palmProfile && person.palmProfile.legacyCodes) profile.legacyCodes = person.palmProfile.legacyCodes;
      var updated = Object.assign({}, person, { palmProfile: profile });
      return DB.put('people', updated).then(function () {
        // v55: the record names the path that actually led
        // here — the owner recovery path (v53; v60: entered
        // from My Account → Palm Identity) or the stale-bank
        // Neural Scan (v55, AUDIT-v54.md Defect 1).
        var pathNote = recoveryVia === 'neural'
          ? 'a Neural Scan top-up — the stored PalmNet bank was banked by the previous model, so the guard\'s neural leg could not check the capture and its EDCC leg refused it'
          : 'an Add Angles top-up in the owner recovery path';
        return DB.put('logs', { ts: Date.now(), personId: person.id, personName: person.name, store: '', method: 'palm',
          measured: 'Owner re-registration: after the banking guard refused ' + pathNote + ', the owner confirmed (typed REPLACE) replacement of this profile\'s palm bank. Old bank: ' + oldEdcc + ' EDCC template(s), ' + oldNeural + ' PalmNet embedding(s). New bank: ' + codes.length + ' EDCC template(s), ' + (bank ? bank.embeddings.length : 0) + ' PalmNet embedding(s), hand recorded: ' + (hand || 'not determined') + '. Biom ID, wallet, balance, statement, linked accounts, limits and points unchanged.',
          result: 'Owner Re-registration' });
      }).then(function () {
        // v56 Scan Sync: the replaced bank upserts and the
        // re-registration record queues, from the same values the
        // Logs event above carries.
        /* v74 (Seat 1 fix): freeze BEFORE the records stamp, so
           the re-registration record carries the shown total. */
        scanTimerStop('u');
        setSurfacePill('u', 'Ready');
        Sync.noteProfile(updated);
        Sync.noteScan({ kind: 're-register', profileName: person.name, biomId: person.id, hand: hand, result: 'Owner Re-registration' });
        recoveryPersonId = null;
        recoveryVia = null;
        reregPerson = null;
        topupBusy = false; palmScanBusy = false;
        $('topCapture').disabled = false;
        $('topMsg').innerHTML = '<div class="success">Palm re-registered for ' + esc(person.name) + ': ' + codes.length + ' new template' + (codes.length === 1 ? '' : 's') + ' banked from two guided captures (natural distance, then a little farther back)' +
          (bank ? ', with ' + bank.embeddings.length + ' PalmNet embedding' + (bank.embeddings.length === 1 ? '' : 's') : ' (PalmNet embeddings were not banked — the Registry will offer a Neural Scan)') +
          (hand ? '. ' + (hand === 'left' ? 'Left' : 'Right') + ' palm recorded — the other hand will not match this profile.' : '. The hand could not be determined from these captures.') +
          ' Biom ID, wallet, balance, statement, linked accounts, limits and points are untouched. Your wallet on this device opens without a scan — your palm is asked for when money moves.</div>';
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
  $('topBack').addEventListener('click', function () { recoveryPersonId = null; recoveryVia = null; reregPerson = null; if ($('topRereg')) $('topRereg').classList.add('hidden'); go(FaceMode.isOwner() ? 'registry' : 'account'); });
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
      /* v77: the DOM build is capped at the latest 200 rows per
         table. The full history stays in the device records (the
         field-test export and every flow read the store directly,
         never these rows) — what is capped is only the parse +
         layout cost of painting thousands of rows on navigation. */
      var LOG_DOM_CAP = 200;
      $('txBody').innerHTML = txs.slice(0, LOG_DOM_CAP).map(function (t) {
        return '<tr><td>' + esc(t.id) + '</td><td>' + esc(fmtTime(t.ts)) + '</td><td>' + esc(t.personName) + '</td><td>' + esc(t.provider) + '</td><td>' + esc(t.walletMasked) + '</td><td>' + esc(t.store) + '</td><td>BDT ' + Number(t.amount).toLocaleString() + '</td><td>' + esc(t.status) + '</td></tr>';
      }).join('') + (txs.length > LOG_DOM_CAP ? '<tr><td colspan="8" style="color:var(--muted)">Showing the latest ' + LOG_DOM_CAP + ' of ' + txs.length + ' transactions.</td></tr>' : '') || '<tr><td colspan="8" style="color:var(--muted)">No Biom Pay transactions yet.</td></tr>';
      $('logBody').innerHTML = logs.slice(0, LOG_DOM_CAP).map(function (l) {
        return '<tr><td>' + esc(fmtTime(l.ts)) + '</td><td>' + esc(l.personName) + '</td><td>' + esc(l.store) + '</td><td>' + esc(l.method) + '</td><td>' + esc(l.measured) + '</td><td><span class="badge ' + (l.result === 'Verified' ? 'ok' : 'bad') + '">' + esc(l.result) + '</span></td></tr>';
      }).join('') + (logs.length > LOG_DOM_CAP ? '<tr><td colspan="6" style="color:var(--muted)">Showing the latest ' + LOG_DOM_CAP + ' of ' + logs.length + ' verifications.</td></tr>' : '') || '<tr><td colspan="6" style="color:var(--muted)">No verifications yet.</td></tr>';
      return renderFieldPanel();
    });
  }

  /* v77: sheet/detail state classes + sheet keyboard basics.
     styles.css used to key the desktop sheet backdrop and the
     registry list–detail grid off body:has(...) / section:has(...)
     selectors, which the style engine re-tests against the whole
     subtree on EVERY DOM mutation — every render, every hidden
     toggle, every scan-indicator class change. The same visual
     states are now carried by two explicit classes maintained
     here from the elements' own class changes (one observer,
     microtask-batched, no per-mutation style invalidation):
     body.sheet-open while any wallet sheet or the scan card is
     visible on the wallet page, and #page-registry.detail-open
     while the registry detail panel is visible.
     The same block gives the sheets their dialog basics: when a
     sheet opens, focus moves to its first control; Escape closes
     the open sheet through its own Back/Cancel control (so the
     flow's own close logic runs, unchanged); when it closes,
     focus returns to whatever held it before. */
  (function () {
    var SHEETS = [
      { id: 'walletAdd', closeId: 'wAddBack' },
      { id: 'walletSend', closeId: 'wSendBack' },
      { id: 'walletPay', closeId: 'wPayBack' },
      { id: 'walletScanCard', closeId: 'wScanCancel' }
    ];
    var wasOpen = {};
    var returnFocusTo = null;
    function sheetOpen(sh) {
      var el = $(sh.id);
      return !!(el && !el.classList.contains('hidden'));
    }
    function syncSheetClasses() {
      var wallet = $('page-wallet');
      var anyOpen = false;
      SHEETS.forEach(function (sh) { if (sheetOpen(sh)) anyOpen = true; });
      document.body.classList.toggle('sheet-open', !!(anyOpen && wallet && wallet.classList.contains('active')));
      var det = $('registryDetail'), reg = $('page-registry');
      if (reg) reg.classList.toggle('detail-open', !!(det && !det.classList.contains('hidden')));
      SHEETS.forEach(function (sh) {
        var open = sheetOpen(sh);
        if (open && !wasOpen[sh.id]) {
          returnFocusTo = document.activeElement;
          var el = $(sh.id);
          var first = el && el.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]');
          if (first) setTimeout(function () { try { first.focus(); } catch (e) {} }, 30);
        } else if (!open && wasOpen[sh.id]) {
          if (returnFocusTo && document.contains(returnFocusTo)) { try { returnFocusTo.focus(); } catch (e) {} }
          returnFocusTo = null;
        }
        wasOpen[sh.id] = open;
      });
    }
    var mo = new MutationObserver(syncSheetClasses);
    SHEETS.forEach(function (sh) { var el = $(sh.id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] }); });
    ['registryDetail', 'page-wallet'].forEach(function (id) { var el = $(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] }); });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      for (var i = 0; i < SHEETS.length; i++) {
        if (sheetOpen(SHEETS[i])) {
          var btn = $(SHEETS[i].closeId);
          if (btn) { btn.click(); ev.preventDefault(); }
          return;
        }
      }
    });
    syncSheetClasses();
  })();

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
  /* PROFILE-DELETE-BEGIN — v69: ONE customer deletes their
     own profile (the customer Settings "Delete my data"). The
     order of operations is the Delete All Data order, scoped
     to one person: (1) if the profile carries a palm bank and
     sync is active, its tombstone is queued and a flush is
     attempted FIRST — the vault drops the bank's templates and
     keeps only the deletion marker (v62 semantics, D7
     retention unchanged); (2) only then is anything erased
     locally: the person row (palm bank + wallet live in it),
     the profile's Inbox meta, its strengthen-offer flag, and
     the transactions that profile authored. A tombstone that
     could not be delivered stays in the persisted outbox and
     completes on the next successful sync — the outcome says
     which of the three server states happened, exactly as the
     wipe reports it. Other profiles are never read for
     writing and never touched. Pure factory over deps: the
     suite drives the exact shipped logic against fakes and
     pins the tombstone-before-erase order. */
  function createProfileDeletion(deps) {
    function isBanked(person) {
      return !!(person && person.palmProfile && (
        (Array.isArray(person.palmProfile.codes) && person.palmProfile.codes.length) ||
        (person.palmProfile.neural && Array.isArray(person.palmProfile.neural.embeddings) && person.palmProfile.neural.embeddings.length) ||
        (Array.isArray(person.palmProfile.legacyCodes) && person.palmProfile.legacyCodes.length)));
    }
    function deleteProfile(personId) {
      return deps.getPerson(personId).then(function (person) {
        if (!person) return { deleted: false, reason: 'not-found' };
        var banked = isBanked(person) ? [person] : [];
        var syncActive = !!deps.syncActive();
        /* v73 (Seat 1 F2): FIRST purge any queued non-scan
           outbox items for this Biom ID, in EVERY branch. A
           profile upsert queued while sync was on (e.g. the
           server unreachable) must not survive a sync-off
           delete: when sync later returned, the flush would
           POST the deleted bank back to the server and no
           tombstone would ever correct it. The purge runs
           BEFORE the tombstone branch below, so the tombstone
           queued there is never purged by it. */
        var stage = deps.purgeProfile ? deps.purgeProfile(personId) : Promise.resolve();
        if (syncActive && banked.length) {
          stage = stage.then(function () { return deps.queueTombstones(banked); }).then(function () { return deps.flush(); });
        }
        return stage.then(function () {
          var pending = (syncActive && banked.length) ? deps.pendingTombstones(personId) : [];
          return deps.erase(personId).then(function (erased) {
            return {
              deleted: true, erased: erased,
              server: !banked.length ? 'none' : !syncActive ? 'inactive' : pending.length ? 'pending' : 'tombstoned'
            };
          });
        });
      });
    }
    return { deleteProfile: deleteProfile, isBanked: isBanked };
  }
  /* PROFILE-DELETE-END */
  var ProfileDeletion = createProfileDeletion({
    getPerson: function (personId) {
      return DB.all('people').then(function (people) {
        return people.find(function (p) { return p.id === personId; }) || null;
      });
    },
    syncActive: function () { var st = Sync.state(); return !!(st.on && st.configured); },
    queueTombstones: function (people) { return Sync.queueTombstones(people); },
    purgeProfile: function (personId) { return Sync.purgeProfile(personId); },
    flush: function () { return Sync.flush(); },
    pendingTombstones: function (personId) {
      return Sync.pendingItems().filter(function (it) {
        return it.type === 'tombstone' && it.record && it.record.biomId === personId;
      });
    },
    erase: function (personId) {
      return DB.remove('people', personId)
        .then(function () { return DB.remove('meta', 'inbox:' + personId); })
        .then(function () { return DB.remove('meta', 'strengthenOffered:' + personId); })
        .then(function () { return DB.all('transactions'); })
        .then(function (txs) {
          var mine = (txs || []).filter(function (t) { return t && t.personId === personId; });
          return mine.reduce(function (chain, t) {
            return chain.then(function () { return DB.remove('transactions', t.id); });
          }, Promise.resolve()).then(function () { return { transactions: mine.length }; });
        });
    }
  });

  /* v69: the Settings wiring for Delete my data — the same
     confirmation strength as the owner's wipe: the row only
     OPENS the panel; deletion runs only after the customer
     types DELETE and taps the distinct confirm button. The
     counts come from the live record, so what will be deleted
     is stated, not implied. */
  function wireProfileDelete() {
    var row = $('setDeleteRow');
    if (!row) return;
    var panel = $('delConfirm'), input = $('delConfirmInput'),
      confirmBtn = $('delConfirmBtn'), cancelBtn = $('delCancelBtn'), msg = $('delMsg');
    var targetId = null;
    function closePanel() {
      panel.classList.add('hidden');
      row.disabled = false;
      input.value = '';
      confirmBtn.disabled = true;
      targetId = null;
    }
    row.addEventListener('click', function () {
      msg.innerHTML = '';
      loadWalletPeople().then(function (people) {
        var entry = resolveWalletEntry(people);
        if (entry) walletSessionId = entry.id;
        var me = walletSessionPerson();
        if (!me) { msg.innerHTML = '<div class="error">No account is open — open your wallet first.</div>'; return; }
        targetId = me.id;
        var w = B.walletEnsurePerson(me).wallet;
        $('delCounts').textContent = 'This deletes ' + me.name + '\'s palm registration and wallet on this device' +
          ' (balance ' + fmtBDT(w.balance) + ', with its statement and linked accounts), this account\'s Inbox history,' +
          ' and marks the palm bank deleted in the TSG Biom vault by tombstone.';
        panel.classList.remove('hidden');
        row.disabled = true;
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
      if (input.value.trim() !== 'DELETE' || !targetId) return;
      var personId = targetId;
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      ProfileDeletion.deleteProfile(personId).then(function (outcome) {
        if (!outcome.deleted) throw new Error('not-found');
        var serverLine = outcome.server === 'tombstoned'
          ? 'The palm bank synced to your TSG Biom server has been marked deleted there too.'
          : outcome.server === 'pending'
            ? 'Removal from your TSG Biom server could not be confirmed just now — the deletion request is kept and completes on the next sync.'
            : outcome.server === 'inactive'
              ? 'Copies already synced to your TSG Biom server are not erased by this deletion — Scan Sync was off, so no server removal was sent.'
              : 'This account had no palm bank, so there was nothing to remove from the server.';
        closePanel();
        cancelBtn.disabled = false;
        /* The session ends with the account: clear the open
           wallet, drop the cached people list, clear the role
           and return to the role choice — from there, Customer
           leads to a fresh registration, exactly the post-wipe
           first-run shape scoped to one account. */
        walletSessionId = null;
        walletPeopleCache = [];
        RoleMode.clear();
        applyRoleChrome();
        msg.innerHTML = '<div class="success">Your data is deleted — this account\'s palm registration, wallet and Inbox history are gone from this device. ' + serverLine + '</div>';
        toast('Your data is deleted.');
        setTimeout(function () { go('role'); }, 1200);
      }).catch(function () {
        msg.innerHTML = '<div class="error">Delete failed — nothing was erased. Your data is unchanged; please try again.</div>';
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
      });
    });
  }
  wireProfileDelete();

  /* v72: the Settings wiring for the Biom Pay wallet link.
     Until v72, profile.walletProvider / walletNumber could
     only be set in the enrolment details form, so an existing
     profile could never link one and Wallet Pay refused it
     ("your profile has no linked bKash / Nagad wallet") — the
     v71 bKash sandbox rail could never engage for it. The row
     opens an inline panel in the Delete-panel pattern; Save
     and Unlink run through the B.walletSetPayWallet /
     B.walletClearPayWallet store rules (enrolment's validation)
     and persist through the EXISTING profile-mutation path —
     the same one enrolment's finishEnrollment and every
     post-enrolment mutation (top-up, re-register) use:
     DB.put('people', person), then Sync.noteProfile(person),
     then loadWalletPeople() refreshes the cached people list
     so walletSessionPerson() and the Pay flow's fresh reads
     see the link immediately. The mutation is written and
     noted through that identical DB.put → Sync.noteProfile
     path enrolment uses; the sealed vault bank record
     (B.syncProfileRecord, the v62 protocol) carries the
     biometric bank and the walletLink agreement field —
     walletProvider / walletNumber are profile fields that,
     exactly as when set at enrolment, live on the device
     profile and are not part of that bank record. Only the
     signed-in customer's own profile (walletSessionPerson)
     is editable, and the panel captures that profile's id
     when it opens and re-verifies it at Save / Unlink.
     A refused Save writes NOTHING. */
  function payWalletRowText(me) {
    if (!me || !me.walletProvider) return 'Not linked';
    return me.walletProvider + ' ' + B.maskWalletNumber(me.walletNumber);
  }
  /* v72 (Seat 1 F1): the pay-wallet panel reset — a module-scope
     helper so renderSettings() can call it on every Settings
     render. It hides the panel, re-enables the row, and clears
     the FULL wallet number the panel holds and any message, so
     no stale panel from a previous profile survives an account
     switch, a log out, or plain navigation to Settings. */
  function resetPayWalletPanel() {
    var panel = $('payWalletPanel'), row = $('setPayWalletRow'),
      numberInput = $('payWalletNumber'), msg = $('payWalletMsg');
    if (panel) panel.classList.add('hidden');
    if (row) row.disabled = false;
    if (numberInput) numberInput.value = '';
    if (msg) msg.innerHTML = '';
  }
  function wirePayWalletLink() {
    var row = $('setPayWalletRow');
    if (!row) return;
    var panel = $('payWalletPanel'), providerSel = $('payWalletProvider'), numberInput = $('payWalletNumber'),
      saveBtn = $('payWalletSaveBtn'), unlinkBtn = $('payWalletUnlinkBtn'), cancelBtn = $('payWalletCancelBtn'),
      msg = $('payWalletMsg');
    /* v72 (Seat 2 F2): the id of the profile this panel was
       opened for, captured when the panel opens (the
       wireProfileDelete targetId pattern) and re-verified at
       Save / Unlink — the session could have moved to another
       profile while the panel sat open. */
    var panelTargetId = null;
    function closePanel() {
      resetPayWalletPanel();
      saveBtn.disabled = false;
      unlinkBtn.disabled = false;
      cancelBtn.disabled = false;
      panelTargetId = null;
    }
    function panelTargetMismatch() {
      var me = walletSessionPerson();
      return !panelTargetId || !me || me.id !== panelTargetId;
    }
    function refusePanelTargetMismatch() {
      closePanel();
      msg.innerHTML = '<div class="error">This panel was opened for a different account — close it and try again.</div>';
    }
    function persist(res, doneText) {
      /* v72 (Seat 1 F2): the panel's buttons are disabled while
         the write is in flight (the Delete panel precedent) and
         re-enabled if it fails; success closes the panel. */
      saveBtn.disabled = true;
      unlinkBtn.disabled = true;
      cancelBtn.disabled = true;
      return DB.put('people', res.person).then(function () {
        Sync.noteProfile(res.person);
        /* v72 (Seat 2 F4): the write has landed — the save has
           SUCCEEDED from here, whatever the cache refresh below
           does. Commit the success UI first (the row is painted
           from the saved row itself), then refresh the cached
           people list inside its own catch. */
        closePanel();
        $('setPayWalletVal').textContent = payWalletRowText(res.person);
        msg.innerHTML = '<div class="success">' + doneText + '</div>';
        return loadWalletPeople().then(function () {
          $('setPayWalletVal').textContent = payWalletRowText(walletSessionPerson());
        }).catch(function () {
          /* The link is saved on this device; only the cached
             people refresh failed, so the row is refreshed on
             the next render instead — a landed save is never
             reported as a failed one. */
        });
      }).catch(function (e) {
        saveBtn.disabled = false;
        unlinkBtn.disabled = false;
        cancelBtn.disabled = false;
        msg.innerHTML = '<div class="error">Could not save the wallet on this device: ' + esc(e.message || e) + '</div>';
      });
    }
    row.addEventListener('click', function () {
      msg.innerHTML = '';
      loadWalletPeople().then(function (people) {
        var entry = resolveWalletEntry(people);
        if (entry) walletSessionId = entry.id;
        var me = walletSessionPerson();
        if (!me) { msg.innerHTML = '<div class="error">No account is open — open your wallet first.</div>'; return; }
        panelTargetId = me.id;
        providerSel.value = me.walletProvider || '';
        numberInput.value = me.walletNumber || '';
        unlinkBtn.classList.toggle('hidden', !me.walletProvider);
        panel.classList.remove('hidden');
        row.disabled = true;
        numberInput.focus();
      });
    });
    cancelBtn.addEventListener('click', closePanel);
    saveBtn.addEventListener('click', function () {
      if (panelTargetMismatch()) { refusePanelTargetMismatch(); return; }
      var me = walletSessionPerson();
      if (!me) return;
      var res = B.walletSetPayWallet(me, providerSel.value, numberInput.value);
      if (!res.ok) { msg.innerHTML = '<div class="error">' + esc(res.error) + '</div>'; return; }
      persist(res, 'Biom Pay wallet linked: ' + esc(res.person.walletProvider) + ' ' + esc(B.maskWalletNumber(res.person.walletNumber)) + '. Wallet Pay can now pay from this wallet.');
    });
    unlinkBtn.addEventListener('click', function () {
      if (panelTargetMismatch()) { refusePanelTargetMismatch(); return; }
      var me = walletSessionPerson();
      if (!me || !me.walletProvider) return;
      var res = B.walletClearPayWallet(me);
      if (!res.ok) { msg.innerHTML = '<div class="error">' + esc(res.error) + '</div>'; return; }
      persist(res, 'Biom Pay wallet unlinked. Wallet Pay will refuse payments until a wallet is linked again.');
    });
  }
  wirePayWalletLink();

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
      /* v61: the vault key SURVIVES Delete All Data on purpose —
         the key is not biometric data (it lives in its own store,
         untouched by clearAll), and keeping it means banks
         re-enrolled after a wipe seal under the same vault and a
         saved recovery sheet stays valid. */
      loadSnapshot().then(function (snap) {
        var wiped = B.wipeBiomData(snap);
        /* v62 (B7): the wipe is now true for the WHOLE system.
           Before anything is erased locally, every person with a
           palm bank gets a tombstone queued and a flush is
           attempted: the server drops the bank's templates and
           keeps only the deletion marker, and other devices
           remove their copies when they next pull. Tombstones
           that cannot be delivered (offline, server down) are
           captured from the queue and re-saved after clearAll,
           with the sync settings KEPT, so the removal completes
           on the next successful sync — the result copy below
           says exactly which of the three outcomes happened. No
           delete-all scan record is sent (there is none — the
           tombstones are profile writes, not scan records). */
        var banked = snap.people.filter(function (p) {
          return p && p.palmProfile && (
            (Array.isArray(p.palmProfile.codes) && p.palmProfile.codes.length) ||
            (p.palmProfile.neural && Array.isArray(p.palmProfile.neural.embeddings) && p.palmProfile.neural.embeddings.length) ||
            (Array.isArray(p.palmProfile.legacyCodes) && p.palmProfile.legacyCodes.length));
        });
        var st = Sync.state();
        var syncActive = !!(st.on && st.configured);
        var versionsBefore = null;
        var stage = Promise.resolve();
        if (syncActive) {
          stage = DB.getMeta('syncVersions', {}).then(function (v) { versionsBefore = v; })
            .then(function () { return Sync.queueTombstones(banked); })
            .then(function () { return Sync.flush(); });
        }
        return stage.then(function () {
          var pendingTombstones = syncActive ? Sync.pendingItems().filter(function (it) { return it.type === 'tombstone'; }) : [];
          return DB.clearAll().then(function () {
            if (pendingTombstones.length) {
              return DB.setMeta('syncOutbox', pendingTombstones)
                .then(function () { return DB.setMeta('syncVersions', versionsBefore || {}); })
                .then(function () { return { wiped: wiped, server: 'pending' }; });
            }
            return { wiped: wiped, server: syncActive && banked.length ? 'tombstoned' : 'inactive' };
          });
        });
      }).then(function (outcome) {
        var wiped = outcome.wiped;
        if (outcome.server === 'pending') {
          /* The sync prefs are KEPT on purpose: the tombstones
             still queued in the outbox are the only record that
             the server copies must be deleted, and they send on
             the next boot's flush. */
        } else {
          // v56: the wipe also clears the Scan Sync prefs and the
          // in-memory outbox (the persisted outbox is a meta row,
          // already erased by clearAll above). v62 extends the
          // pref list with this device's own credential + sequence.
          ['biomSyncEndpoint', 'biomSyncDeviceKey', 'biomSyncLabel', 'biomSyncOn', 'biomSyncDeviceId', 'biomSyncDeviceSecret', 'biomSyncSeq'].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
          Sync.reset();
        }
        try { localStorage.setItem(DV_KEY, APP_DATA_VERSION); } catch (e) {}
        try { localStorage.setItem(DBV_KEY, APP_DATA_VERSION); } catch (e) {}
        closePanel();
        cancelBtn.disabled = false;
        var serverLine = outcome.server === 'tombstoned'
          ? 'The palm banks that were synced to your TSG Biom server have been marked deleted there too.'
          : outcome.server === 'pending'
            ? 'Removal from your TSG Biom server could not be confirmed just now — the deletion requests are kept and complete on the next sync.'
            : 'Copies already synced to your TSG Biom server are not erased by this wipe — Scan Sync was off, so no server removal was sent.';
        msg.innerHTML = '<div class="success">All data deleted — ' + wiped.removedTotal +
          (wiped.removedTotal === 1 ? ' stored record' : ' stored records') +
          ' removed. This device now holds an empty registry. ' + serverLine + ' Reloading…</div>';
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
  wireSyncSettings();
  wireVault();

  /* INBOX-BEGIN — the v67 customer Inbox core: a pure factory
     over a tiny async store adapter, so the suite can drive the
     exact shipped logic against a fake store. An Inbox event is
     created ONLY by the money flows' success paths (Add Money,
     Send Money — for both the sender and the receiver — and
     Biom Pay from the wallet or the terminal); no failure path
     anywhere calls add(), so a failed action can never produce
     a notification. Events persist per profile with an unread
     flag and are capped, oldest dropped first. The titles are
     the approved design's: plain statements of what happened,
     with the demo-money truth carried in the detail line the
     caller supplies from the real record. */
  function createInbox(store) {
    var CAP = 60;
    var TITLES = {
      add: 'Add money successful',
      send: 'Send money successful',
      pay: 'Payment done',
      /* v71: the bKash sandbox rail gets its own title — a
         sandbox payment is never announced with the demo
         ledger's bare "Payment done". */
      bkash: 'bKash Sandbox payment — TEST MODE'
    };
    function event(kind, opts) {
      opts = opts || {};
      if (kind === 'receive') {
        return {
          kind: 'receive', ts: opts.ts || Date.now(),
          title: 'You received money from ' + (opts.counterpartyName || 'another wallet'),
          detail: opts.detail || '', amount: typeof opts.amount === 'number' ? opts.amount : null,
          balanceAfter: typeof opts.balanceAfter === 'number' ? opts.balanceAfter : null,
          ref: opts.ref || '', counterpartyName: opts.counterpartyName || '', read: false
        };
      }
      if (!TITLES[kind]) return null;
      return {
        kind: kind, ts: opts.ts || Date.now(), title: TITLES[kind],
        detail: opts.detail || '', amount: typeof opts.amount === 'number' ? opts.amount : null,
        balanceAfter: typeof opts.balanceAfter === 'number' ? opts.balanceAfter : null,
        ref: opts.ref || '', counterpartyName: opts.counterpartyName || '', read: false
      };
    }
    function key(personId, ev) { return ev.kind + ':' + (ev.ref || (ev.ts + ':' + (ev.amount || 0))); }
    function add(personId, ev) {
      if (!personId || !ev) return Promise.resolve(false);
      return store.load(personId).then(function (list) {
        list = Array.isArray(list) ? list.slice() : [];
        ev.id = key(personId, ev);
        list.push(ev);
        while (list.length > CAP) list.shift();
        return store.save(personId, list).then(function () { return true; });
      }).catch(function () { return false; });
    }
    function list(personId) {
      return store.load(personId).then(function (rows) {
        rows = Array.isArray(rows) ? rows.slice() : [];
        return rows.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      }).catch(function () { return []; });
    }
    function unreadCount(personId) {
      return store.load(personId).then(function (rows) {
        return (Array.isArray(rows) ? rows : []).filter(function (e) { return e && !e.read; }).length;
      }).catch(function () { return 0; });
    }
    function markAllRead(personId) {
      return store.load(personId).then(function (rows) {
        rows = Array.isArray(rows) ? rows : [];
        var changed = false;
        rows.forEach(function (e) { if (e && !e.read) { e.read = true; changed = true; } });
        return changed ? store.save(personId, rows) : null;
      }).then(function () { return true; }).catch(function () { return false; });
    }
    return { event: event, add: add, list: list, unreadCount: unreadCount, markAllRead: markAllRead, CAP: CAP };
  }
  /* INBOX-END */
  var Inbox = createInbox({
    /* Inbox events live under their own meta keys — local to
       this device, outside the synced bank shape and outside
       the v61 vault funnel (they carry no palm material, only
       the money facts the wallet statement already shows).
       The owner's Delete All Data clears the meta store, so
       the Inbox is wiped with everything else, as it should
       be. */
    load: function (personId) { return DB.getMeta('inbox:' + personId, []); },
    save: function (personId, events) { return DB.setMeta('inbox:' + personId, events); }
  });

  /* ROLEMODE-BEGIN — the v67 role core: a pure factory over a
     storage adapter. The role (customer / merchant) is a
     device preference, held in localStorage like the sync
     prefs — it is not account data, never syncs, and clearing
     it (Settings → Log out) simply returns the app to the
     role choice. No role means the role choice shows. */
  function createRoleMode(storage) {
    var KEY = 'tsgbiom_role';
    function get() {
      try {
        var v = storage.getItem(KEY);
        return (v === 'customer' || v === 'merchant') ? v : null;
      } catch (e) { return null; }
    }
    function set(role) {
      if (role !== 'customer' && role !== 'merchant') return get();
      try { storage.setItem(KEY, role); } catch (e) {}
      return get();
    }
    function clear() { try { storage.removeItem(KEY); } catch (e) {} }
    function isMerchant() { return get() === 'merchant'; }
    function isCustomer() { return get() === 'customer'; }
    return { get: get, set: set, clear: clear, isMerchant: isMerchant, isCustomer: isCustomer, KEY: KEY };
  }
  /* ROLEMODE-END */
  var RoleMode = createRoleMode(window.localStorage);

  /* MERCHANT-BALANCE-BEGIN — the v67 merchant Balance core: a
     pure function over the real BIOM-PAY records (the
     'transactions' store both payment creators write). It
     computes the receipts newest-first, each carrying the
     running balance after that payment — the accumulation
     runs chronologically over the same records, so the chain
     arithmetic always holds on real data — plus the all-time
     and today's totals. It invents nothing: a record with no
     amount contributes nothing, and the customer's number is
     joined from their profile when known, falling back to
     the record's own masked wallet. */
  function merchantBalanceSummary(txs, peopleById, nowTs) {
    var pays = (Array.isArray(txs) ? txs : []).filter(function (t) {
      /* v71: bKash sandbox records are not merchant receipts —
         test money never enters the Balance chain. */
      return t && typeof t.amount === 'number' && isFinite(t.amount) && t.rail !== 'bkash-sandbox';
    }).slice();
    pays.sort(function (a, b) {
      var d = (a.ts || 0) - (b.ts || 0);
      if (d !== 0) return d;
      return String(a.id || '') < String(b.id || '') ? -1 : 1;
    });
    var running = 0;
    var dayStart = new Date(nowTs || Date.now()); dayStart.setHours(0, 0, 0, 0);
    var todayTotal = 0, todayCount = 0;
    var rowsAsc = pays.map(function (t) {
      running += t.amount;
      if ((t.ts || 0) >= dayStart.getTime()) { todayTotal += t.amount; todayCount += 1; }
      var person = peopleById ? peopleById[t.personId] : null;
      return {
        id: t.id, ts: t.ts || 0, personId: t.personId || '', personName: t.personName || (person && person.name) || 'Customer',
        number: (person && person.phone) || t.walletMasked || '',
        amount: t.amount, balanceAfter: running, store: t.store || ''
      };
    });
    return {
      rows: rowsAsc.slice().reverse(),
      totalReceived: running, todayTotal: todayTotal, todayCount: todayCount
    };
  }
  /* MERCHANT-BALANCE-END */

  /* FACE-MODE-BEGIN — the v63 two-face mode core: a pure factory
     over a minimal DOM adapter, so the suite can drive the exact
     shipped logic against a fake tree. It owns the session owner
     state (held in memory only — never stored, so closing the
     app always returns to the customer face), the owner-page
     list, the detach/attach bookkeeping for owner-only surfaces,
     and the pure owner-unlock decision. */
  function createFaceMode(dom) {
    var owner = false;
    var detached = []; // [{ node, parent, next }] in document order
    var OWNER_PAGES = ['dashboard', 'terminal', 'registry', 'stores', 'logs', 'partner'];
    function isOwner() { return owner; }
    function detachSurfaces() {
      if (detached.length) return detached.length;
      dom.ownerNodes().forEach(function (node) {
        detached.push({ node: node, parent: dom.parentOf(node), next: dom.nextOf(node) });
      });
      detached.forEach(function (d) { dom.detach(d.node); });
      return detached.length;
    }
    function attachSurfaces() {
      /* Reverse order: a node's recorded next sibling is back in
         place before the node that precedes it is re-inserted. */
      detached.slice().reverse().forEach(function (d) { dom.attach(d.node, d.parent, d.next); });
      detached = [];
    }
    function enter() { owner = true; attachSurfaces(); }
    function lock() { owner = false; detachSurfaces(); }
    function gate(page) { return !owner && OWNER_PAGES.indexOf(page) !== -1 ? 'wallet' : null; }
    /* The owner-unlock decision, pure. 'no-match' — no palm
       matched; 'refuse' — the match is not the owner and an
       owner exists; 'claim' — the match is not flagged but NO
       profile carries the flag yet (first claim wins);
       'enter' — the match carries the owner flag. */
    function unlockDecision(person, people) {
      if (!person) return 'no-match';
      var hasOwner = (people || []).some(function (p) { return p && p.owner === true; });
      if (person.owner === true) return 'enter';
      return hasOwner ? 'refuse' : 'claim';
    }
    return {
      isOwner: isOwner, enter: enter, lock: lock, gate: gate,
      detachSurfaces: detachSurfaces, attachSurfaces: attachSurfaces,
      unlockDecision: unlockDecision, OWNER_PAGES: OWNER_PAGES
    };
  }
  /* FACE-MODE-END */

  var FaceMode = createFaceMode({
    ownerNodes: function () { return Array.prototype.slice.call(document.querySelectorAll('.owner-only')); },
    parentOf: function (n) { return n.parentNode; },
    nextOf: function (n) { return n.nextSibling; },
    detach: function (n) { if (n.parentNode) n.parentNode.removeChild(n); },
    attach: function (n, parent, next) {
      if (!parent) return;
      if (next && next.parentNode === parent) parent.insertBefore(n, next);
      else parent.appendChild(n);
    }
  });

  function applyFaceChrome() {
    var owner = FaceMode.isOwner();
    document.body.classList.toggle('mode-owner', owner);
    document.body.classList.toggle('mode-customer', !owner);
    /* v66: density modes — comfortable on the customer face,
       compact on the owner face (House System v2, one component
       set, two token densities). */
    document.body.dataset.density = owner ? 'compact' : 'comfortable';
    document.querySelectorAll('#mainNav button').forEach(function (b) {
      var p = b.dataset.page;
      /* v67: the visible set is face + role. The owner face
         keeps exactly its v66 set (the prototype's role tabs
         never show there); the customer face shows the
         prototype tabs — Wallet · Inbox · Settings for the
         customer role, Scanner · Balance for the merchant. */
      var show = owner
        ? (p !== 'activity' && p !== 'account' && p !== 'inbox' && p !== 'settings' && p !== 'scanner' && p !== 'balance')
        : RoleMode.isMerchant()
          ? (p === 'scanner' || p === 'balance')
          : (p === 'wallet' || p === 'inbox' || p === 'settings');
      b.classList.toggle('hidden', !show);
    });
    var bar = $('ownerBar');
    if (bar) bar.classList.toggle('hidden', !owner);
  }
  function enterOwnerMode() {
    FaceMode.enter();
    applyFaceChrome();
    renderDashboard();
    fillTerminalPeople();
  }
  function lockOwnerMode() {
    FaceMode.lock();
    applyFaceChrome();
    /* v67: locking returns to the active role's home — in the
       merchant role the scanner is re-attached first (the lock
       detached every owner surface, the terminal included)
       and the merchant lands there; everyone else lands on
       the wallet. */
    applyRoleChrome();
    if (RoleMode.isMerchant()) { go('terminal'); } else { go('wallet'); }
    toast('Owner mode locked.');
  }
  function applyInitialFace() {
    FaceMode.detachSurfaces();
    applyFaceChrome();
  }

  /* ---------------- v67 roles: choice, chrome, routing -------------
     The role layer sits BESIDE the v63 face layer and never
     edits it: FaceMode still owns owner/customer and the
     detach bookkeeping. The one structural need is the
     terminal page in merchant mode — it is an owner surface
     (detached in the customer face), so the role layer keeps
     its own reference and re-inserts it into <main> while the
     merchant role is active. FaceMode's recorded detach entry
     for it stays valid throughout: owner entry re-inserts it
     at its recorded place, owner lock re-collects and
     re-detaches every .owner-only node from the live DOM,
     and applyRoleChrome below re-attaches it again for the
     merchant. No other owner surface is ever re-attached by
     the role layer, and the go() gate still resolves every
     other owner page away from the customer face. */
  var termSectionEl = document.getElementById('page-terminal');
  function attachTerminalForMerchant() {
    if (!termSectionEl || termSectionEl.parentNode) return;
    var main = document.querySelector('main');
    if (main) main.appendChild(termSectionEl);
  }
  function applyRoleChrome() {
    var role = RoleMode.get();
    var owner = FaceMode.isOwner();
    document.body.classList.toggle('role-customer', role === 'customer');
    document.body.classList.toggle('role-merchant', role === 'merchant');
    document.body.classList.toggle('role-none', !role);
    if (!owner && role === 'merchant') attachTerminalForMerchant();
    var nav = $('mainNav');
    if (nav) nav.classList.toggle('hidden', !owner && !role);
    updateInboxBadge();
  }
  function applyRoleBoot() {
    applyRoleChrome();
    if (FaceMode.isOwner()) return;
    var role = RoleMode.get();
    if (role === 'merchant') { go('terminal'); }
    else if (role === 'customer') { go('wallet'); }
    else { go('role'); }
  }
  $('roleCustomer').addEventListener('click', function () {
    RoleMode.set('customer');
    applyFaceChrome();
    applyRoleChrome();
    /* Registration first: with no profile on this device the
       customer goes straight to enrolment; with profiles, the
       wallet opens by its existing entry rule. */
    DB.all('people').then(function (people) {
      if (!people.length) { go('enroll'); } else { go('wallet'); }
    });
  });
  $('roleMerchant').addEventListener('click', function () {
    RoleMode.set('merchant');
    applyFaceChrome();
    applyRoleChrome();
    go('terminal');
  });

  /* ---------------- v67 Inbox page --------------------------------
     Renders the open wallet profile's events, grouped by day,
     newest first. Opening the page marks everything read —
     the unread dots are painted for this view first, then the
     stored flags clear and the tab badge follows. */
  function inboxDayLabel(ts) {
    var startOf = function (x) { var c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
    var day = startOf(ts), now = new Date();
    if (day === startOf(now)) return 'Today';
    var y = new Date(now); y.setDate(y.getDate() - 1);
    if (day === startOf(y)) return 'Yesterday';
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function inboxRowHtml(e) {
    var down = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v13m0 0 5-5m-5 5-5-5"/></svg>';
    var up = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V7m0 0 5 5m-5-5-5 5"/></svg>';
    var card = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h16M4 8.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 12.5h16"/></svg>';
    var icon = e.kind === 'send' ? '<span class="acticon out">' + up + '</span>'
      : e.kind === 'pay' ? '<span class="acticon out">' + card + '</span>'
      : '<span class="acticon in">' + down + '</span>';
    var amt = '';
    if (typeof e.amount === 'number') {
      amt = e.kind === 'add' || e.kind === 'receive' ? '<div class="amt in num">+ ' + fmtBDT(e.amount) + '</div>'
        : e.kind === 'send' ? '<div class="amt out num">− ' + fmtBDT(e.amount) + '</div>'
        : '<div class="amt num">' + fmtBDT(e.amount) + '</div>';
    }
    var meta = esc(new Date(e.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })) +
      (e.detail ? ' · ' + esc(e.detail) : '') +
      (typeof e.balanceAfter === 'number' ? ' · Balance ' + fmtBDT(e.balanceAfter) : '');
    return '<div class="actrow inboxrow' + (e.read ? '' : ' unread') + '">' + icon +
      '<div class="ar-main"><div class="ar-title">' + esc(e.title) + '</div><div class="ar-meta">' + meta + '</div></div>' +
      amt + (e.read ? '' : '<span class="unreaddot" aria-label="Unread"></span>') + '</div>';
  }
  function renderInbox() {
    return loadWalletPeople().then(function (people) {
      var entry = resolveWalletEntry(people);
      if (entry) walletSessionId = entry.id;
      var me = walletSessionPerson();
      $('inboxLocked').classList.toggle('hidden', !!me);
      $('inboxOpen').classList.toggle('hidden', !me);
      if (!me) return;
      return Inbox.list(me.id).then(function (events) {
        if (!events.length) {
          $('inboxList').innerHTML = '';
          $('inboxEmpty').classList.remove('hidden');
        } else {
          $('inboxEmpty').classList.add('hidden');
          var html = '', lastDay = null;
          events.forEach(function (e) {
            var day = inboxDayLabel(e.ts);
            if (day !== lastDay) { html += '<div class="inboxday">' + esc(day) + '</div>'; lastDay = day; }
            html += inboxRowHtml(e);
          });
          $('inboxList').innerHTML = html;
        }
        return Inbox.markAllRead(me.id).then(function () { updateInboxBadge(); });
      });
    });
  }
  function updateInboxBadge() {
    var badge = $('inboxBadge');
    if (!badge) return;
    if (!walletSessionId) { badge.classList.add('hidden'); return; }
    Inbox.unreadCount(walletSessionId).then(function (n) {
      badge.textContent = n > 9 ? '9+' : String(n);
      badge.classList.toggle('hidden', !n);
    });
  }

  /* ---------------- v67 Settings page ------------------------------
     The prototype's Settings tab. Every action routes to an
     existing flow: switch uses the wallet's own multi-profile
     entry, create is a new enrolment, log out closes the
     wallet session and clears the role back to the choice. */
  function renderSettings() {
    resetPayWalletPanel();
    return loadWalletPeople().then(function (people) {
      var entry = resolveWalletEntry(people);
      if (entry) walletSessionId = entry.id;
      var me = walletSessionPerson();
      $('settingsLocked').classList.toggle('hidden', !!me);
      $('settingsOpen').classList.toggle('hidden', !me);
      if (!me) return;
      $('setAvatar').textContent = initialsOf(me.name);
      $('setName').textContent = me.name;
      $('setPhone').textContent = me.phone || 'No phone number recorded';
      $('setBiomId').textContent = me.id;
      $('setPayWalletVal').textContent = payWalletRowText(me);
      var withPalm = people.filter(function (p) { return personHasMethod(p); });
      $('setSwitchVal').textContent = withPalm.length > 1 ? withPalm.length + ' accounts on this device' : 'Only account on this device';
    });
  }
  $('setSwitchRow').addEventListener('click', function () { closeWalletSession(); go('wallet'); });
  $('setCreateRow').addEventListener('click', function () { go('enroll'); });
  $('setMerchantRow').addEventListener('click', function () {
    RoleMode.set('merchant');
    applyFaceChrome();
    applyRoleChrome();
    go('terminal');
    toast('Merchant mode — the scanner is ready.');
  });
  $('setLogoutRow').addEventListener('click', function () {
    closeWalletSession();
    RoleMode.clear();
    applyRoleChrome();
    go('role');
    toast('Logged out.');
  });

  /* ---------------- v67 merchant Balance page ----------------------
     Receipts from the real BIOM-PAY records only, with the
     running balance computed over the same records — see
     merchantBalanceSummary. Nothing is stored for this page;
     it is a view over the transactions store. */
  function renderMerchantBalance() {
    return Promise.all([DB.all('transactions'), DB.all('people')]).then(function (r) {
      var peopleById = {};
      r[1].forEach(function (p) { peopleById[p.id] = p; });
      var s = merchantBalanceSummary(r[0], peopleById, Date.now());
      $('balTodayTotal').textContent = fmtBDT(s.todayTotal);
      $('balTodayCount').textContent = String(s.todayCount);
      $('balTotalReceived').textContent = fmtBDT(s.totalReceived);
      $('balList').innerHTML = s.rows.length ? s.rows.map(function (row) {
        return '<div class="actrow"><span class="acticon in"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v13m0 0 5-5m-5 5-5-5"/></svg></span>' +
          '<div class="ar-main"><div class="ar-title">' + esc(row.personName) + '</div>' +
          '<div class="ar-meta">' + esc(row.number || 'Number not recorded') + ' · ' + esc(fmtTime(row.ts)) + (row.store ? ' · ' + esc(row.store) : '') + '</div>' +
          '<div class="ar-meta">Balance after: <b>' + fmtBDT(row.balanceAfter) + '</b></div></div>' +
          '<div class="amt in num">+ ' + fmtBDT(row.amount) + '</div></div>';
      }).join('') : '';
      $('balEmpty').classList.toggle('hidden', !!s.rows.length);
    });
  }
  $('balCustomerRow').addEventListener('click', function () {
    RoleMode.set('customer');
    applyFaceChrome();
    applyRoleChrome();
    go('wallet');
    toast('Customer mode — your wallet is open.');
  });
  $('balLogoutRow').addEventListener('click', function () {
    closeWalletSession();
    RoleMode.clear();
    applyRoleChrome();
    go('role');
    toast('Logged out.');
  });

  /* The owner unlock: a manual-gated palm scan (v58 rules) on
     the shared wallet scan card, at PLAIN verify bars — this is
     an entry gate, not money, the same posture as the old
     wallet entry. The hand gate applies (it is inside
     streamIdentifyPalm). Attempts are logged like other scans:
     failures ride the card's Denied path (syncKind
     'owner-unlock'), a non-owner match is logged and synced as
     Denied here, a claim is written to Logs, and a successful
     unlock is logged and synced as Verified. */
  function openOwnerUnlock() {
    DB.all('people').then(function (people) {
      var withPalm = people.filter(personHasMethod);
      if (!withPalm.length) {
        toast('No palm is registered on this device yet — register a palm first, then claim owner access.');
        return;
      }
      var hasOwner = people.some(function (p) { return p.owner === true; });
      go('wallet');
      /* v66 gate fix: the wallet re-render that go('wallet')
         starts settles asynchronously and resets the scan card
         (adds 'hidden', clears walletScanCtx). Showing the unlock
         card synchronously lets that reset land after it — the
         card ends up hidden with a nulled context and owner mode
         can never open. Chain the card on a fresh renderWallet()
         promise instead: every pending reset has landed by the
         time the card is shown, and nothing re-renders the
         wallet behind it. The unlock itself is unchanged. */
      renderWallet().then(function () {
      showWalletScan({
        title: hasOwner ? 'Owner access' : 'Claim owner access',
        syncKind: 'owner-unlock', // v63 Scan Sync kind for this context
        prompt: hasOwner
          ? 'Scan the owner\'s palm to open owner mode. Owner mode shows every control on this device — the Desk, Registry, terminal, Biom Vault, Scan Sync settings and Delete All Data.'
          : 'No owner is set on this device yet. Scan your palm to claim owner access — the first palm to claim it becomes the owner of this device, and only the owner palm can open owner mode afterwards.',
        run: function () {
          return DB.all('people').then(function (fresh) {
            return streamIdentifyPalm($('wScanVideo'), $('wScanStatus'), fresh, null, walletControl).then(function (out) {
              if (!out || out.fail || !out.person) { walletScanFailed(out); return; }
              var decision = FaceMode.unlockDecision(out.person, fresh);
              var hand = out.diag ? out.diag.probeHand : null;
              var edcc = out.diag ? out.diag.edcc : null;
              var neural = out.diag ? out.diag.neural : null;
              if (decision === 'refuse') {
                DB.put('logs', { ts: Date.now(), personId: out.person.id, personName: out.person.name, store: '', method: 'palm', measured: out.measured || '', result: 'Owner Unlock Denied — Not Owner' }).catch(function () { return null; });
                                scanTimerStop('w'); // v74 (Seat 1 fix): freeze first, so the record stamps the shown total
Sync.noteScan({ kind: 'owner-unlock', profileName: out.person.name, biomId: out.person.id, hand: hand, edccScore: edcc, palmnetScore: neural, result: 'Denied' });
                $('wScanMsg').innerHTML = '<div class="error">That palm belongs to ' + esc(out.person.name) + ', who is not the owner of this device. Owner mode was not opened.</div>';
                $('wScanRun').disabled = false;
                Snd.buzz();
                return;
              }
              var person = out.person;
              var finish = function () {
                                scanTimerStop('w'); // v74 (Seat 1 fix): freeze first, so the record stamps the shown total
Sync.noteScan({ kind: 'owner-unlock', profileName: person.name, biomId: person.id, hand: hand, edccScore: edcc, palmnetScore: neural, result: 'Verified' });
                hideWalletScan();
                enterOwnerMode();
                toast((decision === 'claim' ? 'Owner access claimed. Owner mode is on.' : 'Owner mode is on.') + ' Scanned in ' + ScanTimers.w.elapsedText() + '.');
                go('dashboard');
              };
              if (decision === 'claim') {
                person.owner = true;
                DB.put('logs', { ts: Date.now(), personId: person.id, personName: person.name, store: '', method: 'palm', measured: out.measured || '', result: 'Owner Claimed' }).catch(function () { return null; });
                return DB.put('people', person).then(finish);
              }
              DB.put('logs', { ts: Date.now(), personId: person.id, personName: person.name, store: '', method: 'palm', measured: out.measured || '', result: 'Owner Mode Unlocked' }).catch(function () { return null; });
              finish();
            });
          });
        }
      });
      });
    });
  }
  /* Discreet owner entry: five taps on the My Account version
     line, or a long-press on the app logo. Neither is labelled
     as an owner door anywhere on the customer face. */
  (function wireOwnerEntry() {
    var taps = 0, tapTimer = null;
    var vl = $('versionLine');
    if (vl) vl.addEventListener('click', function () {
      taps++;
      if (tapTimer) clearTimeout(tapTimer);
      tapTimer = setTimeout(function () { taps = 0; }, 2500);
      if (taps >= 5) { taps = 0; if (tapTimer) clearTimeout(tapTimer); openOwnerUnlock(); }
    });
    var brand = $('brandLogo');
    if (brand) {
      var pressTimer = null;
      brand.addEventListener('pointerdown', function () {
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = setTimeout(openOwnerUnlock, 700);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
        brand.addEventListener(ev, function () { if (pressTimer) clearTimeout(pressTimer); });
      });
    }
    var lockBtn = $('ownerLockBtn');
    if (lockBtn) lockBtn.addEventListener('click', lockOwnerMode);
  })();

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

  /* ---------------- Service worker -------------------------------------
     v59: registered here instead of an inline <script> in
     index.html (Seat 1 Spec B3 prerequisite — a future CSP
     without 'unsafe-inline' must not kill SW registration).
     Behaviour identical: register sw.js on window load.
     v71 (Order 1): update DELIVERY. The v71 worker is
     network-first, so a fresh load already paints the current
     shell; this block covers the transition load itself — the
     one governed by the OLD worker, which serves its cached
     shell first. When the new worker takes control
     (controllerchange) and there WAS a previous controller,
     the page reloads once into the new shell — never on first
     install (no previous controller: the claim is not an
     update), never mid-flow: if a scan or a money commit is in
     flight the reload is held and delivered by
     checkPendingSwReload() when the flow settles. The
     once-guard is keyed by the incoming shell version read
     from the served sw.js, so the NEXT update in the same
     long-lived tab is delivered too. */
  var swReloadPending = false;
  var swReloadDoneFor = {};
  /* v71: the bKash sandbox interstitial (below) is a flow too —
     an authorised payment is waiting on the user's tap, and a
     reload there would silently discard the authorisation. */
  var sandboxInterstitialOpen = false;
  /* v73 (Seat 3 F1): the palm-authorised sandbox attempt —
     amount + store bound by startSandboxPay at authorisation
     time. The Continue handler uses ONLY this binding, never
     the still-editable DOM fields behind the interstitial. */
  var sandboxAttempt = null;
  function swFlowBusy() { return palmScanBusy || moneyCommitBusy || sandboxInterstitialOpen; }
  function checkPendingSwReload() {
    if (swReloadPending && !swFlowBusy()) {
      swReloadPending = false;
      window.location.reload();
    }
  }
  if ('serviceWorker' in navigator) {
    var swHadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!swHadController) { swHadController = true; return; }
      fetchWithTimeout('sw.js', { cache: 'no-store' }, 10000).then(function (r) { return r.text(); }).then(function (t) { // v77: bounded coherence probe
        var m = /tsg-biom-shell-(v[0-9]+)/.exec(t || '');
        var incoming = m ? m[1] : 'unknown';
        if (swReloadDoneFor[incoming]) return;
        /* v75: the update delivery spends the SAME boot-reload
           guard as the coherence reload, under the CANONICAL key:
           the newest build involved — the incoming SW build
           extended over this page's bootReloadKey (document stamp
           vs running app). Keying by the incoming build alone
           would not collide with a coherence spend keyed by an
           older document stamp, and the two mechanisms could
           stack into two reloads for one upgrade (Seat 1). An
           unparseable sw.js spends the page key, never a
           throwaway 'unknown' key. */
        var spendKey = m ? newestBuild(incoming, bootReloadKey) : bootReloadKey;
        if (bootReloadSpent(spendKey)) { swReloadDoneFor[incoming] = true; return; }
        swReloadDoneFor[incoming] = true;
        swReloadPending = true;
        checkPendingSwReload();
      }).catch(function () {
        if (swReloadDoneFor.session) return;
        swReloadDoneFor.session = true;
        if (bootReloadSpent(bootReloadKey)) return;
        swReloadPending = true;
        checkPendingSwReload();
      });
    });
    window.addEventListener('load', function () {
      /* v75: updateViaCache 'none' — the browser must never
         answer an update check for sw.js from the HTTP cache
         (GitHub Pages serves it max-age=600), or a fresh shell
         can wait undiscovered behind a stale worker script. */
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function (e) { console.warn('SW registration failed', e); });
    });
  }

  /* v59: enrolment Done-screen actions, bound here instead of
     inline onclick attributes (Spec B3 prerequisite — the only
     inline handlers in the app; behaviour identical). */
  [['enrollDoneRegistry', 'registry'], ['enrollDoneWallet', 'wallet'], ['enrollDoneTerminal', 'terminal']].forEach(function (pair) {
    var b = $(pair[0]);
    if (b) b.addEventListener('click', function () { go(pair[1]); });
  });

  /* ---------------- Boot --------------------------------------------------- */
  window.TSGApp = { go: go };
  wireCamToggles();
  wireFlashToggles();
  /* v77: Pipeline.start() is deliberately NOT called here any
     more — it is scheduled on idle time once the first screen is
     up (schedulePipelinePrewarm, fired from dropBootSplash) and
     kicked by the first interaction, so its assembly decode and
     WASM load never race the boot chain. The singleton still
     loads once and stays warm across every view (v43), and scan
     views still enter via Pipeline.enterScanView(). */
  setFieldMode(fieldModeOn());
  syncCamToggle('terminal');
  ['enrollPalm', 'terminal'].forEach(function (g) { syncFlashToggle(g); });
  fillStoreSelects();
  DB.open().then(function () { return Vault.init(); }).then(function () { return migrateDbStores(); }).then(function () { return Vault.convertBanks(); }).then(function () { renderDashboard(); fillTerminalPeople(); renderWallet(); })
    .then(function () {
      // v56 Scan Sync boot: load the persisted outbox, paint the
      // settings card, and attempt a background flush. When sync
      // is off or unconfigured every step here is a no-op.
      fillSyncSettings();
      renderVaultCard();
      return Sync.ensureLoaded();
    })
    .then(function () { applyInitialFace(); }) // v63: the customer face is the default — owner surfaces detach last, once every boot render has run against the intact DOM
    .then(function () { applyRoleBoot(); }) // v67: then the role layer routes — role choice, the customer wallet, or the merchant scanner
    .then(function () { return handleBkashReturn(); }) // v71: a return from bKash's sandbox page is settled here, from the API's own execute/query answers — never from the URL parameters
    .then(function () { dropBootSplash(); }) // v75: the first coherent screen has rendered — the boot splash comes down only now, never at parse time
    .then(function () {
      /* v77: sync flush + pull moved OFF the boot critical path.
         Until now the first routed screen waited on two network
         round trips (with unbounded fetches, a stalled connection
         held the screen hostage until the splash watchdog). The
         sends themselves are unchanged — same order (flush then
         pull), same sequence discipline, same tombstone
         application (Sync's tombstone path re-renders the
         affected surfaces when a pull lands) — they simply run
         as background work once the user is looking at the app,
         and every request is timeout-bounded via the sync
         layer's fetchFn. A background sync failure is swallowed
         here exactly as the flush's own status reporting already
         handles it; the next flush retries from the outbox. */
      return Sync.flush().then(function () { return Sync.pull(); }); // v62 (B7): apply any server tombstones after the flush
    })
    .catch(function () { dropBootSplash(); }); // v75: fail-open — a boot error must never leave the splash up (the 6 s watchdog above is the second backstop)
})();
