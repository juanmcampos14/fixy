import type { Db } from "@/server/db/client";
import type { CommissionRule } from "@/server/domain/money";

export type Category = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  requires_review: boolean;
  safety_note: string | null;
};

export type Question = {
  id: string;
  key: string;
  label: string;
  kind: "text" | "select" | "boolean";
  options: string[];
  required: boolean;
};

export async function listCategories(db: Db): Promise<Category[]> {
  return db<Category[]>`select id, slug, name, description, icon, requires_review, safety_note
    from categories where active order by sort, name`;
}

export async function getCategoryBySlug(db: Db, slug: string) {
  const [c] = await db<Category[]>`select id, slug, name, description, icon, requires_review, safety_note from categories where slug = ${slug} and active`;
  return c ?? null;
}

export async function listQuestions(db: Db, categoryId: string): Promise<Question[]> {
  return db<Question[]>`select id, key, label, kind, options, required from service_questions where category_id = ${categoryId} order by sort`;
}

export async function listZones(db: Db) {
  return db<{ id: string; code: string; name: string; region: string; match_names: string[]; province: string | null; catch_all: boolean }[]>`
    select id, code, name, region, match_names, province, catch_all from zones where active order by sort, name`;
}

export async function listServices(db: Db, categoryId?: string) {
  return db<{ id: string; category_id: string; slug: string; name: string; description: string; pricing_mode: string; fixed_price_minor: number | null; diagnostic_price_minor: number | null; scope: string; exclusions: string }[]>`
    select id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, scope, exclusions
    from services where active ${categoryId ? db`and category_id = ${categoryId}` : db``} order by sort, name`;
}

/** Regla de comisión vigente: la de la categoría si existe, si no la general. */
export async function commissionRuleFor(db: Db, categoryId: string | null): Promise<CommissionRule> {
  const [r] = await db<{ provider_rate_bps: number; client_rate_bps: number; client_fee_tax_bps: number }[]>`
    select provider_rate_bps, client_rate_bps, client_fee_tax_bps from commission_rules
    where active and (category_id = ${categoryId} or category_id is null)
    order by category_id nulls last limit 1`;
  if (!r) throw new Error("No hay una regla de comisión configurada");
  return { providerRateBps: r.provider_rate_bps, clientRateBps: r.client_rate_bps, clientFeeTaxBps: r.client_fee_tax_bps };
}

export async function getSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const [r] = await db<{ value: T }[]>`select value from platform_settings where key = ${key}`;
  return r ? r.value : fallback;
}
