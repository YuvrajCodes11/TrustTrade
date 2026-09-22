import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';

export const DEFAULT_SCAM_RULES = [
  {
    pattern: 'scan.{0,15}qr|qr.{0,10}code.{0,20}(receive|accept|get)',
    reason:
      'Scanning a QR code never "receives" money — it authorises a payment OUT of an account. This matches a known UPI scam pattern.',
  },
  {
    pattern: '(army|defence|defense|military|cisf|bsf|posted at border)',
    reason:
      'Claims of being defence/army personnel unable to meet in person are a very common scam script. Insist on meeting in person before any payment.',
  },
  {
    pattern: '(advance|token amount|booking amount).{0,25}(before|first|pay)',
    reason:
      "Requests for an advance/token payment before you've seen or verified the item are a common fraud pattern.",
  },
  {
    pattern: '(courier|shipping).{0,20}(insurance|fee|charge)',
    reason:
      'Courier/shipping "insurance fee" requests are a known scam used to extract extra payments after an initial deposit.',
  },
  {
    pattern: '(sent extra|overpaid|refund the difference|excess amount)',
    reason:
      'Overpayment-then-refund requests are a classic reversal scam — the original payment is usually fake or later reversed.',
  },
];

export interface ScamScanResult {
  flagged: boolean;
  reason?: string;
}

export async function evaluateScamRules(content: string): Promise<ScamScanResult> {
  try {
    // 1. Load active rules from DB config table
    let rules = await prisma.scamRule.findMany({
      where: { active: true },
    });

    // Seed default rules if table is empty
    if (rules.length === 0) {
      await prisma.scamRule.createMany({
        data: DEFAULT_SCAM_RULES.map((r) => ({ ...r, active: true })),
      });
      rules = await prisma.scamRule.findMany({ where: { active: true } });
    }

    // 2. Evaluate content against each regex pattern
    for (const rule of rules) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(content)) {
          logger.warn({ msg: 'Scam rule matched on message', pattern: rule.pattern, reason: rule.reason });
          return {
            flagged: true,
            reason: rule.reason,
          };
        }
      } catch (err: any) {
        logger.error({ msg: 'Invalid regex in scam rule', pattern: rule.pattern, error: err.message });
      }
    }

    return { flagged: false };
  } catch (err: any) {
    logger.error({ msg: 'Error evaluating scam rules', error: err.message });
    // Fallback inline evaluation
    for (const r of DEFAULT_SCAM_RULES) {
      const regex = new RegExp(r.pattern, 'i');
      if (regex.test(content)) {
        return { flagged: true, reason: r.reason };
      }
    }
    return { flagged: false };
  }
}
