/*
 * Crea (o promueve) el primer usuario administrador de la plataforma.
 * Uso: ADMIN_EMAIL=vos@dominio ADMIN_NAME="Tu Nombre" ADMIN_PASSWORD='...' npx tsx scripts/create-admin.ts [operator|admin]
 * La contraseña se lee de una variable de entorno (no queda en el historial si la cargás con `read -s`).
 */
import { loadEnv } from "./load-env";
loadEnv();
(async () => {
  const { sql } = await import("@/server/db/client");
  const { hashPassword } = await import("@/server/auth/password");
  const role = process.argv[2] === "operator" ? "operator" : "admin";
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = (process.env.ADMIN_NAME ?? "Administración Fixy").trim();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email.includes("@")) throw new Error("Definí ADMIN_EMAIL");
  const [existing] = await sql()<{ id: string }[]>`select id from users where lower(email) = ${email}`;
  if (existing) {
    await sql()`update users set platform_role = ${role} where id = ${existing.id}`;
    console.log(`✔ ${email} ahora tiene rol ${role}.`);
  } else {
    if (password.length < 12) throw new Error("ADMIN_PASSWORD debe tener al menos 12 caracteres");
    // Lo da de alta quien opera el servidor con ese email: se toma como confirmado.
    await sql()`insert into users (email, password_hash, full_name, platform_role, email_verified) values (${email}, ${await hashPassword(password)}, ${name}, ${role}, true)`;
    console.log(`✔ Usuario ${role} creado: ${email}`);
  }
  await sql()`insert into audit_log (action, entity_type, entity_id, reason) values ('user.platform_role', 'user', ${email}, 'Alta por script create-admin')`;
  await sql().end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
