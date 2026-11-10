/**
 * Order Handlers
 * Business logic for processing WhatsApp messages
 */

import { getDB, outletRef } from '../firebase/admin';
import { getSecret } from '../config/secrets';
import { 
  formatJid, 
  maskJid, 
  normalizePhone,
  getISTDateInfo,
  formatOrderId,
  generateCorrelationId,
  generateOtp,
  formatDisplayDateTime
} from '../utils';
import { enqueueTask } from '../utils/taskQueue';
import { 
  getSession, 
  updateSessionState, 
  updateSessionCart,
  clearCart,
  addToCart,
  removeFromCart,
  setSessionTable,
  setActiveOrder
} from './session';
import type { 
  ProcessInboundMessagePayload, 
  SessionData,
  CartItem,
  OrderData,
  MetaMessage,
  MetaContact
} from '../../types';

// ============================================
// MENU HANDLERS
// ============================================

/**
 * Process menu request (browse categories, dishes, add to cart)
 */
export async function processMenuRequest(
  payload: ProcessInboundMessagePayload,
  session: SessionData,
  text: string
): Promise<void> {
  const { message, outlet, businessId } = payload;
  const customerPhone = normalizePhone(message.from);
  const lowerText = text.toLowerCase().trim();
  
  // Handle quick replies / commands
  if (lowerText === 'menu' || lowerText === 'start' || lowerText === 'hi' || lowerText === 'hello') {
    await sendMainMenu(customerPhone, outlet, businessId, session);
    return;
  }
  
  if (lowerText === 'cart' || lowerText === 'basket') {
    await sendCartSummary(customerPhone, outlet, businessId, session);
    return;
  }
  
  if (lowerText === 'help' || lowerText === 'support') {
    await sendHelpMessage(customerPhone, outlet, businessId);
    return;
  }
  
  // Handle category selection: "category:pizza"
  if (lowerText.startsWith('cat_') || lowerText.startsWith('category:')) {
    const categoryId = lowerText.replace('cat_', '').replace('category:', '');
    await sendCategoryMenu(customerPhone, outlet, businessId, session, categoryId);
    return;
  }
  
  // Handle dish selection: "dish:margherita"
  if (lowerText.startsWith('dish_') || lowerText.startsWith('dish:')) {
    const dishId = lowerText.replace('dish_', '').replace('dish:', '');
    await showDishDetails(customerPhone, outlet, businessId, session, dishId);
    return;
  }
  
  // Handle add to cart: "add:margherita:1" or "add:margherita:medium:1"
  if (lowerText.startsWith('add:')) {
    const parts = lowerText.replace('add:', '').split(':');
    const dishId = parts[0];
    const size = parts[1] || 'regular';
    const quantity = parseInt(parts[2] || '1', 10);
    await addDishToCart(customerPhone, outlet, businessId, session, dishId, size, quantity);
    return;
  }
  
  // Handle combo add: "combo:combo1:2"
  if (lowerText.startsWith('combo:')) {
    const parts = lowerText.replace('combo:', '').split(':');
    const comboId = parts[0];
    const quantity = parseInt(parts[1] || '1', 10);
    await addComboToCart(customerPhone, outlet, businessId, session, comboId, quantity);
    return;
  }
  
  // Default: show main menu
  await sendMainMenu(customerPhone, outlet, businessId, session);
}

/**
 * Send main menu with categories
 */
