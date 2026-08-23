import fs from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";

const baseCardPath = path.resolve(__dirname, "payout-share-card5.png");

const QR_SIZE = 420;
const QR_PADDING = 24;
const AMOUNT_BADGE_WIDTH = 600;
const AMOUNT_BADGE_HEIGHT = 120;

async function createBrandedQr(url: string) {
  const qrPng = await QRCode.toBuffer(url, {
    errorCorrectionLevel: "H",
    type: "png",
    margin: 2,
    scale: 10,
    color: {
      dark: "#070920",
      light: "#FFFFFFFF",
    },
  });

  return sharp(qrPng).resize(QR_SIZE, QR_SIZE).png().toBuffer();
}

async function createQrPanel(url: string) {
  const qrBuffer = await createBrandedQr(url);
  const panelWidth = QR_SIZE + QR_PADDING * 2;
  const panelHeight = QR_SIZE + QR_PADDING * 2;

  const background = await sharp({
    create: {
      width: panelWidth,
      height: panelHeight,
      channels: 4,
      background: { r: 7, g: 9, b: 32, alpha: 0.85 },
    },
  })
    .png()
    .toBuffer();

  return sharp(background)
    .composite([
      {
        input: qrBuffer,
        top: QR_PADDING,
        left: QR_PADDING,
      },
    ])
    .png()
    .toBuffer();
}

async function createAmountBadge(text: string) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${AMOUNT_BADGE_WIDTH}" height="${AMOUNT_BADGE_HEIGHT}" viewBox="0 0 ${AMOUNT_BADGE_WIDTH} ${AMOUNT_BADGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <text x="0" y="58%" dominant-baseline="middle" text-anchor="left" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="96" font-weight="800" fill="#FFFFFF">${text}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function generateShareCardImageBuffer({
  qrURLCode,
  amountLabel,
}: {
  qrURLCode: string;
  amountLabel: string;
}) {
  await fs.access(baseCardPath);
  const cardBuffer = await sharp(baseCardPath).png().toBuffer();
  const cardMetadata = await sharp(cardBuffer).metadata();

  const panelBuffer = await createQrPanel(qrURLCode);
  const panelMetadata = await sharp(panelBuffer).metadata();
  const badgeBuffer = await createAmountBadge(amountLabel);
  const badgeMetadata = await sharp(badgeBuffer).metadata();

  const cardWidth = cardMetadata.width ?? 1200;
  const cardHeight = cardMetadata.height ?? 630;
  const panelWidth = panelMetadata.width ?? QR_SIZE;
  const panelHeight = panelMetadata.height ?? QR_SIZE;
  const badgeWidth = badgeMetadata.width ?? AMOUNT_BADGE_WIDTH;
  // const badgeHeight = badgeMetadata.height ?? AMOUNT_BADGE_HEIGHT;

  const margin = 64;
  const left = cardWidth - panelWidth - margin;
  const top = cardHeight - panelHeight - margin;
  const badgeLeft = 490;
  const badgeTop = 214;

  const finalBuffer = await sharp(cardBuffer)
    .composite([
      {
        input: panelBuffer,
        left,
        top,
      },
      {
        input: badgeBuffer,
        left: badgeLeft,
        top: badgeTop,
      },
    ])
    .png()
    .toBuffer();

  return finalBuffer;
}
