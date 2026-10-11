import { describe, expect, it } from "vitest";
import { sql, systemTx } from "@/server/db/client";
import { registerUser } from "@/server/modules/users";
import { notify } from "@/server/notifications";
import { processPushOutbox, pushPlatforms, registerDevice, unregisterDevice } from "@/server/push";

const newUser = (tag: string) => registerUser({ fullName: "Persona Push", email: `push.${tag}.${Date.now()}@test.local`, password: "password-123", acceptTerms: true, phone: "1155550000" });
const pushRows = (userId: string) => sql()<{ status: string; payload: { title: string; link: string | null } }[]>`
  select status, payload from outbox where channel = 'push' and recipient_user_id = ${userId}`;

describe("avisos push", () => {
  it("sin credenciales, ninguna plataforma queda habilitada", () => {
    expect(pushPlatforms()).toEqual({ android: false, ios: false });
  });

  it("solo se encola el aviso para quien tiene un dispositivo activo", async () => {
    const withApp = await newUser("a");
    const without = await newUser("b");
    await registerDevice(withApp, "android", `tok-${withApp}-aaaaaaaaaaaaaaaa`);
    await systemTx((tx) => notify(tx, [withApp, without], { type: "message", title: "Mensaje nuevo", body: "Hola", link: "/app/trabajos/1", email: false }));
    expect(await pushRows(without)).toEqual([]);
    const rows = await pushRows(withApp);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ title: "Mensaje nuevo", link: "/app/trabajos/1" });
  });

  it("un token pasa a la cuenta que inició sesión en ese dispositivo y se borra al cerrar sesión", async () => {
    const first = await newUser("c");
    const second = await newUser("d");
    const token = `tok-shared-${Date.now()}-aaaaaaaa`;
    await registerDevice(first, "ios", token);
    await registerDevice(second, "ios", token);
    const owners = await sql()<{ user_id: string }[]>`select user_id from push_devices where token = ${token}`;
    expect(owners).toEqual([{ user_id: second }]);
    await unregisterDevice(token);
    expect(await sql()`select 1 from push_devices where token = ${token}`).toHaveLength(0);
  });

  it("si la persona ya no tiene dispositivos, el aviso se descarta en vez de reintentarse", async () => {
    const id = await newUser("e");
    const token = `tok-${id}-bbbbbbbbbbbbbbbb`;
    await registerDevice(id, "android", token);
    await systemTx((tx) => notify(tx, [id], { type: "payment", title: "Pago acreditado", email: false }));
    await unregisterDevice(token);
    await processPushOutbox(500);
    expect((await pushRows(id)).map((r) => r.status)).toEqual(["dead"]);
  });
});
