import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Clase, Sede } from '../../types';
import { formatTime } from '../../lib/format';
import { trackEvent } from '../../lib/analytics';
import './ClaseRow.css';

export function ClaseRow({ clase, sede }: { clase: Clase; sede: Sede }) {
  const cupos = clase.cuposDisponibles;
  const desc = clase.actividad.descripcion;
  const [open, setOpen] = useState(false);

  return (
    <Link
      to={`/sede/${sede.slug}/precios`}
      state={{ mode: 'prueba', clase }}
      className="clase-row"
      onClick={() =>
        trackEvent('begin_reserva', {
          clase_id: clase.id,
          sede_slug: sede.slug,
          sede_nombre: sede.nombre,
          actividad: clase.actividad.nombre,
        })
      }
    >
      <div className="clase-row__time">{formatTime(clase.inicio)}</div>
      <div className="clase-row__body">
        <p className="clase-row__name t-display">{clase.actividad.nombre}</p>
        {desc && (
          <button
            type="button"
            className={`clase-row__info-btn${open ? ' clase-row__info-btn--open' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(!open);
            }}
          >
            {open ? '− info' : '+ info'}
          </button>
        )}
        {desc && (
          <div className={`clase-row__desc-wrap${open ? ' clase-row__desc-wrap--open' : ''}`}>
            <div className="clase-row__desc-inner">
              <p className="clase-row__desc">{desc}</p>
            </div>
          </div>
        )}
        <p className="clase-row__meta">
          {clase.instructor ? `con ${clase.instructor}` : 'Instructora a confirmar'}
          {clase.salon ? ` · ${clase.salon.nombre}` : ''}
        </p>
      </div>
      <div className={`clase-row__cupos${cupos === 0 ? ' clase-row__cupos--agotado' : ''}`}>
        <span className="clase-row__cupos-lbl">
          {cupos > 0 ? 'Reserva ahora' : 'No disponible'}
        </span>
      </div>
      <span className="clase-row__arrow" aria-hidden="true">→</span>
    </Link>
  );
}
