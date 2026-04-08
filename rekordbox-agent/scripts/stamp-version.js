const fs = require("fs");
const path = require("path");

const pkg = require("../package.json");
const ver = "v" + pkg.version;

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
