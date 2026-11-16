/**
 * FoodHubbie Demo — the static content of the demo tenant (names, tables, staff,
 * riders, customers, inventory, discount rows, chat threads, feedback).
 *
 * Everything here is invented. No production record, customer, employee or
 * credential is ever read into the demo.
 *
 * Batch 23j moved this file out of `Admin/js/demo/demo-data.js`. That module was
 * the OLD static demo page's data; the page was deleted long ago, so the KDS
 * review (afd9e11) removed it as an orphan — but `tools/seed-demo-tenant.cjs`
 * was still reading it, which broke the nightly demo reseed with ENOENT. Here it
 * is owned by the seeder, is plain data (no imports, no Date.now(), no money
 * math), and is therefore safe to load in a Cloud Function as well as on the
 * command line.
 *
 * Dates, orders and every rupee in the demo are computed by
 * `tools/demo-seed-core.cjs` from the real `shared/money-math.js` at seed time.
 */

const DEMO_OUTLET = {
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


// The seeder imports these by name; DEMO_OUTLET is exported above alongside them.
module.exports = {
    DEMO_OUTLET, DISHES, RIDERS, CUSTOMERS, STAFF, INVENTORY,
    PROMOTIONS, DISCOUNTS, FEEDBACK, CHATS, TABLES,
};