async function sendMainMenu(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData
): Promise<void> {
  const db = getDB();
  
  try {
    // Get categories from RTDB
    const catSnap = await db.ref(`businesses/${businessId}/outlets/${outlet}/menu/categories`).once('value');
    const categories = catSnap.val() || {};
    
    if (Object.keys(categories).length === 0) {
      await sendTextMessage(phone, outlet, businessId, '😔 Menu is not available right now. Please try again later.');
      return;
    }
    
    // Build list message
    const sections = [{
      title: 'Categories',
      rows: Object.entries(categories).map(([id, cat]: [string, any]) => ({
        id: `cat_${id}`,
        title: cat.name || id,
        description: cat.description || '',
      })),
    }];
    
    await enqueueTask('sendOutboundMessage', {
      to: formatJid(phone)!,
      outlet,
      businessId,
      type: 'template',
      template: {
        name: 'menu_catalog',
        language: 'en',
        components: [
          { type: 'header', parameters: [{ type: 'text', text: '🍽️ Our Menu' }] },
          { type: 'body', parameters: [{ type: 'text', text: 'Select a category to browse:' }] },
          { type: 'button', sub_type: 'quick_reply', index: 0, parameters: [{ type: 'payload', payload: 'cat_all' }] },
        ],
      },
      correlationId: generateCorrelationId(),
    });
    
    await updateSessionState(businessId, outlet, phone, 'MENU');
    
  } catch (error) {
    console.error('[Menu] Error sending main menu:', error);
    await sendTextMessage(phone, outlet, businessId, '⚠️ Unable to load menu. Please try again.');
  }
}

/**
 * Send category menu with dishes
 */
async function sendCategoryMenu(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData,
  categoryId: string
): Promise<void> {
  const db = getDB();
  
  try {
    const dishesSnap = await db.ref(`businesses/${businessId}/outlets/${outlet}/menu/dishes`).once('value');
    const allDishes = dishesSnap.val() || {};
    
    // Filter by category
    const dishes = Object.entries(allDishes)
      .filter(([_, dish]: [string, any]) => dish.category === categoryId || dish.categoryId === categoryId)
      .slice(0, 10); // Limit for list message
    
    if (dishes.length === 0) {
      await sendTextMessage(phone, outlet, businessId, '😔 No dishes in this category.');
      return;
    }
    
    const catSnap = await db.ref(`businesses/${businessId}/outlets/${outlet}/menu/categories/${categoryId}`).once('value');
    const category = catSnap.val() || { name: categoryId };
    
    // Send as list
    await enqueueTask('sendOutboundMessage', {
      to: formatJid(phone)!,
      outlet,
      businessId,
      type: 'template',
      template: {
        name: 'menu_catalog',
        language: 'en',
        components: [
          { type: 'header', parameters: [{ type: 'text', text: `📂 ${category.name}` }] },
          { type: 'body', parameters: [{ type: 'text', text: 'Select a dish to view details:' }] },
        ],
      },
      correlationId: generateCorrelationId(),
    });
    
    // Also send individual dish cards as text for now
    for (const [id, dish] of dishes) {
      await sendDishCard(phone, outlet, businessId, id, dish);
    }
    
  } catch (error) {
    console.error('[Menu] Error sending category:', error);
    await sendTextMessage(phone, outlet, businessId, '⚠️ Unable to load category.');
  }
}

/**
 * Show dish details with size options
 */
async function showDishDetails(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData,
  dishId: string
): Promise<void> {
  const db = getDB();
  
  try {
    const dishSnap = await db.ref(`businesses/${businessId}/outlets/${outlet}/menu/dishes/${dishId}`).once('value');
    const dish = dishSnap.val();
    
    if (!dish) {
      await sendTextMessage(phone, outlet, businessId, '😔 Dish not found.');
      return;
    }
    
    await sendDishCard(phone, outlet, businessId, dishId, dish, true);
    
  } catch (error) {
    console.error('[Menu] Error showing dish:', error);
    await sendTextMessage(phone, outlet, businessId, '⚠️ Unable to load dish details.');
  }
}

/**
 * Send dish card with add to cart option
 */
async function sendDishCard(
  phone: string,
  outlet: string,
  businessId: string,
  dishId: string,
  dish: any,
  showSizes = false
): Promise<void> {
  const sizes = dish.sizes || [{ id: 'regular', name: 'Regular', price: dish.price }];
  const hasMultipleSizes = sizes.length > 1;
  
  let text = `🍕 *${dish.name}*\n`;
  if (dish.description) text += `_${dish.description}_\n`;
  text += `------------------------\n`;
  
  if (hasMultipleSizes || showSizes) {
    text += `Available sizes:\n`;
    for (const size of sizes) {
      text += `• ${size.name}: ₹${size.price}\n`;
    }
    text += `------------------------\n`;
    text += `Reply with size to add to cart.\nExample: "add:${dishId}:${sizes[0].id}:1"`;
  } else {
    text += `Price: ₹${dish.price}\n`;
    text += `------------------------\n`;
    text += `Reply "add:${dishId}:1" to add to cart.`;
  }
  
  await sendTextMessage(phone, outlet, businessId, text);
}

