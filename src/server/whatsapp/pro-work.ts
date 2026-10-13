/**
 * El profesional trabaja desde WhatsApp, sin abrir la web:
 *   pedidos → ve lo que le llegó y responde (acepta la visita, se anota por el precio del cliente o pasa su precio)
 *   dni     → manda la foto del documento para verificar su perfil
 *   cobro   → carga a dónde le transferimos lo que gane
 * Todo usa los mismos módulos que el panel web: valen las mismas reglas y permisos.
 */
import { sql, systemTx } from "@/server/db/client";
import { loadActor, type Actor } from "@/server/auth/actor";
import { isDomainError } from "@/server/domain/errors";
import { formatMoney } from "@/lib/format";
import { acceptBooking, createQuote, placeBid } from "@/server/modules/quotes";
import { declineInvitation, markInvitationViewed } from "@/server/modules/requests";
import { providerEligibility, submitForReview } from "@/server/modules/providers";
import { saveBankAccount } from "@/server/modules/withdrawals";
import { notify, staffRecipients } from "@/server/notifications";
import { normalize } from "@/server/assistant/rules";
import { parseBudget } from "./understand";
import type { OutMessage } from "./client";

export type WorkStep = "pw_list" | "pw_op" | "pw_day" | "pw_window" | "pw_price" | "pw_confirm" | "pw_dni" | "pw_bank_account" | "pw_bank_holder" | "pw_bank_tax";
export type WorkDraft = {
  invId?: string; mode?: "direct" | "quotes" | "budget"; label?: string; budgetMinor?: number | null; visitFeeMinor?: number;
  date?: string; amountMinor?: number; dniSide?: "front" | "back";
  account?: { alias?: string; cbu?: string }; holderName?: string;
};
type In = { text: string; reply: string; isImage: boolean; fileId?: string };
type Ctx = { phone: string; name: string; userId: string | null; out: OutMessage[] };
type Result = { step: WorkStep | "done" | "idle"; pw?: WorkDraft };
type Me = { actor: Actor; providerId: string; providerName: string };

const TZ = "America/Argentina/Buenos_Aires";
const done: Result = { step: "done" };
const say = (ctx: Ctx, text: string) => { ctx.out.push({ kind: "text", text }); };

/** El profesional (administrador de su perfil) detrás de este número, o null. */
export async function providerFor(userId: string | null): Promise<Me | null> {
  if (!userId) return null;
  const [m] = await sql()<{ provider_id: string; name: string }[]>`
    select m.provider_id, p.display_name as name from provider_members m join providers p on p.id = m.provider_id
    where m.user_id = ${userId} and m.active and m.role = 'admin' and p.closed_at is null limit 1`;
  if (!m) return null;
  const actor = await systemTx((tx) => loadActor(tx, userId));
  return actor ? { actor, providerId: m.provider_id, providerName: m.name } : null;
}

export const wantsWorkList = (t: string) => /^(pedidos|trabajos|oportunidades|ver pedidos|mis pedidos|que hay|hay trabajo|hay pedidos)$/.test(t);
export const wantsDni = (t: string) => /^(dni|documento|verificar|verificarme|verificar mi perfil|mandar dni)$/.test(t);
export const wantsBank = (t: string) => /^(cobro|cobros|cobrar|cbu|cvu|alias|cuenta|datos de cobro|banco|como cobro)$/.test(t);

/** Fecha en Buenos Aires, corrida `days` días, como AAAA-MM-DD. */
function dayPlus(days: number): string {
  const now = new Date(Date.now() + days * 86400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const dayLabel = (iso: string) => new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "numeric" }).format(new Date(`${iso}T12:00:00Z`));

