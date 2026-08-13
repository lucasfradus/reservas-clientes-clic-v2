export interface Sede {
  id: number;
  slug: string;
  nombre: string;
  direccion: string;
  ciudad: string;
  email: string | null;
  descripcion: string | null;
  imagenUrl: string | null;
  fotos: string[];
  whatsappUrl: string | null;
  googleMapsUrl: string | null;
  precioPrueba: number | null;
  /**
   * Pixel de Meta propio de la sede (franquicias con su propia cuenta
   * publicitaria). null = usa el pixel general de la marca.
   */
  metaPixelId: string | null;
}

export interface Actividad {
  id: number;
  nombre: string;
  color: string;
  descripcion: string | null;
}

export interface Salon {
  id: number;
  nombre: string;
}

export interface Clase {
  id: number;
  inicio: string;
  actividad: Actividad;
  salon: Salon | null;
  instructor: string | null;
  cuposDisponibles: number;
}

export interface CheckoutPayload {
  claseId: number;
  sedeId: number;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
}

export interface CheckoutResponse {
  initPoint: string;
}

export interface CatalogoPrecios {
  efectivo: number | null;
  debito: number | null;
  tarjeta: number | null;
}

export interface CatalogoPlanFijo {
  planId: number;
  ingresosPorSemana: number | null;
  accesos: number;
}

export interface CatalogoPlanFlexible {
  planId: number;
  accesos: number;
  precios: CatalogoPrecios;
}

export interface CatalogoTipoPlan {
  id: number;
  nombre: string;
  descripcion: string | null;
  frecuencia: 'MENSUAL' | 'TRIMESTRAL';
  etiqueta: string;
  subtitulo: string;
  destacado: boolean;
  caracteristicas: string[];
  orden: number;
  /** Precios del plan fijo (compatibilidad con el render actual). */
  precios: CatalogoPrecios;
  /** Plan de horarios fijos de esta tarjeta. */
  fijo: CatalogoPlanFijo;
  /** Variante flexible (PACK), si está disponible. */
  flexible: CatalogoPlanFlexible | null;
}

export type DiaSemana =
  | 'LUNES'
  | 'MARTES'
  | 'MIERCOLES'
  | 'JUEVES'
  | 'VIERNES'
  | 'SABADO'
  | 'DOMINGO';

export interface HorarioFijable {
  id: number;
  diaSemana: DiaSemana;
  horaInicio: string;
  horaFin: string;
  actividad: { id: number; nombre: string };
  cupo: number;
  cuposAprox: number | null;
}

export interface HorariosResponse {
  ingresosPorSemana: number | null;
  horarios: HorarioFijable[];
}

export type MedioCheckoutPlan = 'online' | 'debito';

export interface CheckoutPlanPayload {
  sedeId: number;
  planId: number;
  medio: MedioCheckoutPlan;
  horarioIds?: number[];
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
}

export interface CheckoutPlanResponse {
  initPoint: string;
  solicitudId: string;
}

export interface CatalogoSede {
  sedeId: number;
  sedeNombre: string;
  sedeSlug: string;
  /** Checklist único de la sede. El de cada tipo quedó solo para el sitio v1. */
  caracteristicas: string[];
  tipos: CatalogoTipoPlan[];
}
