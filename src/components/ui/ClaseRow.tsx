import { useState } from 'react';
import type { Clase } from '../../types';
import { formatTime } from '../../lib/format';
import './ClaseRow.css';

interface Props {
  clase: Clase;
  /** Tocar la fila abre el checkout de prueba con esta clase ya elegida. La
   *  página es la que sabe cómo hacerlo (y la que mide el begin_checkout). */
  onElegir: (clase: Clase) => void;
}

export function ClaseRow({ clase, onElegir }: Props) {
  const cupos = clase.cuposDisponibles;
  const desc = clase.actividad.descripcion;
  const [open, setOpen] = useState(false);

  return (
    // La fila entera es el control que elige la clase, pero adentro vive el
    // toggle "+ info": un <button> dentro de otro <button> es HTML inválido,
    // así que el contenedor se comporta como botón sin serlo.
    <div
      role="button"
      tabIndex={0}
      className="clase-row"
      onClick={() => onElegir(clase)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onElegir(clase);
        }
      }}
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
    </div>
  );
}
