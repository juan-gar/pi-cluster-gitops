import { useEffect, useRef, useState } from "react";
import { api, assetUrl } from "./api.js";
import { DEFAULT_COLOR, SANS, SERIF, button } from "./theme.js";

// Pantalla de inicio: los libros subidos, dónde se dejó cada uno, y subir o quitar libros.
export function Library({ t, dark, setDark, onAuthLost }) {
  const [books, setBooks] = useState(null);
  const [progress, setProgress] = useState({ books: {} });
  const [notice, setNotice] = useState(null); // { kind: "ok" | "error" | "busy", text }
  const [dialog, setDialog] = useState(null); // { text, confirm, onConfirm }
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);

  const fail = (e) => {
    if (e.status === 401) onAuthLost();
    else setNotice({ kind: "error", text: e.message });
  };

  const load = () =>
    Promise.all([api.books(), api.progress()])
      .then(([b, p]) => { setBooks(b); setProgress(p); })
      .catch(fail);

  useEffect(() => {
    document.title = "Biblioteca";
    load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const upload = async (file, replace = false) => {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) {
      setNotice({ kind: "error", text: `«${file.name}» no es un .zip.` });
      return;
    }
    setNotice({ kind: "busy", text: `Subiendo «${file.name}»…` });
    try {
      const b = await api.upload(file, replace);
      setNotice({ kind: "ok", text: `${replace ? "Reemplazado" : "Añadido"}: «${b.title}».` });
      load();
    } catch (e) {
      if (e.status === 409) {
        setNotice(null);
        setDialog({
          text: `Ya hay un libro con el id «${e.body.id}»: «${e.body.title}». ¿Reemplazarlo? Tu progreso de lectura se conserva.`,
          confirm: "Reemplazar",
          onConfirm: () => upload(file, true),
        });
      } else fail(e);
    }
  };

  const remove = (b) => setDialog({
    text: `¿Quitar «${b.title}» de la biblioteca? También se borra dónde ibas.`,
    confirm: "Quitar",
    onConfirm: async () => {
      try { await api.remove(b.id); setNotice({ kind: "ok", text: `Quitado: «${b.title}».` }); load(); }
      catch (e) { fail(e); }
    },
  });

  const logout = async () => { try { await api.logout(); } finally { onAuthLost(); } };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    upload(e.dataTransfer.files?.[0]);
  };

  const btn = button(t);
  const last = books?.find(b => b.id === progress.last);

  return (
    <div onDragOver={e => { e.preventDefault(); setDragging(true); }}
         onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false); }}
         onDrop={onDrop}
         style={{ minHeight: "100vh", background: t.bg, color: t.text, fontFamily: SERIF, position: "relative" }}>
      <header style={{ position: "sticky", top: 0, zIndex: 5, background: t.bg, borderBottom: `1px solid ${t.border}`,
                       display: "flex", alignItems: "center", gap: 8, padding: "10px 16px" }}>
        <div style={{ flex: 1, fontFamily: SANS, fontSize: "0.8rem", color: t.muted }}>Lector privado</div>
        <button style={{ ...btn, color: t.text }} onClick={() => fileInput.current?.click()}>+ Añadir libro</button>
        <button style={btn} onClick={() => setDark(d => !d)}>{dark ? "☀ Claro" : "☾ Oscuro"}</button>
        <button style={btn} onClick={logout}>Salir</button>
        <input ref={fileInput} type="file" accept=".zip,application/zip" hidden
               onChange={e => { upload(e.target.files?.[0]); e.target.value = ""; }} />
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 16px 80px" }}>
        <h1 style={{ fontSize: "2.2rem", margin: "0 0 6px" }}>Biblioteca</h1>
        <p style={{ fontFamily: SANS, fontSize: "0.85rem", color: t.muted, margin: "0 0 28px" }}>
          {books ? `${books.length} ${books.length === 1 ? "libro" : "libros"}` : "Cargando…"}
        </p>

        {notice && (
          <div role={notice.kind === "error" ? "alert" : "status"}
               style={{ fontFamily: SANS, fontSize: "0.85rem", padding: "10px 14px", borderRadius: 6, marginBottom: 20,
                        display: "flex", gap: 12, alignItems: "center",
                        background: t.side, border: `1px solid ${notice.kind === "error" ? "#B3412E" : t.border}`,
                        color: notice.kind === "error" ? "#B3412E" : t.text }}>
            <span style={{ flex: 1 }}>{notice.text}</span>
            {notice.kind !== "busy" && (
              <button onClick={() => setNotice(null)} aria-label="Cerrar aviso"
                      style={{ background: "none", border: "none", color: t.muted, cursor: "pointer" }}>✕</button>
            )}
          </div>
        )}

        {last && progress.books[last.id] && (
          <a href={`#${last.id}`} style={{ display: "block", textDecoration: "none", color: t.text, marginBottom: 28,
                                           padding: "16px 18px", borderRadius: 8, border: `1px solid ${t.border}`,
                                           background: t.side }}>
            <div style={{ fontFamily: SANS, fontSize: "0.68rem", letterSpacing: "0.12em", textTransform: "uppercase",
                          color: t.muted, marginBottom: 6 }}>Seguir leyendo</div>
            <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{last.title}</div>
            <div style={{ fontSize: "0.95rem", color: t.muted, marginTop: 4, fontStyle: "italic" }}>
              {last.titles[Math.min(progress.books[last.id].idx, last.titles.length - 1)]}
            </div>
          </a>
        )}

        {books && books.length === 0 && (
          <div style={{ border: `1px dashed ${t.border}`, borderRadius: 8, padding: "40px 20px", textAlign: "center",
                        color: t.muted }}>
            <p style={{ margin: "0 0 8px", fontSize: "1.1rem" }}>Aún no hay libros.</p>
            <p style={{ margin: 0, fontFamily: SANS, fontSize: "0.85rem" }}>
              Arrastra aquí un .zip con su book.json, o usa «Añadir libro».
            </p>
          </div>
        )}

        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          {books?.map(b => (
            <BookCard key={b.id} b={b} spot={progress.books[b.id]} t={t} onRemove={() => remove(b)} />
          ))}
        </div>
      </main>

      {dragging && (
        <div style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.35)", display: "grid",
                      placeItems: "center", pointerEvents: "none" }}>
          <div style={{ background: t.bg, color: t.text, padding: "20px 28px", borderRadius: 8, fontFamily: SANS,
                        border: `2px dashed ${t.muted}` }}>Suelta el .zip para añadirlo</div>
        </div>
      )}

      {dialog && <Dialog t={t} {...dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function BookCard({ b, spot, t, onRemove }) {
  const [menu, setMenu] = useState(false);
  const total = b.titles.length;
  const idx = spot ? Math.min(spot.idx, total - 1) : -1;
  const pct = spot ? Math.round(((idx + 1) / total) * 100) : 0;

  return (
    <div style={{ position: "relative", border: `1px solid ${t.border}`, borderRadius: 8, overflow: "hidden",
                  background: t.bg, display: "flex", flexDirection: "column" }}>
      <a href={`#${b.id}`} style={{ textDecoration: "none", color: t.text, flex: 1, display: "flex",
                                    flexDirection: "column" }}>
        {b.cover ? (
          <img src={assetUrl(b.id, b.cover)} alt="" loading="lazy"
               style={{ width: "100%", aspectRatio: "3 / 2", objectFit: "cover", display: "block",
                        borderBottom: `1px solid ${t.border}` }} />
        ) : (
          <div style={{ aspectRatio: "3 / 2", background: t.side, borderBottom: `3px solid ${DEFAULT_COLOR}`,
                        display: "flex", alignItems: "flex-end", padding: 16 }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.2 }}>{b.shortTitle || b.title}</div>
          </div>
        )}
        <div style={{ padding: "14px 16px 16px", flex: 1 }}>
          {(b.author || b.part) && (
            <div style={{ fontFamily: SANS, fontSize: "0.65rem", letterSpacing: "0.1em", textTransform: "uppercase",
                          color: t.muted, marginBottom: 4 }}>
              {[b.author, b.part].filter(Boolean).join(" · ")}
            </div>
          )}
          <div style={{ fontWeight: 700, fontSize: "1rem", lineHeight: 1.25, marginBottom: 10 }}>{b.title}</div>
          <div style={{ fontFamily: SANS, fontSize: "0.75rem", color: t.muted }}>
            {spot ? <>Seguir en: <i>{b.titles[idx]}</i></> : `Sin empezar · ${total} ${total === 1 ? "parte" : "partes"}`}
          </div>
          {spot && (
            <div aria-label={`${pct}% leído`}
                 style={{ height: 3, background: t.border, borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: DEFAULT_COLOR }} />
            </div>
          )}
        </div>
      </a>
      <button aria-label={`Opciones de ${b.title}`} onClick={() => setMenu(m => !m)}
              style={{ position: "absolute", top: 8, right: 8, width: 30, height: 30, borderRadius: 15,
                       border: `1px solid ${t.border}`, background: t.bg, color: t.muted, cursor: "pointer",
                       fontSize: "1rem", lineHeight: 1 }}>⋯</button>
      {menu && (
        <div style={{ position: "absolute", top: 42, right: 8, zIndex: 3, background: t.bg, borderRadius: 6,
                      border: `1px solid ${t.border}`, boxShadow: "0 6px 20px rgba(0,0,0,0.18)", overflow: "hidden" }}>
          <button onClick={() => { setMenu(false); onRemove(); }}
                  style={{ display: "block", padding: "10px 16px", background: "none", border: "none",
                           color: "#B3412E", cursor: "pointer", fontFamily: SANS, fontSize: "0.85rem" }}>
            Quitar de la biblioteca
          </button>
        </div>
      )}
    </div>
  );
}

function Dialog({ t, text, confirm, onConfirm, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.35)",
                                    display: "grid", placeItems: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
           style={{ background: t.bg, color: t.text, borderRadius: 8, padding: "20px 22px", maxWidth: 420,
                    boxShadow: "0 12px 40px rgba(0,0,0,0.3)" }}>
        <p style={{ margin: "0 0 18px", lineHeight: 1.5 }}>{text}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button style={button(t)} onClick={onClose}>Cancelar</button>
          <button autoFocus style={{ ...button(t), color: t.text, borderColor: t.text }}
                  onClick={() => { onClose(); onConfirm(); }}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
