/* TSG BIOM v93 — DEEP OCEAN, LIGHT MODE (the Chairman's pick,
   2026-11-28: the Deep Ocean Glass board — "like this one, but
   light background. Light mode actually. Not dark."). The board's
   language — a glowing royal-blue capsule hero, luminous-rimmed
   glass tiles, glowing accents — rebuilt on the v92 light aurora:
   the field brightens, the hero capsule gains a luminous rim and
   a blue aura, tiles/buttons/nav gain the glow, and the loyalty
   chip takes the board's teal tint. Structure, data and scan
   surfaces are untouched; camera surfaces still carry no blur. */
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
const at = cssSrc.indexOf('v93 — DEEP OCEAN, LIGHT MODE');
const oc = at === -1 ? '' : cssSrc.slice(at);

check('OC the v93 layer exists in styles.css', at !== -1);
check('OC the field stays LIGHT (ice base #EDF4FE → #EFF7FE, never a dark theme)',
  oc.indexOf('#EDF4FE') !== -1 && oc.indexOf('#EFF7FE') !== -1);
check('OC the light aurora is brighter than v92 (blue orb .55, violet .42, teal .36)',
  oc.indexOf('rgba(55,129,252,.55)') !== -1 && oc.indexOf('rgba(139,124,255,.42)') !== -1 &&
  oc.indexOf('rgba(45,212,191,.36)') !== -1);
check('OC the hero capsule glows (luminous rim rgba(147,197,253,.95) + blue aura 0 0 44px)',
  oc.indexOf('.balcard{border:1px solid rgba(147,197,253,.95)') !== -1 &&
  oc.indexOf('0 0 44px rgba(55,129,252,.50)') !== -1);
check('OC glass tiles carry a faint blue aura (0 0 26px at .13) over the v92 shadow stack',
  oc.indexOf('0 0 26px rgba(55,129,252,.13)') !== -1);
check('OC tile icons glow (drop-shadow in the board blue)',
  oc.indexOf('.qa-tile svg{filter:drop-shadow(0 0 6px rgba(55,129,252,.55))}') !== -1);
check('OC the gel primary and the active nav capsule carry the glow',
  oc.indexOf('0 0 30px rgba(25,81,252,.45)') !== -1 && oc.indexOf('0 0 22px rgba(55,129,252,.50)') !== -1);
check('OC the loyalty chip takes the board teal tint + glow',
  oc.indexOf('.balpoints{border:1px solid rgba(94,234,212,.65)') !== -1 &&
  oc.indexOf('0 0 18px rgba(45,212,191,.35)') !== -1);
check('OC the role-page hero carries the same capsule glow as the balance hero',
  oc.indexOf('.rolehero{border:1px solid rgba(147,197,253,.95)') !== -1 &&
  oc.indexOf('0 0 44px rgba(55,129,252,.45)') !== -1);
check('OC scan surfaces stay solid (the v93 layer names no camera/scan selector)',
  oc.indexOf('.camwrap') === -1 && oc.indexOf('#page-terminal') === -1 &&
  oc.indexOf('#page-enroll') === -1 && oc.indexOf('#page-topup') === -1);
check('OC version coherence: app, shell, stamps and chain agree at v94',
  appSrc.indexOf("var APP_DATA_VERSION = 'v94';") !== -1 &&
  swSrc.indexOf("const CACHE = 'tsg-biom-shell-v94';") !== -1 &&
  htmlSrc.indexOf('content="v94"') !== -1 && htmlSrc.indexOf('App v94') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v94' &&
  B.BIOM_DATA_VERSIONS.length === 58);

console.log('\nv93-deep-ocean-light: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
