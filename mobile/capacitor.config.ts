import type { CapacitorConfig } from "@capacitor/cli";

/**
 * La app abre la plataforma publicada (www.fixy.solutions): cada cambio de la web llega a la app sin pasar por las tiendas.
 * `www/` solo tiene la pantalla sin conexión (también la muestra la app si no hay internet al abrir).
 */
const config: CapacitorConfig = {
  appId: "solutions.fixy.app",
  appName: "Fixy",
  webDir: "www",
  server: {
    url: "https://www.fixy.solutions",
    errorPath: "offline.html",
    // Solo se navega dentro de la app en nuestro dominio y en el pago de Mercado Pago; el resto abre el navegador.
    allowNavigation: ["www.fixy.solutions", "fixy.solutions", "*.mercadopago.com", "*.mercadopago.com.ar"],
  },
  // La web reconoce la app (p. ej., para ocultar "Ingresar con Google": Google no permite iniciar sesión dentro de apps así).
  appendUserAgent: "FixyApp/1.0",
  ios: { contentInset: "automatic", backgroundColor: "#171721" },
  android: { backgroundColor: "#171721" },
  plugins: {
    SplashScreen: { launchShowDuration: 900, backgroundColor: "#171721", showSpinner: false },
    StatusBar: { style: "DARK", backgroundColor: "#171721" },
  },
};

export default config;
