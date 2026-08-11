/**
 * Centralized logger with timestamps, color-coded categories, and on-screen activity log.
 * Usage:
 *   import { logger } from './utils/logger.js';
 *   logger.info('POS', 'Added item to cart', { name: 'Pizza', qty: 2 });
 *   logger.success('POS', 'Sale recorded', { orderId: 'A123' });
 *   logger.warn('POS', 'Discount exceeds subtotal', { discount: 500 });
 *   logger.error('POS', 'Failed to save', err);
 *   logger.action('button click', { id: 'posAddBtn' });
 */

const COLORS = {
    info:    '#3b82f6',
    success: '#10b981',
    warn:    '#f59e0b',
    error:   '#ef4444',
    action:  '#8b5cf6',
    nav:     '#06b6d4',
    data:    '#64748b',
    firebase:'#f97316'
};

const ICONS = {
    info:    'ℹ️',
    success: '✅',
    warn:    '⚠️',
    error:   '❌',
    action:  '👆',
    nav:     '🧭',
    data:    '📦',
    firebase:'🔥'
};

const MAX_LOG_ENTRIES = 500;
const STORAGE_KEY = 'adminActivityLog';

function timestamp() {
    const d = new Date();
    return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function format(args) {
    return args.map(a => {
        if (a === null) return 'null';
        if (a === undefined) return 'undefined';
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
        try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    });
}

function persistToSession(entry) {
    try {
        const existing = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
        existing.push(entry);
        if (existing.length > MAX_LOG_ENTRIES) existing.shift();
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
        window.dispatchEvent(new CustomEvent('admin:log', { detail: entry }));
    } catch (e) { /* sessionStorage unavailable */ }
}

function emit(level, category, message, payload) {
    const ts = timestamp();
    const color = COLORS[level] || COLORS.info;
    const icon = ICONS[level] || ICONS.info;
    const tag = `%c[${ts}] ${icon} ${category}`;
    const style = `color:${color}; font-weight:600;`;

    const parts = [message];
    if (payload !== undefined) parts.push(payload);

    switch (level) {
        case 'success': console.log(tag, style, ...format(parts)); break;
        case 'warn':    console.warn(tag, style, ...format(parts)); break;
        case 'error':   console.error(tag, style, ...format(parts)); break;
        default:        console.log(tag, style, ...format(parts));
    }

    persistToSession({ ts, level, category, message, payload: payload !== undefined ? safeClone(payload) : null });
}

function safeClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch { return String(obj); }
}

function getHistory() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
}

function clearHistory() {
    sessionStorage.removeItem(STORAGE_KEY);
}

export const logger = {
    info:     (cat, msg, payload) => emit('info', cat, msg, payload),
    success:  (cat, msg, payload) => emit('success', cat, msg, payload),
    warn:     (cat, msg, payload) => emit('warn', cat, msg, payload),
    error:    (cat, msg, payload) => emit('error', cat, msg, payload),
    action:   (cat, msg, payload) => emit('action', cat, msg, payload),
    nav:      (cat, msg, payload) => emit('nav', cat, msg, payload),
    data:     (cat, msg, payload) => emit('data', cat, msg, payload),
    firebase: (cat, msg, payload) => emit('firebase', cat, msg, payload),
    history:  getHistory,
    clear:    clearHistory
};

window.__adminLogger = logger;

let _installMonitor = null;
let _origConsole = null;
let _monitorInstalled = false;

export function installConsoleMonitor(enabled = true) {
    if (!enabled || _installMonitor) return;
    _installMonitor = true;
    _origConsole = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.debug.bind(console)
    };
    const inferCategory = (args) => {
        const first = String(args[0] || '');
        const m = first.match(/^\[([^\]]+)\]/);
        if (m) return m[1];
        if (/firebase|order|outlet|dish/i.test(first)) return 'AUTO';
        return 'LOG';
    };
    const fmt = (args) => args.map(a => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.message;
        try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ').slice(0, 200);
    _monitorInstalled = true;
    console.log = (...args) => { emit('info', inferCategory(args), fmt(args)); _origConsole.log(...args); };
    console.info = (...args) => { emit('info', inferCategory(args), fmt(args)); _origConsole.info(...args); };
    console.warn = (...args) => { emit('warn', inferCategory(args), fmt(args)); _origConsole.warn(...args); };
    console.error = (...args) => { emit('error', inferCategory(args), fmt(args), args[0] instanceof Error ? args[0] : null); _origConsole.error(...args); };
    console.debug = (...args) => { _origConsole.debug(...args); };
    logger.info('SYSTEM', 'Console monitor installed (all console.* calls will be captured)');
}

export function uninstallConsoleMonitor() {
    if (!_monitorInstalled || !_origConsole) return;
    console.log = _origConsole.log;
    console.info = _origConsole.info;
    console.warn = _origConsole.warn;
    console.error = _origConsole.error;
    console.debug = _origConsole.debug;
    _monitorInstalled = false;
    _installMonitor = null;
    _origConsole = null;
    logger.info('SYSTEM', 'Console monitor uninstalled');
}

if (typeof window !== 'undefined' && window.location?.search?.includes('logMonitor=1')) {
    installConsoleMonitor(true);
}
