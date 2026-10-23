import { useEffect, useRef, useState } from "react";
import { api, createSpotSaver } from "./api.js";
import { NoteSheet } from "./NoteSheet.jsx";
import { Paragraph, isPlain } from "./Paragraph.jsx";
import { SANS, SERIF, button } from "./theme.js";

// El tamaño de letra es de cada dispositivo (el móvil y el portátil piden tamaños
// distintos), así que se guarda en este navegador y no en el servidor.
const FONT_KEY = "lector:tamano";
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.6;

const clampIdx = (book, i) => Math.min(Math.max(i | 0, 0), book.all.length - 1);

// Artículo pedido en la URL (#libro/n), si la URL es de este libro y trae número.
function hashIdx(book) {
  const [b, a] = window.location.hash.slice(1).split("/");
  if (b !== book.id || a === undefined || a === "") return null;
  return clampIdx(book, parseInt(a, 10) || 0);
}

// Primer párrafo visible bajo la barra superior del lector.
function firstVisiblePara(pane) {
  const top = pane.getBoundingClientRect().top + 60;
  for (const el of pane.querySelectorAll("[data-p]")) {
    if (el.getBoundingClientRect().bottom > top) return Number(el.dataset.p);
  }
  return 0;
}

function scrollToPara(pane, para) {
  const el = pane.querySelector(`[data-p="${para}"]`);
  if (!el || para === 0) { pane.scrollTop = 0; return; }
  pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top - 70;
}

