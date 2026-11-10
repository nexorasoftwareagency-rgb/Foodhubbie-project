/**
 * Shared TypeScript Types for Foodhubbie Functions
 * Single source of truth for all interfaces
 */

// ============================================
// META WHATSAPP WEBHOOK TYPES
// ============================================

export interface MetaWebhookPayload {
  object: 'whatsapp_business_account';
  entry: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  id: string;
  changes: MetaWebhookChange[];
}

export interface MetaWebhookChange {
  value: MetaWebhookValue;
  field: 'messages';
}

export interface MetaWebhookValue {
  messaging_product: 'whatsapp';
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: MetaContact[];
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
}

export interface MetaContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

export type MetaMessageType = 'text' | 'interactive' | 'button' | 'order' | 'location' | 'image' | 'document' | 'audio' | 'video' | 'sticker' | 'reaction' | 'system' | 'unknown';

export interface MetaMessage {
  from: string;
  id: string;
  timestamp: string;
  type: MetaMessageType;
  text?: { body: string };
  interactive?: MetaInteractive;
  button?: MetaButton;
  order?: MetaOrder;
  location?: MetaLocation;
  image?: MetaMedia;
  document?: MetaMedia;
  audio?: MetaMedia;
  video?: MetaMedia;
  sticker?: MetaMedia;
  reaction?: MetaReaction;
  context?: MetaContext;
}

export interface MetaInteractive {
  type: 'list_reply' | 'button_reply' | 'nfm_reply' | 'cta_url_reply';
  list_reply?: {
    id: string;
    title: string;
    description?: string;
  };
  button_reply?: {
    id: string;
    title: string;
  };
  nfm_reply?: {
    response_json: string;
    name: string;
    body: string;
  };
  cta_url_reply?: {
    display_text: string;
    url: string;
  };
}

export interface MetaButton {
  text: string;
  payload?: string;
}

export interface MetaOrder {
  catalog_id: string;
  product_items: Array<{
    product_retailer_id: string;
    quantity: number;
    item_price: number;
    currency: string;
    sale_price?: number;
  }>;
  text?: string;
}

export interface MetaLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface MetaMedia {
  id: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
}

export interface MetaReaction {
  message_id: string;
  emoji: string;
}

export interface MetaContext {
  from: string;
  id: string;
  referred_product?: MetaReferredProduct;
}

export interface MetaReferredProduct {
  catalog_id: string;
  product_retailer_id: string;
}

export interface MetaStatus {
  id: string;
  recipient_id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'deleted';
  timestamp: string;
  conversation?: {
    id: string;
    origin: 'business_initiated' | 'user_initiated';
    expiration_timestamp: string;
  };
  pricing?: {
    billable: boolean;
    pricing_model: 'CBP' | 'NBP';
    category: 'utility' | 'authentication' | 'marketing' | 'service';
  };
  errors?: Array<{
    code: number;
    title: string;
    details: string;
    error_data?: {
      details: string;
    };
  }>;
}

// ============================================
// TASK QUEUE PAYLOAD TYPES
// ============================================

export interface ProcessInboundMessagePayload {
  message: MetaMessage;
  contact: MetaContact | null;
  outlet: string;
  businessId: string;
  phoneNumberId: string;
  correlationId: string;
}

