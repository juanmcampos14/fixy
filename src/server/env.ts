import { randomBytes } from "node:crypto";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  FILE_SIGNING_SECRET: z.string().min(32),
  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  SUPABASE_URL: z.string().optional().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  SUPABASE_STORAGE_BUCKET: z.string().default("fixy-private"),
  STORAGE_DIR: z.string().default("./.data/storage"),
  PAYMENTS_GATEWAY: z.enum(["mock", "mercadopago"]).default("mock"),
  MOCK_WEBHOOK_SECRET: z.string().min(16),
  MERCADOPAGO_ACCESS_TOKEN: z.string().optional().default(""),
  MERCADOPAGO_TEST_ACCESS_TOKEN: z.string().optional().default(""),
  // "test": cobros con credenciales de prueba (sin dinero real). "live": cobros reales.
  MERCADOPAGO_MODE: z.enum(["test", "live"]).default("test"),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional().default(""),
  EMAIL_ADAPTER: z.enum(["console", "resend"]).default("console"),
  RESEND_API_KEY: z.string().optional().default(""),
  EMAIL_FROM: z.string().default("Fixy <no-responder@fixy.solutions>"),
  ASSISTANT_PROVIDER: z.enum(["rules", "claude"]).default("rules"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ASSISTANT_MODEL: z.string().default("claude-opus-5-5"),
  ASSISTANT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  DEMO_MODE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  CRON_SECRET: z.string().min(16).default("change-me-cron-secret-000000000000"),
  // WhatsApp Cloud API (Meta). Sin token/ID, los mensajes salientes se registran sin enviarse (modo simulado).
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  // Cuenta de WhatsApp Business (WABA): para crear y consultar plantillas.
  WHATSAPP_WABA_ID: z.string().optional().default(""),
  WHATSAPP_APP_SECRET: z.string().optional().default(""),
  WHATSAPP_VERIFY_TOKEN: z.string().optional().default(""),
  WHATSAPP_API_VERSION: z.string().default("v23.0"),
  WHATSAPP_DISPLAY_NUMBER: z.string().optional().default(""),
  // Captación por WhatsApp automático: número comercial (distinto del bot) en la API oficial de Meta. El token es el del
  // usuario del sistema con acceso a esa cuenta (si se deja vacío, se usa WHATSAPP_ACCESS_TOKEN).
  SUPPLY_WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  SUPPLY_WHATSAPP_WABA_ID: z.string().optional().default(""),
  SUPPLY_WHATSAPP_TOKEN: z.string().optional().default(""),
  // Kommo (bandeja de las respuestas de captación): integración privada con token de larga duración.
  KOMMO_TOKEN: z.string().optional().default(""),
  KOMMO_SUBDOMINIO: z.string().optional().default(""),
  // Ingreso con Google (OAuth). Sin estas variables el botón no aparece.
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  // Clave de Google para geocodificar en el servidor (la del navegador está restringida al sitio).
  GOOGLE_MAPS_SERVER_KEY: z.string().optional().default(""),
  // Avisos push de las apps. Android: JSON de la cuenta de servicio de Firebase (tal cual o en base64).
  FIREBASE_SERVICE_ACCOUNT: z.string().optional().default(""),
  // Planilla de captación (CRM de research) que se sincroniza a diario. Se lee con la cuenta de servicio de arriba
  // (compartir la planilla con su client_email como lector) o, si está publicada "con el link", sin credenciales.
  SUPPLY_SHEET_ID: z.string().optional().default("1p5lG431qB6VlBkiaC_modI9b8SWMoMxRAJCjrFamdCg"),
  SUPPLY_SHEET_TAB: z.string().optional().default("PROVEEDORES"),
  // iOS: clave .p8 de APNs (tal cual o en base64), su identificador y el del equipo de Apple.
  APNS_KEY: z.string().optional().default(""),
  APNS_KEY_ID: z.string().optional().default(""),
  APNS_TEAM_ID: z.string().optional().default(""),
  // Clave para cifrar los secretos del segundo factor del equipo (32+ caracteres aleatorios). Sin ella, en producción
  // el segundo factor no se puede activar y el panel lo avisa.
  MFA_ENCRYPTION_KEY: z.string().optional().default(""),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // No imprimimos valores: solo qué variables faltan o son inválidas.
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuración inválida. Revisá estas variables de entorno: ${fields}`);
  }
  cached = parsed.data;
  // Claves de ejemplo en producción (auditoría M-06): una copia de .env.example dejaría firmas predecibles.
  // Se reemplazan por una clave aleatoria de este proceso (falla cerrado: el cron no corre, los enlaces de archivos
  // firmados por otra instancia dejan de valer, los webhooks simulados no se aceptan) y se avisa en los registros.
  if (cached.NODE_ENV === "production") {
    for (const key of ["CRON_SECRET", "FILE_SIGNING_SECRET", "MOCK_WEBHOOK_SECRET"] as const) {
      if (isPlaceholderSecret(cached[key])) {
        console.error(`[env] ${key} tiene un valor de ejemplo en producción: se ignora. Cargá una clave propia.`);
        cached[key] = randomBytes(32).toString("hex");
      }
    }
    // Esta clave no se puede reemplazar por una aleatoria (dejaría ilegibles los secretos guardados): se ignora.
    if (cached.MFA_ENCRYPTION_KEY && (cached.MFA_ENCRYPTION_KEY.length < 32 || isPlaceholderSecret(cached.MFA_ENCRYPTION_KEY))) {
      console.error("[env] MFA_ENCRYPTION_KEY es corta o de ejemplo: el segundo factor queda deshabilitado hasta cargar una clave propia.");
      cached.MFA_ENCRYPTION_KEY = "";
    }
  }
  return cached;
}

/** Valores de ejemplo de .env.example (o claves triviales) que nunca deben usarse en producción. */
export function isPlaceholderSecret(v: string): boolean {
  return /change-?me|example|placeholder|^(.)\1+$/i.test(v) || new Set(v).size < 8;
}

/** El selector de cuentas demo nunca se habilita en producción, aunque DEMO_MODE=true. */
export function demoLoginEnabled(): boolean {
  const e = env();
  return e.DEMO_MODE === true && e.NODE_ENV !== "production";
}

export function paymentsAreTestMode(): boolean {
  return env().PAYMENTS_GATEWAY === "mock" || env().MERCADOPAGO_MODE !== "live";
}
