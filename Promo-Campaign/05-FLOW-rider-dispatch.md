# Rider dispatch tour — real taps, with explanations

App routes: /dashboard /available /active /active-trip /completed /wallet /earnings /profile.
Must be logged in + Online toggle to receive work.

## 1. Go online → see work
**Taps:** Dashboard "Welcome, [Name]!" + stats → Available Pickup → empty state "No new
orders available right now" → orders appear nearest-first with live distance.
**Say:** "Gig riders self-sort by proximity — zero dispatcher phone calls."

## 2. Accept
**Taps:** Card (outlet, #id, READY badge, X.X km, address, **Your Earning ₹X** vs Order Total)
→ **ACCEPT ORDER** → "ACCEPTING…" → "Order Accepted! Head to the outlet." → auto /active.
Fails: "Already taken", "Too far from outlet — Move within X km", offline → auto-accept on reconnect.
**Say:** "First tap wins, far taps blocked — food never waits on a distant rider."

## 3. Active trip (Accept → Pickup → Transit → Drop)
**Taps:** SLIDE TO REACH OUTLET (GPS check → "Arrived at outlet") → SLIDE TO PICK UP →
Verify pickup checklist → Confirm ("Navigate to the customer now") → SLIDE TO REACH
CUSTOMER ("Reached — Customer notified via WhatsApp") → 4-digit OTP sheet (resend cooldown,
blocked-timer, admin emergency override audit-logged) → enter OTP → Collect Payment sheet
(Total to collect ₹X, CASH/UPI, CONFIRM PAYMENT COLLECTED; skipped if prepaid) →
Success overlay (order ID + earned ₹) → Dashboard. Multi-order route optimizer when holding 2.
**Say:** "Slides plus GPS stop fake pickups; customer OTP proves handover; cash or UPI recorded
right for settlement — and the customer already got the WhatsApp."
