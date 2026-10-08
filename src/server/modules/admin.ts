/**
 * Administración de plataforma: catálogo (categorías, servicios, preguntas, zonas, credenciales requeridas),
 * reglas de comisión y parámetros. Solo administradores de plataforma. Todo cambio queda auditado con motivo.
 */
import { z } from "zod";
import { systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { isPlatformAdmin } from "@/server/auth/actor";
import { audit } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";

function assertAdmin(actor: Actor) {
  if (!isPlatformAdmin(actor)) throw forbidden("Solo un administrador de plataforma puede cambiar esta configuración.");
}

const reasonSchema = z.string().trim().min(5, "Indicá el motivo del cambio (mínimo 5 caracteres).").max(500);

function cleanReason(reason: string) {
  return reasonSchema.parse(reason);
}

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Usá solo minúsculas, números y guiones (ej.: plomeria).")
  .min(2)
  .max(60);

const optionalMinor = z.number().int().positive().nullable();

// ───────────────────────── Categorías ─────────────────────────

export const categorySchema = z.object({
  id: z.string().uuid().optional(),
  slug: slugSchema.optional(),
  name: z.string().trim().min(2, "Ingresá un nombre.").max(80),
  description: z.string().trim().max(400).default(""),
  icon: z.string().trim().min(1).max(40).default("wrench"),
  sort: z.coerce.number().int().min(0).max(10000).default(0),
  active: z.boolean(),
  requiresReview: z.boolean(),
  safetyNote: z.string().trim().max(600).optional().or(z.literal("")),
});

export async function saveCategory(actor: Actor, input: z.input<typeof categorySchema>, reason: string) {
  assertAdmin(actor);
  const why = cleanReason(reason);
  const d = categorySchema.parse(input);
  return systemTx(async (tx) => {
    if (d.id) {
      const [before] = await tx<{ id: string }[]>`select id from categories where id = ${d.id} for update`;
      if (!before) throw notFound("Categoría inexistente.");
      await tx`update categories set name = ${d.name}, description = ${d.description}, icon = ${d.icon}, sort = ${d.sort},
        active = ${d.active}, requires_review = ${d.requiresReview}, safety_note = ${d.safetyNote || null} where id = ${d.id}`;
      await audit(tx, actor, "catalog.category_update", "category", d.id, why, { name: d.name, active: d.active, requiresReview: d.requiresReview, sort: d.sort });
      return d.id;
    }
    if (!d.slug) throw invalid("Indicá un identificador (slug) para la categoría.");
    const [c] = await tx<{ id: string }[]>`
      insert into categories (slug, name, description, icon, sort, active, requires_review, safety_note)
      values (${d.slug}, ${d.name}, ${d.description}, ${d.icon}, ${d.sort}, ${d.active}, ${d.requiresReview}, ${d.safetyNote || null})
      returning id`;
    await audit(tx, actor, "catalog.category_create", "category", c.id, why, { slug: d.slug, name: d.name });
    return c.id;
  });
}

export async function setCategoryCredentials(actor: Actor, categoryId: string, credentialTypeIds: string[], reason: string) {
  assertAdmin(actor);
  const why = cleanReason(reason);
  const ids = z.array(z.string().uuid()).parse(credentialTypeIds);
  return systemTx(async (tx) => {
    const [c] = await tx<{ id: string }[]>`select id from categories where id = ${categoryId} for update`;
    if (!c) throw notFound("Categoría inexistente.");
    if (ids.length) {
      const valid = await tx<{ id: string }[]>`select id from credential_types where id in ${tx(ids)}`;
      if (valid.length !== ids.length) throw invalid("Credencial inválida.");
    }
    const before = await tx<{ credential_type_id: string }[]>`select credential_type_id from category_required_credentials where category_id = ${categoryId}`;
    await tx`delete from category_required_credentials where category_id = ${categoryId}`;
    for (const id of ids) await tx`insert into category_required_credentials (category_id, credential_type_id) values (${categoryId}, ${id})`;
    await audit(tx, actor, "catalog.category_credentials", "category", categoryId, why, {
      before: before.map((b) => b.credential_type_id),
      after: ids,
    });
  });
}

// ───────────────────────── Servicios ─────────────────────────

export const serviceSchema = z
  .object({
    id: z.string().uuid().optional(),
    categoryId: z.string().uuid(),
    slug: slugSchema.optional(),
    name: z.string().trim().min(2, "Ingresá un nombre.").max(120),
    description: z.string().trim().max(600).default(""),
    pricingMode: z.enum(["fixed", "quote", "diagnostic"]),
    fixedPriceMinor: optionalMinor,
    diagnosticPriceMinor: optionalMinor,
    scope: z.string().trim().max(2000).default(""),
    exclusions: z.string().trim().max(2000).default(""),
    sort: z.coerce.number().int().min(0).max(10000).default(0),
    active: z.boolean(),
  })
  .refine((s) => s.pricingMode !== "fixed" || s.fixedPriceMinor != null, { message: "Un servicio con precio cerrado necesita un precio de referencia.", path: ["fixedPrice"] })
  .refine((s) => s.pricingMode !== "diagnostic" || s.diagnosticPriceMinor != null, { message: "Una visita de diagnóstico necesita un precio de visita.", path: ["diagnosticPrice"] })
  .refine((s) => s.pricingMode !== "fixed" || s.scope.length >= 10, { message: "Un precio cerrado requiere describir el alcance (mínimo 10 caracteres).", path: ["scope"] });

export async function saveService(actor: Actor, input: z.input<typeof serviceSchema>, reason: string) {
  assertAdmin(actor);
  const why = cleanReason(reason);
  const d = serviceSchema.parse(input);
  return systemTx(async (tx) => {
    const [cat] = await tx<{ id: string }[]>`select id from categories where id = ${d.categoryId}`;
    if (!cat) throw invalid("Categoría inválida.");
    const data = {
      name: d.name, pricingMode: d.pricingMode, fixedPriceMinor: d.fixedPriceMinor, diagnosticPriceMinor: d.diagnosticPriceMinor, active: d.active,
    };
    if (d.id) {
      const [s] = await tx<{ id: string; category_id: string }[]>`select id, category_id from services where id = ${d.id} for update`;
      if (!s) throw notFound("Servicio inexistente.");
      if (s.category_id !== d.categoryId) throw invalid("El servicio no pertenece a esa categoría.");
      await tx`update services set name = ${d.name}, description = ${d.description}, pricing_mode = ${d.pricingMode},
        fixed_price_minor = ${d.fixedPriceMinor}, diagnostic_price_minor = ${d.diagnosticPriceMinor}, scope = ${d.scope},
        exclusions = ${d.exclusions}, sort = ${d.sort}, active = ${d.active} where id = ${d.id}`;
      await audit(tx, actor, "catalog.service_update", "service", d.id, why, data);
      return d.id;
    }
    if (!d.slug) throw invalid("Indicá un identificador (slug) para el servicio.");
    const [s] = await tx<{ id: string }[]>`
      insert into services (category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, scope, exclusions, sort, active)
      values (${d.categoryId}, ${d.slug}, ${d.name}, ${d.description}, ${d.pricingMode}, ${d.fixedPriceMinor}, ${d.diagnosticPriceMinor},
        ${d.scope}, ${d.exclusions}, ${d.sort}, ${d.active})
      returning id`;
    await audit(tx, actor, "catalog.service_create", "service", s.id, why, { ...data, slug: d.slug, categoryId: d.categoryId });
    return s.id;
  });
}

// ───────────────────────── Preguntas por categoría ─────────────────────────

export const questionSchema = z
  .object({
    id: z.string().uuid().optional(),
    categoryId: z.string().uuid(),
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,39}$/, "La clave usa minúsculas, números y guion bajo (ej.: tipo_canilla)."),
    label: z.string().trim().min(3, "Escribí la pregunta.").max(200),
    kind: z.enum(["text", "select", "boolean"]),
    options: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    required: z.boolean(),
    sort: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .refine((q) => q.kind !== "select" || q.options.length >= 2, { message: "Una pregunta de opciones necesita al menos dos opciones.", path: ["options"] });

export async function saveQuestion(actor: Actor, input: z.input<typeof questionSchema>, reason: string) {
  assertAdmin(actor);
  const why = cleanReason(reason);
  const d = questionSchema.parse(input);
  const options = d.kind === "select" ? d.options : [];
  return systemTx(async (tx) => {
    if (d.id) {
      const [q] = await tx<{ category_id: string }[]>`select category_id from service_questions where id = ${d.id} for update`;
      if (!q) throw notFound("Pregunta inexistente.");
      if (q.category_id !== d.categoryId) throw invalid("La pregunta no pertenece a esa categoría.");
      await tx`update service_questions set key = ${d.key}, label = ${d.label}, kind = ${d.kind}, options = ${tx.json(options as never)},
        required = ${d.required}, sort = ${d.sort} where id = ${d.id}`;
      await audit(tx, actor, "catalog.question_update", "service_question", d.id, why, { key: d.key, kind: d.kind, required: d.required });
      return d.id;
    }
    const [q] = await tx<{ id: string }[]>`
      insert into service_questions (category_id, key, label, kind, options, required, sort)
      values (${d.categoryId}, ${d.key}, ${d.label}, ${d.kind}, ${tx.json(options as never)}, ${d.required}, ${d.sort})
      returning id`;
    await audit(tx, actor, "catalog.question_create", "service_question", q.id, why, { categoryId: d.categoryId, key: d.key, kind: d.kind });
    return q.id;
  });
}

/** Las respuestas ya guardadas en solicitudes no se pierden: quedan en `answers` con su clave. */
export async function deleteQuestion(actor: Actor, questionId: string, reason: string) {
  assertAdmin(actor);
  const why = cleanReason(reason);
  return systemTx(async (tx) => {
    const [q] = await tx<{ category_id: string; key: string }[]>`delete from service_questions where id = ${questionId} returning category_id, key`;
    if (!q) throw notFound("Pregunta inexistente.");
    await audit(tx, actor, "catalog.question_delete", "service_question", questionId, why, { categoryId: q.category_id, key: q.key });
  });
}

// ───────────────────────── Zonas ─────────────────────────

export const zoneSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,40}$/, "El código usa mayúsculas, números, guion o guion bajo."),
  name: z.string().trim().min(2, "Ingresá el nombre de la zona.").max(80),
  region: z.enum(["CABA", "GBA_NORTE", "GBA_OESTE", "GBA_SUR"]),
  sort: z.coerce.number().int().min(0).max(10000).default(0),
});

