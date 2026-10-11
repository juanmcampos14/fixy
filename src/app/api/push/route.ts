import { z } from "zod";
import { getActor } from "@/server/auth/session";
import { env } from "@/server/env";
import { pushPlatforms, registerDevice, unregisterDevice } from "@/server/push";

const body = z.object({ platform: z.enum(["ios", "android"]), token: z.string().min(20).max(4096).regex(/^[\w:.\-]+$/) });

/** Solo la app (misma web dentro de Capacitor) llama acá: se rechaza cualquier otro origen. */
function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(env().APP_URL).origin || origin === new URL(req.url).origin;
}

/** Qué plataformas tienen avisos configurados y si hay sesión: la app decide si pide el permiso. */
export async function GET() {
  const actor = await getActor();
  return Response.json({ signedIn: !!actor, platforms: pushPlatforms() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Origen no permitido", { status: 403 });
  const actor = await getActor();
  if (!actor) return new Response("Sin sesión", { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Datos inválidos", { status: 400 });
  if (!pushPlatforms()[parsed.data.platform]) return new Response("Avisos no configurados", { status: 409 });
  await registerDevice(actor.id, parsed.data.platform, parsed.data.token);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return new Response("Origen no permitido", { status: 403 });
  const parsed = body.pick({ token: true }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Datos inválidos", { status: 400 });
  await unregisterDevice(parsed.data.token);
  return Response.json({ ok: true });
}