/**
 * Add dish to cart
 */
async function addDishToCart(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData,
  dishId: string,
  sizeId: string,
  quantity: number
): Promise<void> {
  const db = getDB();
  
  try {
    const dishSnap = await db.ref(`businesses/${businessId}/outlets/${outlet}/menu/dishes/${dishId}`).once('value');
    const dish = dishSnap.val();
    
    if (!dish) {
      await sendTextMessage(phone, outlet, businessId, '😔 Dish not found.');
      return;
    }
    
    const sizes = dish.sizes || [{ id: 'regular', name: 'Regular', price: dish.price }];
    const size = sizes.find((s: any) => s.id === sizeId) || sizes[0];
    
    const item: CartItem = {
      dishId,
      name: dish.name,
      quantity,
      price: size.price,
      size: size.name,
      addons: [],
    };
    
    await addToCart(businessId, outlet, phone, item);
    
    await sendTextMessage(phone, outlet, businessId, 
      `✅ Added ${quantity}x ${dish.name} (${size.name}) to cart!\n` +
      `💰 Cart total: ₹${session.cartTotal + size.price * quantity}\n\n` +
      `Reply "cart" to view cart or "menu" to continue browsing.`
    );
    
    await updateSessionState(businessId, outlet, phone, 'CART');
    
  } catch (error) {
    console.error('[Cart] Error adding dish:', error);
    await sendTextMessage(phone, outlet, businessId, '⚠️ Unable to add to cart.');
  }
}

/**
 * Add combo to cart
 */
async function addComboToCart(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData,
  comboId: string,
  quantity: number
): Promise<void> {
  const db = getDB();
  
  try {
    const comboSnap = await db.ref(`businesses/${businessId}/outlets/${outlet}/menu/combos/${comboId}`).once('value');
    const combo = comboSnap.val();
    
    if (!combo) {
      await sendTextMessage(phone, outlet, businessId, '😔 Combo not found.');
      return;
    }
    
    const item: CartItem = {
      dishId: comboId,
      name: combo.name,
      quantity,
      price: combo.price,
      isCombo: true,
      comboId,
      comboQuantity: quantity,
    };
    
    await addToCart(businessId, outlet, phone, item);
    
    await sendTextMessage(phone, outlet, businessId,
      `✅ Added ${quantity}x ${combo.name} (Combo) to cart!\n` +
      `💰 Cart total: ₹${session.cartTotal + combo.price * quantity}\n\n` +
      `Reply "cart" to view cart.`
    );
    
    await updateSessionState(businessId, outlet, phone, 'CART');
    
  } catch (error) {
    console.error('[Cart] Error adding combo:', error);
    await sendTextMessage(phone, outlet, businessId, '⚠️ Unable to add combo.');
  }
}

// ============================================
// CART HANDLERS
// ============================================

/**
 * Process cart actions (view, update, remove, checkout)
 */
