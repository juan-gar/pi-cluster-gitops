import { useState } from "react";
import { api } from "./api.js";
import { SANS, SERIF, button } from "./theme.js";

export function Login({ t, onDone }) {
  const [pass, setPass] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(pass);
      onDone();
    } catch (err) {
      setError(err.status === 401 ? "Contraseña incorrecta." : err.message);
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: t.bg, color: t.text,
                  fontFamily: SERIF, padding: 16 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 340 }}>
        <div style={{ fontFamily: SANS, fontSize: "0.68rem", letterSpacing: "0.12em", textTransform: "uppercase",
                      color: t.muted, marginBottom: 8 }}>Lector privado</div>
        <h1 style={{ fontSize: "2rem", margin: "0 0 24px" }}>Biblioteca</h1>
        <label style={{ display: "block", fontFamily: SANS, fontSize: "0.8rem", color: t.muted, marginBottom: 6 }}
               htmlFor="pass">Contraseña</label>
        <input id="pass" type="password" autoComplete="current-password" autoFocus value={pass}
               onChange={e => setPass(e.target.value)}
               style={{ width: "100%", padding: "10px 12px", fontSize: "1rem", borderRadius: 6,
                        border: `1px solid ${t.border}`, background: t.side, color: t.text, marginBottom: 12 }} />
        {error && <div role="alert" style={{ fontFamily: SANS, fontSize: "0.85rem", color: "#B3412E",
                                             marginBottom: 12 }}>{error}</div>}
        <button type="submit" disabled={busy || !pass}
                style={{ ...button(t), width: "100%", padding: "10px", fontSize: "0.95rem", color: t.text,
                         opacity: busy || !pass ? 0.5 : 1 }}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
