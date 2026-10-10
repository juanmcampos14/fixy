/** assetlinks.json: se publica en /.well-known/ (ver next.config.ts). */
import { ANDROID_CERT_SHA256, APP_ID } from "@/lib/app-links";

export const dynamic = "force-static";

export function GET() {
  return Response.json(
    [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: APP_ID, sha256_cert_fingerprints: ANDROID_CERT_SHA256 } }],
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
