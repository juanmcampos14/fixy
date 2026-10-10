/** Datos legales de la empresa titular de Fixy. Único lugar a editar si cambian. */
export const LEGAL = {
  company: "FLIPS S.R.L.",
  cuit: "30-71915647-5",
  brand: "Fixy",
  site: "www.fixy.solutions",
  /** Domicilio legal (el mismo registrado en D&B / D-U-N-S 966002122). */
  address: "Husares 2248, Ciudad Autónoma de Buenos Aires",
  /** Email para consultas legales, privacidad y arrepentimiento. */
  email: "hola@fixy.solutions",
  version: "1.1",
  effectiveDate: "10 de octubre de 2026",
  /** Plazo de transferencia de un retiro (días). Debe coincidir con platform_settings.withdrawals.delay_days. */
  withdrawalDays: 20,
} as const;

export const legalContact = () => (LEGAL.email ? `el correo ${LEGAL.email}` : "los canales de contacto publicados en el sitio");
