import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Sede } from '../../types';
import { formatPrice } from '../../lib/format';
import { trackEvent } from '../../lib/analytics';
import { Iso } from '../brand/Iso';
import './SedeCard.css';

export function SedeCard({ sede }: { sede: Sede }) {
  const [imgBroken, setImgBroken] = useState(false);
  const showImg = sede.imagenUrl && !imgBroken;

  return (
    <Link
      to={`/sede/${sede.slug}`}
      className="sede-card"
      onClick={() =>
        trackEvent('select_sede', {
          sede: sede.nombre,
          sede_slug: sede.slug,
        })
      }
    >
      <div className="sede-card__media">
        {showImg ? (
          <img
            src={sede.imagenUrl!}
            alt={sede.nombre}
            onError={() => setImgBroken(true)}
          />
        ) : (
          <div className="sede-card__fallback">
            <Iso variant="taupe" size={56} />
          </div>
        )}
      </div>
      <div className="sede-card__body">
        <p className="t-tag">{sede.ciudad}</p>
        <h3 className="sede-card__name t-display">{sede.nombre}</h3>
        <p className="sede-card__addr">{sede.direccion}</p>
        <div className="sede-card__foot">
          <div>
            <p className="sede-card__price-label">Clase de prueba</p>
            <p className="sede-card__price">{formatPrice(sede.precioPrueba)}</p>
          </div>
          <span className="sede-card__cta">
            Ver clases <span aria-hidden="true">→</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