export async function processCartAction(
  payload: ProcessInboundMessagePayload,
  session: SessionData,
  text: string
): Promise<void> {
  const { message, outlet, businessId } = payload;
  const customerPhone = normalizePhone(message.from);
  const lowerText = text.toLowerCase().trim();
  
  // View cart
  if (lowerText === 'cart' || lowerText === 'view cart') {
    await sendCartSummary(customerPhone, outlet, businessId, session);
    return;
  }
  
  // Update quantity: "qty:0:2" (item index, new quantity)
  if (lowerText.startsWith('qty:')) {
    const parts = lowerText.replace('qty:', '').split(':');
    const index = parseInt(parts[0], 10);
    const quantity = parseInt(parts[1], 10);
    await updateCartItemQuantity(customerPhone, outlet, businessId, session, index, quantity);
    return;
  }
  
  // Remove item: "remove:0"
  if (lowerText.startsWith('remove:')) {
    const index = parseInt(lowerText.replace('remove:', ''), 10);
    await removeCartItem(customerPhone, outlet, businessId, session, index);
    return;
  }
  
  // Clear cart
  if (lowerText === 'clear cart' || lowerText === 'empty cart') {
    await clearCart(businessId, outlet, customerPhone);
    await sendTextMessage(customerPhone, outlet, businessId, '🗑️ Cart cleared.');
    await updateSessionState(businessId, outlet, customerPhone, 'MENU');
    return;
  }
  
  // Checkout
  if (lowerText === 'checkout' || lowerText === 'place order' || lowerText === 'order') {
    await startCheckout(customerPhone, outlet, businessId, session);
    return;
  }
  
  // Back to menu
  if (lowerText === 'menu' || lowerText === 'back') {
    await sendMainMenu(customerPhone, outlet, businessId, session);
    return;
  }
  
  // Default: show cart
  await sendCartSummary(customerPhone, outlet, businessId, session);
}

/**
 * Send cart summary
 */
async function sendCartSummary(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData
): Promise<void> {
  if (!session.cart || session.cart.length === 0) {
    await sendTextMessage(phone, outlet, businessId, 
      '🛒 Your cart is empty.\n\nReply "menu" to browse dishes.'
    );
    return;
  }
  
  let text = '🛒 *Your Cart*\n------------------------\n';
  
  for (let i = 0; i < session.cart.length; i++) {
    const item = session.cart[i];
    const itemTotal = item.price * item.quantity;
    text += `${i + 1}. ${item.name}`;
    if (item.size) text += ` (${item.size})`;
    if (item.isCombo) text += ` [Combo x${item.comboQuantity || 1}]`;
    text += `\n   ${item.quantity} x ₹${item.price} = ₹${itemTotal}\n`;
    if (item.addons && item.addons.length > 0) {
      for (const addon of item.addons) {
        text += `   + ${addon.name} (₹${addon.price})\n`;
      }
    }
  }
  
  text += `------------------------\n`;
  text += `💰 *Subtotal: ₹${session.cartTotal}*\n\n`;
  text += `Reply:\n`;
  text += `• "checkout" to place order\n`;
  text += `• "qty:0:2" to update quantity\n`;
  text += `• "remove:0" to remove item\n`;
  text += `• "clear cart" to empty\n`;
  text += `• "menu" to continue browsing`;
  
  await sendTextMessage(phone, outlet, businessId, text);
}

/**
 * Update cart item quantity
 */
async function updateCartItemQuantity(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData,
  index: number,
  quantity: number
): Promise<void> {
  if (index < 0 || index >= session.cart.length) {
    await sendTextMessage(phone, outlet, businessId, '😔 Invalid item number.');
    return;
  }
  
  if (quantity < 1) {
    await removeCartItem(phone, outlet, businessId, session, index);
    return;
  }
  
  const cart = [...session.cart];
  cart[index].quantity = quantity;
  await updateSessionCart(businessId, outlet, phone, cart);
  
  await sendTextMessage(phone, outlet, businessId, `✅ Updated quantity to ${quantity}.`);
  await sendCartSummary(phone, outlet, businessId, { ...session, cart });
}

/**
 * Remove cart item
 */
async function removeCartItem(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData,
  index: number
): Promise<void> {
  if (index < 0 || index >= session.cart.length) {
    await sendTextMessage(phone, outlet, businessId, '😔 Invalid item number.');
    return;
  }
  
  const cart = [...session.cart];
  const removed = cart.splice(index, 1)[0];
  await updateSessionCart(businessId, outlet, phone, cart);
  
  await sendTextMessage(phone, outlet, businessId, `🗑️ Removed ${removed.name} from cart.`);
  await sendCartSummary(phone, outlet, businessId, { ...session, cart });
}

// ============================================
// CHECKOUT HANDLERS
// ============================================

/**
 * Start checkout process
 */
