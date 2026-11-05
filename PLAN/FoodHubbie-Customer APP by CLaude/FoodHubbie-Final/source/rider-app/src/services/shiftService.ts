// === src/services/shiftService.ts ===
// Rider shift scheduling — stores preferred online hours per day of week.
// Stored at <outlet>/riders/{uid}/shiftSchedule (outlet-scoped like staff).
import { db, ref, get, update, serverTimestamp } from "@/lib/firebase";
import { dbPaths } from "@/lib/constants";
import type { ShiftSchedule } from "@/types";

export async function saveShiftSchedule(params: {
  uid: string;
  schedule: ShiftSchedule;
}): Promise<void> {
  const { uid, schedule } = params;
  await update(ref(db, `${dbPaths.rider(uid)}/shiftSchedule`), {
    ...schedule,
    updatedAt: serverTimestamp(),
  });
}

export async function getShiftSchedule(uid: string): Promise<ShiftSchedule | null> {
  const snap = await get(ref(db, `${dbPaths.rider(uid)}/shiftSchedule`));
  return (snap.val() as ShiftSchedule | null) || null;
}
