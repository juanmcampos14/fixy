/**
 * Número comercial de captación en la API oficial de WhatsApp (Meta), separado del bot. Manda las invitaciones como
 * plantillas aprobadas por Meta (única forma de escribirle primero a alguien), las crea para revisión y consulta la
 * calidad del número para frenar el envío si baja. Las respuestas no llegan acá: llegan a Kommo.
 */
import { sql } from "@/server/db/client";
import { env } from "@/server/env";
import { WA_LANGUAGE } from "./templates";

const SITE = "https://www.fixy.solutions";
const graphUrl = (path: string) => `https://graph.facebook.com/${env().WHATSAPP_API_VERSION}/${path}`;
const token = () => env().SUPPLY_WHATSAPP_TOKEN || env().WHATSAPP_ACCESS_TOKEN;

export const supplyNumberConfigured = () => !!(token() && env().SUPPLY_WHATSAPP_PHONE_NUMBER_ID);

/** Plantillas de invitación (categoría marketing). Params: nombre, oficio, zona. Botón: código del candidato. */
export const SUPPLY_TEMPLATES = {
  first: {
    name: "fixy_invitacion_profesional_v1",
    body: "Hola {{1}}, te escribimos de Fixy, la plataforma que conecta a vecinos que necesitan arreglos con profesionales de su zona. " +
      "Tenemos pedidos de {{2}} en {{3}} y nos gustaría que te sumes: elegís qué trabajos tomar y cobrás seguro. Sumarte es gratis y no cobramos comisión.",
  },
  followup: {
    name: "fixy_invitacion_recordatorio_v1",
    body: "Hola {{1}}, te escribimos hace unos días de Fixy. Si te interesa recibir pedidos de {{2}} en {{3}}, sumarte lleva 2 minutos y es gratis.",
  },
} as const;
export type SupplyTemplateKey = keyof typeof SUPPLY_TEMPLATES;
export const SUPPLY_FOOTER = "Respondé BAJA si no querés recibir más mensajes.";
export const OPT_OUT_BUTTON = "No me interesa";

export function supplyTemplateDefinition(key: SupplyTemplateKey) {
  const t = SUPPLY_TEMPLATES[key];
  return {
    name: t.name,
    language: WA_LANGUAGE,
    category: "MARKETING",
    components: [
      { type: "BODY", text: t.body, example: { body_text: [["Juan", "plomería", "San Isidro"]] } },
      { type: "FOOTER", text: SUPPLY_FOOTER },
      {
        type: "BUTTONS",
        buttons: [
          { type: "URL", text: "Quiero sumarme", url: `${SITE}/alta?ref={{1}}`, example: [`${SITE}/alta?ref=fx-001`] },
          { type: "QUICK_REPLY", text: OPT_OUT_BUTTON },
        ],
      },
    ],
  };
}

