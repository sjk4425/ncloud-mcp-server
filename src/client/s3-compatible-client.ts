import crypto from "node:crypto";
import { fetchWithTimeout } from "./_timeout.js";

export type S3StorageType = "object" | "ncloud";

export interface S3CompatibleClientConfig {
  accessKey: string;
  secretKey: string;
  regionCode: string;
  storageType?: S3StorageType;
}

interface S3RequestOptions {
  method: string;
  bucket?: string;
  key?: string;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}

/** Object Storage endpoint map (storageType: "object") */
const REGION_ENDPOINT_MAP: Record<string, string> = {
  KR: "https://kr.object.ncloudstorage.com",
  USWN: "https://us.object.ncloudstorage.com",
  SGN: "https://sg.object.ncloudstorage.com",
  JPN: "https://jp.object.ncpstorage.com",
  DEN: "https://de.object.ncloudstorage.com",
};

/** Object Storage host map (storageType: "object") */
const REGION_HOST_MAP: Record<string, string> = {
  KR: "kr.object.ncloudstorage.com",
  USWN: "us.object.ncloudstorage.com",
  SGN: "sg.object.ncloudstorage.com",
  JPN: "jp.object.ncpstorage.com",
  DEN: "de.object.ncloudstorage.com",
};

/** Ncloud Storage endpoint map (storageType: "ncloud") */
const NCLOUD_STORAGE_ENDPOINT_MAP: Record<string, string> = {
  KR: "https://kr.ncloudstorage.com",
  USWN: "https://us.ncloudstorage.com",
  SGN: "https://sg.ncloudstorage.com",
  JPN: "https://jp.ncloudstorage.com",
  DEN: "https://de.ncloudstorage.com",
};

/** Ncloud Storage host map (storageType: "ncloud") */
const NCLOUD_STORAGE_HOST_MAP: Record<string, string> = {
  KR: "kr.ncloudstorage.com",
  USWN: "us.ncloudstorage.com",
  SGN: "sg.ncloudstorage.com",
  JPN: "jp.ncloudstorage.com",
  DEN: "de.ncloudstorage.com",
};

/**
 * Signing region used in AWS Signature V4 credential scope.
 * Ncloud Object Storage uses region names like "kr-standard" for signing.
 */
const SIGNING_REGION_MAP: Record<string, string> = {
  KR: "kr-standard",
  USWN: "us-standard",
  SGN: "sg-standard",
  JPN: "jp-standard",
  DEN: "de-standard",
};

/**
 * Signing region for Ncloud Storage (non-Object Storage).
 * Ncloud Storage uses short region codes like "kr" for signing.
 * Currently only KR is available, but structured for future expansion.
 */
const NCLOUD_STORAGE_SIGNING_REGION_MAP: Record<string, string> = {
  KR: "kr",
  USWN: "us",
  SGN: "sg",
  JPN: "jp",
  DEN: "de",
};

/**
 * S3-compatible client for Ncloud Object Storage.
 * Implements AWS Signature V4 authentication using Ncloud Access Key / Secret Key.
 * Endpoints per region:
 *   KR:   https://kr.object.ncloudstorage.com
 *   USWN: https://us.object.ncloudstorage.com
 *   SGN:  https://sg.object.ncloudstorage.com
 *   JPN:  https://jp.object.ncpstorage.com
 *   DEN:  https://de.object.ncloudstorage.com
 */
export class S3CompatibleClient {
  private readonly accessKey: string;
  private readonly secretKey: string;
  private regionCode: string;
  private readonly storageType: S3StorageType;

  constructor(config: S3CompatibleClientConfig) {
    this.accessKey = config.accessKey;
    this.secretKey = config.secretKey;
    this.regionCode = config.regionCode;
    this.storageType = config.storageType ?? "object";
  }

  setRegionCode(regionCode: string): void {
    this.regionCode = regionCode;
  }

  getRegionCode(): string {
    return this.regionCode;
  }

  private getEndpoint(): string {
    if (this.storageType === "ncloud") {
      return NCLOUD_STORAGE_ENDPOINT_MAP[this.regionCode] ?? NCLOUD_STORAGE_ENDPOINT_MAP["KR"];
    }
    return REGION_ENDPOINT_MAP[this.regionCode] ?? REGION_ENDPOINT_MAP["KR"];
  }

