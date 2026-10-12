# Fichas de las tiendas (App Store y Google Play)

Textos listos para copiar. Las imágenes están en [`capturas/`](capturas/). Los límites de caracteres están respetados.

## Datos comunes
| Campo | Valor |
|---|---|
| Nombre de la app | **Fixy** |
| Identificador | `solutions.fixy.app` |
| Idioma principal | Español (Argentina) — en App Store: "Spanish (Mexico)" o "Spanish (Spain)" si no aparece Argentina; elegir **Spanish (Mexico)** |
| País de distribución | Argentina (se puede ampliar después) |
| Precio | Gratis |
| Categoría principal | Apple: **Estilo de vida** · Google: **Casa y hogar** |
| Categoría secundaria (Apple) | Productividad |
| Sitio web | https://www.fixy.solutions |
| URL de soporte | https://www.fixy.solutions/ayuda |
| URL de privacidad | https://www.fixy.solutions/privacidad |
| URL para eliminar la cuenta (Google) | https://www.fixy.solutions/ayuda#eliminar-cuenta |
| Mail de contacto | hola@fixy.solutions |
| Titular / copyright | © 2026 FLIPS S.R.L. |
| Clasificación por edad | Apple: 4+ · Google: "Para todos" (cuestionario: sin violencia, sin contenido sexual, sin apuestas; hay mensajes entre usuarios moderados por reportes) |
| Contiene anuncios | No |
| Compras dentro de la app | No (ver nota de pagos más abajo) |

## App Store (iOS)
**Nombre** (30): `Fixy`

**Subtítulo** (30): `Arreglos para casa y oficina`

**Texto promocional** (170):
`Contá qué se rompió y elegí al profesional. Presupuestos claros, pago protegido y seguimiento del trabajo en un solo lugar.`

**Palabras clave** (100, separadas por coma, sin espacios):
`plomero,electricista,gasista,cerrajero,arreglos,hogar,reparaciones,pintor,albañil,aire,presupuesto`

**Descripción**:
```
Fixy es tu centro de soluciones para el hogar, la oficina y la obra en Argentina.

Contá qué pasa con tus palabras —"pierde la canilla", "saltó la térmica", "el aire no enfría"— y Fixy te muestra profesionales de tu zona para ese trabajo.

CÓMO FUNCIONA
• Contás el problema y sumás fotos si querés.
• Elegís un profesional o pedís presupuestos. También podés decir cuánto querés pagar y recibir ofertas.
• Ves el detalle completo antes de aceptar: trabajo, cargo por servicio y total.
• Coordinás la visita, seguís el avance y confirmás cuando queda resuelto.

POR QUÉ FIXY
• Identidad y matrículas verificadas por nuestro equipo, señaladas en cada perfil.
• Tu dirección la ve solo Fixy hasta que confirmás la visita.
• Pago protegido con Mercado Pago: el profesional cobra cuando el trabajo está hecho.
• Reseñas de clientes reales, solo de trabajos terminados.
• Si algo sale mal, el equipo de Fixy interviene.

PARA TODO TIPO DE TRABAJOS
Plomería, electricidad, gas, aire acondicionado, cerrajería, pintura, albañilería, carpintería, electrodomésticos, redes y más. Desde un arreglo chico hasta una obra completa, también para oficinas, comercios y consorcios.

¿SOS PROFESIONAL?
Sumate gratis, recibí pedidos de tu zona, presupuestá desde el celular y cobrá por la plataforma.

Fixy no reemplaza a los servicios de emergencia.
```

**Novedades de esta versión**: `Primera versión de Fixy para iPhone.`

**Capturas** (iPhone 6,9", 1320 × 2868): `capturas/ios-1-inicio.png` … `ios-6-profesional.png`, en ese orden. La app es solo para iPhone: no hacen falta capturas de iPad.

**Información para la revisión (App Review)**
- Inicio de sesión requerido: **Sí**. Usuario `revision.cliente@fixy.solutions` y la contraseña generada en *Operación → Equipo y permisos → Cuentas para la revisión de las tiendas*.
- Contacto: nombre y teléfono del responsable, mail hola@fixy.solutions.
- Notas (pegar en inglés):
```
Fixy is a marketplace that connects customers with independent home-service professionals (plumbers, electricians, etc.) in Argentina.

TEST ACCOUNTS (same password for both)
- Customer: revision.cliente@fixy.solutions
- Professional: revision.profesional@fixy.solutions
These accounts are sandboxed: they only match with each other and never reach real users.

HOW TO TEST
1. Sign in as the customer. Tap "Nuevo pedido", describe a problem (e.g. "pierde la canilla de la cocina"), pick the saved address and choose the test professional.
2. Sign in as the professional to see the request, accept the visit or send a quote.

PAYMENTS
Payments are for real-world services performed in person at the customer's home (App Store Review Guideline 3.1.3(e)), so they are processed outside in-app purchase through Mercado Pago, a licensed payment processor in Argentina. No digital goods or content are sold.

ACCOUNT DELETION
Mi cuenta → "Eliminar mi cuenta" (in-app, immediate).

SIGN-IN
Email and password. "Sign in with Google" is only offered on the website, not inside the app, so Sign in with Apple is not required.
```

## Google Play (Android)
**Nombre de la app** (30): `Fixy: arreglos para tu hogar`

**Descripción breve** (80): `Contá qué se rompió y elegí al profesional. Precio claro y pago protegido.`

**Descripción completa**: la misma que en App Store.

**Gráficos**
- Ícono 512 × 512: `capturas/android-icono-512.png`
- Gráfico destacado 1024 × 500: `capturas/android-grafico-destacado-1024x500.png`
- Capturas de teléfono (1080 × 1920): `capturas/android-1-inicio.png` … `android-6-profesional.png`

**Acceso a la app**: "Todas o algunas funciones están restringidas" → cargar las dos cuentas de revisión y la contraseña, con la misma explicación de arriba.

**Otros formularios**
- Anuncios: No.
- Público objetivo: mayores de 18 años.
- App de noticias / salud / finanzas / gobierno: No.
- Funciones financieras: ninguna (los pagos son por servicios presenciales, a través de Mercado Pago).

## Nota sobre los pagos
Lo que se cobra en Fixy son servicios que se prestan en persona. Por eso las dos tiendas permiten (y exigen) cobrar por fuera de su sistema de compras: Apple, regla 3.1.3(e); Google, política de pagos ("bienes y servicios físicos"). No hay que configurar compras dentro de la app.

## Cómo regenerar las capturas
Con el entorno local levantado y los datos de demostración: `npm i --no-save playwright-core && node scripts/store-screenshots.mjs docs/apps/capturas` (usa el Chrome instalado; 440 × 956 y 360 × 640 a escala 3). Las capturas salen sin las marcas "(demo)".
