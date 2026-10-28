/**
 * FoodHubbie Demo — synthetic dataset.
 *
 * Everything here is invented. No production record, customer, employee or
 * credential is ever read into the demo (the demo page never loads the Firebase
 * SDK at all — see tools/check-demo-nav.cjs).
 *
 * Money is computed with the REAL shared/money-math.js, so demo totals follow
 * exactly the same rounding/tax/service-charge rules as the live ERP.
 */

import { computeOrderTotals, round2 } from '../../shared/money-math.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Deterministic PRNG — reset must always restore the same demo state.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const DEMO_OUTLET = {
    oid: 'demo',
    name: 'Bella Napoli',
    displayName: 'Bella Napoli — Bandra West',
    tagline: 'Demo Restaurant · Synthetic Data Only',
    entity: 'Bella Napoli Hospitality LLP (demo)',
    address: '14 Hill Road, Bandra West, Mumbai 400050 (demo address)',
    phone: '+91 90000 00001',
    email: 'demo@foodhubbie.example',
    gstin: '27AAAAA0000A1Z5',
    fssai: '10000000000000',
    timezone: 'Asia/Kolkata',
};

const DISHES = [
    { id: 'd1', name: 'Margherita', category: 'Pizzas', price: 299, veg: true, desc: 'San Marzano tomato, fior di latte, basil', prep: 12, available: true, gstRate: 5 },
    { id: 'd2', name: 'Pepperoni Classic', category: 'Pizzas', price: 399, veg: false, desc: 'Double pepperoni, mozzarella, oregano', prep: 14, available: true, gstRate: 5 },
    { id: 'd3', name: 'Farmhouse', category: 'Pizzas', price: 349, veg: true, desc: 'Capsicum, onion, corn, mushroom', prep: 13, available: true, gstRate: 5 },
    { id: 'd4', name: 'Paneer Tikka', category: 'Pizzas', price: 379, veg: true, desc: 'Tandoori paneer, mint drizzle, onion', prep: 15, available: true, gstRate: 5 },
    { id: 'd5', name: 'Quattro Formaggi', category: 'Pizzas', price: 449, veg: true, desc: 'Mozzarella, cheddar, parmesan, blue cheese', prep: 15, available: false, gstRate: 5 },
    { id: 'd6', name: 'Garlic Bread', category: 'Sides', price: 149, veg: true, desc: 'Baked with garlic butter and herbs', prep: 7, available: true, gstRate: 5 },
    { id: 'd7', name: 'Cheesy Nachos', category: 'Sides', price: 199, veg: true, desc: 'Corn chips, cheese sauce, jalapeños', prep: 8, available: true, gstRate: 5 },
    { id: 'd8', name: 'Peri Peri Fries', category: 'Sides', price: 169, veg: true, desc: 'Crisp fries tossed in peri peri', prep: 9, available: true, gstRate: 5 },
    { id: 'd9', name: 'Alfredo Pasta', category: 'Pasta', price: 329, veg: true, desc: 'Creamy parmesan alfredo, penne', prep: 14, available: true, gstRate: 5 },
    { id: 'd10', name: 'Arrabbiata Pasta', category: 'Pasta', price: 299, veg: true, desc: 'Spicy tomato basil sauce', prep: 13, available: true, gstRate: 5 },
    { id: 'd11', name: 'Chocolate Lava Cake', category: 'Desserts', price: 179, veg: true, desc: 'Warm molten centre, vanilla scoop', prep: 6, available: true, gstRate: 5 },
    { id: 'd12', name: 'Tiramisu', category: 'Desserts', price: 199, veg: true, desc: 'Espresso-soaked savoiardi, mascarpone', prep: 5, available: true, gstRate: 5 },
    { id: 'd13', name: 'Cold Coffee', category: 'Drinks', price: 149, veg: true, desc: 'Iced coffee, milk, hazelnut', prep: 4, available: true, gstRate: 5 },
    { id: 'd14', name: 'Fresh Lime Soda', category: 'Drinks', price: 99, veg: true, desc: 'Lime, soda, black salt', prep: 3, available: true, gstRate: 5 },
];

const CATEGORIES = [
    { id: 'c1', name: 'Pizzas', icon: 'pizza', order: 1, visible: true, desc: 'Wood-fired 11-inch pizzas' },
    { id: 'c2', name: 'Sides', icon: 'fries', order: 2, visible: true, desc: 'Small plates & sharing' },
    { id: 'c3', name: 'Pasta', icon: 'chef-hat', order: 3, visible: true, desc: 'Freshly tossed' },
    { id: 'c4', name: 'Desserts', icon: 'cake-slice', order: 4, visible: true, desc: 'Sweet endings' },
    { id: 'c5', name: 'Drinks', icon: 'cup-soda', order: 5, visible: true, desc: 'Cold & fresh' },
];

