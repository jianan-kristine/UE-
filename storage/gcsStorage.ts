// filepath: /Users/jianan/Documents/market-research-agent/storage/gcsStorage.ts

import { Storage } from "npm:@google-cloud/storage@^7.0.0";

export class GCSStorageService {
  private storage: Storage;
  private bucket: string;

  constructor() {
    // 尝试多种方式读取环境变量
    const keyFilePath = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS") || 
                        Deno.env.get("GCP_KEY_FILE") ||
                        process?.env?.GOOGLE_APPLICATION_CREDENTIALS;
    
    const bucketName = Deno.env.get("GCS_BUCKET_NAME") || 
                       Deno.env.get("GCP_BUCKET") ||
                       process?.env?.GCS_BUCKET_NAME ||
                       "complens-reports";

    console.log('🔍 GCS Configuration:');
    console.log('   - GOOGLE_APPLICATION_CREDENTIALS:', keyFilePath || '(not set)');
    console.log('   - GCS_BUCKET_NAME:', bucketName);

    if (!keyFilePath) {
      throw new Error("GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. Please set it to your service account JSON key file path.");
    }

    if (!bucketName) {
      throw new Error("GCS_BUCKET_NAME environment variable is not set. Please set it to your GCS bucket name.");
    }

    try {
      this.storage = new Storage({
        keyFilename: keyFilePath,
      });
      
      this.bucket = bucketName;
      console.log(`✅ GCS Storage initialized: ${this.bucket}`);
    } catch (error) {
      console.error('❌ Failed to initialize GCS Storage:', error);
      throw new Error(`Failed to initialize GCS: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async uploadFile(key: string, data: Uint8Array, contentType: string): Promise<string> {
    try {
      const bucket = this.storage.bucket(this.bucket);
      const file = bucket.file(key);
      
      await file.save(data, {
        contentType,
        metadata: {
          contentType,
        },
      });
      
      console.log(`✅ File uploaded to GCS: ${key}`);
      return key;
    } catch (error) {
      console.error(`❌ Failed to upload file ${key}:`, error);
      throw error;
    }
  }

  async getFileUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const bucket = this.storage.bucket(this.bucket);
      const file = bucket.file(key);
      
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + expiresIn * 1000,
      });
      
      return url;
    } catch (error) {
      console.error(`❌ Failed to get file URL ${key}:`, error);
      throw error;
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      const bucket = this.storage.bucket(this.bucket);
      const file = bucket.file(key);
      
      await file.delete();
      console.log(`✅ File deleted from GCS: ${key}`);
    } catch (error) {
      console.error(`❌ Failed to delete file ${key}:`, error);
      throw error;
    }
  }
}
