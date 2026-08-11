// === src/components/profile/ProfilePhoto.tsx ===
import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { uploadProfilePhoto } from "@/services/storageService";
import { updateRiderProfile } from "@/services/riderService";
import { toast } from "@/hooks/use-toast";
import { logRiderError } from "@/services/auditService";
import type { Rider } from "@/types";

export function ProfilePhoto({ rider }: { rider: Rider }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const initials = (rider.name || "R")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadProfilePhoto(rider.uid, file);
      await updateRiderProfile(rider.uid, { profilePhoto: url });
      toast.success("Profile photo updated");
    } catch (err) {
      toast.error("Could not upload photo. Try a smaller image.");
      logRiderError(rider.uid, "ProfilePhoto.upload", err);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col items-center mb-4.5">
      <div className="relative">
        <Avatar className="size-[84px] text-[28px] shadow-[var(--shadow-premium)]">
          {rider.profilePhoto && <AvatarImage src={rider.profilePhoto} alt={rider.name} />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="absolute -bottom-0.5 -right-0.5 flex size-7 items-center justify-center rounded-full bg-white border-2 border-[var(--bg-app)] text-primary shadow-[0_2px_8px_rgba(0,0,0,0.15)]"
        >
          <Camera size={13} />
        </button>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
      <b className="text-[16.5px] font-extrabold mt-3">{rider.name}</b>
      <span className="text-[12px] text-muted-foreground mt-0.5">
        {rider.phone} &middot; RID-{rider.uid.slice(0, 6).toUpperCase()}
      </span>
    </div>
  );
}
