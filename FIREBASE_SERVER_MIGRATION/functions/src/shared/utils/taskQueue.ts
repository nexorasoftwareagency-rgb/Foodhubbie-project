/**
 * Cloud Tasks / Task Queue Utilities
 * Enqueues tasks for async processing
 */

import { CloudTasksClient } from '@google-cloud/tasks';
import { getSecret } from '../config/secrets';

const client = new CloudTasksClient();
const PROJECT_ID = process.env.GCP_PROJECT || 'foodhubbie-prod';
const LOCATION = 'us-central1';

interface QueueConfig {
  queue: string;
  serviceAccountEmail?: string;
}

const QUEUE_CONFIGS: Record<string, QueueConfig> = {
  processInboundMessage: { queue: 'process-inbound-message' },
  sendOutboundMessage: { queue: 'send-outbound-message' },
  runPromoCampaign: { queue: 'run-promo-campaign' },
  verifyPayment: { queue: 'verify-payment' },
  processRedeem: { queue: 'process-redeem' },
  processOrderEvent: { queue: 'process-order-event' },
  notifyRider: { queue: 'notify-rider' },
};

/**
 * Enqueue a task for async processing
 */
export async function enqueueTask<T extends Record<string, any>>(
  queueName: keyof typeof QUEUE_CONFIGS,
  payload: T,
  options: {
    delaySeconds?: number;
    dispatchDeadlineSeconds?: number;
  } = {}
): Promise<string> {
  const config = QUEUE_CONFIGS[queueName];
  if (!config) {
    throw new Error(`Unknown queue: ${queueName}`);
  }

  const parent = client.queuePath(PROJECT_ID, LOCATION, config.queue);
  
  const task = {
    httpRequest: {
      httpMethod: 'POST' as const,
      url: `https://${LOCATION}-${PROJECT_ID}.cloudfunctions.net/${queueName}`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
    },
    scheduleTime: options.delaySeconds 
      ? { seconds: Math.floor(Date.now() / 1000) + options.delaySeconds }
      : undefined,
    dispatchDeadline: options.dispatchDeadlineSeconds
      ? { seconds: options.dispatchDeadlineSeconds }
      : undefined,
  };

  if (config.serviceAccountEmail) {
    (task.httpRequest as any).oidcToken = { serviceAccountEmail: config.serviceAccountEmail };
  }

  const [response] = await client.createTask({ parent, task });
  return response.name;
}

/**
 * Enqueue multiple tasks in batch
 */
export async function enqueueTasks<T extends Record<string, any>>(
  queueName: keyof typeof QUEUE_CONFIGS,
  payloads: T[],
  options: {
    delaySeconds?: number;
    dispatchDeadlineSeconds?: number;
  } = {}
): Promise<string[]> {
  return Promise.all(payloads.map(p => enqueueTask(queueName, p, options)));
}

/**
 * Get queue stats (depth, processing rate)
 */
export async function getQueueStats(queueName: keyof typeof QUEUE_CONFIGS): Promise<{
  depth: number;
  oldestTaskAgeSeconds: number;
  processingRate: number;
}> {
  const config = QUEUE_CONFIGS[queueName];
  if (!config) throw new Error(`Unknown queue: ${queueName}`);

  const queuePath = client.queuePath(PROJECT_ID, LOCATION, config.queue);
  
  // Get queue details
  const [queue] = await client.getQueue({ name: queuePath });
  
  // Get task count (approximate)
  let depth = 0;
  let oldestTaskAge = 0;
  
  try {
    const tasks = (client as any).listTasks({ parent: queuePath });
    for await (const task of tasks) {
      depth++;
      const scheduleTime = task.scheduleTime;
      if (scheduleTime) {
        const age = Date.now() / 1000 - (scheduleTime.seconds || 0);
        if (age > oldestTaskAge) oldestTaskAge = age;
      }
    }
  } catch {
    // Ignore errors
  }

  return {
    depth,
    oldestTaskAgeSeconds: oldestTaskAge,
    processingRate: 0, // Would need Cloud Monitoring for actual rate
  };
}

/**
 * Purge queue (use with caution)
 */
export async function purgeQueue(queueName: keyof typeof QUEUE_CONFIGS): Promise<void> {
  const config = QUEUE_CONFIGS[queueName];
  if (!config) throw new Error(`Unknown queue: ${queueName}`);

  const queuePath = client.queuePath(PROJECT_ID, LOCATION, config.queue);
  await client.purgeQueue({ name: queuePath });
}

/**
 * Create queue if not exists (run during deployment)
 */
export async function ensureQueueExists(queueName: keyof typeof QUEUE_CONFIGS): Promise<void> {
  const config = QUEUE_CONFIGS[queueName];
  if (!config) throw new Error(`Unknown queue: ${queueName}`);

  const parent = client.locationPath(PROJECT_ID, LOCATION);
  const queuePath = client.queuePath(PROJECT_ID, LOCATION, config.queue);

  try {
    await client.getQueue({ name: queuePath });
  } catch (error: any) {
    if (error.code === 5) { // NOT_FOUND
      await client.createQueue({
        parent,
        queue: {
          name: queuePath,
          rateLimits: {
            maxDispatchesPerSecond: 500,
            maxConcurrentDispatches: 1000,
          },
          retryConfig: {
            maxAttempts: 3,
            minBackoff: { seconds: 10 },
            maxBackoff: { seconds: 600 },
            maxDoublings: 5,
          },
        },
      });
      console.log(`[TaskQueue] Created queue: ${config.queue}`);
    } else {
      throw error;
    }
  }
}

/**
 * Initialize all queues
 */
export async function initializeQueues(): Promise<void> {
  await Promise.all(
    Object.keys(QUEUE_CONFIGS).map(q => ensureQueueExists(q as keyof typeof QUEUE_CONFIGS))
  );
}

export default {
  enqueueTask,
  enqueueTasks,
  getQueueStats,
  purgeQueue,
  ensureQueueExists,
  initializeQueues,
  QUEUE_CONFIGS,
};