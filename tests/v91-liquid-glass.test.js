/* TSG BIOM v91 — LIQUID GLASS · BIOM BLUE (the Chairman's
   design direction, 2026-11-28: 14 reference images; the colour
   decision — Biom Blue over iridescent — was Muse's, made on
   his order and reported to him the same morning).

   The layer is a TOKEN SYSTEM in the app's own blue ramp
   (#03195B → #0B2CB1 → #1951FC → #3781FC → #CBE9FD, the printed
   hexes of his blue-stack reference), applied as a closing
   layer in styles.css. This suite pins:
   - the ramp tokens + glass tokens exist;
   - the glass lands on the shell surfaces (top bar, balance
     card, tiles, primary buttons, floating nav, consent card);
   - the iridescent colours appear ONLY as faint background
     glow, never as a surface colour;
   - camera/scan surfaces carry NO backdrop-filter (the layer
     never puts blur on the enrol/topup/terminal pages' cards);
   - version coherence at v91. */
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
const glassAt = cssSrc.indexOf('v91 — LIQUID GLASS');
const glass = glassAt === -1 ? '' : cssSrc.slice(glassAt);

check('GLASS the v91 layer exists in styles.css', glassAt !== -1);
check('GLASS the Biom Blue ramp tokens are defined in the ONE :root (the reference hexes; v66 token rule)',
  cssSrc.indexOf('--gb-950:#03195B') !== -1 && cssSrc.indexOf('--gb-800:#0B2CB1') !== -1 &&
  cssSrc.indexOf('--gb-600:#1951FC') !== -1 && cssSrc.indexOf('--gb-500:#3781FC') !== -1 &&
  cssSrc.indexOf('--gb-ice:#CBE9FD') !== -1 &&
  (cssSrc.match(/:root\{/g) || []).length === 1);
check('GLASS the glass material tokens are defined (bg, strong bg, edge, blur)',
  cssSrc.indexOf('--glass-bg:rgba(255,255,255,.66)') !== -1 &&
  cssSrc.indexOf('--glass-bg-strong:rgba(255,255,255,.88)') !== -1 &&
  cssSrc.indexOf('--glass-blur:blur(16px) saturate(1.5)') !== -1);
check('GLASS the balance card is deep-blue glass from the ramp (glossy sheen + gradient)',
  glass.indexOf('linear-gradient(140deg,#0B2CB1 0%, #1951FC 55%, #3781FC 100%)') !== -1 &&
  glass.indexOf('rgba(255,255,255,.38)') !== -1);
check('GLASS primary buttons are glossy blue capsules',
  glass.indexOf('linear-gradient(135deg,#1951FC,#3781FC)') !== -1 &&
  glass.indexOf('.btn{border-radius:var(--radius-pill)') !== -1);
check('GLASS the bottom nav floats as a glass pill',
  glass.indexOf('.nav{left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));border-radius:28px') !== -1);
check('GLASS the top bar is navy glass with a bright edge',
  glass.indexOf('linear-gradient(135deg, rgba(3,25,91,.95)') !== -1);
check('GLASS the iridescent colours are background glow ONLY (faint, at the field level)',
  glass.indexOf('rgba(139,124,255,.20)') !== -1 && glass.indexOf('rgba(45,212,191,.15)') !== -1 &&
  glass.indexOf('#8B7CFF') === -1 && glass.indexOf('#2DD4BF') === -1);
check('GLASS no backdrop blur is scoped onto the enrol / topup / terminal pages',
  glass.indexOf('#page-enroll .card') === -1 && glass.indexOf('#page-topup .card') === -1 &&
  glass.indexOf('#page-terminal .card') === -1 && glass.indexOf('.camwrap') === -1);
check('GLASS text-contrast guard: tiles and buttons sit on the STRONG glass (88% white)',
  glass.indexOf('.qa-tile{background:var(--glass-bg-strong)') !== -1 &&
  glass.indexOf('.btn{border-radius:var(--radius-pill);background:var(--glass-bg-strong)') !== -1);
check('VERSION app, shell, chain and stamps agree at v94',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v94' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v94'") !== -1 &&
  htmlSrc.indexOf('<meta name="biom-build" content="v94">') !== -1 &&
  htmlSrc.indexOf('TSG Biom · App v94 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v94' &&
  B.BIOM_DATA_VERSIONS.length === 58);

console.log('\n' + (fail === 0 ? 'ALL v91 LIQUID-GLASS TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed'));
if (fail) process.exit(1);
