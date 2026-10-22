/**
 * Alta de profesionales por WhatsApp: cuatro respuestas y un botón.
 *   nombre → oficio → zona → aceptar condiciones → cuenta + perfil listos para recibir pedidos.
 * Camino aparte del alta web (que sigue igual): pensado para quien no usa email ni se lleva bien con formularios.
 * La cuenta queda identificada por el número de WhatsApp; el resto (DNI, cobro, fotos) se completa después.
 */
import { createHash, randomBytes } from "node:crypto";
import { sql, systemTx } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { audit } from "@/server/audit";
import { env } from "@/server/env";
import { normalize, triageByRules } from "@/server/assistant/rules";
import { guessZoneFromText } from "@/lib/zone-match";
import { nearestZoneCode } from "@/lib/zone-centroids";
import { acceptProviderTerms, createProvider, updateCoverage } from "@/server/modules/providers";
import { rematchOpenRequests } from "@/server/modules/requests";
import { notify, staffRecipients } from "@/server/notifications";
import type { OutMessage } from "./client";

export type ProDraft = { name?: string; categories?: string[]; tradeText?: string; tradeTries?: number; zoneId?: string; zoneName?: string; zoneTries?: number; ref?: string | null };
export type ProStep = "pro_name" | "pro_trade" | "pro_zone" | "pro_terms";
type Zone = { id: string; code: string; name: string; region: string; match_names: string[]; province: string | null; catch_all: boolean };
type In = { text: string; reply: string; location?: { lat: number; lng: number; name?: string; address?: string }; isImage: boolean };
type Ctx = { phone: string; name: string; userId: string | null; out: OutMessage[] };
type Result = { step: ProStep | "done" | "idle"; pro?: ProDraft };

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
export const WA_EMAIL_DOMAIN = "wa.fixy.solutions";

/** "Quiero trabajar con Fixy", "soy plomero y quiero sumarme", "quiero ofrecer mis servicios"… */
export const wantsProSignup = (t: string) =>
  /\b(quiero|quisiera|me gustaria|como hago para|puedo)\b.{0,30}\b(trabajar|sumarme|sumar|anotarme|registrarme|inscribirme|ofrecer)\b.{0,40}\b(fixy|ustedes|profesional|servicios?|plataforma|aca)\b/.test(t) ||
  /\b(trabajar con fixy|sumarme a fixy|ser profesional|ofrecer mis servicios|alta (de|como) profesional|registrarme como profesional)\b/.test(t);

/** Código de quien lo invitó, si vino en el mensaje del link ("… (invitación plomeria-sosa-1a2b)"). */
export const refFromText = (raw: string) => raw.match(/invitaci[oó]n\s+([a-z0-9]+(?:-[a-z0-9]+)*)/i)?.[1]?.toLowerCase() ?? null;

