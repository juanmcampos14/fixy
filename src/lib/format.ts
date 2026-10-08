/** Formateo para la interfaz (es-AR). Los importes llegan en centavos. */
const ars = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
const arsNoCents = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export function formatMoney(minor: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (minor == null) return "—";
  const cents = opts.cents ?? minor % 100 !== 0;
  // Dividir por 100 solo para mostrar; nunca se usa para calcular.
  return (cents ? ars : arsNoCents).format(minor / 100);
}

export function minorToInput(minor: number): string {
  const int = Math.trunc(minor / 100);
  const dec = Math.abs(minor % 100);
  return dec ? `${int},${String(dec).padStart(2, "0")}` : String(int);
}

const TZ = "America/Argentina/Buenos_Aires";
const dateFmt = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-").map(Number);
    return dateFmt.format(new Date(Date.UTC(y, m - 1, day, 12)));
  }
  return dateFmt.format(new Date(d));
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dateTimeFmt.format(new Date(d));
}

export function relativeTime(d: Date | string): string {
  const diff = Date.now() - new Date(d).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  if (days < 30) return `hace ${days} ${days === 1 ? "día" : "días"}`;
  return formatDate(d);
}

export function todayInBuenosAires(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts; // YYYY-MM-DD
}

const monthFmt = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", month: "long", year: "numeric" });
/** "octubre de 2026" (para fechas aproximadas, ej. publicación de reseñas). */
export function formatMonth(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(`${d.slice(0, 10)}T12:00:00Z`) : d;
  return monthFmt.format(date);
}