async function graph<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(graphUrl(path), {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const j = (await res.json().catch(() => ({}))) as { error?: { message?: string; error_user_msg?: string; code?: number } } & T;
  if (!res.ok || j.error) {
    const err = new Error(j.error?.error_user_msg || j.error?.message || `Meta respondió ${res.status}`) as Error & { code?: number };
    err.code = j.error?.code ?? res.status;
    throw err;
  }
  return j;
}

/** Estado de las plantillas en la cuenta (APPROVED, PENDING, REJECTED o NO_CREADA). */
export async function supplyTemplatesStatus(): Promise<Record<SupplyTemplateKey, string> | null> {
  if (!token() || !env().SUPPLY_WHATSAPP_WABA_ID) return null;
  const j = await graph<{ data?: { name: string; language: string; status: string }[] }>(`${env().SUPPLY_WHATSAPP_WABA_ID}/message_templates?fields=name,language,status&limit=200`).catch(() => null);
  if (!j) return null;
  const out = {} as Record<SupplyTemplateKey, string>;
  for (const k of Object.keys(SUPPLY_TEMPLATES) as SupplyTemplateKey[]) {
    out[k] = j.data?.find((t) => t.name === SUPPLY_TEMPLATES[k].name && t.language === WA_LANGUAGE)?.status ?? "NO_CREADA";
  }
  return out;
}

/** Manda a revisión de Meta las plantillas que falten. */
export async function createSupplyTemplates(): Promise<string[]> {
  const status = await supplyTemplatesStatus();
  if (!status) return ["No se pudo consultar a Meta: faltan SUPPLY_WHATSAPP_WABA_ID o el token, o el token no tiene permiso sobre esa cuenta."];
  const out: string[] = [];
  for (const k of Object.keys(SUPPLY_TEMPLATES) as SupplyTemplateKey[]) {
    if (status[k] !== "NO_CREADA") { out.push(`${SUPPLY_TEMPLATES[k].name}: ${status[k]}`); continue; }
    try {
      await graph(`${env().SUPPLY_WHATSAPP_WABA_ID}/message_templates`, { method: "POST", body: supplyTemplateDefinition(k) });
      out.push(`${SUPPLY_TEMPLATES[k].name}: enviada a revisión de Meta`);
    } catch (e) {
      out.push(`${SUPPLY_TEMPLATES[k].name}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  return out;
}

export type NumberStatus = {
  display: string | null; name: string | null; quality: string | null; tier: string | null;
  /** AVAILABLE, LIMITED o BLOCKED según Meta (health_status), con los motivos que informa (p. ej. sin medio de pago). */
  canSend: string | null; problems: string[]; mode: string | null; status: string | null;
};

type HealthEntity = { entity_type?: string; can_send_message?: string; errors?: { error_code?: number; error_description?: string; possible_solution?: string }[] };

/** Calidad, límite y salud del número comercial (null si no está configurado o Meta no responde). */
export async function supplyNumberStatus(): Promise<NumberStatus | null> {
  if (!supplyNumberConfigured()) return null;
  const j = await graph<{
    display_phone_number?: string; verified_name?: string; quality_rating?: string; messaging_limit_tier?: string;
    account_mode?: string; status?: string; health_status?: { can_send_message?: string; entities?: HealthEntity[] };
  }>(`${env().SUPPLY_WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,account_mode,status,health_status`).catch(() => null);
  if (!j) return null;
  const problems = (j.health_status?.entities ?? []).flatMap((e) =>
    (e.errors ?? []).map((x) => `${e.entity_type ?? "?"} ${x.error_code ?? ""}: ${x.error_description ?? ""}${x.possible_solution ? ` (${x.possible_solution})` : ""}`.slice(0, 300)));
  return {
    display: j.display_phone_number ?? null, name: j.verified_name ?? null, quality: j.quality_rating ?? null, tier: j.messaging_limit_tier ?? null,
    canSend: j.health_status?.can_send_message ?? null, problems, mode: j.account_mode ?? null, status: j.status ?? null,
  };
}

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string; permanent: boolean };

/** Manda una plantilla de invitación desde el número comercial y la registra en whatsapp_messages. */
export async function sendSupplyTemplate(to: string, key: SupplyTemplateKey, params: string[], buttonParam: string): Promise<SendResult> {
  const payload = {
    messaging_product: "whatsapp", recipient_type: "individual", to, type: "template",
    template: {
      name: SUPPLY_TEMPLATES[key].name, language: { code: WA_LANGUAGE },
      components: [
        { type: "body", parameters: params.map((text) => ({ type: "text", text })) },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: buttonParam }] },
      ],
    },
  };
  if (!supplyNumberConfigured()) {
    // Desarrollo y pruebas: se registra sin enviar.
    await sql()`insert into whatsapp_messages (phone, direction, kind, body, status) values (${to}, 'out', 'template', ${sql().json({ ...payload, via: "captacion" } as never)}, 'simulated')`;
    return { ok: true, id: null };
  }
  try {
    const j = await graph<{ messages?: { id: string }[] }>(`${env().SUPPLY_WHATSAPP_PHONE_NUMBER_ID}/messages`, { method: "POST", body: payload });
    const id = j.messages?.[0]?.id ?? null;
    await sql()`insert into whatsapp_messages (wa_message_id, phone, direction, kind, body, status)
      values (${id}, ${to}, 'out', 'template', ${sql().json({ ...payload, via: "captacion" } as never)}, 'sent') on conflict (wa_message_id) do nothing`;
    return { ok: true, id };
  } catch (e) {
    const code = (e as { code?: number }).code ?? 0;
    // 131026: no tiene WhatsApp; 131050: no acepta marketing; 131049: Meta lo limitó por ecosistema; 132xxx: plantilla.
    return { ok: false, error: `Meta ${code}: ${(e as Error).message.slice(0, 200)}`, permanent: [131026, 131050, 131047].includes(code) };
  }
}