export interface SendOutboundMessagePayload {
  to: string;
  outlet: string;
  businessId: string;
  type: 'template' | 'text' | 'image' | 'document' | 'location' | 'contacts';
  template?: {
    name: string;
    language: string;
    components: MetaTemplateComponent[];
  };
  text?: string;
  image?: { url: string; caption?: string };
  document?: { url: string; filename?: string; caption?: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: Array<{ name: { formatted_name: string }; phones: Array<{ phone: string; type: string }> }>;
  correlationId: string;
}

export interface MetaTemplateComponent {
  type: 'header' | 'body' | 'footer' | 'button';
  sub_type?: 'url' | 'quick_reply' | 'catalog' | 'copy_code' | 'mpm';
  index?: number;
  parameters?: Array<{
    type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video' | 'payload';
    text?: string;
    currency?: { fallback_value: string; code: string; amount_1000: number };
    date_time?: string;
    image?: { link: string };
    document?: { link: string; filename?: string };
    video?: { link: string };
    payload?: string;
  }>;
}

export interface RunPromoCampaignPayload {
  campaignId: string;
  outlet: string;
  businessId: string;
  batchNumber: number;
  correlationId: string;
}

export interface VerifyPaymentPayload {
  orderId: string;
  outlet: string;
  businessId: string;
  paymentId: string;
  gateway: 'razorpay' | 'phonepe' | 'cod';
  correlationId: string;
}

export interface ProcessRedeemPayload {
  rewardCode: string;
  orderId: string;
  outlet: string;
  businessId: string;
  customerPhone: string;
  appUid: string;
  correlationId: string;
}

// ============================================
// CALLABLE FUNCTION PAYLOADS
// ============================================

export interface BotControlPayload {
  action: 'status' | 'statusAll' | 'restart' | 'transport' | 'rescan';
  bid?: string;
  oid?: string;
  transport?: 'meta' | 'baileys';
  rescan?: boolean;
}

export interface OnboardingApprovePayload {
  requestKey: string;
  reviewerUid: string;
}

export interface TransportSwitchPayload {
  bid: string;
  oid: string;
  transport: 'meta' | 'baileys';
  rescan?: boolean;
}

export interface PasswordResetPayload {
  bid: string;
  oid: string;
  email: string;
  newPassword: string;
}

export interface WalletGatePublishPayload {
  bid: string;
  oid: string;
}

export interface SendAppNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  target: 'all' | 'outlet' | 'user';
  outlet?: string;
  userIds?: string[];
  topic?: string;
}

export interface GetWhatsAppQuotaPayload {
  bid: string;
  oid: string;
}

export interface QrMenuOrderPayload {
  bid: string;
  oid: string;
  cart: CartItem[];
  sessionId?: string;
  tableId?: string;
  customerPhone?: string;
  customerName?: string;
  deliveryAddress?: DeliveryAddress;
  paymentMethod: 'cod' | 'online' | 'pay_at_counter';
  loyaltyRedeem?: { code: string; appUid: string };
}

export interface CartItem {
  dishId: string;
  name: string;
  quantity: number;
  price: number;
  size?: string;
  addons?: Array<{ id: string; name: string; price: number }>;
  comboId?: string;
  isCombo?: boolean;
  comboQuantity?: number;
}

export interface DeliveryAddress {
  address: string;
  latitude: number;
  longitude: number;
  landmark?: string;
}

export interface QrMenuPaymentPayload {
  bid: string;
  oid: string;
  orderId: string;
  paymentId: string;
  gateway: 'razorpay' | 'phonepe';
  signature?: string;
}

// ============================================
// RTDB TRIGGER CONTEXTS
// ============================================

export interface OrderStatusChangeContext {
  bid: string;
  oid: string;
  orderId: string;
  before: string | null;
  after: string | null;
}

export interface OrderPaymentChangeContext {
  bid: string;
  oid: string;
  orderId: string;
  before: string | null;
  after: string | null;
}

export interface WalletUpdateContext {
  bid: string;
  oid: string;
  before: WalletData | null;
  after: WalletData | null;
}

export interface PromoCampaignCreateContext {
  bid: string;
  oid: string;
  campaignId: string;
  campaignData: PromoCampaignData;
}

export interface CustomerCreateContext {
  bid: string;
  oid: string;
  phone: string;
  customerData: CustomerData;
}

export interface RiderAssignContext {
  bid: string;
  oid: string;
  riderId: string;
  orderId: string;
}

// ============================================
// DATA MODELS
// ============================================

export interface WalletData {
  balance: number;
  balancePaise: number;
  walletGate: 'open' | 'low' | 'closed';
  enforce: boolean;
  minTopUp: number;
  currency: 'INR';
  updatedAt: number;
}

