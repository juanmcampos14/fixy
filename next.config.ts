import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
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
