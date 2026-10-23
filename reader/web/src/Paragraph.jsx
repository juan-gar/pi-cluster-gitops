// Marcas de párrafo (ver FORMAT.md): "@foto " = pie de foto, "@anuncio " = anuncio de
// época, "@grito " = línea de diálogo corta, "@fecha " = fecha de escena, "@firma " = firma,
// "@cita " = documento o canción citados, "@sep" = separador; [n] = llamada a nota.
// Portado sin cambios de comportamiento del lector original.
import { SANS } from "./theme.js";

export const MARKERS = ["@foto ", "@anuncio ", "@grito ", "@fecha ", "@firma ", "@cita ", "@sep"];
export const isPlain = (para) => !MARKERS.some(m => para.startsWith(m));

// Convierte las llamadas [n] en superíndices que abren la nota.
function renderInline(text, onNote, color) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (!m) return part;
    return (
      <sup key={i}>
        <a href="#" onClick={e => { e.preventDefault(); onNote(m[1], e.currentTarget); }}
           style={{ color, textDecoration: "none", fontWeight: 700, padding: "0 1px" }}
           title={`Nota ${m[1]}`}>{m[1]}</a>
      </sup>
    );
  });
}

export function Paragraph({ para, dropCap, isNotes, color, t, onNote }) {
  if (para.startsWith("@foto ")) {
    return (
      <figure style={{ margin: "2em 0", padding: "14px 18px", background: t.captionBg,
                       borderLeft: `3px solid ${color}`, borderRadius: 2 }}>
        <div style={{ fontFamily: SANS, fontSize: "0.65em", letterSpacing: "0.12em",
                      textTransform: "uppercase", color, marginBottom: 6 }}>Fotografía</div>
        <figcaption style={{ fontSize: "0.92em", lineHeight: 1.55, color: t.caption }}>
          {para.slice(6)}
        </figcaption>
      </figure>
    );
  }
  if (para.startsWith("@anuncio ")) {
    return (
      <aside style={{ margin: "2em 0", padding: "16px 20px", border: `1px dashed ${t.border}`,
                      textAlign: "center", fontStyle: "italic", color: t.caption, lineHeight: 1.6 }}>
        <div style={{ fontFamily: SANS, fontStyle: "normal", fontSize: "0.65em",
                      letterSpacing: "0.12em", textTransform: "uppercase", color: t.muted, marginBottom: 6 }}>
          Anuncio de la época
        </div>
        {para.slice(9)}
      </aside>
    );
  }
  if (para.startsWith("@grito ")) {
    const lines = para.split("\n").map(l => l.replace(/^@grito /, ""));
    return (
      <div style={{ margin: "0 0 1.2em 1.5em", fontSize: "1.05em", lineHeight: 1.6 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ fontStyle: i % 2 ? "italic" : "normal" }}>{renderInline(l, onNote, color)}</div>
        ))}
      </div>
    );
  }
  if (para.startsWith("@fecha ")) {
    const [first, ...more] = para.slice(7).split("\n");
    return (
      <div style={{ margin: "2.2em 0 1.4em", fontFamily: SANS }}>
        <div style={{ fontSize: "0.8em", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color }}>
          {first}
        </div>
        {more.map((l, i) => (
          <div key={i} style={{ fontSize: "0.8em", color: t.muted, marginTop: 3 }}>{l}</div>
        ))}
      </div>
    );
  }
  if (para.startsWith("@firma ")) {
    const [name, ...more] = para.slice(7).split("\n");
    return (
      <div style={{ textAlign: "right", margin: "1.6em 0 0" }}>
        <div style={{ fontVariant: "small-caps", letterSpacing: "0.06em", fontWeight: 700 }}>{name.toLowerCase()}</div>
        {more.map((l, i) => (
          <div key={i} style={{ fontSize: "0.85em", color: t.muted, fontStyle: "italic" }}>{l}</div>
        ))}
      </div>
    );
  }
  if (para.startsWith("@cita ")) {
    // Documento o canción citados: se conservan los saltos de línea; "→ " alinea a la derecha (firmas).
    const rows = para.slice(6).split("\n");
    return (
      <blockquote style={{ margin: "1.4em 0 1.6em", padding: "4px 0 4px 20px", borderLeft: `2px solid ${t.border}`,
                           fontSize: "0.98em", lineHeight: 1.6, color: t.caption, fontStyle: "italic" }}>
        {rows.map((r, i) => r.startsWith("→ ") ? (
          <div key={i} style={{ textAlign: "right", fontStyle: "normal", fontVariant: "small-caps",
                                letterSpacing: "0.04em", marginTop: 6 }}>{r.slice(2)}</div>
        ) : <div key={i}>{r}</div>)}
      </blockquote>
    );
  }
  if (para.startsWith("@sep")) {
    return <div aria-hidden="true" style={{ textAlign: "center", color: t.muted, letterSpacing: "1em", margin: "2.6em 0" }}>* * *</div>;
  }
  if (isNotes) {
    const m = para.match(/^\[(\d+)\]\s*(.*)$/s);
    // Un párrafo de notas sin número se muestra tal cual en vez de romper la página.
    if (m) {
      return (
        <p style={{ display: "flex", gap: 12, fontSize: "0.98em", lineHeight: 1.65, marginBottom: "1.1em" }}>
          <span style={{ color, fontWeight: 700, minWidth: 18 }}>{m[1]}.</span>
          <span>{m[2]}</span>
        </p>
      );
    }
  }
  return (
    <p style={{ fontSize: "1.05em", lineHeight: 1.75, marginBottom: "1.2em", textIndent: dropCap ? 0 : "1.2em" }}>
      {dropCap ? (
        <>
          <span style={{ float: "left", fontSize: "3.6em", lineHeight: 0.85, padding: "6px 8px 0 0",
                         color, fontWeight: 700 }}>{para[0]}</span>
          {renderInline(para.slice(1), onNote, color)}
        </>
      ) : renderInline(para, onNote, color)}
    </p>
  );
}
