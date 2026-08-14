import { useRef, useState, type ReactNode } from 'react';
import './SedeGaleria.css';

interface Props {
  images: string[];
  sedeNombre: string;
  /** Qué mostrar si no hay imágenes o todas fallaron al cargar. */
  fallback?: ReactNode;
}

/** Los anchos que el backend genera al subir la foto (WebP). */
const ANCHOS = [640, 1280, 2000] as const;

/**
 * Cuánto ancho ocupa el hero en cada tamaño de pantalla. En mobile es todo el
 * viewport; desde 1024 el hero es una tarjeta de 976px y la foto es el 44%.
 */
const SIZES = '(min-width: 1024px) 430px, 100vw';

/**
 * Le pide al storage la variante de ese ancho. Si el original no vive en
 * nuestro bucket (URL externa cargada a mano), se devuelve tal cual: el
 * parámetro no le haría nada.
 */
function anchoDe(url: string, w: number): string {
  if (!url.includes('/api/storage/')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}w=${w}`;
}

/**
 * Carrusel de fotos que llena el contenedor donde se monta (el media del
 * hero de la sede). Usa scroll-snap nativo, así el swipe en mobile es el
 * gesto del sistema; las flechas y los puntos solo complementan en desktop.
 * Con una sola imagen se comporta como un <img> estático, sin controles.
 */
export function SedeGaleria({ images, sedeNombre, fallback }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [broken, setBroken] = useState<ReadonlySet<number>>(new Set());

  const visibles = images
    .map((url, index) => ({ url, index }))
    .filter(({ index }) => !broken.has(index));

  if (visibles.length === 0) return <>{fallback ?? null}</>;

  const markBroken = (index: number) =>
    setBroken((prev) => new Set(prev).add(index));

  const onScroll = () => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    setActive(Math.round(track.scrollLeft / track.clientWidth));
  };

  const scrollTo = (i: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className="galeria" role="group" aria-label={`Fotos de ${sedeNombre}`}>
      <div className="galeria__track" ref={trackRef} onScroll={onScroll}>
        {visibles.map(({ url, index }, i) => (
          <div className="galeria__slide" key={index}>
            <img
              src={anchoDe(url, 1280)}
              srcSet={ANCHOS.map((w) => `${anchoDe(url, w)} ${w}w`).join(', ')}
              sizes={SIZES}
              alt={`${sedeNombre} — foto ${i + 1} de ${visibles.length}`}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              onError={() => markBroken(index)}
            />
          </div>
        ))}
      </div>

      {visibles.length > 1 && (
        <>
          <button
            type="button"
            className="galeria__arrow galeria__arrow--prev"
            onClick={() => scrollTo(active - 1)}
            disabled={active <= 0}
            aria-label="Foto anterior"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            className="galeria__arrow galeria__arrow--next"
            onClick={() => scrollTo(active + 1)}
            disabled={active >= visibles.length - 1}
            aria-label="Foto siguiente"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <div className="galeria__dots">
            {visibles.map((foto, i) => (
              <button
                key={foto.index}
                type="button"
                className={`galeria__dot${i === active ? ' galeria__dot--active' : ''}`}
                onClick={() => scrollTo(i)}
                aria-label={`Ir a la foto ${i + 1}`}
                aria-current={i === active}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
