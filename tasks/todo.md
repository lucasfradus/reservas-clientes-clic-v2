# Landing de Planes + Checkout (port del prototipo "CLIC Landing planes")

Repo: `reservas-clientes-clic-v2` · rama `feat/landing-planes`
Origen del diseño: Claude Design "Estrategia de venta de planes completos" → `CLIC Landing planes.dc.html`

## Decisiones tomadas
- Copia hermana v2, independiente. El nuevo flujo **reemplaza** Precios/Reservar.
- Checkout de plan: **UI completa mockeada** — datos reales donde existan; el pago del plan es simulado ("próximamente"), no cobra.

## Arquitectura
- Una página nueva `PlanesCheckout` en `/sede/:slug/precios` (reemplaza la Precios vieja).
  Estado interno tipo prototipo: `screen: 'landing' | 'checkout'`, `step: 1..4`, `mode: 'plan' | 'prueba'`.
- Un solo componente de checkout con **dos modos**:
  - `plan`  → paso1 modalidad (fijo/flex) + elegir horarios recurrentes; paso3 pago **mockeado** → paso4.
  - `prueba`→ paso1 elegir UNA clase real (grilla `getClases`); paso3 pago **real** vía `checkout()` → Mercado Pago.
- Datos reales: `getSedes` (hero, precioPrueba, foto), `getCatalogo` (planes mensual/trimestral, precios), `getClases` (grilla de horarios).
- `Reservar.tsx` + ruta `/reservar/:claseId`: eliminados. `ClaseRow`/Sede repuntan al nuevo flujo en modo `prueba` con la clase preseleccionada.

