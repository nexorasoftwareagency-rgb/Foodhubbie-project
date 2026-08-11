/**
 * ROSHANI ERP | GESTURE MANAGEMENT
 * Handles mobile-specific gestures like swipe-to-close for drawers.
 */

import { haptic } from './utils.js';

export function initGestures() {
    initSwipeToClose('orderDrawer', () => {
        const drawer = document.getElementById('orderDrawer');
        const overlay = document.getElementById('orderDrawerOverlay');
        if (drawer) drawer.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    });

    initSwipeToClose('notificationSheet', () => {
        const sheet = document.getElementById('notificationSheet');
        const overlay = document.getElementById('notificationOverlay');
        if (sheet) sheet.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    });
}

/**
 * INIT SWIPE TO CLOSE
 * Adds touch listeners for swipe-to-close (horizontal for full-page drawers).
 * Only activates from the left edge (40px) to avoid conflicting with vertical scroll
 * and uses a diagonal threshold to distinguish swipe from scroll.
 */
function initSwipeToClose(elementId, closeCallback) {
    const el = document.getElementById(elementId);
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isSwiping = false;
    const EDGE_THRESHOLD = 40;
    const SWIPE_THRESHOLD = 100;
    const DIAGONAL_THRESHOLD = 30;

    el.addEventListener('touchstart', (e) => {
        if (el.querySelector('.dw-body')?.scrollTop > 0) return;
        const touchX = e.touches[0].pageX;
        const drawerRect = el.getBoundingClientRect();
        if (touchX - drawerRect.left > EDGE_THRESHOLD) return;
        startX = touchX;
        startY = e.touches[0].pageY;
        currentX = startX;
        isSwiping = true;
        el.style.transition = 'none';
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
        if (!isSwiping) return;

        currentX = e.touches[0].pageX;
        const currentY = e.touches[0].pageY;
        const diffX = currentX - startX;
        const diffY = Math.abs(currentY - startY);

        if (diffY > diffX && diffY > DIAGONAL_THRESHOLD) {
            isSwiping = false;
            el.style.transform = '';
            return;
        }

        if (diffX > 0) {
            el.style.transform = `translateX(${diffX}px)`;
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
        } else {
            el.style.transform = '';
            isSwiping = false;
        }
    }, { passive: false });

    el.addEventListener('touchend', () => {
        if (!isSwiping) return;
        isSwiping = false;

        const diff = currentX - startX;
        el.style.transition = '';

        if (diff > SWIPE_THRESHOLD) {
            haptic(10);
            el.style.transform = '';
            closeCallback();
        } else {
            el.style.transform = '';
        }

        startX = 0;
        startY = 0;
        currentX = 0;
    });

    el.addEventListener('touchcancel', () => {
        isSwiping = false;
        el.style.transition = '';
        el.style.transform = '';
        startX = 0;
        startY = 0;
        currentX = 0;
    });
}
