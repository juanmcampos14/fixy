import { describe, expect, it } from "vitest";
import { maskContactInfo } from "@/server/domain/contact-guard";

describe("ocultamiento de datos de contacto", () => {
  it.each([
    "Llamame al 11 5555-1234",
    "mi cel +54 9 11 4567-8901",
    "escribime a juan.perez@gmail.com",
    "pasate a wa.me/5491155551234",
    "transferime al alias juan.perez.mp",
    "cbu 0170099220000067797370",
  ])("oculta: %s", (t) => {
    const r = maskContactInfo(t);
    expect(r.masked).toBe(true);
    expect(r.text).toContain("[dato de contacto oculto]");
  });
  it("no toca mensajes normales", () => {
    const t = "Paso el martes 14 entre las 9 y las 12, son 2 canillas y 1 inodoro. Total $45.000.";
    expect(maskContactInfo(t)).toEqual({ text: t, masked: false });
  });
});
