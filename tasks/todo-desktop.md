# Layout desktop propio para la pantalla de sede

Hoy `/sede/:slug` usa el diseño mobile tal cual: una columna de 430px centrada.
En 1440px eso deja ~1000px de vacío a los costados, apila las 3 tarjetas de plan
en vertical y estira la página a 2.580px de alto sobre un viewport de 900.

## Regla que ordena todo

**El layout mobile no se toca.** Todo lo nuevo vive dentro de
`@media (min-width: 1024px)`. Si una regla de desktop obliga a cambiar la base,
es señal de que hay que resolverla de otra forma. Así el riesgo de romper lo que
ya está validado en teléfono queda acotado a cero.

Breakpoint: **1024px**. Entre 769 y 1023 sigue la columna, que es lo que hay hoy
y funciona bien en tablet vertical.

## Etapa 1 — Landing

1. **Contenedor**: `.planes` pasa a ~1120px, pero cada sección declara su propio
   ancho. Un párrafo a 1120px no se lee: los bloques de texto (intro, trust,
   recordatorio) quedan topeados en ~640px y centrados.
2. **Hero a dos columnas**: la galería ocupa la mitad izquierda a sangre y el
   cuerpo (ciudad · dirección, nombre, precio, CTA, WhatsApp/mapa) la derecha,
   sobre el fondo ink. Deja de ser foto-con-texto-encima, que es un recurso de
   mobile. Alto: `100dvh - 72px`, con un piso de 560px para pantallas bajas.
3. **Tarjetas de plan en fila de 3**: `grid-template-columns: repeat(3, 1fr)`.
   Las tarjetas tienen alto distinto según la descripción, así que el CTA se
   alinea abajo con `margin-top: auto`. El ribbon de la destacada ya es absoluto.
4. **Beneficios a 2 columnas** y trust/recordatorio centrados con su tope.

## Etapa 2 — Checkout

5. **Dos columnas**: a la izquierda el paso (grilla, formulario, pago), a la
   derecha un resumen sticky con lo elegido hasta ahí. El header (volver +
   pasos) queda arriba, a todo el ancho.
6. **El resumen hay que extraerlo**: hoy solo existe dentro del paso 3. Para que
   acompañe los tres pasos hay que sacarlo a un componente propio que tolere
   estados incompletos (sin clase elegida todavía, sin datos cargados). En
   mobile sigue apareciendo solo en el paso 3, como ahora.
7. **Grilla de clases a 2 columnas** en el paso 1 del camino de prueba: las
   filas a 1120px quedan larguísimas. Ojo con la fila abierta (`+ info`), que
   ocupa el ancho completo de su columna.

## Verificación

- 1440x900 y 1280x800: recorrer landing y los dos caminos de checkout.
- **390x844 sin cambios**: comparar contra las capturas de hoy. Es la
  verificación que importa, porque es donde está el tráfico.
- 768 y 1023px: que el salto de columna a layout ancho no deje un estado roto.
- `tsc -b` y `npm run build`.

## Fuera de alcance

- Header y Footer globales, que siguen con la estética vieja. Es un pendiente
  aparte y toca todas las pantallas, no solo la de sede.
- La home (`/`) con el listado de sedes.
