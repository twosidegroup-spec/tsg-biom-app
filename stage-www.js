/* Stage the web app into www/ for Capacitor.
   The site itself is served from the repo root (GitHub Pages), but
   Capacitor requires webDir to be a real folder, so the native build
   copies the runtime files into www/ first. Only files the app loads
   at runtime are staged - no tests, design files or repo tooling. */
const fs = require("fs");
const path = require("path");

const root = __dirname;
const out = path.join(root, "www");
const EXT = new Set([".html", ".js", ".css", ".json", ".png", ".jpg",
                     ".jpeg", ".webp", ".svg", ".ico"]);
const SKIP = new Set(["package.json", "package-lock.json",
                      "capacitor.config.json", "stage-www.js", "vercel.json"]);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let n = 0;
for (const name of fs.readdirSync(root)) {
  const p = path.join(root, name);
  if (!fs.statSync(p).isFile()) continue;
  if (SKIP.has(name) || !EXT.has(path.extname(name).toLowerCase())) continue;
  fs.copyFileSync(p, path.join(out, name));
  n++;
}
console.log("staged " + n + " files into www/");
