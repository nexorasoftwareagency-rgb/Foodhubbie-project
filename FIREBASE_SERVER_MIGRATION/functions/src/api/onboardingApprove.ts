/**
 * Onboarding Approve Callable Function
 * 
 * Approves restaurant onboarding requests:
 * - Validates the request exists and is pending
 * - Creates outlet entry in RTDB
 * - Updates request status to approved
 * 
 * Requires Supreme Admin authentication
 */

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB, ref, runTransaction } from '../shared/firebase/admin';
import type { OnboardingApprovePayload, ApiResponse } from '../shared/types';

// Initialize admin on cold start
initializeAdmin().catch(err => {
  logger.error('[OnboardingApprove] Admin init failed', { error: err.message });
});

/**
 * Approve Onboarding Request
 */
export const onboardingApprove = onCall<OnboardingApprovePayload>(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 120,
    minInstances: 0,
    maxInstances: 10,
    concurrency: 10,
    secrets: [],
  },
  async (request) => {
    const { requestKey, reviewerUid } = request.data;
    const correlationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    logger.info('[OnboardingApprove] Request received', {
      correlationId,
      requestKey,
      reviewerUid,
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

      // Load the onboarding request
      const requestSnap = await ref(`onboardingRequests/${requestKey}`).once('value');
      const requestData = requestSnap.val();

      if (!requestData) {
        return {
          success: false,
          error: { code: 'not_found', message: 'Onboarding request not found' },
          meta: { timestamp: Date.now(), correlationId },
        };
      }

      if (requestData.status !== 'pending') {
        return {
          success: false,
          error: { code: 'invalid_status', message: `Request is ${requestData.status}, not pending` },
          meta: { timestamp: Date.now(), correlationId },
        };
      }

      const { bid, oid, email, adminUid } = requestData;

      // Check if outlet already exists
      const outletSnap = await ref(`businesses/${bid}/outlets/${oid}`).once('value');
      if (outletSnap.exists()) {
        return {
          success: false,
          error: { code: 'already_exists', message: 'Outlet already exists' },
          meta: { timestamp: Date.now(), correlationId },
        };
      }

      // Create outlet entry
      const now = Date.now();
      const outletData = {
        name: requestData.storeName || 'New Outlet',
        outletNo: requestData.outletNo || oid,
        createdAt: now,
        updatedAt: now,
        createdBy: reviewerUid,
        settings: {
          Store: {
            storeName: requestData.storeName || 'New Outlet',
            ...(requestData.settings?.Store || {}),
          },
        },
        whatsapp: requestData.whatsapp || {},
      };

      await ref(`businesses/${bid}/outlets/${oid}`).set(outletData);

      // Create admin mirror entry
      if (adminUid) {
        await ref(`admins/${adminUid}`).set({
          name: requestData.ownerName || 'Outlet Owner',
          email: email,
          role: 'Admin',
          outlet: oid,
          businessId: bid,
          createdAt: now,
          updatedAt: now,
          createdBy: reviewerUid,
        });
      }

      // Update request status
      await ref(`onboardingRequests/${requestKey}`).update({
        status: 'approved',
        approvedAt: now,
        approvedBy: reviewerUid,
        updatedAt: now,
      });

      logger.info('[OnboardingApprove] Request approved', {
        correlationId,
        requestKey,
        bid,
        oid,
        reviewerUid,
      });

      return {
        success: true,
        data: {
          requestKey,
          bid,
          oid,
          status: 'approved',
          outlet: outletData,
        },
        meta: { timestamp: Date.now(), correlationId },
      };
    } catch (error) {
      logger.error('[OnboardingApprove] Request failed', {
        correlationId,
        requestKey,
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
