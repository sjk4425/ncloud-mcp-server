import crypto from "node:crypto";
import { fetchWithTimeout } from "./_timeout.js";

export type S3StorageType = "object" | "ncloud";

/**
 * 버킷 주소 방식.
 * - `virtual-hosted`: `https://{bucket}.kr.ncloudstorage.com/{key}` — Ncloud Storage 공식 문서 형식
 * - `path`: `https://kr.object.ncloudstorage.com/{bucket}/{key}` — Object Storage 문서 형식
 */
export type S3Addressing = "virtual-hosted" | "path";

export interface S3CompatibleClientConfig {
  accessKey: string;
  secretKey: string;
  regionCode: string;
  storageType?: S3StorageType;
  /**
   * 주소 방식 오버라이드. 미지정 시 storageType 별 기본값
   * (`ncloud` → virtual-hosted, `object` → path).
   */
  addressing?: S3Addressing;
}

interface S3RequestOptions {
  method: string;
  bucket?: string;
  key?: string;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * S3 호환 API 호출 실패.
 *
 * 도구가 `message.includes("404")` 같은 문자열 매칭 대신 `status`/`code`로 분기할 수 있도록
 * 구조화한다. `code`는 XML `<Code>`(예: NoSuchBucket, NoSuchLifecycleConfiguration)이며
 * 본문이 없는 HEAD 응답처럼 코드가 없으면 HTTP 상태로 대체한다(`HTTP_404`).
 */
export class S3CompatibleError extends Error {
  readonly status: number;
  readonly code: string;
  readonly serviceName: string;
  readonly requestId?: string;

  constructor(opts: { message: string; status: number; code: string; serviceName: string; requestId?: string }) {
    super(opts.message);
    this.name = "S3CompatibleError";
    this.status = opts.status;
    this.code = opts.code;
    this.serviceName = opts.serviceName;
    this.requestId = opts.requestId;
  }
}

/** Object Storage 엔드포인트(storageType: "object") — 리전별 제공 */
const OBJECT_STORAGE_HOST_MAP: Record<string, string> = {
  KR: "kr.object.ncloudstorage.com",
  USWN: "us.object.ncloudstorage.com",
  SGN: "sg.object.ncloudstorage.com",
  JPN: "jp.object.ncpstorage.com",
  DEN: "de.object.ncloudstorage.com",
};

/**
 * Ncloud Storage 엔드포인트(storageType: "ncloud").
 *
 * 공식 API 문서(https://api.ncloud-docs.com/docs/storage-ncloudstorage)의 요청 URL은
 * `https://{Bucket}.{regionCode}.ncloudstorage.com` 이며 **제공 리전은 한국(kr) 하나**다.
 * 이전 구현은 us/sg/jp/de 호스트를 임의로 만들어 두어 `NCLOUD_REGION`이 KR 이 아니면
 * 존재하지 않는 호스트로 요청이 나갔다. 문서에 없는 리전은 만들지 않는다 — 새 리전이
 * 열리면 문서를 확인하고 여기에 추가한다.
 */
const NCLOUD_STORAGE_HOST_MAP: Record<string, string> = {
  KR: "kr.ncloudstorage.com",
};

/**
 * AWS Signature V4 credential scope 의 리전 문자열.
 * Object Storage 는 `kr-standard` 형식, Ncloud Storage 는 문서의 리전 코드 `kr` 그대로다.
 */
const OBJECT_STORAGE_SIGNING_REGION_MAP: Record<string, string> = {
  KR: "kr-standard",
  USWN: "us-standard",
  SGN: "sg-standard",
  JPN: "jp-standard",
  DEN: "de-standard",
};

const NCLOUD_STORAGE_SIGNING_REGION_MAP: Record<string, string> = {
  KR: "kr",
};

/**
 * RFC 3986 기준 URI 인코딩(SigV4 canonical URI/query 용).
 * `encodeURIComponent`는 `!'()*`를 남겨 두는데, 서명에 넣는 문자열과 실제 전송 URL이
 * 글자 하나라도 다르면 SignatureDoesNotMatch 가 난다. 서명·URL 양쪽에 같은 함수를 쓴다.
 */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 버킷 이름은 Host(virtual-hosted) 또는 경로 첫 세그먼트(path)에 그대로 들어간다.
 * `attacker.example/?x=` 같은 값이 들어오면 서명된 요청(액세스 키 ID·서명)이 다른 호스트로 나가거나
 * 경로/쿼리가 바뀌므로, DNS 라벨로 쓸 수 있는 문자만 허용한다(≤63자, 영숫자·점·하이픈, 양끝 영숫자).
 * 서비스별 세부 규칙(Ncloud Storage 는 소문자·점 불가)은 create 도구의 스키마가 별도로 검사한다.
 */
const SAFE_BUCKET_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,61}[A-Za-z0-9])?$/;

