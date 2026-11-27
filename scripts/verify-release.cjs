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
expectMatch("README.md", new RegExp(`当前版本 \\*\\*v${version.replace(/\./g, "\\.")}\\*\\*`), "README release version is stale");
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

const lock = JSON.parse(read("package-lock.json"));
if (lock.version !== version || lock.packages?.[""]?.version !== version) {
  failures.push("package-lock.json: root versions must match package.json");
}

const workerSource = read("sw.js");
const shellDeclaration = workerSource.match(/const APP_SHELL = (\[[\s\S]*?\]);/);
const optionalFontDeclaration = workerSource.match(/const OPTIONAL_FONT_PATHS = (\[[\s\S]*?\]);/);
const shell = new Set(shellDeclaration ? JSON.parse(shellDeclaration[1]) : []);
const optionalFonts = optionalFontDeclaration ? JSON.parse(optionalFontDeclaration[1]) : [];
const webScope = new URL("https://example.test/mindspace/");
const shellUrls = new Set([...shell].map(entry => new URL(entry, webScope).href));
const optionalFontUrls = new Set(optionalFonts.map(entry => new URL(entry, webScope).href));

function verifyAsset(entry, source, relativeTo = webScope, requiresPrecache = true) {
  const url = new URL(entry, relativeTo);
  if (url.origin !== webScope.origin || !url.pathname.startsWith(webScope.pathname)) return;
  const assetPath = decodeURIComponent(url.pathname.slice(webScope.pathname.length));
  if (!fs.existsSync(path.join(root, assetPath))) {
    failures.push(`${source}: missing local asset ${assetPath}`);
  }
  if (requiresPrecache && !shellUrls.has(url.href)) {
    failures.push(`${source}: ${entry} is missing from the offline shell`);
  }
  if (url.searchParams.has("v") && url.searchParams.get("v") !== version) {
    failures.push(`${source}: ${entry} has an outdated version marker`);
  }
}

for (const entry of shell) verifyAsset(entry, "sw.js");
for (const entry of optionalFonts) verifyAsset(entry, "sw.js", webScope, false);
for (const [, entry] of read("index.html").matchAll(/(?:src|href)=["']((?:assets|css|js)\/[^"']+|favicon\.ico[^"']*|manifest\.webmanifest[^"']*)["']/g)) {
  verifyAsset(entry, "index.html");
}
for (const [, entry] of read("index.html").matchAll(/data-font-source="([^"]+)"/g)) {
  verifyAsset(entry, "index.html", webScope, !optionalFontUrls.has(new URL(entry, webScope).href));
}
for (const stylesheet of shellUrls) {
  const url = new URL(stylesheet);
  if (!url.pathname.endsWith(".css") || url.origin !== webScope.origin ||
      !url.pathname.startsWith(webScope.pathname)) continue;
  const file = decodeURIComponent(url.pathname.slice(webScope.pathname.length));
  if (!fs.existsSync(path.join(root, file))) continue;
  for (const [, entry] of read(file).matchAll(/(?:url\(["']?([^"'()]+)["']?\))/g)) {
    verifyAsset(entry, file, url);
  }
}
const manifest = JSON.parse(read("manifest.webmanifest"));
verifyAsset(manifest.start_url, "manifest.webmanifest");
for (const { src } of manifest.icons) verifyAsset(src, "manifest.webmanifest");
for (const [, entry] of read("js/focus.js").matchAll(/["'](\.\/assets\/sounds\/[^"']+\.mp3)["']/g)) {
  verifyAsset(entry, "js/focus.js", webScope, false);
}

if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== `v${version}`) {
  failures.push(`tag ${process.env.GITHUB_REF_NAME} does not match package version v${version}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Release metadata is consistent for v${version}.`);