/** Nombres de oficio tal como los dice la gente → rubros del catálogo. */
const TRADE_WORDS: [RegExp, string][] = [
  [/\bplomer|\bsanitarist|\bdestapacion/, "plomeria"], [/\belectricist|\belectricidad/, "electricidad"], [/\bgasist|\bgas\b/, "gas"],
  [/\baires?\b|\bsplit|\brefrigeracion|\bclimatiza/, "climatizacion"], [/\bheladera|\blavarropa|\belectrodomestic/, "electrodomesticos"],
  [/\bcerrajer/, "cerrajeria"], [/\bpintor|\bpintura|\bpinto\b/, "pintura"], [/\balbanil|\balbanileria|\bmamposter/, "albanileria"],
  [/\bcarpinter|\bmueble/, "carpinteria"], [/\blimpieza|\blimpio\b/, "limpieza"], [/\binformatic|\bcomputadora|\bredes\b|\bwifi/, "informatica"],
  [/\bjardiner|\bpaisajis|\bparquista|\bcorto (el )?pasto|\bpoda/, "jardineria"], [/\bpileter|\bpiscin|\bpiletas?\b/, "piletas"],
  [/\bfumig|\bplagas|\bdesinfecc/, "fumigacion"], [/\bvolquete|\bescombro/, "volquetes"], [/\bflete|\bmudanza/, "mudanzas"],
  [/\bconstruc|\breforma|\bobras?\b|\bmaestro mayor/, "reformas"], [/\barquitect|\bingenier/, "arquitectura"], [/\bdecorad|\binterioris/, "decoracion"],
  [/\btechist|\btechos?\b|\bmembrana|\bzinguer/, "techos"], [/\bpisos?\b|\bceramic|\bporcelanato|\bcolocador|\bparquet/, "pisos"],
  [/\bdurlock|\byeser|\bcielorraso/, "durlock"], [/\bherrer|\bsoldad|\bporton/, "herreria"], [/\bvidrier|\bvidrios?\b|\baberturas?\b|\baluminio/, "vidrieria"],
  [/\bmarmol|\bmesadas?\b/, "marmoleria"], [/\balarma|\bcamaras?\b|\bportero/, "seguridad"], [/\bsolar/, "energia-solar"],
  [/\bcortina|\bpersiana|\btoldo/, "cortinas"], [/\btapicer/, "tapiceria"], [/\btelevisor|\btv\b|\baudio\b/, "tv-audio"], [/\bdomotic/, "domotica"],
  [/\bcalefacc|\bcaldera|\bradiador/, "calefaccion"], [/\bascensor/, "ascensores"],
  [/\bmantenimiento|\bchangas|\barreglos varios|\bde todo|\bmultioficio|\bhandyman/, "mantenimiento"],
];

/** Rubros que reconoce en lo que escribió ("soy plomero y gasista", "arreglo aires y heladeras"). Máximo cinco. */
export function tradesFromText(raw: string): string[] {
  const t = ` ${normalize(raw)} `;
  const found = TRADE_WORDS.filter(([re]) => re.test(t)).map(([, slug]) => slug);
  if (!found.length) {
    const r = triageByRules(raw);
    if (r.categorySlug && r.categorySlug !== "otro") found.push(r.categorySlug);
  }
  return [...new Set(found)].slice(0, 5);
}

const looksLikeName = (raw: string) => /^[\p{L}][\p{L} .'-]{2,60}$/u.test(raw.trim()) && !/\b(hola|quiero|trabajar|fixy|plomero|electricista|gracias)\b/i.test(raw);
const titleCase = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());

async function zones(): Promise<Zone[]> {
  return sql()<Zone[]>`select id, code, name, region, match_names, province, catch_all from zones where active order by sort, name`;
}
async function categoryNames(slugs: string[]): Promise<string[]> {
  if (!slugs.length) return [];
  const rows = await sql()<{ slug: string; name: string }[]>`select slug, name from categories where slug in ${sql()(slugs)} and active`;
  return slugs.map((s) => rows.find((r) => r.slug === s)?.name).filter((n): n is string => !!n);
}
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/** Arranca el alta. Si el número ya tiene un perfil profesional, no vuelve a preguntar. */
export async function startProSignup(ctx: Ctx, rawText: string): Promise<Result> {
  if (ctx.userId) {
    const [mine] = await sql()<{ name: string }[]>`
      select p.display_name as name from provider_members m join providers p on p.id = m.provider_id where m.user_id = ${ctx.userId} and m.active limit 1`;
    if (mine) {
      ctx.out.push({ kind: "text", text: `Ya estás en Fixy como *${mine.name}* 👍\nCuando haya un trabajo para vos te aviso por acá. Para ver tu perfil, escribí *entrar*.` });
      return { step: "done" };
    }
  }
  const pro: ProDraft = { ref: refFromText(rawText) };
  // El rubro puede venir en el primer mensaje ("soy plomero y quiero trabajar con Fixy").
  const early = tradesFromText(rawText.replace(/fixy/gi, " "));
  if (early.length) { pro.categories = early; pro.tradeText = rawText.slice(0, 300); }
  if (ctx.userId) {
    const [u] = await sql()<{ full_name: string }[]>`select full_name from users where id = ${ctx.userId}`;
    pro.name = u?.full_name;
    ctx.out.push({ kind: "text", text: `¡Buenísimo, ${ctx.name}! Te sumo a Fixy en un minuto 💪` });
    return askTrade(pro, ctx);
  }
  ctx.out.push({ kind: "text", text: "¡Hola! 👋 Te sumo a Fixy en un minuto, son solo 3 preguntas.\n\n*1 de 3* · ¿Cómo te llamás? Escribime tu nombre y apellido." });
  return { step: "pro_name", pro };
}

