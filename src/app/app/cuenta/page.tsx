import type { Metadata } from "next";
import Link from "next/link";
import { listMySessions, requireActor } from "@/server/auth/session";
import { canAccessAdmin } from "@/server/auth/actor";
import { mfaStatus } from "@/server/modules/mfa";
import { ConfirmAction } from "@/components/ui/form";
import { formatDateTime } from "@/lib/format";
import { revokeOtherSessionsAction, revokeSessionAction } from "./actions";
import { sql } from "@/server/db/client";
import { DELETE_CONFIRMATION, deletionBlockers } from "@/server/modules/account";
import { Card, CardHeader, DefinitionList, PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { DeleteAccountForm } from "./delete-form";
import { EmailAccessForm } from "./email-access-form";
import { SUPPORT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = { title: "Mi cuenta" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const actor = await requireActor("/app/cuenta");
  const [u] = await sql()<{ phone: string | null; whatsapp_phone: string | null; google: boolean; has_password: boolean; created_at: Date }[]>`
    select phone, whatsapp_phone, google_sub is not null as google, password_hash is not null as has_password, created_at from users where id = ${actor.id}`;
  const blockers = await deletionBlockers(sql(), actor);
  const sessions = await listMySessions(actor);
  const staffMfa = canAccessAdmin(actor) ? await mfaStatus(actor) : null;
  // Cuenta nacida en WhatsApp: sin email, o con un email agregado después (sin verificar).
  const fromWhatsApp = actor.hasEmail === false || (actor.emailVerified === false && !!u.whatsapp_phone);
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
            ["Ingreso", [fromWhatsApp && "Link por WhatsApp", u.has_password && "Email y contraseña", u.google && "Google"].filter(Boolean).join(" · ") || "—"],
          ]} />
          <p className="mt-3 text-sm text-muted">¿Necesitás cambiar algún dato? Escribinos a <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
        </Card>

        {fromWhatsApp && (
          <Card as="section" aria-labelledby="ea-t">
            <CardHeader title={<span id="ea-t">{actor.hasEmail === false ? "Entrar también con email y clave" : "Tu email y tu clave"}</span>}
              description={actor.hasEmail === false
                ? "Es opcional. Hoy entrás escribiendo «entrar» al WhatsApp de Fixy; si querés, sumá un email y una clave para entrar también desde la pantalla de ingreso."
                : "Podés cambiarlos cuando quieras."} />
            <EmailAccessForm currentEmail={actor.hasEmail === false ? null : actor.email} />
            <p className="mt-3 text-sm text-muted">Los avisos te siguen llegando por WhatsApp. Si te olvidás la clave, escribí <strong>entrar</strong> al WhatsApp de Fixy y la cambiás acá.</p>
          </Card>
        )}

        {staffMfa && (
          <Card as="section" aria-labelledby="mfa-t">
            <CardHeader title={<span id="mfa-t">Segundo factor</span>}
              description={staffMfa.enabled ? `Activado. Te quedan ${staffMfa.recoveryLeft} códigos de respaldo.` : "Obligatorio para entrar al panel de operación."} />
            <Link className="text-sm font-semibold text-fixy-800 underline" href="/seguridad/segundo-factor">{staffMfa.enabled ? "Ver o generar códigos de respaldo" : "Activarlo ahora"}</Link>
          </Card>
        )}

        <Card as="section" aria-labelledby="ses-t">
          <CardHeader title={<span id="ses-t">Sesiones abiertas</span>} description="Dispositivos donde está abierta tu cuenta. Si no reconocés alguno, cerralo y cambiá tu contraseña." />
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{deviceLabel(s.user_agent)}{s.current && <span className="ml-2 text-sm text-ok">· Este dispositivo</span>}</p>
                  <p className="text-sm text-muted">Último uso: {formatDateTime(s.last_seen_at)}{s.ip_hint ? ` · Red ${s.ip_hint}` : ""}</p>
                </div>
                {!s.current && (
                  <ConfirmAction action={revokeSessionAction} label="Cerrar" size="sm" variant="secondary" title="Cerrar esta sesión"
                    description="Ese dispositivo va a tener que volver a ingresar." confirmLabel="Cerrar sesión" hidden={{ sessionId: s.id }} />
                )}
              </li>
            ))}
          </ul>
          {sessions.length > 1 && (
            <div className="mt-3">
              <ConfirmAction action={revokeOtherSessionsAction} label="Cerrar todas las demás" size="sm" variant="ghost" title="Cerrar las demás sesiones"
                description="Se cierran todas menos esta." confirmLabel="Cerrar las demás" />
            </div>
          )}
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

/** Nombre legible del dispositivo a partir del navegador (sin guardar más de lo necesario). */
function deviceLabel(ua: string | null) {
  if (!ua) return "Dispositivo desconocido";
  if (/FixyApp/.test(ua)) return /android/i.test(ua) ? "App de Fixy · Android" : "App de Fixy · iPhone";
  const os = /android/i.test(ua) ? "Android" : /iphone|ipad/i.test(ua) ? "iPhone" : /mac os/i.test(ua) ? "Mac" : /windows/i.test(ua) ? "Windows" : /linux/i.test(ua) ? "Linux" : "Otro";
  const br = /edg\//i.test(ua) ? "Edge" : /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "Navegador";
  return `${br} · ${os}`;
}
