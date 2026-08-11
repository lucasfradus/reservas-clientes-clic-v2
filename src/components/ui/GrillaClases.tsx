import { useMemo, useState } from 'react';
import type { Clase } from '../../types';
import { ClaseRow } from './ClaseRow';
import { dayKey, formatDayChip, formatDayLong } from '../../lib/format';
import './GrillaClases.css';

interface Props {
  clases: Clase[];
  /** Se llama al tocar un horario. La página decide qué hacer (abrir el
   *  checkout de prueba con esa clase ya elegida). */
  onElegir: (clase: Clase) => void;
}

/**
 * Grilla de próximas clases con filtros por día y por actividad.
 *
 * Los dos filtros se cuentan cruzados: cada uno muestra cuántas clases
 * quedarían si se aplicara sobre el otro. Las opciones que dan cero se
 * deshabilitan en vez de desaparecer, así la tira no cambia de largo al
 * filtrar y no se puede llegar a una combinación vacía.
 */
export function GrillaClases({ clases, onElegir }: Props) {
  const [actividadId, setActividadId] = useState<number | null>(null);
  // Arranca en el primer día con clases y no en "Todos": son 14 días de
  // agenda, y sin filtro la sección le suma ~12.000px a la página. "Todos"
  // sigue estando en la tira para quien quiera ver todo de una.
  const [diaSel, setDiaSel] = useState<string | null>(() => {
    let primero: string | null = null;
    for (const c of clases) {
      const k = dayKey(c.inicio);
      if (primero == null || k < primero) primero = k;
    }
    return primero;
  });

  // Actividades presentes, con contador. Ordenadas por total desc (no por el
  // contador visible) para que las pills no se reordenen al cambiar de día.
  const actividades = useMemo(() => {
    const map = new Map<
      number,
      { id: number; nombre: string; color: string; count: number; total: number }
    >();
    for (const c of clases) {
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
      if (diaSel == null || dayKey(c.inicio) === diaSel) entry.count += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [clases, diaSel]);

  // Días con clases, en orden cronológico. Es el selector que evita scrolear
  // toda la grilla para llegar a una clase de dentro de tres días.
  const dias = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const c of clases) {
      const key = dayKey(c.inicio);
      let entry = map.get(key);
      if (!entry) {
        entry = { key, label: formatDayChip(c.inicio), count: 0 };
        map.set(key, entry);
      }
      if (actividadId == null || c.actividad.id === actividadId) entry.count += 1;
    }
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [clases, actividadId]);

  const clasesDelDia = actividades.reduce((sum, a) => sum + a.count, 0);
  const clasesDeActividad = dias.reduce((sum, d) => sum + d.count, 0);

  const filtradas = useMemo(
    () =>
      clases.filter(
        (c) =>
          (actividadId == null || c.actividad.id === actividadId) &&
          (diaSel == null || dayKey(c.inicio) === diaSel),
      ),
    [clases, actividadId, diaSel],
  );

  const grupos = useMemo(() => {
    const map = new Map<string, Clase[]>();
    for (const clase of filtradas) {
      const key = dayKey(clase.inicio);
      const arr = map.get(key) ?? [];
      arr.push(clase);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, delDia]) => ({
        key,
        label: formatDayLong(delDia[0].inicio),
        clases: delDia.sort((a, b) => a.inicio.localeCompare(b.inicio)),
      }));
  }, [filtradas]);

  if (clases.length === 0) {
    return (
      <div className="grilla__empty">
        <p className="grilla__empty-title">No hay clases disponibles</p>
        <p className="grilla__empty-sub">
          Los cupos de los próximos 14 días ya están tomados. Probá más tarde o
          escribinos por WhatsApp.
        </p>
      </div>
    );
  }

  return (
    <>
      {dias.length > 1 && (
        <div
          className="grilla__filtros grilla__filtros--dias"
          role="tablist"
          aria-label="Filtrar por día"
        >
          <button
            type="button"
            role="tab"
            aria-selected={diaSel === null}
            className={`grilla__pill${diaSel === null ? ' grilla__pill--active' : ''}`}
            onClick={() => setDiaSel(null)}
          >
            <span>Todos</span>
            <span className="grilla__pill-count">{clasesDeActividad}</span>
          </button>
          {dias.map((dia) => {
            const active = diaSel === dia.key;
            return (
              <button
                key={dia.key}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={dia.count === 0}
                className={`grilla__pill${active ? ' grilla__pill--active' : ''}`}
                onClick={() => setDiaSel(dia.key)}
              >
                <span>{dia.label}</span>
                <span className="grilla__pill-count">{dia.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {actividades.length > 1 && (
        <div
          className="grilla__filtros"
          role="tablist"
          aria-label="Filtrar por actividad"
        >
          <button
            type="button"
            role="tab"
            aria-selected={actividadId === null}
            className={`grilla__pill${actividadId === null ? ' grilla__pill--active' : ''}`}
            onClick={() => setActividadId(null)}
          >
            <span>Todas</span>
            <span className="grilla__pill-count">{clasesDelDia}</span>
          </button>
          {actividades.map((act) => {
            const active = actividadId === act.id;
            return (
              <button
                key={act.id}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={act.count === 0}
                className={`grilla__pill${active ? ' grilla__pill--active' : ''}`}
                onClick={() => setActividadId(act.id)}
              >
                <span
                  className="grilla__pill-dot"
                  style={{ background: act.color || 'var(--taupe)' }}
                  aria-hidden="true"
                />
                <span>{act.nombre}</span>
                <span className="grilla__pill-count">{act.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {filtradas.length === 0 ? (
        <div className="grilla__empty">
          <p className="grilla__empty-title">No hay clases con estos filtros</p>
          <p className="grilla__empty-sub">Probá con otro día u otra actividad.</p>
          <button
            type="button"
            className="grilla__empty-btn"
            onClick={() => {
              setActividadId(null);
              setDiaSel(null);
            }}
          >
            Ver todas las clases
          </button>
        </div>
      ) : (
        <div className="grilla__days">
          {grupos.map((grupo) => (
            <div key={grupo.key} className="grilla__day">
              <p className="grilla__day-label">{grupo.label}</p>
              <div className="grilla__day-list">
                {grupo.clases.map((clase) => (
                  <ClaseRow key={clase.id} clase={clase} onElegir={onElegir} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
