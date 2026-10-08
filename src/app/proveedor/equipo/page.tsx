import type { Metadata } from "next";
import { getOwnProvider, listTeam, requireProviderContext } from "@/server/queries/provider";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/field";
import { formatDate } from "@/lib/format";
import { addMemberAction, deactivateMemberAction } from "../actions";

export const metadata: Metadata = { title: "Equipo" };

export default async function TeamPage() {
  const { actor, provider } = await requireProviderContext({ adminOnly: true });
  const [own, team] = await Promise.all([getOwnProvider(actor.id, provider.id), listTeam(actor.id, provider.id)]);
  const company = own?.kind === "company";
  return (
    <>
      <PageHeader title="Equipo" description="Sumá técnicos para asignarles trabajos. Ven solo los trabajos asignados, sin importes ni cobros." />
      {!company && (
        <Alert tone="info" className="mb-5" title="Los equipos están disponibles para empresas">
          Si trabajás con un equipo, cambiá el tipo de proveedor a «Empresa con equipo» en Perfil.
        </Alert>
      )}
      <div className="space-y-5">
        <Card>
          <CardHeader title="Integrantes" />
          <ul className="divide-y divide-line">
            {team.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">{m.full_name}{m.user_id === actor.id && <span className="font-normal text-muted"> (vos)</span>}</p>
                  <p className="text-sm text-muted">Desde {formatDate(m.created_at)} · {m.active_jobs} {m.active_jobs === 1 ? "trabajo activo" : "trabajos activos"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={m.role === "admin" ? "brand" : "info"} icon={false}>{m.role === "admin" ? "Administración" : "Técnico"}</Badge>
                  {!m.active && <Badge tone="neutral">Inactivo</Badge>}
                  {m.active && m.user_id !== actor.id && (
                    <ConfirmAction action={deactivateMemberAction} label="Desactivar" variant="danger" size="sm" title={`¿Desactivar a ${m.full_name}?`}
                      description="Deja de ver los trabajos de tu cuenta. Sus trabajos abiertos quedan sin asignar." hidden={{ userId: m.user_id }} confirmLabel="Desactivar" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Sumar a alguien" description="La persona tiene que tener una cuenta en Fixy con ese email." />
          <ActionForm action={addMemberAction} className="grid gap-4 sm:grid-cols-[1fr_200px_auto] sm:items-end" resetOnSuccess>
            <Field label="Email de la cuenta" htmlFor="tm-email" required>
              <Input id="tm-email" name="email" type="email" required autoComplete="off" />
            </Field>
            <Field label="Rol" htmlFor="tm-role" required>
              <Select id="tm-role" name="role" defaultValue={company ? "technician" : "admin"}>
                {company && <option value="technician">Técnico</option>}
                <option value="admin">Administración</option>
              </Select>
            </Field>
            <SubmitButton pendingText="Sumando…">Sumar</SubmitButton>
          </ActionForm>
          <p className="mt-3 text-sm text-muted">Administración puede cotizar, ver cobros y gestionar el equipo.</p>
        </Card>
      </div>
    </>
  );
}
