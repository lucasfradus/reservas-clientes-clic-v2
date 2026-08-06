import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDayLong, formatTime } from '../lib/format';
import { trackEvent } from '../lib/analytics';
import { slugDeRuta, trackMetaEvent } from '../lib/meta';
import './Gracias.css';

// Estados de pago que devuelve Mercado Pago en `collection_status`.
type PaymentStatus = 'approved' | 'rejected' | 'pending';

function normalizeStatus(value: string | null): PaymentStatus {
  if (value === 'approved') return 'approved';
  if (value === 'rejected') return 'rejected';
  return 'pending';
}

/** Fecha en formato UTC compacto para iCalendar: YYYYMMDDTHHMMSSZ. */
function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Arma un archivo .ics con el evento de la clase (50 minutos) y lo descarga
 * como data URL. Los saltos de línea van con CRLF, como pide el estándar.
 */
function downloadIcs(opts: {
  actividad: string;
  fecha: string;
  sede: string;
  direccion: string;
  paymentId: string;
}): void {
  const start = new Date(opts.fecha);
  const end = new Date(start.getTime() + 50 * 60 * 1000);
  const location = opts.direccion ? `${opts.sede}, ${opts.direccion}` : opts.sede;
  const uid = `${opts.paymentId || 'prueba'}@clicpilates`;

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CLIC Pilates//Reservas//ES',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(start)}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${opts.actividad} - CLIC Pilates`,
    `LOCATION:${location}`,
    'DESCRIPTION:Clase de prueba en CLIC Pilates',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const a = document.createElement('a');
  a.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
  a.download = 'clase-prueba-clic.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" aria-hidden="true">
      <path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
      <path
        d="M18 6 6 18M6 6l12 12"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 7v5l3.5 2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export default function Gracias() {
  const [params] = useSearchParams();
  // `collection_status` es lo que manda MP; `status` es el fallback.
  const status = normalizeStatus(
    params.get('collection_status') ?? params.get('status'),
  );

  const actividad = params.get('actividad') ?? '';
  const fecha = params.get('fecha') ?? '';
  const sede = params.get('sede') ?? '';
  const direccion = params.get('direccion') ?? '';
  const whatsapp = params.get('whatsapp') ?? '';
  const precio = params.get('precio') ?? '';
  const currency = params.get('currency') || 'ARS';
  const paymentId = params.get('payment_id') ?? '';

  const fechaDate = fecha ? new Date(fecha) : null;
  const fechaValida = fechaDate != null && !Number.isNaN(fechaDate.getTime());
  const hayDetalle = Boolean(actividad) && fechaValida;

  // Purchase del Pixel: solo si el pago fue aprobado y una única vez (el ref
  // sobrevive el doble montaje de StrictMode en desarrollo).
  const disparado = useRef(false);
  useEffect(() => {
    if (status !== 'approved' || disparado.current) return;
    disparado.current = true;

    trackEvent('reserva_completada');

    // eventID para deduplicar con la Conversions API del backend: usamos el
    // `event_id` que mande el server; si todavía no lo manda, uno estable
    // derivado del payment_id de MP.
    const eventId =
      params.get('event_id') || (paymentId ? `prueba-${paymentId}` : undefined);

    const purchaseParams: Record<string, unknown> = { currency };
    if (precio && Number.isFinite(Number(precio))) {
      purchaseParams.value = Number(precio);
    }
    // La sede define a qué pixel (y por lo tanto a qué cuenta publicitaria) se
    // le atribuye la venta. El backend la manda en el back_url de MP; si el
    // link es viejo y no la trae, cae en la última sede visitada.
    trackMetaEvent(
      'Purchase',
      purchaseParams,
      eventId ? { eventID: eventId } : undefined,
      slugDeRuta(window.location.pathname, window.location.search),
    );
  }, [status, precio, currency, paymentId, params]);

  if (status === 'rejected') {
    return (
      <div className="container gracias">
        <div className="gracias__card">
          <div className="gracias__icon gracias__icon--error">
            <CrossIcon />
          </div>
          <h1 className="gracias__title t-display">El pago no fue procesado</h1>
          <p className="gracias__sub">
            Hubo un problema con tu pago. Podés intentarlo de nuevo.
          </p>
          <Link to="/" className="gracias__btn">
            Volver a intentar
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'pending') {
    return (
      <div className="container gracias">
        <div className="gracias__card">
          <div className="gracias__icon gracias__icon--pending">
            <ClockIcon />
          </div>
          <h1 className="gracias__title t-display">Pago pendiente</h1>
          <p className="gracias__sub">
            Tu pago está siendo procesado. Cuando se confirme, recibirás un email
            con los detalles de tu reserva.
          </p>
          <p className="gracias__note">
            Si tenés dudas, contactanos por WhatsApp con el comprobante de pago.
          </p>
        </div>
      </div>
    );
  }

  // status === 'approved'
  return (
    <div className="container gracias">
      <div className="gracias__card">
        <div className="gracias__icon gracias__icon--ok">
          <CheckIcon />
        </div>
        <h1 className="gracias__title t-display">¡Reserva confirmada!</h1>
        <p className="gracias__sub">
          Tu clase de prueba está agendada. Te enviamos un email con los detalles.
        </p>

        {hayDetalle && (
          <div className="gracias__detail">
            <p className="gracias__actividad t-display">{actividad}</p>
            <p className="gracias__fecha">
              {formatDayLong(fecha)} a las {formatTime(fecha)} hs
            </p>

            {sede && (
              <div className="gracias__loc">
                <span className="gracias__loc-pin">
                  <PinIcon />
                </span>
                <span className="gracias__loc-text">
                  <span className="gracias__sede">{sede}</span>
                  {direccion && (
                    <span className="gracias__dir">{direccion}</span>
                  )}
                </span>
              </div>
            )}

            {whatsapp && (
              <a
                className="gracias__wapp"
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
              >
                Contactanos por WhatsApp
              </a>
            )}
          </div>
        )}

        {hayDetalle && (
          <button
            type="button"
            className="gracias__cal"
            onClick={() =>
              downloadIcs({ actividad, fecha, sede, direccion, paymentId })
            }
          >
            Agregar al calendario
          </button>
        )}

        <div className="gracias__info">
          <p className="gracias__info-title">¿Es tu primera vez?</p>
          <p>
            Llegá 10 minutos antes de tu clase. Traé ropa cómoda, tu agua o
            bebida hidratante y medias antideslizantes (si no tenés, podés
            adquirirlas en la sede).
          </p>
        </div>
      </div>
    </div>
  );
}