const COMBOS = [
    { id: 'cb1', name: 'Family Feast', items: [['d1', 2], ['d6', 1], ['d13', 2]], price: 899, original: 1045, active: true, window: 'All day', redeemed: 12, cap: 50 },
    { id: 'cb2', name: 'Meal for Two', items: [['d3', 1], ['d8', 1], ['d14', 2]], price: 649, original: 785, active: true, window: 'All day', redeemed: 21, cap: 100 },
    { id: 'cb3', name: 'Sweet Ending', items: [['d11', 1], ['d13', 1]], price: 279, original: 328, active: false, window: '4pm – 8pm', redeemed: 5, cap: 30 },
];

const RIDERS = [
    { id: 'r1', name: 'Arjun Mehta', phone: '+91 90000 00101', status: 'Online', zone: 'Bandra West', deliveries: 3, wallet: 480, rating: 4.8, vehicle: 'Bike · MH02 DEMO 1' },
    { id: 'r2', name: 'Priya Nair', phone: '+91 90000 00102', status: 'On delivery', zone: 'Khar', deliveries: 2, wallet: 320, rating: 4.9, vehicle: 'Scooter · MH02 DEMO 2' },
    { id: 'r3', name: 'Sameer Khan', phone: '+91 90000 00103', status: 'Offline', zone: 'Santacruz', deliveries: 0, wallet: 150, rating: 4.6, vehicle: 'Bike · MH02 DEMO 3' },
    { id: 'r4', name: 'Neha Verma', phone: '+91 90000 00104', status: 'Online', zone: 'Bandra East', deliveries: 1, wallet: 210, rating: 4.7, vehicle: 'Scooter · MH02 DEMO 4' },
];

const CUSTOMERS = [
    { id: 'cu1', name: 'Aarav Sharma', phone: '+91 90000 00201', orders: 7, spend: 4380, last: 'Today', tier: 'Gold', points: 438 },
    { id: 'cu2', name: 'Diya Kapoor', phone: '+91 90000 00202', orders: 5, spend: 2890, last: 'Today', tier: 'Silver', points: 289 },
    { id: 'cu3', name: 'Kabir Malhotra', phone: '+91 90000 00203', orders: 4, spend: 2210, last: 'Yesterday', tier: 'Silver', points: 221 },
    { id: 'cu4', name: 'Ishita Rai', phone: '+91 90000 00204', orders: 3, spend: 1640, last: 'Yesterday', tier: 'Bronze', points: 164 },
    { id: 'cu5', name: 'Rohan Gupta', phone: '+91 90000 00205', orders: 3, spend: 1580, last: '2 days ago', tier: 'Bronze', points: 158 },
    { id: 'cu6', name: 'Meera Pillai', phone: '+91 90000 00206', orders: 2, spend: 990, last: '3 days ago', tier: 'Bronze', points: 99 },
    { id: 'cu7', name: 'Zoya Ali', phone: '+91 90000 00207', orders: 2, spend: 860, last: '4 days ago', tier: 'Bronze', points: 86 },
    { id: 'cu8', name: 'Aditya Menon', phone: '+91 90000 00208', orders: 1, spend: 399, last: '5 days ago', tier: 'Bronze', points: 39 },
];

const STAFF = [
    { uid: 's1', displayName: 'Ramesh Iyer', role: 'owner', payType: 'MONTHLY', rate: 60000, status: 'Active', lastSignIn: 'Today 09:12', email: 'ramesh.iyer@demo.example' },
    { uid: 's2', displayName: 'Sunita Rao', role: 'manager', payType: 'MONTHLY', rate: 36000, status: 'Active', lastSignIn: 'Today 10:04', email: 'sunita.rao@demo.example' },
    { uid: 's3', displayName: 'Amit Das', role: 'cashier', payType: 'HOURLY', rate: 180, status: 'Active', lastSignIn: 'Today 11:30', email: 'amit.das@demo.example' },
    { uid: 's4', displayName: 'Vikram Joshi', role: 'waiter', payType: 'HOURLY', rate: 160, status: 'Active', lastSignIn: 'Yesterday 19:45', email: 'vikram.joshi@demo.example' },
    { uid: 's5', displayName: 'Farah Sheikh', role: 'waiter', payType: 'HOURLY', rate: 160, status: 'Invited', lastSignIn: '—', email: 'farah.sheikh@demo.example' },
];

