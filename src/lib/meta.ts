// Meta Pixel — helpers para trackear el embudo en la SPA.
//
// Conviven DOS (o más) pixels en el mismo sitio: el general de la marca y el de
// las franquicias que hacen publicidad con su propia cuenta de Meta, en otro
// Business Manager. Cada sede define el suyo en el backoffice (Sede.metaPixelId,
// que llega por /api/public/sedes); sin pixel propio usa el general.
//
// Por eso NUNCA se usa `fbq('track', ...)`: con varios pixels inicializados eso
// dispara a todos, y una cuenta terminaría viendo las conversiones de la otra.
// Todo sale por `trackSingle`, con el pixel de la sede en la que está el usuario.
// Sin sede a la vista (la landing con todas las sedes) el evento va a todos.
//
// El stub de fbq lo carga index.html; el `init` lo hace este módulo, porque el
// ID general viene por env y el resto depende de la respuesta de la API.

import { getSedesCached } from '../api/client';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/** Pixel de la marca. Sin esta variable el tracking de Meta queda apagado. */
const PIXEL_GENERAL = import.meta.env.VITE_META_PIXEL_ID as string | undefined;

/** Última sede visitada, para las rutas que no llevan el slug en la URL. */
const SLUG_STORAGE_KEY = 'clic:sedeSlug';

/** Si la API no contesta a tiempo, se trackea igual contra el pixel general. */
const TIMEOUT_MAPA_MS = 2000;

/** slug de sede → pixel que le corresponde. */
let mapaPixels: Map<string, string> | null = null;
/** Todos los pixels inicializados (incluye el general). */
const pixelsIniciados = new Set<string>();

let resolucion: Promise<void> | null = null;

function iniciarPixel(id: string): void {
  if (!id || pixelsIniciados.has(id) || !window.fbq) return;
  pixelsIniciados.add(id);
  window.fbq('init', id);
  // El auto-config de Meta manda clicks y form submits a TODOS los pixels
  // inicializados, ignorando trackSingle. Es exactamente la fuga entre cuentas
  // que este módulo evita, así que se apaga.
  window.fbq('set', 'autoConfig', false, id);
}

/**
 * Inicializa los pixels y arma el mapa sede → pixel. Idempotente: la promesa
 * se comparte, así que llamarlo desde varios lados no repite el trabajo.
 *
 * El pixel general arranca de inmediato; los de las sedes cuando llega la API.
 */
export function initMetaPixels(): Promise<void> {
  if (resolucion) return resolucion;

  if (PIXEL_GENERAL) iniciarPixel(PIXEL_GENERAL);

  resolucion = getSedesCached()
    .then((sedes) => {
      const mapa = new Map<string, string>();
      for (const sede of sedes) {
        if (!sede.slug || !sede.metaPixelId) continue;
        mapa.set(sede.slug, sede.metaPixelId);
        iniciarPixel(sede.metaPixelId);
      }
      mapaPixels = mapa;
    })
    .catch(() => {
      // Sin mapa se sigue midiendo contra el pixel general: perder los eventos
      // de todas las sedes porque falló un GET sería peor.
      mapaPixels = new Map();
    });

  return resolucion;
}

/** Espera el mapa, pero no más de `TIMEOUT_MAPA_MS`. */
function esperarMapa(): Promise<void> {
  const listo = initMetaPixels();
  return Promise.race([
    listo,
    new Promise<void>((resolve) => {
      setTimeout(resolve, TIMEOUT_MAPA_MS);
    }),
  ]);
}

/** Deja registrada la sede para las rutas que después no la llevan en la URL. */
export function recordarSede(slug: string): void {
  try {
    sessionStorage.setItem(SLUG_STORAGE_KEY, slug);
  } catch {
    // Safari en modo privado puede tirar acá. No es crítico.
  }
}

function slugGuardado(): string | null {
  try {
    return sessionStorage.getItem(SLUG_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Sede de la pantalla actual, en orden de confiabilidad:
 *   1. `?sedeSlug=` — lo pone el backend en el back_url de Mercado Pago (/gracias)
 *   2. la ruta `/sede/:slug/...`
 *   3. la última sede visitada — cubre `/reservar/:claseId`, que solo tiene el id
 *   4. null → no hay sede (la landing)
 */
export function slugDeRuta(pathname: string, search: string): string | null {
  const desdeQuery = new URLSearchParams(search).get('sedeSlug');
  if (desdeQuery) return desdeQuery;

  const enRuta = pathname.match(/^\/sede\/([^/]+)/);
  if (enRuta) return decodeURIComponent(enRuta[1]);

  return slugGuardado();
}

/**
 * Pixels a los que mandar un evento.
 *
 * Con sede: el de esa sede (o el general, si no tiene uno propio).
 *
 * Sin sede, la regla depende del evento y por eso la decide quien llama:
 *  - PageView (`fanOut`): va a todos. Es la landing con todas las sedes, y cada
 *    cuenta necesita ver el PageView de la pantalla donde cayó su anuncio.
 *  - conversiones: solo el general. Una venta pertenece a UNA cuenta; mandarla
 *    a todas le infla las conversiones a la que no la generó.
 */
function pixelsDestino(slug: string | null | undefined, fanOut: boolean): string[] {
  if (slug) {
    const propio = mapaPixels?.get(slug);
    if (propio) return [propio];
    return PIXEL_GENERAL ? [PIXEL_GENERAL] : [];
  }
  if (fanOut) return [...pixelsIniciados];
  return PIXEL_GENERAL ? [PIXEL_GENERAL] : [];
}

/** PageView de Meta (llamar en cada cambio de ruta de la SPA). */
export function trackMetaPageView(slug?: string | null): void {
  void esperarMapa().then(() => {
    for (const pixel of pixelsDestino(slug, true)) {
      window.fbq?.('trackSingle', pixel, 'PageView');
    }
  });
}

/**
 * Evento estándar de Meta (ViewContent, InitiateCheckout, Purchase, ...).
 *
 * `options` acepta `eventID` para deduplicar contra la Conversions API del
 * backend: si el mismo evento llega por el Pixel y por el servidor con el
 * mismo eventID, Meta lo cuenta una sola vez.
 *
 * `slug` es la sede a la que pertenece el evento. Si no se puede resolver, el
 * evento va al pixel general — nunca a todos (ver `pixelsDestino`).
 */
export function trackMetaEvent(
  name: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
  slug?: string | null,
): void {
  void esperarMapa().then(() => {
    for (const pixel of pixelsDestino(slug, false)) {
      if (options) {
        window.fbq?.('trackSingle', pixel, name, params, options);
      } else {
        window.fbq?.('trackSingle', pixel, name, params);
      }
    }
  });
}
