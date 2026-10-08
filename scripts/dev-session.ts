/* SOLO DESARROLLO: crea una sesión para una cuenta demo e imprime la cookie (para probar páginas con curl). */
import { loadEnv } from "./load-env";
loadEnv();
import { createHash, randomBytes } from "node:crypto";
(async () => {
  if (process.env.NODE_ENV === "production") throw new Error("No disponible en producción");
  const { sql } = await import("@/server/db/client");
  const key = process.argv[2] ?? "ana";
  const [u] = await sql()<{ id: string }[]>`select id from users where email = ${`${key}@demo.fixy.solutions`} and is_demo`;
  if (!u) throw new Error("Usuario demo inexistente");
  const token = randomBytes(32).toString("base64url");
  await sql()`insert into sessions (token_hash, user_id, expires_at) values (${createHash("sha256").update(token).digest("hex")}, ${u.id}, now() + interval '1 day')`;
  console.log(`fixy_session=${token}`);
  await sql().end();
})();
