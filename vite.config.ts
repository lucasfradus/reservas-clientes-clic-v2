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

// La web nueva (repo `web-clicpilates-v2`) sirve este portal por rewrite bajo
// `clicpilates.com/reservar`, para tener un solo dominio y una sola nav. Detrás
// de ese rewrite los assets tienen que pedirse a `/reservar/assets/...` y no a
// la raíz del dominio. El deploy de la web nueva buildea con
// VITE_BASE_PATH=/reservar/; el deploy actual, sin la variable, no cambia.
const base = process.env.VITE_BASE_PATH || '/'

export default defineConfig({
  base,
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
