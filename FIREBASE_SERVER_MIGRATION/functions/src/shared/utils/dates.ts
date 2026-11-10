/**
 * Date/Time Utilities
 * IST (Indian Standard Time) helpers for scheduling and reporting
 */

// IST offset: UTC + 5:30 = 19,800,000 ms
export const IST_OFFSET = 5.5 * 60 * 60 * 1000;

/**
 * Get current date/time info in IST
 */
export function getISTDateInfo(date = new Date()): ISTDateInfo {
  const ist = new Date(date.getTime() + IST_OFFSET);
  return {
    dateStr: ist.toISOString().split('T')[0],           // YYYY-MM-DD
    hour: ist.getUTCHours(),                              // 0-23
    minute: ist.getUTCMinutes(),                          // 0-59
    second: ist.getUTCSeconds(),                          // 0-59
    dayOfWeek: ist.getUTCDay(),                           // 0=Sunday
    dayOfMonth: ist.getUTCDate(),                         // 1-31
    month: ist.getUTCMonth() + 1,                         // 1-12
    year: ist.getUTCFullYear(),                           // 2026
    monthKey: ist.toISOString().slice(0, 7),              // YYYY-MM
    weekKey: getISOWeekKey(ist),                          // YYYY-Www
    isoString: ist.toISOString(),                         // Full ISO
    timestamp: ist.getTime(),                             // ms since epoch
    istObject: ist,                                       // Date object
  };
}

export interface ISTDateInfo {
  dateStr: string;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
  dayOfMonth: number;
  month: number;
  year: number;
  monthKey: string;
  weekKey: string;
  isoString: string;
  timestamp: number;
  istObject: Date;
}

/**
 * Get IST date string (YYYY-MM-DD) from timestamp
 */
export function getISTDateString(timestamp: number | string | Date): string {
  const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
  const ist = new Date(date.getTime() + IST_OFFSET);
  return ist.toISOString().split('T')[0];
}

/**
 * Get IST month key (YYYY-MM) from timestamp
 */
export function getISTMonthKey(timestamp: number | string | Date): string {
  const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
  const ist = new Date(date.getTime() + IST_OFFSET);
  return ist.toISOString().slice(0, 7);
}

/**
 * Get ISO week key (YYYY-Www) from Date
 */
export function getISOWeekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Parse time string (HH:MM or HH:MM AM/PM) to minutes since midnight
 */
export function parseTime(timeStr: string): number {
  if (!timeStr) return 0;
  const clean = String(timeStr).trim().toUpperCase();
  const isPM = clean.includes('PM');
  const isAM = clean.includes('AM');
  const timePart = clean.replace(/AM|PM/i, '').trim();
  const [hoursStr, minutesStr] = timePart.split(':');
  let hours = parseInt(hoursStr, 10) || 0;
  const minutes = parseInt(minutesStr, 10) || 0;
  
  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;
  
  return hours * 60 + minutes;
}

/**
 * Format minutes to HH:MM (24hr)
 */
export function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Check if current time is within shop hours (IST)
 */
export function isShopOpen(
  openTime: string, 
  closeTime: string, 
  statusOverride?: 'FORCE_OPEN' | 'FORCE_CLOSED',
  date = new Date()
): boolean {
  if (statusOverride === 'FORCE_OPEN') return true;
  if (statusOverride === 'FORCE_CLOSED') return false;
  if (!openTime || !closeTime) return true;
  
  const now = getISTDateInfo(date);
  const currentMinutes = now.hour * 60 + now.minute;
  const openMinutes = parseTime(openTime);
  const closeMinutes = parseTime(closeTime);
  
  if (closeMinutes < openMinutes) {
    // Overnight: e.g., 22:00 - 06:00
    return currentMinutes >= openMinutes || currentMinutes <= closeMinutes;
  }
  
  return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
}

/**
 * Get start of day in IST (00:00:00)
 */
export function getISTStartOfDay(date = new Date()): Date {
  const ist = new Date(date.getTime() + IST_OFFSET);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET);
}

/**
 * Get end of day in IST (23:59:59.999)
 */
export function getISTEndOfDay(date = new Date()): Date {
  const ist = new Date(date.getTime() + IST_OFFSET);
  ist.setUTCHours(23, 59, 59, 999);
  return new Date(ist.getTime() - IST_OFFSET);
}

/**
 * Get start of month in IST
 */
export function getISTStartOfMonth(date = new Date()): Date {
  const ist = new Date(date.getTime() + IST_OFFSET);
  ist.setUTCDate(1);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET);
}

/**
 * Get end of month in IST
 */
