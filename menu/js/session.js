/**
 * Menu/js/session.js
 * Implements:
 *   - Decision #5/#6: secure token validation — NEVER trust a ?table= number
 *   - "Active Session Behavior": if a session is already open for the
 *     table, every subsequent QR scan joins that SAME session so a
 *     family of 5 all order into one bill, not five separate ones.
 *   - "Customer App Validation Flow":
 *       Scan QR → Read Token → Validate Token → Find Table →
 *       Load Active Session → (join or create) → Load Menu
 */
import { db, OUTLET, outletRef, ref, get, onValue, set, push, update, runTransaction } from './firebase.js';

export const Session = {
    table: null,      // { id, number, capacity, status, token, currentSession, ... }
    tableId: null,
    session: null,     // { sessionId, tableId, status, orders:[...], runningTotal, grandTotal, ... }
    sessionId: null,
    currentGroupId: null, // which order group this browser belongs to
    _sessionUnsub: null,
};

/**
 * Reads ?t=TOKEN from the URL. Returns null if absent.
 * This is the ONLY table-identifying value ever read from the URL —
 * no ?table=07 style parameter is supported anywhere in this app.
 */
function getTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('t');
}

/**
 * Validates the token against /tables and returns the matching table
 * record, or null if no table has this token (Decision #5/#6).
 *
 * NOTE: this performs a single read of the whole /tables node and
 * filters client-side. This matches the architecture's "One Listener"
 * performance rule — there is no per-table read here, and the lookup
 * only happens once at boot, not on every render.
 */
async function validateToken(token) {
    if (!token) return null;
    const snap = await get(outletRef('tables'));
    const tables = snap.val() || {};
    const entry = Object.entries(tables).find(([, t]) => t.token === token && t.active !== false);
    if (!entry) return null;
    return { id: entry[0], ...entry[1] };
}

/**
 * Join-or-create logic (the "Active Session Behavior" spec):
 *   - If table.currentSession already points to an open session, join it.
 *   - Otherwise, create a new tableSessions/{sessionId} and point the
 *     table at it.
 * Uses a transaction on the table's currentSession field to avoid a
 * race when two people scan the same QR within the same second.
 */
/** Set to true when joinOrCreateSession creates a brand-new session (not joining existing). */
let _isNewSession = false;

async function joinOrCreateSession(table) {
    // Only read the specific session the table points to, never the whole node
    let existingSession = null;
    if (table.currentSession) {
        const snap = await get(outletRef(`tableSessions/${table.currentSession}`));
        existingSession = snap.val();
    }

    // If the table already has a currentSession AND it's still active, join it.
    if (existingSession && existingSession.status !== 'closed' && existingSession.status !== 'expired') {
        _isNewSession = false;
        return { id: table.currentSession, ...existingSession };
    }

    // If the existing session is expired/closed, clear the table's currentSession
    // pointer so the transaction below can create a fresh session.
    // Must set status:'free' to match the DB write rule for unauthenticated users.
    if (existingSession) {
        try {
            await update(outletRef(`tables/${table.id}`), { status: 'free', currentSession: null, updatedAt: Date.now() });
        } catch (e) {
            // Table write failed (permission / race) — let the transaction below retry
            console.warn('[Session] Could not clear expired session pointer:', e?.message || e);
        }
    }

    // Otherwise create a new session via a transaction on the table's
    // currentSession pointer — this prevents two concurrent scans from
    // each creating their own session for the same table.
    let createdSessionId = null;
    let createdSessionData = null;
    let committed = false;

    try {
        const txResult = await runTransaction(outletRef(`tables/${table.id}/currentSession`), (current) => {
            if (current) {
                // Someone else's transaction already created a session —
                // abort this one (return undefined cancels the transaction).
                return undefined;
            }
            const newRef = push(outletRef('tableSessions'));
            createdSessionId = newRef.key;
            const now = Date.now();
                createdSessionData = {
                    sessionId: newRef.key,
                    tableId: table.id,
                    tableNumber: table.number,
                    // tableToken deliberately omitted — tables node is
                    // world-readable by design (QR validation), but
                    // re-exposing the token in the session record is
                    // unnecessary surface area.
                    status: 'active',
                openedAt: now,
                closedAt: null,
                lastActivityAt: now,
                expiresAt: now + 7200000,
                customerName: '',
                guestCount: 1,
                specialNote: '',
                orders: [],
                runningTotal: 0,
                discount: 0,
                tax: 0,
                grandTotal: 0
            };
            return newRef.key;
        });
        committed = !!(txResult && txResult.committed);
    } catch (e) {
        console.warn('[Session] Transaction failed:', e?.message || e);
        return null;
    }

    if (committed && createdSessionId && createdSessionData) {
        _isNewSession = true;
        try {
            await set(outletRef(`tableSessions/${createdSessionId}`), createdSessionData);
        } catch (e) {
            // Session data write failed — roll back the table pointer to avoid orphan
            await set(outletRef(`tables/${table.id}/currentSession`), null).catch(() => {});
            throw e; // re-throw so caller knows creation failed
        }
        try {
            await update(outletRef(`tables/${table.id}`), { status: 'occupied', updatedAt: Date.now() });
        } catch (e) {
            console.warn('[Session] Status update failed after creation:', e?.message || e);
        }
        return { id: createdSessionId, ...createdSessionData };
    }
    // Transaction was aborted because another scan won the race —
    // re-read the table to pick up the session it created.
    const freshSnap = await get(outletRef(`tables/${table.id}`));
    const freshTable = freshSnap.val();
    if (!freshTable || !freshTable.currentSession) return null;
    const sessSnap = await get(outletRef(`tableSessions/${freshTable.currentSession}`));
    _isNewSession = false; // another scan created it, we just joined
    return { id: freshTable.currentSession, ...sessSnap.val() };
}

