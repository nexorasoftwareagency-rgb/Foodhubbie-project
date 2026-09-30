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
        body: 'Orders are grouped by status tabs across the top: <strong>New, Preparing, Ready, Out for Delivery, Delivered, Cancelled</strong>. Click a tab to filter. The count badge on each tab shows how many orders are in that status. Orders load in real time — new ones appear automatically.<br><br><strong>Example:</strong> Tabs show: New (3), Preparing (5), Ready (2), Out for Delivery (4), Delivered (28), Cancelled (1). You click "Preparing" → see 5 orders cooking. New WhatsApp order arrives → "New" badge increments to 4 instantly.'
    },
    {
        icon: 'list',
        title: 'Order Cards',
        body: 'Each order card shows: order number, customer name & phone, items ordered, total amount, payment method, and elapsed time. <strong>Color-coded borders</strong> indicate priority: red = delayed, orange = approaching SLA, green = on track. Click any card to open the detailed order drawer.<br><br><strong>Example:</strong> Card: #012626-015, "Rohit K" (9876543210), "Chicken Biryani x2, Coke", ₹650, UPI, 12:45 elapsed, green border. Next card: #012626-012, "Priya S", "Margherita Pizza", ₹320, Cash, 45:30 elapsed, orange border (approaching SLA). You click orange card → drawer opens.'
    },
    {
        icon: 'external-link',
        title: 'Order Drawer',
        body: 'The drawer slides in from the right with full order details: all line items with modifiers, delivery address, rider assignment, status history, and payment info. Use the buttons at the bottom to <strong>update status</strong>, <strong>assign a rider</strong>, <strong>mark as paid</strong>, or <strong>print receipt</strong>. Close with the × button or by clicking outside.<br><br><strong>Example:</strong> You click #012626-012. Drawer shows: Margherita Pizza (Large) + Extra Cheese, Delivery: 123 Main St, Apt 4B, Rider: Not assigned, Status: Preparing (since 12:15), Payment: Cash on Delivery. You click "Assign Rider" → see available riders.'
    },
    {
        icon: 'truck',
        title: 'Rider Assignment',
        body: 'Click <strong>Assign Rider</strong> inside the order drawer to see available riders. Each rider shows their current status (online/offline) and active delivery count. Select a rider to assign them to this order. The rider receives a notification on their app.<br><br><strong>Example:</strong> Click Assign Rider → modal shows: "Rajesh Kumar" (Online, 2 active), "Amit Singh" (Online, 0 active), "Vikram P" (Offline). You select Amit Singh (0 active) → assigned. Rider gets push: "New delivery: #012626-012, 123 Main St". Status changes to "Out for Delivery".'
    },
    {
        icon: 'printer',
        title: 'Print & Receipts',
        body: 'Click <strong>Print Receipt</strong> to generate a thermal-receipt-style preview. From the preview, you can print directly to a connected thermal printer. The receipt includes all order details, payment breakdown, and a thank-you message.<br><br><strong>Example:</strong> Order #012626-012 completed. Click Print Receipt → preview opens: Store name, Order #, Date/Time, Items with prices, Subtotal ₹320, Tax ₹18, Total ₹338, Payment: Cash. Click Print → sends to 80mm thermal printer. Customer gets receipt.'
    },
    {
        icon: 'search',
        title: 'Search & Filter',
        body: 'Use the <strong>search bar</strong> above the order list to find orders by order number, customer name, or phone number. The search filters results in real time as you type.<br><br><strong>Example:</strong> Type "98765" → filters to orders with that phone suffix. Type "Priya" → filters to Priya\'s orders. Type "#012626-012" → jumps to that order. Clear search → back to full list.'
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
        body: 'The left panel shows menu items grouped by category. Click a category tab to filter items. Each item shows name, price, and available sizes. Items out of stock are greyed out with a dimmed appearance.<br><br><strong>Example:</strong> Categories: Hot Drinks, Cold Drinks, Breakfast, Main Course, Snacks, Desserts. Click "Main Course" → shows: Masala Dosa ₹110, Chicken Biryani ₹280, Paneer Butter Masala ₹240. "Cold Coffee" is greyed out (out of stock).'
    },
    {
        icon: 'shopping-cart',
        title: 'Cart Panel',
        body: 'The right panel shows the current walk-in sale cart. Each line item shows: dish name, selected size, addons, quantity, and line total. Use the <strong>+ / −</strong> buttons to adjust quantity. Click the <strong>trash icon</strong> to remove an item entirely.<br><br><strong>Example:</strong> Cart shows: 1) Masala Dosa (Regular) ×2 = ₹220, 2) Filter Coffee (Large) + Extra Shot = ₹70, 3) Chicken Biryani (Regular) ×1 = ₹280. Subtotal: ₹570. You click + on Biryani → qty 2, subtotal updates to ₹850.'
    },
    {
        icon: 'maximize-2',
        title: 'Sizes & Addons',
        body: 'Click a menu item to choose a <strong>size</strong> (if available). After selecting a size, you can pick <strong>addons</strong> (extra cheese, toppings, etc.) in the modal that appears. Addon prices are added to the line item total automatically.<br><br><strong>Example:</strong> Customer wants "Chicken Biryani". Click item → modal opens. Sizes: Regular ₹280, Large ₹350. Customer picks Large. Addons: Extra Raita ₹30, Boiled Egg ₹20. Customer picks both. Line total: ₹350 + ₹30 + ₹20 = ₹400. Added to cart.'
    },
    {
        icon: 'percent',
        title: 'Discounts & Coupons',
        body: 'Use the <strong>discount preset chips</strong> (₹50, ₹100, 10%) for quick discounts, or type a custom amount in the discount field. The system auto-evaluates the best applicable discount (first-order, coupon, global, or category) at checkout. Only channel-matched discounts apply (POS discounts for walk-in orders).<br><br><strong>Example:</strong> Cart subtotal ₹850. Auto-discount: "First Order 10%" applies (₹85). You tap preset "₹100" → overrides to ₹100 manual. Customer says "I have coupon PIZZA20". You type PIZZA20 in coupon field → applies 20% (₹170) if valid. Best discount wins.'
    },
    {
        icon: 'credit-card',
        title: 'Payment & Submit',
        body: 'Select the <strong>payment method</strong> (Cash, Card, UPI, or Wallet). The payment modal supports split payments. Click <strong>Submit Sale</strong> to finalize the order. The cart is cleared, and the sale is recorded in Firebase. A receipt can be printed after submission.<br><br><strong>Example:</strong> Final total ₹765. Customer pays ₹500 Cash + ₹265 UPI. Tap "Cash" → enter 500. Tap "UPI" → enter 265. Tap Submit Sale → Order #012626-003 saved. Receipt prints. Cart clears for next customer.'
    },
    {
        icon: 'trash-2',
        title: 'Clear Cart',
        body: 'Use the <strong>Clear Cart</strong> button to remove all items from the current walk-in cart. A confirmation dialog prevents accidental clearing. This is useful when starting a new customer order after completing one.<br><br><strong>Example:</strong> Customer changes mind, wants different items. Tap Clear Cart → "Are you sure? All items will be removed." Confirm → cart empties. Subtotal resets to ₹0. Ready for next order.'
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
        body: 'The main view lists all existing discounts grouped by status: <strong>Active</strong>, <strong>Scheduled</strong>, and <strong>Expired / Disabled</strong>. Each card shows name, type, value, channel badge, and a toggle to enable/disable. Click the pencil icon to edit.<br><br><strong>Example:</strong> You see: "Welcome 10%" (Global, 10%, All channels, Active), "PIZZA50" (Coupon, ₹50, POS only, Active), "Weekend 15%" (Category: Pizzas, 15%, Both, Scheduled: Fri-Sun), "Birthday 20%" (New Customer, 20%, WhatsApp, Disabled). Toggle "Birthday 20%" off.'
    },
    {
        icon: 'plus-circle',
        title: 'Create / Edit Discount',
        body: 'Click <strong>New Discount</strong> to open the editor. Set a name, choose <strong>type</strong> (Global, Category, New Customer, Coupon), select <strong>% Percent</strong> or <strong>Fixed amount</strong>, and set the value. Choose the <strong>channel</strong> where this discount applies: WhatsApp only, POS only, Both, Website, or All channels.<br><br><strong>Example:</strong> You want "Lunch Special 10% off Pizzas, Mon-Fri 12-3pm". Name: "Lunch Special", Type: Category, Category: Pizzas, % Percent: 10, Channel: Both (POS + WhatsApp). Schedule: Mon-Fri, Start: 12:00, End: 15:00. Min Subtotal: ₹200. Save.'
    },
    {
        icon: 'calendar',
        title: 'Schedule & Limits',
        body: 'Set start/end dates for time-windowed discounts. Configure <strong>per-customer limits</strong> and <strong>global redemption limits</strong>. Add a <strong>minimum subtotal</strong> requirement. Use <strong>exclusive groups</strong> to prevent multiple discounts stacking on the same order.<br><br><strong>Example:</strong> "Lunch Special" above: Per-customer limit: 1/day (prevents same person using it twice daily). Global limit: 50 redemptions/day. Min subtotal: ₹200. Exclusive group: "Time-based" (prevents stacking with "Happy Hour 20%" which is also in "Time-based" group).'
    },
    {
        icon: 'ticket',
        title: 'Coupon Codes',
        body: 'Choose <strong>Coupon code</strong> type to create a code customers enter at checkout. Set a <strong>prefix</strong> (e.g. PIZZA, SUMMER) and click <strong>Generate</strong> for a word-based code like PIZZA42, or type your own. Enable <strong>Stackable</strong> to allow this coupon to combine with other discounts. Click any discount in Reports to <strong>view code uses</strong> — see who used it, when, and how much they saved.<br><br><strong>Example:</strong> You run a Diwali campaign. Prefix: "DIWALI", Generate 100 codes: DIWALI7X, DIWALI3K, etc. Stackable: ON (can combine with "Loyalty 5%"). Customer enters "DIWALI7X" at checkout → gets 10% off. Reports → click DIWALI → shows 47 uses, ₹18,500 saved, top customer: "Rohit K" (3 uses).'
    },
    {
        icon: 'bar-chart-2',
        title: 'Discount Reports',
        body: 'Click <strong>Reports</strong> to see per-discount performance: redemptions, total savings, and a <strong>channel split</strong> showing WhatsApp vs POS usage. Filter by date range (7/30/90 days or all time). Export as CSV for external analysis.<br><br><strong>Example:</strong> Report for last 30 days: "Welcome 10%" → 142 redemptions, ₹28,400 saved, WhatsApp: 60%, POS: 40%. "PIZZA50" → 89 redemptions, ₹4,450 saved, POS only. "Lunch Special" → 234 redemptions, ₹12,600 saved. You export CSV for finance team to reconcile.'
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
        body: 'Click <strong>Add Category</strong> or the edit icon to open the editor. Set a name and a sort order number (lower numbers appear first). Categories appear in this order in the menu, POS category grid, and customer-facing displays.'
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
],

