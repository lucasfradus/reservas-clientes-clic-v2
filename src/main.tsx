import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { capturarFbclid } from './lib/meta';
import './styles/globals.css';

// Antes del primer render: una redirección del router puede llevarse el
// `?fbclid=` del anuncio antes de que el pixel arme la cookie `_fbc`.
capturarFbclid();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* BASE_URL sale del `base` de Vite: '/' en el deploy propio y
        '/reservar/' cuando la web nueva sirve el portal por rewrite. Va sin la
        barra final: con ella, react-router no matchea la URL sin barra
        ('/reservar') y no renderiza nada. */}
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