/**
 * Phase A: validates the QR token and sets Session.table / Session.tableId.
 * Session creation is deferred to ensureSession() (Phase B) so that a
 * QR scan alone never creates a stale session (Phase 3 / Session Timing).
 * Returns { ok: true } on success or { ok: false, reason } on failure.
 */
export async function initSession() {
    const token = getTokenFromUrl();
    const table = await validateToken(token);
    if (!table) return { ok: false, reason: 'invalid-token' };

    table.__outlet = OUTLET;
    Session.table = table;
    Session.tableId = table.id;

    // Session + order groups are created lazily by ensureSession()
    return { ok: true };
}

/**
 * Phase B: idempotent session creation — creates (or joins) a table
 * session, initialises order groups, and starts the live listener.
 *
 * Safe to call multiple times — returns immediately if a session already
 * exists. Call this from every code path that needs a session
 * (btnAddToOrder, btnPlaceOrder, placeOrder).
 *
 * Returns { ok: true, groupChoiceNeeded: bool, isNewSession: bool }
 *   groupChoiceNeeded → the caller should show the group choice screen
 *   isNewSession → the session was created just now (not joined from existing)
 */
/**
 * Atomically claims the session's FIRST order group. This is the piece
 * that was missing before: two tabs/devices both arriving at a freshly
 * occupied table at nearly the same moment used to each independently
 * decide "orderGroups is empty, I'll create Group A" — a plain push()+set()
 * with only an in-memory flag guarding it, which does nothing across tabs.
 *
 * This instead transacts directly on the orderGroups node: the callback
 * only writes the new group if orderGroups is STILL empty at the moment
 * the transaction actually commits on the server (Firebase re-runs the
 * callback against the live value, not a stale client read), so only one
 * of two racing tabs can ever win. Returns the winning groupId, or null
 * if this call lost the race — the caller falls through to the existing
 * group-choice screen instead of creating a competing duplicate group.
 */
async function _claimFirstGroup(label) {
    const groupsRef = outletRef(`tableSessions/${Session.sessionId}/orderGroups`);
    const newRef = push(groupsRef);
    const groupId = newRef.key;
    const groupData = {
        label: label || 'Group A',
        createdAt: Date.now(),
        status: 'active',
        orders: []
    };
    let won = false;
    try {
        const txResult = await runTransaction(groupsRef, (current) => {
            if (current && Object.keys(current).length > 0) {
                return undefined; // another tab already created the first group — abort
            }
            return { [groupId]: groupData };
        });
        won = !!(txResult && txResult.committed);
    } catch (e) {
        console.warn('[Session] First-group claim failed:', e?.message || e);
        return null;
    }
    if (!won) return null;
    Session.session.orderGroups = { [groupId]: groupData };
    Session.currentGroupId = groupId;
    sessionStorage.setItem(`_pizza_group_${Session.sessionId}`, groupId);
    return groupId;
}