const INVENTORY = [
    { id: 'i1', name: 'Pizza Flour (Type 00)', unit: 'kg', stock: 42, min: 20, cost: 78, supplier: 'Mumbai Mill Co.' },
    { id: 'i2', name: 'Mozzarella Block', unit: 'kg', stock: 8.5, min: 10, cost: 420, supplier: 'Dairyline Foods' },
    { id: 'i3', name: 'San Marzano Tomatoes', unit: 'kg', stock: 24, min: 12, cost: 165, supplier: 'Dairyline Foods' },
    { id: 'i4', name: 'Pepperoni Slices', unit: 'kg', stock: 3.2, min: 4, cost: 690, supplier: 'Cure & Co.' },
    { id: 'i5', name: 'Basil (fresh)', unit: 'bunch', stock: 6, min: 8, cost: 25, supplier: 'Local Mandi' },
    { id: 'i6', name: 'Penne Pasta', unit: 'kg', stock: 15, min: 6, cost: 140, supplier: 'Mumbai Mill Co.' },
    { id: 'i7', name: 'Cream (fresh)', unit: 'ltr', stock: 5, min: 6, cost: 220, supplier: 'Dairyline Foods' },
    { id: 'i8', name: 'Chocolate Couverture', unit: 'kg', stock: 4.4, min: 2, cost: 540, supplier: 'Sweet Supply' },
    { id: 'i9', name: 'Coffee Beans', unit: 'kg', stock: 2.1, min: 2, cost: 980, supplier: 'Roast Lab' },
    { id: 'i10', name: 'Takeaway Boxes (11")', unit: 'pcs', stock: 320, min: 200, cost: 9, supplier: 'PackRight' },
];

const SUPPLIERS = [
    { id: 'sp1', name: 'Dairyline Foods', contact: '+91 90000 00301', items: 3, outstanding: 12400, terms: 'Net 15' },
    { id: 'sp2', name: 'Mumbai Mill Co.', contact: '+91 90000 00302', items: 2, outstanding: 0, terms: 'Net 7' },
    { id: 'sp3', name: 'Sweet Supply', contact: '+91 90000 00303', items: 1, outstanding: 3180, terms: 'Net 30' },
    { id: 'sp4', name: 'PackRight', contact: '+91 90000 00304', items: 1, outstanding: 0, terms: 'Prepaid' },
];

const EXPENSE_CATEGORIES = ['Rent', 'Utilities', 'Salaries', 'Raw Material', 'Marketing', 'Maintenance', 'Software'];

const EXPENSES = [
    { id: 'e1', date: 'Today', category: 'Raw Material', vendor: 'Dairyline Foods', amount: 8600, method: 'UPI', status: 'Approved', note: 'Weekly dairy restock' },
    { id: 'e2', date: 'Today', category: 'Utilities', vendor: 'Adani Electricity', amount: 4120, method: 'Netbanking', status: 'Pending', note: 'September meter' },
    { id: 'e3', date: 'Yesterday', category: 'Marketing', vendor: 'Meta Ads', amount: 2500, method: 'Card', status: 'Approved', note: 'Weekend reach campaign' },
    { id: 'e4', date: '2 days ago', category: 'Maintenance', vendor: 'CoolAir Services', amount: 1800, method: 'Cash', status: 'Approved', note: 'AC service — dining area' },
    { id: 'e5', date: '3 days ago', category: 'Salaries', vendor: 'Payroll run', amount: 42000, method: 'Bank', status: 'Approved', note: 'Fortnightly payout (demo)' },
    { id: 'e6', date: '4 days ago', category: 'Software', vendor: 'FoodHubbie', amount: 1990, method: 'Card', status: 'Approved', note: 'Monthly subscription (demo)' },
];

const PROMOTIONS = [
    { id: 'p1', name: 'Friday Family Feast', status: 'Sent', channel: 'WhatsApp', audience: 'All customers', recipients: 214, delivered: 209, shell: 'promo_hinglish_offer', sentAt: 'Yesterday 18:30', message: 'Weekend pe ghar pe pizza — Family Feast sirf ₹899. Aaj order karein!' },
    { id: 'p2', name: 'Win-back — 30 days idle', status: 'Scheduled', channel: 'WhatsApp', audience: 'Idle 30+ days', recipients: 68, delivered: 0, shell: 'promo_hinglish_winback', sentAt: 'Tomorrow 12:00', message: 'Aapko miss kar rahe hain! ₹100 off aapke agle order par.' },
    { id: 'p3', name: 'Festive Sweet Ending', status: 'Draft', channel: 'WhatsApp', audience: 'Dessert lovers', recipients: 0, delivered: 0, shell: 'promo_hinglish_festive', sentAt: '—', message: 'Tyohaar ka meetha — Sweet Ending combo ₹279.' },
];

const DISCOUNTS = [
    { id: 'ds1', code: 'WELCOME10', type: 'percent', value: 10, active: true, channel: 'All channels', uses: 42, cap: 500, minOrder: 299, window: 'Always on' },
    { id: 'ds2', code: 'LOYAL100', type: 'flat', value: 100, active: true, channel: 'Delivery', uses: 17, cap: 200, minOrder: 599, window: 'Always on' },
    { id: 'ds3', code: 'HAPPYHOUR', type: 'percent', value: 15, active: true, channel: 'Dine-in', uses: 9, cap: 150, minOrder: 0, window: '15:00 – 18:00' },
    { id: 'ds4', code: 'FAMILY50', type: 'flat', value: 50, active: false, channel: 'All channels', uses: 31, cap: 100, minOrder: 899, window: 'Paused' },
];

