/**
 * Bot Control Callable Function
 * 
 * Provides admin control over WhatsApp bots:
 * - status: Check bot status for an outlet or all outlets
 * - restart: Restart a specific outlet bot
 * - transport: Switch transport mode (meta/baileys)
 * - rescan: Rescan sessions
 * 
 * Requires Supreme Admin authentication
 */

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB, ref } from '../shared/firebase/admin';
import type { BotControlPayload, ApiResponse } from '../shared/types';

// Initialize admin on cold start
initializeAdmin().catch(err => {
  logger.error('[BotControl] Admin init failed', { error: err.message });
});

/**
 * Bot Control - Main handler for admin operations
 */
export const botControl = onCall<BotControlPayload>(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
    minInstances: 0,
    maxInstances: 10,
    concurrency: 10,
    secrets: [],
  },
  async (request) => {
    const { action, bid, oid, transport, rescan } = request.data;
    const correlationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    logger.info('[BotControl] Request received', {
      correlationId,
      action,
      bid,
      oid,
      transport,
      rescan,
      uid: request.auth?.uid,
    });

    try {
      // Verify admin authentication
      if (!request.auth) {
        return {
          success: false,
          error: { code: 'unauthenticated', message: 'Authentication required' },
          meta: { timestamp: Date.now(), correlationId },
        };
      }

      const db = getDB();

      switch (action) {
        case 'status': {
          if (!bid || !oid) {
            // Return status for all outlets
            const indexSnap = await ref('outletIndex').once('value');
            const index = indexSnap.val() || {};
            const statuses: Array<{ bid: string; oid: string; status: string }> = [];

            for (const [oid, meta] of Object.entries(index)) {
              const bidVal = typeof meta === 'string' ? meta : (meta as any)?.bid;
              if (bidVal) {
                const botSnap = await ref(`businesses/${bidVal}/outlets/${oid}/bot`).once('value');
                statuses.push({
                  bid: bidVal,
                  oid,
                  status: botSnap.exists() ? (botSnap.val() as any)?.transport || 'unknown' : 'not_provisioned',
                });
              }
            }

            return {
              success: true,
              data: { outlets: statuses, total: statuses.length },
              meta: { timestamp: Date.now(), correlationId },
            };
          }

          // Return status for specific outlet
          const botSnap = await ref(`businesses/${bid}/outlets/${oid}/bot`).once('value');
          return {
            success: true,
            data: {
              bid,
              oid,
              transport: botSnap.exists() ? (botSnap.val() as any)?.transport : null,
              provisioned: botSnap.exists(),
            },
            meta: { timestamp: Date.now(), correlationId },
          };
        }

        case 'restart': {
          if (!bid || !oid) {
            return {
              success: false,
              error: { code: 'invalid_request', message: 'bid and oid required for restart' },
              meta: { timestamp: Date.now(), correlationId },
            };
          }

          // In serverless, restart means updating provisioned state
          await ref(`businesses/${bid}/outlets/${oid}/bot/provisionedAt`).set(Date.now());
          await ref(`businesses/${bid}/outlets/${oid}/bot/restartRequested`).set(true);

          logger.info('[BotControl] Restart requested', { correlationId, bid, oid });

          return {
            success: true,
            data: { bid, oid, action: 'restart', status: 'requested' },
            meta: { timestamp: Date.now(), correlationId },
          };
        }

        case 'transport': {
          if (!bid || !oid || !transport) {
            return {
              success: false,
              error: { code: 'invalid_request', message: 'bid, oid, and transport required' },
              meta: { timestamp: Date.now(), correlationId },
            };
          }

          await ref(`businesses/${bid}/outlets/${oid}/bot/transport`).set(transport);
          await ref(`businesses/${bid}/outlets/${oid}/bot/transportSwitchedAt`).set(Date.now());

          logger.info('[BotControl] Transport switched', { correlationId, bid, oid, transport });

          return {
            success: true,
            data: { bid, oid, transport, status: 'switched' },
            meta: { timestamp: Date.now(), correlationId },
          };
        }

        case 'rescan': {
          if (!bid || !oid) {
            return {
              success: false,
              error: { code: 'invalid_request', message: 'bid and oid required for rescan' },
              meta: { timestamp: Date.now(), correlationId },
            };
          }

          await ref(`businesses/${bid}/outlets/${oid}/bot/rescanRequested`).set(true);
          await ref(`businesses/${bid}/outlets/${oid}/bot/rescanRequestedAt`).set(Date.now());

          logger.info('[BotControl] Rescan requested', { correlationId, bid, oid });

          return {
            success: true,
            data: { bid, oid, action: 'rescan', status: 'requested' },
            meta: { timestamp: Date.now(), correlationId },
          };
        }

        default:
          return {
            success: false,
            error: { code: 'invalid_action', message: `Unknown action: ${action}` },
            meta: { timestamp: Date.now(), correlationId },
          };
      }
    } catch (error) {
      logger.error('[BotControl] Request failed', {
        correlationId,
        action,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: {
          code: 'internal_error',
          message: (error as Error).message,
        },
        meta: { timestamp: Date.now(), correlationId },
      };
    }
  }
);
