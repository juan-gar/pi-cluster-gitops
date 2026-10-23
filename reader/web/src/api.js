// Cliente del API del servidor (reader/server.go). Toda escritura lleva la cabecera
// X-Reader: el servidor la exige como defensa frente a peticiones de otros orígenes.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Error ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function call(method, path, body, headers = {}) {
  const res = await fetch(path, {
    method,
    headers: { "X-Reader": "1", ...headers },
    body,
    credentials: "same-origin",
  });
  const data = res.headers.get("Content-Type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

const json = (v) => JSON.stringify(v);
const JSON_TYPE = { "Content-Type": "application/json" };

export const api = {
  session: () => call("GET", "/api/session"),
  login: (passphrase) => call("POST", "/api/login", json({ passphrase }), JSON_TYPE),
  logout: () => call("POST", "/api/logout"),
  books: () => call("GET", "/api/books"),
  book: (id) => call("GET", `/api/books/${encodeURIComponent(id)}`),
  upload: (file, replace) =>
    call("POST", `/api/books${replace ? "?replace=1" : ""}`, file, { "Content-Type": "application/zip" }),
  remove: (id) => call("DELETE", `/api/books/${encodeURIComponent(id)}`),
  progress: () => call("GET", "/api/progress"),
  saveSpot: (id, spot) => call("PUT", `/api/progress/${encodeURIComponent(id)}`, json(spot), JSON_TYPE),
};

export const assetUrl = (id, path) =>
  `/api/books/${encodeURIComponent(id)}/${path.split("/").map(encodeURIComponent).join("/")}`;

// Guardado diferido de la posición de lectura: como mucho una petición cada
// pocos segundos mientras se lee, y una inmediata (keepalive) al cerrar o
// cambiar de pestaña. Si una falla, se reintenta con la siguiente.
export function createSpotSaver(bookId, onSaved, delay = 2000) {
  let pending = null;
  let timer = null;

  const send = (keepalive) => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending) return;
    const spot = pending;
    pending = null;
    fetch(`/api/progress/${encodeURIComponent(bookId)}`, {
      method: "PUT",
      headers: { "X-Reader": "1", ...JSON_TYPE },
      body: json(spot),
      credentials: "same-origin",
      keepalive,
    })
      .then(r => (r.ok ? r.json() : Promise.reject(r)))
      .then(saved => onSaved?.(saved))
      .catch(() => { if (!pending) pending = spot; });
  };

  return {
    queue(spot) {
      pending = spot;
      if (!timer) timer = setTimeout(() => send(false), delay);
    },
    flush() { send(true); },
    cancel() { if (timer) clearTimeout(timer); timer = null; pending = null; },
  };
}
