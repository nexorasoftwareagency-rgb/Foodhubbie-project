/**
 * SHARED DATE/TIME FORMATTERS — IST-first.
 *
 * Usage:
 *   import { getISTDateString } from '../shared/format/date.js';
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
