import { copyFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const sourcePath = path.resolve(
  backendRoot,
  "src/lib/generate-share-card/payout-share-card5.png"
);
const destDir = path.resolve(backendRoot, "dist/lib/generate-share-card");
const destPath = path.join(destDir, "payout-share-card5.png");

async function copyAsset() {
  await access(sourcePath);
  await mkdir(destDir, { recursive: true });
  await copyFile(sourcePath, destPath);
  console.log(`Copied share card asset to ${destPath}`);
}

copyAsset().catch((error) => {
  console.error("Failed to copy share card asset", error);
  process.exitCode = 1;
});
