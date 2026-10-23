import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { pickUtm, readSignupCookie } from "@/lib/signup-origin";

describe("CSV", () => {
  it("lee comillas, saltos de línea dentro de una celda y el punto y coma de Excel", () => {
    expect(parseCsv('ID,Nombre\r\nFX-001,"Plomería ""El Tano"", SRL"\nFX-002,"Dos\nlíneas"\n\n')).toEqual([["ID", "Nombre"], ["FX-001", 'Plomería "El Tano", SRL'], ["FX-002", "Dos\nlíneas"]]);
    expect(parseCsv("﻿ID;Nombre;Oficio\nFX-003;Pinturas Sur;pintor")).toEqual([["ID", "Nombre", "Oficio"], ["FX-003", "Pinturas Sur", "pintor"]]);
  });
});

describe("origen del alta", () => {
  it("toma solo los parámetros de campaña conocidos y los limpia", () => {
    expect(pickUtm(new URLSearchParams("utm_source=meta&utm_campaign=plomeros<script>&otro=x&utm_medium="))).toEqual({ utm_source: "meta", utm_campaign: "plomerosscript" });
    expect(pickUtm({ utm_source: ["google", "x"], gclid: "abc-123" })).toEqual({ utm_source: "google", gclid: "abc-123" });
  });
  it("lee la cookie con o sin campaña, y tolera basura", () => {
    expect(readSignupCookie(JSON.stringify({ origen: "sumate-plomero", ref: "fx-012", utm: { utm_source: "meta", evil: "x" }, oficio: "plomeria" })))
      .toEqual({ source: "sumate-plomero", referrerSlug: "fx-012", utm: { utm_source: "meta" }, oficio: "plomeria", zona: undefined });
    expect(readSignupCookie("no-es-json")).toEqual({});
    expect(readSignupCookie(undefined)).toEqual({ source: undefined, referrerSlug: undefined, utm: {}, oficio: undefined, zona: undefined });
  });
});
