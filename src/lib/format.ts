const TZ = 'America/Argentina/Buenos_Aires';

export function formatPrice(value: number | null | undefined): string {
  if (value == null) return 'Consultar';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDayLong(iso: string): string {
  // "Viernes 18 de abril"
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
  return parts.charAt(0).toUpperCase() + parts.slice(1);
}

export function formatDayShort(iso: string): string {
  // "Vie 18 abr"
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d);
  return parts.replace(/\./g, '').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Etiqueta corta para el selector de día: "Hoy", "Mañana" o "Jue 7".
 * Los dos primeros días se nombran en vez de numerarse porque es lo que
 * la gente busca primero.
 */
export function formatDayChip(iso: string): string {
  const key = dayKey(iso);
  const ahora = new Date();
  if (key === dayKey(ahora.toISOString())) return 'Hoy';
  const manana = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);
  if (key === dayKey(manana.toISOString())) return 'Mañana';
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
  }).format(new Date(iso));
  return parts.replace(/\./g, '').replace(/^\w/, (c) => c.toUpperCase());
}

export function formatTime(iso: string): string {
  // "18:30"
  const d = new Date(iso);
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Key used to group classes by day.
 * Uses a YYYY-MM-DD representation in the Buenos Aires timezone so that
 * classes at 23:00 local time don't jump into the next day.
 */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}-${m}-${day}`;
}

/**
 * Nombre de pila + inicial del apellido: "Estefania Rojas" → "Estefania R.".
 * El apellido completo de la profesora no le suma nada a quien reserva, y en
 * mobile empuja la fila a dos renglones.
 *
 * Se toma la última palabra como apellido (y no la segunda) porque los nombres
 * compuestos son más frecuentes que los apellidos dobles: "Ana Maria Perez"
 * tiene que dar "Ana P.", no "Ana M.".
 */
export function nombreConInicial(nombre: string | null | undefined): string | null {
  if (!nombre) return null;
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return null;
  if (partes.length === 1) return partes[0];
  const apellido = partes[partes.length - 1];
  return `${partes[0]} ${apellido.charAt(0).toUpperCase()}.`;
}

const DIA_SEMANA: Record<string, string> = {
  Sunday: 'DOMINGO',
  Monday: 'LUNES',
  Tuesday: 'MARTES',
  Wednesday: 'MIERCOLES',
  Thursday: 'JUEVES',
  Friday: 'VIERNES',
  Saturday: 'SABADO',
};

/**
 * Día de la semana de una fecha ISO, con los nombres que usa el backend
 * (`LUNES`, `MARTES`, …). Va por la zona horaria de Buenos Aires, así una clase
 * de las 23:00 no cae en el día siguiente.
 */
export function diaSemanaDe(iso: string): string {
  const nombre = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'long',
  }).format(new Date(iso));
  return DIA_SEMANA[nombre] ?? 'LUNES';
}