const FEEDBACK = [
    { id: 'f1', orderId: 'BN-271026-3', customer: 'Aarav Sharma', rating: 5, comment: 'Fast delivery and the crust was perfect.', at: 'Today 12:40' },
    { id: 'f2', orderId: 'BN-271026-1', customer: 'Diya Kapoor', rating: 4, comment: 'Great food, garlic bread was slightly cold.', at: 'Today 11:15' },
    { id: 'f3', orderId: 'BN-261026-2', customer: 'Kabir Malhotra', rating: 5, comment: 'Lava cake is unreal. Will order again.', at: 'Yesterday 21:02' },
    { id: 'f4', orderId: 'BN-261026-4', customer: 'Ishita Rai', rating: 3, comment: 'Delivery took longer than promised.', at: 'Yesterday 20:10' },
    { id: 'f5', orderId: 'BN-251026-1', customer: 'Rohan Gupta', rating: 4, comment: 'Good value family combo.', at: '2 days ago' },
    { id: 'f6', orderId: 'BN-241026-3', customer: 'Meera Pillai', rating: 5, comment: 'Polite rider, food still hot.', at: '3 days ago' },
];

const CHATS = [
    {
        id: 'ch1', name: 'Aarav Sharma', phone: '+91 90000 00201', unread: 1, last: 'Today 12:31',
        messages: [
            { from: 'customer', text: 'Hi, do you have jain pizza?', at: '12:28' },
            { from: 'restaurant', text: 'Yes! Margherita can be made jain — no onion, no garlic. Shall I place the order?', at: '12:30' },
            { from: 'customer', text: 'Yes please, 1 Margherita jain.', at: '12:31' },
        ]
    },
    {
        id: 'ch2', name: 'Diya Kapoor', phone: '+91 90000 00202', unread: 0, last: 'Today 11:48',
        messages: [
            { from: 'customer', text: 'Where is my order?', at: '11:40' },
            { from: 'restaurant', text: 'It is out for delivery with Arjun — about 8 minutes away.', at: '11:44' },
            { from: 'customer', text: 'Thanks!', at: '11:48' },
        ]
    },
    {
        id: 'ch3', name: 'Kabir Malhotra', phone: '+91 90000 00203', unread: 2, last: 'Yesterday 21:10',
        messages: [
            { from: 'customer', text: 'Can I get extra cheese on the Farmhouse?', at: '21:05' },
            { from: 'restaurant', text: 'Sure, extra cheese is ₹49.', at: '21:06' },
            { from: 'customer', text: 'Add it please.', at: '21:09' },
            { from: 'customer', text: 'Also add a lime soda.', at: '21:10' },
        ]
    },
];

const NOTIFICATIONS = [
    { id: 'n1', type: 'order', title: 'New order #BN-271026-4', body: 'Table 5 · 2 items · ₹698', at: '2 min ago', read: false },
    { id: 'n2', type: 'order', title: 'Order #BN-271026-3 is out for delivery', body: 'Assigned to Arjun Mehta', at: '18 min ago', read: false },
    { id: 'n3', type: 'bill', title: 'Bill requested — Table 2', body: 'Session open for 48 minutes', at: '26 min ago', read: false },
    { id: 'n4', type: 'stock', title: 'Low stock: Mozzarella Block', body: '8.5 kg left (minimum 10 kg)', at: '1 hr ago', read: true },
    { id: 'n5', type: 'feedback', title: 'New 3★ feedback', body: 'Order #BN-261026-4 — delivery time', at: 'Yesterday', read: true },
    { id: 'n6', type: 'system', title: 'Demo Mode active', body: 'All actions are simulated. Nothing is sent or saved.', at: 'Today', read: true },
];

const TEMPLATES = [
    { name: 'order_confirmation', category: 'UTILITY', status: 'Approved', params: 4 },
    { name: 'rider_assigned', category: 'UTILITY', status: 'Approved', params: 3 },
    { name: 'order_ready', category: 'UTILITY', status: 'Approved', params: 2 },
    { name: 'proactive_promo', category: 'MARKETING', status: 'Approved', params: 1 },
    { name: 'promo_hinglish_offer', category: 'MARKETING', status: 'Approved', params: 1 },
    { name: 'promo_hinglish_winback', category: 'MARKETING', status: 'Approved', params: 1 },
    { name: 'greeting_welcome', category: 'MARKETING', status: 'Pending review', params: 2 },
    { name: 'otp_delivery', category: 'AUTHENTICATION', status: 'Rejected (plain text)', params: 2 },
];

