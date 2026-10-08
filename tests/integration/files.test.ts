import { describe, expect, it } from "vitest";
import { signedFileUrl, sniffMime, verifyFileSignature } from "@/server/storage";

describe("archivos privados", () => {
  it("valida tipo real por contenido", () => {
    expect(sniffMime(Buffer.from("%PDF-1.4 aaaaaaaa"))).toBe("application/pdf");
    expect(sniffMime(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
  });
  it("las URLs firmadas expiran y no se pueden reutilizar para otro archivo", () => {
    const url = new URL(signedFileUrl("11111111-1111-1111-1111-111111111111", 60), "http://x");
    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    expect(verifyFileSignature("11111111-1111-1111-1111-111111111111", exp, sig)).toBe(true);
    expect(verifyFileSignature("22222222-2222-2222-2222-222222222222", exp, sig)).toBe(false);
    expect(verifyFileSignature("11111111-1111-1111-1111-111111111111", String(Number(exp) - 3600), sig)).toBe(false);
    expect(verifyFileSignature("11111111-1111-1111-1111-111111111111", "1", sig)).toBe(false);
  });
});
