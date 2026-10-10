# Fixy en App Store y Google Play: trámites

Plan elegido (ver `docs/research/apps-moviles.md`): app con **Capacitor** para iOS y Android, publicada a nombre de **FLIPS S.R.L.** (CUIT 30-71915647-5).

## 1. D-U-N-S de FLIPS S.R.L. (gratis, 5 días hábiles aprox.)
Lo exigen Apple y Google para cuentas de empresa. Se pide una sola vez y sirve para las dos.

1. Crear (o usar) un **Apple Account de la empresa**, idealmente con un mail del dominio (ej. `apps@fixy.solutions`), con verificación en dos pasos activada.
2. Entrar a la herramienta de Apple: https://developer.apple.com/enroll/duns-lookup/
3. Buscar **"FLIPS S.R.L."** con el domicilio legal. Si aparece, anotar el número de 9 dígitos.
4. Si no aparece: **"Submit your information"** con los datos exactamente como en el estatuto / constancia de AFIP:
   - Razón social: FLIPS S.R.L.
   - Domicilio legal (calle, número, ciudad, código postal, provincia) — *pendiente de completar*
   - Teléfono de la empresa
   - Contacto: nombre, cargo (socio gerente) y mail del dominio
5. Dun & Bradstreet puede escribir o llamar para confirmar datos (tipo de empresa, cantidad de empleados). Responder rápido.
6. Al recibir el número, esperar 1–2 días hábiles más antes de usarlo en Apple (sincronización).

> No pagar servicios "express": no acortan el plazo.

## 2. Apple Developer Program (USD 99/año)
Requisitos: D-U-N-S, sitio web público de la empresa (www.fixy.solutions, con FLIPS S.R.L. en el pie), mail del dominio y que quien inscribe tenga **autoridad legal** para obligar a la empresa (socio gerente o con poder).

1. https://developer.apple.com/programs/enroll/ → "Start your enrollment" con el Apple Account de la empresa.
2. Tipo: **Organization**. Cargar los mismos datos que en el D-U-N-S.
3. Apple llama por teléfono para verificar (puede ser en inglés). Después se paga la membresía.

## 3. Google Play Console (USD 25, pago único)
1. https://play.google.com/console/signup con una cuenta de Google de la empresa.
2. Tipo: **Organización**. Crear el perfil de pagos con el D-U-N-S.
3. Verificación: documento de la empresa (estatuto o constancia de inscripción), sitio web y teléfono. Las cuentas de organización **no** tienen la prueba cerrada obligatoria de 12 testers × 14 días.

## 4. Lo que tiene que estar listo en Fixy antes de publicar
- [ ] Baja de cuenta desde la app (Apple 5.1.1(v) y Google): **bloqueante**.
- [ ] Ingresar con Apple (recomendado para iOS).
- [ ] Avisos push nativos, cámara y ubicación, pantalla sin conexión, links que abren la app (Apple 4.2).
- [ ] Cuenta de prueba para revisores.
- [ ] Fichas: capturas, textos, etiquetas de privacidad (Apple) y formulario de seguridad de datos (Google).
- [ ] Domicilio legal y mail de contacto en Términos y Privacidad (`src/lib/legal.ts`).

## Datos que faltan
- Domicilio legal de FLIPS S.R.L.
- Teléfono de la empresa.
- Nombre del socio gerente (quien firma) y mail del dominio para Apple/Google.