export function Reader({ book, savedSpot, t, dark, setDark, onAuthLost }) {
  // Posición de este libro tal como la conoce esta pestaña: { idx, para }.
  const spot = useRef(savedSpot ? { idx: clampIdx(book, savedSpot.idx), para: savedSpot.para | 0 } : null);
  // Hora (del servidor) de la última posición conocida, para notar si otro
  // dispositivo ha avanzado mientras esta pestaña estaba en segundo plano.
  const knownAt = useRef(savedSpot?.at || 0);
  const saver = useRef(null);
  if (!saver.current) saver.current = createSpotSaver(book.id, saved => { knownAt.current = saved.at; });

  const [pos, setPos] = useState(() => ({ idx: hashIdx(book) ?? spot.current?.idx ?? 0 }));
  // Se avisa al abrir si se retoma una lectura empezada (y no se ha llegado por un enlace).
  const [resumed, setResumed] = useState(() =>
    hashIdx(book) === null && !!spot.current && (spot.current.idx > 0 || spot.current.para > 0));
  const [elsewhere, setElsewhere] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [fontScale, setFontScale] = useState(() => {
    try { return Math.min(Math.max(Number(localStorage.getItem(FONT_KEY)) || 1, MIN_SCALE), MAX_SCALE); }
    catch (e) { return 1; }
  });
  const [collapsed, setCollapsed] = useState({});
  const [openNote, setOpenNote] = useState(null);

  const idx = pos.idx;
  const { section, article } = book.all[idx];

  useEffect(() => { document.title = book.title; }, [book]);

  useEffect(() => {
    const check = () => {
      const m = window.innerWidth < 800;
      setIsMobile(m);
      setSidebarOpen(!m);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Al cambiar de artículo: si es el que se dejó a medias, vuelve al párrafo guardado.
  useEffect(() => {
    const pane = document.getElementById("reading-pane");
    const para = spot.current && spot.current.idx === idx ? spot.current.para : 0;
    if (pane) scrollToPara(pane, para);
    // Abrir el libro donde ya estaba no es leer: no se envía nada, así un
    // dispositivo que solo mira no pisa lo que se ha leído en otro.
    const unchanged = spot.current && spot.current.idx === idx && spot.current.para === para;
    spot.current = { idx, para };
    if (!unchanged) saver.current.queue({ idx, para });
    setOpenNote(null);
    try { history.replaceState(null, "", `#${book.id}/${idx}`); } catch (e) { /* sin historial */ }
  }, [pos]);

  useEffect(() => {
    if (!resumed) return;
    const timer = setTimeout(() => setResumed(false), 6000);
    return () => clearTimeout(timer);
  }, []);

  // Guarda el párrafo visible mientras se lee (con un pequeño retraso) y al salir.
  useEffect(() => {
    const pane = document.getElementById("reading-pane");
    if (!pane) return;
    let timer = null;
    const save = () => {
      timer = null;
      if (!spot.current || spot.current.idx !== idx) return;
      spot.current.para = firstVisiblePara(pane);
      saver.current.queue({ ...spot.current });
    };
    const onScroll = () => { if (!timer) timer = setTimeout(save, 300); };
    const onLeave = (e) => {
      if (e.type === "visibilitychange" && document.visibilityState !== "hidden") return;
      if (timer) { clearTimeout(timer); save(); }
      saver.current.flush();
    };
    pane.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onLeave);
    return () => {
      // Aquí el DOM ya muestra el artículo nuevo: no se guarda, solo se cancela.
      if (timer) clearTimeout(timer);
      pane.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onLeave);
      document.removeEventListener("visibilitychange", onLeave);
    };
  }, [pos]);

  // Al salir del libro (volver a la biblioteca) se envía lo pendiente.
  useEffect(() => () => saver.current.flush(), []);

  // Al volver a esta pestaña, mira si se ha leído más en otro dispositivo.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      api.progress().then(p => {
        const remote = p.books?.[book.id];
        if (!remote || remote.at <= knownAt.current) return;
        knownAt.current = remote.at;
        const here = spot.current;
        if (!here || remote.idx !== here.idx || Math.abs(remote.para - here.para) > 2) setElsewhere(remote);
      }).catch(e => { if (e.status === 401) onAuthLost(); });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    const onHash = () => { const i = hashIdx(book); if (i !== null && i !== idx) setPos({ idx: i }); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [idx]);

  useEffect(() => {
    if (!openNote) return;
    const onKey = (e) => { if (e.key === "Escape") setOpenNote(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNote]);

  // Cambia el tamaño manteniendo a la vista el párrafo que se estaba leyendo.
  const changeScale = (delta) => {
    const pane = document.getElementById("reading-pane");
    const para = pane ? firstVisiblePara(pane) : 0;
    const next = Math.round(Math.min(Math.max(fontScale + delta, MIN_SCALE), MAX_SCALE) * 10) / 10;
    setFontScale(next);
    try { localStorage.setItem(FONT_KEY, String(next)); } catch (e) { /* sin almacenamiento */ }
    requestAnimationFrame(() => { if (pane) scrollToPara(pane, para); });
  };

  const select = (i) => { setPos({ idx: i }); if (isMobile) setSidebarOpen(false); };
  const restartBook = () => {
    spot.current = { idx: 0, para: 0 };
    saver.current.queue({ idx: 0, para: 0 });
    setResumed(false);
    setPos({ idx: 0 });
    const pane = document.getElementById("reading-pane");
    if (pane) pane.scrollTop = 0;
  };
  const goElsewhere = () => {
    spot.current = { idx: clampIdx(book, elsewhere.idx), para: elsewhere.para };
    setElsewhere(null);
    setResumed(false);
    setPos({ idx: spot.current.idx });
  };
  const toLibrary = () => { saver.current.flush(); window.location.hash = ""; };

  // Abre la nota y, si la llamada quedaría tapada por la hoja, desplaza el texto
  // para dejarla en la mitad superior del lector.
  const goToNote = (n, marker) => {
    if (!book.notes[n]) return;
    setOpenNote(n);
    const pane = document.getElementById("reading-pane");
    if (!pane || !marker) return;
    const paneBox = pane.getBoundingClientRect();
    const y = marker.getBoundingClientRect().top - paneBox.top;
    if (y > paneBox.height * 0.4) {
      pane.scrollBy({ top: y - paneBox.height * 0.25, behavior: "smooth" });
    }
  };

  const isNotes = section === book.notesSection;
  const paras = article.content.split("\n\n");
  const firstPlain = isNotes ? -1 : paras.findIndex(isPlain);
  const words = article.content.replace(/@\w+ ?/g, "").split(/\s+/).length;
  const kicker = article.kicker || section.kicker;
  const btn = button(t);
  const sectionKey = (s, i) => `${i}:${s.name}`;
  const toast = {
    position: "absolute", left: "50%", bottom: 20, transform: "translateX(-50%)",
    zIndex: 25, display: "flex", alignItems: "center", gap: 12, maxWidth: "calc(100% - 32px)",
    background: t.text, color: t.bg, borderRadius: 8, padding: "10px 12px 10px 16px",
    boxShadow: "0 6px 20px rgba(0,0,0,0.25)", fontFamily: SANS, fontSize: "0.85rem",
  };
  const toastBtn = {
    background: "none", border: `1px solid ${t.bg}`, color: t.bg, borderRadius: 4,
    padding: "4px 8px", cursor: "pointer", fontSize: "0.8rem", whiteSpace: "nowrap",
  };
  const toastClose = { background: "none", border: "none", color: t.bg, cursor: "pointer", fontSize: "0.95rem" };

  return (
    <div style={{ display: "flex", height: "100dvh", fontFamily: SERIF,
                  background: t.bg, color: t.text, position: "relative" }}>
      {sidebarOpen && (
        <nav style={{
          width: 280, flex: "none", background: t.side, borderRight: `1px solid ${t.border}`,
          overflowY: "auto", padding: "16px 0 20px",
          ...(isMobile ? { position: "absolute", top: 0, bottom: 0, left: 0, zIndex: 20,
                           boxShadow: "0 0 24px rgba(0,0,0,0.25)" } : {}),
        }}>
          <div style={{ padding: "0 12px 6px" }}>
            <button onClick={toLibrary} style={{ ...btn, border: "none", padding: "4px 6px" }}>← Biblioteca</button>
          </div>
          <div style={{ padding: "6px 18px 14px", borderBottom: `1px solid ${t.border}`, marginBottom: 12 }}>
            {(book.author || book.part) && (
              <div style={{ fontFamily: SANS, fontSize: "0.65rem", letterSpacing: "0.1em",
                            textTransform: "uppercase", color: t.muted, marginBottom: 4 }}>
                {[book.author, book.part].filter(Boolean).join(" · ")}
              </div>
            )}
            <div style={{ fontWeight: 700, fontSize: "1rem", lineHeight: 1.25 }}>{book.title}</div>
          </div>
          {book.sections.map((s, si) => {
            const key = sectionKey(s, si);
            const open = !collapsed[key];
            return (
              <div key={key} style={{ marginBottom: 8 }}>
                <div onClick={() => setCollapsed(p => ({ ...p, [key]: open }))}
                     style={{ padding: "8px 18px", cursor: "pointer", color: s.color, fontWeight: 700,
                              fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.1em",
                              fontFamily: SANS, display: "flex", justifyContent: "space-between" }}>
                  {s.name}<span>{open ? "−" : "+"}</span>
                </div>
                {open && s.articles.map((a, ai) => {
                  const i = book.all.findIndex(x => x.article === a);
                  const active = i === idx;
                  return (
                    <div key={ai} onClick={() => select(i)}
                         style={{ padding: "9px 18px 9px 22px", cursor: "pointer", fontSize: "0.9rem", lineHeight: 1.35,
                                  background: active ? t.hover : "transparent",
                                  borderLeft: `3px solid ${active ? s.color : "transparent"}` }}>
                      {a.kicker ? <span style={{ color: t.muted }}>{a.kicker.replace("Capítulo ", "")}. </span> : null}
                      {a.title}
                      {a.pages && (
                        <div style={{ fontSize: "0.72rem", color: t.muted, marginTop: 3, fontFamily: SANS }}>
                          págs. {a.pages}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </nav>
      )}

      <div style={{ flex: 1, position: "relative", minWidth: 0, display: "flex" }}>
      <main id="reading-pane" style={{ flex: 1, overflowY: "auto" }}
            onClick={() => isMobile && sidebarOpen && setSidebarOpen(false)}>
        <div style={{ position: "sticky", top: 0, zIndex: 10, background: t.bg, borderBottom: `1px solid ${t.border}`,
                      display: "flex", alignItems: "center", gap: 8, padding: "10px 16px" }}>
          <button style={btn} onClick={e => { e.stopPropagation(); setSidebarOpen(o => !o); }}
                  aria-label="Índice">☰</button>
          <div style={{ flex: 1, fontSize: "0.8rem", color: t.muted, fontFamily: SANS,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {book.shortTitle || book.title} · {article.title}
          </div>
          <button style={{ ...btn, opacity: fontScale <= MIN_SCALE ? 0.4 : 1 }} onClick={() => changeScale(-0.1)} disabled={fontScale <= MIN_SCALE}
                  aria-label="Reducir texto">A−</button>
          <button style={{ ...btn, opacity: fontScale >= MAX_SCALE ? 0.4 : 1 }} onClick={() => changeScale(0.1)} disabled={fontScale >= MAX_SCALE}
                  aria-label="Aumentar texto">A+</button>
          <button style={btn} onClick={() => setDark(d => !d)}>{dark ? "☀ Claro" : "☾ Oscuro"}</button>
        </div>

        <article style={{ maxWidth: 680, margin: "0 auto", padding: "40px 22px 80px", fontSize: `${fontScale}rem` }}>
          <div style={{ fontFamily: SANS, fontSize: "0.7rem", color: t.muted, marginBottom: 6, fontStyle: "italic" }}>
            {book.title}
          </div>
          {kicker && (
            <div style={{ color: section.color, fontWeight: 700, fontSize: "0.72rem", textTransform: "uppercase",
                          letterSpacing: "0.12em", marginBottom: 14, fontFamily: SANS }}>
              {kicker}
            </div>
          )}
          <h1 style={{ fontSize: "2.2em", fontWeight: 700, lineHeight: 1.15, margin: "0 0 14px" }}>{article.title}</h1>
          {article.subtitle && (
            <p style={{ fontSize: "1.1em", color: t.muted, margin: "0 0 18px", lineHeight: 1.5, fontStyle: "italic" }}>
              {article.subtitle}
            </p>
          )}
          <div style={{ fontSize: "0.75rem", color: t.muted, fontFamily: SANS, marginBottom: 22 }}>
            {article.pages ? `Págs. ${article.pages} · ` : ""}{Math.max(1, Math.round(words / 220))} min de lectura
          </div>
          <div style={{ borderTop: `3px solid ${section.color}`, marginBottom: 32 }} />

          {paras.map((p, i) => (
            <div key={`${book.id}-${idx}-${i}`} data-p={i}>
              <Paragraph para={p} dropCap={i === firstPlain} isNotes={isNotes}
                         color={section.color} t={t} onNote={goToNote} />
            </div>
          ))}

          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 48,
                        paddingTop: 20, borderTop: `1px solid ${t.border}` }}>
            <button style={{ ...btn, visibility: idx > 0 ? "visible" : "hidden" }} onClick={() => select(idx - 1)}>
              ← {idx > 0 ? book.all[idx - 1].article.title : ""}
            </button>
            {idx < book.all.length - 1 ? (
              <button style={btn} onClick={() => select(idx + 1)}>{book.all[idx + 1].article.title} →</button>
            ) : (
              <button style={btn} onClick={toLibrary}>Volver a la biblioteca →</button>
            )}
          </div>
        </article>
      </main>
      {elsewhere && !openNote ? (
        <div role="status" style={toast}>
          <span>Has avanzado en otro dispositivo: {book.all[clampIdx(book, elsewhere.idx)].article.title}</span>
          <button onClick={goElsewhere} style={toastBtn}>Ir allí</button>
          <button onClick={() => setElsewhere(null)} aria-label="Cerrar aviso" style={toastClose}>✕</button>
        </div>
      ) : resumed && !openNote && (
        <div role="status" style={toast}>
          <span>Continúas donde lo dejaste</span>
          <button onClick={restartBook} style={toastBtn}>Empezar el libro</button>
          <button onClick={() => setResumed(false)} aria-label="Cerrar aviso" style={toastClose}>✕</button>
        </div>
      )}
      {openNote && book.notesSection && (
        <NoteSheet n={openNote} text={book.notes[openNote]} color={book.notesSection.color}
                   t={t} scale={fontScale} onClose={() => setOpenNote(null)} />
      )}
      </div>
    </div>
  );
}