/** "hoy", "mañana", "pasado", "15/10", "el lunes"… → fecha (entre hoy y 30 días), o null. */
export function parseDay(raw: string): string | null {
  const t = normalize(raw);
  if (/^hoy\b/.test(t)) return dayPlus(0);
  if (/^pasado( manana)?\b/.test(t)) return dayPlus(2);
  if (/^manana\b/.test(t)) return dayPlus(1);
  const wd = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"].findIndex((d) => new RegExp(`\\b${d}\\b`).test(t));
  if (wd >= 0) {
    for (let i = 1; i <= 7; i++) if (new Date(`${dayPlus(i)}T12:00:00Z`).getUTCDay() === wd) return dayPlus(i);
  }
  const m = t.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
  if (m) {
    const today = dayPlus(0);
    for (const year of [Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1]) {
      const iso = `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      const d = new Date(`${iso}T12:00:00Z`);
      if (!Number.isNaN(d.getTime()) && d.getUTCDate() === Number(m[1]) && iso >= today && iso <= dayPlus(30)) return iso;
    }
  }
  return null;
}

const WINDOWS: Record<string, string> = { w_am: "Por la mañana (8 a 12 h)", w_pm: "Por la tarde (12 a 18 h)", w_eve: "Al final del día (18 a 21 h)" };

// ───────────────────────── Pedidos ─────────────────────────

type OpenInv = { id: string; code: string; title: string; mode: "direct" | "quotes" | "budget"; budget_minor: number | null; zone: string; category: string | null };

async function openInvitations(providerId: string): Promise<OpenInv[]> {
  return sql()<OpenInv[]>`
    select i.id, r.code, r.title, r.request_mode as mode, r.budget_minor::int as budget_minor, z.name as zone, c.name as category
    from request_invitations i join service_requests r on r.id = i.request_id join properties p on p.id = r.property_id join zones z on z.id = p.zone_id
      left join categories c on c.id = r.category_id
    where i.provider_id = ${providerId} and i.status in ('invited','viewed') and r.status in ('searching','with_quotes')
    order by i.created_at desc limit 10`;
}

export async function showWorkList(me: Me, ctx: Ctx): Promise<Result> {
  const list = await openInvitations(me.providerId);
  if (!list.length) {
    say(ctx, "Por ahora no hay pedidos esperando tu respuesta. Apenas entre uno de tu rubro y zona, te aviso por acá 👍");
    return done;
  }
  ctx.out.push({
    kind: "list", text: list.length === 1 ? "Tenés *1 pedido* esperando tu respuesta. Tocá para verlo:" : `Tenés *${list.length} pedidos* esperando tu respuesta. Tocá uno para verlo:`, button: "Ver pedidos",
    sections: [{ title: "Pedidos", rows: list.map((i) => ({ id: `pw:inv:${i.id}`, title: i.title.slice(0, 24), description: `${i.code} · ${i.zone}${i.mode === "budget" && i.budget_minor ? ` · paga ${formatMoney(i.budget_minor)}` : i.mode === "direct" ? " · te eligió a vos" : ""}`.slice(0, 72) })) }],
  });
  return { step: "pw_list" };
}

/** Muestra un pedido y qué puede hacer con él. La dirección exacta nunca se muestra: solo la zona. */
async function showOpportunity(me: Me, invId: string, ctx: Ctx): Promise<Result> {
  const [o] = await sql()<{ id: string; code: string; title: string; description: string; urgency: string; mode: "direct" | "quotes" | "budget"; budget_minor: number | null; zone: string; category: string | null; category_id: string | null; gated: boolean; visit_fee_minor: number; status: string; request_status: string }[]>`
    select i.id, r.category_id, r.code, r.title, r.description, r.urgency, r.request_mode as mode, r.budget_minor::int as budget_minor, z.name as zone, c.name as category,
      p.gated_community as gated, pr.visit_fee_minor::int as visit_fee_minor, i.status, r.status as request_status
    from request_invitations i join service_requests r on r.id = i.request_id join properties p on p.id = r.property_id join zones z on z.id = p.zone_id
      join providers pr on pr.id = i.provider_id left join categories c on c.id = r.category_id
    where i.id = ${invId} and i.provider_id = ${me.providerId}`;
  if (!o || !["invited", "viewed"].includes(o.status) || !["searching", "with_quotes"].includes(o.request_status)) {
    say(ctx, "Ese pedido ya no está disponible. Escribí *pedidos* para ver los que siguen abiertos.");
    return done;
  }
  await markInvitationViewed(me.actor, invId).catch(() => null);
  const head = `*${o.title}*\n${o.code}${o.category ? ` · ${o.category}` : ""} · ${o.zone}${o.urgency === "urgent" ? " · 🔴 Urgente" : ""}\n\n“${o.description.slice(0, 500)}”`;
  const pw: WorkDraft = { invId, mode: o.mode, label: `${o.code} · ${o.title}`.slice(0, 80), budgetMinor: o.budget_minor, visitFeeMinor: o.visit_fee_minor };
  // La misma regla que en el panel: para responder un pedido el perfil tiene que estar verificado y aprobado.
  const elig = await providerEligibility(sql(), me.providerId, o.category_id);
  if (!elig.eligible) {
    const [st] = await sql()<{ identity_status: string }[]>`select identity_status from providers where id = ${me.providerId}`;
    if (["unverified", "rejected"].includes(st.identity_status)) {
      say(ctx, `${head}\n\n👉 Para tomar pedidos primero tengo que *verificar tu identidad*. Es un minuto:`);
      return startDni(ctx);
    }
    say(ctx, `${head}\n\n👉 Todavía no podés responderlo: ${elig.reasons.join(" ")}\n\nApenas quede listo te aviso por acá.`);
    return done;
  }
  if (o.gated) {
    say(ctx, `${head}\n\nEs en un barrio cerrado y tiene requisitos de ingreso que hay que revisar. Para responder este pedido escribí *entrar* y abrilo desde tu panel.`);
    return done;
  }
  if (o.mode === "direct") {
    ctx.out.push({ kind: "buttons", text: `${head}\n\n👉 El cliente *te eligió a vos* para ir a ver el problema. ${o.visit_fee_minor > 0 ? `Tu visita cuesta ${formatMoney(o.visit_fee_minor)}.` : "Tu visita es sin cargo."}\n\n¿Podés ir?`, buttons: [{ id: "pw_accept", title: "Sí, voy ✅" }, { id: "pw_decline", title: "No puedo" }] });
  } else if (o.mode === "budget" && o.budget_minor) {
    ctx.out.push({ kind: "buttons", text: `${head}\n\n👉 El cliente paga *${formatMoney(o.budget_minor)}* por el trabajo completo (mano de obra y materiales). Fixy no te cobra comisión.\n\n¿Lo hacés?`, buttons: [{ id: "pw_accept", title: "Lo hago ✅" }, { id: "pw_lower", title: "Ofrecer menos" }, { id: "pw_decline", title: "No puedo" }] });
  } else {
    ctx.out.push({ kind: "buttons", text: `${head}\n\n👉 El cliente pide presupuestos. ¿Querés pasarle tu precio?`, buttons: [{ id: "pw_price", title: "Pasar mi precio" }, { id: "pw_decline", title: "No puedo" }] });
  }
  return { step: "pw_op", pw };
}

const askDay = (pw: WorkDraft, ctx: Ctx): Result => {
  ctx.out.push({ kind: "buttons", text: "¿Qué día podés ir?\nTocá una opción o escribime el día (por ejemplo: _viernes_ o _20/10_).", buttons: [{ id: "d_0", title: "Hoy" }, { id: "d_1", title: "Mañana" }, { id: "d_2", title: "Pasado mañana" }] });
  return { step: "pw_day", pw };
};
const askPrice = (pw: WorkDraft, ctx: Ctx, lower = false): Result => {
  say(ctx, lower
    ? `¿Por cuánto lo harías? Tiene que ser *menos* que ${formatMoney(pw.budgetMinor ?? 0)}. Escribí solo el número, por ejemplo: _45000_.`
    : "¿Cuánto cobrás por el trabajo completo, *con materiales incluidos*?\nEscribí solo el número, por ejemplo: _45000_.");
  return { step: "pw_price", pw };
};
const failed = (e: unknown, ctx: Ctx): Result => {
  say(ctx, isDomainError(e) ? `${e.message}\nEscribí *pedidos* para ver los que siguen abiertos.` : "No pude guardar tu respuesta. Probá de nuevo en un rato o escribí *entrar* para hacerlo desde tu panel.");
  return done;
};

// ───────────────────────── DNI ─────────────────────────

export function startDni(ctx: Ctx): Result {
  say(ctx, "Para verificar tu perfil necesito una foto de tu DNI 🪪\n\nSacale una foto al *frente* (que se lean bien los datos) y mandámela por acá.\n\nSolo la ve el equipo de Fixy; no se publica.");
  return { step: "pw_dni", pw: { dniSide: "front" } };
}

/** La foto ya quedó guardada como archivo privado: pasa a ser un documento del profesional. */
async function attachIdentityPhoto(me: Me, fileId: string) {
  await systemTx(async (tx) => {
    await tx`update files set purpose = 'provider_document', owner_type = 'provider', owner_id = ${me.providerId} where id = ${fileId}`;
    await tx`delete from whatsapp_media where file_id = ${fileId}`;
    await tx`insert into provider_documents (provider_id, kind, file_id) values (${me.providerId}, 'identity', ${fileId})`;
    await tx`update providers set identity_status = 'pending' where id = ${me.providerId} and identity_status in ('unverified','rejected')`;
  });
}

// ───────────────────────── Cobro ─────────────────────────

export async function startBank(me: Me, ctx: Ctx): Promise<Result> {
  const [b] = await sql()<{ alias: string | null; cbu: string | null }[]>`select alias, cbu from provider_bank_accounts where provider_id = ${me.providerId}`;
  say(ctx, `${b ? `Hoy te transferimos a ${b.alias ?? `la cuenta terminada en ${b.cbu?.slice(-4)}`}. Si querés cambiarla, mandame la nueva.\n\n` : ""}¿A qué cuenta te transferimos lo que ganes? 💸\n\nEscribime tu *alias* (por ejemplo: _juan.perez.mp_) o tu *CBU/CVU* (22 números). Sirve Mercado Pago, Ualá o cualquier banco.`);
  return { step: "pw_bank_account", pw: {} };
}

// ───────────────────────── Pasos ─────────────────────────

export async function workStep(step: WorkStep, pw: WorkDraft, input: In, me: Me, ctx: Ctx): Promise<Result> {
  const text = input.text.trim();
  const t = normalize(text);
  const { reply } = input;
  if (reply.startsWith("pw:inv:")) return showOpportunity(me, reply.slice(7), ctx);

  switch (step) {
    case "pw_list":
      return showWorkList(me, ctx);

    case "pw_op": {
      if (!pw.invId) return showWorkList(me, ctx);
      if (reply === "pw_decline" || /^no( puedo)?$/.test(t)) {
        try {
          await declineInvitation(me.actor, pw.invId, "No puede tomarlo (respondido por WhatsApp)");
          say(ctx, "Listo, le avisamos al cliente. Te escribo cuando haya otro pedido 👍");
        } catch (e) { return failed(e, ctx); }
        return done;
      }
      if (pw.mode === "direct" && (reply === "pw_accept" || /^(si|sí|voy|dale|acepto)\b/.test(t))) return askDay(pw, ctx);
      if (pw.mode === "budget" && reply === "pw_lower") return askPrice(pw, ctx, true);
      if (pw.mode === "budget" && (reply === "pw_accept" || /^(si|sí|lo hago|dale|acepto)\b/.test(t))) {
        try {
          await placeBid(me.actor, { invitationId: pw.invId, amountMinor: pw.budgetMinor ?? 0, materialsIncluded: true, note: "" });
          say(ctx, `¡Anotado! Le avisamos al cliente que lo hacés por ${formatMoney(pw.budgetMinor ?? 0)}. Si te elige, te aviso por acá 🤞`);
        } catch (e) { return failed(e, ctx); }
        return done;
      }
      if (pw.mode === "quotes" && (reply === "pw_price" || /^(si|sí|dale|pasar)\b/.test(t))) return askPrice(pw, ctx);
      // Si escribe directamente un monto, lo tomamos como su precio.
      if (pw.mode !== "direct" && parseBudget(text)) return workStep("pw_price", pw, input, me, ctx);
      say(ctx, "Tocá uno de los botones de arriba para responder este pedido, o escribí *pedidos* para ver la lista.");
      return { step, pw };
    }

    case "pw_day": {
      const date = /^d_[012]$/.test(reply) ? dayPlus(Number(reply.slice(2))) : parseDay(text);
      if (!date) {
        say(ctx, "No entendí el día 🤔 Escribilo así: _hoy_, _mañana_, _viernes_ o _20/10_.");
        return { step, pw };
      }
      ctx.out.push({ kind: "buttons", text: `Perfecto, el *${dayLabel(date)}*. ¿En qué horario?`, buttons: [{ id: "w_am", title: "Mañana (8 a 12)" }, { id: "w_pm", title: "Tarde (12 a 18)" }, { id: "w_eve", title: "Tarde-noche (18-21)" }] });
      return { step: "pw_window", pw: { ...pw, date } };
    }

    case "pw_window": {
      const window = WINDOWS[reply] ?? (/manana/.test(t) ? WINDOWS.w_am : /noche|final/.test(t) ? WINDOWS.w_eve : /tarde/.test(t) ? WINDOWS.w_pm : text.length >= 2 && text.length <= 60 ? text : null);
      if (!window || !pw.invId || !pw.date) {
        say(ctx, "Tocá uno de los horarios de arriba, o escribime la hora (por ejemplo: _a las 10_).");
        return { step, pw };
      }
      try {
        await acceptBooking(me.actor, pw.invId, { proposedDate: pw.date, proposedWindow: window, note: "" });
        say(ctx, `¡Listo! Le propusimos al cliente tu visita para el *${dayLabel(pw.date)}*, ${window.toLowerCase()}.\n\nCuando la confirme te mando la dirección por acá 📍`);
      } catch (e) { return failed(e, ctx); }
      return done;
    }

    case "pw_price": {
      const amount = parseBudget(text);
      if (!amount || amount < 100_000) {
        say(ctx, "Escribí solo el número, sin letras. Por ejemplo: _45000_.");
        return { step, pw };
      }
      if (pw.mode === "budget" && pw.budgetMinor && amount >= pw.budgetMinor) {
        say(ctx, `Para ofrecer menos tiene que ser por debajo de ${formatMoney(pw.budgetMinor)}. Escribí otro número, o escribí *pedidos* para volver.`);
        return { step, pw };
      }
      ctx.out.push({ kind: "buttons", text: `Vas a ofrecer *${formatMoney(amount)}* por el trabajo completo, con materiales.\n\nEso es lo que cobrás vos: Fixy no te descuenta comisión.\n\n¿Lo mando?`, buttons: [{ id: "pw_send", title: "Sí, mandar ✅" }, { id: "pw_change", title: "Cambiar precio" }, { id: "cancel", title: "Cancelar" }] });
      return { step: "pw_confirm", pw: { ...pw, amountMinor: amount } };
    }

    case "pw_confirm": {
      if (reply === "pw_change" || /^cambiar/.test(t)) return askPrice(pw, ctx, pw.mode === "budget");
      if (reply !== "pw_send" && !/^(si|sí|dale|mandar|ok)\b/.test(t)) {
        say(ctx, "Tocá *Sí, mandar ✅* para enviar tu precio, o *Cambiar precio*.");
        return { step, pw };
      }
      if (!pw.invId || !pw.amountMinor) return showWorkList(me, ctx);
      try {
        if (pw.mode === "budget") await placeBid(me.actor, { invitationId: pw.invId, amountMinor: pw.amountMinor, materialsIncluded: true, note: "" });
        else {
          await createQuote(me.actor, {
            invitationId: pw.invId, mode: "quote", scope: "Trabajo completo según lo descripto en el pedido (mano de obra y materiales).", exclusions: "",
            materialsIncluded: true, proposedDate: "", proposedWindow: "", validDays: 7,
            items: [{ kind: "labor", description: "Trabajo completo (mano de obra y materiales)", quantity: 1, unitPriceMinor: pw.amountMinor }],
          });
        }
        say(ctx, `¡Enviado! El cliente ya ve tu precio de ${formatMoney(pw.amountMinor)}. Si te elige, te aviso por acá 🤞`);
      } catch (e) { return failed(e, ctx); }
      return done;
    }

    case "pw_dni": {
      if (reply === "pw_later" || /^(despues|después|ahora no|mas tarde|más tarde)$/.test(t)) {
        say(ctx, "Dale, cuando quieras escribime *dni* y lo hacemos.");
        return done;
      }
      if (!input.isImage || !input.fileId) {
        say(ctx, input.isImage ? "No pude abrir esa foto 😕 Mandámela de nuevo, por favor." : `Mandame una *foto* del ${pw.dniSide === "back" ? "dorso" : "frente"} de tu DNI. Si preferís hacerlo después, escribí *después*.`);
        return { step, pw };
      }
      await attachIdentityPhoto(me, input.fileId);
      if (pw.dniSide !== "back") {
        say(ctx, "¡Bien! Ahora dala vuelta y mandame una foto del *dorso* 🔄");
        return { step, pw: { dniSide: "back" } };
      }
      // Con el documento cargado, el perfil pasa a revisión del equipo (si falta algo más, queda igual avisado).
      await submitForReview(me.actor, me.providerId).catch(() => null);
      await systemTx(async (tx) => notify(tx, await staffRecipients(tx), { type: "provider_review", title: `DNI recibido por WhatsApp · ${me.providerName}`, body: "Revisar identidad.", link: `/admin/proveedores/${me.providerId}`, email: false })).catch(() => null);
      say(ctx, "¡Gracias! Ya tengo las dos fotos 🙌 El equipo de Fixy las revisa y te aviso por acá cuando tu perfil quede *verificado*.");
      return done;
    }

    case "pw_bank_account": {
      const digits = text.replace(/\D/g, "");
      const account = /^\d{22}$/.test(digits) && !/[a-zA-Z]/.test(text) ? { cbu: digits } : /^[A-Za-z0-9.-]{6,20}$/.test(text) ? { alias: text } : null;
      if (!account) {
        say(ctx, "Eso no parece un alias ni un CBU 🤔\nEl *alias* tiene entre 6 y 20 letras, números o puntos (por ejemplo: _juan.perez.mp_). El *CBU/CVU* son 22 números.");
        return { step, pw };
      }
      const [u] = await sql()<{ full_name: string }[]>`select full_name from users where id = ${me.actor.id}`;
      ctx.out.push({ kind: "buttons", text: `¿La cuenta está a tu nombre (*${u.full_name}*)?`, buttons: [{ id: "bank_self", title: "Sí, a mi nombre" }, { id: "bank_other", title: "No, es de otro" }] });
      return { step: "pw_bank_holder", pw: { account, holderName: u.full_name } };
    }

    case "pw_bank_holder": {
      const askTax = (holderName: string): Result => {
        say(ctx, `Último dato: el *CUIL o CUIT* de ${holderName === pw.holderName && reply === "bank_self" ? "tu cuenta" : holderName}. Son 11 números; el CUIL figura en el DNI nuevo o en la app Mi ANSES.`);
        return { step: "pw_bank_tax", pw: { ...pw, holderName } };
      };
      if (reply === "bank_self" || /^(si|sí)\b/.test(t)) return askTax(pw.holderName ?? "");
      if (reply === "bank_other" || /^no\b/.test(t)) {
        say(ctx, "¿A nombre de quién está la cuenta? Escribime nombre y apellido.");
        return { step, pw: { ...pw, holderName: undefined } };
      }
      if (!pw.holderName && /^[\p{L}][\p{L} .'-]{3,80}$/u.test(text)) return askTax(text);
      say(ctx, "Escribime el nombre y apellido de quien figura en la cuenta.");
      return { step, pw };
    }

    case "pw_bank_tax": {
      const taxId = text.replace(/\D/g, "");
      if (taxId.length !== 11 || !pw.account || !pw.holderName) {
        say(ctx, "El CUIL/CUIT tiene *11 números*. Escribilo sin guiones, por ejemplo: _20123456789_.");
        return { step, pw };
      }
      try {
        await saveBankAccount(me.actor, me.providerId, { holderName: pw.holderName, holderTaxId: taxId, cbu: pw.account.cbu ?? "", alias: pw.account.alias ?? "", bankName: "" });
        say(ctx, `¡Listo! Guardé tus datos de cobro (${pw.account.alias ?? `cuenta terminada en ${pw.account.cbu!.slice(-4)}`}). Ahí te vamos a transferir lo que ganes 💸`);
      } catch (e) { return failed(e, ctx); }
      return done;
    }
  }
}
