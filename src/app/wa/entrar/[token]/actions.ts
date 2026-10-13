"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSession } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { redeemLoginLink } from "@/server/whatsapp/pro-signup";

export async function enterAction(f: FormData) {
  const token = String(f.get("token") ?? "");
  const h = await headers();
  let r: Awaited<ReturnType<typeof redeemLoginLink>> = null;
  try {
    await rateLimit(`wa-login:${(h.get("x-forwarded-for") ?? "local").split(",")[0].trim()}`, 20, 600);
    r = await redeemLoginLink(token);
  } catch {
    r = null;
  }
  if (!r) redirect(`/wa/entrar/${encodeURIComponent(token)}?e=1`);
  await createSession(r.userId);
  redirect(r.home);
}
