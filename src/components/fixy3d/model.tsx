"use client";

/**
 * Fixy en 3D, construido con código (sin modelos externos): cuerpo hexagonal de "plastilina", mechón naranja,
 * ojos, cejas, boca, brazos, piernas y accesorios. Se anima a mano en cada cuadro según `rig`
 * (acción, mirada, caminata, salto), que controla el escenario (stage.tsx).
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type FixyAction =
  | "idle" | "wave" | "point" | "think" | "celebrate" | "listen" | "sleep"
  | "hardhat" | "search" | "sign" | "coins" | "thumbs";

export type Rig = {
  action: FixyAction;
  /** Hacia dónde mira, normalizado (-1..1) respecto de su cabeza. */
  lookX: number;
  lookY: number;
  /** Velocidad horizontal en px/s (para el ciclo de caminata) y vertical. */
  vx: number;
  vy: number;
  /** Instante (s) del último salto pedido. */
  jumpAt: number;
  /** Ángulo (rad) hacia el que apunta con el brazo en "point". */
  pointAngle: number;
};

export const newRig = (): Rig => ({ action: "wave", lookX: 0, lookY: 0, vx: 0, vy: 0, jumpAt: -10, pointAngle: 0.6 });

// Colores de la marca (aprox. al render de la mascota)
const TEAL = "#33b8a5";
const TEAL_DARK = "#2aa594";
const ORANGE = "#f59a3c";
const NAVY = "#1d2c42";
const INK = "#10222c";
const YELLOW = "#f7c843";

const clay = (color: string, roughness = 0.82) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });

/** Hexágono "con la punta arriba" y esquinas redondeadas, extruido con bisel suave (look plastilina). */
function bodyGeometry() {
  const R = 0.5;
  const r = 0.13;
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI / 2 + (i * Math.PI) / 3;
    return new THREE.Vector2(Math.cos(a) * R, Math.sin(a) * R);
  });
  const shape = new THREE.Shape();
  pts.forEach((p, i) => {
    const prev = pts[(i + 5) % 6];
    const next = pts[(i + 1) % 6];
    const a = p.clone().add(prev.clone().sub(p).setLength(r));
    const b = p.clone().add(next.clone().sub(p).setLength(r));
    if (i === 0) shape.moveTo(a.x, a.y);
    else shape.lineTo(a.x, a.y);
    shape.quadraticCurveTo(p.x, p.y, b.x, b.y);
  });
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.11, bevelSegments: 10, curveSegments: 28 });
  g.center();
  g.computeVertexNormals();
  return g;
}

/** Arco fino (cejas y sonrisa). */
function arcGeometry(width: number, depth: number, thickness: number, up: boolean) {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-width / 2, 0, 0),
    new THREE.Vector3(0, up ? depth : -depth, 0),
    new THREE.Vector3(width / 2, 0, 0),
  );
  return new THREE.TubeGeometry(curve, 20, thickness, 8, false);
}

/** Gota del mechón. */
function tuftGeometry() {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const y = t * 0.22;
    const x = Math.pow(Math.sin(Math.PI * t), 0.8) * 0.095 * (1 - t * 0.45);
    pts.push(new THREE.Vector2(Math.max(0.001, x), y));
  }
  return new THREE.LatheGeometry(pts, 24);
}

/** Cartel con "$" para la sección de presupuesto. */
function signTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 180;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 256, 180);
  g.fillStyle = "#0f5f56";
  g.font = "800 120px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("$", 128, 96);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const damp = (cur: number, target: number, lambda: number, dt: number) => THREE.MathUtils.damp(cur, target, lambda, dt);

