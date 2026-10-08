"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { Alert } from "./alert";
import { buttonClass } from "./button";
import { cn } from "@/lib/cn";

export function SubmitButton({ children, pendingText, variant = "primary", size = "md", className, disabled, name, value }: { children: React.ReactNode; pendingText?: string; variant?: "primary" | "secondary" | "danger" | "soft" | "ghost"; size?: "sm" | "md" | "lg"; className?: string; disabled?: boolean; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} aria-disabled={pending || disabled} className={buttonClass(variant, size, className)}>
      {pending && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
      {pending ? (pendingText ?? "Procesando…") : children}
    </button>
  );
}

/**
 * Formulario conectado a una acción de servidor. Muestra errores generales y por campo.
 * `children` recibe el estado para marcar campos inválidos.
 */
export function ActionForm({
  action,
  children,
  className,
  successMessage,
  resetOnSuccess,
  encType,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode | ((state: ActionState) => React.ReactNode);
  className?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  encType?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} encType={encType} noValidate={false}>
      {state.error && <Alert tone="danger" className="mb-4">{state.error}</Alert>}
      {state.ok && (state.message || successMessage) && <Alert tone="ok" className="mb-4">{state.message ?? successMessage}</Alert>}
      {typeof children === "function" ? children(state) : children}
    </form>
  );
}

/** Botón de acción sensible con confirmación explícita (diálogo accesible nativo). */
export function ConfirmAction({
  action,
  label,
  title,
  description,
  confirmLabel = "Confirmar",
  variant = "primary",
  size = "md",
  hidden,
  requireReason,
  reasonLabel = "Motivo",
  children,
  className,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  label: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "soft" | "ghost";
  size?: "sm" | "md" | "lg";
  hidden?: Record<string, string | number>;
  requireReason?: boolean;
  reasonLabel?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [state, formAction] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // close() dispara onClose, que actualiza `open`.
    if (state.ok) dialog.current?.close();
  }, [state]);
  return (
    <>
      <button type="button" className={buttonClass(variant, size, className)} onClick={() => { dialog.current?.showModal(); setOpen(true); }}>
        {label}
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(92vw,480px)] rounded-3xl bg-white p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]"
        aria-labelledby={`${uid}-title`}
      >
        {open && (
          <form action={formAction} className="p-6">
            <h2 id={`${uid}-title`} className="text-xl font-bold">{title}</h2>
            {description && <div className="mt-2 text-[15px] text-muted">{description}</div>}
            {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            {children}
            {requireReason && (
              <div className="mt-4 space-y-1.5">
                <label htmlFor={`${uid}-reason`} className="block text-[15px] font-semibold">{reasonLabel}</label>
                <textarea id={`${uid}-reason`} name="reason" required minLength={3} className="block min-h-24 w-full rounded-xl border border-[#d3dfdc] px-3.5 py-3 focus:border-fixy-600 focus:outline-none focus:ring-3 focus:ring-fixy-500/25" />
              </div>
            )}
            {state.error && <Alert tone="danger" className="mt-4">{state.error}</Alert>}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button type="button" className={buttonClass("secondary")} onClick={() => dialog.current?.close()}>
                Volver
              </button>
              <SubmitButton variant={variant === "danger" ? "danger" : "primary"}>{confirmLabel}</SubmitButton>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}

export function FieldError({ state, name, className }: { state: ActionState; name: string; className?: string }) {
  const e = state.fieldErrors?.[name]?.[0];
  if (!e) return null;
  return <p className={cn("mt-1 text-sm font-medium text-danger", className)} role="alert">{e}</p>;
}