// --- NEW TABS ---
expenses: [
    {
        icon: 'dollar-sign',
        title: 'Expenses Dashboard',
        body: 'Expenses opens with five <strong>sub-tabs</strong>: <strong>Today</strong> (day total and per-category chips over a live list), <strong>History</strong> (the full ledger with filters), <strong>Categories</strong>, <strong>Reports</strong> and <strong>Settings</strong>. Everything is per-outlet and updates as you log entries.<br><br><strong>Example:</strong> You open Expenses → Today shows Total Today ₹3,200 with category chips (Groceries ₹1,800, Transport ₹900). Switch to History, set a date range and Status=Approved → the table narrows to exactly those entries.'
    },
    {
        icon: 'list',
        title: 'Expense Table',
        body: 'Every expense row shows date, category, description, amount and <strong>status</strong> (Approved / Pending / Rejected) — History also shows the outlet. Click a column header to <strong>sort</strong>. Use the <strong>date range, category, status and search</strong> filters to narrow the list; edit with the pencil icon or remove with the trash icon on any row.<br><br><strong>Example:</strong> You filter Category="Groceries", Status="Pending" → two rows remain: 2026-01-15 "Weekly veg supply" ₹3,200 Pending, and 2026-01-18 "Milk & dairy" ₹1,800 Pending. Click the pencil on row 1 → modal opens with its values, you correct the amount, Save → the row updates.'
    },
    {
        icon: 'plus-circle',
        title: 'Add / Edit Expense',
        body: 'Click <strong>Add Expense</strong> and fill in date, category, amount and an optional description (200 chars), then <strong>Save</strong>. Amounts up to the <strong>auto-approve threshold</strong> save as Approved; anything larger saves as Pending, and if spending today would cross the <strong>expense ceiling</strong> a Manager PIN is required before the entry is written. Edit any expense with the pencil icon on its row, or delete it with the trash icon.<br><br><strong>Example:</strong> You pay rent ₹25,000. Click Add Expense → Date: 2026-09-01, Category: Rent, Amount: 25000, Description: "Sep 2026 rent" → Save. It lands as Pending (over the ₹5,000 threshold) for approval. Log it again next month — recurring automation is not built in.'
    },
    {
        icon: 'folder',
        title: 'Categories',
        body: 'Click <strong>Manage Categories</strong> to create, edit, or delete expense categories. Each category has a name, color, icon, monthly budget and alert threshold. Categories appear in the expense dropdowns and in the Reports breakdown. Deleting one is safe — <strong>expenses using it are reassigned to "Misc"</strong>.<br><br><strong>Example:</strong> You need a "Gas Cylinder" category. Click Categories → Add → Name: "Gas Cylinder", Color: orange, Icon: flame, Monthly Budget: ₹4,500. Save. Gas expenses now select "Gas Cylinder" from the dropdown, and the Reports category breakdown compares actual spend against its budget.'
    },
    {
        icon: 'bar-chart-2',
        title: 'Monthly & Category Reports',
        body: 'The reports section shows: <strong>Monthly trend chart</strong> (actual vs budget), <strong>Category breakdown chart</strong>, an <strong>outlet comparison</strong> for multi-outlet setups, and tables with actual, budget and variance per month or category. Click <strong>Excel</strong> or <strong>PDF</strong> to export the report.<br><br><strong>Example:</strong> Monthly trend shows Jan: ₹42,500 actual vs ₹40,000 budget (₹2,500 over). Category breakdown: Groceries 43%, Rent 29%, Gas 11%, Repairs 8%, Others 9%. Repairs budget ₹5,000 vs actual ₹8,000 → its status flag turns red. You click Excel → workbook downloads for your accountant.'
    },
    {
        icon: 'settings',
        title: 'Expense Settings',
        body: 'Configure the <strong>auto-approve threshold</strong> (amounts at or below it save as Approved), the <strong>expense ceiling</strong> (% of projected daily revenue — crossing it requires a Manager PIN; 0 disables), and the <strong>default currency display</strong> (Rs. or ₹). <strong>Seed Default Categories</strong> creates the seven system categories (Rent, Utilities, Payroll, Supplies, Marketing, Maintenance, Misc) with budgets and alerts.<br><br><strong>Example:</strong> Threshold 5000, ceiling 10%. You log ₹300 of milk → auto-approved instantly. A ₹25,000 rent entry that pushes today past 10% of projected revenue → Manager PIN prompt before saving. First-time setup: click Seed Default Categories → seven ready-made categories appear.'
    },
],

