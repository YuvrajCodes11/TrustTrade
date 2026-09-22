import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface KycVerificationResult {
  success: boolean;
  vendorRef?: string;
  status: 'VERIFIED' | 'REJECTED' | 'PENDING';
  reason?: string;
}

export interface IKycProvider {
  verifyIdentity(userId: string, idData?: Record<string, any>): Promise<KycVerificationResult>;
}

export class MockKycProvider implements IKycProvider {
  async verifyIdentity(userId: string): Promise<KycVerificationResult> {
    logger.info({ msg: '[MOCK KYC PROVIDER] Executing simulated KYC verification', userId });
    return {
      success: true,
      vendorRef: `mock_kyc_ref_${Math.random().toString(36).substring(2, 10)}`,
      status: 'VERIFIED',
    };
  }
}

export class IdfyKycProvider implements IKycProvider {
  async verifyIdentity(userId: string, idData?: Record<string, any>): Promise<KycVerificationResult> {
    if (!env.KYC_API_KEY || !env.KYC_CLIENT_ID) {
      logger.error({ msg: 'IDfy KYC credentials missing in configuration' });
      return { success: false, status: 'REJECTED', reason: 'KYC service credentials missing' };
    }

    try {
      // Production API request to IDfy
      const res = await fetch('https://api.idfy.com/v3/tasks/async/verify_with_source', {
        method: 'POST',
        headers: {
          'api-key': env.KYC_API_KEY,
          'account-id': env.KYC_CLIENT_ID,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task_id: `tt_${userId}_${Date.now()}`,
          group_id: 'trusttrade_kyc',
          data: idData || {},
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        logger.error({ msg: 'IDfy KYC API failure', status: res.status, error: errText });
        return { success: false, status: 'REJECTED', reason: 'Identity verification provider request failed' };
      }

      const data = (await res.json()) as any;
      if (data.status === 'completed' && data.result?.verified) {
        return {
          success: true,
          status: 'VERIFIED',
          vendorRef: data.task_id || `idfy_${Date.now()}`,
        };
      }

      return {
        success: false,
        status: 'REJECTED',
        reason: data.result?.message || 'Verification rejected by provider',
      };
    } catch (err: any) {
      logger.error({ msg: 'IDfy KYC request exception', error: err.message });
      return { success: false, status: 'REJECTED', reason: 'Verification provider network error' };
    }
  }
}

export function getKycService(): IKycProvider {
  switch (env.KYC_VENDOR) {
    case 'idfy':
    case 'hyperverge':
    case 'signzy':
      return new IdfyKycProvider();
    case 'mock':
    default:
      return new MockKycProvider();
  }
}
