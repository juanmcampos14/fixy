/**
 * Oculta datos de contacto en mensajes (teléfonos, emails, enlaces de WhatsApp/redes) para que la
 * coordinación y los pagos queden dentro de Fixy. No es infalible: es una barrera y un recordatorio.
 */
const PATTERNS: RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/gi, // email
  /\b(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|t\.me|instagram\.com|facebook\.com|m\.me)\/\S*/gi,
  /(?:\+?54[\s-]?)?(?:9[\s-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4}\b/g, // teléfonos AR (con o sin código)
  /\b(?:\d[\s.-]?){8,}\d\b/g, // cualquier secuencia larga de dígitos (CBU/alias numérico/teléfono)
  /\b(?:alias|cbu|cvu)\s*[:=]?\s*[\w.]{6,}/gi, // datos para transferir por fuera
];

export const CONTACT_MASK = "[dato de contacto oculto]";

export function maskContactInfo(text: string): { text: string; masked: boolean } {
  let out = text;
  for (const p of PATTERNS) out = out.replace(p, CONTACT_MASK);
  return { text: out, masked: out !== text };
}
