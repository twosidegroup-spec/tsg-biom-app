/* TSG BIOM v76 — RESPONSIVE PASS (the Chairman's screenshot,
   2026-11-26 night: the live app's Welcome screen at desktop
   width renders with the whole column shifted right, a large
   dead area on the left and the header not spanning correctly;
   his order: "take the front end on many devices screen").

   ROOT CAUSE (proven in the 11-width render matrix, see
   V76-RESPONSIVE-REPORT-2026-11-26.md): the layout was sound at
   every width EXCEPT the desktop shell state the Welcome
   screen boots into. applyRoleChrome hides #mainNav on the
   pre-profile role screen (customer face, no role chosen —
   body.mode-customer.role-none), but the v66 >=1024px shell
   rules offset .topbar / main / .footer / .ownerbar by the
   248px sidebar width UNCONDITIONALLY — so that screen kept a
   248px dead strip where no sidebar exists, the header
   started mid-screen and the column sat off centre. Two
   sibling defects in the same rules: past 1428px the column
   hugged the sidebar (margin-right:0 + max-width:1180px) with
   all the slack dead on the right, and the footer — offset
   but never width-capped — centred its text on the wrong
   strip; the desktop money-flow sheets centred on the raw
   viewport instead of the post-sidebar space.

   THE FIX (styles.css only, inside the existing >=1024px
   block): the sidebar offset is scoped to the shell state
   that actually shows the sidebar — body:not(.role-none),
   plus body.mode-owner outright (owner mode always shows the
   nav). While offset, main and the footer share one centred
   column (margin-left grows by half the slack past 1428px),
   and the sheets centre in the post-sidebar space
   (left: calc(50% + 124px)) under the same scoping.

   Evidence: the v76 render matrix (10 screens x 11 widths,
   before/after, ~/workspace/tsg-biom-team/v76-render-matrix/)
   — zero horizontal overflow before and after; after the fix
   the Welcome column is centred at every desktop width and
   the sidebar-state geometry is unchanged below 1428px.

   Frozen rules untouched: EDCC 0.32 / PalmNet 0.5895, banking
   guard, strict money rule, codec freeze, and the v75 boot
   mechanics (splash hold, 6 s bound, one-reload guard, stamped
   assets — the stamps move to ?b=v76 under the standing
   bump-every-release rule). The migration step is a pure
   adoption. */
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
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

/* ---------- version coherence + identity migration -------------- */
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v95',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v95' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v95'") !== -1 &&
  html.indexOf('<meta name="biom-build" content="v95">') !== -1 &&
  html.indexOf('TSG Biom · App v95 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v95');
check('MIGRATION the v76 step is a pure adoption: a v75 store opens byte-identical at v76',
  (function () {
    const before = JSON.stringify({ people: [{ id: 'p1', name: 'Gate', wallet: { balance: 800 } }], logs: [], transactions: [], meta: [] });
    const mig = B.migrateBiomData(JSON.parse(before), 'v75', 'v76');
    return mig.appliedSteps.join(',') === 'v76' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
  })());
check('MIGRATION the whole chain v37->v76 applies 39 steps',
  (function () {
    const mig = B.migrateBiomData({ people: [], logs: [], transactions: [], meta: [] }, 'v37', 'v76');
    return mig.appliedSteps.length === 39 && mig.appliedSteps[mig.appliedSteps.length - 1] === 'v76';
  })());

/* ---------- the shell offset is scoped to the sidebar state ----- */
const desk = css.slice(css.indexOf('@media (min-width:1024px)'));
check('SHELL no unconditional 248px offset remains in the desktop block',
  !/^\s+\.topbar\{margin-left:248px/m.test(desk) &&
  !/^\s+main\{margin-left:248px/m.test(desk) &&
  !/^\s+\.footer\{margin-left:248px/m.test(desk) &&
  !/^\s+\.ownerbar\{margin-left:248px/m.test(desk));
check('SHELL topbar offset applies only while the sidebar is shown (not role-none, or owner)',
  desk.indexOf('body:not(.role-none) .topbar, body.mode-owner .topbar{margin-left:248px;border-radius:0}') !== -1);
check('SHELL ownerbar offset carries the same scoping',
  desk.indexOf('body:not(.role-none) .ownerbar, body.mode-owner .ownerbar{margin-left:248px}') !== -1);
check('SHELL main keeps the v66 pin form under the scoping, with the centring override',
  desk.indexOf('body.mode-owner main{margin-left:248px;margin-right:0;') !== -1 &&
  desk.indexOf('margin-left:max(248px,calc(50vw - 466px))') !== -1);
check('SHELL the footer shares the column: capped at 1180px with the same centred margins',
  (function () {
    const i = desk.indexOf('body.mode-owner .footer{');
    const seg = i === -1 ? '' : desk.slice(i, i + 200);
    return seg.indexOf('max-width:1180px') !== -1 && seg.indexOf('margin-left:max(248px,calc(50vw - 466px))') !== -1;
  })());
check('SHELL the nav still re-forms as the fixed 248px sidebar at >=1024px (v66 form intact)',
  /\.nav\{left:0;right:auto;top:0;bottom:0;width:248px/.test(desk));

/* ---------- sheets centre in the post-sidebar space ------------- */
check('SHEETS the money-flow sheets centre at viewport centre + half the sidebar, same scoping',
  desk.indexOf('body:not(.role-none) #walletAdd:not(.hidden), body.mode-owner #walletAdd:not(.hidden)') !== -1 &&
  desk.indexOf('body:not(.role-none) #walletScanCard:not(.hidden), body.mode-owner #walletScanCard:not(.hidden)') !== -1 &&
  desk.indexOf('left:calc(50% + 124px)') !== -1);
check('SHEETS the base sheet form is untouched (viewport-centred below the sidebar state)',
  desk.indexOf('#walletAdd:not(.hidden),#walletSend:not(.hidden),#walletPay:not(.hidden){') !== -1 &&
  desk.indexOf('width:min(480px,94vw)') !== -1);

/* ---------- the role screen falls back to the centred base ------ */
check('BASE the sub-desktop shell stays the centred base layout (main max-width + auto margins)',
  css.indexOf('main{max-width:1180px;margin:0 auto;padding:20px 16px 130px}') !== -1 &&
  css.indexOf('.rolewrap{max-width:560px;margin:0 auto}') !== -1);
check('BASE the hidden-nav mechanism the scoping keys on is unchanged in app.js',
  appSrc.indexOf("nav.classList.toggle('hidden', !owner && !role)") !== -1 &&
  appSrc.indexOf("document.body.classList.toggle('role-none', !role)") !== -1);

console.log(fail === 0
  ? 'ALL V76 RESPONSIVE TESTS PASSED (' + pass + ')'
  : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
