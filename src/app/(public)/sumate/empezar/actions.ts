"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { act } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { loadActor } from "@/server/auth/actor";
import { createSession, getActor } from "@/server/auth/session";
import { sql, systemTx } from "@/server/db/client";
import { acceptProviderTerms, quickStartProvider } from "@/server/modules/providers";
import { registerUser } from "@/server/modules/users";
import { rateLimit } from "@/server/rate-limit";

const schema = z.object({
  categoryIds: z.array(z.string().uuid()).min(1, "Elegí al menos un oficio.").max(5, "Elegí hasta 5 oficios."),
  zoneIds: z.array(z.string().uuid()).min(1, "Elegí al menos una zona.").max(12, "Elegí hasta 12 zonas."),
  fullName: z.string().trim().min(3, "Escribí tu nombre y apellido.").max(120),
  phone: z.string().trim().min(6, "Escribí tu celular.").max(40),
  email: z.string().trim().toLowerCase().email("Ese email no parece válido.").max(200).optional().or(z.literal("")),
  password: z.string().max(200).optional().or(z.literal("")),
  acceptTerms: z.boolean(),
});
export type GuidedSignupPayload = z.input<typeof schema>;

const joinNames = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/** Crea la cuenta (si hace falta) y el perfil profesional con lo elegido en el alta guiada. */
export async function guidedSignupAction(payload: GuidedSignupPayload): Promise<ActionState> {
  const r = await act(async () => {
    const d = schema.parse(payload);
    const ip = ((await headers()).get("x-forwarded-for") ?? "local").split(",")[0].trim();
    await rateLimit(`guided-signup:${ip}`, 10, 3600);
    let actor = await getActor();
    if (!actor) {
      if (!d.acceptTerms) return { error: "Para sumarte tenés que aceptar las condiciones.", fieldErrors: { acceptTerms: ["Tildá la casilla para continuar."] } };
      if (!d.email) return { error: "Escribí tu email.", fieldErrors: { email: ["Escribí tu email."] } };
      if ((d.password ?? "").length < 8) return { error: "La clave tiene que tener al menos 8 letras o números.", fieldErrors: { password: ["Mínimo 8 letras o números."] } };
      const userId = await registerUser({ fullName: d.fullName, email: d.email, phone: d.phone, password: d.password!, acceptTerms: true });
      await createSession(userId);
      actor = await systemTx((tx) => loadActor(tx, userId));
    }
    if (!actor) return { error: "No pudimos crear tu cuenta. Probá de nuevo." };
    const cats = await sql()<{ id: string; name: string }[]>`select id, name from categories where id in ${sql()(d.categoryIds)} and active`;
    const zones = await sql()<{ id: string; name: string }[]>`select id, name from zones where id in ${sql()(d.zoneIds)} and active`;
    let origin: { source?: string; referrerSlug?: string } = { source: "alta-guiada" };
    try {
      const c = JSON.parse((await cookies()).get("fixy_signup")?.value ?? "{}");
      origin = { source: typeof c.origen === "string" && c.origen ? c.origen : "alta-guiada", referrerSlug: typeof c.ref === "string" && c.ref ? c.ref : undefined };
    } catch {}
    const description = `${d.fullName}. ${joinNames(cats.map((c) => c.name))} en ${joinNames(zones.slice(0, 4).map((z) => z.name))}${zones.length > 4 ? " y alrededores" : ""}. Perfil creado en el alta guiada de Fixy.`;
    await quickStartProvider(actor, {
      kind: "individual", displayName: d.fullName, contactPhone: d.phone, description,
      // El primer oficio que tocó es el principal.
      categoryIds: d.categoryIds, primaryCategoryId: d.categoryIds[0], zoneIds: d.zoneIds, baseZoneId: d.zoneIds[0],
      // Horario de arranque: lunes a sábado de 8 a 19. Se cambia después desde el perfil.
      availability: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 8 * 60, endMinute: 19 * 60 })),
      priceRefs: [], aiAssisted: false,
    }, origin);
    const withProvider = await systemTx((tx) => loadActor(tx, actor!.id));
    if (withProvider) await acceptProviderTerms(withProvider);
    (await cookies()).delete("fixy_signup");
    return { ok: true };
  });
  if (r.ok) redirect("/proveedor/alta?bienvenida=1");
  return r;
}
