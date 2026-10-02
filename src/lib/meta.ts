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

/** fbclid de la URL de llegada (un anuncio), con el momento en que llegó. */
const FBCLID_STORAGE_KEY = 'clic:fbclid';

/** Datos del cliente para el advanced matching, ya hasheados. */
const DATOS_CLIENTE_STORAGE_KEY = 'clic:metaDatosCliente';

/** Lo que acepta el backend para fbp/fbc. Más largo = basura, no se manda. */
const MAX_LARGO_IDENTIFICADOR = 500;

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
  // Con datos del cliente (los guarda el checkout antes de ir a Mercado Pago),
  // el `init` los lleva como advanced matching: al volver a /gracias el
  // Purchase sale con email y teléfono, y no solo con la cookie.
  const datos = datosClienteGuardados();
  if (datos) {
    window.fbq('init', id, datos);
  } else {
    window.fbq('init', id);
  }
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

// ── Identificadores para la Conversions API ─────────────────────────────────
//
// El Purchase server-side lo manda ClicNet desde el webhook de Mercado Pago,
// que no ve el browser. Para que Meta pueda atribuir la venta al click del
// anuncio, el checkout le pasa al backend las cookies del pixel: `_fbp` (el
// browser) y `_fbc` (el click).

function leerCookie(nombre: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${nombre}=([^;]*)`));
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Guarda el `fbclid` con el que se llegó al sitio. Llamar al arrancar la app,
 * antes de que el router reescriba la URL: el pixel recién arma la cookie
 * `_fbc` en el `init`, que espera el mapa de sedes, y para entonces una
 * redirección ya se pudo llevar el parámetro.
 *
 * localStorage y no sessionStorage: la compra puede llegar días después del
 * click, y Meta le da a `_fbc` 90 días.
 */
export function capturarFbclid(): void {
  try {
    const fbclid = new URLSearchParams(window.location.search).get('fbclid');
    if (!fbclid) return;
    localStorage.setItem(FBCLID_STORAGE_KEY, JSON.stringify({ fbclid, ts: Date.now() }));
  } catch {
    // Storage bloqueado (Safari privado, cookies apagadas): queda la cookie del pixel.
  }
}

function fbcGuardado(): string | undefined {
  try {
    const raw = localStorage.getItem(FBCLID_STORAGE_KEY);
    if (!raw) return undefined;
    const { fbclid, ts } = JSON.parse(raw) as { fbclid?: unknown; ts?: unknown };
    if (typeof fbclid !== 'string' || typeof ts !== 'number') return undefined;
    // Mismo formato que la cookie del pixel: fb.<subdominio>.<creación ms>.<fbclid>
    return `fb.1.${ts}.${fbclid}`;
  } catch {
    return undefined;
  }
}

/**
 * `fbp` y `fbc` para mandarle al backend en el checkout. Lo que no hay, no va.
 * La cookie `_fbc` del pixel manda; el fbclid guardado es el respaldo.
 */
export function identificadoresMeta(): { fbp?: string; fbc?: string } {
  const fbp = leerCookie('_fbp');
  const fbc = leerCookie('_fbc') ?? fbcGuardado();
  const ids: { fbp?: string; fbc?: string } = {};
  if (fbp && fbp.length <= MAX_LARGO_IDENTIFICADOR) ids.fbp = fbp;
  if (fbc && fbc.length <= MAX_LARGO_IDENTIFICADOR) ids.fbc = fbc;
  return ids;
}

// ── Advanced matching ───────────────────────────────────────────────────────
//
// El Purchase lo dispara /gracias, una carga nueva de página al volver de
// Mercado Pago: el formulario ya no está. El checkout deja los datos del
// cliente en sessionStorage (misma pestaña), normalizados como pide Meta y
// hasheados con SHA-256 — nunca en claro —, y `iniciarPixel` los pasa en el
// `init`. El pixel reconoce los valores ya hasheados y no los vuelve a hashear.

type DatosClienteMeta = Partial<Record<'em' | 'ph' | 'fn' | 'ln' | 'country', string>>;

async function sha256(valor: string): Promise<string> {
  const bytes = new TextEncoder().encode(valor);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizarNombre(valor: string): string {
  return valor.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Teléfono en E.164 sin '+', con el 9 de móvil. Mismo criterio que la CAPI del
 * backend (`variantesTelefono` en ClicNet), que manda además la forma sin 9:
 * acá va una sola, la de celular, que es lo que carga la gente.
 */
export function telefonoMeta(telefono: string): string | null {
  let digits = telefono.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('54')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.startsWith('9')) digits = digits.slice(1);
  if (digits.length === 12) {
    for (const largoArea of [2, 3, 4]) {
      if (digits.slice(largoArea, largoArea + 2) === '15') {
        digits = digits.slice(0, largoArea) + digits.slice(largoArea + 2);
        break;
      }
    }
  }
  if (digits.length === 10 && digits.startsWith('15')) digits = `11${digits.slice(2)}`;
  return digits.length === 10 ? `549${digits}` : `54${digits}`;
}

/**
 * Deja los datos del cliente listos para el advanced matching del Purchase.
 * Llamar antes de redirigir a Mercado Pago. Nunca tira: si el browser no
 * puede hashear o guardar, el Purchase sale igual, sin estos datos.
 */
export async function guardarDatosClienteMeta(cliente: {
  email: string;
  telefono: string;
  nombre: string;
  apellido: string;
}): Promise<void> {
  try {
    const datos: DatosClienteMeta = { country: await sha256('ar') };
    const email = cliente.email.trim().toLowerCase();
    if (email) datos.em = await sha256(email);
    const telefono = telefonoMeta(cliente.telefono);
    if (telefono) datos.ph = await sha256(telefono);
    const nombre = normalizarNombre(cliente.nombre);
    if (nombre) datos.fn = await sha256(nombre);
    const apellido = normalizarNombre(cliente.apellido);
    if (apellido) datos.ln = await sha256(apellido);
    sessionStorage.setItem(DATOS_CLIENTE_STORAGE_KEY, JSON.stringify(datos));
  } catch {
    // crypto.subtle sin contexto seguro o storage bloqueado: sin advanced matching.
  }
}

function datosClienteGuardados(): DatosClienteMeta | null {
  try {
    const raw = sessionStorage.getItem(DATOS_CLIENTE_STORAGE_KEY);
    if (!raw) return null;
    const datos = JSON.parse(raw) as DatosClienteMeta;
    return datos && typeof datos === 'object' ? datos : null;
  } catch {
    return null;
  }
}
