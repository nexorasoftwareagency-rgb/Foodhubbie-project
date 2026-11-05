const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase, ref, push, set, get } = require('firebase-admin/database');
const path = require('path');

// Initialize Firebase Admin
// Uses GOOGLE_APPLICATION_CREDENTIALS env var or service account key file
const serviceAccountPath = path.join(__dirname, '..', 'firebase-service-account.json');

let app;
try {
  if (require('fs').existsSync(serviceAccountPath)) {
    app = initializeApp({ credential: cert(serviceAccountPath) });
  } else {
    // Try default credentials (Cloud Functions, Cloud Run, etc.)
    app = initializeApp();
  }
} catch (e) {
  console.error('Failed to initialize Firebase Admin:', e.message);
  process.exit(1);
}

const db = getDatabase(app);

const DEFAULT_CATEGORIES = [
  { name: 'Rent', color: '#3B82F6', icon: 'home', monthlyBudget: 50000, alertThreshold: 80, isSystem: true, displayOrder: 1 },      // Rs. 50,000
  { name: 'Utilities', color: '#F59E0B', icon: 'zap', monthlyBudget: 10000, alertThreshold: 80, isSystem: true, displayOrder: 2 },     // Rs. 10,000
  { name: 'Payroll', color: '#10B981', icon: 'credit-card', monthlyBudget: 200000, alertThreshold: 80, isSystem: true, displayOrder: 3 }, // Rs. 2,00,000
  { name: 'Supplies', color: '#8B5CF6', icon: 'utensils', monthlyBudget: 5000, alertThreshold: 80, isSystem: true, displayOrder: 4 },    // Rs. 5,000
  { name: 'Marketing', color: '#EC4899', icon: 'megaphone', monthlyBudget: 10000, alertThreshold: 80, isSystem: true, displayOrder: 5 },   // Rs. 10,000
  { name: 'Maintenance', color: '#64748B', icon: 'wrench', monthlyBudget: 3000, alertThreshold: 80, isSystem: true, displayOrder: 6 },    // Rs. 3,000
  { name: 'Misc', color: '#6B7280', icon: 'dollar-sign', monthlyBudget: 2000, alertThreshold: 80, isSystem: true, displayOrder: 7 },      // Rs. 2,000
];

async function seedCategories() {
  const outletId = process.env.OUTLET_ID || 'pizza';
  const categoriesRef = require('firebase-admin/database').ref(
    require('firebase-admin/database').getDatabase(),
    `businesses/foodhubbie/outlets/${outletId}/expenseCategories`
  );

  console.log(`Seeding expense categories for outlet: ${outletId}`);

  try {
    // Check if categories already exist
    const snapshot = await require('firebase-admin/database').get(categoriesRef);
    if (snapshot.exists() && Object.keys(snapshot.val() || {}).length > 0) {
      console.log('Categories already exist. Skipping seed.');
      return;
    }

    // Seed each category
    for (const cat of DEFAULT_CATEGORIES) {
      const newRef = push(categoriesRef);
      await set(newRef, cat);
      console.log(`Seeded: ${cat.name} (${cat.icon})`);
    }

    console.log('All default expense categories seeded successfully!');
  } catch (e) {
    console.error('Failed to seed categories:', e);
  } finally {
    process.exit(0);
  }
}

seedCategories();