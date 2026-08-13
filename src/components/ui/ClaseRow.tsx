import { useState } from 'react';
import type { Clase } from '../../types';
import { formatTime, nombreConInicial } from '../../lib/format';
import './ClaseRow.css';

interface Props {
  clase: Clase;
  /** Tocar la fila abre el checkout de prueba con esta clase ya elegida. La
   *  página es la que sabe cómo hacerlo (y la que mide el begin_checkout). */
  onElegir: (clase: Clase) => void;
  /** Es la clase que ya venía elegida (al volver del paso de datos). */
  elegida?: boolean;
}

export function ClaseRow({ clase, onElegir, elegida = false }: Props) {
  const cupos = clase.cuposDisponibles;
  const desc = clase.actividad.descripcion;
  const profe = nombreConInicial(clase.instructor);
  const [open, setOpen] = useState(false);

  return (
    // La fila entera es el control que elige la clase, pero adentro vive el
    // toggle "+ info": un <button> dentro de otro <button> es HTML inválido,
    // así que el contenedor se comporta como botón sin serlo.
    <div
      role="button"
      tabIndex={0}
      aria-pressed={elegida}
      className={`clase-row${open ? ' clase-row--open' : ''}${elegida ? ' clase-row--elegida' : ''}`}
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
        <p className="clase-row__meta">
          {profe ? `con ${profe}` : 'Instructora a confirmar'}
        </p>
      </div>
      <div className={`clase-row__cupos${cupos === 0 ? ' clase-row__cupos--agotado' : ''}`}>
        <span className="clase-row__cupos-lbl">
          {elegida ? '✓ Elegida' : cupos > 0 ? 'Reserva ahora' : 'No disponible'}
        </span>
      </div>
      <span className="clase-row__arrow" aria-hidden="true">→</span>
      {/* La descripción es hermana del cuerpo, no hija: abierta ocupa el ancho
          completo de la fila y empuja el botón de reservar abajo, en vez de
          apretarse en la columna del medio. */}
      {desc && (
        <div
          className={`clase-row__desc-wrap${open ? ' clase-row__desc-wrap--open' : ''}`}
          // Leer la descripción no es querer reservar: sin esto, tocar el
          // texto que se acaba de abrir manda al paso de datos.
          onClick={(e) => e.stopPropagation()}
        >
          <div className="clase-row__desc-inner">
            <p className="clase-row__desc">{desc}</p>
          </div>
        </div>
      )}
    </div>
  );
}
