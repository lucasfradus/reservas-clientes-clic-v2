import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// El API público no envía CORS para `localhost`, así que en dev proxeamos
// `/api` hacia el backend. Este bloque `server` solo aplica a `vite dev` /
// `vite preview`; en el build se ignora. Para que las llamadas caigan en el
// proxy, dejá `VITE_API_BASE_URL` vacío en tu `.env` (el cliente pega a
// `/api/...` same-origin).
//
// Target configurable con `API_PROXY_TARGET`. Default: backend local de Clicnet
// (`http://localhost:3000`). Para pegarle a producción:
//   API_PROXY_TARGET=https://app.clicpilates.com npm run dev
const API_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
