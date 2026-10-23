// Shared by pack.mjs and extract-legacy.mjs: a local check of book.json that
// mirrors the server's (reader/book.go) so mistakes show up before uploading,
// and a dependency-free zip writer. The server stays the authority - if the
// two disagree, the server's rules win and this file should be fixed.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const ASSET_RE = /^assets\/[^\\:]+\.(jpe?g|png|webp|gif|avif)$/i;
const BOOK_KEYS = ["id", "title", "shortTitle", "author", "part", "cover", "sections"];
const SECTION_KEYS = ["name", "kicker", "color", "articles"];
const ARTICLE_KEYS = ["title", "kicker", "subtitle", "pages", "content"];

// Returns a list of problems; empty means the book should upload cleanly.
export function checkBook(b) {
  const errs = [];
  const unknown = (obj, keys, where) => {
    for (const k of Object.keys(obj)) if (!keys.includes(k)) errs.push(`${where}: campo desconocido «${k}»`);
  };
  const str = (v) => typeof v === "string" && v.trim() !== "";
  if (!b || typeof b !== "object") return ["book.json no es un objeto"];
  unknown(b, BOOK_KEYS, "libro");
  if (!ID_RE.test(b.id ?? "")) errs.push(`id «${b.id}» no válido: minúsculas, cifras y guiones, hasta 40`);
  if (!str(b.title)) errs.push("falta title");
  if (b.cover !== undefined && !ASSET_RE.test(b.cover)) errs.push(`cover «${b.cover}» debe ser una imagen en assets/`);
  if (!Array.isArray(b.sections) || b.sections.length === 0) errs.push("el libro no tiene secciones");
  (b.sections || []).forEach((s, i) => {
    const where = `sections[${i}]`;
    unknown(s, SECTION_KEYS, where);
    if (!str(s.name)) errs.push(`${where}: falta name`);
    if (s.color !== undefined && !COLOR_RE.test(s.color)) errs.push(`${where}: color «${s.color}» debe ser #RRGGBB`);
    if (!Array.isArray(s.articles) || s.articles.length === 0) errs.push(`${where}: no tiene artículos`);
    (s.articles || []).forEach((a, j) => {
      const w = `${where}.articles[${j}]`;
      unknown(a, ARTICLE_KEYS, w);
      if (!str(a.title)) errs.push(`${w}: falta title`);
      if (!str(a.content)) errs.push(`${w}: falta content`);
      for (const k of ARTICLE_KEYS) if (a[k] !== undefined && typeof a[k] !== "string") errs.push(`${w}.${k} debe ser texto`);
    });
  });
  // Not an error on the server, but the reader then can't open those notes.
  const notes = (b.sections || []).find(s => s.name === "Notas");
  if (notes?.articles?.[0]?.content) {
    const bad = notes.articles[0].content.split("\n\n").filter(p => !/^\[\d+\]\s/.test(p));
    if (bad.length) errs.push(`Notas: ${bad.length} párrafo(s) no empiezan por «[n] »`);
  }
  return errs;
}

// All files under dir/assets, as bundle-relative slash paths.
export function listAssets(dir) {
  const root = join(dir, "assets");
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === ".DS_Store") continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  try { walk(root); } catch (e) { if (e.code !== "ENOENT") throw e; }
  return out;
}

// Minimal zip writer (deflate, no zip64): enough for book bundles, which the
// server caps at 50 MB anyway. files: [{ name, data: Buffer }].
export function writeZip(path, files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);           // version needed
    head.writeUInt16LE(0x0800, 6);       // flags: UTF-8 names
    head.writeUInt16LE(8, 8);            // deflate
    head.writeUInt32LE(0, 10);           // mod time/date
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(0, 28);
    locals.push(head, nameBuf, packed);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);            // version made by
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(0, 12);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(packed.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(path, Buffer.concat([...locals, ...centrals, end]));
}

export function packBook(book, assetFiles, outPath) {
  const files = [{ name: "book.json", data: Buffer.from(JSON.stringify(book, null, 2) + "\n", "utf8") }];
  for (const { name, path } of assetFiles) files.push({ name, data: readFileSync(path) });
  writeZip(outPath, files);
}
