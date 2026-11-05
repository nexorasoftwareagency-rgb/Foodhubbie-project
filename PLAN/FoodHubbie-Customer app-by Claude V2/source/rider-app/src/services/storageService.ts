// === src/services/storageService.ts ===
import { storage, storageRef, uploadBytes, getDownloadURL } from "@/lib/firebase";
import { compressImage } from "@/lib/utils";

/** Compresses a profile photo to Roshani's real storage.rules limit (300KB / max 1024px), uploads it. */
export async function uploadProfilePhoto(riderId: string, file: File): Promise<string> {
  const blob = await compressImage(file, 300, 1024);
  const path = `riders/${riderId}/profile_${Date.now()}.jpg`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, blob, { contentType: "image/jpeg" });
  return getDownloadURL(ref);
}
