import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the UI on :5173 and forwards the API to the Go server
// on :8080 (`READER_PASSPHRASE=x READER_DATA_DIR=./data go run .` in reader/).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:8080" },
  },
});
