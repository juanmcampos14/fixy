# Fixy en iOS y Android: evaluación (octubre 2026)

## Resumen
Recomendación en dos pasos:
1. **Ahora — Web instalable (PWA), ~1 semana.** Ícono en la pantalla de inicio, pantalla completa y avisos push (Android y iPhone con iOS 16.4+). Costo extra: casi cero.
2. **Cuando haya tracción — App en las tiendas con Capacitor, ~4 a 6 semanas.** La misma plataforma dentro de una app nativa, con avisos push, cámara, ubicación y "Ingresar con Apple". Todo lo que cambiemos en la web se ve en la app sin pasar por las tiendas.

Una app 100 % nativa (React Native / Expo) recién tiene sentido si los números lo justifican: son **3 a 5 meses** y dos bases de código para mantener.

## Opciones

| | A. Web instalable (PWA) | B. App con Capacitor (recomendada para tiendas) | C. App nativa (React Native / Expo) |
|---|---|---|---|
| Qué es | El sitio actual, instalable desde el navegador | Una app nativa que muestra la plataforma actual y suma funciones del teléfono | Una app nueva, pantalla por pantalla |
| Está en App Store / Play Store | No | Sí | Sí |
| Esfuerzo hasta publicar | ~1 semana | ~4–6 semanas (incluye revisión de tiendas) | ~3–5 meses |
| Reutiliza lo que ya está hecho | 100 % | ~95 % | Lógica del servidor; las pantallas se rehacen. Hay que sumar una API para la app |
| Cambios después | Al instante | Al instante (la web); solo lo nativo pasa por las tiendas | Cada cambio pasa por las tiendas (o actualizaciones OTA para JS) |
| Avisos push | Sí (iPhone: solo si la instalan en el inicio) | Sí, nativos | Sí, nativos |
| Experiencia | Buena | Muy buena con navegación nativa | La mejor |
| Riesgo de rechazo en Apple | No aplica | Medio si es "solo una web": se mitiga con funciones nativas (ver abajo) | Bajo |

## Costos fijos (no dependen de la opción)
- **Apple Developer Program:** USD 99 por año.
- **Google Play Console:** USD 25, pago único.
- **Cuenta de organización (FLIPS S.R.L.) en ambas tiendas:** requiere **número D-U-N-S** (gratuito, tarda 1–2 semanas). Ventaja en Google: las cuentas de organización **no** tienen la regla de 12 testers durante 14 días que se exige a las cuentas personales nuevas.
- **Avisos push:** Firebase Cloud Messaging y el servicio de Apple son gratuitos.
- **Compilar para iPhone:** hace falta una Mac con Xcode (ya hay una) o compilación en la nube (Expo EAS tiene plan gratuito; planes pagos desde USD 19/mes).
- **Comisión de las tiendas sobre los cobros: no aplica.** Los servicios que se prestan en el mundo físico (plomería, electricidad, etc.) pueden cobrarse con Mercado Pago u otro medio externo; la comisión del 15–30 % de Apple y Google es para bienes digitales.

## Requisitos de las tiendas que hoy faltan en Fixy
1. **Borrar la cuenta desde la app** (Apple 5.1.1(v) y política de datos de Google). Hoy no existe la baja autoservicio: hay que hacerla igual por la ley de datos personales. **Bloqueante.**
2. **Ingresar con Apple:** la regla 4.8 de Apple lo exige cuando el ingreso es *solo* con servicios de terceros. Fixy tiene registro propio con email, así que en principio no es obligatorio, pero conviene sumarlo para evitar rechazos y porque muchos usuarios de iPhone lo prefieren.
3. **Funciones nativas reales** (regla 4.2 de Apple contra apps que son solo un sitio web): avisos push, cámara para las fotos del pedido, ubicación, barra de navegación nativa, pantalla sin conexión y links que abren la app (pedidos de WhatsApp, invitaciones).
4. **Cuenta de prueba para los revisores** (en producción no hay accesos de demostración).
5. **Fichas de las tiendas:** capturas, textos, etiquetas de privacidad (App Store) y formulario de seguridad de datos (Google Play), URL de soporte y de privacidad (ya existen).

## Plan propuesto para la opción B (Capacitor)
| Semana | Trabajo |
|---|---|
| 0 (en paralelo) | Pedir D-U-N-S de FLIPS S.R.L., crear las cuentas de Apple y Google |
| 1 | Base de la app (iOS y Android), íconos y pantalla de inicio con la mascota, links que abren la app, pantalla sin conexión |
| 2 | Avisos push: registro del dispositivo, envío desde el servidor (los mismos avisos que hoy van por email y WhatsApp), preferencias |
| 3 | Ingresar con Apple, baja de cuenta, cámara y ubicación nativas, barra de navegación nativa |
| 4 | Fichas de tienda, capturas, formularios de privacidad, TestFlight y prueba cerrada en Google |
| 5–6 | Revisión de Apple y Google (1 a 7 días cada una) y correcciones |

## Antes de cualquier opción (útil ya mismo)
- Baja de cuenta autoservicio (ley de datos y tiendas).
- PWA: manifiesto, íconos, avisos push web. Sirve para medir cuántos instalan Fixy antes de invertir en las tiendas.

## Fuentes
- Regla 4.8 (ingreso con terceros): https://developer.apple.com/forums/thread/765145
- Regla 4.2 y apps que envuelven una web: https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper · https://developer.apple.com/forums/thread/812889
- Google Play, prueba cerrada de 12 testers por 14 días (cuentas personales nuevas): https://support.google.com/googleplay/android-developer/answer/14151465
- Google Play, registro USD 25: https://support.google.com/googleplay/android-developer/answer/14659200
- Expo EAS, planes: https://docs.expo.dev/billing/plans/
