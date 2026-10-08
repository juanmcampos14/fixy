/**
 * Datos de DEMOSTRACIÓN (ficticios, marcados con is_demo y "(demo)").
 * Se generan ejecutando los mismos servicios de dominio que usa la aplicación, de modo que
 * estados, montos, eventos y registros financieros son consistentes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { systemTx } from "@/server/db/client";
import type { Db } from "@/server/db/client";
import { loadActor, type Actor } from "@/server/auth/actor";
import { registerUser } from "@/server/modules/users";
import * as providers from "@/server/modules/providers";
import * as props from "@/server/modules/properties";
import * as requests from "@/server/modules/requests";
import * as quotes from "@/server/modules/quotes";
import * as jobs from "@/server/modules/jobs";
import * as disputes from "@/server/modules/disputes";
import { executePayout, processPaymentWebhook } from "@/server/modules/payments";
import { buildMockWebhook, mockCompleteCheckout } from "@/server/payments/mock";

// En entornos públicos de demostración, definí DEMO_SEED_PASSWORD para no usar la contraseña conocida del repositorio.
export const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD || "fixy-demo-2026";
export const DEMO_DOMAIN = "demo.fixy.solutions";

export const DEMO_USERS = [
  { key: "admin", name: "Admin Plataforma (demo)", role: "admin", desc: "Administración: catálogo, comisiones, finanzas, auditoría" },
  { key: "operador", name: "Olivia Operaciones (demo)", role: "operator", desc: "Operación: revisa proveedores, solicitudes y reclamos" },
  { key: "ana", name: "Ana Gómez (demo)", desc: "Cliente particular con dos propiedades" },
  { key: "bruno", name: "Bruno Ferreyra (demo)", desc: "Cliente particular en GBA Sur (caso sin cobertura)" },
  { key: "carla", name: "Carla Ibáñez (demo)", desc: "Administradora de la organización Estudio Delta" },
  { key: "diego", name: "Diego Paz (demo)", desc: "Miembro de la organización Estudio Delta" },
  { key: "martin", name: "Martín López (demo)", desc: "Electricista independiente, aprobado, con historial" },
  { key: "lucia", name: "Lucía Sosa (demo)", desc: "Plomera independiente, aprobada, sin reseñas" },
  { key: "roberto", name: "Roberto Díaz (demo)", desc: "Administrador de empresa proveedora con técnicos" },
  { key: "jorge", name: "Jorge Medina (demo)", desc: "Técnico de la empresa Servicios Integrales Norte" },
  { key: "valeria", name: "Valeria Ruiz (demo)", desc: "Técnica de la empresa Servicios Integrales Norte" },
  { key: "pablo", name: "Pablo Romero (demo)", desc: "Gasista en revisión (credencial pendiente)" },
  { key: "sofia", name: "Sofía Herrera (demo)", desc: "Proveedora con alta incompleta" },
  { key: "hernan", name: "Hernán Castro (demo)", desc: "Proveedor suspendido" },
] as const;

export const demoEmail = (key: string) => `${key}@${DEMO_DOMAIN}`;

const asset = (f: string) => ({ data: readFileSync(join(process.cwd(), "db", "seed-assets", f)), name: f });

const fullWeek = (start: number, end: number, days = [1, 2, 3, 4, 5]) => days.map((weekday) => ({ weekday, startMinute: start * 60, endMinute: end * 60 }));

export async function seedDemo(db: Db, log: (m: string) => void = console.log) {
  const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from users where is_demo`;
  if (n > 0) {
    log("Los datos de demostración ya existen (usá db:reset para regenerarlos).");
    return;
  }
  const ids: Record<string, string> = {};
  for (const u of DEMO_USERS) {
    ids[u.key] = await registerUser({ fullName: u.name, email: demoEmail(u.key), password: DEMO_PASSWORD, acceptTerms: true, phone: "11 5555-0000" }, { isDemo: true });
    if ("role" in u) await db`update users set platform_role = ${u.role} where id = ${ids[u.key]}`;
  }
  const A: Record<string, Actor> = {};
  const refresh = async () => {
    for (const k of Object.keys(ids)) A[k] = (await systemTx((tx) => loadActor(tx, ids[k])))!;
  };
  await refresh();

  const zone = async (code: string) => (await db<{ id: string }[]>`select id from zones where code = ${code}`)[0].id;
  const cat = async (slug: string) => (await db<{ id: string }[]>`select id from categories where slug = ${slug}`)[0].id;
  const cred = async (code: string) => (await db<{ id: string }[]>`select id from credential_types where code = ${code}`)[0].id;
  const service = async (slug: string) => (await db<{ id: string }[]>`select id from services where slug = ${slug}`)[0].id;

  // ── Organización y propiedades ──
  log("· Clientes, organización y propiedades");
  const orgId = await props.createOrganization(A.carla, { name: "Estudio Contable Delta (demo)", taxId: "30-00000000-0", billingEmail: "administracion@" + DEMO_DOMAIN, billingAddress: "Av. Ficticia 123, CABA", contactPhone: "11 5555-0001" });
  await db`update organizations set is_demo = true where id = ${orgId}`;
  await props.addOrganizationMember(A.carla, orgId, demoEmail("diego"), "member");
  await refresh();
  const sedeCentro = await props.createProperty(A.carla, { kind: "site", label: "Sede Centro", addressLine: "Calle Demo 1000, piso 4", zoneId: await zone("caba-centro"), contactName: "Recepción", contactPhone: "11 5555-0002", accessNotes: "Ingresar por recepción con DNI." }, orgId);
  const sedePalermo = await props.createProperty(A.carla, { kind: "site", label: "Sede Palermo", addressLine: "Calle Ejemplo 2500", zoneId: await zone("caba-palermo"), contactName: "Diego Paz", accessNotes: "Timbre 2B." }, orgId);
  const anaCasa = await props.createProperty(A.ana, { kind: "home", label: "Casa", addressLine: "Calle Imaginaria 742", zoneId: await zone("caba-palermo"), contactName: "Ana", accessNotes: "Portero eléctrico, 3° A. Hay un perro tranquilo." });
  const anaDepto = await props.createProperty(A.ana, { kind: "home", label: "Departamento de mamá", addressLine: "Av. Inventada 3300, 7° C", zoneId: await zone("caba-belgrano"), contactName: "Marta (mamá de Ana)" });
  const brunoCasa = await props.createProperty(A.bruno, { kind: "home", label: "Casa", addressLine: "Pasaje Ficticio 45", zoneId: await zone("gba-quilmes") });

  // ── Proveedores ──
  log("· Proveedores (alta, documentación, cobros y revisión)");
  const onboard = async (
    key: string,
    profile: Parameters<typeof providers.createProvider>[1],
    coverage: { cats: string[]; zones: string[]; base: string; slots: { weekday: number; startMinute: number; endMinute: number }[] },
    docs: { identity?: boolean; creds?: string[] } = {},
    opts: { portfolio?: string[]; payouts?: boolean; submit?: boolean } = {},
  ) => {
    const pid = await providers.createProvider(A[key], profile);
    await db`update providers set is_demo = true where id = ${pid}`;
    await refresh();
    await providers.updateCoverage(A[key], pid, {
      categoryIds: await Promise.all(coverage.cats.map(cat)),
      zoneIds: await Promise.all(coverage.zones.map(zone)),
      baseZoneId: await zone(coverage.base),
      acceptingJobs: true,
      maxActiveJobs: 5,
      availability: coverage.slots,
    });
    for (const [i, f] of (opts.portfolio ?? []).entries()) await providers.addPortfolioItem(A[key], pid, asset(f), ["Trabajo terminado (imagen de demostración)", "Antes y después (imagen de demostración)"][i % 2]);
    if (docs.identity) await providers.uploadProviderDocument(A[key], pid, { kind: "identity" }, asset("documento-demo.pdf"));
    for (const c of docs.creds ?? []) await providers.uploadProviderDocument(A[key], pid, { kind: "credential", credentialTypeId: await cred(c), expiresOn: "2027-12-31" }, asset("documento-demo.pdf"));
    if (opts.payouts) await providers.setupPayouts(A[key], pid);
    await providers.acceptProviderTerms(A[key]);
    if (opts.submit) await providers.submitForReview(A[key], pid);
    return pid;
  };
  const approveAll = async (pid: string) => {
    const docs = await db<{ id: string }[]>`select id from provider_documents where provider_id = ${pid}`;
    for (const d of docs) await providers.reviewDocument(A.operador, d.id, "approved", "Documento legible y vigente (demo).");
    await providers.reviewProvider(A.operador, pid, "approve", "Perfil completo y documentación verificada (demo).");
  };

  const martin = await onboard(
    "martin",
    { kind: "individual", displayName: "Electricidad Martín (demo)", responsibleName: "Martín López", contactEmail: demoEmail("martin"), contactPhone: "11 5555-0101", description: "Electricista con experiencia en instalaciones domiciliarias, tableros y luminarias. Trabajo prolijo y con presupuesto claro. Perfil ficticio de demostración.", yearsExperience: 12, taxId: "20-00000000-1", billingInfo: "Monotributo (demo)" },
    { cats: ["electricidad", "mantenimiento"], zones: ["caba-palermo", "caba-belgrano", "caba-recoleta", "caba-urquiza", "gba-vicente-lopez"], base: "caba-palermo", slots: fullWeek(8, 18) },
    { identity: true, creds: ["matricula_electricista"] },
    { portfolio: ["demo-1.jpg", "demo-2.jpg"], payouts: true, submit: true },
  );
  await approveAll(martin);

  const lucia = await onboard(
    "lucia",
    { kind: "individual", displayName: "Plomería Sosa (demo)", responsibleName: "Lucía Sosa", contactEmail: demoEmail("lucia"), contactPhone: "11 5555-0102", description: "Plomera matriculada: pérdidas, griferías, inodoros y destapaciones. Recién me sumo a la plataforma. Perfil ficticio de demostración.", yearsExperience: 6 },
    { cats: ["plomeria"], zones: ["caba-palermo", "caba-caballito", "caba-centro", "caba-belgrano"], base: "caba-caballito", slots: [...fullWeek(9, 17), ...fullWeek(9, 13, [6])] },
    { identity: true },
    { portfolio: ["demo-3.jpg"], payouts: true, submit: true },
  );
  await approveAll(lucia);

  const sin = await onboard(
    "roberto",
    { kind: "company", displayName: "Servicios Integrales Norte S.R.L. (demo)", legalName: "Servicios Integrales Norte S.R.L. (ficticia)", responsibleName: "Roberto Díaz", contactEmail: demoEmail("roberto"), contactPhone: "11 5555-0103", description: "Empresa de mantenimiento para hogares y oficinas: plomería, gas, climatización y arreglos generales, con equipo de técnicos propios. Empresa ficticia de demostración.", yearsExperience: 15, taxId: "30-00000000-2", billingInfo: "Responsable inscripto (demo)" },
    { cats: ["plomeria", "gas", "mantenimiento", "climatizacion", "electrodomesticos"], zones: ["caba-centro", "caba-recoleta", "caba-palermo", "gba-vicente-lopez", "gba-san-isidro"], base: "caba-recoleta", slots: [...fullWeek(8, 19), ...fullWeek(9, 14, [6])] },
    { identity: true, creds: ["matricula_gasista", "seguro_ap"] },
    { portfolio: ["demo-4.jpg", "demo-5.jpg", "demo-6.jpg"], payouts: true, submit: true },
  );
  await approveAll(sin);
  await refresh();
  await providers.addProviderMember(A.roberto, sin, demoEmail("jorge"), "technician");
  await providers.addProviderMember(A.roberto, sin, demoEmail("valeria"), "technician");

  // En revisión, con credencial de gas pendiente
  await onboard(
    "pablo",
    { kind: "individual", displayName: "Gas Seguro Romero (demo)", responsibleName: "Pablo Romero", contactEmail: demoEmail("pablo"), contactPhone: "11 5555-0104", description: "Gasista para calefones, termotanques, estufas y cocinas. Perfil ficticio de demostración en revisión.", yearsExperience: 9 },
    { cats: ["gas"], zones: ["caba-caballito", "caba-flores", "gba-moron"], base: "caba-flores", slots: fullWeek(8, 16) },
    { identity: true, creds: ["matricula_gasista"] },
    { payouts: true, submit: true },
  );
  // Alta incompleta (no enviada)
  const sofiaPid = await providers.createProvider(A.sofia, { kind: "individual", displayName: "Clima Total (demo)", responsibleName: "Sofía Herrera", contactEmail: demoEmail("sofia"), contactPhone: "11 5555-0105", description: "Instalación y mantenimiento de equipos de aire acondicionado. Perfil ficticio de demostración (alta incompleta)." });
  await db`update providers set is_demo = true where id = ${sofiaPid}`;
  // Suspendido
  const hernan = await onboard(
    "hernan",
    { kind: "individual", displayName: "Cerrajería del Barrio (demo)", responsibleName: "Hernán Castro", contactEmail: demoEmail("hernan"), contactPhone: "11 5555-0106", description: "Cerrajería de urgencias y cambios de combinación. Perfil ficticio de demostración (suspendido).", yearsExperience: 4 },
    { cats: ["cerrajeria"], zones: ["caba-palermo", "caba-belgrano"], base: "caba-palermo", slots: fullWeek(8, 20, [0, 1, 2, 3, 4, 5, 6]) },
    { identity: true },
    { payouts: true, submit: true },
  );
  await approveAll(hernan);
  await providers.reviewProvider(A.operador, hernan, "suspend", "Suspensión preventiva por reclamos reiterados (caso de demostración).");
  await refresh();

  // ── Helpers de flujo ──
  const pay = async (jobId: string, kind?: string) => {
    const [c] = await db<{ external_reference: string }[]>`
      select external_reference from charges where job_id = ${jobId} and status = 'pending' ${kind ? db`and kind = ${kind}` : db``} order by created_at desc limit 1`;
    const paymentId = await systemTx((tx) => mockCompleteCheckout(tx, c.external_reference, "approved"));
    const { rawBody, headers } = buildMockWebhook(paymentId);
    await processPaymentWebhook("mock", rawBody, headers);
  };
  const invitationFor = async (requestId: string, providerId: string) =>
    (await db<{ id: string }[]>`select id from request_invitations where request_id = ${requestId} and provider_id = ${providerId}`)[0].id;
  const quoteFrom = async (actor: Actor, requestId: string, providerId: string, items: { kind: "labor" | "materials" | "visit"; description: string; quantity: number; unitPriceMinor: number }[], extra: Partial<quotes.QuoteInput> = {}) => {
    await requests.markInvitationViewed(actor, await invitationFor(requestId, providerId));
    return quotes.createQuote(actor, {
      invitationId: await invitationFor(requestId, providerId),
      mode: "quote",
      scope: "Revisión del problema y reparación descripta en los conceptos. Prueba de funcionamiento al finalizar.",
      exclusions: "No incluye trabajos de albañilería ni materiales no detallados.",
      materialsIncluded: items.some((i) => i.kind === "materials"),
      proposedDate: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10),
      proposedWindow: "Mañana (8 a 12 h)",
      validDays: 7,
      items,
      ...extra,
    });
  };
  const hire = async (client: Actor, quoteId: string) => {
    const [q] = await db<{ total_minor: number }[]>`select total_minor from quotes where id = ${quoteId}`;
    const r = await quotes.acceptQuote(client, quoteId, { totalMinor: q.total_minor, acceptedTerms: true });
    await pay(r.jobId);
    return r.jobId;
  };

  // A. Trabajo completado, liquidado y calificado (Ana + Martín)
  log("· Escenario: trabajo completado, liquidado y calificado");
  const reqA = await requests.createRequest(A.ana, {
    propertyId: anaCasa, categoryId: await cat("electricidad"), title: "Salta la térmica cuando prendo el horno",
    description: "Cada vez que prendo el horno eléctrico se corta la luz de la cocina. Pasa desde hace una semana.",
    answers: { afecta_toda_casa: "Un ambiente o sector", salta_termica: "Sí" }, urgency: "soon", preferredWindows: ["morning", "afternoon"], accessInfo: "Portero eléctrico 3° A.",
  }, [asset("demo-2.jpg")]);
  const qA = await quoteFrom(A.martin, reqA, martin, [
    { kind: "visit", description: "Visita y diagnóstico", quantity: 1, unitPriceMinor: 1_500_000 },
    { kind: "labor", description: "Revisión del circuito y reemplazo de térmica", quantity: 1, unitPriceMinor: 4_500_000 },
    { kind: "materials", description: "Térmica bipolar 20A", quantity: 1, unitPriceMinor: 1_800_000 },
  ]);
  const jobA = await hire(A.ana, qA);
  await jobs.confirmJob(A.martin, jobA);
  await jobs.markOnTheWay(A.martin, jobA);
  await jobs.startJob(A.martin, jobA);
  await jobs.addEvidence(A.martin, jobA, { kind: "before", note: "Térmica original con signos de recalentamiento." }, asset("demo-1.jpg"));
  await jobs.addEvidence(A.martin, jobA, { kind: "after", note: "Térmica nueva instalada y circuito probado con el horno encendido." }, asset("demo-2.jpg"));
  await jobs.finishJob(A.martin, jobA, "Trabajo terminado y probado.");
  await jobs.approveJob(A.ana, jobA);
  await disputes.createReview(A.ana, jobA, { rating: 5, comment: "Muy claro con el presupuesto y prolijo. Explicó todo lo que hizo. (Reseña de demostración)" });
  await db`update reviews set is_demo = true, visible_at = now() - interval '1 day', publish_notified = true where job_id = ${jobA}`;
  const [payoutA] = await db<{ id: string }[]>`select id from payouts where job_id = ${jobA}`;
  await executePayout(A.admin, payoutA.id, "Liquidación semanal simulada (demo)");

  // B. Solicitud con presupuestos comparables (Ana, plomería)
  log("· Escenario: presupuestos comparables");
  const reqB = await requests.createRequest(A.ana, {
    propertyId: anaCasa, categoryId: await cat("plomeria"), title: "Pierde agua la canilla de la cocina",
    description: "La canilla monocomando de la cocina gotea constantemente aunque esté cerrada. Quisiera repararla o cambiarla.",
    answers: { hay_perdida_activa: "Gotea", pudo_cerrar_llave: "Sí" }, urgency: "normal", preferredWindows: ["morning"], accessInfo: "Portero eléctrico 3° A.",
  }, [asset("demo-3.jpg")]);
  await quoteFrom(A.lucia, reqB, lucia, [
    { kind: "labor", description: "Cambio de cartucho de monocomando", quantity: 1, unitPriceMinor: 2_800_000 },
    { kind: "materials", description: "Cartucho cerámico 35 mm", quantity: 1, unitPriceMinor: 1_200_000 },
  ], { validDays: 5 });
  await quoteFrom(A.roberto, reqB, sin, [
    { kind: "visit", description: "Visita técnica", quantity: 1, unitPriceMinor: 1_000_000 },
    { kind: "labor", description: "Reemplazo completo de grifería monocomando", quantity: 1, unitPriceMinor: 3_500_000 },
  ], { materialsIncluded: false, exclusions: "No incluye la grifería nueva: el cliente la provee o se cotiza aparte.", proposedWindow: "Tarde (12 a 17 h)" });

  // C. Organización: trabajo en curso con adicional pendiente de aprobación (técnico asignado)
  log("· Escenario: organización con trabajo en curso y adicional");
  const reqC = await requests.createRequest(A.carla, {
    propertyId: sedeCentro, categoryId: await cat("mantenimiento"), title: "Mantenimiento de oficina: puertas y luminarias",
    description: "Necesitamos ajustar tres puertas que rozan y revisar dos luminarias que parpadean en la sede.",
    answers: { lista: "Ajustar 3 puertas; revisar 2 luminarias" }, urgency: "normal", preferredWindows: ["morning", "afternoon"], accessInfo: "Ingresar por recepción con DNI.",
    responsibleUserId: ids.diego,
  });
  const qC = await quoteFrom(A.roberto, reqC, sin, [
    { kind: "labor", description: "Ajuste de bisagras y cerraderos (3 puertas)", quantity: 3, unitPriceMinor: 1_200_000 },
    { kind: "labor", description: "Revisión de luminarias", quantity: 2, unitPriceMinor: 900_000 },
  ]);
  const jobC = await hire(A.carla, qC);
  await jobs.confirmJob(A.roberto, jobC);
  await jobs.assignTechnician(A.roberto, jobC, ids.jorge);
  await refresh();
  await jobs.startJob(A.jorge, jobC);
  await jobs.addEvidence(A.jorge, jobC, { kind: "progress", note: "Puertas ajustadas. Una luminaria tiene el balasto quemado." }, asset("demo-4.jpg"));
  await jobs.proposeExtra(A.roberto, jobC, { description: "Reemplazo de balasto electrónico en luminaria de sala de reuniones", reason: "El balasto está quemado y es la causa del parpadeo.", laborMinor: 1_500_000, materialsMinor: 2_200_000 });

  // D. Organización: visita de diagnóstico pendiente de conformidad (miembro de la organización)
  log("· Escenario: diagnóstico pendiente de conformidad");
  const reqD = await requests.createRequest(A.diego, {
    propertyId: sedePalermo, categoryId: await cat("climatizacion"), serviceId: await service("diagnostico-aire"), title: "El aire de la sala no enfría",
    description: "El split de la sala de reuniones prende pero no enfría. Necesitamos un diagnóstico.",
    answers: { tipo_equipo: "Split", frigorias: "3000" }, urgency: "soon", preferredWindows: ["afternoon"],
  });
  const qD = await quotes.createQuote(A.roberto, {
    invitationId: await invitationFor(reqD, sin), mode: "diagnostic",
    scope: "Visita de diagnóstico del equipo split: revisión eléctrica, de presión y de drenaje. Entrega de presupuesto de reparación.",
    exclusions: "La reparación se cotiza como adicional después de la visita.", materialsIncluded: false,
    proposedDate: new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10), proposedWindow: "Tarde (12 a 17 h)", validDays: 5,
    items: [{ kind: "visit", description: "Visita de diagnóstico de aire acondicionado", quantity: 1, unitPriceMinor: 2_000_000 }],
  });
  const jobD = await hire(A.diego, qD);
  await jobs.confirmJob(A.roberto, jobD);
  await jobs.assignTechnician(A.roberto, jobD, ids.valeria);
  await refresh();
  await jobs.markOnTheWay(A.valeria, jobD);
  await jobs.startJob(A.valeria, jobD);
  await jobs.addEvidence(A.valeria, jobD, { kind: "after", note: "Diagnóstico: falta de gas refrigerante por microfisura en la unidad exterior. Se recomienda reparación y carga." }, asset("demo-5.jpg"));
  await jobs.finishJob(A.valeria, jobD, "Diagnóstico entregado.");

  // E. Organización: trabajo completado con liquidación pendiente
  log("· Escenario: completado con liquidación pendiente");
  const reqE = await requests.createRequest(A.carla, {
    propertyId: sedeCentro, categoryId: await cat("plomeria"), title: "Inodoro del baño de planta pierde agua",
    description: "La mochila del inodoro carga agua permanentemente y se escucha el ruido todo el día.",
    answers: { hay_perdida_activa: "Sí, constante" }, urgency: "soon", preferredWindows: ["morning"],
  });
  const qE = await quoteFrom(A.roberto, reqE, sin, [
    { kind: "labor", description: "Cambio de mecanismo de mochila", quantity: 1, unitPriceMinor: 2_600_000 },
    { kind: "materials", description: "Mecanismo de descarga universal", quantity: 1, unitPriceMinor: 1_400_000 },
  ]);
  const jobE = await hire(A.carla, qE);
  await jobs.confirmJob(A.roberto, jobE);
  await jobs.startJob(A.roberto, jobE);
  await jobs.finishJob(A.roberto, jobE, "Mecanismo reemplazado.");
  await jobs.approveJob(A.carla, jobE);
  await disputes.createReview(A.carla, jobE, { rating: 4, comment: "Resolvieron rápido. Avisaron con tiempo el horario. (Reseña de demostración)" });
  await db`update reviews set is_demo = true, visible_at = now() - interval '1 day', publish_notified = true where job_id = ${jobE}`;

  // F. Reclamo abierto (Ana, departamento, Martín)
  log("· Escenario: reclamo abierto");
  const reqF = await requests.createRequest(A.ana, {
    propertyId: anaDepto, categoryId: await cat("electricidad"), serviceId: await service("instalacion-luminaria"), title: "Instalar una lámpara de techo en el living",
    description: "Tengo la lámpara comprada y el punto de luz ya existe. Necesito que la instalen.",
    answers: { afecta_toda_casa: "Un solo enchufe o luz" }, urgency: "flexible", preferredWindows: [],
  });
  const qF = await quoteFrom(A.martin, reqF, martin, [{ kind: "labor", description: "Instalación de luminaria (precio cerrado)", quantity: 1, unitPriceMinor: 2_800_000 }], {
    mode: "fixed", scope: "Instalación de una luminaria en un punto existente, con prueba de funcionamiento.", exclusions: "No incluye la luminaria ni tendido de cables nuevos.",
  });
  const jobF = await hire(A.ana, qF);
  await jobs.confirmJob(A.martin, jobF);
  await jobs.startJob(A.martin, jobF);
  await jobs.finishJob(A.martin, jobF, "Lámpara instalada.");
  await disputes.openDispute(A.ana, jobF, { reasonCode: "quality", description: "La lámpara quedó torcida y una de las lamparitas no enciende. Le escribí al profesional pero todavía no respondió." }, asset("demo-6.jpg"));

  // G. Sin cobertura (Bruno, GBA Sur, carpintería)
  log("· Escenario: sin cobertura");
  await requests.createRequest(A.bruno, {
    propertyId: brunoCasa, categoryId: await cat("carpinteria"), title: "Arreglar puerta de placard que se salió",
    description: "Una de las puertas corredizas del placard se salió del riel y no la puedo volver a poner.",
    answers: { tipo_trabajo: "Reparar" }, urgency: "normal", preferredWindows: ["weekend"],
  });

  // H. Pedido fuera de catálogo para revisión humana
  log("· Escenario: revisión operativa");
  await requests.createRequest(A.ana, {
    propertyId: anaCasa, categoryId: await cat("otro"), title: "No sé a quién llamar: ruido raro en la pared",
    description: "Se escucha un zumbido dentro de la pared del dormitorio por las noches. No sé si es eléctrico, de cañerías o de otra cosa.",
    answers: {}, urgency: "normal", preferredWindows: [],
  });

  log("✔ Datos de demostración creados.");
}
