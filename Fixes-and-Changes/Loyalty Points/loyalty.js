/**
 * Admin/js/features/loyalty.js  (proposed)
 * -----------------------------------------------------------------------
 * Starter Admin feature module, matching the shape your README documents
 * for other features (e.g. discounts.js: loadX(), CRUD via a modal editor,
 * cleanupX() on tab switch). This is a DRAFT — wire the Firebase import
 * paths and state object to match your real Admin/js/firebase.js and
 * Admin/js/state.js before using.
 * -----------------------------------------------------------------------
 */

import { db, ref, onValue, update, runTransaction, push } from "../firebase.js";
import { state } from "../state.js";
import { showToast } from "../ui-utils.js";

let loyaltyConfigListener = null;
let loyaltyMembersListener = null;

/** Entry point — called when the Loyalty tab is switched to. */
export function loadLoyalty() {
  const outlet = state.currentOutlet;

  loyaltyConfigListener = onValue(ref(db, `${outlet}/loyalty/config`), (snap) => {
    state.loyaltyConfig = snap.val() || defaultConfig();
    renderProgramSettings();
    renderOverviewKpis();
  });

  loyaltyMembersListener = onValue(ref(db, `${outlet}/loyalty/members`), (snap) => {
    state.loyaltyMembers = snap.val() || {};
    renderMembersGrid();
    renderOverviewKpis();
  });
}

/** Called on tab switch away — detach listeners, same pattern as other features. */
export function cleanupLoyalty() {
  if (loyaltyConfigListener) loyaltyConfigListener();
  if (loyaltyMembersListener) loyaltyMembersListener();
  loyaltyConfigListener = null;
  loyaltyMembersListener = null;
}

function defaultConfig() {
  return {
    enabled: true,
    pointsPerRupee: 1,
    redemptionValuePerPoint: 0.5,
    minRedeemPoints: 100,
    maxRedeemPercentOfOrder: 10,
    pointsExpiryMonths: 12,
    birthdayBonusPoints: 50,
    tiers: [
      { id: "bronze", name: "Bronze", minLifetimeSpend: 0, multiplier: 1.0, badgeColor: "#A67C52" },
      { id: "silver", name: "Silver", minLifetimeSpend: 5000, multiplier: 1.25, badgeColor: "#A8A8A8" },
      { id: "gold", name: "Gold", minLifetimeSpend: 15000, multiplier: 1.5, badgeColor: "#D4A017" },
    ],
  };
}

/** Overview KPI cards — active members, outstanding ₹ liability, redemption rate. */
function renderOverviewKpis() {
  const members = Object.values(state.loyaltyMembers || {});
  const config = state.loyaltyConfig || defaultConfig();

  const activeMembers = members.filter((m) => m.points > 0).length;
  const totalPointsOutstanding = members.reduce((sum, m) => sum + (m.points || 0), 0);
  const liabilityInRupees = totalPointsOutstanding * (config.redemptionValuePerPoint || 0.5);

  const el = (id) => document.getElementById(id);
  if (el("#loyaltyKpiActiveMembers")) el("#loyaltyKpiActiveMembers").textContent = activeMembers;
  if (el("#loyaltyKpiLiability")) el("#loyaltyKpiLiability").textContent = `₹${liabilityInRupees.toLocaleString("en-IN")}`;
}

/** Members grid — mirrors the existing Customers tab grid pattern. */
function renderMembersGrid() {
  const tbody = document.getElementById("loyaltyMembersTableBody");
  if (!tbody) return;
  const members = Object.entries(state.loyaltyMembers || {});
  tbody.innerHTML = members
    .map(([phone, m]) => {
      return `
        <tr>
          <td>${phone}</td>
          <td><span class="loyalty-tier-badge loyalty-tier-${m.tier || "bronze"}">${(m.tier || "bronze").toUpperCase()}</span></td>
          <td>${m.points || 0}</td>
          <td>₹${(m.lifetimeSpend || 0).toLocaleString("en-IN")}</td>
          <td><button data-action="adjustPoints" data-phone="${phone}">Adjust</button></td>
        </tr>`;
    })
    .join("");
}

/** Program settings form population — edit tiers/rates, save via atomic update. */
function renderProgramSettings() {
  const config = state.loyaltyConfig || defaultConfig();
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  setVal("#loyaltyPointsPerRupee", config.pointsPerRupee);
  setVal("#loyaltyRedemptionValue", config.redemptionValuePerPoint);
  setVal("#loyaltyMinRedeem", config.minRedeemPoints);
  setVal("#loyaltyMaxRedeemPct", config.maxRedeemPercentOfOrder);
  setVal("#loyaltyExpiryMonths", config.pointsExpiryMonths);
}

/** Save program settings — single atomic write, same pattern as settings.js. */
export async function saveLoyaltySettings(formValues) {
  const outlet = state.currentOutlet;
  try {
    await update(ref(db, `${outlet}/loyalty/config`), formValues);
    showToast("Loyalty settings saved", "success");
  } catch (err) {
    showToast("Failed to save loyalty settings", "error");
    console.error(err);
  }
}

/**
 * Manual points adjustment by an admin (customer service recovery, goodwill).
 * Always writes a ledger entry — never a silent balance edit.
 */
export async function adjustMemberPoints(phone, deltaPoints, reason, adminUid) {
  const outlet = state.currentOutlet;
  const memberRef = ref(db, `${outlet}/loyalty/members/${phone}/points`);

  const result = await runTransaction(memberRef, (currentPoints) => {
    return Math.max(0, (currentPoints || 0) + deltaPoints);
  });

  if (result.committed) {
    const ledgerRef = push(ref(db, `${outlet}/loyalty/ledger`));
    await update(ledgerRef, {
      phone,
      type: "adjustment",
      points: deltaPoints,
      balanceAfter: result.snapshot.val(),
      reason: reason || "Manual adjustment by admin",
      createdAt: Date.now(),
      createdBy: adminUid,
    });
    showToast(`Adjusted ${phone} by ${deltaPoints} points`, "success");
  } else {
    showToast("Adjustment failed — try again", "error");
  }
}
