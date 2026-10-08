export type DomainErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "invalid_transition"
  | "conflict"
  | "expired"
  | "not_eligible"
  | "rate_limited"
  | "payment_error";

/** Error de negocio con mensaje apto para mostrar al usuario (sin datos internos). */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const forbidden = (msg = "No tenés permiso para realizar esta acción.") => new DomainError("forbidden", msg);
export const notFound = (msg = "No encontramos lo que buscás.") => new DomainError("not_found", msg);
export const invalid = (msg: string) => new DomainError("invalid_input", msg);
export const conflict = (msg: string) => new DomainError("conflict", msg);

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

/** Traduce violaciones de reglas de la base a errores de dominio comprensibles. */
export function fromDbError(e: unknown): DomainError | null {
  const err = e as { code?: string; message?: string; constraint_name?: string };
  if (!err || typeof err !== "object") return null;
  const msg = err.message ?? "";
  if (msg.startsWith("invalid_transition")) return new DomainError("invalid_transition", "Esa acción no es válida en el estado actual.");
  if (msg.startsWith("immutable_")) return new DomainError("conflict", "Ese registro ya no puede modificarse.");
  if (msg.startsWith("provider_not_eligible")) return new DomainError("not_eligible", "El proveedor no está habilitado para recibir trabajos.");
  if (err.code === "23505") return new DomainError("conflict", "La operación ya fue realizada o entra en conflicto con otra.");
  return null;
}
