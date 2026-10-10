"use client";
/* eslint-disable react-hooks/immutability -- Three.js: en cada cuadro se mutan a propósito objetos de refs (posición, rig), fuera del render de React. */

/**
 * Escenario de Fixy: una capa fija sobre la página donde Fixy (3D) camina hacia el "lugar" de la sección
 * que se está viendo (elementos con data-fixy), hace la acción de esa sección, habla con globitos,
 * mira el cursor, señala lo que se marca y salta si lo tocan.
 * Si la persona prefiere menos movimiento o no hay WebGL, no se monta y quedan las ilustraciones fijas.
 */
import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type * as THREE from "three";
import { FixyModel, newRig, type FixyAction, type Rig } from "./model";
import { onFixy } from "./events";

const MODEL_HEIGHT = 1.42; // alto del modelo (zapatillas → mechón) en unidades
const MOBILE = 768;

const LINES = [
  "¡Hey! Eso hace cosquillas.",
  "¿Se rompió algo? Yo te ayudo.",
  "Plomería, electricidad, gas… ¡y obras!",
  "Tu dirección la cuido yo.",
  "Nada se cobra sin tu OK.",
  "¿Sabías que podés decir cuánto querés pagar?",
];

type Shared = {
  anchor: HTMLElement | null;
  pointer: { x: number; y: number } | null;
  look: { x: number; y: number; until: number } | null;
  act: { action: FixyAction; until: number } | null;
  jump: boolean;
  pos: { x: number; y: number; size: number; init: boolean };
};

function pickAnchor(anchors: HTMLElement[]): HTMLElement | null {
  const h = window.innerHeight;
  let best: { el: HTMLElement; size: number } | null = null;
  let nearest: { el: HTMLElement; d: number } | null = null;
  for (const el of anchors) {
    const scope = (el.closest("[data-fixy-scope]") as HTMLElement | null) ?? el.parentElement ?? el;
    const r = scope.getBoundingClientRect();
    if (r.top <= h * 0.55 && r.bottom >= h * 0.4) {
      if (!best || r.height < best.size) best = { el, size: r.height };
    }
    const d = Math.min(Math.abs(r.top - h / 2), Math.abs(r.bottom - h / 2));
    if (!nearest || d < nearest.d) nearest = { el, d };
  }
  return best?.el ?? nearest?.el ?? null;
}

/** Corre dentro del Canvas: calcula destino, mueve a Fixy y sincroniza el globito y el botón. */
function Driver({ shared, rig, follower }: { shared: React.RefObject<Shared>; rig: React.RefObject<Rig>; follower: React.RefObject<HTMLDivElement | null> }) {
  const group = useRef<THREE.Group>(null!);
  const { size: canvas, clock } = useThree();

  useFrame((_, dtRaw) => {
    const s = shared.current;
    const r = rig.current;
    if (!s || !r) return;
    if (!(dtRaw > 0)) return;
    const dt = Math.min(dtRaw, 0.05);
    const W = canvas.width;
    const H = canvas.height;
    const mobile = W < MOBILE;
    const a = s.anchor;
    if (!a) return;

    // Destino: pie de Fixy en el borde inferior del lugar de la sección (o en la esquina, en el celular).
    const rect = a.getBoundingClientRect();
    const inline = a.dataset.fixyMobile === "inline";
    let size = Number(a.dataset.fixySize || rect.height || 200);
    let tx = rect.left + rect.width / 2;
    let ty = rect.bottom;
    // Si su lugar no está a la vista (o en el celular), acompaña desde la esquina inferior izquierda, más chico.
    const visible = rect.bottom >= size + 70 && rect.top < H - 60;
    let peek = false;
    if ((mobile && !inline) || !visible) {
      size = mobile ? 96 : 120;
      // Con margen libre a la izquierda, se para ahí; si no, se asoma desde el borde sin tapar contenido.
      const gutter = (W - Math.min(W, 1152)) / 2;
      peek = gutter < size * 0.9;
      tx = peek ? size * 0.12 : gutter / 2;
      ty = H - 10;
    } else if (mobile) {
      size = Math.min(size, 190);
    }
    if (!peek) tx = Math.min(Math.max(tx, size * 0.45 + 8), W - size * 0.45 - 8);
    ty = Math.min(Math.max(ty, Math.max(size, s.pos.size) + 76), H - 6);

    const p = s.pos;
    if (!p.init) Object.assign(p, { x: tx, y: ty, size, init: true });
    // Horizontal: camina a velocidad limitada (se ve el ciclo de pasos). Vertical: acompaña el scroll.
    const dx = tx - p.x;
    const maxStep = Math.min(Math.abs(dx), Math.max(120, Math.abs(dx) * 4) * dt, 760 * dt);
    const nx = p.x + Math.sign(dx) * maxStep;
    const ny = p.y + (ty - p.y) * (1 - Math.exp(-12 * dt));
    r.vx = Number.isFinite(nx - p.x) ? (nx - p.x) / dt : 0;
    r.vy = Number.isFinite(ny - p.y) ? (ny - p.y) / dt : 0;
    p.x = nx;
    p.y = ny;
    p.size += (size - p.size) * (1 - Math.exp(-6 * dt));

    // Acción: la de la sección, salvo que algo la pise un rato (escribir, señalar…).
    const now = clock.elapsedTime;
    const perf = performance.now();
    const look = s.look && s.look.until > perf ? s.look : null;
    const act = s.act && s.act.until > perf ? s.act : null;
    r.action = (look ? "point" : act?.action ?? (a.dataset.fixyAction as FixyAction) ?? "idle");
    if (s.jump) { r.jumpAt = now; s.jump = false; }

    // Mirada: hacia lo señalado o hacia el cursor.
    const headX = p.x;
    const headY = p.y - p.size * 0.6;
    const target = look ?? s.pointer;
    if (target) {
      const ddx = target.x - headX;
      const ddy = target.y - headY;
      r.lookX = Math.max(-1, Math.min(1, ddx / 320));
      r.lookY = Math.max(-1, Math.min(1, -ddy / 320));
      r.pointAngle = Math.atan2(-ddy, ddx);
    } else {
      r.lookX *= 0.95;
      r.lookY *= 0.95;
    }

    // Ubicación del modelo (cámara ortográfica: 1 unidad = 1 px, origen al centro).
    group.current.position.set(p.x - W / 2, H / 2 - p.y, 0);
    group.current.scale.setScalar(p.size / MODEL_HEIGHT);

    // Globito y botón que acompañan a Fixy.
    const f = follower.current;
    if (f) {
      f.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      f.style.setProperty("--fixy-size", `${p.size}px`);
      const bubbleShift = p.x > W - 180 ? -(p.x - (W - 180)) : p.x < 180 ? 180 - p.x : 0;
      f.style.setProperty("--bubble-shift", `${bubbleShift}px`);
    }
  });

  return (
    <group ref={group} rotation={[0.1, 0, 0]}>
      <FixyModel rig={rig} />
    </group>
  );
}

