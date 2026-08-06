import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';
import { initAnalytics, trackPageView } from '../../lib/analytics';
import {
  initMetaPixels,
  recordarSede,
  slugDeRuta,
  trackMetaPageView,
} from '../../lib/meta';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

function AnalyticsTracker() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    initAnalytics();
    initMetaPixels();
  }, []);

  useEffect(() => {
    trackPageView(pathname + search);

    // Meta: el PageView de TODAS las pantallas sale de acá, incluida la
    // primera (index.html ya no dispara nada). Va al pixel de la sede; en la
    // landing, que no tiene sede, a todos los pixels.
    const slug = slugDeRuta(pathname, search);
    if (slug && /^\/sede\//.test(pathname)) recordarSede(slug);
    trackMetaPageView(slug);
  }, [pathname, search]);

  return null;
}

export function PageShell() {
  return (
    <>
      <ScrollToTop />
      <AnalyticsTracker />
      <Header />
      <main className="page">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
