#!/usr/bin/env node
// Checks a converted book and zips it for upload.
//
//   node reader/tools/pack.mjs <book-dir> [out-dir]
//
// <book-dir> holds book.json and, optionally, assets/ (cover and images).
// Writes <out-dir>/<id>.book.zip - out-dir defaults to reader/books/, which
// is gitignored. Keep the book itself OUT of this repo: it is public.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBook, listAssets, packBook } from "./bundle.mjs";

const [dir, outArg] = process.argv.slice(2);
if (!dir) {
  console.error("uso: node reader/tools/pack.mjs <carpeta-del-libro> [carpeta-de-salida]");
  process.exit(2);
}

let book;
try {
  book = JSON.parse(readFileSync(join(dir, "book.json"), "utf8"));
} catch (e) {
  console.error(`No se puede leer ${join(dir, "book.json")}: ${e.message}`);
  process.exit(1);
}

const assets = listAssets(dir);
const errs = checkBook(book);
if (book.cover && !assets.includes(book.cover)) errs.push(`cover «${book.cover}» no existe en ${dir}`);
for (const a of assets) {
  if (!/\.(jpe?g|png|webp|gif|avif)$/i.test(a)) errs.push(`${a}: solo se admiten imágenes jpg, png, webp, gif o avif`);
}
if (errs.length) {
  console.error(`book.json tiene ${errs.length} problema(s):\n  - ${errs.join("\n  - ")}`);
  process.exit(1);
}

const outDir = resolve(outArg || join(dirname(fileURLToPath(import.meta.url)), "..", "books"));
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `${book.id}.book.zip`);
packBook(book, assets.map(name => ({ name, path: join(dir, name) })), out);

const articles = book.sections.reduce((n, s) => n + s.articles.length, 0);
console.log(`${out}\n  «${book.title}»: ${book.sections.length} secciones, ${articles} artículos, ${assets.length} imágenes`);