export async function createZone(actor: Actor, input: z.input<typeof zoneSchema>, reason: string) {
  assertAdmin(actor);
  const why = cleanReason(reason);
  const d = zoneSchema.parse(input);
  return systemTx(async (tx) => {
    const [z] = await tx<{ id: string }[]>`insert into zones (code, name, region, sort) values (${d.code}, ${d.name}, ${d.region}, ${d.sort}) returning id`;
    await audit(tx, actor, "catalog.zone_create", "zone", z.id, why, d);
    return z.id;
  });
}

/** Desactivar una zona no modifica coberturas existentes: deja de ofrecerse para nuevas solicitudes y altas. */
export async function setZoneActive(actor: Actor, zoneId: string, active: boolean, reason: string) {
  assertAdmin(actor);
  const why = cleanReason(reason);
  return systemTx(async (tx) => {
    const [z] = await tx<{ id: string }[]>`update zones set active = ${active} where id = ${zoneId} returning id`;
    if (!z) throw notFound("Zona inexistente.");
    await audit(tx, actor, active ? "catalog.zone_activate" : "catalog.zone_deactivate", "zone", zoneId, why);
  });
}

// ───────────────────────── Comisiones ─────────────────────────

/** "10", "10,5" o "10.25" (porcentaje con hasta 2 decimales) → puntos básicos enteros. */
export function percentToBps(input: string): number | null {
  const s = input.trim().replace(/\s|%/g, "");
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export const commissionSchema = z.object({
  categoryId: z.string().uuid().nullable(),
  providerRateBps: z.number().int().min(0).max(5000, "La comisión al proveedor no puede superar el 50 %."),
  clientRateBps: z.number().int().min(0).max(5000, "El cargo al cliente no puede superar el 50 %."),
  clientFeeTaxBps: z.number().int().min(0).max(5000, "El impuesto configurado no puede superar el 50 %."),
});

/**
 * Crea una regla nueva y desactiva la vigente del mismo alcance en una sola transacción.
 * Los presupuestos ya enviados conservan sus tasas (quedan guardadas en cada presupuesto).
 */
export async function replaceCommissionRule(actor: Actor, input: z.input<typeof commissionSchema>, reason: string) {
  assertAdmin(actor);
  const why = cleanReason(reason);
  const d = commissionSchema.parse(input);
  return systemTx(async (tx) => {
    if (d.categoryId) {
      const [c] = await tx<{ id: string }[]>`select id from categories where id = ${d.categoryId}`;
      if (!c) throw invalid("Categoría inválida.");
    }
    const [prev] = await tx<{ id: string; provider_rate_bps: number; client_rate_bps: number; client_fee_tax_bps: number }[]>`
      update commission_rules set active = false
      where active and ${d.categoryId ? tx`category_id = ${d.categoryId}` : tx`category_id is null`}
      returning id, provider_rate_bps, client_rate_bps, client_fee_tax_bps`;
    const [rule] = await tx<{ id: string }[]>`
      insert into commission_rules (category_id, provider_rate_bps, client_rate_bps, client_fee_tax_bps, active, created_by)
      values (${d.categoryId}, ${d.providerRateBps}, ${d.clientRateBps}, ${d.clientFeeTaxBps}, true, ${actor.id})
      returning id`;
    await audit(tx, actor, "commission.replace", "commission_rule", rule.id, why, {
      categoryId: d.categoryId,
      previous: prev ? { id: prev.id, providerRateBps: prev.provider_rate_bps, clientRateBps: prev.client_rate_bps, clientFeeTaxBps: prev.client_fee_tax_bps } : null,
      next: { providerRateBps: d.providerRateBps, clientRateBps: d.clientRateBps, clientFeeTaxBps: d.clientFeeTaxBps },
    });
    return rule.id;
  });
}

/** Quita la regla específica de una categoría: vuelve a aplicarse la regla general. */
export async function removeCategoryCommissionRule(actor: Actor, categoryId: string, reason: string) {
  assertAdmin(actor);
  const why = cleanReason(reason);
  return systemTx(async (tx) => {
    const [prev] = await tx<{ id: string }[]>`update commission_rules set active = false where active and category_id = ${categoryId} returning id`;
    if (!prev) throw invalid("Esa categoría no tiene una regla propia vigente.");
    await audit(tx, actor, "commission.remove_category_rule", "commission_rule", prev.id, why, { categoryId });
  });
}

// ───────────────────────── Parámetros ─────────────────────────

export const settingsSchema = z.object({
  inviteLimit: z.coerce.number().int().min(1, "Invitá al menos a 1 proveedor.").max(10, "Máximo 10 invitaciones por ronda."),
  quoteValidDays: z.coerce.number().int().min(1, "Mínimo 1 día.").max(30, "Máximo 30 días."),
});

export async function updatePlatformSettings(actor: Actor, input: z.input<typeof settingsSchema>, reason: string) {
  assertAdmin(actor);
  const why = cleanReason(reason);
  const d = settingsSchema.parse(input);
  return systemTx(async (tx) => {
    const before = await tx<{ key: string; value: unknown }[]>`
      select key, value from platform_settings where key in ('matching.invite_limit', 'quotes.default_valid_days')`;
    const set = async (key: string, value: number) => {
      await tx`insert into platform_settings (key, value, updated_by, updated_at) values (${key}, ${tx.json(value)}, ${actor.id}, now())
        on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
    };
    await set("matching.invite_limit", d.inviteLimit);
    await set("quotes.default_valid_days", d.quoteValidDays);
    await audit(tx, actor, "settings.update", "platform_settings", null, why, {
      before: Object.fromEntries(before.map((b) => [b.key, b.value])),
      after: { "matching.invite_limit": d.inviteLimit, "quotes.default_valid_days": d.quoteValidDays },
    });
  });
}
