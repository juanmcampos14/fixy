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

export function createSql(url: string): Sql {
  // Pooler de Supabase en modo transacción (puerto 6543) no admite prepared statements.
  const transactionPooler = /:6543\b/.test(url) || /pgbouncer=true/.test(url);
  return postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    prepare: !transactionPooler,
    idle_timeout: 20,
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
