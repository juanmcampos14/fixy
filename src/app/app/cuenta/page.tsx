import type { Metadata } from "next";
import Link from "next/link";
import { requireActor } from "@/server/auth/session";
import { sql } from "@/server/db/client";
import { DELETE_CONFIRMATION, deletionBlockers } from "@/server/modules/account";
import { Card, CardHeader, DefinitionList, PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { DeleteAccountForm } from "./delete-form";
import { SUPPORT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = { title: "Mi cuenta" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const actor = await requireActor("/app/cuenta");
  const [u] = await sql()<{ phone: string | null; whatsapp_phone: string | null; google: boolean; has_password: boolean; created_at: Date }[]>`
    select phone, whatsapp_phone, google_sub is not null as google, password_hash is not null as has_password, created_at from users where id = ${actor.id}`;
  const blockers = await deletionBlockers(sql(), actor);
  return (
    <>
      <PageHeader title="Mi cuenta" description="Tus datos de acceso y contacto." />
      <div className="max-w-2xl space-y-5">
        <Card>
          <CardHeader title="Tus datos" />
          <DefinitionList items={[
            ["Nombre", actor.fullName],
            ["Email", actor.hasEmail === false ? "Sin email (entrás por WhatsApp)" : actor.email],
            ["Teléfono", u.phone ?? "—"],
            ["WhatsApp vinculado", u.whatsapp_phone ? `Terminado en ${u.whatsapp_phone.slice(-4)}` : "No"],
            ["Ingreso", [u.has_password && "Email y contraseña", u.google && "Google"].filter(Boolean).join(" · ") || "—"],
          ]} />
          <p className="mt-3 text-sm text-muted">¿Necesitás cambiar algún dato? Escribinos a <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
        </Card>

        <Card as="section" aria-labelledby="del-t" className="ring-1 ring-danger/20">
          <CardHeader title={<span id="del-t">Eliminar mi cuenta</span>} description="Es definitivo: no se puede deshacer." />
          <ul className="list-disc space-y-1 pl-5 text-[15px] text-ink-2">
            <li>Borramos tu nombre, email, teléfonos, WhatsApp, direcciones y datos bancarios, y cerramos tus sesiones.</li>
            <li>Si sos profesional y nadie más administra tu perfil, se cierra y deja de mostrarse.</li>
            <li>Tus pedidos abiertos se cancelan y le avisamos a los profesionales.</li>
            <li>Conservamos, sin datos que te identifiquen, lo que la ley nos obliga a guardar (pagos y registros contables). Tus reseñas publicadas siguen siendo anónimas.</li>
          </ul>
          <p className="mt-2 text-sm text-muted">Más detalle en la <Link className="underline" href="/privacidad">política de privacidad</Link>.</p>
          {blockers.length > 0 ? (
            <Alert tone="warn" className="mt-4" title="Antes de eliminarla, falta cerrar esto">
              <ul className="list-disc pl-5">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </Alert>
          ) : (
            <DeleteAccountForm word={DELETE_CONFIRMATION} />
          )}
        </Card>
      </div>
    </>
  );
}
