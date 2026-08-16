/**
 * FoodHubbie ERP | PROMOTIONS GUIDE
 * Renders a 6-step "How to use" article inside the guide modal.
 */

import { loadLucide } from '../ui.js';

const STEPS = [
    {
        icon: 'edit-3',
        title: 'Compose',
        body: 'Write your message in the composer. Use tokens like <code>{name}</code>, <code>{phone}</code>, <code>{lastOrderDate}</code>, and <code>{storeName}</code> to personalize automatically. Click the <strong>template picker</strong> button to choose from 24 pre-built message templates.',
    },
    {
        icon: 'users',
        title: 'Pick recipients',
        body: 'Choose an audience (all consenting customers, last 30 days active, or upload a CSV/Excel). Customers who replied STOP to a previous message are excluded automatically. Recipients are capped at <strong>300 per campaign</strong>.',
    },
    {
        icon: 'message-square',
        title: 'Message options',
        body: 'Toggle the <strong>STOP footer</strong> to append "Reply STOP to unsubscribe" to your message. Add a <strong>closing message</strong> (e.g. thank-you note) that appears after the template body. The <strong>menu footer</strong> is appended inline and the <strong>menu image</strong> is sent with your message, so everything goes out together as one message (a second image only if you attach both a promo image and a menu image).',
    },
    {
        icon: 'eye',
        title: 'Preview & Test',
        body: 'Click <strong>Preview</strong> to see how a sample recipient will read it (including STOP footer, closing message, and menu image), and <strong>Send test to me</strong> to receive the message on your own WhatsApp before launching.',
    },
    {
        icon: 'send',
        title: 'Send or Schedule',
        body: 'Hit <strong>Launch campaign</strong> to start immediately, or switch to the <strong>Schedule</strong> tab to set a future date/time with quiet hours. The bot paces itself with an <strong>8-15s random delay</strong> and pauses <strong>60-120s every 30 sends</strong> to stay safe.',
    },
    {
        icon: 'shield',
        title: 'Monitor & Stay safe',
        body: 'The <strong>Active</strong> tab shows every running or scheduled campaign with a live progress bar, sent/failed counts, and the option to stop an individual campaign. Use the red <strong>EMERGENCY STOP ALL</strong> button to pause every active campaign immediately. STOP replies from customers are honored automatically.',
    },
];

export async function renderPromotionsGuide(container) {
    if (!container) return;
    container.innerHTML = `
        <ol class="promo-guide-list">
            ${STEPS.map((s, i) => `
                <li class="promo-guide-item">
                    <div class="promo-guide-num">${i + 1}</div>
                    <div>
                        <h4 class="promo-guide-title"><i data-lucide="${s.icon}" class="icon-16"></i> ${s.title}</h4>
                        <p class="text-muted-small mt-4">${s.body}</p>
                    </div>
                </li>
            `).join('')}
        </ol>
        <p class="text-muted-small mt-16">
            <i data-lucide="info" class="icon-14"></i>
            Only customers with <code>promotionalConsent: true</code> (recorded at their first order) will receive messages.
            Recipients are capped at 300 per campaign.
        </p>
    `;
    await loadLucide();
    if (window.lucide) window.lucide.createIcons({ root: container });
}
