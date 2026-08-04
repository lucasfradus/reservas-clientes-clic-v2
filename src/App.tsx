import { Routes, Route } from 'react-router-dom';
import { PageShell } from './components/layout/PageShell';
import Landing from './pages/Landing';
import Sede from './pages/Sede';
import Gracias from './pages/Gracias';
import Planes from './pages/Planes';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route element={<PageShell />}>
        <Route path="/" element={<Landing />} />
        <Route path="/sede/:slug" element={<Sede />} />
        <Route path="/sede/:slug/precios" element={<Planes />} />
        <Route path="/gracias" element={<Gracias />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