export function getISTEndOfMonth(date = new Date()): Date {
  const ist = new Date(date.getTime() + IST_OFFSET);
  ist.setUTCMonth(ist.getUTCMonth() + 1, 0);
  ist.setUTCHours(23, 59, 59, 999);
  return new Date(ist.getTime() - IST_OFFSET);
}

/**
 * Get start of week (Monday) in IST
 */
export function getISTStartOfWeek(date = new Date()): Date {
  const ist = new Date(date.getTime() + IST_OFFSET);
  const day = ist.getUTCDay(); // 0=Sunday
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  ist.setUTCDate(ist.getUTCDate() + diff);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET);
}

/**
 * Add days in IST
 */
export function addISTDays(date: Date, days: number): Date {
  const ist = new Date(date.getTime() + IST_OFFSET);
  ist.setUTCDate(ist.getUTCDate() + days);
  return new Date(ist.getTime() - IST_OFFSET);
}

/**
 * Difference in days between two dates (IST)
 */
export function diffISTDays(date1: Date, date2: Date): number {
  const d1 = getISTDateInfo(date1);
  const d2 = getISTDateInfo(date2);
  const start1 = new Date(d1.year, d1.month - 1, d1.dayOfMonth).getTime();
  const start2 = new Date(d2.year, d2.month - 1, d2.dayOfMonth).getTime();
  return Math.round((start2 - start1) / 86400000);
}

/**
 * Format date for display (DD MMM YYYY)
 */
export function formatDisplayDate(date: Date | number | string, locale = 'en-IN'): string {
  const d = typeof date === 'number' ? new Date(date) : new Date(date);
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Format date for display with time (DD MMM YYYY, HH:MM)
 */
export function formatDisplayDateTime(date: Date | number | string, locale = 'en-IN'): string {
  const d = typeof date === 'number' ? new Date(date) : new Date(date);
  return d.toLocaleDateString(locale, { 
    day: 'numeric', 
    month: 'short', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
}

/**
 * Get relative time string (e.g., "2 hours ago")
 */
export function getRelativeTime(timestamp: number, locale = 'en-IN'): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;
  
  return formatDisplayDate(timestamp, locale);
}

/**
 * Check if date is today (IST)
 */
export function isToday(date: Date | number | string): boolean {
  const d = typeof date === 'number' ? new Date(date) : new Date(date);
  return getISTDateString(d) === getISTDateString(new Date());
}

/**
 * Check if date is yesterday (IST)
 */
export function isYesterday(date: Date | number | string): boolean {
  const d = typeof date === 'number' ? new Date(date) : new Date(date);
  const yesterday = addISTDays(new Date(), -1);
  return getISTDateString(d) === getISTDateString(yesterday);
}

/**
 * Get cron expression for daily at specific IST time
 */
export function getDailyCron(hour: number, minute: number): string {
  // Convert IST to UTC for Cloud Scheduler
  const utcHour = (hour - 5 - (minute >= 30 ? 1 : 0) + 24) % 24;
  const utcMinute = (minute - 30 + 60) % 60;
  return `${utcMinute} ${utcHour} * * *`;
}

/**
 * Get cron expression for weekly at specific IST time
 */
export function getWeeklyCron(dayOfWeek: number, hour: number, minute: number): string {
  // dayOfWeek: 0=Sunday, 1=Monday... (Cloud Scheduler uses 0-6)
  const utcHour = (hour - 5 - (minute >= 30 ? 1 : 0) + 24) % 24;
  const utcMinute = (minute - 30 + 60) % 60;
  return `${utcMinute} ${utcHour} * * ${dayOfWeek}`;
}

/**
 * Get cron expression for monthly at specific IST time
 */
export function getMonthlyCron(dayOfMonth: number, hour: number, minute: number): string {
  const utcHour = (hour - 5 - (minute >= 30 ? 1 : 0) + 24) % 24;
  const utcMinute = (minute - 30 + 60) % 60;
  return `${utcMinute} ${utcHour} ${dayOfMonth} * *`;
}

export default {
  IST_OFFSET,
  getISTDateInfo,
  getISTDateString,
  getISTMonthKey,
  getISOWeekKey,
  parseTime,
  formatTime,
  isShopOpen,
  getISTStartOfDay,
  getISTEndOfDay,
  getISTStartOfMonth,
  getISTEndOfMonth,
  getISTStartOfWeek,
  addISTDays,
  diffISTDays,
  formatDisplayDate,
  formatDisplayDateTime,
  getRelativeTime,
  isToday,
  isYesterday,
  getDailyCron,
  getWeeklyCron,
  getMonthlyCron,
};