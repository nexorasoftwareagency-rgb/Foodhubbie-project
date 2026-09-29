// Single source of truth for billing defaults
// Used by: SupremeAdmin onboarding wizard, bot-control-api onboarding endpoint

export const BILLING_DEFAULTS = {
  plan: 'basic',
  billingCycle: 'monthly',
  monthlyRate: 299,
  yearlyRate: 2999,
  overagePerOrder: 2,
  trialDays: 30,
  gracePeriodDays: 7,
  maxOrdersMonthly: null, // null = unlimited
  features: {
    whatsappBot: true,
    qrOrdering: true,
    riderDispatch: true,
    inventory: true,
    expenses: true,
    promotions: true,
    analytics: true,
    multiOutlet: false,
    apiAccess: false,
    customDomain: false,
    prioritySupport: false,
  },
  whatsappTemplates: {
    included: 1000,
    overagePerMessage: 0.50,
  },
  riderCommission: {
    enabled: true,
    perOrder: 15,
    monthlyCap: 5000,
  },
};

export function getBillingDefaults() {
  return { ...BILLING_DEFAULTS };
}

export function validateBillingConfig(config) {
  const errors = [];
  if (config.monthlyRate !== undefined && (config.monthlyRate < 0 || config.monthlyRate > 10000)) {
    errors.push('monthlyRate must be between 0 and 10000');
  }
  if (config.yearlyRate !== undefined && (config.yearlyRate < 0 || config.yearlyRate > 100000)) {
    errors.push('yearlyRate must be between 0 and 100000');
  }
  if (config.overagePerOrder !== undefined && (config.overagePerOrder < 0 || config.overagePerOrder > 100)) {
    errors.push('overagePerOrder must be between 0 and 100');
  }
  return { valid: errors.length === 0, errors };
}