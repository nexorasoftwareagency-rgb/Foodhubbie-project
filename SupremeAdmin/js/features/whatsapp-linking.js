/**
 * Wraps Meta's Embedded Signup popup flow for WhatsApp Cloud API.
 * Meta Cloud API only — this dashboard never references Baileys or a
 * QR-login flow.
 *
 * On success, writes:
 *   businesses/{bid}/outlets/{oid}/whatsapp = { phoneNumberId, wabaId, status: 'active' }
 *
 * The dashboard's job ends there. The Orchestrator (server-side, watching
 * Firebase from the EC2 box) is what actually starts the PM2 bot worker —
 * this module must never attempt that itself.
 *
 * Requires the Facebook JS SDK to be loaded (see loadFacebookSdk below)
 * and a configured Meta app / WhatsApp Embedded Signup config ID.
 */

const META_APP_ID = '1894358871543574';           // Meta App ID (from DEPLOYMENT-PROGRESS.md)
const META_CONFIG_ID = 'REPLACE_ME';             // WhatsApp Embedded Signup configuration ID

let fbSdkLoaded = false;
let fbSdkLoadingPromise = null;

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

  window.FB.login(
    (response) => handleFbResponse(response, bid, oid, onComplete),
    {
      config_id: META_CONFIG_ID,
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
    }
  );
}

async function handleFbResponse(response, bid, oid, onComplete) {
  if (!response || response.status !== 'connected' || !response.authResponse) {
    showToast('WhatsApp connection was cancelled or did not complete.', 'error');
    return;
  }

  // In production, the authorization `code` in response.authResponse should
  // be exchanged server-side (Bot Control API) for the phoneNumberId /
  // wabaId — never do a client-side token exchange with app secrets.
  try {
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${TUNNEL_URL}/api/whatsapp/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bid, oid, code: response.authResponse.code }),
    });
    if (!res.ok) throw new Error(`Exchange failed with ${res.status}`);
    const { phoneNumberId, wabaId } = await res.json();

    await firebase.database().ref(`businesses/${bid}/outlets/${oid}/whatsapp`).set({
      phoneNumberId, wabaId, status: 'active',
      connectedAt: firebase.database.ServerValue.TIMESTAMP,
    });

    showToast('WhatsApp connected. The bot worker should come online within ~5s.', 'success');
    if (onComplete) onComplete();
  } catch (err) {
    console.error('WhatsApp linking exchange failed', err);
    showToast('Connected to Meta, but saving the WhatsApp link failed — check the Bot Control API logs.', 'error');
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