'staff-management': [
    {
        icon: 'users',
        title: 'Staff List',
        body: 'The table shows all staff for this outlet: name, role (Owner/Manager/Cashier/Waiter), Counter PIN status (SET / NOT SET), personal discount ceiling, last signed in, and account status (Active/Disabled). Only <strong>Owners and Super Admins</strong> see this tab.<br><br><strong>Example:</strong> You see Rajesh (Cashier, PIN: SET, Ceiling: 10%, Active, 2h ago) and Priya (Manager, PIN: SET, Ceiling: 20%, Active, 1d ago). Waiter Amit shows PIN: NOT SET, Ceiling: 0% (inherits outlet).'
    },
    {
        icon: 'plus-circle',
        title: 'Add Staff Member',
        body: 'Click <strong>Add Staff</strong> to create a new account. Enter: email, full name, role, and an initial password. The system creates a Firebase Auth account and sends a <strong>password reset email</strong> so the staff member sets their own password. The owner never sees the staff\'s final password.<br><br><strong>Example:</strong> You hire a new cashier "Rohit". Fill: rohith@email.com, "Rohit Kumar", Role: Cashier, Initial Password: "Welcome123". Rohit gets an email, clicks the link, sets his own password "Rohit@2024", then signs in — his Cashier role includes POS access, so the till opens with no extra PIN.'
    },
    {
        icon: 'key',
        title: 'POS Sign-In (Role-Based)',
        body: 'POS opens automatically when your role has <strong>POS (Walk-in)</strong> access — the logged-in user is signed in for the shift, so no PIN prompt appears at start. The 4-digit Counter PIN still guards what it should: discount ceilings and manager approval (Security Audit → <strong>Reset PIN</strong> regenerates it; stored as a SHA-256 hash).<br><br><strong>Example:</strong> Rajesh (Cashier role, POS access) logs in and opens POS at 8:00 AM — the menu loads immediately and his bills are claimed <strong>By Cashier — Rajesh</strong>. At 12:30 PM he applies a 15% manual discount on a ₹500 bill — his 10% ceiling triggers the manager PIN prompt. Priya (Manager) enters her PIN, both names logged.'
    },
    {
        icon: 'percent',
        title: 'Discount Ceiling (Per Person)',
        body: 'Set a personal <strong>discount ceiling %</strong> for each staff member. This is the maximum manual discount they can apply without manager approval. Set to <strong>0</strong> to inherit the outlet-level ceiling. Waiters inherit 0% (no manual discounts). <strong>Only Owners can edit ceilings</strong> — Managers cannot change their own or others\' ceilings.<br><br><strong>Example:</strong> Rajesh (Cashier) ceiling = 10%. He tries to apply 15% discount on ₹1000 bill → blocked, Manager PIN required. Priya (Manager) ceiling = 20%. She applies 18% → allowed. Waiter Amit ceiling = 0% (inherits outlet 15%). He cannot apply manual discounts at all.'
    },
    {
        icon: 'user-x',
        title: 'Disable / Enable Account',
        body: 'Click <strong>Disable</strong> to deactivate a staff account — they cannot sign in or use Counter PIN. Click <strong>Enable</strong> to restore access. Disabled accounts remain in the list with a red badge. Owners cannot disable their own account.<br><br><strong>Example:</strong> Cashier "Sanjay" leaves. You click Disable on his row. He can no longer sign in to the dashboard. Two weeks later he returns → you click Enable → he signs in normally and his role reopens POS.'
    },
    {
        icon: 'shield',
        title: 'Audit Trail',
        body: 'Every staff change is logged: account creation, role changes, ceiling updates, PIN resets, disable/enable actions. View the audit trail in the <strong>Security Audit</strong> tab. Logs include: actor name, old value, new value, timestamp, and optional note.<br><br><strong>Example:</strong> You raise Rajesh\'s ceiling from 10% → 15%. Audit log shows: Action: ceiling_update, Target: Rajesh, Old: {ceilingPct: 10}, New: {ceilingPct: 15}, Actor: You (Owner), Note: "Raised for evening rush". Later, Rajesh resets PIN → log shows pin_reset.'
    },
],

