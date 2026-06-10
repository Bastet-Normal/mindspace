const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "dist", "mobile-web");

const files = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "favicon.ico"
];

const directories = [
  "assets",
  "css",
  "js"
];

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(outputDir, file));
}

for (const directory of directories) {
  fs.cpSync(path.join(root, directory), path.join(outputDir, directory), {
    recursive: true,
    force: true
  });
}

console.log(`Prepared Capacitor web assets in ${path.relative(root, outputDir)}`);
