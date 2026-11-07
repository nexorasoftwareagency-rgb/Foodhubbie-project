/**
 * Wraps Meta's Embedded Signup popup flow for WhatsApp Cloud API.
 * Meta Cloud API only — this dashboard never references Baileys or a
 * QR-login flow.
 *
 * v4 flow:
 *   1. FB.login opens the Embedded Signup popup (config_id = META_CONFIG_ID).
 *   2. Meta posts a message to this window with { waba_id, phone_number_id,
 *      status: 'FINISH' | 'CANCEL' } on the window 'message' event.
 *   3. The code from response.authResponse is exchanged server-side via
 *      /api/whatsapp/exchange along with the captured wabaId / phoneNumberId.
 *   4. The server writes `whatsapp` + `phoneNumberIndex` + `wabaIndex`.
 *
 * The dashboard's job ends there. The Orchestrator (server-side, watching
 * Firebase from the EC2 box) is what actually starts the PM2 bot worker —
 * this module must never attempt that itself.
 *
 * Requires the Facebook JS SDK to be loaded (see loadFacebookSdk below)
 * and a configured Meta app / WhatsApp Embedded Signup config ID.
 */

import { showToast } from '/js/utils.js';

const META_APP_ID = '1894358871543574';           // Meta App ID (from DEPLOYMENT-PROGRESS.md)
const META_CONFIG_ID = '1089451087291012';        // WhatsApp Embedded Signup configuration ID ("Agent Control") — created with system-user token, v4 product-scoped (verified 2026-11-01)

// Captured from Meta's v4 Embedded Signup postMessage. Populated asynchronously
// — may arrive before or after the FB.login callback, so handleFbResponse
// reads it at exchange time.
let signupCapture = null; // { wabaId, phoneNumberId, settled: boolean, cancelled: boolean }

function handleEmbeddedSignupMessage(event) {
  // Only accept messages from Facebook's domain.
  if (!event.origin || !event.origin.includes('facebook.com')) return;

  const data = event.data;
  if (!data || !data.wa_embedded_signup) return;

  const { status, waba_id, phone_number_id } = data;

  if (status === 'CANCEL') {
    if (signupCapture && !signupCapture.settled) {
      signupCapture.settled = true;
      signupCapture.cancelled = true;
    }
    return;
  }

  if (status === 'FINISH' && signupCapture && !signupCapture.settled) {
    signupCapture.settled = true;
    signupCapture.wabaId = waba_id || null;
    signupCapture.phoneNumberId = phone_number_id || null;
  }
}

function cleanupSignupCapture() {
  window.removeEventListener('message', handleEmbeddedSignupMessage);
  signupCapture = null;
}

export async function launchWhatsAppSignup(bid, oid, { onComplete } = {}) {
  if (META_CONFIG_ID === 'REPLACE_ME') {
    showToast('WhatsApp Embedded Signup is not set up. To use it: enable "WhatsApp Embedded Signup" for the Foodhubbie app (App Dashboard → WhatsApp) and paste its config ID into META_CONFIG_ID in whatsapp-linking.js. Until then, use "Connect a number" (Path B) — it already works for your linked number.', 'error');
    return;
  }
  try {
    await loadFacebookSdk();
  } catch (err) {
    console.error('Facebook SDK failed to load', err);
    showToast('Could not load WhatsApp signup — check your network and Meta App ID.', 'error');
    return;
  }

  // Listen for Meta's v4 postMessage before opening the popup, so we don't
  // miss it whether it arrives before or after the FB.login callback.
  signupCapture = { settled: false, cancelled: false, wabaId: null, phoneNumberId: null };
  window.addEventListener('message', handleEmbeddedSignupMessage);

  window.FB.login(
    (response) => handleFbResponse(response, bid, oid, onComplete),
    {
      config_id: META_CONFIG_ID,
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: 'cloud_api', sessionInfoVersion: '4' },
    }
  );
}

async function handleFbResponse(response, bid, oid, onComplete) {
  if (!response || response.status !== 'connected' || !response.authResponse) {
    if (signupCapture && signupCapture.cancelled) {
      showToast('WhatsApp signup was cancelled.', 'info');
    } else {
      showToast('WhatsApp connection was cancelled or did not complete.', 'error');
    }
    cleanupSignupCapture();
    return;
  }

  // In production, the authorization `code` in response.authResponse should
  // be exchanged server-side (Bot Control API) for the phoneNumberId /
  // wabaId — never do a client-side token exchange with app secrets.
  // v4: also send wabaId / phoneNumberId captured from the postMessage so the
  // server doesn't have to guess them.
  try {
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${TUNNEL_URL}/api/whatsapp/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        bid,
        oid,
        code: response.authResponse.code,
        wabaId: signupCapture?.wabaId || null,
        phoneNumberId: signupCapture?.phoneNumberId || null,
      }),
    });
    if (!res.ok) throw new Error(`Exchange failed with ${res.status}`);
    const { phoneNumberId, wabaId } = await res.json();

    // The exchange endpoint writes `whatsapp` + `phoneNumberIndex` + `wabaIndex`
    // server-side (waLinkSuccess). The client must never write these nodes —
    // they're a super/supreme-only secret boundary on Path B.
    showToast('WhatsApp connected. The bot worker should come online within ~5s.', 'success');
    if (onComplete) onComplete();
  } catch (err) {
    console.error('WhatsApp linking exchange failed', err);
    showToast('Connected to Meta, but saving the WhatsApp link failed — check the Bot Control API logs.', 'error');
  } finally {
    cleanupSignupCapture();
  }
}

function loadFacebookSdk() {
  if (fbSdkLoaded && window.FB) return Promise.resolve();
  if (fbSdkLoadingPromise) return fbSdkLoadingPromise; // a load is already in flight - reuse it, don't hang or double-inject the script

  fbSdkLoadingPromise = new Promise((resolve, reject) => {
    window.fbAsyncInit = function () {
      window.FB.init({ appId: META_APP_ID, cookie: true, xfbml: false, version: 'v20.0' });
      fbSdkLoaded = true;
      resolve();
    };
    const existing = document.getElementById('facebook-jssdk');
    if (existing) {
      // Script tag already exists from an earlier in-flight call. If FB is
      // already up, resolve now; otherwise fbAsyncInit above fires when
      // that earlier load finishes and resolves this same shared promise.
      if (window.FB) resolve();
      return;
    }
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.onerror = () => { fbSdkLoadingPromise = null; reject(new Error('Facebook SDK script failed to load')); };
    document.body.appendChild(script);
  });

  return fbSdkLoadingPromise;
}
