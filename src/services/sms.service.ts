import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface ISmsProvider {
  sendOtp(phone: string, otp: string): Promise<boolean>;
}

export class MockSmsProvider implements ISmsProvider {
  async sendOtp(phone: string, otp: string): Promise<boolean> {
    logger.info({ msg: '[MOCK SMS PROVIDER] OTP generated', phone, otp });
    return true;
  }
}

export class TwilioSmsProvider implements ISmsProvider {
  async sendOtp(phone: string, otp: string): Promise<boolean> {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_PHONE) {
      logger.error({ msg: 'Twilio credentials missing in configuration' });
      throw new Error('SMS service configuration error');
    }

    try {
      // Clean phone number format
      const formattedPhone = phone.startsWith('+') ? phone : `+91${phone}`;
      const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
      const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');

      const body = new URLSearchParams({
        To: formattedPhone,
        From: env.TWILIO_FROM_PHONE,
        Body: `Your TrustTrade verification code is: ${otp}. Valid for 5 minutes. Do not share this code with anyone.`,
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });

      if (!res.ok) {
        const errorText = await res.text();
        logger.error({ msg: 'Twilio SMS send failed', status: res.status, error: errorText });
        return false;
      }

      logger.info({ msg: 'Twilio SMS sent successfully', phone: formattedPhone });
      return true;
    } catch (err: any) {
      logger.error({ msg: 'Twilio SMS request exception', error: err.message });
      return false;
    }
  }
}

export class Msg91SmsProvider implements ISmsProvider {
  async sendOtp(phone: string, otp: string): Promise<boolean> {
    if (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID) {
      logger.error({ msg: 'MSG91 credentials missing in configuration' });
      throw new Error('SMS service configuration error');
    }

    try {
      const formattedPhone = phone.replace(/^\+/, '');
      const url = `https://control.msg91.com/api/v5/otp?template_id=${env.MSG91_TEMPLATE_ID}&mobile=${formattedPhone}&otp=${otp}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authkey: env.MSG91_AUTH_KEY,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        const errorText = await res.text();
        logger.error({ msg: 'MSG91 SMS send failed', status: res.status, error: errorText });
        return false;
      }

      logger.info({ msg: 'MSG91 SMS sent successfully', phone: formattedPhone });
      return true;
    } catch (err: any) {
      logger.error({ msg: 'MSG91 SMS request exception', error: err.message });
      return false;
    }
  }
}

export function getSmsService(): ISmsProvider {
  switch (env.SMS_PROVIDER) {
    case 'twilio':
      return new TwilioSmsProvider();
    case 'msg91':
      return new Msg91SmsProvider();
    case 'mock':
    default:
      return new MockSmsProvider();
  }
}