const ROLES = {
    admin: { name: 'Admin', level: 2, tabs: ['*'] },
    owner: { name: 'Owner', level: 2, tabs: ['*'] },
    manager: { name: 'Manager', level: 1, tabs: ['dashboard', 'orders', 'live', 'walkin', 'tables', 'promotions', 'discounts', 'menu', 'categories', 'combos', 'menu-browser', 'inventory', 'riders', 'customers', 'loyalty', 'chat', 'reports', 'riderAnalytics', 'feedback', 'liveTracker', 'notifications', 'payments', 'expenses', 'costs'] },
    cashier: { name: 'Cashier', level: 0, tabs: ['dashboard', 'walkin', 'tables', 'orders', 'live', 'notifications'] },
    waiter: { name: 'Waiter', level: -1, tabs: ['orders', 'live', 'notifications'] },
};

const AUDIT_LOG = [
    { at: 'Today 12:42', actor: 'Sunita Rao', action: 'discount.applied', detail: 'WELCOME10 on #BN-271026-1' },
    { at: 'Today 11:58', actor: 'Ramesh Iyer', action: 'settings.viewed', detail: 'Tax & Services' },
    { at: 'Today 10:04', actor: 'Sunita Rao', action: 'staff.clock_in', detail: 'Shift started' },
    { at: 'Yesterday 22:14', actor: 'Amit Das', action: 'pos.sale', detail: 'Walk-in ₹842 · UPI' },
    { at: 'Yesterday 20:02', actor: 'Ramesh Iyer', action: 'order.refunded', detail: '#BN-261026-4 · ₹299' },
];

// --- Order building ---------------------------------------------------------

const TABLES = [
    { id: 'T1', label: 'Table 1', seats: 2, zone: 'Window' },
    { id: 'T2', label: 'Table 2', seats: 4, zone: 'Main' },
    { id: 'T3', label: 'Table 3', seats: 4, zone: 'Main' },
    { id: 'T4', label: 'Table 4', seats: 6, zone: 'Garden' },
    { id: 'T5', label: 'Table 5', seats: 2, zone: 'Garden' },
    { id: 'T6', label: 'Table 6', seats: 4, zone: 'Main' },
    { id: 'T7', label: 'Table 7', seats: 8, zone: 'Private' },
    { id: 'T8', label: 'Table 8', seats: 2, zone: 'Window' },
];

