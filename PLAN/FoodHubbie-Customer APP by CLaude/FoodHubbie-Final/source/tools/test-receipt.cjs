// Receipt arithmetic check — Indian billing standard:
// Item Total -> (-Combo Savings) -> (-Discount) -> Subtotal(net) -> GST -> SC -> NET
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Usage: node tools/test-receipt.cjs [file]  (defaults to Admin/receipt-templates.js;
// pass a downloaded live copy to verify what is actually deployed)
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'Admin', 'receipt-templates.js'), 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const T = sandbox.window.ReceiptTemplates;

const store = { name: 'Foodhubbie' };
const num = (html, label) => {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/[₹$]/g, '').replace(/\s+/g, ' ');
    const i = text.indexOf(label);
    if (i < 0) return null;
    const m = text.slice(i + label.length).match(/-?\d[\d,]*(?:\.\d+)?/);
    return m ? Number(m[0].replace(/,/g, '')) : null;
};
let fails = 0;
const check = (name, got, want) => {
    const ok = Math.abs(got - want) < 0.005;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${got}, want ${want}`);
};

// Case 1 — the audited bill shape: 4 combo items (baked prices) + 1 plain pizza,
// weekend discount, GST already charged on the net, no service charge.
const order1 = {
    orderId: '01-1231-7', tableNo: '5', customerName: 'Test',
    items: [
        { name: 'Cheese Pizza', quantity: 1, price: 57, comboId: 'c1', comboName: 'Navratri Special Combo', comboOriginal: 67 },
        { name: 'Cheese Sandwich', quantity: 1, price: 77, comboId: 'c1', comboName: 'Navratri Special Combo', comboOriginal: 87 },
        { name: 'Cheesy Corn Momo', quantity: 1, price: 87, comboId: 'c1', comboName: 'Navratri Special Combo', comboOriginal: 97 },
        { name: 'White Sauce Pasta', quantity: 1, price: 108, comboId: 'c1', comboName: 'Navratri Special Combo', comboOriginal: 125 },
        { name: 'Farmhouse Pizza', quantity: 1, price: 149, size: 'Medium' },
    ],
    subtotal: 478, discount: 110, discountLabel: 'Weekend Special',
    tax: 18.4, taxItems: [{ name: 'GST', rate: 5, amount: 18.4 }],
    serviceCharge: 0, total: 386.4,
};
const h1 = T.generateThermalReceipt(order1, store);
check('item total', num(h1, 'Item Total'), 525);
check('combo savings', num(h1, 'Combo Savings'), -47);
check('discount', num(h1, 'Discount (Weekend Special)'), -110);
check('net subtotal', num(h1, 'Subtotal (net)'), 368);
check('gst', num(h1, 'GST (5%)'), 18.4);
check('net payable', num(h1, 'NET PAYABLE'), 386.4);

// Case 1b — same combo data as stored by QR/POS orders (`comboLineOriginal`).
const order1b = { ...order1, items: order1.items.map(i => i.comboId
    ? { name: i.name, quantity: i.quantity, price: i.price, comboId: i.comboId, comboName: i.comboName, comboLineOriginal: i.comboOriginal }
    : i) };
const h1b = T.generateThermalReceipt(order1b, store);
check('comboLineOriginal item total', num(h1b, 'Item Total'), 525);
check('comboLineOriginal savings', num(h1b, 'Combo Savings'), -47);

// Case 2 — service charge from settings (2%, unchanged policy); no combo; no discount.
const order2 = {
    orderId: '01-1231-8', customerName: 'Test',
    items: [{ name: 'Margherita', quantity: 2, price: 100 }],
    subtotal: 200, tax: 10, taxItems: [{ name: 'GST', rate: 5, amount: 10 }],
    serviceCharge: 4, serviceChargeName: 'Service Charge', serviceChargeRate: 2,
    total: 214,
};
const h2 = T.generateThermalReceipt(order2, store);
check('plain item total', num(h2, 'Item Total'), 200);
check('plain gst', num(h2, 'GST (5%)'), 10);
check('service charge', num(h2, 'Service Charge (2%)'), 4);
check('plain net', num(h2, 'NET PAYABLE'), 214);
if (/Subtotal \(net\)/.test(h2)) { fails++; console.log('FAIL net subtotal must not repeat when no deductions'); }

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
