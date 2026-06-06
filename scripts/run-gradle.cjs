const { spawnSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const androidDir = path.join(root, "android");
const gradleCommand = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/run-gradle.cjs <gradle-task...>");
  process.exit(1);
}

const result = spawnSync(gradleCommand, args, {
  cwd: androidDir,
  stdio: "inherit",
  shell: process.platform === "win32"
});

process.exit(result.status ?? 1);