export function buildDemoState() {
    const rnd = mulberry32(20261027);
    const now = Date.now();
    const dishById = Object.fromEntries(DISHES.map(d => [d.id, d]));

    const tableSessions = {
        T1: { id: 'sess-1', guestName: 'Diya Kapoor', openedMinsAgo: 96, billRequested: false, phone: '+91 90000 00202' },
        T2: { id: 'sess-2', guestName: 'Walk-in guest', openedMinsAgo: 48, billRequested: true, phone: '' },
        T5: { id: 'sess-3', guestName: 'Kabir Malhotra', openedMinsAgo: 19, billRequested: false, phone: '+91 90000 00203' },
        T7: { id: 'sess-4', guestName: 'Office group (6)', openedMinsAgo: 12, billRequested: false, phone: '' },
    };

    let seq = 0;
    function stamp(minsAgo) { return new Date(now - minsAgo * MIN); }

    function dayKey(d) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(2);
        return `${dd}${mm}${yy}`;
    }

    function makeOrder(spec) {
        const created = stamp(spec.minsAgo);
        const type = spec.type;
        const lines = spec.lines.map(([id, qty]) => {
            const d = dishById[id];
            return { id, name: d.name, qty, price: d.price };
        });
        if (spec.combo) {
            const cb = COMBOS.find(c => c.id === spec.combo);
            lines.push({ id: cb.id, name: `${cb.name} (combo)`, qty: 1, price: cb.price });
        }
        const subtotal = round2(lines.reduce((s, l) => s + l.price * l.qty, 0));
        const dineIn = type === 'dine-in';
        const deliveryFee = type === 'delivery' ? (subtotal >= 499 ? 0 : 29) : 0;
        const totals = computeOrderTotals({
            subtotal,
            discount: spec.discount || 0,
            taxRates: dineIn
                ? [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }]
                : [{ name: 'GST', rate: 5 }],
            serviceChargeEnabled: dineIn,
            serviceChargeRate: 5,
            deliveryFee,
        });
        seq += 1;
        return {
            id: `${dayKey(created)}-${seq}`,
            orderId: `BN-${dayKey(created)}-${seq}`,
            type,
            source: spec.source,
            status: spec.status,
            paymentStatus: spec.paid === false ? 'Pending' : 'Paid',
            paymentMethod: spec.paymentMethod || 'UPI',
            customerName: spec.customer || 'Walk-in guest',
            phone: spec.phone || '',
            address: spec.address || '',
            tableId: spec.tableId || null,
            sessionId: spec.tableId && tableSessions[spec.tableId] ? tableSessions[spec.tableId].id : null,
            riderId: spec.riderId || null,
            riderName: spec.riderId ? (RIDERS.find(r => r.id === spec.riderId) || {}).name : '',
            items: lines,
            subtotal: totals.subtotal,
            discount: totals.discount,
            discountCode: spec.discountCode || '',
            taxable: totals.taxable,
            taxItems: totals.taxItems,
            tax: totals.tax,
            serviceCharge: totals.serviceCharge,
            deliveryFee: totals.deliveryFee,
            total: totals.total,
            createdAt: created.toISOString(),
            note: spec.note || '',
        };
    }

    const orders = [
        // --- Today, live board ---
        makeOrder({ minsAgo: 12, type: 'dine-in', source: 'QR', status: 'Preparing', tableId: 'T7', customer: 'Office group (6)', phone: '', paid: false, lines: [['d1', 3], ['d3', 2], ['d7', 2]], paymentMethod: 'Pending' }),
        makeOrder({ minsAgo: 18, type: 'dine-in', source: 'QR', status: 'Confirmed', tableId: 'T5', customer: 'Kabir Malhotra', phone: '+91 90000 00203', paid: false, lines: [['d2', 1], ['d8', 1], ['d14', 2]], paymentMethod: 'Pending' }),
        makeOrder({ minsAgo: 26, type: 'delivery', source: 'WA', status: 'Out for Delivery', customer: 'Aarav Sharma', phone: '+91 90000 00201', address: 'B-402, Sea Breeze, Bandra West', riderId: 'r1', paid: true, paymentMethod: 'UPI', lines: [['d2', 1], ['d6', 1], ['d13', 2]] }),
        makeOrder({ minsAgo: 8, type: 'takeaway', source: 'WA', status: 'Placed', customer: 'Zoya Ali', phone: '+91 90000 00207', paid: false, lines: [['d9', 1], ['d11', 1]], paymentMethod: 'Pending' }),
        makeOrder({ minsAgo: 42, type: 'delivery', source: 'webview_delivery', status: 'Reached Drop Location', customer: 'Ishita Rai', phone: '+91 90000 00204', address: '7/A Hill Road, Bandra West', riderId: 'r2', paid: true, paymentMethod: 'UPI', discount: 100, discountCode: 'LOYAL100', lines: [['d3', 1], ['d10', 1], ['d14', 2]] }),
        makeOrder({ minsAgo: 96, type: 'dine-in', source: 'QR', status: 'Served', tableId: 'T1', customer: 'Diya Kapoor', phone: '+91 90000 00202', paid: true, paymentMethod: 'Card', lines: [['d1', 1], ['d6', 1], ['d13', 2]] }),
        makeOrder({ minsAgo: 128, type: 'delivery', source: 'WA', status: 'Delivered', customer: 'Aarav Sharma', phone: '+91 90000 00201', address: 'B-402, Sea Breeze, Bandra West', riderId: 'r1', paid: true, paymentMethod: 'UPI', lines: [['d4', 2], ['d13', 2]] }),
        makeOrder({ minsAgo: 156, type: 'pos', source: 'POS', status: 'Served', customer: 'Walk-in guest', paid: true, paymentMethod: 'Cash', lines: [['d1', 1], ['d8', 1], ['d14', 1]] }),
        makeOrder({ minsAgo: 205, type: 'delivery', source: 'webview_delivery', status: 'Delivered', customer: 'Meera Pillai', phone: '+91 90000 00206', address: '12 Carter Road, Bandra West', riderId: 'r4', paid: true, paymentMethod: 'COD', discount: 30, discountCode: 'WELCOME10', lines: [['d3', 1], ['d7', 1]] }),
        makeOrder({ minsAgo: 248, type: 'dine-in', source: 'QR', status: 'Served', tableId: 'T3', customer: 'Rohan Gupta', phone: '+91 90000 00205', paid: true, paymentMethod: 'UPI', lines: [['d2', 1], ['d11', 2]] }),
        makeOrder({ minsAgo: 300, type: 'delivery', source: 'WA', status: 'Delivered', customer: 'Aditya Menon', phone: '+91 90000 00208', address: '4 Pali Naka, Bandra West', riderId: 'r1', paid: true, paymentMethod: 'UPI', lines: [['d2', 1]] }),
        // --- Cancelled (excluded from revenue, visible in history) ---
        makeOrder({ minsAgo: 74, type: 'delivery', source: 'WA', status: 'Cancelled', customer: 'Kabir Malhotra', phone: '+91 90000 00203', address: '21 Turner Road, Bandra West', paid: false, lines: [['d5', 1]], note: 'Customer cancelled — item unavailable' }),
    ];

    // --- Previous 6 days (completed history) so Analytics has a real trend ---
    const historyMenu = [
        [['d1', 1], ['d13', 1]],
        [['d3', 2], ['d8', 1]],
        [['d2', 1], ['d6', 1], ['d14', 2]],
        [['d9', 1], ['d11', 1]],
        [['d4', 1], ['d7', 1], ['d13', 2]],
        [['d1', 2], ['d12', 1]],
        [['d10', 1], ['d14', 1]],
        [['d3', 1], ['d8', 2], ['d13', 2]],
    ];
    const guests = CUSTOMERS.map(c => ({ name: c.name, phone: c.phone }));
    for (let dayAgo = 1; dayAgo <= 6; dayAgo++) {
        const count = 4 + Math.floor(rnd() * 3); // 4–6 orders/day
        for (let k = 0; k < count; k++) {
            const mins = dayAgo * 24 * 60 - (600 + Math.floor(rnd() * 600)); // 10:00–20:00 IST-ish
            const lines = historyMenu[Math.floor(rnd() * historyMenu.length)];
            const isDelivery = rnd() > 0.45;
            const g = guests[Math.floor(rnd() * guests.length)];
            const useRider = isDelivery && rnd() > 0.3;
            orders.push(makeOrder({
                minsAgo: mins,
                type: isDelivery ? 'delivery' : (rnd() > 0.5 ? 'dine-in' : 'pos'),
                source: isDelivery ? (rnd() > 0.5 ? 'WA' : 'webview_delivery') : (rnd() > 0.5 ? 'QR' : 'POS'),
                status: 'Delivered',
                customer: g.name,
                phone: g.phone,
                address: isDelivery ? 'Demo address, Bandra West' : '',
                riderId: useRider ? RIDERS[Math.floor(rnd() * RIDERS.length)].id : null,
                paid: true,
                paymentMethod: ['UPI', 'Cash', 'Card', 'COD'][Math.floor(rnd() * 4)],
                lines,
                combo: rnd() > 0.8 ? 'cb1' : null,
            }));
        }
    }

    // --- Attendance (7 days, mirrors the real attendance/{date}/{uid} shape) ---
    const attendance = {};
    for (let d = 0; d < 7; d++) {
        const date = new Date(now - d * DAY);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        attendance[key] = {};
        for (const s of STAFF) {
            if (s.status !== 'Active') continue;
            if (d > 0 && rnd() > 0.85) continue; // occasional day off
            const minutes = 420 + Math.floor(rnd() * 180);
            attendance[key][s.uid] = { inAt: `${9 + Math.floor(rnd() * 3)}:00`, outAt: d === 0 ? '' : '22:00', minutes };
        }
    }

    return {
        now,
        outlet: { ...DEMO_OUTLET },
        settings: {
            serviceCharge: { enabled: true, rate: 5 },
            tax: [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }],
            delivery: { baseFee: 29, freeAbove: 499, slabs: [{ upToKm: 3, fee: 29 }, { upToKm: 6, fee: 49 }, { upToKm: 10, fee: 69 }], radiusKm: 10 },
            features: { discountApproval: true, expense: true, staffManagement: true, loyalty: true, whatsappBot: true },
            qrMenu: { offerText: 'Free Garlic Bread on orders above ₹699', showOffer: true },
            marketing: { killSwitch: true, reviewLink: 'https://example.com/review (demo)' },
            loyalty: { earnRate: 0.1, redeemValuePaisePerPoint: 100, minSpendAfterRedemption: 199, earnEnabled: true, dineInEarnEnabled: true, clawbackEnabled: true, tiers: [{ name: 'Bronze', min: 0 }, { name: 'Silver', min: 200 }, { name: 'Gold', min: 400 }] },
        },
        categories: CATEGORIES.map(c => ({ ...c })),
        dishes: Object.fromEntries(DISHES.map(d => [d.id, { ...d }])),
        combos: COMBOS.map(c => ({ ...c })),
        orders,
        tables: TABLES.map(t => ({ ...t })),
        tableSessions,
        riders: RIDERS.map(r => ({ ...r })),
        customers: CUSTOMERS.map(c => ({ ...c })),
        staff: STAFF.map(s => ({ ...s })),
        attendance,
        shifts: [
            { id: 'sh1', week: 'This week', uid: 's3', day: 'Mon', start: '11:00', end: '19:00' },
            { id: 'sh2', week: 'This week', uid: 's4', day: 'Mon', start: '17:00', end: '23:00' },
            { id: 'sh3', week: 'This week', uid: 's3', day: 'Tue', start: '11:00', end: '19:00' },
            { id: 'sh4', week: 'This week', uid: 's2', day: 'Tue', start: '10:00', end: '18:00' },
        ],
        leave: [
            { id: 'lv1', uid: 's4', from: 'Next Mon', to: 'Next Mon', reason: 'Family function', status: 'Pending' },
            { id: 'lv2', uid: 's3', from: '2 days ago', to: '2 days ago', reason: 'Medical', status: 'Approved' },
        ],
        payrollRuns: [],
        inventory: INVENTORY.map(i => ({ ...i })),
        suppliers: SUPPLIERS.map(s => ({ ...s })),
        purchases: [
            { id: 'pu1', supplier: 'Dairyline Foods', date: 'Today', amount: 8600, items: 3, status: 'Received' },
            { id: 'pu2', supplier: 'PackRight', date: 'Yesterday', amount: 3200, items: 1, status: 'Received' },
            { id: 'pu3', supplier: 'Sweet Supply', date: '2 days ago', amount: 3180, items: 1, status: 'Pending delivery' },
        ],
        stockMovements: [
            { id: 'mv1', item: 'Mozzarella Block', delta: -1.5, at: 'Today 12:10', reason: 'Order #BN-271026-1' },
            { id: 'mv2', item: 'Pizza Flour (Type 00)', delta: 20, at: 'Today 09:30', reason: 'Purchase — Mumbai Mill Co.' },
            { id: 'mv3', item: 'Basil (fresh)', delta: -2, at: 'Yesterday 20:02', reason: 'Wastage' },
        ],
        expenseCategories: [...EXPENSE_CATEGORIES],
        expenses: EXPENSES.map(e => ({ ...e })),
        promotions: PROMOTIONS.map(p => ({ ...p })),
        discounts: DISCOUNTS.map(d => ({ ...d })),
        feedback: FEEDBACK.map(f => ({ ...f })),
        chats: CHATS.map(c => ({ ...c, messages: c.messages.map(m => ({ ...m })) })),
        notifications: NOTIFICATIONS.map(n => ({ ...n })),
        loyalty: { members: CUSTOMERS.map(c => ({ ...c })) },
        roles: JSON.parse(JSON.stringify(ROLES)),
        auditLog: AUDIT_LOG.map(a => ({ ...a })),
        bot: {
            status: 'online',
            transport: 'baileys',
            pairedNumber: '+91 90000 00001 (demo)',
            lastSeen: '12 seconds ago',
            uptime: '6d 4h',
            messageLog: [
                { at: '12:31', dir: 'in', text: 'Yes please, 1 Margherita jain.', status: 'received' },
                { at: '12:30', dir: 'out', text: 'Yes! Margherita can be made jain…', status: 'delivered' },
                { at: '12:28', dir: 'in', text: 'Hi, do you have jain pizza?', status: 'received' },
            ],
            templates: TEMPLATES.map(t => ({ ...t })),
            wallet: { balance: 15, usedThisMonth: 43, ratePerToken: 1 },
            flows: ['Greeting', 'Menu', 'Order capture', 'Payment link', 'Rider assignment', 'Feedback'],
        },
        integrations: {
            whatsapp: { provider: 'Baileys (QR) — Meta WABA available', connected: true, webhook: 'https://••••••••.example/webhook', token: '••••••••••••' },
            payments: { provider: 'Razorpay (not connected in demo)', connected: false, keyId: 'rzp_••••••••' },
            maps: { provider: 'OpenStreetMap tiles', connected: true, key: '—' },
            printing: { provider: 'Browser print / ESC-POS bridge', connected: true, device: '/dev/usb/lp0 (demo)' },
            delivery: { provider: 'In-house riders', connected: true },
            domain: { custom: 'demo.foodhubbie.example', ssl: 'Managed' },
        },
        billing: {
            plan: 'Growth (demo)',
            mode: 'per_order',
            rates: { QR: 2, POS: 1, webview_delivery: 5, WA: 5, other: 2, promo: 1 },
            setup: { amount: 500, status: 'non_refundable', date: '2026-08-02' },
            payments: [
                { id: 'bp1', date: '2 Sep 2026', amount: 1500, method: 'UPI', note: 'Advance top-up' },
                { id: 'bp2', date: '1 Oct 2026', amount: 1990, method: 'Card', note: 'Monthly settlement' },
            ],
            charges: [
                { id: 'bc1', date: '1 Oct 2026', amount: 1842, note: 'September usage' },
            ],
        },
        security: {
            passwordLogin: 'Enabled',
            twoFactor: 'Not configured (demo)',
            lastPasswordChange: '48 days ago',
            sessions: [{ device: 'Chrome · Windows', location: 'Mumbai, IN', last: 'Now', current: true }],
            apiKeys: [{ label: 'Bot control API', masked: 'fh_live_••••••••••••3f9a', created: '12 Aug 2026' }],
        },
    };
}
