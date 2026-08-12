import { Navigate, Routes, Route, useParams } from 'react-router-dom';
import { PageShell } from './components/layout/PageShell';
import Landing from './pages/Landing';
import Gracias from './pages/Gracias';
import Planes from './pages/Planes';
import NotFound from './pages/NotFound';

/**
 * La landing de planes se fusionó con la página de sede: ahora todo vive en
 * `/sede/:slug`. Esto mantiene vivos los links viejos a `/precios` (campañas,
 * QR impresos, links compartidos).
 */
function PreciosRedirect() {
  const { slug } = useParams<{ slug: string }>();
  return <Navigate to={`/sede/${slug}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<PageShell />}>
        <Route path="/" element={<Landing />} />
        <Route path="/sede/:slug" element={<Planes />} />
        <Route path="/sede/:slug/precios" element={<PreciosRedirect />} />
        <Route path="/gracias" element={<Gracias />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
