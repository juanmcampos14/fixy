import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

/** Vercel Cron llama con "Authorization: Bearer $CRON_SECRET". Comparación en tiempo constante. */
export function cronAuthorized(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const expected = env().CRON_SECRET;
  return token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