function askTrade(pro: ProDraft, ctx: Ctx): Result | Promise<Result> {
  if (pro.categories?.length) return askZone(pro, ctx);
  ctx.out.push({ kind: "text", text: `*2 de 3* · ¿Qué trabajo hacés?\nEscribilo como te salga. Por ejemplo: _plomero_, _electricista y gasista_, _pintor_, _jardinero_.` });
  return { step: "pro_trade", pro };
}

function askZone(pro: ProDraft, ctx: Ctx): Result {
  ctx.out.push({ kind: "text", text: `*3 de 3* · ¿En qué zona trabajás?\nEscribime tu localidad y provincia. Por ejemplo: _Morón, Buenos Aires_ o _Córdoba capital_.\n\nTambién podés mandarme tu ubicación 📍` });
  return { step: "pro_zone", pro };
}

async function askTerms(pro: ProDraft, ctx: Ctx): Promise<Result> {
  const names = await categoryNames(pro.categories ?? []);
  const base = env().APP_URL.replace(/\/$/, "");
  ctx.out.push({
    kind: "buttons",
    text: `¡Casi listo, ${pro.name!.split(" ")[0]}! Anoté esto:\n\n👤 ${pro.name}\n🔧 ${list(names)}\n📍 ${pro.zoneName}\n\nPara terminar, aceptá las condiciones de Fixy (${base}/terminos/profesionales) y recibir por este WhatsApp los avisos de trabajos. Sumarte es gratis.`,
    buttons: [{ id: "pro_accept", title: "Acepto ✅" }, { id: "pro_fix", title: "Corregir" }, { id: "cancel", title: "Cancelar" }],
  });
  return { step: "pro_terms", pro };
}

/** Un paso del alta. Devuelve el próximo estado. */
export async function proSignupStep(step: ProStep, pro: ProDraft, input: In, ctx: Ctx): Promise<Result> {
  const text = input.text.trim();
  if (input.isImage) {
    ctx.out.push({ kind: "text", text: "Las fotos te las pido después 🙂 Ahora respondeme la pregunta de arriba, por favor." });
    return { step, pro };
  }
  switch (step) {
    case "pro_name": {
      if (!looksLikeName(text)) {
        ctx.out.push({ kind: "text", text: "Escribime solo tu nombre y apellido. Por ejemplo: _Juan Pérez_." });
        return { step, pro };
      }
      return askTrade({ ...pro, name: titleCase(text).slice(0, 80) }, ctx);
    }
    case "pro_trade": {
      const cats = tradesFromText(text);
      if (!cats.length) {
        const tries = (pro.tradeTries ?? 0) + 1;
        if (tries < 2) {
          ctx.out.push({ kind: "text", text: "No reconocí ese oficio 🤔 Decímelo con otras palabras. Por ejemplo: _plomero_, _electricista_, _albañil_, _pintor_, _jardinero_, _fletes_." });
          return { step, pro: { ...pro, tradeTries: tries } };
        }
        // No lo trabamos: entra como arreglos generales y el equipo lo ajusta con lo que escribió.
        return askZone({ ...pro, categories: ["mantenimiento"], tradeText: text.slice(0, 300) }, ctx);
      }
      return askZone({ ...pro, categories: cats, tradeText: text.slice(0, 300) }, ctx);
    }
    case "pro_zone": {
      const all = await zones();
      let zone: Zone | null = null;
      if (input.location) {
        const byText = guessZoneFromText(`${input.location.name ?? ""} ${input.location.address ?? ""}`, all);
        const code = byText ? null : nearestZoneCode(input.location.lat, input.location.lng, 30);
        zone = byText ?? all.find((z) => z.code === code) ?? null;
      } else if (text.length >= 3) zone = guessZoneFromText(text, all);
      if (!zone) {
        const tries = (pro.zoneTries ?? 0) + 1;
        if (tries < 2) {
          ctx.out.push({ kind: "text", text: "No encontré esa zona 🤔 Escribime la *localidad y la provincia*. Por ejemplo: _Quilmes, Buenos Aires_ o _Rosario, Santa Fe_." });
          return { step, pro: { ...pro, zoneTries: tries } };
        }
        zone = all.find((z) => z.code === "otra-zona") ?? null;
        if (!zone) return { step, pro };
        return askTerms({ ...pro, zoneId: zone.id, zoneName: text.slice(0, 60) || "Tu zona" }, ctx);
      }
      return askTerms({ ...pro, zoneId: zone.id, zoneName: zone.name }, ctx);
    }
    case "pro_terms": {
      if (input.reply === "pro_fix" || /^(corregir|cambiar|esta mal|no)$/.test(normalize(text))) {
        ctx.out.push({ kind: "text", text: "Dale, lo hacemos de nuevo.\n\n*1 de 3* · ¿Cómo te llamás? Escribime tu nombre y apellido." });
        return { step: "pro_name", pro: { ref: pro.ref } };
      }
      if (input.reply !== "pro_accept" && !/^(acepto|si acepto|sí acepto|dale|ok acepto|si|sí)\b/.test(normalize(text))) {
        ctx.out.push({ kind: "buttons", text: "Para sumarte tocá *Acepto ✅*. Si algo quedó mal, tocá *Corregir*.", buttons: [{ id: "pro_accept", title: "Acepto ✅" }, { id: "pro_fix", title: "Corregir" }, { id: "cancel", title: "Cancelar" }] });
        return { step, pro };
      }
      return finish(pro, ctx);
    }
  }
}

