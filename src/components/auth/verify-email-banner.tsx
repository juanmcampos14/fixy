import { MailCheck } from "lucide-react";
import type { Actor } from "@/server/auth/actor";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { resendVerificationAction } from "@/app/(auth)/actions";

/** Aviso del panel mientras el email no está confirmado (cuentas con email propio). */
export function VerifyEmailBanner({ actor }: { actor: Actor }) {
  if (actor.hasEmail === false || actor.emailVerified !== false) return null;
  return (
    <div className="mb-4 rounded-2xl border border-line bg-surface px-4 py-3">
      <ActionForm action={resendVerificationAction} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <MailCheck className="hidden h-5 w-5 shrink-0 text-fixy-800 sm:block" aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-ink-2">
          <strong className="text-ink">Confirmá tu email.</strong> Te mandamos un enlace a <span className="break-all">{actor.email}</span>. Hasta confirmarlo no podés pagar ni cobrar.
        </p>
        <SubmitButton variant="secondary" size="sm" pendingText="Enviando…">Reenviar enlace</SubmitButton>
      </ActionForm>
    </div>
  );
}
