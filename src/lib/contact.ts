/** Canales de contacto públicos de Fixy. */
export const SUPPORT_EMAIL = "hola@fixy.solutions";
/** Número del asistente de WhatsApp (formato internacional, sin +). */
export const WHATSAPP_NUMBER = "5491124774110";
export const whatsappUrl = (text = "Hola Fixy, necesito ayuda con un arreglo") =>
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
