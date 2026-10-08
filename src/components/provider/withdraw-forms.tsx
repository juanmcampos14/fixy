"use client";

import { useState } from "react";
import { Landmark } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/field";
import { formatMoney } from "@/lib/format";
import { requestWithdrawalAction, saveBankAccountAction } from "@/app/proveedor/actions";

type Bank = { holder_name: string; holder_tax_id: string; cbu: string | null; alias: string | null; bank_name: string | null } | null;

function BankFields({ bank }: { bank: Bank }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Titular de la cuenta" htmlFor="holderName" required>
        <Input id="holderName" name="holderName" defaultValue={bank?.holder_name ?? ""} required maxLength={160} autoComplete="name" />
      </Field>
      <Field label="CUIT / CUIL del titular" htmlFor="holderTaxId" required hint="11 dígitos, con o sin guiones.">
        <Input id="holderTaxId" name="holderTaxId" defaultValue={bank?.holder_tax_id ?? ""} required inputMode="numeric" maxLength={13} />
      </Field>
      <Field label="CBU o CVU" htmlFor="cbu" hint="22 dígitos. Podés poner solo el alias.">
        <Input id="cbu" name="cbu" defaultValue={bank?.cbu ?? ""} inputMode="numeric" maxLength={26} autoComplete="off" />
      </Field>
      <Field label="Alias" htmlFor="alias">
        <Input id="alias" name="alias" defaultValue={bank?.alias ?? ""} maxLength={20} autoComplete="off" />
      </Field>
      <Field label="Banco o billetera" htmlFor="bankName" className="sm:col-span-2">
        <Input id="bankName" name="bankName" defaultValue={bank?.bank_name ?? ""} maxLength={80} />
      </Field>
    </div>
  );
}

const describe = (b: NonNullable<Bank>) => [b.bank_name, b.alias ? `alias ${b.alias}` : null, b.cbu ? `CBU •••• ${b.cbu.slice(-4)}` : null].filter(Boolean).join(" · ");

/** Pedido de retiro: si no hay cuenta (o se quiere cambiar) se cargan los datos bancarios en el mismo paso. */
export function WithdrawForm({ availableMinor, bank, transferDate }: { availableMinor: number; bank: Bank; transferDate: string }) {
  const [editBank, setEditBank] = useState(!bank);
  return (
    <ActionForm action={requestWithdrawalAction} className="space-y-4">
      {editBank ? (
        <>
          <input type="hidden" name="withBank" value="true" />
          <p className="text-[15px] font-semibold">¿A qué cuenta te lo transferimos?</p>
          <BankFields bank={bank} />
          <p className="text-xs text-muted">La cuenta tiene que estar a tu nombre (o al de tu empresa). Tus datos bancarios solo los ve el equipo de pagos de Fixy.</p>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-cream p-3 ring-1 ring-line">
          <p className="flex items-center gap-2 text-[15px]"><Landmark className="h-5 w-5 text-fixy-700" aria-hidden /><span><strong>{bank!.holder_name}</strong> · {describe(bank!)}</span></p>
          <button type="button" onClick={() => setEditBank(true)} className="text-sm font-semibold text-fixy-800 underline">Cambiar cuenta</button>
        </div>
      )}
      <SubmitButton size="lg" pendingText="Pidiendo retiro…">Retirar {formatMoney(availableMinor)}</SubmitButton>
      <p className="text-sm text-muted">Te lo transferimos el <strong>{transferDate}</strong>. Podés pedir un retiro por mes.</p>
    </ActionForm>
  );
}

export function BankAccountForm({ bank }: { bank: Bank }) {
  return (
    <ActionForm action={saveBankAccountAction} className="space-y-4">
      <BankFields bank={bank} />
      <SubmitButton variant="secondary" pendingText="Guardando…">Guardar datos bancarios</SubmitButton>
    </ActionForm>
  );
}
