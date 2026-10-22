import { describe, expect, it } from "vitest";
import { MetadataError, stripImageMetadata } from "@/server/storage/strip-metadata";

const seg = (marker: number, body: string) => {
  const b = Buffer.from(body, "latin1");
  const h = Buffer.from([0xff, marker, 0, 0]);
  h.writeUInt16BE(b.length + 2, 2);
  return Buffer.concat([h, b]);
};

describe("stripImageMetadata", () => {
  it("quita EXIF (GPS) de un JPEG y conserva la imagen", () => {
    const jfif = seg(0xe0, "JFIF\0");
    const exif = seg(0xe1, "Exif\0\0GPS-34.6037,-58.3816");
    const scan = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, exif, scan]);
    const out = stripImageMetadata(jpeg, "image/jpeg");
    expect(out.toString("latin1")).not.toContain("GPS");
    expect(out.equals(Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, scan]))).toBe(true);
  });

  it("quita el bloque eXIf de un PNG", () => {
    const chunk = (type: string, data: string) => {
      const d = Buffer.from(data, "latin1");
      const len = Buffer.alloc(4);
      len.writeUInt32BE(d.length);
      return Buffer.concat([len, Buffer.from(type, "latin1"), d, Buffer.alloc(4)]);
    };
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const png = Buffer.concat([sig, chunk("IHDR", "x".repeat(13)), chunk("eXIf", "GPS"), chunk("IDAT", "data"), chunk("IEND", "")]);
    const out = stripImageMetadata(png, "image/png");
    expect(out.toString("latin1")).not.toContain("GPS");
    expect(out.toString("latin1")).toContain("IDAT");
  });

  it("rechaza un archivo que no puede interpretar (no lo guarda con metadatos)", () => {
    expect(() => stripImageMetadata(Buffer.from("no es una imagen"), "image/jpeg")).toThrow(MetadataError);
    const cut = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe1, "Exif\0\0GPS-34.6")]); // sin datos de imagen
    expect(() => stripImageMetadata(cut, "image/jpeg")).toThrow(MetadataError);
    expect(() => stripImageMetadata(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]), "image/png")).toThrow(MetadataError);
  });
});

describe("PDFs con contenido activo", () => {
  it("rechaza JavaScript, apertura automática y adjuntos; acepta un PDF común", async () => {
    const { pdfHasActiveContent } = await import("@/server/storage");
    expect(pdfHasActiveContent(Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>"))).toBe(true);
    expect(pdfHasActiveContent(Buffer.from("%PDF-1.7\n<< /Type /EmbeddedFile >>"))).toBe(true);
    expect(pdfHasActiveContent(Buffer.from("%PDF-1.7\n<< /Type /Page /Contents 4 0 R >>"))).toBe(false);
  });
});
