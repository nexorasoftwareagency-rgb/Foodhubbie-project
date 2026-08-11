// === src/components/profile/ProfileDetails.tsx ===
import { DetailRow } from "@/components/profile/DetailRow";
import { EditField } from "@/components/profile/EditField";
import { AadharCard } from "@/components/profile/AadharCard";
import type { Rider } from "@/types";

export function ProfileDetails({ rider }: { rider: Rider }) {
  return (
    <div>
      <DetailRow label="Father's Name" value={rider.fatherName || "\u2014"} />
      <DetailRow label="Age" value={rider.age || "\u2014"} />
      <DetailRow label="Qualification" value={rider.qualification || "\u2014"} />
      <DetailRow
        label="Contact Phone"
        value={rider.phone || "\u2014"}
        action={<EditField riderId={rider.uid} field="phone" currentValue={rider.phone || ""} label="Phone" />}
      />
      <DetailRow
        label="Address"
        value={rider.address || "\u2014"}
        action={<EditField riderId={rider.uid} field="address" currentValue={rider.address || ""} label="Address" />}
      />
      <AadharCard aadharNo={rider.aadharNo} aadharPhoto={rider.aadharPhoto} />
    </div>
  );
}
