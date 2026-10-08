import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, chargeMachine, jobMachine, quoteMachine, requestMachine } from "@/server/domain/state-machines";

describe("máquinas de estado", () => {
  it("valida transiciones y actores autorizados", () => {
    expect(canTransition(quoteMachine, "sent", "accepted", "client")).toBe(true);
    expect(canTransition(quoteMachine, "sent", "accepted", "provider")).toBe(false);
    expect(canTransition(quoteMachine, "expired", "accepted")).toBe(false);
    expect(canTransition(quoteMachine, "withdrawn", "accepted")).toBe(false);
    expect(canTransition(jobMachine, "pending_approval", "completed", "client")).toBe(true);
    expect(canTransition(jobMachine, "pending_approval", "completed", "provider")).toBe(false);
    expect(canTransition(jobMachine, "in_progress", "completed")).toBe(false);
    expect(canTransition(jobMachine, "completed", "cancelled")).toBe(false);
    expect(canTransition(requestMachine, "converted", "with_quotes")).toBe(false);
    expect(canTransition(chargeMachine, "approved", "pending")).toBe(false);
    expect(canTransition(chargeMachine, "refunded", "approved")).toBe(false);
  });

  it("distingue transición inválida de actor no autorizado", () => {
    expect(() => assertTransition(jobMachine, "in_progress", "completed", "client")).toThrow(/estado actual/);
    expect(() => assertTransition(jobMachine, "pending_confirmation", "confirmed", "client")).toThrow(/permiso/);
  });
});