export async function ensureSession() {
    if (Session.sessionId && Session.currentGroupId) {
        const st = Session.session?.status;
        if (st === 'closed' || st === 'expired') {
            Session.sessionId = null;
            Session.session = null;
            Session.currentGroupId = null;
        } else {
            _isNewSession = false;
            return { ok: true, isNewSession: false };
        }
    }

    // If sessionId is set but no group, reset so the full init path runs cleanly
    if (Session.sessionId && !Session.currentGroupId) {
        Session.sessionId = null;
        Session.session = null;
    }

    const session = await joinOrCreateSession(Session.table);
    if (!session) return { ok: false, reason: 'session-creation-failed' };
    Session.session = session;
    Session.sessionId = session.id;

    // --- Order Group initialization (moved from initSession) ---
    _groupCounter = session.orderGroups ? Object.keys(session.orderGroups).length : 0;
    if (!session.orderGroups || Object.keys(session.orderGroups).length === 0) {
        // Race-safe claim — see _claimFirstGroup() above.
        const groupId = await _claimFirstGroup('Group A');
        if (groupId) {
            // We won the race — legitimately the first tab at this table.
            // Migrate any pre-existing session orders (from before Phase 2) into Group A
            if (Array.isArray(session.orders) && session.orders.length > 0) {
                try {
                    await set(outletRef(`tableSessions/${Session.sessionId}/orderGroups/${groupId}/orders`), session.orders);
                    if (Session.session?.orderGroups?.[groupId]) {
                        Session.session.orderGroups[groupId].orders = [...session.orders];
                    }
                } catch (e) {
                    console.warn('[Session] Legacy order migration failed:', e);
                }
            }
            watchSession();
            return { ok: true, groupChoiceNeeded: false, isNewSession: _isNewSession };
        }

        // Lost the race (or a genuine write failure) — re-read the live
        // group list instead of acting on the stale "empty" snapshot from
        // above. Another tab's group now exists; this tab did NOT create
        // one of its own, so route to the choice screen.
        const freshSnap = await get(outletRef(`tableSessions/${Session.sessionId}/orderGroups`));
        const freshGroups = freshSnap.val();
        if (!freshGroups || Object.keys(freshGroups).length === 0) {
            return { ok: false, reason: 'group-creation-failed' };
        }
        Session.session.orderGroups = freshGroups;
        Session.currentGroupId = null;
        watchSession();
        return { ok: true, groupChoiceNeeded: true, isNewSession: _isNewSession };
    } else {
        // sessionStorage is PRIVATE per tab (unlike localStorage, which is
        // shared across every tab of the same browser). This is what stops
        // one tab's group choice from silently overwriting another tab's.
        const savedGroupId = sessionStorage.getItem(`_pizza_group_${session.id}`);
        if (savedGroupId && session.orderGroups[savedGroupId] && session.orderGroups[savedGroupId].status === 'active') {
            Session.currentGroupId = savedGroupId;
            watchSession();
            return { ok: true, groupChoiceNeeded: false, isNewSession: _isNewSession };
        } else {
            Session.currentGroupId = null;
            watchSession();
            return { ok: true, groupChoiceNeeded: true, isNewSession: _isNewSession };
        }
    }
    // --- END ---
}

/**
 * Live-watches the session so the running bill and order list update
 * in real time as the kitchen/admin (or other guests at the table)
 * change order statuses or add items.
 */
function watchSession() {
    if (Session._sessionUnsub) Session._sessionUnsub();
    Session._sessionUnsub = onValue(outletRef(`tableSessions/${Session.sessionId}`), (snap) => {
        const data = snap.val();
        if (!data) return;
        Session.session = { id: Session.sessionId, ...data };
        window.dispatchEvent(new CustomEvent('session:updated', { detail: Session.session }));
    });
}

/**
 * Creates a new order group under the current session.
 * Order groups let multiple customers at the same table split
 * their orders into separate bills (Multi-Bill / Order Groups).
 * Returns the new group's Firebase push key.
 */
let _groupCounter = 0;
let _creatingGroup = false;
export async function createOrderGroup(label) {
    if (!Session.sessionId) return null;
    if (_creatingGroup) return null; // guard against a double-click within THIS tab only —
    _creatingGroup = true;           // this is a deliberate user action ("Start My Own Bill"),
    try {                            // so creating an additional group here is intended, not a race
    const groupsRef = outletRef(`tableSessions/${Session.sessionId}/orderGroups`);
    const newRef = push(groupsRef);
    const groupId = newRef.key;
    const now = Date.now();
    const groupData = {
        label: label || `Group ${String.fromCharCode(64 + _groupCounter + 1)}`,
        createdAt: now,
        status: 'active',
        orders: []
    };
    await set(newRef, groupData);
    _groupCounter++;
    // Update local session cache so watchSession() picks it up
    if (!Session.session.orderGroups) Session.session.orderGroups = {};
    Session.session.orderGroups[groupId] = groupData;
    Session.currentGroupId = groupId;
    sessionStorage.setItem(`_pizza_group_${Session.sessionId}`, groupId);
    return groupId;
    } finally {
        _creatingGroup = false;
    }
}

/**
 * Returns the order IDs belonging to the current group,
 * or falls back to all session orders if no group context.
 */
