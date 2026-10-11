import { Paperclip } from "lucide-react";
import type { MessageRow } from "@/server/queries/shared";
import { sendMessageAction } from "@/app/shared-actions";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";

export function MessageThread({ conversationId, messages, path, disabled, emptyText = "Todavía no hay mensajes. Coordiná todo por acá: queda registrado." }: { conversationId: string; messages: MessageRow[]; path: string; disabled?: boolean; emptyText?: string }) {
  return (
    <div>
      <ol className="max-h-[420px] space-y-3 overflow-y-auto pr-1" aria-label="Mensajes">
        {messages.length === 0 && <li className="text-sm text-muted">{emptyText}</li>}
        {messages.map((m) => (
          <li key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px]", m.mine ? "rounded-br-md bg-fixy-700 text-white" : m.sender_side === "platform" ? "bg-info-bg text-ink" : "rounded-bl-md bg-cream-2 text-ink")}>
              {!m.mine && <p className="mb-0.5 text-xs font-semibold opacity-80">{m.sender_name ?? "Fixy"}{m.sender_side === "platform" ? " · equipo Fixy" : ""}</p>}
              <p className="whitespace-pre-line break-words">{m.body}</p>
              {m.file_url && (
                <a href={m.file_url} target="_blank" rel="noreferrer" className={cn("mt-1 inline-flex items-center gap-1 text-sm underline", m.mine ? "text-white" : "text-fixy-800")}>
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />{m.file_name}
                </a>
              )}
              <p className={cn("mt-1 text-[11px]", m.mine ? "text-white/75" : "text-muted")}>{formatDateTime(m.created_at)}</p>
            </div>
          </li>
        ))}
      </ol>
      {!disabled && (
        <ActionForm action={sendMessageAction} className="mt-4" resetOnSuccess>
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="path" value={path} />
          <label htmlFor={`msg-${conversationId}`} className="sr-only">Escribí un mensaje</label>
          <textarea id={`msg-${conversationId}`} name="body" rows={2} maxLength={4000} placeholder="Escribí un mensaje…" className="block w-full rounded-2xl border border-control px-4 py-3 focus:border-fixy-600 focus:outline-none focus:ring-3 focus:ring-fixy-500/25" />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted hover:text-ink">
              <Paperclip className="h-4 w-4" aria-hidden /> Adjuntar
              <input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="max-w-48 text-xs" />
            </label>
            <SubmitButton size="sm" pendingText="Enviando…">Enviar</SubmitButton>
          </div>
          <p className="mt-2 text-xs text-muted">Para tu protección, coordiná y pagá siempre dentro de Fixy. No compartas datos de tarjetas ni contraseñas.</p>
        </ActionForm>
      )}
    </div>
  );
}
