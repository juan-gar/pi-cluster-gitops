import { DEFAULT_COLOR } from "./theme.js";

// Prepara un book.json para el lector: la lista plana de artículos (el índice
// de la URL #libro/n apunta a ella) y las notas de la sección «Notas», si la hay.
// Es el .map que el lector original aplicaba a su constante BOOKS.
export function prepareBook(raw) {
  const sections = raw.sections.map(s => ({ ...s, color: s.color || DEFAULT_COLOR }));
  const all = sections.flatMap(s => s.articles.map(a => ({ section: s, article: a })));
  const notesSection = sections.find(s => s.name === "Notas") || null;
  const notes = {};
  if (notesSection) {
    for (const p of notesSection.articles[0].content.split("\n\n")) {
      const m = p.match(/^\[(\d+)\]\s*(.*)$/s);
      if (m) notes[m[1]] = m[2];
    }
  }
  return { ...raw, sections, all, notesSection, notes };
}
