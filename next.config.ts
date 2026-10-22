import type { NextConfig } from "next";

/**
 * Política de contenido (auditoría M-03). Arranca en modo informe: el navegador no bloquea nada y manda las violaciones a
 * /api/csp-report. Cuando los registros estén limpios se pasa a `Content-Security-Policy` (y, después, nonces para
 * sacar 'unsafe-inline').
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.googleusercontent.com https://*.supabase.co",
  "connect-src 'self' https://maps.googleapis.com https://*.supabase.co",
  "worker-src 'self' blob:",
  "frame-src 'self' https://www.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self' https://accounts.google.com https://*.mercadopago.com https://*.mercadopago.com.ar",
  "report-uri /api/csp-report",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
  // Solo HTTPS durante un año en este dominio y sus subdominios (Vercel sirve todo por HTTPS).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Aísla la ventana de Fixy de las que abra otro sitio (el ingreso con Google y el pago son redirecciones, no popups).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Content-Security-Policy-Report-Only", value: csp },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["postgres"],
  experimental: {
    // Fotos y documentos: hasta 6 archivos de 8 MB por envío (la validación real está en el servidor).
    serverActions: { bodySizeLimit: "50mb" },
  },
  async rewrites() {
    // Archivos que Apple y Google leen para que los links de Fixy abran la app (sin redirecciones).
    return [
      { source: "/.well-known/apple-app-site-association", destination: "/api/app-links/apple" },
      { source: "/.well-known/assetlinks.json", destination: "/api/app-links/android" },
    ];
  },
  async redirects() {
    return [{ source: "/ofrece-tus-servicios", destination: "/sumate", permanent: true }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
