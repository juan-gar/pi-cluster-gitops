# Book format

A book is a zip with one `book.json` and, optionally, images under
`assets/`. Upload it from **+ Añadir libro** in the library (or drag it onto
the page). The zip may hold the files at its root or inside a single folder.

```
mi-libro.book.zip
├── book.json
└── assets/          optional
    └── cover.jpg
```

This file doubles as the brief for converting a book with Claude Code:
point it at the source (EPUB, PDF, text) and at this file, and ask for a
`book.json` in a working folder **outside this repo**. The repo and the image
are public, so book text must never be committed. Then:

```sh
node reader/tools/pack.mjs ~/libros/mi-libro      # checks, writes reader/books/<id>.book.zip
```

## book.json

```json
{
  "id": "guerra",
  "title": "Una historia de la guerra civil que no va a gustar a nadie",
  "shortTitle": "Una historia de la guerra civil…",
  "author": "Juan Eslava Galán",
  "part": "Primera parte",
  "cover": "assets/cover.jpg",
  "sections": [
    {
      "name": "Capítulos",
      "kicker": "Capítulo",
      "color": "#2F5D7C",
      "articles": [
        {
          "title": "Tambores de guerra",
          "kicker": "Capítulo 1",
          "subtitle": "Julio de 1936: un biplano inglés despega de Croydon…",
          "pages": "7–9",
          "content": "@fecha 11 de julio de 1936\n\nEl periodista español…"
        }
      ]
    }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | `a-z`, `0-9`, `-`; up to 40 characters. The URL and the storage key. Uploading the same id again offers to replace the book and keeps your reading position. |
| `title` | yes | |
| `shortTitle` | no | Used in the reader's top bar. Falls back to `title`. |
| `author`, `part` | no | Shown above the title. |
| `cover` | no | Path to an image in the zip, under `assets/`. |
| `sections[]` | yes, ≥ 1 | Groups in the table of contents. |
| `sections[].name` | yes | A section named exactly **`Notas`** holds the footnotes (see below). |
| `sections[].kicker` | no | Default label above each article's title. |
| `sections[].color` | no | `#RRGGBB`. Accent for the section. |
| `sections[].articles[]` | yes, ≥ 1 | One per chapter or piece. |
| `articles[].title` | yes | |
| `articles[].content` | yes | The text. See below. |
| `articles[].kicker` | no | Overrides the section's kicker, e.g. `Capítulo 12`. |
| `articles[].subtitle` | no | One-line summary under the title. |
| `articles[].pages` | no | Page range in the printed book, e.g. `"7–9"`. |

Unknown fields are rejected. A typo like `subtitel` fails the upload instead
of silently showing nothing.

## content

Paragraphs are separated by a blank line (`\n\n`). The first ordinary
paragraph gets the drop cap. A paragraph starting with a marker is styled
differently:

| Marker | Renders as |
| --- | --- |
| `@fecha 11 de julio de 1936` | Scene date, in small caps in the section colour. Extra lines (`\n`) become a muted subtitle. |
| `@foto Pie de foto…` | Photo caption box (the text of the caption, no image). |
| `@anuncio Texto…` | Period advertisement, a dashed centred box. |
| `@cita Línea 1\nLínea 2\n→ Firma` | Quoted document or song. Keeps line breaks. A line starting with `→ ` is a right-aligned signature. |
| `@grito ¡Línea!\n@grito Respuesta` | Short dialogue or chant lines, alternating roman and italic. |
| `@firma NOMBRE\nCargo` | Signature, right-aligned in small caps. |
| `@sep` | Scene break (`* * *`). |

`[n]` anywhere in the text (e.g. `…en 1939[4].`) is a footnote reference. It
opens note `n` from the `Notas` section.

## Notes

If the book has footnotes, add a last section named `Notas` with one article
whose content is one paragraph per note, each starting with its number:

```
[1] Texto de la primera nota.

[2] Texto de la segunda.
```

## Limits

The zip can be up to 50 MB and 2,000 files, and up to 200 MB once unpacked.
`book.json` can be up to 32 MB. Images can be jpg, png, webp, gif or avif. SVG
is not accepted.
