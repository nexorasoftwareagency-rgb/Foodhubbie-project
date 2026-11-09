/**
 * tools/migrate-images-to-storage.mjs
 *
 * Migrates existing base64 image URLs in RTDB dishes to Firebase Storage
 * with WebP conversion via Cloud Function.
 *
 * Usage:
 *   node tools/migrate-images-to-storage.mjs          # dry-run (shows what would change)
 *   node tools/migrate-images-to-storage.mjs --apply  # actually migrate
 *
 * Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars for Auth sign-in.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase, ref as dbRef, get } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
import { getAuth, signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

const DRY_RUN = process.argv.includes('--apply') ? false : true;

const firebaseConfig = {
    apiKey: "AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4",
    authDomain: "foodhubbie-10.firebaseapp.com",
    databaseURL: "https://foodhubbie-10-default-rtdb.firebaseio.com",
    projectId: "foodhubbie-10",
    storageBucket: "foodhubbie-10.firebasestorage.app",
    messagingSenderId: "372428105696",
    appId: "1:372428105696:web:a3a979191a5cf94569ed85"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const storage = getStorage(app);

async function signIn() {
    const email = process.env.ADMIN_EMAIL || 'admin@foodhubbie.in';
    const password = process.env.ADMIN_PASSWORD;
    if (!password) {
        throw new Error('ADMIN_PASSWORD env var required');
    }
    await signInWithEmailAndPassword(auth, email, password);
    console.log('Signed in as', email);
}

async function migrate() {
    console.log('DRY RUN mode - no changes will be made. Use --apply to apply changes.\n');

    const dishesSnap = await get(dbRef(db, 'businesses/roshani-pizza/outlets/pizza/dishes'));
    const dishes = dishesSnap.val() || {};
    console.log(`Found ${Object.keys(dishes).length} dishes`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const [dishId, dish] of Object.entries(dishes)) {
        const image = dish?.image;
        if (!image || !image.startsWith('data:')) {
            skipped++;
            continue;
        }

        console.log(`  Migrating dish ${dishId}: ${dish.name || '(no name)'} (${image.length} chars base64)`);

        if (DRY_RUN) {
            migrated++;
            continue;
        }

        try {
            // Decode base64 to blob
            const base64 = image.split(',')[1];
            const response = await fetch(`data:${image.split(',')[0]};base64,${base64}`);
            const blob = await response.blob();

            // Upload to Storage
            const storageRef = storageRef(storage, `outlets/roshani-pizza/pizza/dishes/${dishId}/original.jpg`);
            await uploadBytes(storageRef, blob, {
                contentType: 'image/jpeg',
                cacheControl: 'public, max-age=31536000',
            });

            // Get download URL
            const downloadUrl = await getDownloadURL(storageRef);

            // Update RTDB with Storage URL
            await set(dbRef(db, `businesses/roshani-pizza/outlets/pizza/dishes/${dishId}/image`), downloadUrl);

            migrated++;
            console.log(`    ✓ Uploaded: ${downloadUrl}`);
        } catch (err) {
            errors++;
            console.error(`    ✗ Failed: ${err.message}`);
        }
    }

    console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);
}

async function main() {
    await signIn();
    await migrate();
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
