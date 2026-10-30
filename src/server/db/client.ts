import postgres from "postgres";
import { env } from "@/server/env";

/** int8 → number, con verificación de entero seguro (los importes son enteros en centavos). */
const bigintAsNumber = {
  to: 20,
  from: [20],
  serialize: (x: number | bigint) => x.toString(),
  parse: (x: string) => {
    const n = Number(x);
    if (!Number.isSafeInteger(n)) throw new Error(`Entero fuera de rango seguro: ${x}`);
    return n;
  },
};

/** date → 'YYYY-MM-DD' (sin conversiones de zona horaria). */
const dateAsString = {
  to: 1082,
  from: [1082],
  serialize: (x: string) => x,
  parse: (x: string) => x,
};

export type Sql = postgres.Sql<{ bigint: number; date: string }>;
export type Tx = postgres.TransactionSql<{ bigint: number; date: string }>;
export type Db = Sql | Tx;

const globalForDb = globalThis as unknown as { __fixySql?: Sql; __fixySqlUrl?: string };

/**
 * Pooler de Supabase (Supavisor): por defecto se usa el modo sesión (puerto 5432 del mismo host). En modo transacción
 * (6543) postgres.js a veces deja consultas colgadas a mitad del protocolo (la base queda "active · ClientRead" y la
 * página no termina de cargar; porsager/postgres#970). DATABASE_POOL_MODE=transaction vuelve al modo anterior.
 */
export function resolveDbUrl(url: string, mode = process.env.DATABASE_POOL_MODE ?? "session") {
  if (mode !== "session" || !/\.pooler\.supabase\.com:6543\b/.test(url)) return url;
  const u = new URL(url);
  u.port = "5432";
  u.searchParams.delete("pgbouncer");
  return u.toString();
}

export function createSql(rawUrl: string): Sql {
  const url = resolveDbUrl(rawUrl);
  // En modo transacción (6543) no hay prepared statements.
  const transactionPooler = /:6543\b/.test(url) || /pgbouncer=true/.test(url);
  return postgres(url, {
    // En modo sesión cada conexión ocupa un lugar del pooler: pocas por instancia y se liberan rápido.
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    prepare: !transactionPooler,
    idle_timeout: 10,
    max_lifetime: 60 * 5,
    connect_timeout: 10,
    onnotice: () => {},
    types: { bigint: bigintAsNumber, date: dateAsString },
  }) as unknown as Sql;
}

export function sql(): Sql {
  const url = env().DATABASE_URL;
  if (!globalForDb.__fixySql || globalForDb.__fixySqlUrl !== url) {
    globalForDb.__fixySql = createSql(url);
    globalForDb.__fixySqlUrl = url;
  }
  return globalForDb.__fixySql;
}

/** Solo para pruebas: reemplaza la conexión global. */
export function __setSqlForTests(s: Sql, url: string) {
  globalForDb.__fixySql = s;
  globalForDb.__fixySqlUrl = url;
}

/**
 * Transacción con privilegios de servidor ("service role").
 * Usar solo dentro de servicios de dominio que ya autorizaron al actor.
 */
export async function systemTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql().begin((tx) => fn(tx as unknown as Tx))) as T;
}

/**
 * Transacción de solo lectura con el rol fixy_app y RLS activo para el usuario indicado.
 * Es la vía por defecto para las lecturas de los paneles.
 */
export async function asUser<T>(userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql().begin("read only", async (tx) => {
    await tx`select set_config('app.user_id', ${userId ?? ""}, true)`;
    await tx`set local role fixy_app`;
    return fn(tx as unknown as Tx);
  })) as T;
}
