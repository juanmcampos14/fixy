"use client";

import { useState } from "react";
import { Fence } from "lucide-react";

/** "¿Es un barrio cerrado o country?" + nombre del barrio. Inputs con nombre para formularios; onChange para el asistente. */
export function GatedToggle({ defaultChecked = false, defaultName = "", onChange }: {
  defaultChecked?: boolean;
  defaultName?: string;
  onChange?: (v: { gatedCommunity: string; gatedName: string }) => void;
}) {
  const [on, setOn] = useState(defaultChecked);
  const [name, setName] = useState(defaultName);
  const emit = (o: boolean, n: string) => onChange?.({ gatedCommunity: o ? "true" : "", gatedName: n });
  return (
    <div className="rounded-2xl border border-line p-4 sm:col-span-2">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" name="gatedCommunity" value="true" checked={on} className="mt-1 h-5 w-5 accent-fixy-700"
          onChange={(e) => { setOn(e.target.checked); emit(e.target.checked, name); }} />
        <span>
          <span className="flex items-center gap-1.5 font-semibold"><Fence className="h-4 w-4 text-fixy-800" aria-hidden />Es un barrio cerrado, country o edificio con control de acceso</span>
          <span className="block text-sm text-muted">Así el profesional sabe antes de aceptar qué necesita para entrar (seguros, cláusula de no repetición, documentación del auto, horarios).</span>
        </span>
      </label>
      {on && (
        <div className="mt-3 space-y-1.5 pl-8">
          <label htmlFor="gatedName" className="block text-[15px] font-semibold">Nombre del barrio</label>
          <input id="gatedName" name="gatedName" value={name} maxLength={120}
            onChange={(e) => { setName(e.target.value); emit(on, e.target.value); }}
            className="block h-12 w-full rounded-xl border border-control bg-surface px-3.5 text-[16px] focus:border-fixy-600 focus:outline-none focus:ring-3 focus:ring-fixy-500/25" />
          <p className="text-sm text-muted">Es privado, como la dirección. Después podés subir el reglamento de ingreso y lo interpretamos con IA.</p>
        </div>
      )}
    </div>
  );
}
