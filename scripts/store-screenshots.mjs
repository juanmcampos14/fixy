import { chromium } from "playwright-core";
const OUT = process.argv[2];
const BASE = "http://localhost:3000";
const SIZES = { ios: { width: 440, height: 956, scale: 3 }, android: { width: 360, height: 640, scale: 3 } };
const browser = await chromium.launch({ channel: "chrome", headless: true });

// Saca las marcas de demostración y el indicador de desarrollo: las capturas muestran la app como la ve un cliente.
const clean = async (page) => page.evaluate(() => {
  document.querySelectorAll("nextjs-portal, [data-nextjs-toast]").forEach((n) => n.remove());
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode()); ) if (/\(demo\)/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/\s*\(demo\)/g, "");
  document.querySelectorAll("span").forEach((s) => { if (/^(Demostración|Modo de prueba)$/.test(s.textContent.trim())) s.remove(); });
});
const login = async (page, name) => {
  await page.goto(`${BASE}/ingresar`);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForURL(/\/(app|proveedor|admin)/);
};
const firstLink = async (page, listUrl, re) => {
  await page.goto(`${BASE}${listUrl}`);
  const hrefs = await page.$$eval("a", (as) => as.map((a) => a.getAttribute("href")));
  return hrefs.find((h) => h && re.test(h));
};

for (const [os, v] of Object.entries(SIZES)) {
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.scale, isMobile: true, hasTouch: true, locale: "es-AR", userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36 FixyApp/1.0" });
  const page = await ctx.newPage();
  const shot = async (n) => { await clean(page); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${os}-${n}.png` }); console.log(os, n, page.url()); };

  await page.goto(BASE); await page.waitForTimeout(3500); await shot("1-inicio");

  await page.goto(`${BASE}/solicitar`);
  const box = page.locator("textarea").first();
  await box.fill("Pierde agua la canilla de la cocina, gotea todo el día");
  await box.press("Enter").catch(() => null);
  await page.waitForTimeout(6000); await shot("2-pedido");

  await login(page, "Ana Gómez");
  await page.goto(`${BASE}/app`); await page.waitForTimeout(1200); await shot("3-panel");
  const req = await firstLink(page, "/app/solicitudes", /^\/app\/solicitudes\/[0-9a-f-]{36}/);
  const reqs = await page.$$eval("a", (as) => as.map((a) => [a.getAttribute("href"), a.textContent]).filter(([h, t]) => /^\/app\/solicitudes\/[0-9a-f-]{36}/.test(h || "") && /presupuesto/i.test(t || "")));
  await page.goto(`${BASE}${reqs[0]?.[0] ?? req}`); await page.waitForTimeout(1200); await shot("4-presupuestos");
  const job = await firstLink(page, "/app/trabajos", /^\/app\/trabajos\/[0-9a-f-]{36}/);
  if (job) { await page.goto(`${BASE}${job}`); await page.waitForTimeout(1200); await shot("5-trabajo"); }

  await ctx.clearCookies();
  await login(page, "Martín López");
  await page.goto(`${BASE}/proveedor`); await page.waitForTimeout(1200); await shot("6-profesional");
  await ctx.close();
}
await browser.close();
