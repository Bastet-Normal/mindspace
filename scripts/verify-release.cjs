const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const version = packageJson.version;
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function expectMatch(relativePath, pattern, description) {
  if (!pattern.test(read(relativePath))) {
    failures.push(`${relativePath}: ${description}`);
  }
}

expectMatch("js/version.js", new RegExp(`MINDSPACE_VERSION\\s*=\\s*["']${version.replace(/\./g, "\\.")}["']`), "app version does not match package.json");
expectMatch("index.html", new RegExp(`js/version\\.js\\?v=${version.replace(/\./g, "\\.")}`), "version script cache marker is stale");
expectMatch("index.html", new RegExp(`id="current-app-version">v${version.replace(/\./g, "\\.")}<`), "visible app version is stale");
expectMatch("sw.js", new RegExp(`CACHE_NAME\\s*=\\s*["']mindspace-shell-v${version.replace(/\./g, "\\.")}["']`), "service worker cache version is stale");
expectMatch("android/app/build.gradle", new RegExp(`versionName\\s+["']${version.replace(/\./g, "\\.")}["']`), "Android versionName does not match package.json");

for (const duplicate of ["assets/icon.svg", "assets/icon.png", "assets/icon.ico"]) {
  if (fs.existsSync(path.join(root, duplicate))) {
    failures.push(`${duplicate}: redundant icon copy should not be tracked`);
  }
}

for (const relativePath of ["package.json", "index.html", "manifest.webmanifest", "sw.js", "desktop/main.cjs"]) {
  const contents = read(relativePath);
  if (/assets\/icon\.(?:svg|png|ico)/.test(contents)) {
    failures.push(`${relativePath}: references a removed redundant icon`);
  }
}

if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== `v${version}`) {
  failures.push(`tag ${process.env.GITHUB_REF_NAME} does not match package version v${version}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Release metadata is consistent for v${version}.`);