function assertSafeBucketName(bucket: string): void {
  if (!SAFE_BUCKET_NAME_RE.test(bucket)) {
    throw new Error(
      `잘못된 버킷 이름입니다: '${bucket}'. 버킷 이름은 최대 63자의 영숫자·점(.)·하이픈(-)만 허용되며 영숫자로 시작·끝나야 합니다. ` +
      `(Invalid bucket name — only letters, digits, '.' and '-', up to 63 chars, starting and ending alphanumeric.)`
    );
  }
}

/**
 * S3-compatible client for Ncloud Object Storage / Ncloud Storage.
 * Implements AWS Signature V4 authentication using Ncloud Access Key / Secret Key.
 *
 * Object Storage (storageType "object", path-style):
 *   KR:   https://kr.object.ncloudstorage.com/{bucket}/{key}
 *   USWN: https://us.object.ncloudstorage.com/{bucket}/{key}
 *   SGN:  https://sg.object.ncloudstorage.com/{bucket}/{key}
 *   JPN:  https://jp.object.ncpstorage.com/{bucket}/{key}
 *   DEN:  https://de.object.ncloudstorage.com/{bucket}/{key}
 *
 * Ncloud Storage (storageType "ncloud", virtual-hosted style, KR only):
 *   https://{bucket}.kr.ncloudstorage.com/{key}   (버킷 없는 ListBuckets 는 https://kr.ncloudstorage.com/)
 */
export class S3CompatibleClient {
  private readonly accessKey: string;
  private readonly secretKey: string;
  private regionCode: string;
  private readonly storageType: S3StorageType;
  private readonly addressing: S3Addressing;

  constructor(config: S3CompatibleClientConfig) {
    this.accessKey = config.accessKey;
    this.secretKey = config.secretKey;
    this.regionCode = config.regionCode;
    this.storageType = config.storageType ?? "object";
    this.addressing = config.addressing ?? (this.storageType === "ncloud" ? "virtual-hosted" : "path");
  }

  setRegionCode(regionCode: string): void {
    this.regionCode = regionCode;
  }

  getRegionCode(): string {
    return this.regionCode;
  }

  getStorageType(): S3StorageType {
    return this.storageType;
  }

  getAddressing(): S3Addressing {
    return this.addressing;
  }

  /**
   * 실제로 요청이 나가는 서비스 리전(서명 리전과 동일). Ncloud Storage 는 설정 리전이
   * 무엇이든 `kr` 이다 — 도구 응답에 리전을 표시할 때는 `getRegionCode()`가 아니라 이 값을 쓴다.
   */
  getServiceRegion(): string {
    return this.getSigningRegion();
  }

  /** 버킷을 뺀 서비스 루트 호스트. */
  private getBaseHost(): string {
    if (this.storageType === "ncloud") {
      return NCLOUD_STORAGE_HOST_MAP[this.regionCode] ?? NCLOUD_STORAGE_HOST_MAP["KR"];
    }
    return OBJECT_STORAGE_HOST_MAP[this.regionCode] ?? OBJECT_STORAGE_HOST_MAP["KR"];
  }

