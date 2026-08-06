import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getClases, getSedes } from '../api/client';
import type { Clase, Sede as SedeT } from '../types';
import { Iso } from '../components/brand/Iso';
import { Loading } from '../components/ui/Loading';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { ClaseRow } from '../components/ui/ClaseRow';
import { SedeGaleria } from '../components/ui/SedeGaleria';
import { dayKey, formatDayChip, formatDayLong, formatPrice } from '../lib/format';
import { trackVenta } from '../lib/analytics';
import { trackMetaEvent } from '../lib/meta';
import './Sede.css';

type State =
  | { status: 'loading' }
  | { status: 'notfound' }
  | { status: 'error'; message: string }
  | { status: 'ok'; sede: SedeT; clases: Clase[] };

export default function Sede() {
  const { slug } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [selectedActividadId, setSelectedActividadId] = useState<number | null>(
    null,
  );
  const [selectedDia, setSelectedDia] = useState<string | null>(null);
  const [showSticky, setShowSticky] = useState(false);
  const clasesRef = useRef<HTMLDivElement>(null);

  const scrollToClases = () => {
    clasesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    const onScroll = () => {
      const hero = document.querySelector('.sede__hero');
      if (hero) {
        setShowSticky(hero.getBoundingClientRect().bottom < 0);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const load = () => {
    if (!slug) return;
    setState({ status: 'loading' });
    setSelectedActividadId(null);
    setSelectedDia(null);
    getSedes()
      .then(async (sedes) => {
        const sede = sedes.find((s) => s.slug === slug);
        if (!sede) {
          setState({ status: 'notfound' });
          return;
        }
        const clases = await getClases(sede.id);
        setState({ status: 'ok', sede, clases });
      })
      .catch((err) =>
        setState({
          status: 'error',
          message:
            err instanceof ApiError
              ? err.message
              : 'No pudimos cargar las clases.',
        }),
      );
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [slug]);

  // Registrar la vista de la sede (contenido + oferta) una vez cargada.
  useEffect(() => {
    if (state.status !== 'ok') return;
    const params: Record<string, unknown> = {
      content_name: state.sede.nombre,
      content_category: 'sede',
    };
    if (state.sede.precioPrueba != null) {
      params.value = state.sede.precioPrueba;
      params.currency = 'ARS';
    }
    trackMetaEvent('ViewContent', params, undefined, state.sede.slug);

    // El equivalente en GA4, que además abre el embudo de ecommerce
    // (view_item → begin_checkout → add_payment_info → purchase).
    trackVenta('view_item', {
      nombre: `Clase de prueba - ${state.sede.nombre}`,
      categoria: 'Trial',
      sede: state.sede.nombre,
      sedeSlug: state.sede.slug,
      precio: state.sede.precioPrueba,
    });
  }, [state]);

  // Los dos filtros (día y actividad) se cuentan cruzados: cada uno muestra
  // cuántas clases quedarían si se aplicara sobre el otro. Las opciones que
  // dan cero se deshabilitan en vez de desaparecer, así la tira no cambia de
  // largo al filtrar y no se puede llegar a una combinación vacía.

  // Distinct activities present in the class list, with counts. Used to
  // render the filter pills. Sorted by total desc (no por el contador visible)
  // para que las pills no se reordenen al cambiar de día.
  const actividades = useMemo(() => {
    if (state.status !== 'ok') return [];
    const map = new Map<
      number,
      { id: number; nombre: string; color: string; count: number; total: number }
    >();
    for (const c of state.clases) {
      let entry = map.get(c.actividad.id);
      if (!entry) {
        entry = {
          id: c.actividad.id,
          nombre: c.actividad.nombre,
          color: c.actividad.color,
          count: 0,
          total: 0,
        };
        map.set(c.actividad.id, entry);
      }
      entry.total += 1;
      if (selectedDia == null || dayKey(c.inicio) === selectedDia) {
        entry.count += 1;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [state, selectedDia]);

  // Días con clases, en orden cronológico. Es el selector que evita scrolear
  // toda la grilla para llegar a una clase de dentro de tres días.
  const dias = useMemo(() => {
    if (state.status !== 'ok') return [];
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const c of state.clases) {
      const key = dayKey(c.inicio);
      let entry = map.get(key);
      if (!entry) {
        entry = { key, label: formatDayChip(c.inicio), count: 0 };
        map.set(key, entry);
      }
      if (selectedActividadId == null || c.actividad.id === selectedActividadId) {
        entry.count += 1;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [state, selectedActividadId]);

  const clasesDelDia = actividades.reduce((sum, a) => sum + a.count, 0);
  const clasesDeActividad = dias.reduce((sum, d) => sum + d.count, 0);

  const filteredClases = useMemo(() => {
    if (state.status !== 'ok') return [];
    return state.clases.filter(
      (c) =>
        (selectedActividadId == null ||
          c.actividad.id === selectedActividadId) &&
        (selectedDia == null || dayKey(c.inicio) === selectedDia),
    );
  }, [state, selectedActividadId, selectedDia]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Clase[]>();
    for (const clase of filteredClases) {
      const key = dayKey(clase.inicio);
      const arr = groups.get(key) ?? [];
      arr.push(clase);
      groups.set(key, arr);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, clases]) => ({
        key,
        label: formatDayLong(clases[0].inicio),
        clases: clases.sort((a, b) => a.inicio.localeCompare(b.inicio)),
      }));
  }, [filteredClases]);

  if (state.status === 'loading') {
    return (
      <div className="container">
        <Loading label="Cargando sede" />
      </div>
    );
  }

  if (state.status === 'notfound') {
    return (
      <div className="container sede-empty">
        <p className="t-tag">Sede no encontrada</p>
        <h1 className="t-display" style={{ fontSize: 44, marginTop: 8 }}>
          Esa sede no existe
        </h1>
        <p className="t-muted" style={{ marginTop: 14 }}>
          La sede que buscás no está disponible o fue movida.
        </p>
        <Link to="/" className="sede-empty__link">
          Ver todas las sedes →
        </Link>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="container">
        <ErrorBanner message={state.message} onRetry={load} />
      </div>
    );
  }

  const { sede, clases } = state;

  // La imagen de cabecera abre el carrusel y la galería la continúa.
  // Set dedupe por si el estudio subió la misma foto en ambos lados.
  const heroImages = Array.from(
    new Set([...(sede.imagenUrl ? [sede.imagenUrl] : []), ...sede.fotos]),
  );

  return (
    <div className="container sede">
      <div className="sede__back">
        <Link to="/" className="sede__back-link">
          ← Ver todas las sedes
        </Link>
      </div>

      <section className="sede__hero">
        <div className="sede__hero-media">
          <SedeGaleria
            key={sede.id}
            images={heroImages}
            sedeNombre={sede.nombre}
            fallback={
              <div className="sede__hero-fallback">
                <Iso variant="white" size={88} />
              </div>
            }
          />
        </div>
        <div className="sede__hero-body">
          <p className="t-tag" style={{ color: 'var(--taupe)' }}>
            {sede.ciudad}
          </p>
          <h1 className="sede__hero-title t-display">{sede.nombre}</h1>
          <p className="sede__hero-addr">{sede.direccion}</p>

          {sede.descripcion && (
            <p className="sede__hero-desc">{sede.descripcion}</p>
          )}

          {/* Offer + CTA */}
          <div className="sede__hero-offer">
            <div className="sede__hero-offer-text">
              <span className="sede__hero-offer-label">Tu primera clase</span>
              <span className="sede__hero-offer-price">
                {formatPrice(sede.precioPrueba)}
              </span>
              <span className="sede__hero-offer-note">
                Se descuenta de tu plan si te quedás
              </span>
            </div>
            <button
              type="button"
              className="sede__hero-cta"
              onClick={scrollToClases}
            >
              Reservar clase de prueba
            </button>
          </div>

          {/* Secondary links */}
          <div className="sede__hero-links-row">
            <Link to={`/sede/${slug}/precios`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/>
              </svg>
              Ver precios
            </Link>
            {sede.whatsappUrl && (
              <a href={sede.whatsappUrl} target="_blank" rel="noreferrer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                WhatsApp
              </a>
            )}
            {sede.googleMapsUrl && (
              <a href={sede.googleMapsUrl} target="_blank" rel="noreferrer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z" />
                </svg>
                Cómo llegar
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="sede__clases" id="clases" ref={clasesRef}>
        <div className="sede__clases-head">
          <p className="t-tag">It's pilates time</p>
          <h2 className="t-display sede__clases-title">Próximas clases</h2>
          <p className="sede__clases-sub">
            Tocá un horario para reservar tu clase de prueba.
          </p>
        </div>

        {dias.length > 1 && (
          <div
            className="sede__filters sede__filters--dias"
            role="tablist"
            aria-label="Filtrar por día"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedDia === null}
              className={`sede__pill${selectedDia === null ? ' sede__pill--active' : ''}`}
              onClick={() => setSelectedDia(null)}
            >
              <span>Todos</span>
              <span className="sede__pill-count">{clasesDeActividad}</span>
            </button>
            {dias.map((dia) => {
              const active = selectedDia === dia.key;
              return (
                <button
                  key={dia.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={dia.count === 0}
                  className={`sede__pill${active ? ' sede__pill--active' : ''}`}
                  onClick={() => setSelectedDia(dia.key)}
                >
                  <span>{dia.label}</span>
                  <span className="sede__pill-count">{dia.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {actividades.length > 1 && (
          <div
            className="sede__filters"
            role="tablist"
            aria-label="Filtrar por actividad"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedActividadId === null}
              className={`sede__pill${selectedActividadId === null ? ' sede__pill--active' : ''}`}
              onClick={() => setSelectedActividadId(null)}
            >
              <span>Todas</span>
              <span className="sede__pill-count">{clasesDelDia}</span>
            </button>
            {actividades.map((act) => {
              const active = selectedActividadId === act.id;
              return (
                <button
                  key={act.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={act.count === 0}
                  className={`sede__pill${active ? ' sede__pill--active' : ''}`}
                  onClick={() => setSelectedActividadId(act.id)}
                >
                  <span
                    className="sede__pill-dot"
                    style={{ background: act.color || 'var(--taupe)' }}
                    aria-hidden="true"
                  />
                  <span>{act.nombre}</span>
                  <span className="sede__pill-count">{act.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {clases.length === 0 ? (
          <div className="sede__empty">
            <p className="t-display" style={{ fontSize: 24 }}>
              No hay clases disponibles
            </p>
            <p className="t-muted" style={{ marginTop: 8 }}>
              Los cupos de los próximos 14 días ya están tomados. Probá más tarde
              o escribinos por WhatsApp.
            </p>
          </div>
        ) : filteredClases.length === 0 ? (
          <div className="sede__empty">
            <p className="t-display" style={{ fontSize: 22 }}>
              No hay clases con estos filtros
            </p>
            <p className="t-muted" style={{ marginTop: 8 }}>
              Probá con otro día u otra actividad.
            </p>
            <button
              type="button"
              className="sede__empty-btn"
              onClick={() => {
                setSelectedActividadId(null);
                setSelectedDia(null);
              }}
            >
              Ver todas las clases
            </button>
          </div>
        ) : (
          <div className="sede__days">
            {grouped.map((group) => (
              <div key={group.key} className="sede__day">
                <p className="sede__day-label">{group.label}</p>
                <div className="sede__day-list">
                  {group.clases.map((clase) => (
                    <ClaseRow key={clase.id} clase={clase} sede={sede} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showSticky && (
        <div className="sede__sticky-bar">
          <div className="sede__sticky-info">
            <span className="sede__sticky-label">Clase de prueba</span>
            <span className="sede__sticky-price">
              {formatPrice(sede.precioPrueba)}
            </span>
          </div>
          <button
            type="button"
            className="sede__sticky-btn"
            onClick={scrollToClases}
          >
            Reservar
          </button>
        </div>
      )}
    </div>
  );
}
