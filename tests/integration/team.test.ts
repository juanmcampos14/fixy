import { describe, expect, it } from "vitest";
import { sql, systemTx } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { isStaff } from "@/server/auth/actor";
import { can, levelFor } from "@/server/auth/permissions";
import * as team from "@/server/modules/team";
import { operatorRunMatching } from "@/server/modules/requests";
import { saveCategory } from "@/server/modules/admin";
import { actor } from "./helpers";

const reload = async (id: string) => (await systemTx((tx) => loadActor(tx, id)))!;
const tokenOf = (link: string) => link.split("/").pop()!;

describe("equipo y permisos del panel", () => {
  it("socio: ve todo, no gestiona nada y no actúa como operación", async () => {
    const [admin, diego] = await Promise.all([actor("admin"), actor("diego")]);
    await expect(team.inviteMember(await actor("operador"), { email: diego.email, access: { kind: "socio" } })).rejects.toThrow(/dueño/);
    const inv = await team.inviteMember(admin, { email: diego.email, access: { kind: "socio" } });
    await expect(team.acceptInvitation(await actor("carla"), tokenOf(inv.link))).rejects.toThrow(/es para/);
    await team.acceptInvitation(diego, tokenOf(inv.link));
    await expect(team.acceptInvitation(diego, tokenOf(inv.link))).rejects.toThrow(/ya se usó/);
    const d = await reload(diego.id);
    expect(d.platformRole).toBe("team");
    expect(levelFor(d, "finanzas")).toBe("view");
    expect(levelFor(d, "socios")).toBe("view");
    expect(can(d, "solicitudes", "manage")).toBe(false);
    expect(isStaff(d)).toBe(false);
    // Un módulo que exige gestionar solicitudes lo rechaza.
    const [req] = await sql()<{ id: string }[]>`select id from service_requests where status <> 'draft' limit 1`;
    await expect(operatorRunMatching(d, req.id, "Probar permisos de socio")).rejects.toThrow();
  });

  it("personalizado: gestiona solo lo asignado; el dueño puede cambiarlo o quitarle el acceso", async () => {
    const [admin, carla] = await Promise.all([actor("admin"), actor("carla")]);
    const inv = await team.inviteMember(admin, { email: carla.email, access: { kind: "custom", permissions: { catalogo: "manage", socios: "view", auditoria: "manage" } } });
    await team.acceptInvitation(carla, tokenOf(inv.link));
    let c = await reload(carla.id);
    expect(levelFor(c, "catalogo")).toBe("manage");
    expect(levelFor(c, "auditoria")).toBe("view"); // auditoría solo se consulta
    expect(levelFor(c, "finanzas")).toBe("none");
    const [cat] = await sql()<{ id: string; name: string; description: string; icon: string; sort: number; active: boolean; requires_review: boolean }[]>`
      select id, name, description, icon, sort, active, requires_review from categories where slug = 'pintura'`;
    const input = { id: cat.id, name: cat.name, description: cat.description, icon: cat.icon, sort: cat.sort, active: cat.active, requiresReview: cat.requires_review };
    await saveCategory(c, input, "Prueba de permisos de catálogo"); // gestiona catálogo: puede
    await team.updateMemberAccess(admin, carla.id, { kind: "custom", permissions: { socios: "view" } });
    c = await reload(carla.id);
    await expect(saveCategory(c, input, "Sin permiso de catálogo")).rejects.toThrow(/permiso/);
    await team.removeMember(admin, carla.id);
    c = await reload(carla.id);
    expect(c.platformRole).toBeNull();
    await expect(team.removeMember(admin, admin.id)).rejects.toThrow();
  });

  it("operación conserva su perfil: gestiona la operación y solo ve catálogo y cargos", async () => {
    const op = await actor("operador");
    expect(can(op, "solicitudes", "manage")).toBe(true);
    expect(can(op, "catalogo", "manage")).toBe(false);
    expect(can(op, "catalogo", "view")).toBe(true);
    expect(isStaff(op)).toBe(true);
  });
});
