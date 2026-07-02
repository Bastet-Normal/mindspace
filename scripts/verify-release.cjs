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

function expectNoMatch(relativePath, pattern, description) {
  if (pattern.test(read(relativePath))) {
    failures.push(`${relativePath}: ${description}`);
  }
}

expectMatch("js/version.js", new RegExp(`MINDSPACE_VERSION\\s*=\\s*["']${version.replace(/\./g, "\\.")}["']`), "app version does not match package.json");
expectMatch("index.html", new RegExp(`js/version\\.js\\?v=${version.replace(/\./g, "\\.")}`), "version script cache marker is stale");
expectMatch("index.html", new RegExp(`id="current-app-version">v${version.replace(/\./g, "\\.")}<`), "visible app version is stale");
expectMatch("sw.js", new RegExp(`CACHE_NAME\\s*=\\s*["']mindspace-shell-v${version.replace(/\./g, "\\.")}["']`), "service worker cache version is stale");
expectMatch("android/app/build.gradle", new RegExp(`versionName\\s+["']${version.replace(/\./g, "\\.")}["']`), "Android versionName does not match package.json");
expectMatch("README.md", new RegExp(`当前正式版本：\\*\\*v${version.replace(/\./g, "\\.")}\\*\\*`), "README release version is stale");
expectMatch("android/app/src/main/AndroidManifest.xml", /android:allowBackup="false"/, "Android app data backup must remain disabled");
expectMatch("android/app/src/main/AndroidManifest.xml", /android:dataExtractionRules="@xml\/data_extraction_rules"/, "Android data extraction rules are missing");
expectMatch("android/app/src/main/AndroidManifest.xml", /android:fullBackupContent="@xml\/backup_rules"/, "Android legacy backup rules are missing");
expectMatch("js/config.js", /url:\s*["']\s*["']/, "default Supabase URL must remain empty for public builds");
expectMatch("js/config.js", /anonKey:\s*["']\s*["']/, "default Supabase anon key must remain empty for public builds");
expectNoMatch("js/config.js", /url:\s*["']https:\/\/[a-z0-9-]+\.supabase\.co["']/i, "public builds must not ship a default Supabase project URL");
expectNoMatch("js/config.js", /anonKey:\s*["']eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+["']/, "public builds must not ship a default Supabase anon key");

if (/raw\.githubusercontent\.com|new Audio\(\s*["']https?:\/\//.test(read("js/focus.js"))) {
  failures.push("js/focus.js: focus timer alarm must not depend on remote audio");
}

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
