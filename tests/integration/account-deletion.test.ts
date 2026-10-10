import { describe, expect, it } from "vitest";
import { sql, systemTx } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { authenticate, registerUser } from "@/server/modules/users";
import { deleteAccount, deletionBlockers } from "@/server/modules/account";
import { createProperty } from "@/server/modules/properties";
import * as requests from "@/server/modules/requests";
import { actor, catId } from "./helpers";

const reload = async (id: string) => (await systemTx((tx) => loadActor(tx, id)))!;

describe("baja de cuenta", () => {
  it("anonimiza la cuenta, borra direcciones y contacto, cancela pedidos abiertos y no deja volver a entrar", async () => {
    const email = `baja.${Date.now()}@test.local`;
    const id = await registerUser({ fullName: "Persona Baja", email, password: "password-123", acceptTerms: true, phone: "1155550000" });
    await sql()`update users set whatsapp_phone = ${`54911${String(Date.now()).slice(-8)}`} where id = ${id}`;
    await sql()`insert into sessions (token_hash, user_id, expires_at) values (${`t-${id}`}, ${id}, now() + interval '1 day')`;
    const me = await reload(id);
    const [zone] = await sql()<{ id: string }[]>`select id from zones where code <> 'otra-zona' order by sort limit 1`;
    const propertyId = await createProperty(me, { kind: "home", label: "Casa", addressLine: "Av. Siempreviva 742", zoneId: zone.id, contactPhone: "1144443333" });
    const reqId = await requests.createRequest(me, {
      propertyId, categoryId: await catId("plomeria"), title: "Pierde la canilla", description: "Gotea la canilla de la cocina todo el día.",
      answers: {}, urgency: "normal", preferredWindows: [], accessInfo: "Timbre 3B, código 1234",
    });

    await expect(deleteAccount(me, "borrar")).rejects.toThrow(/ELIMINAR/);
    expect(await deletionBlockers(sql(), me)).toEqual([]);
    await deleteAccount(me, "eliminar");

    const [u] = await sql()<{ full_name: string; email: string; phone: string | null; whatsapp_phone: string | null; password_hash: string | null; deleted_at: Date | null }[]>`
      select full_name, email, phone, whatsapp_phone, password_hash, deleted_at from users where id = ${id}`;
    expect(u.full_name).toBe("Cuenta eliminada");
    expect(u.email).not.toContain("baja.");
    expect(u.phone).toBeNull();
    expect(u.whatsapp_phone).toBeNull();
    expect(u.password_hash).toBeNull();
    expect(u.deleted_at).not.toBeNull();
    const [p] = await sql()<{ address_line: string; contact_phone: string | null }[]>`select address_line, contact_phone from properties where id = ${propertyId}`;
    expect(p).toEqual({ address_line: "Dirección eliminada", contact_phone: null });
    const [priv] = await sql()<{ access_info: string | null }[]>`select access_info from request_private where request_id = ${reqId}`;
    expect(priv.access_info).toBeNull();
    expect((await sql()<{ status: string }[]>`select status from service_requests where id = ${reqId}`)[0].status).toBe("cancelled");
    expect(await sql()`select 1 from sessions where user_id = ${id}`).toHaveLength(0);
    await expect(authenticate(email, "password-123")).rejects.toThrow();
  });

  it("no deja borrar con un trabajo en curso ni a cuentas del equipo", async () => {
    const [{ client }] = await sql()<{ client: string }[]>`
      select r.created_by as client from jobs j join service_requests r on r.id = j.request_id where j.status not in ('completed','cancelled') limit 1`;
    const busy = await reload(client);
    expect((await deletionBlockers(sql(), busy)).join(" ")).toMatch(/trabajo/);
    await expect(deleteAccount(busy, "ELIMINAR")).rejects.toThrow();
    expect((await deletionBlockers(sql(), await actor("admin"))).join(" ")).toMatch(/equipo de Fixy/);
  });
});
