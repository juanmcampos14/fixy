import { sql } from "@/server/db/client";
import { readStoredFile, verifyFileSignature } from "@/server/storage";

/**
 * Descarga de archivos. Privados: requieren URL firmada y vigente (se emite solo tras verificar acceso con RLS).
 * Públicos (portfolio): accesibles sin firma.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("No encontrado", { status: 404 });
  const url = new URL(req.url);
  const [f] = await sql()<{ storage_key: string; mime_type: string; visibility: string; original_name: string }[]>`
    select storage_key, mime_type, visibility, original_name from files where id = ${id}`;
  if (!f) return new Response("No encontrado", { status: 404 });
  if (f.visibility !== "public" && !verifyFileSignature(id, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
    return new Response("Enlace vencido o inválido", { status: 403 });
  }
  const data = await readStoredFile(f.storage_key);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": f.mime_type,
      "content-disposition": `${f.mime_type === "application/pdf" ? "attachment" : "inline"}; filename="${encodeURIComponent(f.original_name)}"`,
      "cache-control": f.visibility === "public" ? "public, max-age=86400" : "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