export async function startCheckout(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData
): Promise<void> {
  if (!session.cart || session.cart.length === 0) {
    await sendTextMessage(phone, outlet, businessId, '😔 Cart is empty.');
    return;
  }
  
  // Check if table/order type needed
  const db = getDB();
  const settingsSnap = await db.ref(`businesses/${businessId}/outlets/${outlet}/settings/Store`).once('value');
  const settings = settingsSnap.val() || {};
  
  // For dine-in, need table
  if (session.tableId) {
    await proceedToPayment(phone, outlet, businessId, session);
    return;
  }
  
  // Ask for order type
  await enqueueTask('sendOutboundMessage', {
    to: formatJid(phone)!,
    outlet,
    businessId,
    type: 'template',
    template: {
      name: 'order_type_select',
      language: 'en',
      components: [
        { type: 'body', parameters: [{ type: 'text', text: 'How would you like to order?' }] },
        { type: 'button', sub_type: 'quick_reply', index: 0, parameters: [{ type: 'payload', payload: 'type_pickup' }] },
        { type: 'button', sub_type: 'quick_reply', index: 1, parameters: [{ type: 'payload', payload: 'type_delivery' }] },
        { type: 'button', sub_type: 'quick_reply', index: 2, parameters: [{ type: 'payload', payload: 'type_dinein' }] },
      ],
    },
    correlationId: generateCorrelationId(),
  });
  
  await updateSessionState(businessId, outlet, phone, 'CHECKOUT');
}

/**
 * Handle order type selection
 */
export async function handleOrderType(
  payload: ProcessInboundMessagePayload,
  session: SessionData,
  type: string
): Promise<void> {
  const { outlet, businessId } = payload;
  const phone = normalizePhone(message.from);
  
  switch (type) {
    case 'type_pickup':
      await updateSessionState(businessId, outlet, phone, 'CHECKOUT', { orderType: 'pickup' });
      await proceedToPayment(phone, outlet, businessId, session);
      break;
    case 'type_delivery':
      await askForDeliveryAddress(phone, outlet, businessId, session);
      break;
    case 'type_dinein':
      await askForTableNumber(phone, outlet, businessId, session);
      break;
  }
}

/**
 * Ask for delivery address
 */
async function askForDeliveryAddress(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData
): Promise<void> {
  await sendTextMessage(phone, outlet, businessId,
    '📍 Please share your delivery location:\n\n' +
    '1. Tap the 📎 attachment icon\n' +
    '2. Select "Location"\n' +
    '3. Send your current location or pin a location\n\n' +
    'Or reply with your full address.'
  );
  
  await updateSessionState(businessId, outlet, phone, 'CHECKOUT', { orderType: 'delivery' });
}

/**
 * Ask for table number
 */
async function askForTableNumber(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData
): Promise<void> {
  await sendTextMessage(phone, outlet, businessId,
    '🪑 Please enter your table number (e.g., "Table 5" or just "5"):'
  );
  
  await updateSessionState(businessId, outlet, phone, 'CHECKOUT', { orderType: 'dinein' });
}

/**
 * Proceed to payment
 */
async function proceedToPayment(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData
): Promise<void> {
  // Compute totals
  const totals = computeOrderTotals({
    subtotal: session.cartTotal,
    discount: 0,
    taxRates: [{ name: 'GST', rate: 5 }],
    serviceChargeRate: 0,
    deliveryFee: session.context?.deliveryFee || 0,
    isDineIn: session.context?.orderType === 'dinein',
  });
  
  await updateSessionState(businessId, outlet, phone, 'PAYMENT', {
    orderTotal: totals.total,
    tax: totals.tax,
    serviceCharge: totals.serviceCharge,
    deliveryFee: totals.deliveryFee,
  });
  
  // Show payment options
  await enqueueTask('sendOutboundMessage', {
    to: formatJid(phone)!,
    outlet,
    businessId,
    type: 'template',
    template: {
      name: 'payment_options',
      language: 'en',
      components: [
        { type: 'header', parameters: [{ type: 'text', text: `💰 Total: ₹${totals.total}` }] },
        { type: 'body', parameters: [{ type: 'text', text: 'Choose payment method:' }] },
        { type: 'button', sub_type: 'quick_reply', index: 0, parameters: [{ type: 'payload', payload: 'pay_cod' }] },
        { type: 'button', sub_type: 'quick_reply', index: 1, parameters: [{ type: 'payload', payload: 'pay_online' }] },
        { type: 'button', sub_type: 'quick_reply', index: 2, parameters: [{ type: 'payload', payload: 'pay_at_counter' }] },
      ],
    },
    correlationId: generateCorrelationId(),
  });
}

