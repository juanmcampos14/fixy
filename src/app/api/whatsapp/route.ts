/**
 * Webhook de WhatsApp Cloud API.
 * GET: verificación de Meta (hub.verify_token). POST: mensajes entrantes, con firma X-Hub-Signature-256 obligatoria.
 * Respondemos 200 enseguida y procesamos después (after), para que Meta no reintente por demora.
 */
import { after, NextResponse } from "next/server";
import { env } from "@/server/env";
import { verifySignature } from "@/server/whatsapp/client";
import { handleInbound, parseWebhook } from "@/server/whatsapp/bot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const expected = env().WHATSAPP_VERIFY_TOKEN;
  if (expected && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === expected) {
    return new NextResponse(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) return new NextResponse("invalid signature", { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }
  const messages = parseWebhook(body);
  if (messages.length) {
    after(async () => {
      for (const m of messages) {
        try {
          await handleInbound(m);
        } catch (e) {
          console.error("[whatsapp] error procesando mensaje", e instanceof Error ? e.message : "desconocido");
        }
      }
    });
  }
  return NextResponse.json({ ok: true });
}
