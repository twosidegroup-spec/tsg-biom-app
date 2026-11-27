# TSG Biom — PWA + Vercel version

By TwoSide Group (TS Technologies / TS Intelligence).

Hardware-free biometric terminal for CVS / pharmacy, retail stores, supermarkets and malls.
Any phone, tablet or laptop camera is the scanner. No extra hardware.

## Real scanning only — no fabrication

- **Face:** `@vladmandic/face-api` (CDN models) extracts a real 128-dimension descriptor.
  Verification is Euclidean distance, threshold **0.6**, actual distance shown. No face = honest error.
- **Palm — Hand Geometry:** MediaPipe Hands reads 21 landmarks; a normalized 30-measure
  hand-geometry descriptor is stored and compared, threshold **0.18**. Palm-vein needs
  infrared hardware and is not claimed.
- **Fingerprint through camera:** rear camera photographs the fingertip (5–8 cm, guide,
  torch attempted). The frame is grayscaled, contrast-stretched, sharpened and
  adaptive-thresholded; the original crop and the enhanced ridge image (from real pixels)
  are shown side by side. A quality gate (sharpness + ridge density) rejects blurry/blank
  prints. A 96×96 template + LBP texture histogram are stored; verification is template
  correlation + texture similarity, threshold **0.55**, actual scores shown.
- No `Math.random` in any verification, confidence or payment logic. No simulation fallback.
  Camera denied = honest error state.

## bKash / Nagad — Biom Pay

Enrollment can link a bKash or Nagad wallet (number normalised +880/880 → 01…, always
shown masked, e.g. `01933-***706`). A Biom Pay checkout (amount + store + a **real verified
scan** of a wallet-linked person) creates a transaction record with TSG Biom's own ID
(`BIOM-PAY-XXXX`) and the truthful status
`Biometric Authorized - Pending bKash Partner API Settlement`.
Real money moves only through the official bKash Tokenized Checkout / Nagad Payment
Gateway APIs after a merchant partnership — TSG Biom never invents a provider TrxID.

## Storage model

Store-terminal model: people, verification logs and transactions are stored **on the
terminal device** in IndexedDB (localStorage fallback). Enroll and verify on the same
store device.

## Run / deploy

Static site, no build step:

- Local: `python3 -m http.server 8000` then open `http://localhost:8000`
  (camera needs HTTPS or localhost).
- Vercel: import this repository as a static project (framework: Other, no build command).

## PWA

`manifest.webmanifest` + `sw.js` (app-shell cache only; the model and the
vendored runtimes under `models/` and `vendor/` are network-only and are
never cached). Install via the **Install App** button, Chrome's *Install
app / Add to Home screen*, or iPhone Safari *Share → Add to Home Screen*.

## Security posture (v64, 2026-11-25)

What the current build (palm-only: EDCC competitive coding fused with the
PalmNet neural leg; the face/fingerprint sections above describe retired
experiments) actually does — and, just as important, what it does not claim:

| Property | Status in this build |
|---|---|
| Template protection at rest | Palm codes sealed per bank with AES-GCM-256 envelope encryption (v61), keys derived per Biom ID from an on-device vault key |
| Matching location | On-device only; the server stores sealed codes + scan records, never palm images |
| Model integrity | The PalmNet model's SHA-256 and byte length are pinned in app code and verified on every load, on both loader paths; a context without SubtleCrypto fails soft to EDCC-only rather than load unverified bytes |
| Third-party code | None at runtime: MediaPipe Hands and ONNX Runtime Web are self-hosted under `vendor/`; the page's CSP (meta-delivered) allows scripts from `'self'` only and pins `connect-src` to the TSG Biom API |
| Sync authentication | Per-device credentials, HMAC-signed writes with a strictly-next sequence, compare-and-swap bank versions, server-enforced rate limits, auth lockouts and revocation (API v62+) |
| ISO/IEC 24745 template protection | **NOT claimed.** The envelope gives encryption at rest, not the standard's irreversibility, unlinkability or revocability properties |
| Vein sensing | **NOT claimed** — physically impossible on a phone RGB camera; BIOM reads palm print + geometry only |
| Platform header limits | GitHub Pages cannot send response headers: the CSP rides in a meta tag, so `frame-ancestors`, CSP reporting, HSTS and Permissions-Policy are absent on this host (the API sends the full set from code) |

Run the full proof with `npm test` (all suites + the www/ drift check).

## Tests

```bash
bun tests/biometrics.test.js   # or: node tests/biometrics.test.js
```

Covers face/palm/fingerprint matching (identical passes, different denied, blank/null
fails honestly) and wallet normalisation/masking.
