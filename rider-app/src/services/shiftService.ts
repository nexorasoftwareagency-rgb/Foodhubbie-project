// === src/services/shiftService.ts ===
// Rider shift scheduling — stores preferred online hours per day of week.
// Stored at riders/{uid}/shiftSchedule.
import { db, ref, get, update, serverTimestamp } from "@/lib/firebase";
import type { ShiftSchedule } from "@/types";

export async function saveShiftSchedule(params: {
  uid: string;
  schedule: ShiftSchedule;
}): Promise<void> {
  const { uid, schedule } = params;
  await update(ref(db, `riders/${uid}/shiftSchedule`), {
    ...schedule,
    updatedAt: serverTimestamp(),
  });
}

export async function getShiftSchedule(uid: string): Promise<ShiftSchedule | null> {
  const snap = await get(ref(db, `riders/${uid}/shiftSchedule`));
  return (snap.val() as ShiftSchedule | null) || null;
}
