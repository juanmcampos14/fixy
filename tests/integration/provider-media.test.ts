import { describe, expect, it } from "vitest";
import { sql } from "@/server/db/client";
import * as requests from "@/server/modules/requests";
import * as quotes from "@/server/modules/quotes";
import * as jobs from "@/server/modules/jobs";
import { addPortfolioItems, updateSocialLinks } from "@/server/modules/providers";
import { getPublicProfile } from "@/server/queries/provider";
import { handleInbound, type Inbound } from "@/server/whatsapp/bot";
import { storeFile } from "@/server/storage";
import { actor, catId, invitationFor, payPending, propertyOf, providerId, simpleQuote, totalOf, fakeJpeg } from "./helpers";

const jpeg = fakeJpeg;
const pdf = () => Buffer.from(`%PDF-1.4 catálogo ${Date.now()}`);
let seq = 0;

async function confirmedJob(title: string) {
  const [ana, roberto] = await Promise.all([actor("ana"), actor("roberto")]);
  const pid = await providerId("Servicios Integrales Norte");
  const reqId = await requests.createRequest(ana, {
    propertyId: await propertyOf("ana", "Casa"), categoryId: await catId("plomeria"), title, description: "Pierde agua la canilla de la cocina.",
    answers: {}, urgency: "normal", preferredWindows: [],
  });
  const q = await simpleQuote(roberto, await invitationFor(reqId, pid), 2_000_000);
  const { jobId } = await quotes.acceptQuote(ana, q, { totalMinor: await totalOf(q), acceptedTerms: true });
  await payPending(jobId);
  await jobs.confirmJob(roberto, jobId);
  return { roberto, pid, jobId };
}

describe("fotos, archivos y redes del profesional", () => {
  it("redes públicas validadas y visibles en el perfil", async () => {
    const lucia = await actor("lucia");
    const [p] = await sql()<{ id: string; slug: string }[]>`select p.id, p.slug from providers p join provider_members m on m.provider_id = p.id where m.user_id = ${lucia.id} and m.role = 'admin' limit 1`;
    await expect(updateSocialLinks(lucia, p.id, { website: "https://wa.me/5491100000000" })).rejects.toThrow(/permitido/);
    await expect(updateSocialLinks(await actor("roberto"), p.id, { instagram: "@otro" })).rejects.toThrow();
    await updateSocialLinks(lucia, p.id, { instagram: "@sosa.trabajos", website: "sosa.com.ar" });
    const pub = await getPublicProfile(p.slug);
    expect(pub?.provider.social_links).toEqual({ instagram: "https://www.instagram.com/sosa.trabajos", website: "https://sosa.com.ar/" });
  });

  it("portfolio: varias fotos y un PDF de una vez, públicos", async () => {
    const lucia = await actor("lucia");
    const [p] = await sql()<{ id: string; slug: string }[]>`select p.id, p.slug from providers p join provider_members m on m.provider_id = p.id where m.user_id = ${lucia.id} and m.role = 'admin' limit 1`;
    await sql()`delete from provider_portfolio where provider_id = ${p.id}`;
    await addPortfolioItems(lucia, p.id, [{ data: jpeg(), name: "a.jpg" }, { data: jpeg(), name: "b.jpg" }, { data: pdf(), name: "catalogo.pdf" }], "Baño completo");
    const pub = await getPublicProfile(p.slug);
    expect(pub?.portfolio).toHaveLength(3);
    expect(pub?.portfolio.filter((x) => x.isPdf)).toHaveLength(1);
    await expect(addPortfolioItems(lucia, p.id, Array.from({ length: 18 }, () => ({ data: jpeg(), name: "x.jpg" })), "")).rejects.toThrow(/hasta 20/);
  });

  it("avances: varias fotos de una vez desde la web y por WhatsApp", async () => {
    const { roberto, jobId } = await confirmedJob("Fotos del trabajo");
    await jobs.addEvidenceBatch(roberto, jobId, { kind: "before", note: "Así estaba" }, [{ data: jpeg(), name: "1.jpg" }, { data: jpeg(), name: "2.jpg" }]);
    let ev = await sql()<{ kind: string; note: string }[]>`select kind, note from job_evidence where job_id = ${jobId} order by created_at`;
    expect(ev).toHaveLength(2);
    expect(ev[0].note).toBe("Así estaba");

    // WhatsApp: el profesional (número vinculado) manda fotos, elige el trabajo y el momento.
    const phone = `54911${String(Date.now()).slice(-8)}`;
    const before = (await sql()<{ whatsapp_phone: string | null }[]>`select whatsapp_phone from users where id = ${roberto.id}`)[0].whatsapp_phone;
    await sql()`update users set whatsapp_phone = ${phone} where id = ${roberto.id}`;
    try {
      const send = async (m: Partial<Inbound>) => handleInbound({ id: `wamid.ev.${Date.now()}.${seq++}`, from: phone, type: "text", ...m });
      const photo = async () => {
        const fileId = await storeFile(sql(), { data: jpeg(), originalName: "wa.jpg", uploadedBy: roberto.id, purpose: "request_photo", ownerType: null, ownerId: null, allowPdf: false });
        await sql()`insert into whatsapp_media (phone, file_id) values (${phone}, ${fileId})`;
        return fileId;
      };
      await send({ type: "image", fileId: await photo() });
      const [state] = await sql()<{ state: { step: string; evJobId?: string } }[]>`select state from whatsapp_conversations where phone = ${phone}`;
      if (state.state.step === "evidence_job") await send({ type: "interactive", replyId: `evj:${jobId}` });
      await send({ type: "interactive", replyId: "evk:after" });
      await send({ type: "image", fileId: await photo() }); // sigue al mismo trabajo
      ev = await sql()<{ kind: string; note: string }[]>`select kind, note from job_evidence where job_id = ${jobId} and kind = 'after'`;
      expect(ev).toHaveLength(2);
    } finally {
      await sql()`update users set whatsapp_phone = ${before} where id = ${roberto.id}`;
    }
  });
});
