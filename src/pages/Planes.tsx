import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ApiError,
  checkout,
  checkoutPlan,
  getCatalogo,
  getClases,
  getHorarios,
  getSedes,
} from '../api/client';
import type {
  CatalogoTipoPlan,
  Clase,
  DiaSemana,
  HorarioFijable,
  Sede,
} from '../types';
import { Loading } from '../components/ui/Loading';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { GrillaClases } from '../components/ui/GrillaClases';
import { SedeGaleria } from '../components/ui/SedeGaleria';
import { Iso } from '../components/brand/Iso';
import {
  diaSemanaDe,
  formatDayLong,
  formatDayShort,
  formatPrice,
  formatTime,
  nombreConInicial,
} from '../lib/format';
import { trackEvent, trackVenta } from '../lib/analytics';
import { trackMetaEvent } from '../lib/meta';
import './Planes.css';

/**
 * Home de la sede: landing de planes + grilla de clases + checkout. Port del
 * prototipo de Claude Design "CLIC Landing planes". Reemplaza las páginas
 * Precios, Reservar y Sede: es todo lo que hay en `/sede/:slug`.
 *
 * Dos caminos comparten la misma UI de checkout (`mode`):
 *  - 'prueba' → elegís UNA clase real y el pago es REAL vía checkout() → MP.
 *  - 'plan'   → elegís modalidad (horarios fijos o pack flexible) y el pago es
 *               REAL vía checkoutPlan() → MP. En "fijo" elegís tus horarios
 *               recurrentes reales (por id); en "flexible" reservás desde la app.
 *
 * Todo sale de datos reales del catálogo:
 *  - `ingresosPorSemana` viene del plan fijo (`tipo.fijo`).
 *  - la variante flexible es `tipo.flexible` (plan PACK), si existe.
 *  - los horarios fijables (con id, día y cupo aprox) vienen del endpoint
 *    `/sedes/:id/horarios?planId=`.
 */

type Mode = 'plan' | 'prueba';
type Screen = 'landing' | 'checkout';
type Periodo = 'MENSUAL' | 'TRIMESTRAL';
type Modalidad = 'fijo' | 'flex';
type Medio = 'online' | 'debito';

type FormErrors = Partial<
  Record<'nombre' | 'apellido' | 'email' | 'telefono', string>
>;

type LoadState =
  | { status: 'loading' }
  | { status: 'notfound' }
  | { status: 'error'; message: string }
  | {
      status: 'ok';
      sede: Sede;
      tipos: CatalogoTipoPlan[];
      clases: Clase[];
      caracteristicas: string[];
    };

type HorariosState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ok'; horarios: HorarioFijable[] };

const DIA_INFO: Record<DiaSemana, { corto: string; orden: number }> = {
  LUNES: { corto: 'Lun', orden: 0 },
  MARTES: { corto: 'Mar', orden: 1 },
  MIERCOLES: { corto: 'Mié', orden: 2 },
  JUEVES: { corto: 'Jue', orden: 3 },
  VIERNES: { corto: 'Vie', orden: 4 },
  SABADO: { corto: 'Sáb', orden: 5 },
  DOMINGO: { corto: 'Dom', orden: 6 },
};

/** "HH:MM:SS" → "HH:MM". */
const hhmm = (s: string): string => s.slice(0, 5);

const BENEFICIOS_FALLBACK = [
  'Entrená fuerza, postura y movilidad',
  'Clases por niveles: Inicial y Level Up',
  'Horarios fijos o flexibles, como prefieras',
  'Reservas y cambios desde la app',
  'Tu clase de prueba se descuenta del plan',
];

/** Precio "de lista" para mostrar: efectivo/transferencia por defecto. */
function precioLista(tipo: CatalogoTipoPlan): number | null {
  return (
    tipo.precios.efectivo ?? tipo.precios.debito ?? tipo.precios.tarjeta ?? null
  );
}

/**
 * `true` si la tarjeta no ofrece horarios fijos y solo se puede comprar como
 * pack.
 *
 * El catálogo llama `fijo` al plan vinculado en `TipoPlan.plan` sin mirar su
 * modalidad. En una sede que solo vende packs, ahí hay un PACK y `flexible`
 * queda vacío: `ingresosPorSemana` en null es la señal de que ese plan no es
 * de horario fijo. Sin esto, la única modalidad ofrecida era "Horarios fijos",
 * que es lo contrario de lo que la sede vende, y el checkout moría pidiendo
 * horarios que el backend nunca iba a devolver.
 */
function esSoloPack(tipo: CatalogoTipoPlan | null): boolean {
  return tipo != null && tipo.fijo.ingresosPorSemana == null;
}

/**
 * Plan y precios que corresponden a la modalidad elegida.
 *
 * En las sedes que solo venden packs no hay variante `flexible`: el pack ES el
 * plan vinculado como `fijo`, así que la modalidad flexible sale de ahí.
 */
function variantePlan(
  tipo: CatalogoTipoPlan,
  flex: boolean,
): { planId: number; precios: CatalogoTipoPlan['precios'] } {
  if (flex && tipo.flexible) {
    return { planId: tipo.flexible.planId, precios: tipo.flexible.precios };
  }
  return { planId: tipo.fijo.planId, precios: tipo.precios };
}

/**
 * Cuánto se ahorra un trimestral contra pagar el mismo plan mes a mes.
 *
 * La comparación honesta de un trimestral no es contra el precio con tarjeta
 * del mismo plan (eso mide el recargo de la financiación, no la conveniencia
 * del trimestre): es contra tres meses del mensual equivalente. En las sedes
 * reales da entre 15% y 22%, contra el 13% que salía comparando medios de pago.
 *
 * El equivalente se busca por `ingresosPorSemana`, que es lo que define la
 * intensidad del plan (1, 2 o 3 clases por semana). Hot Clic no lo tiene
 * cargado en ninguna tarjeta, así que ahí se cae a `orden`, que en las 11 sedes
 * mantiene el mismo lugar en las dos frecuencias.
 */
