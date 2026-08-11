/**
 * SHARED HTML ESCAPER — canonical implementation.
 * Use this everywhere instead of re-implementing locally.
 *
 * Usage (ESM):
 *   import { escapeHtml } from '../shared/dom/escape.js';
 *
 * Usage (CJS):
 *   const { escapeHtml } = require('../shared/dom/escape.cjs');
 */
export const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    if (typeof str !== 'string') str = String(str);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/`/g, '&#96;');
};
