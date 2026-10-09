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
  // Clave de Google para geocodificar en el servidor (la del navegador está restringida al sitio).
  GOOGLE_MAPS_SERVER_KEY: z.string().optional().default(""),
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
  return cached;
}

/** El selector de cuentas demo nunca se habilita en producción, aunque DEMO_MODE=true. */
export function demoLoginEnabled(): boolean {
  const e = env();
  return e.DEMO_MODE === true && e.NODE_ENV !== "production";
}

export function paymentsAreTestMode(): boolean {
  return env().PAYMENTS_GATEWAY === "mock";
}
