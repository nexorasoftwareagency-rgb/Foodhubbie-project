/**
 * SHARED DATE/TIME FORMATTERS — IST-first.
 *
 * Usage:
 *   import { formatDateShort, formatTimeShort, getISTDateString } from '../shared/format/date.js';
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toIST(dateInput) {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    return new Date(d.getTime() + IST_OFFSET_MS);
}

/**
 * "2026-06-04" (IST date string, YYYY-MM-DD).
 */
export function getISTDateString(dateInput = new Date()) {
    return toIST(dateInput).toISOString().split('T')[0];
}

/**
 * "4 Jun 2026, 2:30 PM" — short human-readable IST date+time.
 */
export function formatDateShort(dateInput) {
    if (!dateInput) return '';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata'
    });
}

/**
 * "2:30 PM" — time only (IST).
 */
export function formatTimeShort(dateInput) {
    if (!dateInput) return '';
    return new Date(dateInput).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata'
    });
}

/**
 * "04/06/2026" — Indian date format DD/MM/YYYY.
 */
export function formatDateIndian(dateInput) {
    if (!dateInput) return '';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Asia/Kolkata'
    });
}
