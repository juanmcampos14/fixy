import { processPaymentWebhook } from "@/server/modules/payments";

/** Webhooks de la pasarela. Idempotentes: duplicados y eventos fuera de orden no producen efectos. */
export async function POST(req: Request, ctx: { params: Promise<{ gateway: string }> }) {
  const { gateway } = await ctx.params;
  if (gateway !== "mock" && gateway !== "mercadopago") return new Response("Pasarela desconocida", { status: 404 });
  const raw = await req.text();
  if (raw.length > 64_000) return new Response("Payload demasiado grande", { status: 413 });
  try {
    const result = await processPaymentWebhook(gateway, raw, req.headers);
    // Respondemos 200 a eventos procesados o descartados para que la pasarela no reintente indefinidamente;
    // 401 si la firma es inválida.
    return Response.json({ result }, { status: result === "rejected" ? 401 : 200 });
  } catch {
    // Error interno: 500 para que la pasarela reintente; el evento queda registrado con su intento.
    return Response.json({ result: "error" }, { status: 500 });
  }
}
