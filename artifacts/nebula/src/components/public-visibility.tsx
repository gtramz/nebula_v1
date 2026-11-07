import type { PublicVisibility } from '@nebula/local';

export function PublicVisibilityFields({ value, onChange, disabled = false }: {
  value: PublicVisibility; onChange: (value: PublicVisibility) => void; disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-3 text-sm disabled:opacity-50">
      <legend className="font-bold mb-3 text-ink">Public visibility for this project</legend>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={value.showName} onChange={event => onChange({ ...value, showName: event.target.checked })} className="accent-accent h-4 w-4" />
        Show my name publicly
      </label>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={value.showAmount} onChange={event => onChange({ ...value, showAmount: event.target.checked })} className="accent-accent h-4 w-4" />
        Show my total amount publicly
      </label>
      <p className="text-xs text-muted leading-relaxed">Applies to all your contributions to this project, including past ones. The artist can see your name and contribution details privately. Project totals remain public.</p>
    </fieldset>
  );
}
