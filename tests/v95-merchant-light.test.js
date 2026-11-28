/* TSG BIOM v95 — MERCHANT TERMINAL, LIGHTEST (the Chairman's
   word, 2026-11-28, on the live v94 build): the merchant
   desktop terminal is "not good at all" — fix it completely,
   and make nothing too dark: the lightest version, light mode.
   The v66-era merchant block painted the terminal page as a
   full-bleed navy slab with a dark card and dark inputs. This
   layer retires that presentation on the merchant face only:
   the page returns to the light aurora, the terminal card is
   light glass with white inputs, and on desktop the card is a
   two-column point-of-sale layout (controls left, scan stage
   right). The owner face's terminal, the camera surfaces and
   every scan rule are untouched. */
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
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const at = cssSrc.indexOf('v95 — MERCHANT TERMINAL');
const ml = at === -1 ? '' : cssSrc.slice(at);
const M = 'body.mode-customer.role-merchant #page-terminal';

check('ML the v95 layer exists in styles.css, after the v94 layer',
  at !== -1 && at > cssSrc.indexOf('v94 — DECLUTTER'));
check('ML the navy slab is retired: the terminal page itself carries no background',
  ml.indexOf(M + '{\n  background:none;margin:0;padding:0;border-radius:0}') !== -1);
check('ML the terminal card joins the light glass system and the inputs go white',
  ml.indexOf(M + ' .card{\n  background:var(--lg-scrim)') !== -1 &&
  ml.indexOf('background:rgba(255,255,255,.88);color:var(--text)') !== -1);
check('ML headings and labels return to ink and muted (no white-on-navy text rules)',
  ml.indexOf(M + ' h1{color:var(--text)}') !== -1 &&
  ml.indexOf(M + ' label{color:var(--muted)}') !== -1 &&
  ml.indexOf('color:#b9cdf2') === -1);
check('ML desktop: the card is a two-column point-of-sale layout (controls 380px, scan stage rest)',
  ml.indexOf('grid-template-columns:380px 1fr') !== -1 &&
  ml.indexOf('.card>.camwrap') !== -1 &&
  ml.indexOf('#termResult{grid-column:2}') !== -1);
check('ML the layer is scoped to the merchant face only (owner terminal untouched)',
  ml.indexOf('body.mode-owner') === -1 && ml.split('role-merchant').length > 8);
check('ML scan surfaces stay solid (no camera styling in the v95 layer)',
  !/camwrap\{|video\{|scanpill\{/.test(ml));
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v95',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v95' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v95'") !== -1 &&
  htmlSrc.indexOf('<meta name="biom-build" content="v95">') !== -1 &&
  htmlSrc.indexOf('TSG Biom · App v95 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v95');
check('CHAIN the migration chain has 59 links and the v95 step is a pure adoption',
  B.BIOM_DATA_VERSIONS.length === 59 &&
  (function () {
    const mig = B.migrateBiomData({ people: [], logs: [], transactions: [], meta: [] }, 'v94', 'v95');
    return mig.appliedSteps.indexOf('v95') !== -1 && mig.changed === false;
  })());

console.log('\nv95-merchant-light: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
