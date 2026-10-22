"use client";

import { useState } from "react";
import { TradePicker, type TradeCategory } from "./trade-picker";

/** El selector de oficios dentro de un formulario común (manda categoryIds, primaryCategoryId y otherTrade). */
export function TradePickerField({ categories, initialIds, initialPrimary }: { categories: TradeCategory[]; initialIds: string[]; initialPrimary: string | null }) {
  const ordered = initialPrimary ? [initialPrimary, ...initialIds.filter((id) => id !== initialPrimary)] : initialIds;
  const [value, setValue] = useState({ ids: ordered, primaryId: initialPrimary, other: "" });
  return <TradePicker categories={categories} value={value} onChange={setValue} max={10} name={{ ids: "categoryIds", primary: "primaryCategoryId", other: "otherTrade" }} />;
}
