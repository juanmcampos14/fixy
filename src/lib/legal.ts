/** Datos legales de la empresa titular de Fixy. Único lugar a editar si cambian. */
export const LEGAL = {
  company: "FLIPS S.R.L.",
  cuit: "30-71915647-5",
  brand: "Fixy",
  site: "www.fixy.solutions",
  /** Domicilio legal (completar). Mientras esté vacío no se muestra. */
  address: "",
  /** Email para consultas legales, privacidad y arrepentimiento (completar). Mientras esté vacío se indica el canal de ayuda del sitio. */
  email: "",
  version: "1.0",
  effectiveDate: "8 de octubre de 2026",
  /** Plazo de transferencia de un retiro (días). Debe coincidir con platform_settings.withdrawals.delay_days. */
  withdrawalDays: 20,
} as const;

export const legalContact = () => (LEGAL.email ? `el correo ${LEGAL.email}` : "los canales de contacto publicados en el sitio");