export default function FixyStage() {
  const [on, setOn] = useState(false);
  const [bubble, setBubble] = useState<{ text: string; key: number } | null>(null);
  const rig = useRef<Rig>(newRig());
  const follower = useRef<HTMLDivElement>(null);
  const shared = useRef<Shared>({ anchor: null, pointer: null, look: null, act: null, jump: false, pos: { x: 0, y: 0, size: 200, init: false } });
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = (text: string, ms = 3800) => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    setBubble({ text, key: performance.now() });
    bubbleTimer.current = setTimeout(() => setBubble(null), ms);
  };

  // Solo con movimiento permitido y WebGL disponible.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gl = (() => { try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; } })();
    // Se decide después de montar: en el servidor no hay ventana ni WebGL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!reduce && gl) setOn(true);
  }, []);

  useEffect(() => {
    if (!on) return;
    const anchors = Array.from(document.querySelectorAll<HTMLElement>("[data-fixy]"));
    let raf = 0;
    let last: HTMLElement | null = null;
    const update = () => {
      raf = 0;
      const a = pickAnchor(anchors);
      shared.current.anchor = a;
      if (a && a !== last) {
        last = a;
        if (a.dataset.fixySay) say(a.dataset.fixySay);
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    const onMove = (e: PointerEvent) => { shared.current.pointer = { x: e.clientX, y: e.clientY }; };
    const onLeave = () => { shared.current.pointer = null; };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    const off = onFixy((e) => {
      const s = shared.current;
      if (e.type === "say") say(e.text, e.ms);
      if (e.type === "look") { s.look = { x: e.x, y: e.y, until: performance.now() + 2500 }; if (e.label) say(e.label, 2200); }
      if (e.type === "unlook") s.look = null;
      if (e.type === "act") s.act = { action: e.action, until: performance.now() + (e.ms ?? 2500) };
      if (e.type === "jump") s.jump = true;
    });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      off();
      if (raf) cancelAnimationFrame(raf);
      delete document.documentElement.dataset.fixy3d;
    };
  }, [on]);

  if (!on) return null;

  const poke = () => {
    shared.current.jump = true;
    say(LINES[Math.floor(Math.random() * LINES.length)], 3000);
  };

  return (
    <>
      <Canvas
        orthographic
        flat
        camera={{ position: [0, 0, 1000], zoom: 1, near: 1, far: 4000 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
        onCreated={() => { document.documentElement.dataset.fixy3d = "on"; }}
        style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 30 }}
        aria-hidden
        className="print:hidden"
      >
        <ambientLight intensity={0.5} />
        <hemisphereLight args={["#ffffff", "#9fd8cd", 0.55]} />
        <directionalLight position={[-400, 700, 900]} intensity={1.35} />
        <directionalLight position={[600, 100, 400]} intensity={0.35} color="#ffe2c4" />
        <Driver shared={shared} rig={rig} follower={follower} />
      </Canvas>

      {/* Acompaña a Fixy: globito de diálogo y zona para tocarlo */}
      <div ref={follower} className="pointer-events-none fixed left-0 top-0 z-30 print:hidden" style={{ willChange: "transform" }}>
        <button
          type="button"
          onClick={poke}
          aria-label="Saludar a Fixy"
          className="pointer-events-auto absolute -translate-x-1/2 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-fixy-500/50"
          style={{ width: "calc(var(--fixy-size) * 0.62)", height: "calc(var(--fixy-size) * 0.9)", top: "calc(var(--fixy-size) * -0.92)" }}
        />
        {bubble && (
          <p
            key={bubble.key}
            role="status"
            className="fixy-bubble absolute w-max max-w-[15rem] rounded-2xl bg-white px-4 py-2.5 text-[15px] font-semibold leading-snug text-ink shadow-[var(--shadow-lift)] ring-1 ring-line"
            style={{ left: "var(--bubble-shift)", bottom: "calc(var(--fixy-size) * 1.02)", transform: "translateX(-50%)" }}
          >
            {bubble.text}
          </p>
        )}
      </div>
    </>
  );
}
