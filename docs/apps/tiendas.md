# Fixy en App Store y Google Play: trámites

Plan elegido (ver `docs/research/apps-moviles.md`): app con **Capacitor** para iOS y Android, publicada a nombre de **FLIPS S.R.L.** (CUIT 30-71915647-5).

## 1. D-U-N-S de FLIPS S.R.L. (gratis, ~5 días hábiles)
Lo exigen Apple y Google para cuentas de empresa. Se pide una sola vez y sirve para las dos.

**Antes de empezar, tené a mano:** razón social exacta (como en el estatuto/AFIP), domicilio legal, teléfono de la empresa,
nombre y apellido legales del socio gerente, y un mail del dominio (ej. `apps@fixy.solutions`). Si tenés el estatuto o la
constancia de inscripción en PDF, mejor: D&B a veces lo pide.

**Paso 1 — Apple Account de la empresa**
1. Entrá a https://account.apple.com → "Crear tu Apple Account".
2. Nombre y apellido: los **tuyos reales** (no "Fixy"); mail: el del dominio. Activá la verificación en dos pasos con tu celular.

**Paso 2 — Herramienta D-U-N-S de Apple**
1. Entrá a https://developer.apple.com/enroll/duns-lookup/ e iniciá sesión con ese Apple Account.
2. Elegí el país **Argentina** y completá: razón social `FLIPS S.R.L.`, domicilio legal, ciudad, código postal y provincia.
3. Tocá buscar. Si aparece FLIPS S.R.L., anotá el número de 9 dígitos y listo (pasá al paso 4).
4. Si no aparece (lo más probable), elegí la opción para **enviar tus datos a Dun & Bradstreet** y completá:
   - datos de la empresa (los mismos de arriba, sin abreviar distinto), teléfono y sitio web `https://www.fixy.solutions`;
   - tus datos de contacto: nombre, cargo (socio gerente) y mail del dominio.
5. Enviá. Te llega un mail de confirmación con un número de pedido: guardalo.

**Paso 3 — Esperar**
- D&B tarda hasta **5 días hábiles** (no se puede acelerar). Puede llamarte o escribirte para confirmar el tipo de empresa o la cantidad de empleados: respondé rápido.
- Si pasan **dos semanas** sin respuesta, escribiles desde https://support.dnb.com/?CUST=APPLEDEV con el número de pedido.
- Si te dice "Your organization is not listed as a legal entity", mandá el estatuto o la constancia de AFIP por ese mismo soporte.

**Paso 4 — Usarlo**
- Cuando llegue el número, esperá **2 días hábiles** más (Apple lo recibe de D&B) y seguí con la inscripción de Apple (punto 2).
- El mismo número se usa en Google Play (punto 3).

> No pagues servicios "express" de terceros: no acortan el plazo.

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