export function getCurrentGroupOrders() {
    if (!Session.session) return [];
    if (Session.currentGroupId && Session.session.orderGroups && Session.session.orderGroups[Session.currentGroupId]) {
        return Session.session.orderGroups[Session.currentGroupId].orders || [];
    }
    // When no group is selected (group choice needed), return empty list
    // to avoid leaking other groups' orders via the session-level orders fallback.
    return [];
}

/**
 * Appends a newly placed order's id into the session's orders[] array
 * and recomputes the running totals — this is what turns "3 separate
 * orders" into "1 running bill" (Decision #4).
 */
export async function attachOrderToSession(orderId, orderTotals, groupId) {
    // Single atomic transaction: session-level totals + group-level orders updated together
    // Abort if session or group is in billing/paid/closed/expired state (race condition guard)
    // Returns true if the order was attached, false if aborted (session/group no longer active)
    const result = await runTransaction(outletRef(`tableSessions/${Session.sessionId}`), (sess) => {
        if (!sess) return undefined;
        if (sess.status === 'billing' || sess.status === 'closed' || sess.status === 'expired') return undefined;
        if (groupId) {
            const g = sess.orderGroups?.[groupId];
            if (g && (g.status === 'billing' || g.status === 'paid')) return undefined;
        }
        const now = Date.now();
        sess.orders = Array.isArray(sess.orders) ? sess.orders : [];
        if (!sess.orders.includes(orderId)) sess.orders.push(orderId);
        sess.runningTotal = (sess.runningTotal || 0) + (orderTotals.subtotal || 0);
        sess.tax = (sess.tax || 0) + (orderTotals.tax || 0);
        sess.serviceCharge = (sess.serviceCharge || 0) + (orderTotals.serviceCharge || 0);
        // Apply discount per order onto session discount
        sess.discount = (sess.discount || 0) + (orderTotals.discountAmount || 0);
        sess.grandTotal = (sess.grandTotal || 0) + (orderTotals.total || 0);
        sess.lastActivityAt = now;
        sess.expiresAt = now + 7200000;
        // Also push the order ID into the group's orders array in the same transaction
        if (groupId) {
            if (!sess.orderGroups) sess.orderGroups = {};
            if (!sess.orderGroups[groupId]) return undefined; // group missing — abort transaction
            sess.orderGroups[groupId].orders = Array.isArray(sess.orderGroups[groupId].orders) ? sess.orderGroups[groupId].orders : [];
            if (!sess.orderGroups[groupId].orders.includes(orderId)) sess.orderGroups[groupId].orders.push(orderId);
        }
        return sess;
    });
    // result is the committed value or null if aborted
    return result != null;
}

/**
 * Heartbeat — refreshes the session's inactivity timer so the session
 * does not expire while the customer is actively using the app.
 * Debounced client-side: at most one write per 60 seconds.
 */
const HEARTBEAT_MS = 60000;
let _lastHeartbeat = 0;

export async function touchSession() {
    const now = Date.now();
    if (now - _lastHeartbeat < HEARTBEAT_MS) return;
    if (!Session.sessionId) return;
    await update(outletRef(`tableSessions/${Session.sessionId}`), {
        lastActivityAt: now,
        expiresAt: now + 7200000
    });
    _lastHeartbeat = now;
}

/** Saves customer name, phone, guest count, and special note on the session record. */
export async function saveCheckoutContact(name, phone, guestCount, specialNote) {
    if (!Session.sessionId) return;
    const now = Date.now();
    const cleanPhone = (phone || '').replace(/[^\d]/g, '');
    const updates = { lastActivityAt: now, expiresAt: now + 7200000 };
    if (typeof guestCount === 'number' && guestCount > 0) updates.guestCount = guestCount;
    if (specialNote) updates.specialNote = specialNote;
    await update(outletRef(`tableSessions/${Session.sessionId}`), updates);
    // Write PII to a restricted path (world-readable tableSessions no longer gets phone data)
    const contactPayload = { customerName: name || '', customerPhone: phone || '', guestPhone: cleanPhone };
    if (typeof guestCount === 'number' && guestCount > 0) contactPayload.guestCount = guestCount;
    if (specialNote) contactPayload.specialNote = specialNote;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await update(outletRef(`tableSessionsContact/${Session.sessionId}`), contactPayload);
            return;
        } catch (e) {
            if (attempt === 0) await new Promise(r => setTimeout(r, 500));
            else console.warn('[Session] PII write failed', e?.message || e);
        }
    }
}

export function cleanupSession() {
    if (Session._sessionUnsub) { Session._sessionUnsub(); Session._sessionUnsub = null; }
    if (Session.sessionId) {
        sessionStorage.removeItem(`_pizza_group_${Session.sessionId}`);
    }
    sessionStorage.removeItem('_pizza_draft');
    Session.sessionId = null;
    Session.session = null;
    Session.currentGroupId = null;
    Session.table = null;
}
