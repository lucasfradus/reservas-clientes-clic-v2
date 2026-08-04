import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
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
import {
  dayKey,
  formatDayShort,
  formatPrice,
  formatTime,
} from '../lib/format';
import { trackEvent } from '../lib/analytics';
import { trackMetaEvent } from '../lib/meta';
import './Planes.css';

/**
 * Landing de planes + checkout. Port del prototipo de Claude Design
 * "CLIC Landing planes". Reemplaza las páginas Precios y Reservar.
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
  | { status: 'ok'; sede: Sede; tipos: CatalogoTipoPlan[]; clases: Clase[] };

type HorariosState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ok'; horarios: HorarioFijable[] };

interface LocationState {
  mode?: Mode;
  clase?: Clase;
}

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
  const location = useLocation();
  const preload = (location.state ?? {}) as LocationState;
  const planesRef = useRef<HTMLDivElement>(null);

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });

  // ── Navegación interna ────────────────────────────────────────────────
  const [screen, setScreen] = useState<Screen>('landing');
  const [mode, setMode] = useState<Mode>('plan');
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
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
    trackEvent('view_planes', { sede_slug: slug });
  }, [slug]);

  // Si llegan con una clase preseleccionada (desde el listado de la sede),
  // abrimos directo el checkout de prueba en el paso de datos.
  const preloadApplied = useRef(false);
  useEffect(() => {
    if (preloadApplied.current || load.status !== 'ok') return;
    if (preload.mode === 'prueba' && preload.clase) {
      preloadApplied.current = true;
      setMode('prueba');
      setScreen('checkout');
      setDia(dayKey(preload.clase.inicio));
      setSel([String(preload.clase.id)]);
      setStep(2);
    }
  }, [load.status, preload.mode, preload.clase]);

  // ── Derivados ─────────────────────────────────────────────────────────
  const tipos = load.status === 'ok' ? load.tipos : [];
  const clases = load.status === 'ok' ? load.clases : [];
  const sede = load.status === 'ok' ? load.sede : undefined;

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

  const beneficios = useMemo(() => {
    const set = new Set<string>();
    for (const t of tipos) for (const c of t.caracteristicas) set.add(c);
    return set.size > 0 ? Array.from(set).slice(0, 6) : BENEFICIOS_FALLBACK;
  }, [tipos]);

  const tipoSel = useMemo(
    () => tipos.find((t) => t.id === tipoId) ?? null,
    [tipos, tipoId],
  );

  const flex = modalidad === 'flex';
  const necesarios =
    mode === 'prueba' ? 1 : flex ? 0 : tipoSel?.fijo.ingresosPorSemana ?? 1;

  const horariosData = horarios.status === 'ok' ? horarios.horarios : [];
  const horarioPorId = useMemo(() => {
    const m = new Map<string, HorarioFijable>();
    for (const h of horariosData) m.set(String(h.id), h);
    return m;
  }, [horariosData]);

  // Clases reales por día (modo prueba).
  const clasesPorDia = useMemo(() => {
    const map = new Map<string, Clase[]>();
    for (const c of clases) {
      const k = dayKey(c.inicio);
      const arr = map.get(k) ?? [];
      arr.push(c);
      map.set(k, arr);
    }
    return map;
  }, [clases]);

  // Días para las chips: prueba → días reales con clases; plan-fijo → días de la
  // semana con horarios fijables.
  const diasChips = useMemo(() => {
    if (mode === 'prueba') {
      return Array.from(clasesPorDia.keys())
        .sort()
        .map((k) => ({ key: k, label: formatDayShort(clasesPorDia.get(k)![0].inicio) }));
    }
    const dias = Array.from(new Set(horariosData.map((h) => h.diaSemana)));
    return dias
      .sort((a, b) => DIA_INFO[a].orden - DIA_INFO[b].orden)
      .map((d) => ({ key: d as string, label: DIA_INFO[d].corto }));
  }, [mode, clasesPorDia, horariosData]);

  // Fijar el día activo cuando aparece la grilla.
  useEffect(() => {
    if (screen !== 'checkout' || step !== 1) return;
    if (mode === 'plan' && modalidad !== 'fijo') return;
    if (dia && diasChips.some((d) => d.key === dia)) return;
    if (diasChips.length > 0) setDia(diasChips[0].key);
  }, [screen, step, mode, modalidad, dia, diasChips]);

  // Slots del día activo.
  const slots = useMemo(() => {
    if (mode === 'prueba') {
      const arr = clasesPorDia.get(dia) ?? [];
      return arr.map((c) => ({
        key: String(c.id),
        hora: formatTime(c.inicio),
        cupos: c.cuposDisponibles,
      }));
    }
    return horariosData
      .filter((h) => (h.diaSemana as string) === dia)
      .map((h) => ({
        key: String(h.id),
        hora: hhmm(h.horaInicio),
        cupos: h.cuposAprox ?? h.cupo,
      }));
  }, [mode, dia, clasesPorDia, horariosData]);

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
      if (mode === 'prueba') return cur.includes(key) ? [] : [key];
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
    trackEvent('begin_prueba', { sede_slug: slug });
    scrollTop();
  };

  const empezarPlan = (t: CatalogoTipoPlan) => {
    setMode('plan');
    setTipoId(t.id);
    setModalidad(null);
    setMedio('online');
    setSel([]);
    setDia('');
    setHorarios({ status: 'idle' });
    setStep(1);
    setScreen('checkout');
    trackEvent('begin_plan', { sede_slug: slug, plan: t.nombre });
    scrollTop();
  };

  // Cargar los horarios fijables reales al elegir "horarios fijos".
  useEffect(() => {
    if (mode !== 'plan' || modalidad !== 'fijo' || !tipoSel || !sede) return;
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
  const preciosPlanSel = flex ? tipoSel?.flexible?.precios : tipoSel?.precios;
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
      setStep((s) => (s - 1) as 1 | 2 | 3);
    }
    scrollTop();
  };

  const handleChange =
    (field: keyof typeof form) => (e: FormEvent<HTMLInputElement>) => {
      const value = (e.target as HTMLInputElement).value;
      setForm((f) => ({ ...f, [field]: value }));
      if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    };

  const continuar2 = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = validate(form);
    if (Object.keys(v).length > 0) {
      setErrors(v);
      return;
    }
    setStep(3);
    scrollTop();
  };

  // Pago del PLAN: real, vía checkoutPlan() → Mercado Pago.
  const pagarPlan = async () => {
    if (!sede || !tipoSel || submitting) return;
    const planId = flex ? tipoSel.flexible?.planId : tipoSel.fijo.planId;
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
      const params: Record<string, unknown> = {
        content_name: tipoSel.nombre,
        content_category: sede.nombre,
        currency: 'ARS',
      };
      if (precioCheckout != null) params.value = precioCheckout;
      trackMetaEvent('InitiateCheckout', params);
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
      });
      const clase = clases.find((c) => c.id === claseId);
      const params: Record<string, unknown> = {
        content_name: clase?.actividad.nombre ?? 'Clase de prueba',
        content_category: sede.nombre,
      };
      if (sede.precioPrueba != null) {
        params.value = sede.precioPrueba;
        params.currency = 'ARS';
      }
      trackMetaEvent('InitiateCheckout', params);
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

  const heroImg = sede?.imagenUrl ?? sede?.fotos[0] ?? null;

  // ══════════════════════════════ LANDING ══════════════════════════════
  if (screen === 'landing') {
    return (
      <div className="planes">
        {/* Hero: clase de prueba */}
        <section className="planes__hero">
          {heroImg && (
            <div
              className="planes__hero-media"
              style={{ backgroundImage: `url(${heroImg})` }}
              aria-hidden="true"
            />
          )}
          <div className="planes__hero-body">
            <span className="planes__eyebrow planes__eyebrow--light">
              {sede?.ciudad}
            </span>
            <h1 className="planes__hero-name">{sede?.nombre}</h1>
            <p className="planes__hero-addr">{sede?.direccion}</p>

            <span className="planes__eyebrow planes__eyebrow--light planes__hero-gap">
              Tu primera clase
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
              Ya entreno reformer → ver planes
            </button>
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
          <h2 className="planes__intro-title">Tu lugar en el reformer, todo el mes</h2>
          <p className="planes__intro-sub">
            Elegí tu ritmo y empezá esta semana. Pagás online y reservás tus
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
            <p className="planes__toggle-note">
              Precios pagando con efectivo o transferencia · {sede?.nombre}
            </p>
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
              const ahorroPct =
                precio != null && tarjeta != null && tarjeta > 0 && precio < tarjeta
                  ? Math.round((1 - precio / tarjeta) * 100)
                  : null;
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
                      Ahorrás {ahorroPct}% vs crédito
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
      </div>
    );
  }

  // ══════════════════════════════ CHECKOUT ══════════════════════════════
  const pasosDef = ['1 · Horarios', '2 · Datos', '3 · Pago'];
  const precioSel = tipoSel ? precioLista(tipoSel) : sede?.precioPrueba ?? null;
  const selOrdenado = [...sel].sort((a, b) => a.localeCompare(b));

  return (
    <div className="planes planes--checkout">
      {/* Header del checkout */}
      <div className="planes__co-head">
        <button type="button" className="planes__co-back" onClick={volver} aria-label="Volver">
          ←
        </button>
        {step < 4 && (
          <div className="planes__steps">
            {pasosDef.map((label, i) => {
              const n = i + 1;
              const state = step === n ? 'active' : step > n ? 'done' : 'todo';
              // En modo prueba el paso 1 es "elegir clase", no "horarios".
              const txt =
                mode === 'prueba' && n === 1 ? '1 · Clase' : label;
              return (
                <span key={label} className={`planes__step planes__step--${state}`}>
                  {txt}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Paso 1 ── */}
      {step === 1 && (
        <div className="planes__co-body">
          {mode === 'plan' && (
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

          {mode === 'prueba' && (
            <h2 className="planes__co-title">Elegí tu clase de prueba</h2>
          )}

          {/* Grilla de horarios (prueba o plan con horarios fijos) */}
          {(mode === 'prueba' || (mode === 'plan' && modalidad === 'fijo')) && (
            <div className="planes__grid-wrap">
              <div className="planes__grid-head">
                <h3 className="planes__grid-title">
                  {mode === 'prueba'
                    ? 'Días con lugar'
                    : necesarios === 1
                      ? 'Elegí tu horario fijo'
                      : `Elegí tus ${necesarios} horarios fijos`}
                </h3>
                <p className="planes__grid-sub">
                  {mode === 'prueba'
                    ? 'Cupos reales de los próximos 14 días.'
                    : 'Van a ser tus clases de cada semana. Mismo grupo, mismo profe.'}
                </p>
              </div>

              {mode === 'plan' && horarios.status === 'loading' ? (
                <Loading label="Cargando horarios" />
              ) : mode === 'plan' && horarios.status === 'error' ? (
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
                      const tieneSel = sel.some((k) =>
                        mode === 'prueba'
                          ? clasesPorDia.get(d.key)?.some((c) => String(c.id) === k)
                          : horarioPorId.get(k)?.diaSemana === d.key,
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
                      const cuposTxt = lleno
                        ? 'Completo'
                        : s.cupos === 1
                          ? 'Queda 1'
                          : mode === 'prueba'
                            ? `${s.cupos} lugares`
                            : `${s.cupos} lugares aprox.`;
                      return (
                        <button
                          key={s.key}
                          type="button"
                          disabled={lleno}
                          className={`planes__slot${on ? ' planes__slot--on' : ''}${lleno ? ' planes__slot--full' : ''}`}
                          onClick={() => toggleSlot(s.key)}
                        >
                          <span className="planes__slot-hora">{s.hora}</span>
                          <span className="planes__slot-cupos">{cuposTxt}</span>
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
                  : mode === 'prueba'
                    ? 'Elegí una clase'
                    : `Elegí ${necesarios - sel.length} horario${necesarios - sel.length === 1 ? '' : 's'} más`}
              </button>
            </div>
          )}

          {/* Pack flexible: sin horarios fijos, confirma y sigue */}
          {mode === 'plan' && flex && (
            <div className="planes__grid-wrap">
              <div className="planes__flex-info">
                <p className="planes__flex-title">Pack flexible</p>
                <p className="planes__flex-desc">
                  Reservás tus clases cada semana desde la app, según tu
                  disponibilidad. Sin horario fijo asignado.
                </p>
              </div>
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
      {step === 2 && (
        <form className="planes__co-body" onSubmit={continuar2} noValidate>
          <h2 className="planes__co-title">Tus datos</h2>
          <p className="planes__co-sub">
            {mode === 'prueba'
              ? 'Con esto reservamos tu lugar y te enviamos la confirmación.'
              : 'Con esto te creamos la cuenta para reservar desde la app.'}
          </p>
          <div className="planes__fields">
            <input
              className="planes__input"
              placeholder="Nombre"
              autoComplete="given-name"
              value={form.nombre}
              onChange={handleChange('nombre')}
            />
            {errors.nombre && <span className="planes__field-err">{errors.nombre}</span>}
            <input
              className="planes__input"
              placeholder="Apellido"
              autoComplete="family-name"
              value={form.apellido}
              onChange={handleChange('apellido')}
            />
            {errors.apellido && <span className="planes__field-err">{errors.apellido}</span>}
            <input
              className="planes__input"
              placeholder="Email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={handleChange('email')}
            />
            {errors.email && <span className="planes__field-err">{errors.email}</span>}
            <input
              className="planes__input"
              placeholder="Teléfono (WhatsApp)"
              type="tel"
              autoComplete="tel"
              value={form.telefono}
              onChange={handleChange('telefono')}
            />
            {errors.telefono && <span className="planes__field-err">{errors.telefono}</span>}
          </div>
          <button type="submit" className="planes__co-cta">
            Continuar al pago
          </button>
        </form>
      )}

      {/* ── Paso 3: resumen + pago ── */}
      {step === 3 && (
        <div className="planes__co-body">
          <h2 className="planes__co-title">Resumen</h2>
          <div className="planes__summary">
            <div className="planes__summary-top">
              <span className="planes__summary-plan">
                {mode === 'prueba'
                  ? clases.find((c) => String(c.id) === sel[0])?.actividad.nombre ??
                    'Clase de prueba'
                  : `${tipoSel?.etiqueta || tipoSel?.nombre}`}
              </span>
              <span className="planes__summary-sede">{sede?.nombre}</span>
            </div>
            <div className="planes__summary-line" />
            <div className="planes__summary-items">
              {mode === 'prueba'
                ? selOrdenado.map((k) => (
                    <div key={k} className="planes__summary-item">
                      <span className="planes__summary-check">✓</span>
                      {labelDeSel(k)} hs
                    </div>
                  ))
                : (flex
                    ? [
                        'Pack flexible · reservás desde la app',
                        ...selOrdenado.map((k) => `Primera clase: ${labelDeSel(k)} hs`),
                      ]
                    : selOrdenado.map((k) => `${labelDeSel(k)} hs · todas las semanas`)
                  ).map((txt, i) => (
                    <div key={i} className="planes__summary-item">
                      <span className="planes__summary-check">✓</span>
                      {txt}
                    </div>
                  ))}
            </div>
            <div className="planes__summary-line" />
            <div className="planes__summary-total">
              <span>
                Total{' '}
                {mode === 'prueba'
                  ? 'clase de prueba'
                  : periodo === 'MENSUAL'
                    ? 'mensual'
                    : 'trimestral'}
              </span>
              <span className="planes__summary-total-val">
                {formatPrice(mode === 'prueba' ? precioSel : precioCheckout)}
              </span>
            </div>
            <p className="planes__summary-fine">
              {mode === 'prueba'
                ? 'Si te quedás, este importe se descuenta de tu plan.'
                : 'Sin permanencia. Precio del pago online con tarjeta.'}
            </p>
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

          <button
            type="button"
            className="planes__co-cta"
            disabled={submitting}
            onClick={mode === 'prueba' ? pagarPrueba : pagarPlan}
          >
            {submitting ? 'Redirigiendo a Mercado Pago...' : 'Pagar con Mercado Pago'}
          </button>
          <p className="planes__co-secure">Pago seguro vía Mercado Pago</p>
        </div>
      )}

    </div>
  );
}
