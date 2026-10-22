import { redirect } from "next/navigation";
import { requireStaff } from "@/server/auth/session";
import { isPlatformAdmin } from "@/server/auth/actor";
import { ADMIN_SECTIONS, PARTNER_PRESET } from "@/server/auth/permissions";
import { listTeam } from "@/server/modules/team";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/ui/form";
import { EditAccessForm, InviteForm } from "@/components/admin/access-form";
import { formatDateTime } from "@/lib/format";
import { ReviewAccounts } from "@/components/admin/review-accounts";
import { sql } from "@/server/db/client";
import { generateReviewAccountsAction, inviteMemberAction, removeMemberAction, resetMemberMfaAction, revokeInvitationAction, updateMemberAccessAction } from "../actions";

export const metadata = { title: "Equipo y permisos" };
export const dynamic = "force-dynamic";

const ROLE: Record<string, string> = { admin: "Dueño", operator: "Operación", team: "Personalizado" };
const sections = ADMIN_SECTIONS.map(({ key, label, hint, manageable }) => ({ key, label, hint, manageable }));

export default async function TeamPage() {
  const actor = await requireStaff();
  if (!isPlatformAdmin(actor)) redirect("/admin?error=forbidden");
  const { members, invitations } = await listTeam();
  const [hasReviewAccounts] = await sql()<{ n: number }[]>`select 1 as n from users where sandbox limit 1`.then((r) => [r.length > 0]);
  const isPartner = (p: Record<string, string>) => ADMIN_SECTIONS.every((s) => p[s.key] === PARTNER_PRESET[s.key]);

  return (
    <>
      <PageHeader eyebrow="Administración" title="Equipo y permisos" description="Invitá personas al panel y elegí, sección por sección, qué pueden ver y qué pueden hacer." />
      <div className="space-y-5">
        <Card>
          <CardHeader title="Cuentas para la revisión de las tiendas" description="Apple y Google piden un usuario de prueba para revisar la app. Se crean un cliente y un profesional de demostración que solo se ven entre sí: sus pedidos nunca les llegan a profesionales reales ni reciben correos." />
          <ReviewAccounts action={generateReviewAccountsAction} exists={hasReviewAccounts} />
        </Card>

        <Card>
          <CardHeader title="Invitar a alguien" description="Se crea un link de un solo uso que vence en 7 días. Mandáselo por WhatsApp o email; si ya tiene cuenta, también le avisamos en Fixy." />
          <InviteForm action={inviteMemberAction} sections={sections} />
        </Card>

        {invitations.length > 0 && (
          <Card>
            <CardHeader title="Invitaciones pendientes" />
            <ul className="divide-y divide-line">
              {invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div><p className="font-semibold">{i.email}</p><p className="text-sm text-muted">{i.label} · vence {formatDateTime(i.expires_at)}</p></div>
                  <ConfirmAction action={revokeInvitationAction} label="Anular" variant="ghost" size="sm" title="¿Anular la invitación?" description="El link deja de funcionar." hidden={{ invitationId: i.id }} confirmLabel="Anular" />
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader title="Quiénes tienen acceso" />
          <ul className="divide-y divide-line">
            {members.map((m) => {
              const profile = m.platform_role === "operator" ? "operacion" : isPartner(m.permissions) ? "socio" : "custom";
              const label = m.platform_role === "team" && profile === "socio" ? "Socio" : ROLE[m.platform_role];
              const summary = m.platform_role === "team"
                ? ADMIN_SECTIONS.filter((s) => m.permissions[s.key]).map((s) => `${s.label}${m.permissions[s.key] === "manage" ? " (gestiona)" : ""}`).join(" · ")
                : null;
              return (
                <li key={m.id} className="py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{m.full_name}{m.id === actor.id && <span className="text-muted"> (vos)</span>}</p>
                      <p className="text-sm text-muted">{m.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={m.mfa ? "ok" : "warn"}>{m.mfa ? "Segundo factor" : "Sin segundo factor"}</Badge>
                      <Badge tone={m.platform_role === "admin" ? "brand" : "neutral"} icon={false}>{label}</Badge>
                    </div>
                  </div>
                  {summary && <p className="mt-1 text-sm text-ink-2">{summary}</p>}
                  {m.platform_role !== "admin" && (
                    <details className="mt-3 rounded-2xl bg-cream/60 p-3">
                      <summary className="cursor-pointer text-sm font-semibold text-fixy-800">Cambiar permisos o quitar acceso</summary>
                      <div className="mt-3 space-y-4">
                        <EditAccessForm action={updateMemberAccessAction} sections={sections} userId={m.id} initialProfile={profile} initial={m.permissions} />
                        {m.mfa && isPlatformAdmin(actor) && (
                          <ConfirmAction action={resetMemberMfaAction} label="Reiniciar segundo factor" variant="secondary" size="sm" title={`¿Reiniciar el segundo factor de ${m.full_name}?`}
                            description="Usalo solo si perdió el celular y los códigos de respaldo. Se cierran sus sesiones y al volver a entrar lo activa de nuevo. Confirmá su identidad por otro medio antes."
                            hidden={{ userId: m.id }} confirmLabel="Reiniciar" requireReason reasonLabel="Motivo y cómo verificaste que es la persona" />
                        )}
                        <ConfirmAction action={removeMemberAction} label="Quitar acceso al panel" variant="danger" size="sm" title={`¿Quitarle el acceso a ${m.full_name}?`}
                          description="Deja de ver el panel de administración. Su cuenta de Fixy sigue funcionando." hidden={{ userId: m.id }} confirmLabel="Quitar acceso" />
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
