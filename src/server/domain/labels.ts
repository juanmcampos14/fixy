// Etiquetas en español para estados (usadas por la interfaz y notificaciones).
export const requestStatusLabel: Record<string, string> = {
  draft: "Borrador",
  submitted: "Enviada · en revisión",
  searching: "Buscando profesionales",
  with_quotes: "Con presupuestos",
  converted: "Contratada",
  cancelled: "Cancelada",
  no_coverage: "Buscando a mano",
};
export const quoteStatusLabel: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviado",
  accepted: "Aceptado",
  rejected: "Rechazado",
  expired: "Vencido",
  withdrawn: "Retirado",
};
export const jobStatusLabel: Record<string, string> = {
  pending_confirmation: "Pendiente de confirmación",
  confirmed: "Confirmado",
  on_the_way: "En camino",
  in_progress: "En ejecución",
  pending_approval: "Pendiente de tu conformidad",
  completed: "Completado",
  cancelled: "Cancelado",
};
export const jobStatusLabelProvider: Record<string, string> = {
  ...jobStatusLabel,
  pending_approval: "Esperando conformidad del cliente",
};
export const chargeStatusLabel: Record<string, string> = {
  pending: "Pendiente",
  processing: "Procesando",
  approved: "Aprobado",
  failed: "Fallido",
  partially_refunded: "Reembolsado parcialmente",
  refunded: "Reembolsado",
};
export const payoutStatusLabel: Record<string, string> = {
  pending: "Pendiente",
  scheduled: "Programada",
  processing: "Procesando",
  paid: "Liquidada",
  failed: "Fallida",
  reversed: "Revertida",
};
export const disputeStatusLabel: Record<string, string> = {
  open: "Abierto",
  in_review: "En revisión",
  awaiting_response: "Esperando respuesta",
  resolved: "Resuelto",
  closed: "Cerrado",
};
export const providerStatusLabel: Record<string, string> = {
  pending: "Pendiente de envío",
  in_review: "En revisión",
  approved: "Aprobado",
  rejected: "Rechazado",
  suspended: "Suspendido",
};
export const identityStatusLabel: Record<string, string> = {
  unverified: "Sin verificar",
  pending: "Documentación en revisión",
  verified: "Identidad verificada",
  rejected: "Identidad rechazada",
};
export const payoutsStatusLabel: Record<string, string> = {
  not_started: "Sin configurar",
  pending: "Configuración pendiente",
  enabled: "Habilitado para cobrar",
  disabled: "Cobros deshabilitados",
};
export const chargeKindLabel: Record<string, string> = {
  visit: "Visita de diagnóstico",
  job_total: "Trabajo",
  deposit: "Anticipo",
  balance: "Saldo",
  extra: "Adicional",
};
export const modeLabel: Record<string, string> = {
  fixed: "Precio cerrado",
  quote: "Presupuesto personalizado",
  diagnostic: "Visita de diagnóstico",
};
export const urgencyLabel: Record<string, string> = {
  flexible: "Sin apuro",
  normal: "En los próximos días",
  soon: "Lo antes posible",
  urgent: "Urgente",
};
export const disputeReasonLabel: Record<string, string> = {
  incomplete: "El trabajo quedó incompleto",
  quality: "Problemas de calidad",
  damage: "Daños durante el trabajo",
  no_show: "El profesional no se presentó",
  price: "Diferencias de precio",
  behavior: "Trato inadecuado",
  other: "Otro motivo",
};
export const disputeResolutionLabel: Record<string, string> = {
  no_action: "Sin acción adicional",
  partial_refund: "Reembolso parcial",
  full_refund: "Reembolso total",
  redo_work: "El profesional vuelve a realizar el trabajo",
  provider_favor: "Resuelto a favor del profesional",
  other: "Otra resolución",
};
export const propertyKindLabel: Record<string, string> = {
  home: "Hogar",
  office: "Oficina",
  site: "Sede",
  other: "Otro",
};
