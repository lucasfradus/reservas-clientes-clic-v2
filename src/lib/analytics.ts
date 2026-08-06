// Google Analytics 4 (GA4) — carga diferida y helpers de tracking.
//
// GA se activa SOLO si existe VITE_GA_MEASUREMENT_ID. Sin esa variable
// (por ejemplo en desarrollo) todas las funciones son no-op, así el sitio
// funciona igual sin ensuciar la cuenta de analítica con datos de prueba.

const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

let initialized = false;

/** Inyecta gtag.js y configura GA4. Idempotente: solo corre una vez. */
export function initAnalytics(): void {
  if (initialized || !GA_ID || typeof window === 'undefined') return;
  initialized = true;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  // La firma canónica de gtag empuja el objeto `arguments` a dataLayer.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  // Como es una SPA, enviamos cada page_view a mano al cambiar de ruta.
  window.gtag('config', GA_ID, { send_page_view: false });
}

/** Registra una vista de página (llamar en cada cambio de ruta). */
export function trackPageView(path: string): void {
  if (!GA_ID || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}

/** Registra un evento personalizado (ej: reserva, selección de sede). */
export function trackEvent(
  name: string,
  params: Record<string, unknown> = {},
): void {
  if (!GA_ID || typeof window.gtag !== 'function') return;
  window.gtag('event', name, params);
}

/** Pasos del embudo de venta, con los nombres estándar de ecommerce de GA4. */
export type EventoVenta =
  | 'view_item'
  | 'begin_checkout'
  | 'add_payment_info'
  | 'purchase';

/** Lo que se está comprando: una clase de prueba o un plan. */
export interface ItemVenta {
  /** Nombre visible: la actividad de la clase, o el nombre del plan. */
  nombre: string;
  /**
   * Qué tipo de venta es. Las dos usan `purchase` —ambas son ventas reales—, y
   * esto es lo único que las separa después en los informes y en las campañas.
   */
  categoria: 'Trial' | 'Subscription';
  /** Nombre de la sede (ej: "Lomada Hot"). */
  sede?: string;
  /** Slug de la sede (ej: "lomada-hot"). */
  sedeSlug?: string;
  /** Precio en pesos. Sin precio el evento va sin `value` ni `currency`. */
  precio?: number | null;
}

/**
 * Evento de ecommerce de GA4, con la estructura `items` que esperan los
 * informes de Monetización.
 *
 * La sede viaja DOS veces a propósito: dentro de `items` como `item_category2`
 * y suelta como `sede`. La primera alimenta los informes de ecommerce; la
 * segunda es la que se puede usar como desglose en una exploración de embudo,
 * porque los parámetros de `items` son de ámbito ítem y ahí no se pueden usar.
 */
export function trackVenta(
  evento: EventoVenta,
  item: ItemVenta,
  opciones: { transactionId?: string } = {},
): void {
  if (!GA_ID || typeof window.gtag !== 'function') return;

  const params: Record<string, unknown> = {
    items: [
      {
        item_name: item.nombre,
        item_category: item.categoria,
        ...(item.sede ? { item_category2: item.sede } : {}),
        ...(item.precio != null ? { price: item.precio } : {}),
        quantity: 1,
      },
    ],
  };
  if (item.sede) params.sede = item.sede;
  if (item.sedeSlug) params.sede_slug = item.sedeSlug;
  // `value` y `currency` van juntos o no van: GA4 ignora el importe si le falta
  // la moneda.
  if (item.precio != null) {
    params.value = item.precio;
    params.currency = 'ARS';
  }
  if (opciones.transactionId) params.transaction_id = opciones.transactionId;

  window.gtag('event', evento, params);
}