/** Crea la cuenta (si no la tenía) y el perfil profesional, listo para recibir pedidos. */
async function finish(pro: ProDraft, ctx: Ctx): Promise<Result> {
  if (!pro.name || !pro.categories?.length || !pro.zoneId) return { step: "pro_name", pro: { ref: pro.ref } };
  const email = `${ctx.phone}@${WA_EMAIL_DOMAIN}`;
  const userId = ctx.userId ?? await systemTx(async (tx) => {
    const [u] = await tx<{ id: string }[]>`
      insert into users (email, password_hash, full_name, phone, whatsapp_phone, whatsapp_linked_at, email_placeholder)
      values (${email}, null, ${pro.name!}, ${`+${ctx.phone}`}, ${ctx.phone}, now(), true) returning id`;
    const policies = await tx<{ id: string }[]>`select distinct on (kind) id from policy_documents where kind in ('terms','privacy') order by kind, published_at desc`;
    for (const p of policies) await tx`insert into policy_acceptances (user_id, policy_id) values (${u.id}, ${p.id}) on conflict do nothing`;
    await audit(tx, null, "whatsapp.signup", "user", u.id, "Alta de profesional por WhatsApp", { phoneTail: ctx.phone.slice(-4) });
    return u.id;
  });
  await sql()`update users set wa_provider_alerts = true, wa_alerts_consent_at = now() where id = ${userId}`;
  const me = (await systemTx((tx) => loadActor(tx, userId)))!;
  const names = await categoryNames(pro.categories);
  const [contact] = await sql()<{ email: string; placeholder: boolean }[]>`select email, email_placeholder as placeholder from users where id = ${userId}`;
  const description = `${pro.name}. ${list(names)} en ${pro.zoneName}.${pro.tradeText ? ` En sus palabras: "${pro.tradeText.replace(/["\n]/g, " ").slice(0, 200)}".` : ""} Perfil creado por WhatsApp.`;
  const providerId = await createProvider(me, {
    kind: "individual", displayName: pro.name.slice(0, 120), responsibleName: pro.name.slice(0, 120), contactEmail: contact.email, contactPhone: `+${ctx.phone}`, description,
  }, { source: "whatsapp", referrerSlug: pro.ref ?? null });
  const withProvider = (await systemTx((tx) => loadActor(tx, userId)))!;
  // En el orden en que los nombró: el primero es su oficio principal.
  const found = await sql()<{ id: string; slug: string }[]>`select id, slug from categories where slug in ${sql()(pro.categories)} and active`;
  const cats = pro.categories.map((slug) => found.find((c) => c.slug === slug)).filter((c): c is { id: string; slug: string } => !!c);
  await updateCoverage(withProvider, providerId, {
    categoryIds: cats.map((c) => c.id), primaryCategoryId: cats[0]?.id, zoneIds: [pro.zoneId], baseZoneId: pro.zoneId, acceptingJobs: true, maxActiveJobs: 5,
    // Horario de arranque: lunes a sábado de 8 a 19. Lo cambia cuando quiera desde su panel.
    availability: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 8 * 60, endMinute: 19 * 60 })),
  });
  await acceptProviderTerms(withProvider);
  await systemTx(async (tx) => notify(tx, await staffRecipients(tx), {
    type: "provider_review", title: `Nuevo profesional por WhatsApp · ${pro.name}`, body: `${list(names)} en ${pro.zoneName}. Falta verificar identidad.`, link: `/admin/proveedores/${providerId}`, email: false,
  })).catch(() => null);
  await rematchOpenRequests({ providerId }).catch(() => 0);
  ctx.out.push({ kind: "text", text: `¡Listo, ${pro.name.split(" ")[0]}! Ya estás en Fixy 🎉\n\nCuando haya un trabajo de ${list(names).toLowerCase()} en tu zona, te aviso por acá y lo respondés desde este mismo chat.` });
  ctx.out.push({ kind: "buttons", text: "Un paso más, si querés: mandame una foto de tu DNI y tu perfil queda *verificado*. Los clientes eligen mucho más a los verificados.", buttons: [{ id: "pw_dni", title: "Mandar mi DNI" }, { id: "pw_later", title: "Después" }] });
  return { step: "done" };
}

