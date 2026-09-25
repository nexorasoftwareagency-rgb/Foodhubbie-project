// === src/hooks/useOrderActions.ts ===
// Encapsulates all order lifecycle actions for the active trip panel.
// Returns action functions and state for UI components.

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocationContext } from "@/contexts/LocationContext";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useProximity } from "@/hooks/useProximity";
import {
  markReachedOutlet,
  markReachedDrop,
  verifyOtp as verifyOtpService,
  resendOtp as resendOtpService,
  completeDelivery,
  ProximityError,
} from "@/services/orderService";
import { logRiderError } from "@/services/auditService";
import { enqueueOfflineAction } from "@/components/shared/OfflineQueue";
import { toast } from "@/hooks/use-toast";
import type { ActiveOrder } from "@/hooks/useActiveOrder";
import { useLocation } from "wouter";

interface UseOrderActionsResult {
  // State
  sliderLoading: boolean;
  verifyOpen: boolean;
  otpOpen: boolean;
  payOpen: boolean;
  payLoading: boolean;
  successOpen: boolean;
  verifiedBy: "OTP" | "ADMIN_FALLBACK";
  setVerifiedBy: (v: "OTP" | "ADMIN_FALLBACK") => void;
  // Setters for state (needed by UI)
  setVerifyOpen: (v: boolean) => void;
  setOtpOpen: (v: boolean) => void;
  setPayOpen: (v: boolean) => void;
  setPayLoading: (v: boolean) => void;
  setSuccessOpen: (v: boolean) => void;
  // Actions
  handleSlideComplete: () => Promise<void>;
  handleVerifyOtp: (code: string) => Promise<{ success: boolean } | undefined>;
  handleResendOtp: () => Promise<void>;
  handleEmergencyOverride: () => void;
  handleConfirmPayment: (method: "CASH" | "UPI") => Promise<void>;
}

export function useOrderActions(order: ActiveOrder): UseOrderActionsResult {
  const { user } = useAuth();
  const { location } = useLocationContext();
  const { requestPosition } = useGeolocation();
  const { } = useProximity(order);
  const [, navigate] = useLocation();

  const [sliderLoading, setSliderLoading] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [verifiedBy, setVerifiedBy] = useState<"OTP" | "ADMIN_FALLBACK">("OTP");

  const step = order.step;

  async function resolvePosition(): Promise<{ lat: number; lng: number; accuracy?: number }> {
    if (location) return location;
    try {
      return await requestPosition();
    } catch {
      throw new Error("Could not read your location. Enable GPS and try again.");
    }
  }

  async function handleSlideComplete() {
    if (sliderLoading) return;
    setSliderLoading(true);
    try {
      if (!navigator.onLine) {
        if (step === 0) {
          enqueueOfflineAction("REACHED_OUTLET", {
            outlet: order.outlet,
            orderId: order.id,
            outletLat: order.outletLat,
            outletLng: order.outletLng,
          });
          toast.warning("You're offline", { description: "This will sync automatically once you're back online." });
        } else if (step === 1) {
          setVerifyOpen(true);
        } else if (step === 2) {
          enqueueOfflineAction("UPDATE_STATUS", {
            subtype: "reachedDrop",
            outlet: order.outlet,
            orderId: order.id,
            customerPhone: order.customerPhone || order.phone,
          });
          toast.warning("You're offline", { description: "This will sync automatically once you're back online." });
        }
        return;
      }

      if (step === 0) {
        const pos = await resolvePosition();
        await markReachedOutlet({
          outlet: order.outlet,
          orderId: order.id,
          riderLat: pos.lat,
          riderLng: pos.lng,
          accuracy: pos.accuracy,
          outletLat: order.outletLat,
          outletLng: order.outletLng,
        });
        toast.success("Arrived at outlet");
      } else if (step === 1) {
        setVerifyOpen(true);
      } else if (step === 2) {
        await markReachedDrop({
          outlet: order.outlet,
          orderId: order.id,
          customerPhone: order.customerPhone || order.phone,
        });
        toast.success("Reached drop location", { description: "Customer notified via WhatsApp." });
        setOtpOpen(true);
      }
    } catch (err: unknown) {
      if (err instanceof ProximityError) {
        toast.error("Too far from location", { description: err.message });
      } else {
        const message = err instanceof Error ? err.message : "Please try again.";
        toast.error("Action failed", { description: message });
      }
    } finally {
      setSliderLoading(false);
    }
  }

  async function handleVerifyOtp(code: string) {
    try {
      const result = await verifyOtpService({
        outlet: order.outlet,
        orderId: order.id,
        enteredOtp: code,
        actualOtp: order.deliveryOTP || order.otp || "",
        backupCode: order.backupCode,
      });
      if (result.success) {
        setVerifiedBy(result.verifiedBy);
        setOtpOpen(false);
        setPayOpen(true);
      }
      return result;
    } catch (err) {
      toast.error("OTP verification failed. Please try again.");
      if (user?.uid) logRiderError(user.uid, "ActiveTripView.verifyOtp", err);
      return { success: false };
    }
  }

  async function handleResendOtp() {
    await resendOtpService({ outlet: order.outlet, orderId: order.id });
  }

  function handleEmergencyOverride() {
    if (!order.backupCode) {
      toast.error("No backup code configured for this outlet.");
      return;
    }
    verifyOtpService({
      outlet: order.outlet,
      orderId: order.id,
      enteredOtp: order.backupCode,
      actualOtp: order.deliveryOTP || order.otp || "",
      backupCode: order.backupCode,
      isAdmin: true,
    }).then((result) => {
      if (result.success) {
        setVerifiedBy("ADMIN_FALLBACK");
        setOtpOpen(false);
        setPayOpen(true);
        toast.warning("Emergency override used", { description: "This is logged for audit." });
      }
    }).catch((err) => {
      toast.error("Emergency override failed");
      if (user?.uid) logRiderError(user.uid, "ActiveTripView.emergencyOverride", err);
    });
  }

  async function handleConfirmPayment(method: "CASH" | "UPI") {
    if (!user?.uid) return;
    setPayLoading(true);
    try {
      await completeDelivery({
        outlet: order.outlet,
        orderId: order.id,
        riderId: user.uid,
        deliveryFee: order.deliveryFee,
        paymentMethod: method,
        verifiedBy,
      });
      toast.success("Delivery completed!");
      navigate("/active");
    } catch (err) {
      toast.error("Could not complete delivery");
      if (user?.uid) logRiderError(user.uid, "ActiveTripView.completeDelivery", err);
    } finally {
      setPayLoading(false);
    }
  }

return {
    sliderLoading,
    verifyOpen,
    setVerifyOpen,
    otpOpen,
    setOtpOpen,
    payOpen,
    setPayOpen,
    payLoading,
    setPayLoading,
    successOpen,
    setSuccessOpen,
    verifiedBy,
    setVerifiedBy,
    handleSlideComplete,
    handleVerifyOtp,
    handleResendOtp,
    handleEmergencyOverride,
    handleConfirmPayment,
  };
}