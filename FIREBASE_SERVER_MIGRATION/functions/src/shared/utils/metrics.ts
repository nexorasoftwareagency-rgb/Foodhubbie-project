/**
 * Metrics Collection
 * Records custom Cloud Monitoring metrics for Firebase Functions
 */

import { logger } from 'firebase-functions/v2';

/**
 * Record a custom metric
 */
export async function recordMetric(
  type: string,
  value: number,
  labels: Record<string, string> = {}
): Promise<void> {
  try {
    logger.info(`[Metric:${type}]`, { value, labels, timestamp: Date.now() });
    // In production, this would send to Cloud Monitoring API
    // For now, just log the metric
  } catch (error) {
    logger.error(`[Metric:${type}] Failed to record`, { error: (error as Error).message });
  }
}

export default {
  recordMetric,
};
