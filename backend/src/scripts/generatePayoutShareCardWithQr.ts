import fs from "node:fs/promises";
import path from "node:path";
import { generateShareCardImageBuffer } from "../lib/generate-share-card/generateShareCardImageBuffer";

const projectRoot = path.resolve(__dirname, "../../..");
const outputPath = path.resolve(
  projectRoot,
  "backend/payout-share-card-with-qr.png"
);

async function generateShareCard() {
  const finalBuffer = await generateShareCardImageBuffer({
    qrURLCode: "https://example.com/payout/qr-demo",
    amountLabel: "$2,000.23",
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, finalBuffer);

  console.log(`Created payout share card with QR at ${outputPath}`);
}

void generateShareCard().catch((error) => {
  console.error("Failed to generate payout share card with QR", error);
  process.exitCode = 1;
});