function ahorroVsMensual(
  tipo: CatalogoTipoPlan,
  tipos: CatalogoTipoPlan[],
): number | null {
  if (tipo.frecuencia !== 'TRIMESTRAL') return null;

  const mensuales = tipos.filter((t) => t.frecuencia === 'MENSUAL');
  const ips = tipo.fijo.ingresosPorSemana;
  const candidatos =
    ips != null
      ? mensuales.filter((m) => m.fijo.ingresosPorSemana === ips)
      : mensuales.filter((m) => m.orden === tipo.orden);
  // Con más de uno no se puede saber cuál es el equivalente: mejor no afirmar.
  if (candidatos.length !== 1) return null;

  const mensual = precioLista(candidatos[0]);
  const trimestral = precioLista(tipo);
  if (mensual == null || trimestral == null || mensual <= 0) return null;

  const tresMeses = mensual * 3;
  if (trimestral >= tresMeses) return null;
  return Math.round((1 - trimestral / tresMeses) * 100);
}

interface DatosResumen {
  eyebrow: string;
  titulo: string;
  sedeNombre?: string;
  /** Etiqueta y valor, como "Fecha / Jueves, 13 de agosto · 19:00". */
  filas: { label: string; value: string }[];
  /** Qué decir mientras no hay filas. */
  pendiente: string;
  totalLabel: string;
  total: number | null;
}

/**
 * Lo que se está por comprar. En mobile aparece solo en el paso de datos, y en
 * desktop vive en la columna derecha, así que tiene que verse bien también a
 * medio completar.
 */
function ResumenCompra({ datos }: { datos: DatosResumen }) {
  return (
    <div className="planes__summary">
      <span className="planes__summary-eyebrow">{datos.eyebrow}</span>
      <p className="planes__summary-plan">{datos.titulo}</p>
      <p className="planes__summary-sede">{datos.sedeNombre}</p>

      <div className="planes__summary-line" />
      <div className="planes__summary-rows">
        {datos.filas.length === 0 ? (
          <p className="planes__summary-pend">{datos.pendiente}</p>
        ) : (
          datos.filas.map((f, i) => (
            <div key={i} className="planes__summary-row">
              <span className="planes__summary-row-lbl">{f.label}</span>
              <span className="planes__summary-row-val">{f.value}</span>
            </div>
          ))
        )}
      </div>

      <div className="planes__summary-line" />
      <div className="planes__summary-total">
        <span className="planes__summary-total-lbl">{datos.totalLabel}</span>
        <span className="planes__summary-total-val">
          {formatPrice(datos.total)}
        </span>
      </div>

      <div className="planes__summary-mp">
        <span className="planes__summary-mp-chip">MP</span>
        Pago seguro vía Mercado Pago
      </div>
    </div>
  );
}

function validate(form: {
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
}): FormErrors {
  const errors: FormErrors = {};
  if (!form.nombre.trim()) errors.nombre = 'Ingresá tu nombre';
  if (!form.apellido.trim()) errors.apellido = 'Ingresá tu apellido';
  if (!form.email.trim()) {
    errors.email = 'Ingresá tu email';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = 'Email inválido';
  }
  if (!form.telefono.trim()) {
    errors.telefono = 'Ingresá tu teléfono';
  } else if (form.telefono.replace(/\D/g, '').length < 8) {
    errors.telefono = 'Teléfono demasiado corto';
  }
  return errors;
}

