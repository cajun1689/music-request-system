const fs = require("fs");
const path = require("path");

const pkg = require("../package.json");
const ver = "v" + pkg.version;

// Stamp version into renderer HTML
const htmlPath = path.join(__dirname, "..", "dist", "renderer", "index.html");
let html = fs.readFileSync(htmlPath, "utf8");

html = html.replace(
  '<span id="version-label">v1.0.0</span>',
  `<span id="version-label">${ver}</span>`
);

html = html.replace(
  '<span id="titlebar-version" style="color:var(--text-muted); font-weight:400; margin-left:4px;"></span>',
  `<span id="titlebar-version" style="color:var(--text-muted); font-weight:400; margin-left:4px;">${ver}</span>`
);

fs.writeFileSync(htmlPath, html);
console.log("Stamped version", ver, "into", htmlPath);

// Fix preload.js: TypeScript emits `Object.defineProperty(exports, ...)` which
// crashes in Electron's preload context where `exports` is undefined.
const preloadPath = path.join(__dirname, "..", "dist", "main", "preload.js");
let preload = fs.readFileSync(preloadPath, "utf8");
if (!preload.startsWith("if(typeof exports")) {
  preload = 'if(typeof exports==="undefined"){var exports={}};\n' + preload;
  fs.writeFileSync(preloadPath, preload);
  console.log("Patched exports polyfill into", preloadPath);
}
