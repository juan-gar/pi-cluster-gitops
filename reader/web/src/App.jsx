import { useEffect, useState } from "react";
import { api } from "./api.js";
import { prepareBook } from "./book.js";
import { THEMES, SANS, SERIF, button } from "./theme.js";
import { Library } from "./Library.jsx";
import { Login } from "./Login.jsx";
import { Reader } from "./Reader.jsx";

// Rutas por hash: "#" = biblioteca, "#libro" = abrir donde se dejó, "#libro/n" = artículo n.
function readRoute() {
  const [id] = window.location.hash.slice(1).split("/");
  return { bookId: /^[a-z0-9][a-z0-9-]{0,39}$/.test(id) ? id : null };
}

export default function App() {
  const [auth, setAuth] = useState("checking");
  const [route, setRoute] = useState(readRoute);
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const t = dark ? THEMES.dark : THEMES.light;

  useEffect(() => {
    api.session().then(() => setAuth("in")).catch(e => setAuth(e.status === 401 ? "out" : "error"));
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // El fondo de la página sigue al botón Claro/Oscuro, no solo al tema del sistema.
  useEffect(() => {
    document.documentElement.style.background = t.bg;
    document.body.style.background = t.bg;
  }, [t]);

  const onAuthLost = () => setAuth("out");
  const common = { t, dark, setDark, onAuthLost };

  if (auth === "checking") return null;
  if (auth === "error") {
    return <Message t={t} text="No se puede contactar con el servidor." action="Reintentar"
                    onAction={() => window.location.reload()} />;
  }
  if (auth === "out") return <Login t={t} onDone={() => setAuth("in")} />;
  if (route.bookId) return <BookLoader key={route.bookId} id={route.bookId} {...common} />;
  return <Library {...common} />;
}

function BookLoader({ id, onAuthLost, ...rest }) {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let live = true;
    Promise.all([api.book(id), api.progress()])
      .then(([raw, progress]) => {
        if (live) setState({ status: "ready", book: prepareBook(raw), spot: progress.books?.[id] || null });
      })
      .catch(e => {
        if (!live) return;
        if (e.status === 401) onAuthLost();
        else setState({ status: "error", message: e.status === 404 ? "Ese libro no está en la biblioteca." : e.message });
      });
    return () => { live = false; };
  }, [id]);

  if (state.status === "loading") return <Message t={rest.t} text="Abriendo…" />;
  if (state.status === "error") {
    return <Message t={rest.t} text={state.message} action="Volver a la biblioteca"
                    onAction={() => { window.location.hash = ""; }} />;
  }
  return <Reader book={state.book} savedSpot={state.spot} onAuthLost={onAuthLost} {...rest} />;
}

export function Message({ t, text, action, onAction }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: t.bg, color: t.text,
                  fontFamily: SERIF, padding: 16 }}>
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: "1.1rem", color: t.muted, margin: "0 0 16px" }}>{text}</p>
        {action && <button style={{ ...button(t), fontFamily: SANS }} onClick={onAction}>{action}</button>}
      </div>
    </div>
  );
}
