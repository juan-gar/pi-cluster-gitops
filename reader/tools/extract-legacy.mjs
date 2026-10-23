#!/usr/bin/env node
// One-off migration: turns the single-file reader at
// juan-gar.github.io/anos-miedo/reader/ (books inlined as *_SECTIONS
// constants) into one upload-ready zip per book.
//
//   curl -sL https://juan-gar.github.io/anos-miedo/reader/ -o /tmp/lector.html
//   node reader/tools/extract-legacy.mjs /tmp/lector.html [out-dir]
//
// Only the data literals are evaluated - in a bare VM context, with no
// require, process or network - not the page's React code.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { checkBook, packBook } from "./bundle.mjs";

const [src, outArg] = process.argv.slice(2);
if (!src) {
  console.error("uso: node reader/tools/extract-legacy.mjs <index.html> [carpeta-de-salida]");
  process.exit(2);
}
const html = readFileSync(src, "utf8");

// Everything from the first *_SECTIONS constant up to the end of the BOOKS
// array literal, i.e. before its `.map(` post-processing.
const start = html.search(/^const [A-Z_]+_SECTIONS = \[/m);
const booksAt = html.indexOf("const BOOKS = [", start);
const mapAt = html.indexOf("].map(", booksAt);
if (start < 0 || booksAt < 0 || mapAt < 0) {
  console.error("No encuentro las constantes *_SECTIONS / BOOKS: ¿ha cambiado el formato del lector?");
  process.exit(1);
}
const code = html.slice(start, mapAt + 1).replace("const BOOKS = [", "globalThis.BOOKS = [");
const ctx = vm.createContext(Object.create(null));
vm.runInContext(code, ctx, { timeout: 2000 });
const books = ctx.BOOKS;

// The old reader hardcoded the author in its sidebar.
const AUTHOR = "Juan Eslava Galán";

const outDir = resolve(outArg || join(dirname(fileURLToPath(import.meta.url)), "..", "books"));
mkdirSync(outDir, { recursive: true });

let failed = false;
for (const b of books) {
  const book = {
    id: b.id,
    title: b.title,
    ...(b.shortTitle && { shortTitle: b.shortTitle }),
    author: AUTHOR,
    ...(b.part && { part: b.part }),
    // Round-trip through JSON: plain objects, and drops any undefined field.
    sections: JSON.parse(JSON.stringify(b.sections)),
  };
  const errs = checkBook(book);
  if (errs.length) {
    failed = true;
    console.error(`${b.id}: ${errs.length} problema(s):\n  - ${errs.join("\n  - ")}`);
    continue;
  }
  const out = join(outDir, `${book.id}.book.zip`);
  packBook(book, [], out);
  const articles = book.sections.reduce((n, s) => n + s.articles.length, 0);
  console.log(`${out}  «${book.title}»: ${articles} artículos`);
}
process.exit(failed ? 1 : 0);
