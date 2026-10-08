import { sql } from "@/server/db/client";
import { DomainError } from "@/server/domain/errors";

/** Límite de frecuencia persistente (ventana fija). Sirve con varias instancias del servidor. */
export async function rateLimit(key: string, max: number, windowSeconds: number) {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await sql()<{ hits: number }[]>`
    insert into rate_limits (key, window_start, hits) values (${key}, ${windowStart}, 1)
    on conflict (key, window_start) do update set hits = rate_limits.hits + 1
    returning hits`;
  if (row.hits > max) {
    throw new DomainError("rate_limited", "Demasiados intentos. Esperá unos minutos y volvé a probar.");
  }
}
