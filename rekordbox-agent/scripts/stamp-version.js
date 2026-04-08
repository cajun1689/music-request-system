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

// Verify preload.js was copied (it's plain JS, not compiled by tsc)
const preloadPath = path.join(__dirname, "..", "dist", "main", "preload.js");
if (fs.existsSync(preloadPath)) {
  const content = fs.readFileSync(preloadPath, "utf8");
  if (content.includes("contextBridge")) {
    console.log("Verified preload.js at", preloadPath);
  } else {
    console.error("WARNING: preload.js does not contain contextBridge!");
  }
} else {
  console.error("ERROR: preload.js not found at", preloadPath);
}