export interface PromoCampaignData {
  id: string;
  name: string;
  templateName: string;
  message: string;
  mediaUrl?: string;
  audience: 'all' | 'segment' | 'custom';
  segmentFilters?: Record<string, any>;
  customPhones?: string[];
  schedule: 'now' | 'scheduled' | 'recurring';
  scheduledAt?: number;
  recurringCron?: string;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
  stats: {
    total: number;
    sent: number;
    delivered: number;
    failed: number;
    optedOut: number;
  };
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

export interface CustomerData {
  phone: string;
  name?: string;
  email?: string;
  loyalty?: {
    points: number;
    lifetimePoints: number;
    tier: 'bronze' | 'silver' | 'gold' | 'platinum';
    rank?: number;
  };
  devices?: Record<string, { name?: string; fcmToken?: string; updatedAt: number }>;
  promotionalConsent?: boolean;
  appConsent?: { offers: boolean; marketing: boolean };
  createdAt: number;
  updatedAt: number;
}

export interface OrderData {
  orderId: string;
  bid: string;
  oid: string;
  status: 'Pending' | 'Placed' | 'Confirmed' | 'Preparing' | 'Ready' | 'Out for Delivery' | 'Delivered' | 'Cancelled' | 'Refunded';
  paymentStatus: 'Pending' | 'Paid' | 'Failed' | 'Refunded';
  source: 'WHATSAPP' | 'APP' | 'QR' | 'POS' | 'WEBVIEW';
  channel: 'whatsapp' | 'app' | 'qr' | 'pos' | 'webview';
  total: number;
  subtotal: number;
  tax: number;
  taxItems: Array<{ name: string; rate: number; amount: number }>;
  serviceCharge: number;
  deliveryFee: number;
  discount: number;
  discountSource?: string;
  items: OrderItem[];
  customerPhone: string;
  customerName?: string;
  sessionId?: string;
  tableId?: string;
  riderId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  loyaltyTender?: number;
  loyaltyPointsEarned?: number;
}

export interface OrderItem {
  dishId: string;
  name: string;
  quantity: number;
  price: number;
  size?: string;
  addons?: Array<{ id: string; name: string; price: number }>;
  comboId?: string;
  isCombo?: boolean;
  comboQuantity?: number;
}

// ============================================
// UTILITY TYPES
// ============================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    timestamp: number;
    correlationId: string;
  };
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type OptionalFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// ============================================
// CONFIGURATION TYPES
// ============================================

export interface OutletConfig {
  bid: string;
  oid: string;
  name: string;
  whatsapp?: {
    phoneNumberId: string;
    displayPhoneNumber: string;
    verifiedName: string;
    qualityRating: string;
    messagingLimitTier: string;
  };
  bot?: {
    transport: 'meta' | 'baileys';
    provisionedAt?: number;
    source?: 'orchestrator' | 'manual';
  };
  wallet?: {
    enforce: boolean;
    minTopUp: number;
  };
  settings: {
    Store: StoreSettings;
    Delivery: DeliverySettings;
    Tax: TaxSettings;
  };
}

export interface StoreSettings {
  storeName: string;
  address?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  logoUrl?: string;
  openTime?: string;
  closeTime?: string;
  timezone?: string;
}

export interface DeliverySettings {
  enabled: boolean;
  radiusKm: number;
  feeSlabs: Array<{ minKm: number; maxKm: number; fee: number }>;
  freeDeliveryAbove?: number;
  coordinates?: { latitude: number; longitude: number };
  backupCode?: string;
}

export interface TaxSettings {
  taxEnabled: boolean;
  taxRates: Array<{ name: string; rate: number }>;
  serviceChargeEnabled: boolean;
  serviceChargeRate: number;
}

// ============================================
// MONITORING TYPES
// ============================================

export interface FunctionMetrics {
  invocations: number;
  errors: number;
  latency: {
    p50: number;
    p95: number;
    p99: number;
  };
  memoryUsage: {
    avg: number;
    max: number;
  };
  cpuUsage: {
    avg: number;
    max: number;
  };
  coldStarts: number;
  egressBytes: number;
}

export interface CostMetrics {
  dailyCost: number;
  monthlyCost: number;
  projectedMonthlyCost: number;
  breakdown: {
    invocations: number;
    gbSeconds: number;
    cpuSeconds: number;
    minInstances: number;
    egress: number;
    storage: number;
  };
}