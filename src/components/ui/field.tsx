import { cn } from "@/lib/cn";

const control =
  "block w-full rounded-xl border border-[#d3dfdc] bg-white px-3.5 text-[16px] text-ink placeholder:text-[#8a9a9e] transition-colors focus:border-fixy-600 focus:outline-none focus:ring-3 focus:ring-fixy-500/25 disabled:bg-cream-2 aria-[invalid=true]:border-danger";

export function Field({ label, htmlFor, hint, error, required, children, className }: { label: React.ReactNode; htmlFor: string; hint?: React.ReactNode; error?: string | string[]; required?: boolean; children: React.ReactNode; className?: string }) {
  const err = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[15px] font-semibold text-ink">
        {label}
        {required ? <span className="text-danger" aria-hidden> *</span> : <span className="ml-1 text-sm font-normal text-muted">(opcional)</span>}
      </label>
      {hint && <p id={`${htmlFor}-hint`} className="text-sm text-muted">{hint}</p>}
      {children}
      {err && (
        <p id={`${htmlFor}-error`} className="text-sm font-medium text-danger" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}

export function Input({ className, invalid, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input aria-invalid={invalid || undefined} className={cn(control, "h-12", className)} {...props} />;
}

export function Textarea({ className, invalid, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea aria-invalid={invalid || undefined} className={cn(control, "min-h-28 py-3 leading-relaxed", className)} {...props} />;
}

export function Select({ className, invalid, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select aria-invalid={invalid || undefined} className={cn(control, "h-12 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%2315343b%22><path d=%22M5.5 7.5 10 12l4.5-4.5%22 stroke=%22%2315343b%22 stroke-width=%221.8%22 fill=%22none%22 stroke-linecap=%22round%22/></svg>')] bg-[length:20px] bg-[right_12px_center] bg-no-repeat pr-10", className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 text-[15px]", className)}>
      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 rounded-md border-[#c6d4d1] accent-fixy-700" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function ChoiceChip({ name, value, label, type = "radio", defaultChecked, required }: { name: string; value: string; label: React.ReactNode; type?: "radio" | "checkbox"; defaultChecked?: boolean; required?: boolean }) {
  return (
    <label className="cursor-pointer">
      <input type={type} name={name} value={value} defaultChecked={defaultChecked} required={required} className="peer sr-only" />
      <span className="inline-flex min-h-11 items-center rounded-full border border-[#d3dfdc] bg-white px-4 text-[15px] font-medium text-ink transition-colors peer-checked:border-fixy-700 peer-checked:bg-fixy-50 peer-checked:text-fixy-800 peer-focus-visible:ring-3 peer-focus-visible:ring-fixy-500/40 hover:border-fixy-500">
        {label}
      </span>
    </label>
  );
}
