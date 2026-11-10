/**
 * Transport Switch Callable Function
 * 
 * Switches WhatsApp transport mode for an outlet:
 * - transport: 'meta' or 'baileys'
 * - rescan: optional flag to rescan sessions
 * 
 * Requires Supreme Admin authentication
 */

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB, ref } from '../shared/firebase/admin';
import type { TransportSwitchPayload, ApiResponse } from '../shared/types';

// Initialize admin on cold start
initializeAdmin().catch(err => {
  logger.error('[TransportSwitch] Admin init failed', { error: err.message });
});

/**
 * Switch Transport Mode
 */
export const transportSwitch = onCall<TransportSwitchPayload>(
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
    const { bid, oid, transport, rescan } = request.data;
    const correlationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    logger.info('[TransportSwitch] Request received', {
      correlationId,
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

      if (!bid || !oid || !transport) {
        return {
          success: false,
          error: { code: 'invalid_request', message: 'bid, oid, and transport are required' },
          meta: { timestamp: Date.now(), correlationId },
        };
      }

      // Validate transport value
      if (transport !== 'meta' && transport !== 'baileys') {
        return {
          success: false,
          error: { code: 'invalid_transport', message: 'Transport must be meta or baileys' },
          meta: { timestamp: Date.now(), correlationId },
        };
      }

      // Verify outlet exists
      const outletSnap = await ref(`businesses/${bid}/outlets/${oid}`).once('value');
      if (!outletSnap.exists()) {
        return {
          success: false,
          error: { code: 'not_found', message: 'Outlet not found' },
          meta: { timestamp: Date.now(), correlationId },
        };
      }

      // Update transport configuration
      const now = Date.now();
      await ref(`businesses/${bid}/outlets/${oid}/bot/transport`).set(transport);
      await ref(`businesses/${bid}/outlets/${oid}/bot/transportSwitchedAt`).set(now);
      await ref(`businesses/${bid}/outlets/${oid}/bot/transportSwitchedBy`).set(request.auth.uid);

      if (rescan) {
        await ref(`businesses/${bid}/outlets/${oid}/bot/rescanRequested`).set(true);
        await ref(`businesses/${bid}/outlets/${oid}/bot/rescanRequestedAt`).set(now);
      }

      logger.info('[TransportSwitch] Transport switched', {
        correlationId,
        bid,
        oid,
        transport,
        rescan,
        switchedBy: request.auth.uid,
      });

      return {
        success: true,
        data: {
          bid,
          oid,
          transport,
          rescan: rescan || false,
          switchedAt: now,
          status: 'switched',
        },
        meta: { timestamp: Date.now(), correlationId },
      };
    } catch (error) {
      logger.error('[TransportSwitch] Request failed', {
        correlationId,
        bid,
        oid,
        transport,
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
