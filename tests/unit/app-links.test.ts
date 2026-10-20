import { describe, expect, it } from "vitest";
import { PLAY_STORE_URL, playStoreUrl, storeFor } from "@/lib/app-links";

describe("link de descarga", () => {
  it("elige la tienda según el celular", () => {
    expect(storeFor("Mozilla/5.0 (Linux; Android 13; SM-A135M) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36")).toBe("android");
    expect(storeFor("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe("ios");
    expect(storeFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15")).toBe("other");
    expect(storeFor("")).toBe("other");
  });

  it("anota el origen sólo si es seguro", () => {
    expect(playStoreUrl()).toBe(PLAY_STORE_URL);
    expect(playStoreUrl("whatsapp")).toBe(`${PLAY_STORE_URL}&referrer=utm_source%3Dwhatsapp%26utm_medium%3Dlink`);
    expect(playStoreUrl("<script>")).toBe(PLAY_STORE_URL);
  });
});
