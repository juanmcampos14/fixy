/**
 * Recibe los informes de la política de contenido (modo informe) y los deja en los registros del servidor,
 * resumidos: qué directiva se violó y desde qué origen, sin URLs completas (pueden llevar datos personales).
 */
export async function POST(req: Request) {
  const raw = (await req.text().catch(() => "")).slice(0, 8_000);
  try {
    const body = JSON.parse(raw) as { "csp-report"?: Record<string, string> } | { body?: Record<string, string> }[];
    const reports = Array.isArray(body) ? body.map((r) => r.body ?? {}) : [body["csp-report"] ?? {}];
    for (const r of reports.slice(0, 5)) {
      const origin = (u?: string) => { try { return u ? new URL(u).origin : u ?? ""; } catch { return (u ?? "").slice(0, 40); } };
      console.warn("[csp]", JSON.stringify({
        directive: r["effective-directive"] ?? r.effectiveDirective ?? r["violated-directive"],
        blocked: origin(r["blocked-uri"] ?? r.blockedURL),
        page: r["document-uri"] || r.documentURL ? new URL(r["document-uri"] ?? r.documentURL).pathname : "",
      }));
    }
  } catch {
    // Informe malformado: se ignora.
  }
  return new Response(null, { status: 204 });
}
