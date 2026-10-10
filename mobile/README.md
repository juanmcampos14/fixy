# Fixy para iOS y Android (Capacitor)

La app muestra la plataforma publicada (https://www.fixy.solutions) dentro de una app nativa, con pantalla sin conexión,
ícono y pantalla de inicio propios, y permisos de cámara, fotos y ubicación. Lo que se cambia en la web llega a la app sin pasar por las tiendas.

- Identificador: `solutions.fixy.app` · Nombre: Fixy
- La web reconoce la app por el agente de usuario `FixyApp/1.0` (por ejemplo, oculta "Ingresar con Google", que Google no permite dentro de apps así).

## Requisitos en la Mac
- **Xcode** (App Store) para iOS. Después de instalarlo: `sudo xcode-select -s /Applications/Xcode.app` y abrirlo una vez para aceptar la licencia.
- **Android Studio** para Android (incluye el SDK y Java).

## Uso
```bash
cd mobile
npm install
npx cap sync          # copia la configuración y los plugins a los proyectos nativos
npx cap open ios      # abre Xcode: elegir un simulador y ▶︎
npx cap open android  # abre Android Studio: elegir un emulador y ▶︎
```

Ícono y pantalla de inicio: se generan desde `assets/` con `npx @capacitor/assets@3.0.5 generate --iconBackgroundColor '#fdfbf5' --splashBackgroundColor '#fdfbf5'`.

## Pendiente antes de publicar
- Avisos push nativos (necesita la clave APNs de la cuenta de Apple y un proyecto de Firebase para Android).
- Links que abren la app (Universal Links / App Links) para los links de WhatsApp y los mails.
- Ingresar con Apple (opcional mientras no haya ingreso con Google dentro de la app).
- Fichas de las tiendas, capturas y formularios de privacidad.
