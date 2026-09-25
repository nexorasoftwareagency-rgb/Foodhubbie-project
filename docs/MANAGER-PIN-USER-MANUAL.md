# Manager PIN & Discount Approval Ceiling — User Manual

Covers the two gates shipped together:

| Gate | What it protects | Where |
|---|---|---|
| **Approval ceiling** | Human-typed discounts above a set **% of the bill** | Table bills (`Confirm Payment`) and POS walk-in sales (`Record Sale`) |
| **Void PIN** | Every payment void | Table card → `Void Payment` |

Both use the **same Manager PIN**, both fail **open** by design (see [§10](#10-limitations-you-must-know)).

> **Worked example used throughout:** ceiling = **15%**, bill subtotal = **₹1,000**.

---

## 1. What this feature does

A **manual discount** is one a staff member types in by hand (an amount or a percentage), as opposed to a coupon, a first-order offer, or a category offer that the system applies on its own.

Before this feature, a staff member could type `900` off a `1,000` bill and nothing asked a second person. Now:

- discounts **at or below** the ceiling → no change, nothing asked
- discounts **above** the ceiling → a manager must type the PIN before the payment goes through
- **every void** (money already taken, being given back) → the manager must type the PIN

Every approval is written to the audit log with who approved it.

---

## 2. What this is NOT

| | Ceiling / Manager PIN | **Max cap** (already existed) |
|---|---|---|
| Where | Settings tab → *Discount Approval* | Discount editor → *Max cap (₹, optional)* |
| Applies to | **Manual** discounts only, at settlement | **Auto** discounts (coupons, offers), per definition |
| Question it answers | "Is a *person* allowed to give this much away?" | "How much can *this one offer* ever give away?" |
| Unit | % of the bill | flat ₹ |

They are independent. An auto discount can be capped by **Max cap** and still never ask for a PIN. A manual discount is never bounded by **Max cap**.

---

## 3. Where the settings live

**Admin app → Settings tab → *Discount Approval* group** (directly below *Delivery Security*).

```
Discount Approval
├── Approval Ceiling (% of bill)   [ e.g. 15 ]
└── Manager PIN                    [ •••• ]
```

Then press **Save Settings**.

**Important:** settings are **per outlet**. Each outlet has its own ceiling and its own PIN, stored at:

```
businesses/{businessId}/outlets/{outletId}/settings/Security/
├── discountCeilingPct   e.g. 15
└── pinHash              e.g. 2bb80d537b1da3e38bd30361aa35775aa0e7f9fb...
```

Only the **hash** of the PIN is stored — never the PIN itself. Only admins can read this node (riders cannot).

---

## 4. Configuring it — every save outcome

Press **Save Settings** with the *Discount Approval* fields filled as follows:

| Ceiling field | PIN field | Result |
|---|---|---|
| `15` | `4711` | Saved. Ceiling 15%, PIN set. Gate active. |
| `15` | *(blank)* | Ceiling saved as 15. **Existing PIN kept** — a blank field never wipes it. |
| `0` | `4711` | Ceiling saved as 0 → ceiling **off**. PIN still stored, still required for voids. |
| *(blank)* | *(blank)* | Ceiling saved as 0 (blank → 0), PIN unchanged. Feature off for discounts. |
| `150` | `4711` | Clamped to **100**. Never stored above 100. |
| `-5` | `4711` | Clamped to **0**. |
| `15` | `123` | **Rejected** → toast *"Manager PIN must be 4 to 12 digits."* **Nothing is saved** (not even the ceiling). |
| `15` | `1234567890123` | **Rejected** → same toast, too many digits. Nothing saved. |
| `15` | `abcd` | **Rejected** → same toast, digits only. Nothing saved. |
| `15` | `4711` on **non-HTTPS** | **Rejected** → toast *"PIN could not be hashed — the app must run over HTTPS."* Nothing saved. |

**Changing the PIN:** type a new 4–12 digit number into the field and Save. The placeholder tells you the current state:

- `PIN set — enter a new one to change it` → a PIN exists
- `e.g. 4711` → no PIN exists yet

---

## 5. How the ceiling is calculated

```
discount % = discount ÷ subtotal × 100
PIN required  ⇔  ceiling > 0  AND  subtotal > 0  AND  discount % > ceiling
```

With **ceiling = 15%** and **subtotal = ₹1,000**:

| You apply | Amount | % of bill | PIN asked? | Why |
|---|---|---|---|---|
| Manual ₹50 | ₹50 | 5% | No | below ceiling |
| Manual ₹150 | ₹150 | 15.0% | **No** | *exactly* at ceiling — the test is strictly `>` |
| Manual ₹151 | ₹151 | 15.1% | **Yes** | first value above ceiling |
| Manual ₹500 | ₹500 | 50% | **Yes** | above ceiling |
| Percent 10% | ₹100 | 10% | No | below ceiling |
| Percent 15% | ₹150 | 15% | No | exactly at ceiling |
| Percent 16% | ₹160 | 16% | **Yes** | above ceiling |
| Coupon ₹300 (auto) | ₹300 | 30% | **No** | auto discounts are never gated |
| First-order 20% (auto) | ₹200 | 20% | **No** | auto discounts are never gated |
| Category 25% (auto) | ₹250 | 25% | **No** | auto discounts are never gated |
| Manual ₹900, ceiling `0` | ₹900 | 90% | **No** | ceiling disabled |
| Any discount, subtotal ₹0 | — | — | **No** | zero bill, nothing to approve |

Different bill size, same ceiling — the ceiling is a **percentage, not a flat amount**:

| Subtotal | Ceiling 15% | PIN needed above |
|---|---|---|
| ₹200 | 15% | ₹30.01 |
| ₹1,000 | 15% | ₹150.01 |
| ₹10,000 | 15% | ₹1,500.01 |

---

## 6. Discount gate — every possible outcome

Triggered from two places, both automatic:

- **Table bill** → you click **Confirm Payment**
- **POS walk-in** → you click **Record Sale**

### 6.1 Outcomes before any PIN is shown

| # | Situation | What you see | Does the payment proceed? |
|---|---|---|---|
| 1 | Discount is **auto** (coupon, first-order, global, category offer) | nothing | **Yes** — gate skipped entirely, no settings read |
| 2 | Manual discount, ceiling = **0** (or blank) | nothing | **Yes** — ceiling off |
| 3 | Manual discount **at or below** ceiling | nothing | **Yes** |
| 4 | Discount is 0 (nothing applied) | nothing | **Yes** |
| 5 | Settings can't be read (offline, permission) | browser console warning | **Yes** — fail open |
| 6 | Manual discount **above** ceiling | PIN prompt (see 6.2) | depends on 6.2 |

### 6.2 Outcomes once the PIN prompt is shown

The prompt reads **"Manager Approval"**, has a password field and two buttons: **Cancel** and **Approve**. It also states what you are approving:

> **This 15.1% discount is above the 15% approval ceiling.**

The percentage is rounded to one decimal place, so ₹151 off a ₹1,000 bill shows `15.1` and ₹500 off shows `50.0`. The ceiling is the value saved in Settings.

| # | You do | What you see | Result |
|---|---|---|---|
| 7 | Type the correct PIN, press **Approve** (or **Enter**) | prompt closes | **Payment proceeds.** Audit entry `discount.pin.approved` written with who approved it, the discount, the subtotal and the ceiling. |
| 8 | Type a **wrong** PIN, press **Approve** | toast *"Incorrect manager PIN. Try again."*; prompt closes and **reopens** | **Nothing happens.** Try again or cancel. |
| 9 | Type wrong PIN several times, then the right one | wrong → toast each time, then proceeds | **Payment proceeds** on the correct attempt. |
| 10 | Press **Cancel** | prompt closes | **Payment aborted.** Nothing is written. The bill review / cart stays exactly as it was. |
| 11 | Press **Escape** | prompt closes | Same as Cancel — aborted. |
| 12 | Click **outside** the prompt | prompt closes | Same as Cancel — aborted. |
| 13 | Press **Approve** with an **empty** field | prompt closes | Same as Cancel — **aborted** (an empty field is not a PIN). |
| 14 | Press **Enter** with an empty field | nothing happens | Prompt stays open. |
| 15 | Ceiling is on but **no PIN has ever been set** | toast *"Manager PIN is required for this action but none is set — configure it in Settings."* | **Yes** — fail open, so a half-configured setup never blocks billing. |
| 16 | Browser lacks crypto (site opened over plain `http://` IP) | console warning | **Yes** — fail open. |

### 6.3 After you approve

**Table bill:** the payment-method step follows. If you approve the PIN but then don't select a payment method, nothing is written and you will be asked for the PIN **again** the next time you click *Confirm Payment* — approval is not cached.

**POS:** the order is written immediately. If you cancel the PIN, **your cart is preserved** — nothing is cleared, you can adjust the discount and try again.

---

## 7. Void gate — every possible outcome

Reachable from all four entry points — the table card button, the table drawer button, the delegated action and the `window.__tables` export — but they all run **one** function, so the gate applies to every void.

Flow: click **Void Payment** → confirmation dialog → **PIN prompt**. The prompt states what you are authorising:

> **Authorise voiding this table bill. This cannot be undone.**

For a split/group bill the same message reads `group bill` instead of `table bill`.

| # | You do | Result |
|---|---|---|
| 1 | Click **Void Payment**, then **Cancel** on the confirmation | Nothing happens. No PIN asked. |
| 2 | Confirm, then type the **correct** PIN | **Void executes.** Orders revert to *Served*, discount usage is reverted. Audit entry `void.pin.approved` written with the table and group. |
| 3 | Confirm, then type a **wrong** PIN | toast *"Incorrect manager PIN. Try again."*, prompt reopens. Nothing changed. |
| 4 | Confirm, then **Cancel** / **Esc** / click outside / empty **Approve** | **Void aborted.** Payment stays void-free, orders untouched. |
| 5 | Confirm, but **no PIN is set** | toast *"Manager PIN is required for this action but none is set — configure it in Settings."* → **void proceeds** (fail open). |
| 6 | Confirm, settings unreadable | console warning → **void proceeds** (fail open). |

The confirmation dialog comes **first**, so you always know what you are authorising before you are asked for the PIN.

---

## 8. Every message you can see

| Message | Level | Meaning | What to do |
|---|---|---|---|
| `Manager PIN is required for this action but none is set — configure it in Settings.` | warning (5s) | Ceiling or void gate is on but no PIN exists | Set a PIN in Settings → *Discount Approval* |
| `Incorrect manager PIN. Try again.` | error (3s) | Wrong PIN typed | Re-enter, or cancel |
| `Manager PIN must be 4 to 12 digits.` | error | PIN field had a bad value on save | Use 4–12 digits only |
| `PIN could not be hashed — the app must run over HTTPS.` | error | Browser refused crypto on insecure origin | Open the app over `https://` |
| `Processing...` (POS button) | spinner | Sale is running — including the PIN prompt | Cancel the prompt to stop |
| Browser console: `approval settings unreadable` | console | `settings/Security` couldn't be read | Check connection/rules; action fails open |
| Browser console: `PIN hashing unavailable — failing open` | console | `crypto.subtle` missing | Use HTTPS |

---

## 9. The audit trail

Every successful approval writes one row to `businesses/{businessId}/outlets/{outletId}/logs/audit`:

| Field | Discount approval | Void approval |
|---|---|---|
| `action` | `discount.pin.approved` | `void.pin.approved` |
| `uid` | who typed the PIN | who typed the PIN |
| `adminEmail` | their email | their email |
| `outlet` | outlet id | outlet id |
| `timestamp` | server time | server time |
| `details.discountValue` | e.g. `151` | — |
| `details.subtotal` | e.g. `1000` | — |
| `details.ceilingPct` | e.g. `15` | — |
| `details.tableId` | — | e.g. `t1` |
| `details.groupId` | — | group id, or `session` |

Failed attempts are **not** logged (only the approval is), so the trail stays readable.

---

## 10. Limitations you must know

1. **This is not a security boundary.** There are no Cloud Functions on this plan, so the PIN is checked **inside the browser**. Anyone who opens devtools can bypass it. Treat it as *accountability* — you will see who approved what — not as protection against someone determined to bypass it.
2. **The stored hash can be cracked.** A 4-digit PIN has only 10,000 combinations; the SHA-256 hash stops casual shoulder-surfing of the database, not a determined attacker who can read it. Longer PINs (up to 12 digits) are meaningfully better.
3. **Fail open is deliberate.** Unreadable settings, no PIN configured, or no crypto all **allow the action** with a warning. The reason: a misconfigured ceiling must never stop a restaurant from taking payment mid-service. The flip side — if you never set a PIN, the ceiling does nothing.
4. **Set both fields, or neither.** A ceiling with no PIN is a warning on every large discount and no actual control.
5. **Per outlet.** Changing the PIN on one outlet does not change it on another.
6. **Not live-tested.** Verified by unit checks, build and static inspection; not exercised end-to-end against a live database.

---

## 11. Quick troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Never get asked for a PIN on a huge discount | Ceiling is `0`, or the discount is a coupon/offer rather than a manual one | Set a ceiling > 0; check the discount is typed in manually |
| Asked for a PIN on a small discount | Ceiling is set very low (e.g. `1`) | Raise the ceiling |
| *"…none is set…"* toast every time | Ceiling configured, PIN never saved | Save a 4–12 digit PIN |
| PIN rejected even though you typed it right | You changed it on a **different outlet** | Settings are per outlet |
| Settings won't save at all | Bad PIN value (too short/long/non-numeric) | Fix the PIN field — the whole save aborts on it |
| Approving the PIN then being asked again | Payment method wasn't selected before the PIN | Select the payment method, then confirm |
