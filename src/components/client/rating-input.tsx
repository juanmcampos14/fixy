/** Selector de 1 a 5 estrellas accesible (radios nativos). */
export function RatingInput({ name = "rating", legend = "¿Cómo calificarías el trabajo?" }: { name?: string; legend?: string }) {
  return (
    <fieldset>
      <legend className="text-[15px] font-semibold">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer">
            <input type="radio" name={name} value={n} required className="peer sr-only" />
            <span className="grid h-11 min-w-11 place-items-center rounded-full px-3 font-bold ring-1 ring-line peer-checked:bg-spark-100 peer-checked:ring-2 peer-checked:ring-spark peer-focus-visible:ring-3 peer-focus-visible:ring-fixy-500/40">
              <span aria-hidden>{n}★</span>
              <span className="sr-only">{n} de 5 estrellas</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