  /** 요청 Host 헤더 값. virtual-hosted 방식이면 버킷이 서브도메인으로 들어간다. */
  private getHost(bucket?: string): string {
    const base = this.getBaseHost();
    if (bucket && this.addressing === "virtual-hosted") return `${bucket}.${base}`;
    return base;
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
    return OBJECT_STORAGE_SIGNING_REGION_MAP[this.regionCode] ?? OBJECT_STORAGE_SIGNING_REGION_MAP["KR"];
  }

  private getSigningKey(dateStamp: string): Buffer {
    const signingRegion = this.getSigningRegion();
    const kDate = this.hmacSha256(`AWS4${this.secretKey}`, dateStamp);
    const kRegion = this.hmacSha256(kDate, signingRegion);
    const kService = this.hmacSha256(kRegion, "s3");
    const kSigning = this.hmacSha256(kService, "aws4_request");
    return kSigning;
  }

  private encodeKey(key: string): string {
    return key.split("/").map((part) => uriEncode(part)).join("/");
  }

  /**
   * canonical URI. virtual-hosted 방식은 버킷이 Host 로 빠지므로 경로에 들어가지 않는다
   * (`PUT /?lifecycle`, `GET /{key}`). path 방식은 `/{bucket}/{key}`.
   */
  private buildCanonicalUri(bucket?: string, key?: string): string {
    if (!bucket) return "/";
    if (this.addressing === "virtual-hosted") {
      return key ? `/${this.encodeKey(key)}` : "/";
    }
    if (!key) return `/${bucket}`;
    return `/${bucket}/${this.encodeKey(key)}`;
  }

  /**
   * 호출자가 이미 무결성 헤더를 지정했는지 확인한다(대소문자 무시).
   *
   * 지정돼 있으면 자동 `content-md5` 주입을 건너뛴다 — 같은 헤더가 대소문자만 다르게
   * 중복되면 canonical headers가 깨져 서명이 실패하기 때문이다.
   */
  private hasChecksumHeader(headers?: Record<string, string>): boolean {
    if (!headers) return false;
    return Object.keys(headers).some((h) => {
      const k = h.toLowerCase();
      return k === "content-md5" || k.startsWith("x-amz-checksum-");
    });
  }

  private buildCanonicalQueryString(queryParams?: Record<string, string>): string {
    if (!queryParams || Object.keys(queryParams).length === 0) return "";
    const sorted = Object.entries(queryParams).sort(([a], [b]) => a.localeCompare(b));
    return sorted
      .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
      .join("&");
  }

  async request(options: S3RequestOptions): Promise<{ status: number; headers: Headers; body: string }> {
    const { method, bucket, key, queryParams, headers: extraHeaders, body } = options;
    if (bucket !== undefined) assertSafeBucketName(bucket);

    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dateStamp = amzDate.substring(0, 8);

    const host = this.getHost(bucket);
    const canonicalUri = this.buildCanonicalUri(bucket, key);
    const canonicalQueryString = this.buildCanonicalQueryString(queryParams);

    const payloadHash = this.sha256(body ?? "");

    const requestHeaders: Record<string, string> = {
      host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      ...extraHeaders,
    };

    // 본문이 있는 요청에는 `content-md5`를 자동으로 붙인다.
    //
    // Ncloud Storage/Object Storage의 XML 본문 API(PutBucketLifecycleConfiguration,
    // PutBucketCors, PutBucketEncryption, DeleteObjects 등)는 무결성 헤더를 요구하며,
    // 없으면 `InvalidRequest: Missing required header for this request: Content-MD5 OR
    // x-amz-checksum-*`로 거부된다. 도구마다 붙이면 누락이 반복되므로 서명 직전 한 곳에서
    // 처리한다(여기서 넣어야 SignedHeaders에 포함돼 서명이 맞는다).
    // 호출자가 content-md5나 x-amz-checksum-*를 직접 지정했으면 그 값을 존중한다.
    if (body !== undefined && body !== "" && !this.hasChecksumHeader(extraHeaders)) {
      requestHeaders["content-md5"] = crypto.createHash("md5").update(body).digest("base64");
    }

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
      ? `https://${host}${canonicalUri}?${canonicalQueryString}`
      : `https://${host}${canonicalUri}`;

    const response = await fetchWithTimeout(url, {
      method,
      headers: fetchHeaders,
      body: body ?? undefined,
    });

    const responseBody = await response.text();

    if (!response.ok) {
      this.handleErrorResponse(response.status, responseBody, response.headers, bucket, key);
    }

    return { status: response.status, headers: response.headers, body: responseBody };
  }