// ============================================
// PAYMENT HANDLERS
// ============================================

/**
 * Process payment verification
 */
export async function processPaymentVerification(
  payload: ProcessInboundMessagePayload,
  session: SessionData,
  text: string
): Promise<void> {
  const { message, outlet, businessId } = payload;
  const customerPhone = normalizePhone(message.from);
  const lowerText = text.toLowerCase().trim();
  
  // Handle payment method selection
  if (lowerText.startsWith('pay_')) {
    const method = lowerText.replace('pay_', '');
    await handlePaymentMethod(customerPhone, outlet, businessId, session, method);
    return;
  }
  
  // Handle OTP verification
  if (/^\d{6}$/.test(text)) {
    await verifyOtp(customerPhone, outlet, businessId, session, text);
    return;
  }
  
  // Default
  await sendTextMessage(customerPhone, outlet, businessId, 'Please select a payment method or enter OTP.');
}

/**
 * Handle payment method
 */
async function handlePaymentMethod(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData,
  method: 'cod' | 'online' | 'at_counter'
): Promise<void> {
  if (method === 'cod' || method === 'at_counter') {
    // Place order directly
    await placeOrder(phone, outlet, businessId, session, method);
  } else if (method === 'online') {
    // Send payment link / initiate online payment
    await sendPaymentLink(phone, outlet, businessId, session);
  }
}

/**
 * Place order
 */
async function placeOrder(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData,
  paymentMethod: string
): Promise<void> {
  const db = getDB();
  const now = Date.now();
  const ist = getISTDateInfo(now);
  
  // Generate order ID
  const orderId = `${ist.dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
  
  // Compute final totals
  const totals = computeOrderTotals({
    subtotal: session.cartTotal,
    discount: 0,
    taxRates: [{ name: 'GST', rate: 5 }],
    serviceChargeRate: session.context?.orderType === 'dinein' ? 10 : 0,
    deliveryFee: session.context?.deliveryFee || 0,
    isDineIn: session.context?.orderType === 'dinein',
  });
  
  const order: OrderData = {
    orderId,
    bid: businessId,
    oid: outlet,
    status: 'Placed',
    paymentStatus: paymentMethod === 'cod' ? 'Pending' : 'Paid',
    source: 'WHATSAPP',
    channel: 'whatsapp',
    total: totals.total,
    subtotal: totals.subtotal,
    tax: totals.tax,
    taxItems: totals.taxItems,
    serviceCharge: totals.serviceCharge,
    deliveryFee: totals.deliveryFee,
    discount: 0,
    items: session.cart,
    customerPhone: phone,
    customerName: session.name,
    sessionId: session.sessionId,
    tableId: session.tableId,
    createdAt: now,
    updatedAt: now,
  };
  
  // Save order
  await outletRef(businessId, outlet, 'orders', orderId).set(order);
  
  // Update session
  await clearCart(businessId, outlet, phone);
  await setActiveOrder(businessId, outlet, phone, true);
  await updateSessionState(businessId, outlet, phone, 'COMPLETED');
  
  // Send confirmation
  await sendOrderConfirmation(phone, outlet, businessId, order);
  
  // Notify kitchen
  await notifyKitchen(outlet, businessId, order);
  
  // Notify rider if delivery
  if (session.context?.orderType === 'delivery') {
    await notifyRider(outlet, businessId, order);
  }
}

/**
 * Send order confirmation
 */
async function sendOrderConfirmation(
  phone: string,
  outlet: string,
  businessId: string,
  order: OrderData
): Promise<void> {
  const ist = getISTDateInfo(order.createdAt);
  
  let text = `✅ *Order Confirmed!*\n------------------------\n`;
  text += `📦 Order #${formatOrderId(order.orderId)}\n`;
  text += `🕐 ${formatDisplayDateTime(order.createdAt)}\n`;
  text += `------------------------\n`;
  
  for (const item of order.items) {
    text += `• ${item.name}`;
    if (item.size) text += ` (${item.size})`;
    text += ` x${item.quantity} = ₹${item.price * item.quantity}\n`;
  }
  
  text += `------------------------\n`;
  text += `💰 Subtotal: ₹${order.subtotal}\n`;
  if (order.tax > 0) text += `🧾 GST: ₹${order.tax}\n`;
  if (order.serviceCharge > 0) text += `💼 Service: ₹${order.serviceCharge}\n`;
  if (order.deliveryFee > 0) text += `🚚 Delivery: ₹${order.deliveryFee}\n`;
  text += `💵 *Total: ₹${order.total}*\n`;
  text += `------------------------\n`;
  text += `💳 Payment: ${order.paymentStatus === 'Paid' ? 'Paid Online' : 'Cash on Delivery'}\n`;
  if (order.tableId) text += `🪑 Table: ${order.tableId}\n`;
  
  await sendTextMessage(phone, outlet, businessId, text);
}

