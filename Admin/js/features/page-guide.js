import { state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { loadLucide } from '../ui.js';

const GUIDES = {

dashboard: [
{
icon: 'layout-dashboard',
title: 'Dashboard Overview',
body: 'The dashboard shows real-time business metrics for today. <strong>Order cards</strong> (top row) display Today\'s Orders, Revenue, Average Order Value, and Pending deliveries. Click any card to jump to the Orders tab filtered by that status. The <strong>Charts</strong> section below shows weekly/daily trends for revenue and orders. Hover or tap data points for exact values.'
},
{
icon: 'activity',
title: 'Promo Kill Switch',
body: 'The <strong>Emergency Stop All</strong> widget (right side) lets you instantly pause all active promotional campaigns. Toggle promotions on/off globally from here. The green/red dot next to it shows whether the WhatsApp bot is online and connected.'
},
{
icon: 'clock',
title: 'Recent Activity',
body: 'The <strong>Recent Orders</strong> feed shows the latest orders with their current status. Click any order row to open the full order drawer. New orders appear in real time without refreshing the page.'
},
{
icon: 'trending-up',
title: 'Quick Actions',
body: 'Use the sidebar to navigate to any section. The top-right area shows your <strong>outlet badge</strong> (PIZZA / CAKES), the Firebase connection status dot (green = connected), your logged-in email, and a <strong>help-circle icon</strong> that opens this guide for the current page.'
},
],

orders: [
{
icon: 'filter',
title: 'Status Tabs',
body: 'Orders are grouped by status tabs across the top: <strong>New, Preparing, Ready, Out for Delivery, Delivered, Cancelled</strong>. Click a tab to filter. The count badge on each tab shows how many orders are in that status. Orders load in real time — new ones appear automatically.'
},
{
icon: 'list',
title: 'Order Cards',
body: 'Each order card shows: order number, customer name & phone, items ordered, total amount, payment method, and elapsed time. <strong>Color-coded borders</strong> indicate priority: red = delayed, orange = approaching SLA, green = on track. Click any card to open the detailed order drawer.'
},
{
icon: 'external-link',
title: 'Order Drawer',
body: 'The drawer slides in from the right with full order details: all line items with modifiers, delivery address, rider assignment, status history, and payment info. Use the buttons at the bottom to <strong>update status</strong>, <strong>assign a rider</strong>, <strong>mark as paid</strong>, or <strong>print receipt</strong>. Close with the × button or by clicking outside.'
},
{
icon: 'truck',
title: 'Rider Assignment',
body: 'Click <strong>Assign Rider</strong> inside the order drawer to see available riders. Each rider shows their current status (online/offline) and active delivery count. Select a rider to assign them to this order. The rider receives a notification on their app.'
},
{
icon: 'printer',
title: 'Print & Receipts',
body: 'Click <strong>Print Receipt</strong> to generate a thermal-receipt-style preview. From the preview, you can print directly to a connected thermal printer. The receipt includes all order details, payment breakdown, and a thank-you message.'
},
{
icon: 'search',
title: 'Search & Filter',
body: 'Use the <strong>search bar</strong> above the order list to find orders by order number, customer name, or phone number. The search filters results in real time as you type.'
},
],

live: [
{
icon: 'radio',
title: 'Live Order Board',
body: 'The Live Ops board shows incoming orders in real time. Each card displays the order number, items, customer name, and time elapsed. <strong>New orders</strong> appear at the top with a pulse animation to draw your attention.'
},
{
icon: 'check-circle',
title: 'Accept / Reject',
body: 'Use the <strong>Accept</strong> button to confirm an order and move it to Preparing status, or <strong>Reject</strong> to cancel it with a reason. Rejected orders notify the customer automatically via WhatsApp. Once accepted, the order flows to the kitchen display.'
},
{
icon: 'rotate-ccw',
title: 'Status Progression',
body: 'Click an accepted order to advance its status: <strong>Preparing → Ready → Out for Delivery → Delivered</strong>. Each status change sends an automatic WhatsApp update to the customer with the current ETA. Buttons are color-coded by action.'
},
{
icon: 'volume-2',
title: 'Sound Alerts',
body: 'A chime plays when a new order arrives. Enable/disable sound from the speaker icon in the top-right of the Live Ops panel. The alert sound file is cached by the service worker for reliable playback.'
},
],

walkin: [
{
icon: 'grid',
title: 'Category Grid',
body: 'The left panel shows menu items grouped by category. Click a category tab to filter items. Each item shows name, price, and available sizes. Items out of stock are greyed out with a dimmed appearance.'
},
{
icon: 'shopping-cart',
title: 'Cart Panel',
body: 'The right panel shows the current walk-in sale cart. Each line item shows: dish name, selected size, addons, quantity, and line total. Use the <strong>+ / −</strong> buttons to adjust quantity. Click the <strong>trash icon</strong> to remove an item entirely.'
},
{
icon: 'maximize-2',
title: 'Sizes & Addons',
body: 'Click a menu item to choose a <strong>size</strong> (if available). After selecting a size, you can pick <strong>addons</strong> (extra cheese, toppings, etc.) in the modal that appears. Addon prices are added to the line item total automatically.'
},
{
icon: 'percent',
title: 'Discounts & Coupons',
body: 'Use the <strong>discount preset chips</strong> (₹50, ₹100, 10%) for quick discounts, or type a custom amount in the discount field. The system auto-evaluates the best applicable discount (first-order, coupon, global, or category) at checkout. Only channel-matched discounts apply (POS discounts for walk-in orders).'
},
{
icon: 'credit-card',
title: 'Payment & Submit',
body: 'Select the <strong>payment method</strong> (Cash, Card, UPI, or Wallet). The payment modal supports split payments. Click <strong>Submit Sale</strong> to finalize the order. The cart is cleared, and the sale is recorded in Firebase. A receipt can be printed after submission.'
},
{
icon: 'trash-2',
title: 'Clear Cart',
body: 'Use the <strong>Clear Cart</strong> button to remove all items from the current walk-in cart. A confirmation dialog prevents accidental clearing. This is useful when starting a new customer order after completing one.'
},
],

promotions: [
{
icon: 'edit-3',
title: 'Compose Message',
body: 'Write your promotional message in the composer. Use personalization tokens: <code>{name}</code>, <code>{phone}</code>, <code>{lastOrderDate}</code>, <code>{storeName}</code>. Click the <strong>template picker</strong> button to choose from 24 pre-built templates. Toggle the <strong>STOP footer</strong>, add a <strong>closing message</strong>, and attach a <strong>menu image</strong> (3rd message).'
},
{
icon: 'users',
title: 'Select Recipients',
body: 'Choose who receives this campaign: <strong>All consenting customers</strong>, <strong>Active (last 30 days)</strong>, or <strong>Upload CSV/Excel</strong>. Customers who replied STOP to a previous campaign are automatically excluded. Recipients are capped at <strong>300 per campaign</strong>.'
},
{
icon: 'image',
title: 'Media & Menu Image',
body: 'Attach a <strong>campaign image</strong> (sent as part of the main message) and optionally a separate <strong>menu image</strong> (sent as a 3rd message after the main text). Supported formats: JPG, PNG, WebP. Both are optional.'
},
{
icon: 'eye',
title: 'Preview & Test',
body: 'Click <strong>Preview</strong> to see how a sample recipient will read your message — including STOP footer, closing message, and menu image. Click <strong>Send test to me</strong> to receive the exact message on your own WhatsApp before launching to customers.'
},
{
icon: 'send',
title: 'Launch & Schedule',
body: 'Click <strong>Launch Campaign</strong> to send immediately. Switch to the <strong>Schedule</strong> tab to set a future date and time with quiet hours. The bot paces itself with an <strong>8-15s random delay</strong> between messages and pauses <strong>60-120s every 30 sends</strong> to avoid WhatsApp rate limits.'
},
{
icon: 'shield',
title: 'Monitor & Emergency Stop',
body: 'The <strong>Active</strong> tab shows live progress of running campaigns with sent/failed/skipped counts and a progress bar. Use <strong>Stop</strong> on any individual campaign, or the red <strong>EMERGENCY STOP ALL</strong> button to pause every active campaign immediately. A daily cap of 300 messages prevents over-sending.'
},
],

discounts: [
{
icon: 'list',
title: 'Discount List',
body: 'The main view lists all existing discounts grouped by status: <strong>Active</strong>, <strong>Scheduled</strong>, and <strong>Expired / Disabled</strong>. Each card shows name, type, value, channel badge, and a toggle to enable/disable. Click the pencil icon to edit.'
},
{
icon: 'plus-circle',
title: 'Create / Edit Discount',
body: 'Click <strong>New Discount</strong> to open the editor. Set a name, choose <strong>type</strong> (Global, Category, New Customer, Coupon), select <strong>% Percent</strong> or <strong>Fixed amount</strong>, and set the value. Choose the <strong>channel</strong> where this discount applies: WhatsApp only, POS only, Both, Website, or All channels.'
},
{
icon: 'calendar',
title: 'Schedule & Limits',
body: 'Set start/end dates for time-windowed discounts. Configure <strong>per-customer limits</strong> and <strong>global redemption limits</strong>. Add a <strong>minimum subtotal</strong> requirement. Use <strong>exclusive groups</strong> to prevent multiple discounts stacking on the same order.'
},
{
icon: 'ticket',
title: 'Coupon Codes',
body: 'Choose <strong>Coupon code</strong> type to create a code customers enter at checkout. Set a <strong>prefix</strong> (e.g. PIZZA, SUMMER) and click <strong>Generate</strong> for a word-based code like PIZZA42, or type your own. Enable <strong>Stackable</strong> to allow this coupon to combine with other discounts. Click any discount in Reports to <strong>view code uses</strong> — see who used it, when, and how much they saved.'
},
{
icon: 'bar-chart-2',
title: 'Discount Reports',
body: 'Click <strong>Reports</strong> to see per-discount performance: redemptions, total savings, and a <strong>channel split</strong> showing WhatsApp vs POS usage. Filter by date range (7/30/90 days or all time). Export as CSV for external analysis.'
},
],

menu: [
{
icon: 'list',
title: 'Dish List',
body: 'The main menu view shows all dishes organized in a table with columns: name, category, base price, sizes, status (available/out of stock), and action buttons. Use the <strong>category filter</strong> dropdown to view dishes from a specific category only.'
},
{
icon: 'plus-circle',
title: 'Add / Edit Dish',
body: 'Click <strong>Add Dish</strong> or the edit icon on an existing dish to open the editor. Fill in: name, description, category, base price, and upload an image. Each dish can have <strong>multiple sizes</strong> (Small/Medium/Large) with different prices. Toggle availability per size.'
},
{
icon: 'image',
title: 'Dish Images',
body: 'Upload a dish image using the file picker in the editor. Images are resized and compressed client-side before uploading to Firebase Storage. Supported formats: JPG, PNG, WebP. A preview is shown after upload. Use the × button to remove and re-upload.'
},
{
icon: 'layers',
title: 'Addon Groups',
body: 'Each dish can have <strong>addon groups</strong> (e.g., Extra Toppings, Cheese Options). Addons can be single-select or multi-select, with individual prices. Manage addons in the <strong>Addon Groups</strong> section within the dish editor. Addons appear during POS order entry.'
},
{
icon: 'toggle-left',
title: 'Availability & Status',
body: 'Toggle a dish\'s availability using the switch in the dish list. Unavailable dishes are hidden from the customer-facing menu but remain in the admin for editing. Use this for items that are temporarily out of stock or seasonal.'
},
],

categories: [
{
icon: 'list',
title: 'Category List',
body: 'All menu categories are displayed in a sorted list. Each row shows the category name, sort order number, dish count, visibility toggle, and action buttons. Categories cannot be deleted if they contain dishes — remove or reassign dishes first.'
},
{
icon: 'edit-3',
title: 'Add / Edit Category',
body: 'Click <strong>Add Category</strong> or the edit icon to open the editor. Set a name and a sort order number (lower numbers appear first). Categories appear in this order in the menu, POS grid, and customer-facing displays.'
},
{
icon: 'eye',
title: 'Visibility Toggle',
body: 'Use the <strong>eye icon</strong> to show/hide a category. Hidden categories and their dishes are not visible to customers but remain accessible in the admin. This is useful for preparing new menu sections before publishing. Hidden categories are shown with a strikethrough.'
},
{
icon: 'shuffle',
title: 'Reorder Drag & Drop',
body: 'Drag categories by the handle icon to reorder them visually. The sort order number updates automatically. Changes reflect immediately in the menu display and POS category grid. The order persists across sessions.'
},
],

inventory: [
{
icon: 'database',
title: 'Stock Table',
body: 'The inventory table lists all stock items with: name, current stock level, unit, threshold (low-stock alert), and availability toggle. Items below their threshold are highlighted in <span style="color:#ef4444;">red</span>. Use the search bar to find specific items.'
},
{
icon: 'plus-circle',
title: 'Add / Adjust Stock',
body: 'Click <strong>Add Item</strong> to create a new inventory entry. Click the edit icon on any item to <strong>adjust stock</strong>: enter a positive number to add stock, a negative number to deduct. Each adjustment is logged with a timestamp and the admin who made the change.'
},
{
icon: 'alert-triangle',
title: 'Low Stock Alerts',
body: 'Items below their configured threshold are highlighted and moved to the top of the list. The <strong>Low Stock</strong> filter shows only items needing attention. Stock alerts help prevent running out of key ingredients during service hours.'
},
{
icon: 'toggle-left',
title: 'Availability Toggle',
body: 'Toggle an item\'s availability on/off. When marked unavailable, linked menu dishes that require this item are greyed out in the POS. This prevents orders for dishes that cannot be prepared due to missing ingredients.'
},
{
icon: 'download',
title: 'Import / Export',
body: 'Use <strong>Export CSV</strong> to download the entire inventory as a CSV file for offline editing. Use <strong>Import CSV</strong> to upload bulk changes. The import supports adding new items and updating existing stock levels. A preview is shown before the import is applied.'
},
],

riders: [
{
icon: 'users',
title: 'Rider List',
body: 'The riders section shows all delivery riders in card format. Each card displays: name, phone, email, vehicle type, current status (online/offline/busy), wallet balance, and total deliveries completed. Online riders appear first with a green indicator.'
},
{
icon: 'plus-circle',
title: 'Add / Edit Rider',
body: 'Click <strong>Add Rider</strong> to create a new rider account. Fill in name, phone, email, password, and vehicle details (bike/scooter/car). Use the edit icon to update rider details. Riders use their credentials to log into the rider mobile app.'
},
{
icon: 'dollar-sign',
title: 'Wallet & Settlement',
body: 'Each rider has a <strong>wallet</strong> that tracks delivery earnings and cash collected. Use the <strong>Settle Wallet</strong> button to record a payout to the rider (deducts from their balance). The settlement history is logged with date and amount.'
},
{
icon: 'power',
title: 'Status Control',
body: 'Toggle a rider\'s status between <strong>Active</strong> and <strong>Blocked</strong>. Blocked riders cannot log into the app or receive delivery assignments. Use this for riders who have left or are on extended leave. Blocked riders are shown with a red badge.'
},
{
icon: 'key',
title: 'Password Reset',
body: 'Click the <strong>key icon</strong> on any rider to send a password reset email. The rider receives an email with instructions to set a new password. The rider\'s email address must be valid for this to work.'
},
],

customers: [
{
icon: 'search',
title: 'Search Customers',
body: 'Use the <strong>search bar</strong> to find customers by name, phone number, or email. Results update as you type. The search scans the entire customer database for the selected outlet. Clear the search to show all customers.'
},
{
icon: 'credit-card',
title: 'Customer Cards',
body: 'Each customer card shows: name, phone, email, total orders, total spent, last order date, and promotional consent status. Click a card to expand and view full order history. Customers with promotional consent = yes have a green checkmark.'
},
{
icon: 'clock',
title: 'Order History',
body: 'The expanded view shows a chronological list of the customer\'s past orders with: date, order total, items count, status, and payment method. Click any order to open the order drawer. This helps with customer support queries about past orders.'
},
{
icon: 'message-circle',
title: 'Contact Customer',
body: 'Click the <strong>phone icon</strong> to open WhatsApp chat with the customer in a new tab. Click the <strong>mail icon</strong> to open your default email client. Use this for follow-ups, complaint resolution, or personalized offers.'
},
],

lostSales: [
{
icon: 'shopping-bag',
title: 'Lost Order List',
body: 'The Lost Sales table shows abandoned checkouts — orders that were started but never completed. Each entry shows: customer name, phone, items in cart, cart total, timestamp, and the checkout page where they dropped off.'
},
{
icon: 'eye',
title: 'View Cart Contents',
body: 'Click any lost sale row to see exactly what items were in the abandoned cart — including sizes, addons, quantities, and prices. This helps understand what the customer was interested in and why they might have left.'
},
{
icon: 'phone-forwarded',
title: 'Contact Customer',
body: 'Click the <strong>Contact</strong> button to open WhatsApp with a pre-filled recovery message. The message template includes the items they left behind and an incentive to complete the order (if configured). Customize the recovery message in Settings.'
},
{
icon: 'check-circle',
title: 'Mark Recovered',
body: 'After successfully following up, click <strong>Mark Recovered</strong> to record that the sale was recovered. Recovered orders are moved to a separate view for tracking recovery rate. Use this to measure the effectiveness of your follow-up outreach.'
},
],

reports: [
{
icon: 'calendar',
title: 'Date Range Picker',
body: 'Select a date range for the report using the start and end date inputs. Preset buttons (<strong>Today, Yesterday, Last 7 Days, Last 30 Days, This Month</strong>) provide quick selection. All charts and tables update automatically when the range changes.'
},
{
icon: 'bar-chart-3',
title: 'Report Tabs',
body: 'Switch between report types using the tabs: <strong>Sales Overview, Order Trends, Top Items, Category Breakdown, Hourly Heatmap</strong>. Each tab shows a different perspective on your business data for the selected period.'
},
{
icon: 'trending-up',
title: 'Chart Interaction',
body: 'Hover over any chart data point to see exact values. Charts support zoom and pan on touch devices. Use the <strong>legend</strong> to toggle individual data series on/off. Charts are rendered using Chart.js for smooth interactive experience.'
},
{
icon: 'download',
title: 'Export Options',
body: 'Click <strong>Export PDF</strong> to download a formatted report with all charts and tables included. Click <strong>Export Excel</strong> to download raw data as a .xlsx file for further analysis in spreadsheet software. The export uses the current date range and active report tab.'
},
{
icon: 'refresh-cw',
title: 'Refresh Data',
body: 'Use the <strong>Refresh</strong> button to reload report data from Firebase. Data is cached for 60 seconds to avoid excessive reads. The last-updated timestamp is shown next to the refresh button.'
},
],

riderAnalytics: [
{
icon: 'users',
title: 'Rider Performance Table',
body: 'The table ranks all riders by performance metrics: total deliveries, on-time rate, average delivery time, customer rating, and earnings. Click a column header to sort. Use the <strong>date range filter</strong> to view performance for a specific period.'
},
{
icon: 'bar-chart-3',
title: 'Earnings Chart',
body: 'The bar chart shows each rider\'s earnings for the selected period. Hover bars to see exact amounts. The chart compares earnings across riders side by side. Toggle individual riders on/off using the chart legend.'
},
{
icon: 'clock',
title: 'Delivery Stats',
body: 'The stats section shows aggregated metrics: average delivery time across all riders, on-time delivery percentage, total deliveries, and average rating. These update when the date range changes. Use this to identify overall delivery performance trends.'
},
{
icon: 'star',
title: 'Customer Ratings',
body: 'Each rider\'s average customer rating is displayed with a star badge. Click the rating to see individual feedback comments left by customers for that rider. This helps identify top performers and riders who may need coaching.'
},
],

feedback: [
{
icon: 'bar-chart-3',
title: 'Rating Distribution',
body: 'The donut chart shows the distribution of ratings (1-5 stars) across all feedback. Hover each segment to see the count and percentage. The center shows the average rating. Green = positive (4-5), yellow = neutral (3), red = negative (1-2).'
},
{
icon: 'list',
title: 'Feedback List',
body: 'Below the chart, each feedback entry shows: customer name, rating (star icons), comment text, order reference, and timestamp. Click any entry to expand and see full details. The list is sorted by most recent first.'
},
{
icon: 'filter',
title: 'Filter by Rating',
body: 'Use the <strong>star filter buttons</strong> (All, 5★, 4★, 3★, 2★, 1★) to view feedback for a specific rating level. The chart updates to highlight the selected rating. This is useful for focusing on negative feedback that needs attention.'
},
{
icon: 'message-circle',
title: 'Respond to Feedback',
body: 'Click the <strong>respond icon</strong> on any feedback entry to open WhatsApp chat with that customer directly. Thank them for positive feedback or address concerns from negative feedback. Timely responses improve customer satisfaction and retention.'
},
],

liveTracker: [
{
icon: 'map',
title: 'Map View',
body: 'The map shows all active delivery riders as moving markers. Each marker is color-coded by rider status: <strong>green</strong> = online/available, <strong>blue</strong> = on delivery, <strong>red</strong> = offline. The map auto-centers on your outlet location. Drag to pan, scroll to zoom.'
},
{
icon: 'crosshair',
title: 'Rider Selection',
body: 'Click any rider marker on the map to see their details: name, current order, destination address, and estimated arrival time. The selected rider\'s route to their destination is shown as a polyline on the map. Click again or press Esc to deselect.'
},
{
icon: 'list',
title: 'Order Selection Panel',
body: 'The right panel lists all active delivery orders with rider assignments. Click an order to focus the map on that delivery\'s location. The panel shows: order number, customer address, assigned rider, and current status. In-progress deliveries show remaining ETA.'
},
{
icon: 'navigation',
title: 'Live Progress',
body: 'Rider positions update every 5-10 seconds. The map automatically follows a selected rider\'s movement. Estimated arrival times recalculate as the rider moves. The route line updates to reflect the rider\'s actual path.'
},
{
icon: 'refresh-cw',
title: 'Refresh',
body: 'Use the <strong>Refresh</strong> button to manually reload all rider positions and order data. The tracker auto-refreshes every 30 seconds, but the manual refresh is useful after completing a delivery or assigning new orders.'
},
],

notifications: [
{
icon: 'edit-3',
title: 'Compose Notification',
body: 'Write your push notification title and body. Optional: add a <strong>deep link URL</strong> that opens a specific page when the user taps the notification (e.g., <code>orders</code>, <code>menu</code>). A preview card shows how the notification will appear on a device.'
},
{
icon: 'users',
title: 'Target Audience',
body: 'Choose who receives this notification: <strong>All customers</strong>, <strong>Recent customers</strong> (last 30 days), or <strong>Specific segment</strong> (by order count, average order value, etc.). The recipient count is estimated before sending. Notification consent is respected automatically.'
},
{
icon: 'send',
title: 'Send Now / Schedule',
body: 'Click <strong>Send Now</strong> to dispatch immediately. Use the <strong>Schedule</strong> option to set a future delivery time. Scheduled notifications appear in the pending list below. Notifications are delivered via Firebase Cloud Messaging (FCM).'
},
{
icon: 'clock',
title: 'History Log',
body: 'The history section shows all past and pending notifications with: title, audience, sent count, delivery date, and status (sent/pending/failed). Click any history entry to view its details and delivery analytics (sent, delivered, opened counts).'
},
],

payments: [
{
icon: 'list',
title: 'Transaction List',
body: 'The payments table shows all transactions with columns: date, order number, customer, payment method, amount, and status (completed/pending/refunded). Each row is color-coded: green = completed, yellow = pending, red = refunded. Use the search bar to find specific transactions.'
},
{
icon: 'calendar',
title: 'Date Filter',
body: 'Filter transactions by date range using the start and end date pickers. Preset buttons (<strong>Today, Last 7 Days, This Month</strong>) provide quick access to common periods. The totals bar at the top updates to show the sum for the filtered period.'
},
{
icon: 'filter',
title: 'Payment Method Filter',
body: 'Use the <strong>Payment Method</strong> dropdown to filter by: All, Cash, Card, UPI, or Wallet. Combine with the date filter for precise views. The filtered total shows the sum of displayed transactions for the selected method(s).'
},
{
icon: 'external-link',
title: 'Order Link',
body: 'Click any transaction row to open the associated order drawer with full details. This provides context about what was purchased, the delivery status, and any applied discounts. Use this for payment reconciliation or customer inquiries.'
},
],

settings: [
{
icon: 'settings',
title: 'Store Information',
body: 'Update your store name, address, phone number, and operating hours. Changes are saved to Firebase and reflect immediately across the customer-facing website, WhatsApp bot responses, and printed receipts. Click <strong>Save Settings</strong> to persist changes.'
},
{
icon: 'truck',
title: 'Delivery Fees',
body: 'Configure delivery fees: <strong>base delivery fee</strong>, <strong>free delivery threshold</strong> (orders above this amount get free delivery), and <strong>per-km charge</strong> beyond the free radius. The fee structure is used by both the website and the WhatsApp ordering bot.'
},
{
icon: 'palette',
title: 'Branding Colors',
body: 'Customize the admin panel and customer-facing brand colors. The <strong>primary color</strong> is used for buttons, links, and highlights. The <strong>accent color</strong> for secondary elements. A live preview shows how the colors look on key UI elements.'
},
{
icon: 'smartphone',
title: 'WhatsApp QR / Bot',
body: 'Configure the WhatsApp bot number. The QR code displayed here can be scanned to link the bot to a WhatsApp Business account. The bot status indicator shows whether the bot is online, processing messages, or disconnected from WhatsApp.'
},
{
icon: 'toggle-left',
title: 'Promotions Toggle',
body: 'Enable or disable the promotional messaging system globally. When disabled, no campaigns can be launched and scheduled campaigns are paused. This is a safety switch independent of the emergency stop in the Promotions tab.'
},
{
icon: 'dollar-sign',
title: 'Pricing & Fees',
body: 'Configure additional fees and charges: <strong>packaging fee</strong>, <strong>service charge</strong> (percentage), and <strong>tax rate</strong>. These are applied automatically to all orders. The fee slab system allows different fees for different order value ranges.'
},
]};

export async function renderPageGuide(container) {
    if (!container) return;
    const tab = state.currentActiveTab || 'dashboard';
    const steps = GUIDES[tab];
    if (!steps || steps.length === 0) {
        container.innerHTML = '<p class="text-muted-small">No guide available for this page yet.</p>';
        return;
    }
    const tabName = document.getElementById('currentTabTitle')?.textContent || tab;
    container.innerHTML = `
        <p class="text-muted-small mb-12">Step-by-step guide for <strong>${escapeHtml(tabName)}</strong></p>
        <ol class="promo-guide-list">
            ${steps.map((s, i) => `
                <li class="promo-guide-item">
                    <div class="promo-guide-num">${i + 1}</div>
                    <div>
                        <h4 class="promo-guide-title"><i data-lucide="${s.icon}" class="icon-16"></i> ${escapeHtml(s.title)}</h4>
                        <p class="text-muted-small mt-4">${s.body}</p>
                    </div>
                </li>
            `).join('')}
        </ol>
    `;
    await loadLucide();
    window.lucide.createIcons({ root: container });
}