  private handleErrorResponse(status: number, body: string, headers: Headers, bucket?: string, key?: string): never {
    const serviceName = this.storageType === "ncloud" ? "Ncloud Storage" : "Object Storage";
    const codeMatch = body.match(/<Code>(.*?)<\/Code>/);
    const messageMatch = body.match(/<Message>(.*?)<\/Message>/);
    const requestId = headers.get("x-amz-request-id") ?? undefined;
    const code = codeMatch?.[1] ?? `HTTP_${status}`;

    const lines: string[] = [];
    if (codeMatch) {
      lines.push(`${serviceName} 호출 실패`, "", `에러 코드: ${codeMatch[1]}`, `메시지: ${messageMatch?.[1] ?? "(없음)"}`);
    } else {
      lines.push(`${serviceName} 호출 실패: HTTP ${status}`, "", `응답: ${body || "(본문 없음)"}`);
    }
    lines.push(`HTTP 상태: ${status}`);
    if (requestId) lines.push(`x-amz-request-id: ${requestId}`);

    // Object Storage(`*.object.ncloudstorage.com`)와 Ncloud Storage(`*.kr.ncloudstorage.com`)는
    // 버킷 네임스페이스가 서로 다른 별개 서비스다. 한쪽 도구로 다른 쪽 버킷을 부르면
    // NoSuchBucket 이 나는데, 그 사실을 모르면 "버킷이 없다"로 오판한다. 힌트를 붙인다.
    //
    // 본문 없는 404(HEAD 응답)는 **버킷 요청일 때만** 버킷 부재로 본다. HEAD /{key} 의 404 는
    // 오브젝트 부재(NoSuchKey) 또는 현재 버전이 delete marker 인 경우이며, 버킷은 존재한다
    // (2026-09-17 라이브 검증에서 delete marker 키의 head_object 가 "버킷 없음" 으로 오안내된 건).
    if (code === "NoSuchBucket" || (status === 404 && !codeMatch && bucket && !key)) {
      const other = this.storageType === "ncloud"
        ? "Object Storage(레거시, kr.object.ncloudstorage.com) — `ncloud_ncs_` 접두 없는 `ncloud_list_buckets` 등"
        : "Ncloud Storage(신규, {bucket}.kr.ncloudstorage.com) — `ncloud_ncs_*` 도구";
      lines.push(
        "",
        `힌트: 버킷 '${bucket}'이(가) ${serviceName}에 없습니다. Object Storage 와 Ncloud Storage 는 버킷 네임스페이스가 다른 별개 서비스입니다. 다른 쪽에 있는 버킷이면 ${other}를 사용하세요.`
      );
    } else if (status === 404 && !codeMatch && bucket && key) {
      lines.push(
        "",
        `힌트: 버킷 '${bucket}'에 오브젝트 '${key}'이(가) 없습니다(NoSuchKey). 버전 관리 버킷이면 현재 버전이 delete marker 일 수 있습니다 — 이전 버전은 list_object_versions 로 찾아 versionId 를 지정해 조회하세요.`
      );
    }

    throw new S3CompatibleError({ message: lines.join("\n"), status, code, serviceName, requestId });
  }
}