export default function Planes() {
  const { slug } = useParams<{ slug: string }>();
  const planesRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  // Barra fija de mobile: aparece cuando el hero (con su CTA y su precio) se
  // fue de pantalla, y solo en la landing.
  const [showSticky, setShowSticky] = useState(false);

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });

  // ── Navegación interna ────────────────────────────────────────────────
  const [screen, setScreen] = useState<Screen>('landing');
  const [mode, setMode] = useState<Mode>('plan');
  const [step, setStep] = useState<1 | 2>(1);
  const [periodo, setPeriodo] = useState<Periodo>('MENSUAL');

  // ── Selección de plan / horarios ──────────────────────────────────────
  const [tipoId, setTipoId] = useState<number | null>(null);
  const [modalidad, setModalidad] = useState<Modalidad | null>(null);
  const [medio, setMedio] = useState<Medio>('online');
  const [dia, setDia] = useState<string>(''); // diaSemana (plan-fijo) o dayKey (prueba)
  const [sel, setSel] = useState<string[]>([]); // plan: horarioId; prueba: claseId
  // Horarios fijables reales del plan fijo elegido (endpoint /horarios).
  const [horarios, setHorarios] = useState<HorariosState>({ status: 'idle' });

  // ── Formulario ────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    nombre: '',
    apellido: '',
    email: '',
    telefono: '',
    dni: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const scrollTop = () =>
    window.scrollTo({ top: 0, behavior: 'smooth' });

  const cargar = () => {
    if (!slug) return;
    setLoad({ status: 'loading' });
    Promise.all([getSedes(), getCatalogo(slug)])
      .then(async ([sedes, catalogo]) => {
        const sede = sedes.find((s) => s.slug === slug);
        if (!sede) {
          setLoad({ status: 'notfound' });
          return;
        }
        const cat = catalogo.find((c) => c.sedeSlug === slug) ?? catalogo[0];
        const clases = (await getClases(sede.id).catch(() => [])).sort((a, b) =>
          a.inicio.localeCompare(b.inicio),
        );
        setLoad({
          status: 'ok',
          sede,
          tipos: cat?.tipos ?? [],
          clases,
          caracteristicas: cat?.caracteristicas ?? [],
        });
      })
      .catch((err) =>
        setLoad({
          status: 'error',
          message:
            err instanceof ApiError
              ? err.message
              : 'No pudimos cargar los planes.',
        }),
      );
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(cargar, [slug]);

  useEffect(() => {
    const onScroll = () => {
      const hero = heroRef.current;
      if (hero) setShowSticky(hero.getBoundingClientRect().bottom < 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── Derivados ─────────────────────────────────────────────────────────
  const tipos = load.status === 'ok' ? load.tipos : [];
  const clases = load.status === 'ok' ? load.clases : [];
  const sede = load.status === 'ok' ? load.sede : undefined;

  // Se espera a que cargue el catálogo para poder mandar el nombre de la sede,
  // que es como se la lee en los informes.
  useEffect(() => {
    if (!sede) return;
    trackEvent('view_planes', { sede: sede.nombre, sede_slug: sede.slug });

    // Vista de la sede (contenido + oferta). Abre el embudo de ecommerce de
    // GA4 (view_item → begin_checkout → add_payment_info → purchase) y su
    // equivalente en Meta. Vivía en la página de sede, que ahora es esta.
    const params: Record<string, unknown> = {
      content_name: sede.nombre,
      content_category: 'Trial',
      sede: sede.nombre,
    };
    if (sede.precioPrueba != null) {
      params.value = sede.precioPrueba;
      params.currency = 'ARS';
    }
    trackMetaEvent('ViewContent', params, undefined, sede.slug);

    trackVenta('view_item', {
      nombre: `Clase de prueba - ${sede.nombre}`,
      categoria: 'Trial',
      sede: sede.nombre,
      sedeSlug: sede.slug,
      precio: sede.precioPrueba,
    });
  }, [sede]);

  const frecuenciasDisponibles = useMemo(
    () => new Set(tipos.map((t) => t.frecuencia)),
    [tipos],
  );

  // Alinear el período por defecto con lo que realmente exista.
  useEffect(() => {
    if (frecuenciasDisponibles.size === 0) return;
    if (!frecuenciasDisponibles.has(periodo)) {
      setPeriodo(frecuenciasDisponibles.has('MENSUAL') ? 'MENSUAL' : 'TRIMESTRAL');
    }
  }, [frecuenciasDisponibles, periodo]);

  const planes = useMemo(
    () =>
      tipos
        .filter((t) => t.frecuencia === periodo)
        .sort((a, b) => a.orden - b.orden),
    [tipos, periodo],
  );

  // El checklist es uno solo de la sede. Antes se juntaban las características
  // de cada tarjeta, se deduplicaban y se cortaban en 6, porque las 6 tarjetas
  // repetían la misma lista y no había forma de saber cuál era la buena.
  const beneficios =
    load.status === 'ok' && load.caracteristicas.length > 0
      ? load.caracteristicas
      : BENEFICIOS_FALLBACK;

  const tipoSel = useMemo(
    () => tipos.find((t) => t.id === tipoId) ?? null,
    [tipos, tipoId],
  );

  const flex = modalidad === 'flex';
  // Horarios fijos que pide el plan elegido. En modo prueba no aplica: la
  // clase se elige tocándola en la grilla.
  const necesarios = flex ? 0 : tipoSel?.fijo.ingresosPorSemana ?? 1;

  const horariosData = horarios.status === 'ok' ? horarios.horarios : [];
  const horarioPorId = useMemo(() => {
    const m = new Map<string, HorarioFijable>();
    for (const h of horariosData) m.set(String(h.id), h);
    return m;
  }, [horariosData]);

  // Días de la semana con horarios fijables (solo plan-fijo).
  const diasChips = useMemo(() => {
    const dias = Array.from(new Set(horariosData.map((h) => h.diaSemana)));
    return dias
      .sort((a, b) => DIA_INFO[a].orden - DIA_INFO[b].orden)
      .map((d) => ({ key: d as string, label: DIA_INFO[d].corto }));
  }, [horariosData]);

  // Fijar el día activo cuando aparece la grilla de horarios fijos.
  useEffect(() => {
    if (screen !== 'checkout' || step !== 1) return;
    if (mode !== 'plan' || modalidad !== 'fijo') return;
    if (dia && diasChips.some((d) => d.key === dia)) return;
    if (diasChips.length > 0) setDia(diasChips[0].key);
  }, [screen, step, mode, modalidad, dia, diasChips]);

  // Grilla semanal de la sede, como referencia en el pack flexible.
  //
  // Sale de los horarios fijables del plan cuando los hay. En las sedes que
  // solo venden packs no hay plan de horario fijo y ese endpoint responde 404,
  // así que se arma con las clases reales de los próximos días, que ya están
  // cargadas y describen la misma grilla.
  const grillaSemanal = useMemo(() => {
    const map = new Map<DiaSemana, string[]>();
    if (horariosData.length > 0) {
      for (const h of horariosData) {
        const arr = map.get(h.diaSemana) ?? [];
        arr.push(hhmm(h.horaInicio));
        map.set(h.diaSemana, arr);
      }
    } else {
      for (const c of clases) {
        const d = diaSemanaDe(c.inicio) as DiaSemana;
        const arr = map.get(d) ?? [];
        arr.push(formatTime(c.inicio));
        map.set(d, arr);
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => DIA_INFO[a].orden - DIA_INFO[b].orden)
      .map(([diaSemana, horas]) => ({
        diaSemana,
        label: DIA_INFO[diaSemana].corto,
        horas: Array.from(new Set(horas)).sort(),
      }));
  }, [horariosData, clases]);

  // Slots del día activo.
  const slots = useMemo(
    () =>
      horariosData
        .filter((h) => (h.diaSemana as string) === dia)
        .map((h) => ({
          key: String(h.id),
          hora: hhmm(h.horaInicio),
          cupos: h.cuposAprox ?? h.cupo,
        })),
    [dia, horariosData],
  );

  const labelDeSel = (key: string): string => {
    if (mode === 'prueba') {
      const c = clases.find((x) => String(x.id) === key);
      return c ? `${formatDayShort(c.inicio)} ${formatTime(c.inicio)}` : key;
    }
    const h = horarioPorId.get(key);
    return h ? `${DIA_INFO[h.diaSemana].corto} ${hhmm(h.horaInicio)}` : key;
  };

  const toggleSlot = (key: string) => {
    setSel((cur) => {
      if (cur.includes(key)) return cur.filter((k) => k !== key);
      if (cur.length < necesarios) return [...cur, key];
      return [...cur.slice(0, -1), key]; // reemplaza el último
    });
  };

  const completo =
    mode === 'prueba'
      ? sel.length === 1
      : flex
        ? true
        : necesarios > 0 && sel.length === necesarios;

  // ── Acciones ──────────────────────────────────────────────────────────
  const abrirPrueba = () => {
    setMode('prueba');
    setModalidad(null);
    setSel([]);
    setDia('');
    setStep(1);
    setScreen('checkout');
    trackVenta('begin_checkout', {
      nombre: 'Clase de prueba',
      categoria: 'Trial',
      sede: sede?.nombre,
      sedeSlug: sede?.slug ?? slug,
      precio: sede?.precioPrueba,
    });
    scrollTop();
  };

  // Tocar una clase en la grilla del paso 1 la elige y pasa a los datos. No
  // mide nada: el begin_checkout ya salió al abrir el checkout (`abrirPrueba`),
  // que es el único camino para llegar hasta acá.
  const elegirClasePrueba = (clase: Clase) => {
    setSel([String(clase.id)]);
    setStep(2);
    scrollTop();
  };

  const empezarPlan = (t: CatalogoTipoPlan) => {
    setMode('plan');
    setTipoId(t.id);
    // Si la sede no vende horarios fijos no hay nada que preguntar: la única
    // modalidad posible es el pack.
    setModalidad(esSoloPack(t) ? 'flex' : null);
    setMedio('online');
    setSel([]);
    setDia('');
    setHorarios({ status: 'idle' });
    setStep(1);
    setScreen('checkout');
    // Misma venta que la prueba a ojos de GA4, pero con `categoria` distinta:
    // es lo único que después separa "cuántas pruebas vendí" de "cuántas
    // suscripciones vendí", tanto en los informes como en las campañas.
    trackVenta('begin_checkout', {
      nombre: t.nombre,
      categoria: 'Subscription',
      sede: sede?.nombre,
      sedeSlug: sede?.slug ?? slug,
      precio: precioLista(t),
    });
    scrollTop();
  };

  // Cargar los horarios reales de la sede al elegir modalidad. En "fijo" son
  // los que se eligen; en "flexible" se muestran nada más como referencia de
  // la grilla, para saber si los horarios de la sede te sirven.
  useEffect(() => {
    if (mode !== 'plan' || modalidad == null || !tipoSel || !sede) return;
    let cancelado = false;
    setHorarios({ status: 'loading' });
    getHorarios(sede.id, tipoSel.fijo.planId)
      .then((r) => {
        if (!cancelado) setHorarios({ status: 'ok', horarios: r.horarios });
      })
      .catch(() => {
        if (!cancelado) setHorarios({ status: 'error' });
      });
    return () => {
      cancelado = true;
    };
  }, [mode, modalidad, tipoSel, sede]);

  // Precio a cobrar según modalidad + medio (online = tarjeta; débito = débito).
  const preciosPlanSel = tipoSel
    ? variantePlan(tipoSel, flex).precios
    : undefined;
  const precioCheckout = preciosPlanSel
    ? medio === 'online'
      ? preciosPlanSel.tarjeta ?? preciosPlanSel.efectivo
      : preciosPlanSel.debito
    : null;

  const scrollToPlanes = () => {
    planesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const volver = () => {
    if (step === 1) {
      setScreen('landing');
      setSel([]);
    } else {
      setStep(1);
    }
    scrollTop();
  };

  const handleChange =
    (field: keyof typeof form) => (e: FormEvent<HTMLInputElement>) => {
      const value = (e.target as HTMLInputElement).value;
      setForm((f) => ({ ...f, [field]: value }));
      // El DNI no se valida, así que no tiene error que limpiar.
      if (field !== 'dni' && errors[field]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    };

  // Datos y pago viven en la misma pantalla: el submit del formulario es el
  // que dispara el pago, sin un paso intermedio de confirmación.
  const pagar = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = validate(form);
    if (Object.keys(v).length > 0) {
      setErrors(v);
      return;
    }
    if (mode === 'prueba') pagarPrueba();
    else pagarPlan();
  };

  // Pago del PLAN: real, vía checkoutPlan() → Mercado Pago.
  const pagarPlan = async () => {
    if (!sede || !tipoSel || submitting) return;
    const { planId } = variantePlan(tipoSel, flex);
    if (planId == null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await checkoutPlan({
        sedeId: sede.id,
        planId,
        medio,
        horarioIds: flex ? undefined : sel.map(Number),
        nombre: form.nombre.trim(),
        apellido: form.apellido.trim(),
        email: form.email.trim(),
        telefono: form.telefono.trim(),
      });
      // `content_category` lleva el TIPO de venta, no la sede: es el campo por
      // el que Meta permite armar conversiones personalizadas, y lo que hay que
      // poder separar es la suscripción de la clase de prueba. La sede va como
      // propiedad propia, que también sirve para filtrar.
      const params: Record<string, unknown> = {
        content_name: tipoSel.nombre,
        content_category: 'Subscription',
        sede: sede.nombre,
        currency: 'ARS',
      };
      if (precioCheckout != null) params.value = precioCheckout;
      trackMetaEvent('InitiateCheckout', params, undefined, sede.slug);
      trackVenta('add_payment_info', {
        nombre: tipoSel.nombre,
        categoria: 'Subscription',
        sede: sede.nombre,
        sedeSlug: sede.slug,
        precio: precioCheckout,
      });
      window.location.href = res.initPoint;
    } catch (err) {
      setSubmitting(false);
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : 'No pudimos iniciar el pago. Probá de nuevo en un momento.',
      );
    }
  };

  // Pago de la PRUEBA: real, vía checkout() → Mercado Pago.
  const pagarPrueba = async () => {
    if (!sede || submitting) return;
    const claseId = Number(sel[0]);
    if (!Number.isFinite(claseId)) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await checkout({
        claseId,
        sedeId: sede.id,
        nombre: form.nombre.trim(),
        apellido: form.apellido.trim(),
        email: form.email.trim(),
        telefono: form.telefono.trim(),
        dni: form.dni.trim() || undefined,
      });
      const clase = clases.find((c) => c.id === claseId);
      const params: Record<string, unknown> = {
        content_name: clase?.actividad.nombre ?? 'Clase de prueba',
        content_category: 'Trial',
        sede: sede.nombre,
      };
      if (sede.precioPrueba != null) {
        params.value = sede.precioPrueba;
        params.currency = 'ARS';
      }
      trackMetaEvent('InitiateCheckout', params, undefined, sede.slug);
      trackVenta('add_payment_info', {
        nombre: clase?.actividad.nombre ?? 'Clase de prueba',
        categoria: 'Trial',
        sede: sede.nombre,
        sedeSlug: sede.slug,
        precio: sede.precioPrueba,
      });
      window.location.href = res.initPoint;
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setSubmitError(
            'Esta clase se llenó mientras completabas el formulario. Volvé a elegir un horario.',
          );
        } else if (err.status === 404) {
          setSubmitError('La clase ya no está disponible. Elegí otro horario.');
        } else {
          setSubmitError(err.message);
        }
      } else {
        setSubmitError('No pudimos procesar el pago. Probá de nuevo en un momento.');
      }
    }
  };

  // ── Estados de carga ──────────────────────────────────────────────────
  if (load.status === 'loading') {
    return (
      <div className="planes">
        <Loading label="Cargando planes" />
      </div>
    );
  }
  if (load.status === 'notfound') {
    return (
      <div className="planes planes--msg">
        <p className="t-tag">Sede no encontrada</p>
        <h1 className="planes__msg-title">Esa sede no existe</h1>
        <Link to="/" className="planes__msg-link">
          Ver todas las sedes →
        </Link>
      </div>
    );
  }
  if (load.status === 'error') {
    return (
      <div className="planes">
        <ErrorBanner message={load.message} onRetry={cargar} />
      </div>
    );
  }

  // La imagen de cabecera abre el carrusel y la galería la continúa. Set
  // dedupe por si el estudio subió la misma foto en ambos lados.
  const heroImages = sede
    ? Array.from(new Set([...(sede.imagenUrl ? [sede.imagenUrl] : []), ...sede.fotos]))
    : [];

  // ══════════════════════════════ LANDING ══════════════════════════════
  if (screen === 'landing') {
    return (
      <div className="planes planes--landing">
        {/* En mobile flota sobre la foto; en desktop, donde el hero es una
            tarjeta acotada, va arriba de ella. */}
        <Link to="/" className="planes__back-link">
          ← Ver todas las sedes
        </Link>

        {/* Hero. En mobile ocupa la pantalla entera, con la galería de fondo y
            el cuerpo apoyado abajo sobre el degradado. En desktop es una
            tarjeta con la foto y el cuerpo lado a lado. */}
        <section className="planes__hero" ref={heroRef}>
          <div className="planes__hero-media">
            <SedeGaleria
              key={sede?.id}
              images={heroImages}
              sedeNombre={sede?.nombre ?? ''}
              fallback={
                <div className="planes__hero-fallback">
                  <Iso variant="white" size={72} />
                </div>
              }
            />
          </div>
          <div className="planes__hero-body">
            <p className="planes__hero-place">
              <span className="planes__hero-city">{sede?.ciudad}</span>
              <span className="planes__hero-dot" aria-hidden="true">·</span>
              {sede?.direccion}
            </p>
            <h1 className="planes__hero-name">{sede?.nombre}</h1>
            {/* Solo desktop: en mobile el hero no tiene lugar y se sacó. */}
            {sede?.descripcion && (
              <p className="planes__hero-desc">{sede.descripcion}</p>
            )}

            <span className="planes__eyebrow planes__eyebrow--light planes__hero-gap">
              Tu clase de prueba en CLIC
            </span>
            <p className="planes__hero-price">{formatPrice(sede?.precioPrueba)}</p>
            <p className="planes__hero-note">
              Se descuenta de tu plan si te quedás
            </p>

            <button
              type="button"
              className="planes__hero-cta"
              onClick={abrirPrueba}
            >
              Reservar clase de prueba
            </button>
            <button
              type="button"
              className="planes__hero-link"
              onClick={scrollToPlanes}
            >
              Ver planes → Quiero adquirir mi membresía
            </button>

            {(sede?.whatsappUrl || sede?.googleMapsUrl) && (
              <div className="planes__hero-links">
                {sede?.whatsappUrl && (
                  <a href={sede.whatsappUrl} target="_blank" rel="noreferrer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                    WhatsApp
                  </a>
                )}
                {sede?.googleMapsUrl && (
                  <a href={sede.googleMapsUrl} target="_blank" rel="noreferrer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z" />
                    </svg>
                    Cómo llegar
                  </a>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Divider */}
        <div className="planes__divider">
          <span className="planes__divider-line" />
          <span className="planes__divider-txt">O empezá directo</span>
          <span className="planes__divider-line" />
        </div>

        {/* Encabezado planes */}
        <div ref={planesRef} className="planes__intro">
          <h2 className="planes__intro-title">Elegí cómo querés vivir CLIC</h2>
          <p className="planes__intro-sub">
            Encontrá el plan que mejor se adapte a tu rutina y reservá tus
            clases desde la app.
          </p>
        </div>

        {/* Toggle mensual / trimestral */}
        {frecuenciasDisponibles.size > 0 && (
          <div className="planes__toggle-wrap">
            <div className="planes__toggle">
              {(['MENSUAL', 'TRIMESTRAL'] as const).map((f) =>
                frecuenciasDisponibles.has(f) ? (
                  <button
                    key={f}
                    type="button"
                    className={`planes__toggle-opt${periodo === f ? ' planes__toggle-opt--active' : ''}`}
                    onClick={() => setPeriodo(f)}
                  >
                    {f === 'MENSUAL' ? 'Mensual' : 'Trimestral'}
                    {f === 'TRIMESTRAL' && (
                      <span className="planes__toggle-pill">+ ahorro</span>
                    )}
                  </button>
                ) : null,
              )}
            </div>
          </div>
        )}

        {/* Cards de planes */}
        {planes.length === 0 ? (
          <div className="planes__empty">
            <p>No hay planes disponibles para esta opción.</p>
          </div>
        ) : (
          <div className="planes__cards">
            {planes.map((t) => {
              const precio = precioLista(t);
              const tarjeta = t.precios.tarjeta;
              // En un trimestral la comparación que importa es contra pagar
              // mes a mes; el precio con tarjeta se reserva para los mensuales,
              // donde es la única otra referencia que hay.
              const ahorroMensual = ahorroVsMensual(t, tipos);
              const ahorroCredito =
                precio != null && tarjeta != null && tarjeta > 0 && precio < tarjeta
                  ? Math.round((1 - precio / tarjeta) * 100)
                  : null;
              const ahorroPct = ahorroMensual ?? ahorroCredito;
              const ahorroTxt =
                ahorroMensual != null ? 'vs mes a mes' : 'vs crédito';
              return (
                <article
                  key={t.id}
                  className={`planes__card${t.destacado ? ' planes__card--top' : ''}`}
                >
                  {t.destacado && (
                    <span className="planes__card-ribbon">El más elegido</span>
                  )}
                  <h3 className="planes__card-name">{t.etiqueta || t.nombre}</h3>
                  <p className="planes__card-freq">{t.subtitulo}</p>
                  {t.descripcion && (
                    <p className="planes__card-copy">{t.descripcion}</p>
                  )}
                  <div className="planes__card-price-row">
                    <span className="planes__card-price">{formatPrice(precio)}</span>
                    <span className="planes__card-per">
                      {periodo === 'MENSUAL' ? '/mes' : '/trimestre'}
                    </span>
                  </div>
                  {ahorroPct != null && ahorroPct > 0 && (
                    <span className="planes__card-save">
                      <span className="planes__card-save-dot" />
                      Ahorrás {ahorroPct}% {ahorroTxt}
                    </span>
                  )}
                  <button
                    type="button"
                    className={`planes__card-cta${t.destacado ? ' planes__card-cta--primary' : ''}`}
                    onClick={() => empezarPlan(t)}
                  >
                    Empezar este plan
                  </button>
                </article>
              );
            })}
          </div>
        )}

        {/* Qué incluye */}
        <ul className="planes__benefits">
          {beneficios.map((b, i) => (
            <li key={i} className="planes__benefit">
              <span className="planes__benefit-check">✓</span>
              {b}
            </li>
          ))}
        </ul>

        {/* Trust */}
        <div className="planes__trust">
          <span>Pagás online</span>
          <span>·</span>
          <span>Sin permanencia</span>
          <span>·</span>
          <span>Vence a los 30 días</span>
        </div>

        {/* Recordatorio prueba */}
        <div className="planes__reminder">
          ¿Primera vez en reformer?{' '}
          <button type="button" className="planes__reminder-link" onClick={abrirPrueba}>
            Reservá tu clase de prueba
          </button>{' '}
          — si te quedás, se descuenta de tu plan.
        </div>

        {showSticky && (
          <div className="planes__sticky">
            <div className="planes__sticky-info">
              <span className="planes__sticky-label">Clase de prueba</span>
              <span className="planes__sticky-price">
                {formatPrice(sede?.precioPrueba)}
              </span>
            </div>
            <button
              type="button"
              className="planes__sticky-btn"
              onClick={abrirPrueba}
            >
              Reservar
            </button>
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════ CHECKOUT ══════════════════════════════
  const pasosDef = ['1 · Horarios', '2 · Tus datos'];
  const precioSel = tipoSel ? precioLista(tipoSel) : sede?.precioPrueba ?? null;
  const selOrdenado = [...sel].sort((a, b) => a.localeCompare(b));

  // Lo elegido hasta acá. En desktop acompaña los tres pasos desde la columna
  // derecha, así que tiene que aguantar que todavía no haya nada elegido.
  const clasePrueba = clases.find((c) => String(c.id) === sel[0]);
  const resumen: DatosResumen = {
    eyebrow: mode === 'prueba' ? 'Tu clase de prueba' : 'Tu plan',
    titulo:
      mode === 'prueba'
        ? clasePrueba?.actividad.nombre ?? 'Clase de prueba'
        : tipoSel?.etiqueta || tipoSel?.nombre || 'Tu plan',
    sedeNombre: sede?.nombre,
    filas:
      mode === 'prueba'
        ? clasePrueba
          ? [
              {
                label: 'Fecha',
                value: `${formatDayLong(clasePrueba.inicio)} · ${formatTime(clasePrueba.inicio)}`,
              },
              {
                label: 'Instructora',
                value:
                  nombreConInicial(clasePrueba.instructor) ?? 'A confirmar',
              },
            ]
          : []
        : flex
          ? [
              { label: 'Modalidad', value: 'Pack flexible' },
              { label: 'Reservas', value: 'Desde la app' },
            ]
          : selOrdenado.map((k, i) => ({
              label: i === 0 ? 'Todas las semanas' : '',
              value: `${labelDeSel(k)} hs`,
            })),
    pendiente:
      mode === 'prueba'
        ? 'Elegí tu clase para verla acá'
        : modalidad == null
          ? 'Elegí cómo querés usar tus clases'
          : 'Elegí tus horarios para verlos acá',
    totalLabel: 'Total',
    total: mode === 'prueba' ? precioSel : precioCheckout,
  };

  return (
    <div className="planes planes--checkout">
      {/* Header del checkout */}
      <div className="planes__co-head">
        <button
          type="button"
          className="planes__co-back"
          onClick={volver}
          aria-label={step === 1 ? 'Volver a la sede' : 'Volver al paso anterior'}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="planes__steps">
          {pasosDef.map((label, i) => {
            const n = i + 1;
            const state = step === n ? 'active' : step > n ? 'done' : 'todo';
            // El paso 1 no siempre es elegir horarios: en prueba se elige una
            // clase, y en una sede que solo vende packs no se elige nada.
            const txt =
              n !== 1
                ? label
                : mode === 'prueba'
                  ? '1 · Clase'
                  : esSoloPack(tipoSel)
                    ? '1 · Plan'
                    : label;
            return (
              <span key={label} className={`planes__step planes__step--${state}`}>
                {txt}
              </span>
            );
          })}
        </div>
      </div>

      <div className="planes__co-layout">
        {/* El resumen va antes que el paso en el DOM porque en mobile tiene que
            quedar arriba del medio de pago. En desktop la grilla lo manda a la
            columna derecha, donde acompaña los tres pasos. */}
        <aside
          className={`planes__co-aside${step === 2 ? '' : ' planes__co-aside--desk'}`}
        >
          <ResumenCompra datos={resumen} />
        </aside>

        <div className="planes__co-main">

      {/* ── Paso 1 ── */}
      {step === 1 && (
        <div className="planes__co-body">
          {/* La pregunta de modalidad no se hace si hay una sola respuesta
              posible: en una sede que solo vende packs, ofrecer "Horarios
              fijos" era ofrecer lo que no existe. */}
          {mode === 'plan' && !esSoloPack(tipoSel) && (
            <>
              <h2 className="planes__co-title">¿Cómo querés usar tus clases?</h2>
              <div className="planes__modes">
                {(
                  [
                    {
                      id: 'fijo' as const,
                      titulo: 'Horarios fijos',
                      desc: 'Tu lugar reservado, mismo grupo y mismo profe cada semana. Ideal para sostener la constancia.',
                    },
                    {
                      id: 'flex' as const,
                      titulo: 'Pack flexible',
                      desc: 'Reservás tus clases cada semana desde la app, según tu agenda. Sujeto a disponibilidad.',
                    },
                  ]
                )
                  .filter((m) => m.id === 'fijo' || tipoSel?.flexible != null)
                  .map((m) => {
                  const on = modalidad === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`planes__mode${on ? ' planes__mode--on' : ''}`}
                      onClick={() => {
                        setModalidad(m.id);
                        setSel([]);
                      }}
                    >
                      <span className="planes__mode-check">{on ? '✓' : ''}</span>
                      <span className="planes__mode-txt">
                        <span className="planes__mode-title">{m.titulo}</span>
                        <span className="planes__mode-desc">{m.desc}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Prueba: la agenda real de la sede, con sus filtros. Tocar una
              clase la elige y pasa a los datos — no hay paso intermedio. */}
          {mode === 'prueba' && (
            <>
              <h2 className="planes__co-title">Elegí tu clase de prueba</h2>
              <p className="planes__co-sub">
                Recordá que si te querés quedar con nosotros, el valor de la
                clase de prueba se descuenta del plan que elijas.
              </p>
              <div className="planes__co-grilla">
                <GrillaClases
                  clases={clases}
                  onElegir={elegirClasePrueba}
                  elegidaId={sel.length > 0 ? Number(sel[0]) : null}
                />
              </div>
            </>
          )}

          {/* Grilla de horarios recurrentes (plan con horarios fijos) */}
          {mode === 'plan' && modalidad === 'fijo' && (
            <div className="planes__grid-wrap">
              <div className="planes__grid-head">
                <h3 className="planes__grid-title">
                  {necesarios === 1
                    ? 'Elegí tu horario fijo'
                    : `Elegí tus ${necesarios} horarios fijos`}
                </h3>
                <p className="planes__grid-sub">
                  Van a ser tus clases de cada semana. Mismo grupo, mismo profe.
                </p>
              </div>

              {horarios.status === 'loading' ? (
                <Loading label="Cargando horarios" />
              ) : horarios.status === 'error' ? (
                <div className="planes__empty planes__empty--soft">
                  <p>No pudimos cargar los horarios. Probá de nuevo.</p>
                </div>
              ) : diasChips.length === 0 ? (
                <div className="planes__empty planes__empty--soft">
                  <p>No hay horarios disponibles por ahora. Escribinos por WhatsApp y te ayudamos.</p>
                </div>
              ) : (
                <>
                  <div className="planes__days">
                    {diasChips.map((d) => {
                      const active = d.key === dia;
                      const tieneSel = sel.some(
                        (k) => horarioPorId.get(k)?.diaSemana === d.key,
                      );
                      return (
                        <button
                          key={d.key}
                          type="button"
                          className={`planes__day${active ? ' planes__day--active' : ''}`}
                          onClick={() => setDia(d.key)}
                        >
                          {d.label}
                          {tieneSel && <span className="planes__day-dot" />}
                        </button>
                      );
                    })}
                  </div>

                  <div className="planes__slots">
                    {slots.map((s) => {
                      const on = sel.includes(s.key);
                      const lleno = s.cupos <= 0;
                      // Sin números: el cupo de un horario recurrente es el de
                      // su próxima clase, no el que se va a encontrar cada
                      // semana. Solo importa si el horario se puede tomar o no.
                      const cuposTxt = lleno ? 'Completo' : null;
                      return (
                        <button
                          key={s.key}
                          type="button"
                          disabled={lleno}
                          className={`planes__slot${on ? ' planes__slot--on' : ''}${lleno ? ' planes__slot--full' : ''}`}
                          onClick={() => toggleSlot(s.key)}
                        >
                          <span className="planes__slot-hora">{s.hora}</span>
                          {cuposTxt && (
                            <span className="planes__slot-cupos">{cuposTxt}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {sel.length > 0 && (
                    <div className="planes__chips">
                      <span className="planes__chips-lbl">Elegiste:</span>
                      {selOrdenado.map((k) => (
                        <button
                          key={k}
                          type="button"
                          className="planes__chip"
                          onClick={() => toggleSlot(k)}
                        >
                          {labelDeSel(k)} <span className="planes__chip-x">✕</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              <button
                type="button"
                disabled={!completo}
                className={`planes__co-cta${completo ? '' : ' planes__co-cta--off'}`}
                onClick={() => {
                  if (!completo) return;
                  setStep(2);
                  scrollTop();
                }}
              >
                {completo
                  ? 'Continuar'
                  : `Elegí ${necesarios - sel.length} horario${necesarios - sel.length === 1 ? '' : 's'} más`}
              </button>
            </div>
          )}

          {/* Pack flexible: no hay horarios que elegir, pero sí una duda que
              resolver antes de pagar — si la grilla de la sede te sirve. */}
          {mode === 'plan' && flex && (
            <div className="planes__grid-wrap">
              {/* Sin la pregunta de modalidad arriba, el paso arrancaba
                  directo en el colapsable y no se entendía qué se compra. */}
              {esSoloPack(tipoSel) && (
                <>
                  <h2 className="planes__co-title">Cómo funciona tu pack</h2>
                  <p className="planes__co-sub">
                    Reservás cada clase desde la app según la disponibilidad del
                    momento. No hay horarios fijos asignados.
                  </p>
                </>
              )}
              <details className="planes__grilla">
                <summary className="planes__grilla-sum">
                  Ver grilla horaria
                </summary>
                <div className="planes__grilla-body">
                  {/* El error del endpoint no alcanza para dar la grilla por
                      perdida: en las sedes sin plan fijo siempre responde 404 y
                      la grilla igual se arma con las clases reales. */}
                  {horarios.status === 'loading' && grillaSemanal.length === 0 ? (
                    <Loading label="Cargando horarios" />
                  ) : grillaSemanal.length === 0 ? (
                    <p className="planes__grilla-nota">
                      No pudimos cargar la grilla. Escribinos por WhatsApp y te
                      la pasamos.
                    </p>
                  ) : (
                    <>
                      {grillaSemanal.map((d) => (
                        <div key={d.diaSemana} className="planes__grilla-dia">
                          <span className="planes__grilla-dia-lbl">
                            {d.label}
                          </span>
                          <div className="planes__grilla-horas">
                            {d.horas.map((h) => (
                              <span key={h} className="planes__grilla-hora">
                                {h}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                      <p className="planes__grilla-nota">
                        Es la grilla de la sede, a modo de referencia. Con el
                        pack flexible reservás cada clase desde la app según la
                        disponibilidad del momento.
                      </p>
                    </>
                  )}
                </div>
              </details>
              <button
                type="button"
                className="planes__co-cta"
                onClick={() => {
                  setStep(2);
                  scrollTop();
                }}
              >
                Continuar
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Paso 2: datos ── */}
      {/* ── Paso 2: datos y pago en la misma pantalla ── */}
      {step === 2 && (
        <form className="planes__form" onSubmit={pagar} noValidate>
          <h3 className="planes__form-title">Tus datos</h3>
          <p className="planes__form-sub">
            {mode === 'prueba'
              ? 'No creamos cuenta. Solo los usamos para esta reserva.'
              : 'Con esto te creamos la cuenta para reservar desde la app.'}
          </p>

          <div className="planes__fields">
            <div className="planes__field-row">
              <label className="planes__field">
                <span className="planes__field-lbl">Nombre</span>
                <input
                  className="planes__input"
                  autoComplete="given-name"
                  value={form.nombre}
                  onChange={handleChange('nombre')}
                />
                {errors.nombre && (
                  <span className="planes__field-err">{errors.nombre}</span>
                )}
              </label>
              <label className="planes__field">
                <span className="planes__field-lbl">Apellido</span>
                <input
                  className="planes__input"
                  autoComplete="family-name"
                  value={form.apellido}
                  onChange={handleChange('apellido')}
                />
                {errors.apellido && (
                  <span className="planes__field-err">{errors.apellido}</span>
                )}
              </label>
            </div>
            <label className="planes__field">
              <span className="planes__field-lbl">Email</span>
              <input
                className="planes__input"
                placeholder="tu@email.com"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={handleChange('email')}
              />
              {errors.email && (
                <span className="planes__field-err">{errors.email}</span>
              )}
            </label>
            <label className="planes__field">
              <span className="planes__field-lbl">Teléfono</span>
              <input
                className="planes__input"
                placeholder="+54 9 11 …"
                type="tel"
                autoComplete="tel"
                value={form.telefono}
                onChange={handleChange('telefono')}
              />
              {errors.telefono && (
                <span className="planes__field-err">{errors.telefono}</span>
              )}
            </label>
            {/* Solo en la clase de prueba: el checkout de planes no recibe DNI. */}
            {mode === 'prueba' && (
              <label className="planes__field">
                <span className="planes__field-lbl">
                  DNI <span className="planes__field-opt">(opcional)</span>
                </span>
                <input
                  className="planes__input"
                  placeholder="12345678"
                  inputMode="numeric"
                  value={form.dni}
                  onChange={handleChange('dni')}
                />
              </label>
            )}
          </div>

          {mode === 'plan' && (
            <div className="planes__medios">
              <button
                type="button"
                className={`planes__medio${medio === 'online' ? ' planes__medio--on' : ''}`}
                onClick={() => setMedio('online')}
              >
                <span className="planes__medio-title">Pago único</span>
                <span className="planes__medio-desc">Tarjeta de crédito · Mercado Pago</span>
              </button>
              <button type="button" className="planes__medio planes__medio--off" disabled>
                <span className="planes__medio-title">Débito automático</span>
                <span className="planes__medio-desc">Próximamente</span>
              </button>
            </div>
          )}

          {submitError && (
            <div className="planes__co-error">
              <ErrorBanner message={submitError} />
            </div>
          )}

          <button type="submit" className="planes__co-cta" disabled={submitting}>
            {submitting ? 'Redirigiendo a Mercado Pago…' : 'Pagar y reservar'}
          </button>
          <p className="planes__co-secure">
            Al continuar aceptás los términos y condiciones de CLIC. El pago se
            procesa de forma segura a través de Mercado Pago.
          </p>
        </form>
      )}

        </div>
      </div>
    </div>
  );
}
