// === src/components/profile/EditField.tsx ===
import { useState } from "react";
import { updateRiderProfile, type ProfileEditableFields } from "@/services/riderService";
import { toast } from "@/hooks/use-toast";
import { logRiderError } from "@/services/auditService";

export function EditField({
  riderId,
  field,
  currentValue,
  label,
}: {
  riderId: string;
  field: keyof ProfileEditableFields;
  currentValue: string;
  label: string;
}) {
  const [saving, setSaving] = useState(false);

  async function handleEdit() {
    const next = window.prompt(`Update ${label}`, currentValue);
    if (next === null || next.trim() === "" || next === currentValue) return;
    setSaving(true);
    try {
      await updateRiderProfile(riderId, { [field]: next.trim() } as ProfileEditableFields);
      toast.success(`${label} updated`);
    } catch (err) {
      toast.error(`Could not update ${label.toLowerCase()}`);
      logRiderError(riderId, "EditField.update", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button onClick={handleEdit} disabled={saving} className="text-[10.5px] font-bold text-primary disabled:opacity-50">
      {saving ? "..." : "EDIT"}
    </button>
  );
}