/** "entrar": link de un solo uso para abrir el panel sin contraseña (dura 15 minutos). */
export async function sendLoginLink(ctx: Ctx): Promise<void> {
  if (!ctx.userId) {
    ctx.out.push({ kind: "text", text: "Este WhatsApp todavía no tiene una cuenta en Fixy.\n\n• Si necesitás un profesional, contame qué problema tenés y te ayudo por acá.\n• Si sos profesional y querés sumarte, escribí *quiero trabajar con Fixy*." });
    return;
  }
  const token = randomBytes(24).toString("base64url");
  await sql()`insert into whatsapp_login_links (token_hash, user_id, expires_at) values (${hash(token)}, ${ctx.userId}, now() + interval '15 minutes')`;
  ctx.out.push({ kind: "text", text: `Tocá este link para entrar a Fixy (sirve una sola vez y vence en 15 minutos):\n${env().APP_URL.replace(/\/$/, "")}/wa/entrar/${token}\n\nNo se lo pases a nadie.` });
}

/** Canjea el link de ingreso. Devuelve el usuario y a qué panel va, o null si venció o ya se usó. */
export async function redeemLoginLink(token: string): Promise<{ userId: string; home: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [row] = await sql()<{ user_id: string }[]>`
    update whatsapp_login_links set used_at = now() where token_hash = ${hash(token)} and used_at is null and expires_at > now() returning user_id`;
  if (!row) return null;
  const [u] = await sql()<{ provider: boolean }[]>`
    select exists (select 1 from provider_members m where m.user_id = ${row.user_id} and m.active) as provider from users where id = ${row.user_id} and disabled_at is null`;
  if (!u) return null;
  return { userId: row.user_id, home: u.provider ? "/proveedor" : "/app" };
}

/** Para la página del link: a nombre de quién es, sin canjearlo. */
export async function peekLoginLink(token: string): Promise<{ firstName: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [row] = await sql()<{ full_name: string }[]>`
    select u.full_name from whatsapp_login_links l join users u on u.id = l.user_id
    where l.token_hash = ${hash(token)} and l.used_at is null and l.expires_at > now() and u.disabled_at is null`;
  return row ? { firstName: row.full_name.split(" ")[0] } : null;
}
