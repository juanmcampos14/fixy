/** Crea un pedido completo (lugar nuevo o guardado + solicitud) a partir del payload del flujo conversacional. Web y WhatsApp. */
import { z } from "zod";
import { sql } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { invalid } from "@/server/domain/errors";
import { createProperty, propertySchema } from "./properties";
import { createRequest } from "./requests";

export const requestPayloadSchema = z.object({
  description: z.string(),
  title: z.string(),
  categorySlug: z.string().nullable(),
  serviceId: z.string().nullable().optional(),
  answers: z.record(z.string(), z.union([z.string(), z.boolean()])),
  urgency: z.enum(["flexible", "normal", "soon", "urgent"]),
  windows: z.array(z.enum(["morning", "afternoon", "evening", "weekend"])),
  propertyId: z.string().nullable(),
  newProperty: z.record(z.string(), z.string()).nullable(),
  organizationId: z.string().nullable().optional(),
  responsibleUserId: z.string().nullable().optional(),
  accessInfo: z.string().optional(),
  targetProviderSlug: z.string().nullable().optional(),
  previousJobId: z.string().nullable().optional(),
});
export type RequestPayload = z.infer<typeof requestPayloadSchema>;

export async function submitRequestPayload(actor: Actor, payload: RequestPayload, photos: { data: Buffer; name: string }[] = []) {
  let propertyId = payload.propertyId;
  if (!propertyId) {
    if (!payload.newProperty) throw invalid("Indicá dónde es el trabajo.");
    propertyId = await createProperty(actor, propertySchema.parse(payload.newProperty), payload.organizationId ?? null);
  }
  const [cat] = payload.categorySlug ? await sql()<{ id: string }[]>`select id from categories where slug = ${payload.categorySlug}` : [];
  const [prov] = payload.targetProviderSlug ? await sql()<{ id: string }[]>`select id from providers where slug = ${payload.targetProviderSlug} and status = 'approved'` : [];
  return createRequest(
    actor,
    {
      propertyId,
      categoryId: cat?.id ?? null,
      serviceId: payload.serviceId ?? null,
      title: payload.title,
      description: payload.description,
      answers: payload.answers,
      urgency: payload.urgency,
      preferredWindows: payload.windows,
      accessInfo: payload.accessInfo ?? "",
      targetProviderId: prov?.id ?? null,
      previousJobId: payload.previousJobId ?? null,
      responsibleUserId: payload.responsibleUserId ?? null,
    },
    photos,
  );
}