  private getHost(): string {
    if (this.storageType === "ncloud") {
      return NCLOUD_STORAGE_HOST_MAP[this.regionCode] ?? NCLOUD_STORAGE_HOST_MAP["KR"];
    }
    return REGION_HOST_MAP[this.regionCode] ?? REGION_HOST_MAP["KR"];
  }

  private sha256(data: string): string {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  private hmacSha256(key: string | Buffer, data: string): Buffer {
    return crypto.createHmac("sha256", key).update(data).digest();
  }

  private getSigningRegion(): string {
    if (this.storageType === "ncloud") {
      return NCLOUD_STORAGE_SIGNING_REGION_MAP[this.regionCode] ?? NCLOUD_STORAGE_SIGNING_REGION_MAP["KR"];
    }
    return SIGNING_REGION_MAP[this.regionCode] ?? SIGNING_REGION_MAP["KR"];
  }

  private getSigningKey(dateStamp: string): Buffer {
    const signingRegion = this.getSigningRegion();
    const kDate = this.hmacSha256(`AWS4${this.secretKey}`, dateStamp);
    const kRegion = this.hmacSha256(kDate, signingRegion);
    const kService = this.hmacSha256(kRegion, "s3");
    const kSigning = this.hmacSha256(kService, "aws4_request");
    return kSigning;
  }

  private buildCanonicalUri(bucket?: string, key?: string): string {
    if (!bucket) return "/";
    if (!key) return `/${bucket}`;
    const encodedKey = key
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    return `/${bucket}/${encodedKey}`;
  }

  private buildCanonicalQueryString(queryParams?: Record<string, string>): string {
    if (!queryParams || Object.keys(queryParams).length === 0) return "";
    const sorted = Object.entries(queryParams).sort(([a], [b]) => a.localeCompare(b));
    return sorted
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  }

  async request(options: S3RequestOptions): Promise<{ status: number; headers: Headers; body: string }> {
    const { method, bucket, key, queryParams, headers: extraHeaders, body } = options;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dateStamp = amzDate.substring(0, 8);

    const host = this.getHost();
    const canonicalUri = this.buildCanonicalUri(bucket, key);
    const canonicalQueryString = this.buildCanonicalQueryString(queryParams);

    const payloadHash = this.sha256(body ?? "");

    const requestHeaders: Record<string, string> = {
      host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      ...extraHeaders,
    };

    // Build canonical headers (sorted, lowercase)
    const signedHeaderKeys = Object.keys(requestHeaders)
      .map((k) => k.toLowerCase())
      .sort();
    const canonicalHeaders = signedHeaderKeys
      .map((k) => `${k}:${requestHeaders[Object.keys(requestHeaders).find((h) => h.toLowerCase() === k)!].trim()}`)
      .join("\n") + "\n";
    const signedHeaders = signedHeaderKeys.join(";");

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.getSigningRegion()}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      this.sha256(canonicalRequest),
    ].join("\n");

    const signingKey = this.getSigningKey(dateStamp);
    const signature = crypto
      .createHmac("sha256", signingKey)
      .update(stringToSign)
      .digest("hex");

    const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const fetchHeaders: Record<string, string> = {
      ...requestHeaders,
      Authorization: authorization,
    };
    // Remove 'host' from fetch headers (fetch sets it automatically)
    delete fetchHeaders["host"];

    const url = canonicalQueryString
      ? `${this.getEndpoint()}${canonicalUri}?${canonicalQueryString}`
      : `${this.getEndpoint()}${canonicalUri}`;

    const response = await fetchWithTimeout(url, {
      method,
      headers: fetchHeaders,
      body: body ?? undefined,
    });

    const responseBody = await response.text();

    if (!response.ok) {
      this.handleErrorResponse(response.status, responseBody);
    }

    return { status: response.status, headers: response.headers, body: responseBody };
  }

  private handleErrorResponse(status: number, body: string): never {
    const serviceName = this.storageType === "ncloud" ? "Ncloud Storage" : "Object Storage";
    // Try to parse XML error response from S3
    const codeMatch = body.match(/<Code>(.*?)<\/Code>/);
    const messageMatch = body.match(/<Message>(.*?)<\/Message>/);

    if (codeMatch && messageMatch) {
      throw new Error(
        `${serviceName} 호출 실패\n\n에러 코드: ${codeMatch[1]}\n메시지: ${messageMatch[1]}`
      );
    }

    throw new Error(
      `${serviceName} 호출 실패: HTTP ${status}\n\n응답: ${body}`
    );
  }
}
