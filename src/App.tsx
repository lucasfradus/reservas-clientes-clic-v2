import { Navigate, Routes, Route, useLocation, useParams } from 'react-router-dom';
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
  // El query string se arrastra: `?tipo=` elige el plan del otro lado, y las
  // UTMs de la campaña que trajo a la persona viajan por acá. Perderlos en el
  // redirect convierte una venta atribuida en una venta directa.
  const { search } = useLocation();
  return <Navigate to={`/sede/${slug}${search}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<PageShell />}>
        <Route path="/" element={<Landing />} />
        <Route path="/sede/:slug" element={<Planes />} />
        <Route path="/sede/:slug/precios" element={<PreciosRedirect />} />
        {/* El sitio viejo reservaba en /reservar/:claseId; acá la clase se elige
            dentro del checkout. El id de clase no dice a qué sede pertenece, así
            que lo único honesto es mandar a elegir sede en vez de un 404. */}
        <Route path="/reservar/:claseId" element={<Navigate to="/" replace />} />
        <Route path="/gracias" element={<Gracias />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