export function FixyModel({ rig }: { rig: React.RefObject<Rig> }) {
  const root = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const face = useRef<THREE.Group>(null!);
  const eyes = useRef<THREE.Group>(null!);
  const eyeL = useRef<THREE.Group>(null!);
  const eyeR = useRef<THREE.Group>(null!);
  const browL = useRef<THREE.Mesh>(null!);
  const browR = useRef<THREE.Mesh>(null!);
  const smile = useRef<THREE.Mesh>(null!);
  const open = useRef<THREE.Group>(null!);
  const tuft = useRef<THREE.Group>(null!);
  const armL = useRef<THREE.Group>(null!);
  const armR = useRef<THREE.Group>(null!);
  const legL = useRef<THREE.Group>(null!);
  const legR = useRef<THREE.Group>(null!);
  const hat = useRef<THREE.Group>(null!);
  const glass = useRef<THREE.Group>(null!);
  const sign = useRef<THREE.Group>(null!);
  const coins = useRef<THREE.Group>(null!);
  const blink = useRef({ next: 2, until: 0 });
  const walkPhase = useRef(0);

  const g = useMemo(() => ({
    body: bodyGeometry(),
    eye: new THREE.SphereGeometry(0.072, 24, 24),
    shine: new THREE.SphereGeometry(0.019, 12, 12),
    brow: arcGeometry(0.12, 0.03, 0.012, true),
    smile: arcGeometry(0.16, 0.06, 0.016, false),
    tuft: tuftGeometry(),
    arm: new THREE.CapsuleGeometry(0.072, 0.26, 8, 16),
    hand: new THREE.SphereGeometry(0.098, 20, 20),
    thumb: new THREE.SphereGeometry(0.042, 12, 12),
    leg: new THREE.CapsuleGeometry(0.075, 0.1, 8, 16),
    shoe: new THREE.SphereGeometry(0.11, 20, 20),
    mouth: new THREE.CircleGeometry(0.075, 24, Math.PI, Math.PI),
    tongue: new THREE.CircleGeometry(0.042, 20, Math.PI, Math.PI),
    hatDome: new THREE.SphereGeometry(0.36, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    hatBrim: new THREE.CylinderGeometry(0.43, 0.43, 0.035, 40),
    hatRidge: new THREE.BoxGeometry(0.07, 0.07, 0.62),
    ring: new THREE.TorusGeometry(0.11, 0.022, 12, 32),
    lens: new THREE.CircleGeometry(0.1, 24),
    handle: new THREE.CylinderGeometry(0.022, 0.026, 0.2, 12),
    board: new THREE.BoxGeometry(0.46, 0.32, 0.03),
    stick: new THREE.CylinderGeometry(0.018, 0.018, 0.3, 10),
    coin: new THREE.CylinderGeometry(0.075, 0.075, 0.022, 24),
  }), []);

  const m = useMemo(() => ({
    body: clay(TEAL),
    limb: clay(TEAL_DARK, 0.85),
    eye: new THREE.MeshStandardMaterial({ color: INK, roughness: 0.35 }),
    white: new THREE.MeshBasicMaterial({ color: "#ffffff" }),
    ink: new THREE.MeshStandardMaterial({ color: INK, roughness: 0.5 }),
    tuft: clay(ORANGE, 0.7),
    shoe: clay(NAVY, 0.7),
    mouth: new THREE.MeshBasicMaterial({ color: "#5b1f24" }),
    tongue: new THREE.MeshBasicMaterial({ color: "#f27b5b" }),
    hat: new THREE.MeshStandardMaterial({ color: YELLOW, roughness: 0.45 }),
    metal: new THREE.MeshStandardMaterial({ color: "#6b7a86", roughness: 0.35, metalness: 0.6 }),
    lens: new THREE.MeshStandardMaterial({ color: "#cfeff0", roughness: 0.05, transparent: true, opacity: 0.45 }),
    wood: clay("#a8693a", 0.8),
    sign: new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.9 }),
    gold: new THREE.MeshStandardMaterial({ color: "#f2c14e", roughness: 0.3, metalness: 0.7 }),
  }), []);

  useFrame((state, dt) => {
    const r = rig.current;
    if (!r) return;
    const t = state.clock.elapsedTime;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    const a = r.action;
    const speed = Number.isFinite(r.vx) ? Math.min(1, Math.abs(r.vx) / 500) : 0;
    const walking = speed > 0.06;

    // ── Caminata: fase según la velocidad ──
    walkPhase.current += dt * (6 + speed * 8) * (walking ? 1 : 0);
    const w = walkPhase.current;

    // ── Salto (al tocarlo o al festejar) ──
    const jt = t - r.jumpAt;
    const jumping = jt >= 0 && jt < 0.6;
    const hopPeriod = 0.62;
    const hop = a === "celebrate" ? Math.max(0, Math.sin((t % hopPeriod) / hopPeriod * Math.PI)) * 0.16 : 0;
    const jump = jumping ? Math.sin((jt / 0.6) * Math.PI) * 0.42 : 0;
    const landing = jt >= 0.6 && jt < 0.78 ? Math.sin(((jt - 0.6) / 0.18) * Math.PI) : 0;

    // ── Cuerpo: respiración, rebote al caminar, aplastar y estirar ──
    const breathe = a === "sleep" ? Math.sin(t * 1.6) * 0.03 : Math.sin(t * 2.2) * 0.012;
    const bob = walking ? Math.abs(Math.sin(w)) * 0.06 * speed : 0;
    const stretchV = Number.isFinite(r.vy) ? THREE.MathUtils.clamp(-r.vy / 2500, -0.08, 0.1) : 0;
    const squash = landing * 0.12;
    body.current.position.y = 0.78 + bob + jump + hop;
    body.current.scale.set(1 + squash * 0.8 - stretchV * 0.4, 1 + breathe - squash + stretchV, 1 + squash * 0.5);
    const lean = a === "listen" ? 0.12 * Math.sign(r.lookX || 1) : a === "think" ? -0.06 : a === "sleep" ? 0.14 : 0;
    body.current.rotation.z = damp(body.current.rotation.z, (walking ? -Math.sign(r.vx) * 0.07 * speed : 0) - lean + (walking ? Math.sin(w) * 0.04 : 0), 8, dt);

    // Gira hacia donde camina; si no, un poco hacia lo que mira.
    const faceTarget = walking ? Math.sign(r.vx) * 0.75 : THREE.MathUtils.clamp(r.lookX, -1, 1) * 0.35 - 0.12;
    root.current.rotation.y = damp(root.current.rotation.y, faceTarget, 6, dt);
    body.current.rotation.x = damp(body.current.rotation.x, -THREE.MathUtils.clamp(r.lookY, -1, 1) * 0.12 + (a === "sleep" ? 0.12 : 0), 6, dt);

    // ── Ojos: miran el cursor, parpadean, felices o dormidos ──
    const b = blink.current;
    if (t > b.next) { b.until = t + 0.12; b.next = t + 2.2 + Math.random() * 3.5; }
    const blinking = t < b.until;
    const happy = a === "celebrate" || a === "thumbs";
    const eyeScaleY = a === "sleep" ? 0.1 : blinking ? 0.12 : happy ? 0.45 : 1.25;
    for (const e of [eyeL.current, eyeR.current]) e.scale.y = damp(e.scale.y, eyeScaleY, 18, dt);
    const lx = THREE.MathUtils.clamp(r.lookX, -1, 1) * 0.035;
    const ly = (a === "think" ? 0.03 : THREE.MathUtils.clamp(r.lookY, -1, 1) * 0.03);
    eyes.current.position.x = damp(eyes.current.position.x, lx, 10, dt);
    eyes.current.position.y = damp(eyes.current.position.y, ly, 10, dt);

    // Cejas: arriba si piensa o escucha; relajadas si duerme.
    const browY = a === "think" || a === "listen" ? 0.2 : a === "sleep" ? 0.15 : 0.175;
    browL.current.position.y = damp(browL.current.position.y, browY + (a === "think" ? 0.015 : 0), 10, dt);
    browR.current.position.y = damp(browR.current.position.y, browY, 10, dt);
    browL.current.rotation.z = damp(browL.current.rotation.z, a === "think" ? 0.25 : 0.12, 10, dt);
    browR.current.rotation.z = damp(browR.current.rotation.z, a === "think" ? -0.05 : -0.12, 10, dt);

    // Boca: sonrisa, abierta al festejar/saltar/saludar, chiquita al pensar o dormir.
    const openMouth = happy || jumping || a === "wave" && Math.sin(t * 1.3) > 0.4;
    open.current.visible = openMouth;
    smile.current.visible = !openMouth;
    smile.current.scale.x = damp(smile.current.scale.x, a === "think" || a === "sleep" ? 0.45 : a === "search" ? 0.6 : 1, 10, dt);

    // Mechón: se bambolea (más al caminar o saltar).
    tuft.current.rotation.z = -0.35 + Math.sin(t * 3 + 1) * 0.06 + (walking ? Math.sin(w * 2) * 0.12 : 0) - jump * 0.6;
    tuft.current.visible = a !== "hardhat";

    // ── Brazos ── ángulo "hacia afuera" (0 = colgando, π/2 = horizontal, π = arriba; negativo = cruza por delante)
    let lOut = 0.16, rOut = 0.16, lFwd = 0, rFwd = 0;
    const swing = walking ? Math.sin(w) * 0.7 * speed : Math.sin(t * 2) * 0.04;
    switch (a) {
      case "wave": rOut = 2.5 + Math.sin(t * 9) * 0.32; lOut = 0.2; break;
      case "point": {
        const ang = THREE.MathUtils.clamp(r.pointAngle, -Math.PI, Math.PI);
        const right = Math.cos(ang) >= 0;
        if (right) rOut = THREE.MathUtils.clamp(ang + Math.PI / 2, 0.4, 2.9);
        else lOut = THREE.MathUtils.clamp(Math.atan2(-Math.cos(ang), -Math.sin(ang)), 0.4, 2.9);
        break;
      }
      case "think": rOut = -2.45; rFwd = -0.9; lOut = 0.3; break;
      case "celebrate": lOut = 2.6 + Math.sin(t * 10) * 0.18; rOut = 2.6 + Math.sin(t * 10 + 1) * 0.18; break;
      case "listen": rOut = 2.75; rFwd = -0.3; lOut = 0.25; break;
      case "sleep": lOut = 0.06; rOut = 0.06; break;
      case "hardhat": rOut = 1.15 + Math.sin(t * 2.5) * 0.08; lOut = 0.22; break;
      case "thumbs": rOut = 1.2 + Math.sin(t * 4) * 0.1; lOut = 0.2; break;
      case "search": rOut = 1.5 + Math.sin(t * 2.2) * 0.25; rFwd = -0.5; lOut = 0.2; break;
      case "sign": lOut = 2.6; rOut = 2.6; break;
      case "coins": lOut = 1.0 + Math.sin(t * 7) * 0.35; rOut = 1.0 + Math.sin(t * 7 + Math.PI) * 0.35; break;
    }
    if (walking && !["wave", "sign", "celebrate", "point"].includes(a)) { lOut = 0.22; rOut = 0.22; lFwd = swing; rFwd = -swing; }
    if (jumping) { lOut = Math.max(lOut, 2.3); rOut = Math.max(rOut, 2.3); }
    armL.current.rotation.z = damp(armL.current.rotation.z, -lOut, 12, dt);
    armR.current.rotation.z = damp(armR.current.rotation.z, rOut, 12, dt);
    armL.current.rotation.x = damp(armL.current.rotation.x, lFwd, 10, dt);
    armR.current.rotation.x = damp(armR.current.rotation.x, rFwd, 10, dt);

    // ── Piernas: ciclo de caminata, encogidas en el aire ──
    const stepL = walking ? Math.max(0, Math.sin(w)) * 0.09 * speed : 0;
    const stepR = walking ? Math.max(0, -Math.sin(w)) * 0.09 * speed : 0;
    const tuck = jumping ? Math.sin((jt / 0.6) * Math.PI) * 0.08 : 0;
    const celebrateKick = a === "celebrate" ? Math.max(0, Math.sin((t % hopPeriod) / hopPeriod * Math.PI)) * 0.06 : 0;
    legL.current.position.y = 0.3 + stepL + tuck + celebrateKick;
    legR.current.position.y = 0.3 + stepR + tuck;
    legL.current.rotation.z = walking ? Math.sin(w) * 0.25 * speed : 0;
    legR.current.rotation.z = walking ? Math.sin(w) * 0.25 * speed : 0;
    // El cuerpo vuela con el salto; las piernas lo acompañan.
    legL.current.position.y += jump + hop;
    legR.current.position.y += jump + hop;

    // ── Accesorios ──
    hat.current.visible = a === "hardhat";
    glass.current.visible = a === "search";
    sign.current.visible = a === "sign";
    coins.current.visible = a === "coins";
    if (a === "coins") {
      coins.current.children.forEach((c, i) => {
        const p = (t * 1.6 + i / 3) % 1;
        c.position.set(Math.cos(p * Math.PI) * 0.42, 0.55 + Math.sin(p * Math.PI) * 0.55, 0.25);
        c.rotation.x = t * 6 + i;
      });
    }
    if (a === "sign") sign.current.position.y = 0.98 + Math.sin(t * 3) * 0.03;
  });

  return (
    <group ref={root}>
      {/* Sombra suave en el piso */}
      <mesh position={[0, 0.01, -0.35]} scale={[1, 0.16, 1]}>
        <circleGeometry args={[0.4, 40]} />
        <meshBasicMaterial color="#0e2a33" transparent opacity={0.13} depthWrite={false} />
      </mesh>

      {/* Piernas y zapatillas */}
      {([-0.13, 0.13] as const).map((x, i) => (
        <group key={x} ref={i === 0 ? legL : legR} position={[x, 0.3, 0]}>
          <mesh geometry={g.leg} material={m.limb} position={[0, -0.04, 0]} />
          <mesh geometry={g.shoe} material={m.shoe} position={[x * 0.25, -0.2, 0.05]} scale={[1.15, 0.7, 1.45]} />
        </group>
      ))}

      <group ref={body} position={[0, 0.78, 0]}>
        <mesh geometry={g.body} material={m.body} />

        {/* Cara */}
        <group ref={face} position={[0, 0.02, 0.325]}>
          <group ref={eyes}>
            <group ref={eyeL} position={[-0.15, 0.02, 0]} scale={[1, 1.25, 0.5]}>
              <mesh geometry={g.eye} material={m.eye} />
              <mesh geometry={g.shine} material={m.white} position={[0.026, 0.028, 0.06]} />
            </group>
            <group ref={eyeR} position={[0.15, 0.02, 0]} scale={[1, 1.25, 0.5]}>
              <mesh geometry={g.eye} material={m.eye} />
              <mesh geometry={g.shine} material={m.white} position={[0.026, 0.028, 0.06]} />
            </group>
          </group>
          <mesh ref={browL} geometry={g.brow} material={m.ink} position={[-0.16, 0.175, 0.01]} rotation={[0, 0, 0.12]} />
          <mesh ref={browR} geometry={g.brow} material={m.ink} position={[0.16, 0.175, 0.01]} rotation={[0, 0, -0.12]} />
          <mesh ref={smile} geometry={g.smile} material={m.ink} position={[0, -0.12, 0.01]} />
          <group ref={open} position={[0, -0.1, 0.012]} visible={false}>
            <mesh geometry={g.mouth} material={m.mouth} />
            <mesh geometry={g.tongue} material={m.tongue} position={[0, -0.03, 0.001]} />
          </group>
        </group>

        {/* Mechón */}
        <group ref={tuft} position={[0.02, 0.6, 0]}>
          <mesh geometry={g.tuft} material={m.tuft} />
        </group>

        {/* Casco de obra */}
        <group ref={hat} position={[0, 0.48, 0]} rotation={[0.08, 0, -0.06]} visible={false}>
          <mesh geometry={g.hatDome} material={m.hat} scale={[1, 0.75, 0.85]} />
          <mesh geometry={g.hatBrim} material={m.hat} position={[0, 0.01, 0.04]} scale={[1, 1, 0.9]} />
          <mesh geometry={g.hatRidge} material={m.hat} position={[0, 0.26, 0]} scale={[1, 1, 0.9]} />
        </group>

        {/* Cartel con "$" (presupuesto) */}
        <group ref={sign} position={[0, 0.98, 0.05]} visible={false}>
          <mesh geometry={g.board} material={m.sign} />
          <mesh geometry={g.stick} material={m.wood} position={[-0.2, -0.3, -0.02]} />
          <mesh geometry={g.stick} material={m.wood} position={[0.2, -0.3, -0.02]} />
        </group>

        {/* Monedas (malabares) */}
        <group ref={coins} visible={false}>
          {[0, 1, 2].map((i) => <mesh key={i} geometry={g.coin} material={m.gold} />)}
        </group>

        {/* Brazos (pivot en el hombro) */}
        <group ref={armL} position={[-0.5, -0.06, 0.1]} rotation={[0, 0, -0.16]}>
          <mesh geometry={g.arm} material={m.limb} position={[0, -0.16, 0]} />
          <mesh geometry={g.hand} material={m.body} position={[0, -0.36, 0.01]} />
          <mesh geometry={g.thumb} material={m.body} position={[0.07, -0.3, 0.05]} />
        </group>
        <group ref={armR} position={[0.5, -0.06, 0.1]} rotation={[0, 0, 0.16]}>
          <mesh geometry={g.arm} material={m.limb} position={[0, -0.16, 0]} />
          <mesh geometry={g.hand} material={m.body} position={[0, -0.36, 0.01]} />
          <mesh geometry={g.thumb} material={m.body} position={[-0.07, -0.3, 0.05]} />
          {/* Lupa */}
          <group ref={glass} position={[0, -0.5, 0.06]} visible={false}>
            <mesh geometry={g.handle} material={m.wood} position={[0, 0.08, 0]} />
            <mesh geometry={g.ring} material={m.metal} position={[0, -0.1, 0]} />
            <mesh geometry={g.lens} material={m.lens} position={[0, -0.1, 0.005]} />
          </group>
        </group>
      </group>
    </group>
  );
}