'security-audit': [
    {
        icon: 'shield-alert',
        title: 'Security Posture Audit',
        body: 'This tab runs automated security checks and displays findings with severity badges: <strong>Critical (red), High (orange), Medium (yellow), Low (gray)</strong>. Click <strong>Re-check</strong> to re-run all checks. Each finding shows a plain-English description and a one-click <strong>Fix</strong> button where applicable.<br><br><strong>Example:</strong> You open Security Audit. It shows: "Missing Counter PIN" (Medium) for Waiter Amit, "No Approval PIN" (Critical) — Manager PIN not set. You click Fix on "No Approval PIN" → opens Staff Management tab, focuses Manager PIN field. You enter "7311" → saves. Re-check runs → Critical finding gone.'
    },
    {
        icon: 'key',
        title: 'Checks Performed',
        body: '• <strong>Missing Counter PIN</strong> — Active staff without a Counter PIN set (Medium).<br>• <strong>No Approval PIN</strong> — Manager PIN not configured (Critical).<br>• <strong>Zero Ceiling on Discount Roles</strong> — Cashiers/Managers with no personal ceiling (Medium).<br>• <strong>Stale Active Staff</strong> — Active staff inactive 90+ days (Low).<br>• <strong>Multiple Owners</strong> — More than one active Owner per outlet (High).<br>• <strong>Feature ON, No Ceiling</strong> — Discount Approval enabled but no ceiling/PIN set (High).<br>• <strong>PIN Without Ceiling</strong> — Staff with Counter PIN but no discount ceiling (Low).<br><br><strong>Example:</strong> Your outlet has 3 active staff: Rajesh (Cashier, PIN: SET, Ceiling: 10%), Priya (Manager, PIN: SET, Ceiling: 20%), Amit (Waiter, PIN: NOT SET, Ceiling: 0%). Audit flags: "Missing Counter PIN" for Amit (Medium), "PIN Without Ceiling" for Amit (Low — waiter has no ceiling but has no PIN either).'
    },
    {
        icon: 'wrench',
        title: 'One-Click Fixes',
        body: 'Click the <strong>Fix</strong> button on any finding to auto-remediate: generate a new Counter PIN, open Staff Management to set the Manager PIN, set a personal ceiling, disable stale accounts, demote extra Owners to Manager, or open the Staff Management tab. After fixing, the audit re-runs automatically.<br><br><strong>Example:</strong> "No Approval PIN" (Critical) shows Fix button "Set Approval PIN". Click → Staff Management tab opens, Manager PIN field focused. You type "7311" → saves. "Missing Counter PIN" for Amit → Fix button "Set PIN". Click → modal shows "Counter PIN for Amit: 8245". Share with Amit. Re-check → both findings resolved.'
    },
    {
        icon: 'info',
        title: 'Honesty Block',
        body: 'The <strong>What this page could not check</strong> section lists limitations: Server-side PIN enforcement (client-only on Spark plan), session records/real-time till attribution, network-level tampering, and Firebase Rules misconfiguration. Review rules manually for complete coverage.<br><br><strong>Example:</strong> You see the honesty block: "Could not verify server-side PIN enforcement (client-only on Spark plan)". This means a technically skilled staff could bypass PIN prompts by modifying browser code. For true security, migrate to Blaze plan + Cloud Functions.'
    },
],

};

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