// ============================================
// SUPPORT HANDLERS
// ============================================

/**
 * Process support request
 */
export async function processSupportRequest(
  payload: ProcessInboundMessagePayload,
  session: SessionData,
  text: string
): Promise<void> {
  const { outlet, businessId } = payload;
  const phone = normalizePhone(message.from);
  
  await sendTextMessage(phone, outlet, businessId,
    '🙋 Our support team will contact you shortly.\n\n' +
    'For urgent issues, please call the restaurant directly.'
  );
  
  await updateSessionState(businessId, outlet, phone, 'START');
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function sendTextMessage(
  phone: string,
  outlet: string,
  businessId: string,
  text: string
): Promise<void> {
  await enqueueTask('sendOutboundMessage', {
    to: formatJid(phone)!,
    outlet,
    businessId,
    type: 'text',
    text,
    correlationId: generateCorrelationId(),
  });
}

async function sendPaymentLink(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData
): Promise<void> {
  await sendTextMessage(phone, outlet, businessId,
    '💳 Online payment link will be sent shortly.\n' +
    'Please complete payment to confirm your order.'
  );
}

async function verifyOtp(
  phone: string,
  outlet: string,
  businessId: string,
  session: SessionData,
  otp: string
): Promise<void> {
  // Verify OTP logic here
  await placeOrder(phone, outlet, businessId, session, 'online');
}

async function notifyKitchen(outlet: string, businessId: string, order: OrderData): Promise<void> {
  const db = getDB();
  const staffSnap = await db.ref(`businesses/${businessId}/outlets/${outlet}/staff`).once('value');
  const staff = staffSnap.val() || {};
  
  for (const [staffId, staffData] of Object.entries(staff)) {
    if (staffData.role === 'kitchen' && staffData.phone) {
      await sendTextMessage(staffData.phone, outlet, businessId, 
        `🍳 *New Order!*\n#${formatOrderId(order.orderId)}\n${order.items.length} items`
      );
    }
  }
}

async function notifyRider(outlet: string, businessId: string, order: OrderData): Promise<void> {
  const db = getDB();
  const ridersSnap = await db.ref(`businesses/${businessId}/outlets/${outlet}/riders`).once('value');
  const riders = ridersSnap.val() || {};
  
  // Find available rider
  for (const [riderId, rider] of Object.entries(riders)) {
    if (rider.status === 'available' && rider.phone) {
      await sendTextMessage(rider.phone, outlet, businessId,
        `🛵 *New Delivery!*\n#${formatOrderId(order.orderId)}\nAddress: ${order.context?.deliveryAddress?.address}`
      );
      break;
    }
  }
}

// Import types
type ProcessInboundMessagePayload = any;
type SessionData = any;
type CartItem = any;
type OrderData = any;
type MetaMessage = any;
type MetaContact = any;