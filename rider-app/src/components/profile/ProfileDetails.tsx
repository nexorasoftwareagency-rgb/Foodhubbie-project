// === src/components/profile/ProfileDetails.tsx ===
import { useEffect, useState } from "react";
import { Star, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { DetailRow } from "@/components/profile/DetailRow";
import { EditField } from "@/components/profile/EditField";
import { AadharCard } from "@/components/profile/AadharCard";
import { GlassCard } from "@/components/shared/GlassCard";
import type { Rider, ShiftSchedule } from "@/types";
import { getRiderRating } from "@/services/ratingService";
import { getShiftSchedule, saveShiftSchedule } from "@/services/shiftService";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

export function ProfileDetails({ rider }: { rider: Rider }) {
  const [rating, setRating] = useState<{ average: number; count: number } | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftSchedule, setShiftSchedule] = useState<ShiftSchedule | null>(null);
  const [shiftLoading, setShiftLoading] = useState(false);

  useEffect(() => {
    getRiderRating(rider.uid)
      .then((summary) => setRating(summary))
      .catch(() => setRating(null));
    getShiftSchedule(rider.uid).then(setShiftSchedule).catch(() => setShiftSchedule(null));
  }, [rider.uid]);

  const stars = rating?.average || 0;
  const fullStars = Math.floor(stars);
  const hasHalfStar = stars % 1 >= 0.5;

  async function handleSaveSchedule(schedule: ShiftSchedule) {
    setShiftLoading(true);
    try {
      await saveShiftSchedule({ uid: rider.uid, schedule });
      setShiftSchedule(schedule);
      setShiftOpen(false);
    } catch {
      toast.error("Could not save shift schedule.");
    } finally {
      setShiftLoading(false);
    }
  }

  return (
    <div>
      {rating && rating.count > 0 ? (
        <GlassCard className="mb-3">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <Star size={16} className="text-[#F59E0B]" />
            <b className="text-[13px] font-bold">{stars.toFixed(1)}</b>
            <span className="text-[11px] text-muted-foreground">({rating.count} rating{rating.count > 1 ? "s" : ""})</span>
          </div>
          <div className="flex gap-1 px-3 py-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                className={cn(
                  "size-4",
                  n <= fullStars ? "text-[#F59E0B] fill-[#F59E0B]" : "text-border/40",
                  n === fullStars && hasHalfStar ? "text-[#F59E0B] fill-[#F59E0B]" : ""
                )}
              >
                <Star />
              </span>
            ))}
          </div>
        </GlassCard>
      ) : null}

      <GlassCard className="mb-3">
        <div className="flex items-center justify-between px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-muted-foreground" />
            <b className="text-[13px] font-bold">Shift Schedule</b>
          </div>
          <Button size="sm" onClick={() => setShiftOpen(true)}>
            Edit
          </Button>
        </div>
        {shiftSchedule?.enabled ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            Shift scheduling active. You'll get a reminder when your shift window opens.
          </div>
        ) : (
          <div className="px-3 py-2 text-[11px] text-muted-foreground italic">
            No shift schedule set. Go online anytime to accept orders.
          </div>
        )}
      </GlassCard>

      {rating && rating.count > 0 ? null : (
        <div className="px-3 py-2 rounded-[10px] bg-muted/30 text-[11px] text-muted-foreground italic mb-3">
          No ratings yet. Complete deliveries to build your reputation.
        </div>
      )}

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

      <Dialog open={shiftOpen} onOpenChange={setShiftOpen}>
        <DialogContent className="sm:max-w-[340px]">
          <DialogHeader>
            <DialogTitle>Shift Schedule</DialogTitle>
          </DialogHeader>
          <div className="px-4 pb-4 space-y-3">
            <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Enable shift reminders</label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                defaultChecked={shiftSchedule?.enabled || false}
                onChange={(e) => {
                  setShiftSchedule((prev) => ({
                    ...(prev || { enabled: false, days: {} }),
                    enabled: e.target.checked,
                  }));
                }}
                className="rounded border-primary"
              />
              <span className="text-[12px]">Get notified when your shift starts</span>
            </div>
            <div className="space-y-2">
              {DAYS.map((day) => {
                const dayData = shiftSchedule?.days?.[day];
                return (
                  <div key={day} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-[8px] bg-muted/40">
                    <label className="text-[11px] font-medium select-none cursor-pointer flex items-center gap-2">
                      <input
                        type="checkbox"
                        defaultChecked={dayData?.active || false}
                        onChange={(e) => {
                          setShiftSchedule((prev) => {
                            const current = prev?.days?.[day] || { start: "09:00", end: "17:00", active: false };
                            return {
                              ...(prev || { enabled: false, days: {} }),
                              days: { ...(prev?.days || {}), [day]: { ...current, active: e.target.checked } },
                            } as ShiftSchedule;
                          });
                        }}
                        className="rounded border-primary"
                      />
                      {day.charAt(0).toUpperCase() + day.slice(1)}
                    </label>
                    <div className="flex gap-1">
                      <input
                        type="time"
                        defaultValue={dayData?.start || "09:00"}
                        disabled={!dayData?.active}
                        onChange={(e) => {
                          setShiftSchedule((prev) => {
                            const current = prev?.days?.[day] || { start: "09:00", end: "17:00", active: false };
                            return {
                              ...(prev || { enabled: false, days: {} }),
                              days: { ...(prev?.days || {}), [day]: { ...current, start: e.target.value } },
                            } as ShiftSchedule;
                          });
                        }}
                        className="text-[11px] rounded border border-border/60 bg-white px-1.5 py-1 disabled:bg-muted/30 disabled:opacity-50"
                      />
                      <span className="text-[10px] text-muted-foreground">to</span>
                      <input
                        type="time"
                        defaultValue={dayData?.end || "17:00"}
                        disabled={!dayData?.active}
                        onChange={(e) => {
                          setShiftSchedule((prev) => {
                            const current = prev?.days?.[day] || { start: "09:00", end: "17:00", active: false };
                            return {
                              ...(prev || { enabled: false, days: {} }),
                              days: { ...(prev?.days || {}), [day]: { ...current, end: e.target.value } },
                            } as ShiftSchedule;
                          });
                        }}
                        className="text-[11px] rounded border border-border/60 bg-white px-1.5 py-1 disabled:bg-muted/30 disabled:opacity-50"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="pt-4 flex gap-2">
            <Button variant="outline" onClick={() => setShiftOpen(false)} className="w-1/2">
              Cancel
            </Button>
            <Button onClick={() => handleSaveSchedule(shiftSchedule || { enabled: false, days: {} })} disabled={shiftLoading} className="w-1/2">
              {shiftLoading ? "Saving..." : "Save Schedule"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

