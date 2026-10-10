/** apple-app-site-association: se publica en /.well-known/ (ver next.config.ts). Sin Team ID todavía, no se publica. */
import { APP_ID, APP_PATHS, APPLE_TEAM_ID } from "@/lib/app-links";

export const dynamic = "force-static";

export function GET() {
  if (!APPLE_TEAM_ID) return new Response("Not found", { status: 404 });
  const appID = `${APPLE_TEAM_ID}.${APP_ID}`;
  const components = [
    { "/": "/auth/*", exclude: true, comment: "Ingreso con Google: siempre en el navegador" },
    ...APP_PATHS.flatMap((p) => (p === "/" ? [{ "/": "/" }] : [{ "/": p }, { "/": `${p}/*` }])),
  ];
  return Response.json({ applinks: { details: [{ appIDs: [appID], components }] }, webcredentials: { apps: [appID] } }, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
