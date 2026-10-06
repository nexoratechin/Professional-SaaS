/**
 * Minimal, dependency-free XLSX (Office Open XML) reader/writer.
 *
 * An .xlsx file is a ZIP archive of XML parts. Rather than pull in a large third-party
 * spreadsheet library, this module implements just enough:
 *   - a ZIP reader/writer (stored or DEFLATE, via Node's built-in zlib),
 *   - `xl/sharedStrings.xml` + worksheet cell parsing for reads,
 *   - inline-string worksheet generation for writes.
 *
 * It is deliberately small and strict: it handles the single-sheet, string/number/boolean
 * cell model the bulk import/export system needs, and it never evaluates formulas (a formula
 * cell comes through as its cached `<v>` value, or blank).
 */
import { deflateRawSync, inflateRawSync } from 'zlib';

// ── CRC-32 (required by the ZIP format) ───────────────────────────────────────

const CRC_TABLE: number[] = (() => {
  const table: number[] = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── ZIP ───────────────────────────────────────────────────────────────────────

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function findEndOfCentralDirectory(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 65_557);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('Not a valid XLSX/ZIP file (end-of-central-directory record not found).');
}

/** Extracts every entry of a ZIP archive into a name → uncompressed Buffer map. */
export function unzip(buffer: Buffer): Map<string, Buffer> {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();

  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw new Error('Corrupt XLSX: bad central directory entry.');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);
    offset += 46 + fileNameLength + extraLength + commentLength;

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIG) continue;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
  }

  return entries;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Builds a DEFLATE-compressed ZIP archive from the given entries. */
export function zip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    localParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

export function encodeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? '';
  let index = 0;
  for (const ch of letters) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = siRegex.exec(xml)) !== null) {
    const inner = match[1]!;
    let text = '';
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(inner)) !== null) {
      text += decodeXml(tMatch[1]!);
    }
    strings.push(text);
  }
  return strings;
}

function parseSheet(xml: string, sharedStrings: string[]): string[][] {
  const grid: string[][] = [];
  const rowRegex = /<row\b([^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rowMatch: RegExpExecArray | null;
  let rowIndex = 0;

  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const attrs = rowMatch[1] ?? '';
    const body = rowMatch[2] ?? '';
    const explicitIndex = attrs.match(/\br="(\d+)"/)?.[1];
    if (explicitIndex) rowIndex = parseInt(explicitIndex, 10) - 1;

    const cells: string[] = [];
    const cellRegex = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(body)) !== null) {
      const cellAttrs = cellMatch[1] ?? '';
      const cellBody = cellMatch[2] ?? '';
      const ref = cellAttrs.match(/\br="([A-Z]+\d+)"/)?.[1] ?? '';
      const type = cellAttrs.match(/\bt="([^"]+)"/)?.[1] ?? 'n';
      const col = ref ? columnIndex(ref) : cells.length;

      let value = '';
      if (type === 's') {
        const v = cellBody.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        value = v !== undefined ? (sharedStrings[parseInt(v, 10)] ?? '') : '';
      } else if (type === 'inlineStr') {
        const t = cellBody.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1];
        value = t !== undefined ? decodeXml(t) : '';
      } else if (type === 'b') {
        const v = cellBody.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        value = v === '1' ? 'true' : 'false';
      } else {
        const v = cellBody.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        value = v !== undefined ? decodeXml(v) : '';
      }
      cells[col] = value;
    }

    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === undefined) cells[i] = '';
    }
    if (cells.length > 0) grid[rowIndex] = cells;
    rowIndex++;
  }

  // Normalize width so every row has the same number of cells.
  const width = grid.reduce((max, r) => Math.max(max, r?.length ?? 0), 0);
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < width; c++) {
      if (row[c] === undefined) row[c] = '';
    }
  }
  return grid;
}

/** Reads the first worksheet of an .xlsx buffer as a 2D string grid. */
export function readXlsx(buffer: Buffer): string[][] {
  const entries = unzip(buffer);
  const sharedStrings = parseSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8'));

  const sheetName =
    [...entries.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)) ??
    [...entries.keys()].find((name) => /^xl\/worksheets\/.*\.xml$/.test(name));
  if (!sheetName) {
    throw new Error('Not a valid XLSX file (no worksheet found).');
  }
  return parseSheet(entries.get(sheetName)!.toString('utf8'), sharedStrings);
}

function cellXml(ref: string, value: string): string {
  if (value === '') return `<c r="${ref}"/>`;
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${encodeXml(value)}</t></is></c>`;
}

function columnName(index: number): string {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Writes a 2D grid of strings to a single-sheet .xlsx buffer (all values inline strings/numbers). */
export function writeXlsx(grid: string[][]): Buffer {
  const rowsXml = grid
    .map((row, r) => {
      const cells = row
        .map((value, c) => cellXml(`${columnName(c)}${r + 1}`, value ?? ''))
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') },
  ]);
}
