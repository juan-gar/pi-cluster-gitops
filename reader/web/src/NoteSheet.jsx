import { SANS } from "./theme.js";

const SHEET_CSS = `
@keyframes nota-sube { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes nota-fondo { from { opacity: 0; } to { opacity: 1; } }
`;

// Hoja inferior con el texto de una nota: ocupa la mitad baja del lector.
// Se cierra con ✕, pulsando fuera (mitad superior) o con Escape.
export function NoteSheet({ n, text, color, t, scale, onClose }) {
  return (
    <>
      <style>{SHEET_CSS}</style>
      <div onClick={onClose} aria-hidden="true"
           style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(0,0,0,0.18)",
                    animation: "nota-fondo 0.2s ease" }} />
      <section role="dialog" aria-modal="true" aria-label={`Nota ${n}`}
               style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "50%", zIndex: 31,
                        background: t.bg, borderTop: `3px solid ${color}`,
                        boxShadow: "0 -8px 28px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column",
                        animation: "nota-sube 0.25s ease-out" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                         padding: "12px 16px", borderBottom: `1px solid ${t.border}`, flex: "none" }}>
          <span style={{ fontFamily: SANS, fontSize: "0.72rem", fontWeight: 700,
                         letterSpacing: "0.12em", textTransform: "uppercase", color }}>
            Nota {n}
          </span>
          <button onClick={onClose} autoFocus aria-label="Cerrar nota"
                  style={{ background: "none", border: `1px solid ${t.border}`, color: t.muted, borderRadius: 4,
                           width: 32, height: 32, cursor: "pointer", fontSize: "1rem", lineHeight: 1 }}>✕</button>
        </header>
        <div style={{ overflowY: "auto", padding: "20px 22px 28px" }}>
          <p style={{ maxWidth: 680, margin: "0 auto", fontSize: `${1.02 * scale}rem`, lineHeight: 1.7, color: t.text }}>
            {text}
          </p>
        </div>
      </section>
    </>
  );
}
