// Paleta del lector original (anos-miedo/reader), sin cambios.
export const THEMES = {
  light: {
    bg: "#FBF8F2", side: "#F2EDE3", border: "#E2DACB", text: "#22201C",
    muted: "#6B645A", hover: "#E9E2D4", caption: "#5E574C", captionBg: "#F2EDE3",
  },
  dark: {
    bg: "#16140F", side: "#1E1B16", border: "#332E26", text: "#ECE6DA",
    muted: "#A39B8D", hover: "#2A261F", caption: "#B9B1A3", captionBg: "#211E18",
  },
};

export const SERIF = "Georgia, 'Libre Baskerville', serif";
export const SANS = "system-ui, sans-serif";

// Color por defecto de una sección que no trae el suyo.
export const DEFAULT_COLOR = "#2F5D7C";

export const button = (t) => ({
  background: "none", border: `1px solid ${t.border}`, color: t.muted, borderRadius: 4,
  padding: "4px 10px", cursor: "pointer", fontSize: "0.8rem", fontFamily: SANS,
  touchAction: "manipulation",
});
