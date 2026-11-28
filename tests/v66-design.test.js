/* TSG BIOM v66 — DESIGN OVERHAUL (House System v2; the Chairman's
   order, 2026-11-25 ~22:47; team record:
   ~/workspace/tsg-biom-team/V66-DESIGN-RESEARCH-2026-11-25.md §B/§C).

   v66 is presentation only: one blue token system replaces the
   teal/blue split, the shell adapts per form (bottom tab bar
   <1024px, 248px sidebar >=1024px), wallet home gains a two-pane
   desktop composition, Activity becomes list–detail on desktop,
   the money flows present as centred sheets on desktop, enrolment
   splits on desktop, and the owner face runs at compact density.
   No flow, step order, bar, model pin, guard, strict-money site,
   encryption, signing or honest copy changes.

   This suite pins those properties against the shipped files. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

/* ---------- token singularity (House System v2, §B.1) ------------- */
check('TOKENS exactly one :root block carries the whole token system',
  (css.match(/:root\s*\{/g) || []).length === 1, 'roots=' + (css.match(/:root\s*\{/g) || []).length);
check('TOKENS the teal family is deleted (no --teal token, no teal hexes, no teal-tinted shadows)',
  css.indexOf('--teal') === -1 && css.indexOf('#075e55') === -1 && css.indexOf('#054a43') === -1 &&
  css.indexOf('#0b7a6e') === -1 && css.indexOf('rgba(6,60,54') === -1 && css.indexOf('rgba(7,94,85') === -1);
check('TOKENS the blue ramp is seeded from the dashboard (950..600, primary #0b4ea2 lineage)',
  css.indexOf('--blue-950:#071c3f') !== -1 && css.indexOf('--blue-900:#0a2a5e') !== -1 &&
  css.indexOf('--blue-800:#0b3d91') !== -1 && css.indexOf('--blue-600:#1663d9') !== -1 &&
  css.indexOf('--blue:#0b4ea2') !== -1 && css.indexOf('--blue-dark:#083a7c') !== -1);
check('TOKENS neutrals are the House neutrals (off-white bg, white cards, ink #12233f)',
  css.indexOf('--bg:#f2f5fb') !== -1 && css.indexOf('--surface:#ffffff') !== -1 && css.indexOf('--text:#12233f') !== -1);
check('TOKENS --muted keeps the v64 AA discipline (dashboard ink-soft #43536e, >=4.5:1 on --bg)',
  css.indexOf('--muted:#43536e') !== -1);
check('TOKENS the type scale is present (Display 40/32, Title 24/20, Heading 17/15, Body 15/14, Caption 12.5, Micro 11.5)',
  ['--fs-display:40px', '--fs-display-sm:32px', '--fs-title:24px', '--fs-title-sm:20px',
   '--fs-heading:17px', '--fs-heading-sm:15px', '--fs-body:15px', '--fs-body-compact:14px',
   '--fs-caption:12.5px', '--fs-micro:11.5px'].every(function (t) { return css.indexOf(t) !== -1; }));
check('TOKENS the numeric style is tabular with tight tracking, applied to balances and amounts',
  css.indexOf('.num{font-variant-numeric:tabular-nums;letter-spacing:-.01em}') !== -1 &&
  css.indexOf('.balcard .balnum') !== -1 && css.indexOf('.amt') !== -1);
check('TOKENS spacing is the 4pt scale and radius is the 12/16/20/28 + pill scale',
  ['--sp-1:4px', '--sp-2:8px', '--sp-3:12px', '--sp-4:16px', '--sp-6:24px', '--sp-8:32px', '--sp-12:48px',
   '--radius-row:12px', '--radius-card-compact:16px', '--radius-card:20px', '--radius-hero:28px', '--radius-pill:999px']
    .every(function (t) { return css.indexOf(t) !== -1; }));
check('TOKENS elevation is borders-first (resting shadow none; L1 hero only; L2 sheets/drawers)',
  css.indexOf('--shadow:none') !== -1 && css.indexOf('--shadow-l1:') !== -1 && css.indexOf('--shadow-l2:') !== -1 &&
  css.indexOf('.balcard{border-radius:var(--radius-hero);box-shadow:var(--shadow-l1)}') !== -1);
check('TOKENS primary money buttons are full-pill; secondary buttons take the row radius',
  css.indexOf('.btn.primary{border-radius:var(--radius-pill)') !== -1 && css.indexOf('.btn{border-radius:var(--radius-row)}') !== -1);
check('TOKENS motion tokens are unchanged from v64',
  css.indexOf('--dur-state:180ms') !== -1 && css.indexOf('--dur-page:300ms') !== -1 && css.indexOf('--ease-std:cubic-bezier(0.2,0,0,1)') !== -1);

/* ---------- density modes ------------------------------------------ */
check('DENSITY comfortable is the default and compact is a token-density switch (owner face)',
  css.indexOf('--density-pad:20px') !== -1 && css.indexOf('--density-row:56px') !== -1 &&
  css.indexOf('body[data-density="compact"]{--density-pad:14px;--density-row:44px') !== -1 &&
  css.indexOf('.card{padding:var(--density-pad)}') !== -1);
check('DENSITY applyFaceChrome publishes the density of the active face',
  appSrc.indexOf("document.body.dataset.density = owner ? 'compact' : 'comfortable'") !== -1);

/* ---------- adaptive shell (§B.2/§B.3) ------------------------------ */
check('SHELL the nav keeps its v63 contract (same #mainNav, buttons, data-page targets)',
  html.indexOf('<nav class="nav" id="mainNav">') !== -1 &&
  ['wallet', 'activity', 'account', 'dashboard', 'enroll', 'terminal', 'registry', 'more']
    .every(function (p) { return html.indexOf('data-page="' + p + '"') !== -1; }));
check('SHELL below 1024px the nav is the fixed bottom tab bar (the base .nav rule)',
  /\.nav\{position:fixed;left:0;right:0;bottom:0/.test(css));
check('SHELL at >=1024px the same nav re-forms as a fixed 248px left sidebar',
  css.indexOf('@media (min-width:1024px)') !== -1 &&
  /\.nav\{left:0;right:auto;top:0;bottom:0;width:248px/.test(css) &&
  css.indexOf('main{margin-left:248px') !== -1);
check('SHELL the sidebar carries a brand block and the owner group pins to its foot in owner mode only',
  css.indexOf('.nav::before{content:"TSG BIOM"') !== -1 &&
  css.indexOf('body.mode-owner .nav button[data-page="dashboard"]{margin-top:auto}') !== -1);
check('SHELL owner destinations reach the sidebar through the existing v63 gating (no new routes)',
  appSrc.indexOf("b.classList.toggle('hidden', !show)") !== -1 &&
  appSrc.indexOf("document.querySelectorAll('#mainNav button')") !== -1);

/* ---------- wallet home + activity (§B.2) ---------------------------- */
check('WALLET desktop wallet home is a two-pane grid over the unchanged DOM',
  css.indexOf('#walletHome{display:grid;grid-template-columns:5fr 7fr') !== -1 &&
  css.indexOf('#wLinkedCard{grid-column:1}') !== -1 && css.indexOf('#wActivityCard{grid-column:2}') !== -1 &&
  html.indexOf('id="wLinkedCard"') !== -1);
check('ACTIVITY the inspector panel exists in the wallet page and is filled from the real ledger entry',
  html.indexOf('id="activityInspector"') !== -1 && html.indexOf('id="activityDetailBody"') !== -1 &&
  appSrc.indexOf('function showActivityDetail(e, me)') !== -1 &&
  appSrc.indexOf('data-act-idx') !== -1 && appSrc.indexOf('<b>Settlement:</b>') !== -1 &&
  appSrc.indexOf('<b>Biom ID:</b>') !== -1 && appSrc.indexOf('<b>Device:</b>') !== -1);
check('ACTIVITY the inspector is desktop-only (mobile keeps the v63 behaviour)',
  appSrc.indexOf("window.matchMedia('(min-width: 1024px)').matches") !== -1);

/* ---------- money flows as desktop sheets (§B.2) ---------------------- */
check('SHEETS a real backdrop element exists and is shown only while a flow is open on the wallet page (v77 mechanism change: body.sheet-open class maintained in app.js replaces the v66 body:has() selectors — same visual rule, no per-mutation style re-test)',
  html.indexOf('id="sheetBackdrop"') !== -1 && html.indexOf('class="sheet-backdrop"') !== -1 &&
  css.indexOf('body.sheet-open .sheet-backdrop') !== -1 &&
  css.indexOf('body:has(#page-wallet.active #walletAdd') === -1 &&
  appSrc.indexOf("classList.toggle('sheet-open'") !== -1 &&
  appSrc.indexOf("'walletAdd'") !== -1 && appSrc.indexOf("'walletSend'") === -1 && appSrc.indexOf("'walletPay'") !== -1);
check('SHEETS Send / Add Money / Biom Pay present as centred 480px modal sheets at >=1024px only',
  css.indexOf('#walletAdd:not(.hidden),#walletSend:not(.hidden),#walletPay:not(.hidden)') !== -1 &&
  css.indexOf('width:min(480px,94vw)') !== -1 && css.indexOf('box-shadow:var(--shadow-l2)') !== -1 &&
  (function () { const i = css.indexOf('#walletAdd:not(.hidden)'); return i > css.indexOf('@media (min-width:1024px)'); })());
check('SHEETS the scan step inside a sheet keeps the full guidance treatment (scan card sheets too)',
  css.indexOf('#walletScanCard:not(.hidden)') !== -1 && html.indexOf('id="wIndHand"') !== -1 &&
  html.indexOf('id="wScanPillText"') !== -1);

/* ---------- enrolment split screen (§B.2) ----------------------------- */
check('ENROL the desktop split screen exists: brand + the three how-it-works lines left, form right',
  html.indexOf('class="enroll-split"') !== -1 && html.indexOf('class="enroll-side"') !== -1 &&
  html.indexOf('class="enroll-main"') !== -1 && css.indexOf('.enroll-split{display:grid;grid-template-columns:340px 1fr') !== -1 &&
  css.indexOf('.enroll-side{display:none}') !== -1);
check('ENROL the side panel lines are the v64 layered copy, verbatim',
  (html.match(/Face a light so your palm is clearly lit/g) || []).length === 2 &&
  (html.match(/There is nothing to line up: the app finds the hand by itself/g) || []).length >= 2 &&
  (html.match(/a photo or a screen is never accepted/g) || []).length >= 2);

/* ---------- owner face (§B.3) ------------------------------------------ */
check('DESK the Desk becomes a console home on desktop (KPI strip over log/actions columns)',
  css.indexOf('#page-dashboard.active{display:grid;grid-template-columns:7fr 5fr') !== -1 &&
  css.indexOf('#page-dashboard>.statsstrip{grid-column:1/-1') !== -1 &&
  css.indexOf('#page-dashboard>.desk-actions{grid-column:2') !== -1);
check('REGISTRY the desktop list–detail pattern is present (row click opens the detail panel) (v77 mechanism change: .detail-open class maintained in app.js replaces the :has() selector)',
  html.indexOf('id="registryDetail"') !== -1 && html.indexOf('id="registryDetailBody"') !== -1 &&
  appSrc.indexOf('function showRegistryDetail(p)') !== -1 &&
  css.indexOf('#page-registry.active.detail-open') !== -1 &&
  css.indexOf('#page-registry.active:has(') === -1 &&
  appSrc.indexOf("classList.toggle('detail-open'") !== -1);
check('REGISTRY grant/revoke in the panel routes through the existing row toggle (behaviour unchanged)',
  appSrc.indexOf("document.querySelector('[data-owner-toggle=\"' + id + '\"]')") !== -1 &&
  html.indexOf('id="registryDetailOwnerBtn"') !== -1);

/* ---------- skeletons per form (F-11) ----------------------------------- */
check('SKELETONS row-shaped skeletons exist for desktop alongside the mobile card skeletons',
  css.indexOf('.skelrow{height:44px') !== -1 && css.indexOf('.skelcard{height:56px') !== -1 &&
  html.indexOf('id="walletProfilesSkeleton"') !== -1);

/* ---------- version + migration (§D.5 / item 9) -------------------------- */
check('VERSION app, shell, user-visible line and chain agree at v95 (v95 named pin change: merchant terminal lightest)',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v95' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v95'") !== -1 &&
  html.indexOf('TSG Biom · App v95 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v95');
check('MIGRATION the v66 step is a pure adoption: a v65 store opens byte-identical',
  (function () {
    const store = {
      people: [{ id: 'TSG-BIO-1', name: 'Rig', phone: '01933038706', type: 'Customer', store: 'HQ',
        loyaltyPoints: 12, wallet: { balance: 450, statement: [{ kind: 'add', amount: 450, ref: 'DEMO-1' }], linkedAccounts: [] },
        palmProfile: { v: 4, format: 'packed96', hand: 'left', codes: ['QUJD'] } }],
      logs: [{ ts: 1 }], transactions: [{ id: 'BIOM-PAY-1' }], meta: []
    };
    const before = JSON.stringify(store);
    const mig = B.migrateBiomData(JSON.parse(before), 'v65', 'v66');
    return mig.appliedSteps.indexOf('v66') !== -1 && mig.changed === false && JSON.stringify(mig.snapshot) === before;
  })());

/* ---------- vercel.json headers (item 11) -------------------------------- */
check('VERCEL the existing manifest + service-worker rules survive',
  vercel.headers.some(function (h) { return h.source === '/manifest.webmanifest'; }) &&
  vercel.headers.some(function (h) { return h.source === '/sw.js'; }));
check('VERCEL the global security headers are added for /(.*)',
  (function () {
    const g = vercel.headers.find(function (h) { return h.source === '/(.*)'; });
    if (!g) return false;
    const map = {};
    g.headers.forEach(function (h) { map[h.key] = h.value; });
    return map['X-Frame-Options'] === 'DENY' && map['Referrer-Policy'] === 'no-referrer' &&
      map['Permissions-Policy'] === 'camera=(self), microphone=(), geolocation=()';
  })());

console.log(fail === 0 ? 'ALL V66 DESIGN TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
