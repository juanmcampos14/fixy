/**
 * Quita metadatos de las imágenes (EXIF con GPS, XMP, IPTC) sin recomprimirlas.
 * Una foto sacada con el celular puede traer las coordenadas exactas de la casa, y los profesionales
 * ven las fotos del pedido antes de que se confirme la visita (cuando todavía no conocen la dirección).
 * Si el archivo no se puede interpretar, NO se guarda tal cual (auditoría M-04): se lanza MetadataError y la subida se
 * rechaza, porque una imagen que no entendemos podría conservar la ubicación.
 */
export class MetadataError extends Error {
  constructor() {
    super("No se pudo procesar la imagen");
    this.name = "MetadataError";
  }
}

export function stripImageMetadata(data: Buffer, mime: string): Buffer {
  let out: Buffer | null = null;
  try {
    if (mime === "image/jpeg") out = stripJpeg(data);
    else if (mime === "image/png") out = stripPng(data);
    else if (mime === "image/webp") out = stripWebp(data);
    else return data;
  } catch {
    out = null;
  }
  if (!out) throw new MetadataError();
  return out;
}

function stripJpeg(d: Buffer): Buffer | null {
  if (d[0] !== 0xff || d[1] !== 0xd8) return null;
  const parts: Buffer[] = [d.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= d.length) {
    if (d[i] !== 0xff) return null;
    const marker = d[i + 1];
    if (marker === 0xda) {
      parts.push(d.subarray(i)); // desde el inicio de la imagen comprimida, todo se conserva
      return Buffer.concat(parts);
    }
    const len = d.readUInt16BE(i + 2);
    const seg = d.subarray(i, i + 2 + len);
    // APP1 (EXIF/XMP), APP13 (IPTC/Photoshop) y comentarios: afuera. APP0 (JFIF), APP2 (perfil de color) y APP14 se quedan.
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) parts.push(seg);
    i += 2 + len;
  }
  return null; // sin inicio de imagen: archivo cortado o malformado
}

function stripPng(d: Buffer): Buffer | null {
  if (d.length < 8 || d.readUInt32BE(0) !== 0x89504e47) return null;
  const parts: Buffer[] = [d.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= d.length) {
    const len = d.readUInt32BE(i);
    const type = d.toString("latin1", i + 4, i + 8);
    const end = i + 12 + len;
    if (end > d.length) return null;
    if (!["eXIf", "tEXt", "iTXt", "zTXt"].includes(type)) parts.push(d.subarray(i, end));
    i = end;
    if (type === "IEND") return Buffer.concat(parts);
  }
  return null; // sin IEND: archivo cortado
}

function stripWebp(d: Buffer): Buffer | null {
  if (d.toString("latin1", 0, 4) !== "RIFF" || d.toString("latin1", 8, 12) !== "WEBP") return null;
  const chunks: Buffer[] = [];
  let i = 12;
  while (i + 8 <= d.length) {
    const type = d.toString("latin1", i, i + 4);
    const len = d.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    if (end > d.length + 1) return null;
    const chunk = Buffer.from(d.subarray(i, Math.min(end, d.length)));
    if (type === "VP8X") chunk[8] &= ~(0x08 | 0x04); // sin banderas de EXIF y XMP
    if (type !== "EXIF" && type !== "XMP ") chunks.push(chunk);
    i = end;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return Buffer.concat([header, body]);
}
