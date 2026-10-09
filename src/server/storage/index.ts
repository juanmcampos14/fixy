import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Db } from "@/server/db/client";
import { env } from "@/server/env";
import { invalid } from "@/server/domain/errors";

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export type FilePurpose =
  | "provider_document"
  | "portfolio"
  | "request_photo"
  | "job_evidence"
  | "message_attachment"
  | "dispute_evidence"
  | "property_document"
  | "provider_avatar";
export type FileOwnerType = "provider" | "request" | "job" | "conversation" | "dispute" | "property";

/** Verifica el tipo real por "magic bytes" (no confiamos en la extensión ni en el MIME del navegador). */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}

/** Adaptador de almacenamiento privado. Local en desarrollo; en producción, Supabase Storage (bucket privado). */
interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

const localDriver: StorageDriver = {
  async put(key, data) {
    const base = resolve(env().STORAGE_DIR);
    const path = join(base, key);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, data);
  },
  async get(key) {
    const base = resolve(env().STORAGE_DIR);
    const path = resolve(join(base, key));
    if (!path.startsWith(base)) throw new Error("ruta inválida");
    return readFile(path);
  },
};

/**
 * Supabase Storage (bucket PRIVADO). La service role key solo existe en el servidor.
 * Los archivos se sirven siempre a través de /api/files/[id] (URL firmada propia), nunca con URLs públicas del bucket.
 */
let supabaseDriverCache: StorageDriver | null = null;
async function supabaseDriver(): Promise<StorageDriver> {
  if (supabaseDriverCache) return supabaseDriverCache;
  const e = env();
  if (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY para STORAGE_DRIVER=supabase");
  const { createClient } = await import("@supabase/supabase-js");
  const bucket = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from(e.SUPABASE_STORAGE_BUCKET);
  supabaseDriverCache = {
    async put(key, data) {
      const { error } = await bucket.upload(key, data, { upsert: false, contentType: "application/octet-stream" });
      if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);
    },
    async get(key) {
      const { data, error } = await bucket.download(key);
      if (error || !data) throw new Error("Archivo no disponible");
      return Buffer.from(await data.arrayBuffer());
    },
  };
  return supabaseDriverCache;
}

const driver = async (): Promise<StorageDriver> => (env().STORAGE_DRIVER === "supabase" ? supabaseDriver() : localDriver);

export async function storeFile(
  db: Db,
  input: {
    data: Buffer;
    originalName: string;
    uploadedBy: string | null;
    purpose: FilePurpose;
    ownerType: FileOwnerType | null;
    ownerId: string | null;
    visibility?: "private" | "public";
    allowPdf?: boolean;
  },
): Promise<string> {
  if (input.data.length === 0) throw invalid("El archivo está vacío.");
  if (input.data.length > MAX_FILE_BYTES) throw invalid("El archivo supera el máximo de 8 MB.");
  const mime = sniffMime(input.data);
  if (!mime || (mime === "application/pdf" && input.allowPdf === false)) {
    throw invalid("Formato no admitido. Usá JPG, PNG, WEBP" + (input.allowPdf === false ? "." : " o PDF."));
  }
  const id = randomUUID();
  const key = `${input.purpose}/${id}.${ALLOWED_MIME[mime]}`;
  await (await driver()).put(key, input.data);
  const sha = createHash("sha256").update(input.data).digest("hex");
  const safeName = input.originalName.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "archivo";
  await db`insert into files (id, uploaded_by, visibility, purpose, storage_key, original_name, mime_type, size_bytes, sha256, owner_type, owner_id)
    values (${id}, ${input.uploadedBy}, ${input.visibility ?? "private"}, ${input.purpose}, ${key}, ${safeName}, ${mime},
            ${input.data.length}, ${sha}, ${input.ownerType}, ${input.ownerId})`;
  return id;
}

export async function readStoredFile(storageKey: string) {
  return (await driver()).get(storageKey);
}

// ───────── URLs temporales firmadas ─────────
const sign = (payload: string) => createHmac("sha256", env().FILE_SIGNING_SECRET).update(payload).digest("base64url");

/** Generar solo después de verificar acceso (la lectura del archivo bajo RLS lo garantiza). */
export function signedFileUrl(fileId: string, ttlSeconds = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/files/${fileId}?exp=${exp}&sig=${sign(`${fileId}.${exp}`)}`;
}

export function verifyFileSignature(fileId: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(sign(`${fileId}.${exp}`));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** URL pública estable para archivos públicos (portfolio). */
export function publicFileUrl(fileId: string) {
  return `/api/files/${fileId}`;
}
