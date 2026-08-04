import type {
  CatalogoSede,
  CheckoutPayload,
  CheckoutPlanPayload,
  CheckoutPlanResponse,
  CheckoutResponse,
  Clase,
  HorariosResponse,
  Sede,
} from '../types';

// En dev puede quedar vacío a propósito: las llamadas van a `/api/...`
// same-origin y las resuelve el proxy de Vite (ver vite.config.ts). En el
// build de producción la var es obligatoria y apunta al backend.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

if (!BASE_URL && !import.meta.env.DEV) {
  // Fail loud si falta en un build de producción.
  // eslint-disable-next-line no-console
  console.error('VITE_API_BASE_URL is not defined');
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError('No se pudo conectar con el servidor.', 0);
  }

  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      else if (body?.message) message = body.message;
    } catch {
      /* noop */
    }
    throw new ApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

/**
 * Prisma Decimal fields get serialized as strings in JSON. Normalize them
 * to number | null so the rest of the app can treat `precioPrueba` as a
 * number without repeating this guard everywhere.
 */
function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeSede(
  raw: Sede & { precioPrueba: unknown; fotos?: unknown },
): Sede {
  return {
    ...raw,
    precioPrueba: toNumber(raw.precioPrueba),
    // `fotos` puede faltar en respuestas cacheadas viejas: tratarlo como [].
    fotos: Array.isArray(raw.fotos)
      ? raw.fotos.filter((f): f is string => typeof f === 'string' && f !== '')
      : [],
  };
}

export async function getSedes(): Promise<Sede[]> {
  const raw = await request<
    Array<Sede & { precioPrueba: unknown; fotos?: unknown }>
  >('/api/public/sedes');
  return raw.map(normalizeSede);
}

export function getClases(sedeId: number): Promise<Clase[]> {
  return request<Clase[]>(`/api/public/sedes/${sedeId}/clases`);
}

export function getCatalogo(sede?: string | number): Promise<CatalogoSede[]> {
  const query = sede != null ? `?sede=${encodeURIComponent(sede)}` : '';
  return request<CatalogoSede[]>(`/api/public/catalogo${query}`);
}

export function checkout(payload: CheckoutPayload): Promise<CheckoutResponse> {
  return request<CheckoutResponse>('/api/public/checkout', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Horarios fijables reales para un plan de horario fijo. */
export function getHorarios(
  sedeId: number,
  planId: number,
): Promise<HorariosResponse> {
  return request<HorariosResponse>(
    `/api/public/sedes/${sedeId}/horarios?planId=${planId}`,
  );
}

/** Inicia el checkout de compra de un plan → devuelve el init_point de MP. */
export function checkoutPlan(
  payload: CheckoutPlanPayload,
): Promise<CheckoutPlanResponse> {
  return request<CheckoutPlanResponse>('/api/public/checkout-plan', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
