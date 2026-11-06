/**
 * Signup authentication — the ONLY place the restaurant signup password goes.
 *
 * Before 2026-11-06 the signup page PUT the plaintext password into
 * Realtime Database (`onboardingSecrets/{reqKey}`) and the approval API read
 * it back to create the Firebase Auth user, then echoed it into the Supreme
 * Admin UI. This module removes the database leg entirely: the password goes
 * browser -> Firebase Auth over TLS, and Firebase stores a salted scrypt
 * hash. Nothing else ever sees it.
 *
 * A named secondary app instance is used so the signup page never becomes a
 * signed-in admin session in the applicant's browser.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
    getAuth,
    setPersistence,
    inMemoryPersistence,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Public web config — same project the Admin dashboard uses. Not a secret.
const firebaseConfig = {
    apiKey: 'AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4',
    authDomain: 'foodhubbie-10.firebaseapp.com',
    databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com',
    projectId: 'foodhubbie-10',
    storageBucket: 'foodhubbie-10.firebasestorage.app',
    messagingSenderId: '372428105696',
    appId: '1:372428105696:web:a3a979191a5cf94569ed85',
};

const APP_NAME = 'fh-signup';
let _authPromise = null;

function signupAuth() {
    if (!_authPromise) {
        const app = initializeApp(firebaseConfig, APP_NAME);
        const auth = getAuth(app);
        // In-memory only: closing the tab must not leave an admin session.
        _authPromise = setPersistence(auth, inMemoryPersistence).then(() => auth);
    }
    return _authPromise;
}

/** Create the account. Resolves { uid }. Throws an Error with Firebase's `code`. */
export async function createAccount(email, password) {
    const auth = await signupAuth();
    const cred = await createUserWithEmailAndPassword(auth, String(email).trim(), password);
    const uid = cred.user.uid;
    await signOut(auth).catch(() => {});
    return { uid };
}

/**
 * Retry/resume path. The email already has an account (the applicant may have
 * reloaded after a failed submit); proving the password proves ownership.
 * Resolves { uid } or throws with `auth/invalid-credential` / `auth/wrong-password`.
 */
export async function signInExisting(email, password) {
    const auth = await signupAuth();
    const cred = await signInWithEmailAndPassword(auth, String(email).trim(), password);
    const uid = cred.user.uid;
    await signOut(auth).catch(() => {});
    return { uid };
}
