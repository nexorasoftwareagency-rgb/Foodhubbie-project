// === src/services/whatsappService.ts ===
// Sends customer-facing WhatsApp alerts via bot/{outlet}/commands — matches
// rider/js/whatsapp.js exactly, including the deliberate omission of any
// OTP-sending call (the bot independently watches deliveryOTP and messages
// the customer; the rider app is never responsible for that message).

import { db, ref, push, serverTimestamp } from "@/lib/firebase";
import { dbPaths, WHATSAPP_TEMPLATES, type OutletId } from "@/lib/constants";
import { cleanPhoneDigits } from "@/lib/utils";

async function sendGenericMessage(outlet: OutletId, phone: string, message: string): Promise<void> {
  const cleanPhone = cleanPhoneDigits(phone);
  if (!cleanPhone) return; // no phone on file — skip silently, not fatal to the delivery flow
  const cmdRef = ref(db, dbPaths.botCommands(outlet));
  await push(cmdRef, {
    action: "SEND_GENERIC_MESSAGE",
    phone: cleanPhone,
    message,
    timestamp: serverTimestamp(),
  });
}

export const whatsappService = {
  sendAccepted(outlet: OutletId, customerPhone: string, riderName: string, orderId: string) {
    return sendGenericMessage(outlet, customerPhone, WHATSAPP_TEMPLATES.ACCEPTED(riderName, orderId));
  },
  sendPickedUp(outlet: OutletId, customerPhone: string, riderPhone: string, orderId: string) {
    return sendGenericMessage(outlet, customerPhone, WHATSAPP_TEMPLATES.PICKED_UP(riderPhone, orderId));
  },
  /** Sent on reaching the drop location — deliberately does NOT include or trigger the OTP. */
  sendArrived(outlet: OutletId, customerPhone: string, orderId: string) {
    return sendGenericMessage(outlet, customerPhone, WHATSAPP_TEMPLATES.ARRIVED(orderId));
  },
};
