"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Elegir el rubro principal entre los rubros tildados del mismo formulario. Se actualiza solo cuando se tildan o
 * destildan rubros; si se destilda el principal, pasa al primero que quede.
 */
export function PrimaryCategoryPicker({ categories, initial }: { categories: { id: string; name: string }[]; initial: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [value, setValue] = useState(initial ?? "");
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const read = () => {
      const ids = [...form.querySelectorAll<HTMLInputElement>('input[name="categoryIds"]:checked')].map((i) => i.value);
      setChecked(ids);
      setValue((v) => (ids.includes(v) ? v : (ids[0] ?? "")));
    };
    read();
    form.addEventListener("change", read);
    return () => form.removeEventListener("change", read);
  }, []);
  const options = categories.filter((c) => checked.includes(c.id));
  return (
    <div ref={ref} className="mt-4">
      <label htmlFor="primaryCategoryId" className="mb-1.5 block text-[15px] font-semibold">Tu rubro principal</label>
      <select id="primaryCategoryId" name="primaryCategoryId" value={value} onChange={(e) => setValue(e.target.value)} required disabled={!options.length}
        className="w-full rounded-xl border border-control bg-surface px-3.5 py-2.5 text-[15px] sm:max-w-sm">
        {!options.length && <option value="">Elegí primero tus especialidades</option>}
        {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <p className="mt-1.5 text-sm text-muted">Es en el que aparecés primero. En las demás especialidades también te llegan pedidos, pero más abajo.</p>
    </div>
  );
}
