import { describe, expect, it } from "vitest";
import { parseStatuses } from "@/server/whatsapp/statuses";

describe("parseStatuses", () => {
  it("lee entregas y fallas con su motivo", () => {
    const body = { entry: [{ changes: [{ value: { statuses: [
      { id: "wamid.A", status: "delivered" },
      { id: "wamid.B", status: "failed", errors: [{ code: 131042, title: "Business eligibility payment issue", error_data: { details: "No hay medio de pago" } }] },
      { status: "read" },
    ] } }] }] };
    expect(parseStatuses(body)).toEqual([
      { id: "wamid.A", status: "delivered", error: null },
      { id: "wamid.B", status: "failed", error: "Meta 131042: No hay medio de pago" },
    ]);
  });
  it("ignora webhooks sin estados", () => expect(parseStatuses({ entry: [{ changes: [{ value: { messages: [] } }] }] })).toEqual([]));
});
