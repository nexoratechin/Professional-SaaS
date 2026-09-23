/**
 * Dependency-free barcode/QR rendering for library copies.
 *
 *  - Code128-B SVG data URL: the classic 1D Code128 implementation (start code B, check digit,
 *    stop code) rendered as <rect> bars. No external package, browser-free, and scannable with a
 *    USB/bullet scanner or the in-app `<EntitlementRoute entitlement="library.barcode">` flow.
 *  - QR data URL via the already-present `qrcode` dependency (same package the certificate
 *    engine uses) — the QR payload embeds `LIB:<tenantId>:<barcode>` so it can also serve as a
 *    printed shelf/copy QR.
 */

import QRCode from 'qrcode';

/**
 * Bar/space module widths for Code128 codes 0..106, packed as digits aabbcc (bar, space, bar,
 * ...). Index 104 = CODE-B start, 105 = CODE-A start, 106 = STOP (7 modules).
 */
const CODE128_PATTERNS = [
  0x212222, 0x222122, 0x222221, 0x121223, 0x121322, 0x131222, 0x122213, 0x122312, 0x132212, 0x221213,
  0x221312, 0x231212, 0x112232, 0x122132, 0x122231, 0x113222, 0x123122, 0x123221, 0x223211, 0x221132,
  0x221231, 0x213212, 0x223112, 0x312131, 0x311222, 0x321122, 0x321221, 0x312212, 0x322112, 0x322211,
  0x212123, 0x212321, 0x232121, 0x111323, 0x131123, 0x131321, 0x112313, 0x132113, 0x132311, 0x211313,
  0x231113, 0x231311, 0x112133, 0x112331, 0x132131, 0x113123, 0x113321, 0x133121, 0x313121, 0x211331,
  0x231131, 0x213113, 0x213311, 0x213131, 0x311123, 0x311321, 0x331121, 0x312113, 0x312311, 0x332111,
  0x314111, 0x221411, 0x431111, 0x111224, 0x111422, 0x121124, 0x121421, 0x141122, 0x141221, 0x112214,
  0x112412, 0x122114, 0x122411, 0x142112, 0x142211, 0x241211, 0x221114, 0x413111, 0x241112, 0x134111,
  0x111242, 0x121142, 0x121241, 0x114212, 0x124112, 0x124211, 0x411212, 0x421112, 0x421211, 0x212141,
  0x214121, 0x412121, 0x111143, 0x111341, 0x131141, 0x114113, 0x114311, 0x411113, 0x411311, 0x113141,
  0x114131, 0x311141, 0x411131, 0x211412, 0x211214, 0x211232, 0x2331112,
] as const;

function patternModules(code: number): number[] {
  const packed = CODE128_PATTERNS[code];
  if (packed === undefined) {
    throw new Error(`Unknown Code128 symbol ${code}.`);
  }
  if (code === 106) {
    return String(packed)
      .split('')
      .map((d) => Number(d));
  }
  return [
    (packed >> 20) & 0xf,
    (packed >> 16) & 0xf,
    (packed >> 12) & 0xf,
    (packed >> 8) & 0xf,
    (packed >> 4) & 0xf,
    packed & 0xf,
  ];
}

/** Code128-B symbol list for printable ASCII (chars 32..127). */
function encodeCode128B(value: string): number[] {
  if (!value) throw new Error('Barcode value must not be empty.');
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 127) {
      throw new Error(`Barcode value contains a non-printable character: ${ch}`);
    }
  }
  const codes = [104];
  let sum = 104;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i) - 32;
    codes.push(ch);
    sum += ch * (i + 1);
  }
  const check = sum % 103;
  codes.push(check, 106);
  return codes;
}

const QUIET_ZONE_MODULES = 10;
const MODULE_WIDTH_PX = 1;

/** Renders a scannable Code128-B barcode.svg as a data URL. */
export function code128SvgDataUrl(value: string, heightPx = 44): string {
  const symbols = encodeCode128B(value);
  let totalModules = QUIET_ZONE_MODULES;
  for (const symbol of symbols) {
    totalModules += symbol === 106 ? 7 : 6;
  }
  totalModules += QUIET_ZONE_MODULES;

  const width = totalModules * MODULE_WIDTH_PX;
  let x = QUIET_ZONE_MODULES * MODULE_WIDTH_PX;
  let drawingBar = true;
  const rects: string[] = [];

  for (const symbol of symbols) {
    for (const widthModules of patternModules(symbol)) {
      const w = widthModules * MODULE_WIDTH_PX;
      if (drawingBar) {
        rects.push(`<rect x="${x}" y="0" width="${w}" height="${heightPx}" fill="black"/>`);
      }
      x += w;
      drawingBar = !drawingBar;
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${heightPx}" viewBox="0 0 ${width} ${heightPx}">` +
    `<rect width="${width}" height="${heightPx}" fill="white"/>` +
    rects.join('') +
    `</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** QR data URL embedding the copy's identity for printed shelf QRs / self-service checkout. */
export async function qrDataUrl(tenantId: string, barcode: string): Promise<string> {
  return QRCode.toDataURL(`LIB:${tenantId}:${barcode}`, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
  });
}