## Fidelidad al diseño
- Mobile-first, columna centrada ~390–430px, paleta y tipografía del prototipo (Poppins + Prata, fondos #edece7 / #23222b, acentos sage/terracotta) mapeadas a los tokens de `globals.css`.
- Secciones: header, hero prueba, divider "O empezá directo", planes (toggle mensual/trimestral + pill ahorro), beneficios (✓), trust, recordatorio prueba.
- Checkout: stepper, modalidad fijo/flex, chips de días, grilla de horarios con cupos, resumen, éxito con app stores.

## Diferencias reales vs prototipo (documentar en UI/comentarios)
- `porSemana` no viene del catálogo → derivar de la etiqueta/subtítulo o config local por plan.
- mensual/trimestral son `tipos` separados con precios propios (no un % calculado). El "ahorro" se calcula solo si existen ambas frecuencias del mismo plan.
- Cupos por horario recurrente no existen en la API → en modo `plan` la grilla usa horarios reales pero los cupos se marcan como referenciales; en modo `prueba` los cupos son reales por clase.
- Pago del plan mockeado, marcado claramente.

## Tareas
- [ ] 1. Tokens/estilos base del prototipo (variables + fuentes Prata/Poppins).
- [ ] 2. Página `PlanesCheckout`: shell + estado (screen/step/mode) + carga de datos (sede, catálogo).
- [ ] 3. Landing: header, hero prueba, divider, planes (toggle + cards + ahorro), beneficios, trust, recordatorio.
- [ ] 4. Checkout paso 1: modalidad (plan) / selección de clase (prueba) + grilla horarios (getClases).
- [ ] 5. Checkout paso 2: datos (reusar validación de Reservar).
- [ ] 6. Checkout paso 3: resumen + pago (plan mock / prueba real vía checkout()).
- [ ] 7. Checkout paso 4: éxito.
- [ ] 8. Routing: reemplazar Precios, quitar Reservar, repuntar ClaseRow/Sede al nuevo flujo.
- [ ] 9. Verificación: `npm run build` + `tsc` + correr dev y recorrer ambos modos.

## Review

Implementado en rama `feat/landing-planes` (sin commitear).

Archivos:
- `src/pages/Planes.tsx` + `Planes.css` (nuevos): landing + checkout de 4 pasos, dos modos.
- `src/App.tsx`: ruta `/sede/:slug/precios` → Planes; quitada `/reservar/:claseId`.
- `src/components/ui/ClaseRow.tsx`: linkea al nuevo flujo en modo prueba con la clase preseleccionada.
- `index.html`: fuente Prata.
- Borrados: `Precios.tsx/.css`, `Reservar.tsx/.css`.

Verificación (con datos reales de app.clicpilates.com, sede nunez):
- `tsc -b` ✅ · `npm run build` ✅
- Walkthrough en navegador (Edge headless + CDP), ambos modos:
  - Landing: hero $22.000 con foto, toggle mensual/trimestral, Pack 4/8/12 reales ($84k/$119k/$138k), pills de ahorro, beneficios, trust, recordatorio. ✅
  - Plan: modalidad fijo/flex → "Elegí tus 2 horarios fijos" (Pack 8 → 2/sem derivado) → grilla real con cupos "aprox." → datos → resumen $119.000 + nota demo → éxito (demo). ✅
  - Prueba: días como fechas reales, cupos reales, sin modalidad; pago real vía checkout() (no ejecutado contra prod). ✅

Dev local (resuelto):
- Proxy de Vite `/api` → backend en `vite.config.ts`; `.env` con `VITE_API_BASE_URL` vacío
  para que las llamadas sean same-origin y esquiven CORS. `npm run dev` funciona sin flags.

Pendiente para producción (fuera de alcance de esta etapa):
- ~~Endpoint público de compra de plan~~ → hecho: `checkoutPlan()` + `getHorarios()`.
  El pago del plan ya es real vía Mercado Pago, no queda nada mockeado.
- Restyle opcional del Header/Footer global para acompañar la estética mobile del prototipo.

---

# La sede tiene una sola pantalla

Rama `feat/sede-home-planes`. Antes había dos: `/sede/:slug` (fotos, contacto y
grilla de clases) y `/sede/:slug/precios` (planes + checkout). Ahora es una sola,
en `/sede/:slug`.

- `Planes.tsx` es el home de la sede. Sumó del viejo `Sede.tsx`: el link "ver
  todas las sedes", el carrusel de fotos en el hero, la descripción, WhatsApp y
  cómo llegar, la sección "Próximas clases" y la barra fija de mobile.
- `/sede/:slug/precios` redirige al home, para no romper links viejos (campañas,
  QR impresos).
- La grilla salió a `components/ui/GrillaClases.tsx`: mismos filtros cruzados de
  día y actividad, pero **arranca filtrada en el primer día con clases**. Sin eso
  la página medía 14.475px (85 clases de 14 días). "Todos" sigue en la tira.
- `ClaseRow` ya no navega: avisa con `onElegir`. Dejó de ser un `<a>` con un
  `<button>` adentro (HTML inválido) y pasó a ser un contenedor con `role="button"`.
- **Una sola forma de elegir la clase de prueba.** Había dos grillas para lo
  mismo: la del home y la de chips + slots del paso 1. Quedó la del home, y la
  sección "Próximas clases" se sacó del landing. Ahora el CTA del hero abre el
  paso 1 y ahí está esa grilla; tocar una clase la elige y pasa a los datos.
  La grilla de chips + slots quedó solo para los horarios fijos del plan, que
  son datos distintos (horarios recurrentes, no clases con fecha).
- El `begin_checkout` sale una sola vez, al abrir el checkout. Antes lo
  disparaban dos caminos y había que cuidar que no se pisaran.
- El `view_item` de GA4 y el `ViewContent` de Meta se mudaron a `Planes.tsx`:
  vivían en la página que se borró y eran la cabecera del embudo.
- Borrados: `pages/Sede.tsx` y `pages/Sede.css`.

Verificado con datos reales de app.clicpilates.com (sede nunez): `tsc -b` ✅ ·
`npm run build` ✅ · walkthrough en Chromium 390px y 1280px — hero con carrusel,
redirect de `/precios`, barra fija, clic en horario → paso 2 "Datos", camino de
plan → paso 1 "Horarios". Sin errores de consola.
