import { it, expect } from "vitest";
import { triageByRules } from "@/server/assistant/rules";
const cases: [string, string][] = [
  ["Necesito un fumigador, hay cucarachas en la cocina", "fumigacion"], ["quiero un piletero para mantener la pileta, el agua está verde", "piletas"],
  ["se tapó la pileta de la cocina", "plomeria"], ["necesito un jardinero para cortar el pasto y podar el cerco", "jardineria"],
  ["busco paisajista para diseñar el jardín", "jardineria"], ["necesito un decorador de interiores para el living", "decoracion"],
  ["busco arquitecto para hacer los planos de una ampliación", "arquitectura"], ["necesito alquilar un volquete para sacar escombros", "volquetes"],
  ["tengo goteras en el techo, hay que cambiar la membrana", "techos"], ["quiero poner cámaras de seguridad y alarma", "seguridad"],
  ["se rompió el vidrio de la ventana", "vidrieria"], ["necesito un herrero para hacer una reja", "herreria"],
  ["quiero instalar un termotanque solar", "energia-solar"], ["mudanza de un 2 ambientes a Belgrano", "mudanzas"],
  ["no funciona la caldera y los radiadores están fríos", "calefaccion"], ["pierde agua la canilla de la cocina", "plomeria"],
  ["saltó la térmica y no vuelve", "electricidad"], ["el aire acondicionado no enfría", "climatizacion"], ["quiero reformar el baño completo", "reformas"],
  ["hay que limpiar el tanque de agua del edificio", "fumigacion"], ["se cortó la cinta de la persiana", "cortinas"], ["quiero colgar la tele en la pared", "tv-audio"],
  ["pulido y plastificado de pisos de parquet", "pisos"], ["hacer una pared de durlock para dividir el living", "durlock"], ["quiero cambiar la mesada de la cocina por granito", "marmoleria"],
];
it.each(cases)("%s → %s", (text, cat) => { const r = triageByRules(text); expect(r.categorySlug ?? `null (${JSON.stringify(r.alternatives)})`).toBe(cat); });
