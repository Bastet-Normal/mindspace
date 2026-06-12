const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const sourceIcon = path.join(root, "assets", "icon-1024.png");
const resDir = path.join(root, "android", "app", "src", "main", "res");

const densities = [
  ["mipmap-mdpi", 48, 108],
  ["mipmap-hdpi", 72, 162],
  ["mipmap-xhdpi", 96, 216],
  ["mipmap-xxhdpi", 144, 324],
  ["mipmap-xxxhdpi", 192, 432]
];

async function writePng(directory, fileName, size, padding = 0) {
  const dir = path.join(resDir, directory);
  fs.mkdirSync(dir, { recursive: true });

  let image = sharp(sourceIcon).resize(size - padding * 2, size - padding * 2, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  });

  if (padding > 0) {
    image = image.extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    });
  }

  await image.png().toFile(path.join(dir, fileName));
}

async function main() {
  if (!fs.existsSync(sourceIcon)) {
    throw new Error(`Missing source icon: ${sourceIcon}`);
  }

  for (const [directory, launcherSize, foregroundSize] of densities) {
    await writePng(directory, "ic_launcher.png", launcherSize);
    await writePng(directory, "ic_launcher_round.png", launcherSize);
    await writePng(directory, "ic_launcher_foreground.png", foregroundSize, Math.round(foregroundSize * 0.16));
  }

  const valuesDir = path.join(resDir, "values");
  fs.mkdirSync(valuesDir, { recursive: true });
  fs.writeFileSync(
    path.join(valuesDir, "ic_launcher_background.xml"),
    [
      "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
      "<resources>",
      "    <color name=\"ic_launcher_background\">#F5F5F7</color>",
      "</resources>",
      ""
    ].join("\n")
  );

  console.log("Applied MindSpace Android launcher icons.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
