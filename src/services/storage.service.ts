import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../config/logger.js';
import crypto from 'crypto';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export class StorageService {
  private s3Client: S3Client;

  constructor() {
    this.s3Client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      credentials:
        env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.AWS_ACCESS_KEY_ID,
              secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  async generatePresignedUploadUrl(
    userId: string,
    fileType: string,
    fileSizeBytes: number
  ): Promise<{ uploadUrl: string; fileKey: string; publicUrl: string }> {
    if (!ALLOWED_MIME_TYPES.includes(fileType.toLowerCase())) {
      throw new AppError(`Invalid file type: ${fileType}. Allowed types: JPEG, PNG, WEBP`, 400, 'INVALID_FILE_TYPE');
    }

    if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
      throw new AppError('File size exceeds maximum allowed limit of 5MB', 400, 'FILE_TOO_LARGE');
    }

    const ext = fileType.split('/')[1] || 'jpg';
    const randomHex = crypto.randomBytes(8).toString('hex');
    const fileKey = `listings/${userId}/${Date.now()}_${randomHex}.${ext}`;

    try {
      const command = new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: fileKey,
        ContentType: fileType,
        ContentLength: fileSizeBytes,
      });

      // Generate pre-signed URL valid for 15 minutes (900 seconds)
      const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 900 });

      const publicUrl = env.S3_ENDPOINT
        ? `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${fileKey}`
        : `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${fileKey}`;

      logger.info({ msg: 'Generated S3 presigned upload URL', userId, fileKey });

      return { uploadUrl, fileKey, publicUrl };
    } catch (err: any) {
      logger.error({ msg: 'Failed to generate S3 presigned upload URL', error: err.message });
      throw new AppError('Object storage presigned URL generation failed', 500, 'STORAGE_ERROR');
    }
  }
}

export const storageService = new StorageService();
