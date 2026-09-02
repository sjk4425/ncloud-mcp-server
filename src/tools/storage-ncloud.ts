import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { S3CompatibleClient } from "../client/s3-compatible-client.js";
import { defineTool } from "./_tool.js";
import { L, deletedMessage, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

/**
 * Ncloud Storage 스토리지 클래스.
 *
 * 오브젝트 저장 시점(PutObject/CopyObject의 `x-amz-storage-class`) 값이며
 * `STANDARD`가 기본이다. AWS S3의 `STANDARD_IA`/`GLACIER`는 이 서비스에 없다.
 * 라이프사이클 전환 대상은 `STANDARD`를 제외한 두 클래스뿐이다(TRANSITION_STORAGE_CLASSES).
 */
const STORAGE_CLASSES = ["STANDARD", "ONEZONE_IA", "DEEP_ARCHIVE"] as const;

/** 라이프사이클 `Transition.StorageClass` 허용 값 — 상위 클래스(STANDARD)로의 전환은 없다. */
const TRANSITION_STORAGE_CLASSES = ["ONEZONE_IA", "DEEP_ARCHIVE"] as const;

const STORAGE_CLASS_DESC =
  "STANDARD (default): Standard Class | ONEZONE_IA: One Zone-IA (Infrequent Access) Class | DEEP_ARCHIVE: Archive Class";

/**
 * Parse S3 XML list buckets response into a structured object.
 */
function parseListBucketsXml(xml: string): { buckets: Array<{ name: string; creationDate: string }> } {
  const buckets: Array<{ name: string; creationDate: string }> = [];
  // 요소 순서에 의존하지 않도록 블록 분리 후 필드별로 매치한다(parseListObjectsV2Xml 참조).
  const bucketRegex = /<Bucket>([\s\S]*?)<\/Bucket>/g;
  let match: RegExpExecArray | null;
  while ((match = bucketRegex.exec(xml)) !== null) {
    buckets.push({
      name: match[1].match(/<Name>(.*?)<\/Name>/)?.[1] ?? "",
      creationDate: match[1].match(/<CreationDate>(.*?)<\/CreationDate>/)?.[1] ?? "",
    });
  }
  return { buckets };
}

/**
 * Parse ListObjectsV2 XML response into a structured object.
 */
function parseListObjectsV2Xml(xml: string): {
  name: string;
  prefix: string;
  keyCount: number;
  maxKeys: number;
  isTruncated: boolean;
  nextContinuationToken?: string;
  contents: Array<{ key: string; lastModified: string; size: number; etag: string; storageClass: string }>;
  commonPrefixes: string[];
} {
  const nameMatch = xml.match(/<Name>(.*?)<\/Name>/);
  const prefixMatch = xml.match(/<Prefix>(.*?)<\/Prefix>/);
  const keyCountMatch = xml.match(/<KeyCount>(.*?)<\/KeyCount>/);
  const maxKeysMatch = xml.match(/<MaxKeys>(.*?)<\/MaxKeys>/);
  const isTruncatedMatch = xml.match(/<IsTruncated>(.*?)<\/IsTruncated>/);
  const nextTokenMatch = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/);

  const contents: Array<{ key: string; lastModified: string; size: number; etag: string; storageClass: string }> = [];
  // `<Contents>` 블록을 먼저 잘라내고 필드는 개별로 뽑는다.
  //
  // 하나의 정규식으로 요소 순서를 고정하면(이전 구현은 `<Size>` 다음 `<ETag>`를 요구했다)
  // 실제 응답 순서(Key → LastModified → ETag → Size → StorageClass)와 어긋나는 순간
  // **전 항목이 조용히 누락**된다 — keyCount는 맞는데 contents만 빈 배열이 되어 오브젝트가
  // 없는 것처럼 보였다(v1.11.0 라이브 테스트에서 실측). 블록 분리 방식은 순서에 의존하지 않는다.
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match2: RegExpExecArray | null;
  while ((match2 = contentsRegex.exec(xml)) !== null) {
    const itemXml = match2[1];
    const sizeText = itemXml.match(/<Size>(.*?)<\/Size>/)?.[1];
    contents.push({
      key: itemXml.match(/<Key>(.*?)<\/Key>/)?.[1] ?? "",
      lastModified: itemXml.match(/<LastModified>(.*?)<\/LastModified>/)?.[1] ?? "",
      size: sizeText ? parseInt(sizeText, 10) : 0,
      etag: itemXml.match(/<ETag>(.*?)<\/ETag>/)?.[1] ?? "",
      storageClass: itemXml.match(/<StorageClass>(.*?)<\/StorageClass>/)?.[1] ?? "",
    });
  }

  const commonPrefixes: string[] = [];
  const prefixRegex = /<CommonPrefixes>\s*<Prefix>(.*?)<\/Prefix>\s*<\/CommonPrefixes>/gs;
  let match3: RegExpExecArray | null;
  while ((match3 = prefixRegex.exec(xml)) !== null) {
    commonPrefixes.push(match3[1]);
  }

  const result: {
    name: string;
    prefix: string;
    keyCount: number;
    maxKeys: number;
    isTruncated: boolean;
    nextContinuationToken?: string;
    contents: Array<{ key: string; lastModified: string; size: number; etag: string; storageClass: string }>;
    commonPrefixes: string[];
  } = {
    name: nameMatch?.[1] ?? "",
    prefix: prefixMatch?.[1] ?? "",
    keyCount: keyCountMatch ? parseInt(keyCountMatch[1], 10) : 0,
    maxKeys: maxKeysMatch ? parseInt(maxKeysMatch[1], 10) : 1000,
    isTruncated: isTruncatedMatch?.[1] === "true",
    contents,
    commonPrefixes,
  };

  if (nextTokenMatch) {
    result.nextContinuationToken = nextTokenMatch[1];
  }

  return result;
}

/**
 * Parse S3 XML CORS configuration response into a structured object.
 */
function parseCorsConfigXml(xml: string): {
  corsRules: Array<{
    allowedOrigins: string[];
    allowedMethods: string[];
    allowedHeaders: string[];
    exposeHeaders: string[];
    maxAgeSeconds?: string;
  }>;
} {
  const corsRules: Array<{
    allowedOrigins: string[];
    allowedMethods: string[];
    allowedHeaders: string[];
    exposeHeaders: string[];
    maxAgeSeconds?: string;
  }> = [];

  const ruleRegex = /<CORSRule>([\s\S]*?)<\/CORSRule>/g;
  let ruleMatch: RegExpExecArray | null;

  while ((ruleMatch = ruleRegex.exec(xml)) !== null) {
    const ruleXml = ruleMatch[1];

    const allowedOrigins: string[] = [];
    const originRegex = /<AllowedOrigin>(.*?)<\/AllowedOrigin>/g;
    let originMatch: RegExpExecArray | null;
    while ((originMatch = originRegex.exec(ruleXml)) !== null) {
      allowedOrigins.push(originMatch[1]);
    }

    const allowedMethods: string[] = [];
    const methodRegex = /<AllowedMethod>(.*?)<\/AllowedMethod>/g;
    let methodMatch: RegExpExecArray | null;
    while ((methodMatch = methodRegex.exec(ruleXml)) !== null) {
      allowedMethods.push(methodMatch[1]);
    }

    const allowedHeaders: string[] = [];
    const headerRegex = /<AllowedHeader>(.*?)<\/AllowedHeader>/g;
    let headerMatch: RegExpExecArray | null;
    while ((headerMatch = headerRegex.exec(ruleXml)) !== null) {
      allowedHeaders.push(headerMatch[1]);
    }

    const exposeHeaders: string[] = [];
    const exposeRegex = /<ExposeHeader>(.*?)<\/ExposeHeader>/g;
    let exposeMatch: RegExpExecArray | null;
    while ((exposeMatch = exposeRegex.exec(ruleXml)) !== null) {
      exposeHeaders.push(exposeMatch[1]);
    }

    const maxAgeMatch = ruleXml.match(/<MaxAgeSeconds>(.*?)<\/MaxAgeSeconds>/);

    corsRules.push({
      allowedOrigins,
      allowedMethods,
      allowedHeaders,
      exposeHeaders,
      maxAgeSeconds: maxAgeMatch?.[1],
    });
  }

  return { corsRules };
}

/**
 * Build CORS configuration XML from structured input.
 */
function buildCorsConfigXml(corsRules: Array<{
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders?: string[];
  exposeHeaders?: string[];
  maxAgeSeconds?: number;
}>): string {
  const rulesXml = corsRules.map((rule) => {
    let ruleContent = "";

    for (const origin of rule.allowedOrigins) {
      ruleContent += `<AllowedOrigin>${origin}</AllowedOrigin>`;
    }
    for (const method of rule.allowedMethods) {
      ruleContent += `<AllowedMethod>${method}</AllowedMethod>`;
    }
    if (rule.allowedHeaders) {
      for (const header of rule.allowedHeaders) {
        ruleContent += `<AllowedHeader>${header}</AllowedHeader>`;
      }
    }
    if (rule.exposeHeaders) {
      for (const header of rule.exposeHeaders) {
        ruleContent += `<ExposeHeader>${header}</ExposeHeader>`;
      }
    }
    if (rule.maxAgeSeconds !== undefined) {
      ruleContent += `<MaxAgeSeconds>${rule.maxAgeSeconds}</MaxAgeSeconds>`;
    }

    return `<CORSRule>${ruleContent}</CORSRule>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration>${rulesXml}</CORSConfiguration>`;
}

/**
 * Parse S3 XML lifecycle configuration response into a structured object.
 */
function parseLifecycleConfigXml(xml: string): {
  rules: Array<{
    id: string;
    status: string;
    prefix: string;
    transitions: Array<{ days?: string; date?: string; storageClass: string }>;
    expiration?: { days?: string; date?: string };
    abortIncompleteMultipartUpload?: { daysAfterInitiation: string };
  }>;
} {
  const rules: Array<{
    id: string;
    status: string;
    prefix: string;
    transitions: Array<{ days?: string; date?: string; storageClass: string }>;
    expiration?: { days?: string; date?: string };
    abortIncompleteMultipartUpload?: { daysAfterInitiation: string };
  }> = [];

  const ruleRegex = /<Rule>([\s\S]*?)<\/Rule>/g;
  let ruleMatch: RegExpExecArray | null;

  while ((ruleMatch = ruleRegex.exec(xml)) !== null) {
    const ruleXml = ruleMatch[1];

    const idMatch = ruleXml.match(/<ID>(.*?)<\/ID>/);
    const statusMatch = ruleXml.match(/<Status>(.*?)<\/Status>/);
    const prefixMatch = ruleXml.match(/<Prefix>(.*?)<\/Prefix>/);

    // Parse transitions
    const transitions: Array<{ days?: string; date?: string; storageClass: string }> = [];
    const transitionRegex = /<Transition>([\s\S]*?)<\/Transition>/g;
    let transMatch: RegExpExecArray | null;
    while ((transMatch = transitionRegex.exec(ruleXml)) !== null) {
      const transXml = transMatch[1];
      const daysMatch = transXml.match(/<Days>(.*?)<\/Days>/);
      const dateMatch = transXml.match(/<Date>(.*?)<\/Date>/);
      const storageClassMatch = transXml.match(/<StorageClass>(.*?)<\/StorageClass>/);
      transitions.push({
        days: daysMatch?.[1],
        date: dateMatch?.[1],
        storageClass: storageClassMatch?.[1] ?? "",
      });
    }

    // Parse expiration
    let expiration: { days?: string; date?: string } | undefined;
    const expirationMatch = ruleXml.match(/<Expiration>([\s\S]*?)<\/Expiration>/);
    if (expirationMatch) {
      const expXml = expirationMatch[1];
      const expDaysMatch = expXml.match(/<Days>(.*?)<\/Days>/);
      const expDateMatch = expXml.match(/<Date>(.*?)<\/Date>/);
      expiration = {
        days: expDaysMatch?.[1],
        date: expDateMatch?.[1],
      };
    }

    // Parse abort incomplete multipart upload
    let abortIncompleteMultipartUpload: { daysAfterInitiation: string } | undefined;
    const abortMatch = ruleXml.match(/<AbortIncompleteMultipartUpload>([\s\S]*?)<\/AbortIncompleteMultipartUpload>/);
    if (abortMatch) {
      const daysAfterMatch = abortMatch[1].match(/<DaysAfterInitiation>(.*?)<\/DaysAfterInitiation>/);
      if (daysAfterMatch) {
        abortIncompleteMultipartUpload = { daysAfterInitiation: daysAfterMatch[1] };
      }
    }

    rules.push({
      id: idMatch?.[1] ?? "",
      status: statusMatch?.[1] ?? "",
      prefix: prefixMatch?.[1] ?? "",
      transitions,
      expiration,
      abortIncompleteMultipartUpload,
    });
  }

  return { rules };
}

/**
 * Build lifecycle configuration XML from structured input.
 */
function buildLifecycleConfigXml(rules: Array<{
  id: string;
  status?: string;
  prefix?: string;
  transitions?: Array<{ days?: number; date?: string; storageClass: string }>;
  expiration?: { days?: number; date?: string };
  abortIncompleteMultipartUploadDays?: number;
}>): string {
  const rulesXml = rules.map((rule) => {
    let ruleContent = "";

    ruleContent += `<ID>${rule.id}</ID>`;
    ruleContent += `<Status>${rule.status ?? "Enabled"}</Status>`;

    // Filter (Prefix-based)
    ruleContent += `<Filter><Prefix>${rule.prefix ?? ""}</Prefix></Filter>`;

    // Transitions
    if (rule.transitions) {
      for (const transition of rule.transitions) {
        ruleContent += "<Transition>";
        if (transition.days !== undefined) {
          ruleContent += `<Days>${transition.days}</Days>`;
        }
        if (transition.date) {
          ruleContent += `<Date>${transition.date}</Date>`;
        }
        ruleContent += `<StorageClass>${transition.storageClass}</StorageClass>`;
        ruleContent += "</Transition>";
      }
    }

    // Expiration
    if (rule.expiration) {
      ruleContent += "<Expiration>";
      if (rule.expiration.days !== undefined) {
        ruleContent += `<Days>${rule.expiration.days}</Days>`;
      }
      if (rule.expiration.date) {
        ruleContent += `<Date>${rule.expiration.date}</Date>`;
      }
      ruleContent += "</Expiration>";
    }

    // AbortIncompleteMultipartUpload
    if (rule.abortIncompleteMultipartUploadDays !== undefined) {
      ruleContent += `<AbortIncompleteMultipartUpload><DaysAfterInitiation>${rule.abortIncompleteMultipartUploadDays}</DaysAfterInitiation></AbortIncompleteMultipartUpload>`;
    }

    return `<Rule>${ruleContent}</Rule>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?><LifecycleConfiguration>${rulesXml}</LifecycleConfiguration>`;
}

/**
 * Parse S3 XML encryption configuration response into a structured object.
 */
function parseEncryptionConfigXml(xml: string): {
  rules: Array<{
    applyServerSideEncryptionByDefault: { sseAlgorithm: string };
  }>;
} {
  const rules: Array<{
    applyServerSideEncryptionByDefault: { sseAlgorithm: string };
  }> = [];

  const ruleRegex = /<Rule>([\s\S]*?)<\/Rule>/g;
  let ruleMatch: RegExpExecArray | null;

  while ((ruleMatch = ruleRegex.exec(xml)) !== null) {
    const ruleXml = ruleMatch[1];
    const algorithmMatch = ruleXml.match(/<SSEAlgorithm>(.*?)<\/SSEAlgorithm>/);
    rules.push({
      applyServerSideEncryptionByDefault: {
        sseAlgorithm: algorithmMatch?.[1] ?? "",
      },
    });
  }

  return { rules };
}

/**
 * Build encryption configuration XML from algorithm input.
 */
function buildEncryptionConfigXml(sseAlgorithm: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>${sseAlgorithm}</SSEAlgorithm></ApplyServerSideEncryptionByDefault></Rule></ServerSideEncryptionConfiguration>`;
}

export function registerStorageNcloudTools(server: McpServer, client: S3CompatibleClient): void {
  // ─── Lifecycle Query Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_bucket_lifecycle",
    "Get the lifecycle configuration rules for a Ncloud Storage bucket. Returns storage class transition rules, expiration rules, and abort incomplete multipart upload rules.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to retrieve lifecycle configuration for"),
    },
    async (params) => {
      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        queryParams: { lifecycle: "" },
      });
      const result = parseLifecycleConfigXml(response.body);
      return result;
    }
  );

  // ─── Lifecycle Management Tools ────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_put_bucket_lifecycle",
    "Set lifecycle configuration rules for a Ncloud Storage bucket. Supports storage class transitions (ONEZONE_IA, DEEP_ARCHIVE) and object expiration. Use dryRun=true to preview the configuration.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to set lifecycle configuration for"),
      rules: z.array(z.object({
        id: z.string().describe("Unique identifier for the rule"),
        status: z.enum(["Enabled", "Disabled"]).optional().default("Enabled").describe("Whether the rule is enabled or disabled"),
        prefix: z.string().optional().default("").describe("Object key prefix to which the rule applies (empty string for all objects)"),
        transitions: z.array(z.object({
          days: z.number().optional().describe("Number of days after object creation to transition"),
          date: z.string().optional().describe("Specific date to transition (ISO 8601 format)"),
          storageClass: z.enum(TRANSITION_STORAGE_CLASSES).describe("Target storage class (ONEZONE_IA: One Zone-IA (Infrequent Access) Class, DEEP_ARCHIVE: Archive Class). Ncloud Storage has no STANDARD_IA/GLACIER class — those AWS S3 names are rejected"),
        })).optional().describe("Storage class transition rules"),
        expiration: z.object({
          days: z.number().optional().describe("Number of days after object creation to expire"),
          date: z.string().optional().describe("Specific date to expire (ISO 8601 format)"),
        }).optional().describe("Object expiration rule"),
        abortIncompleteMultipartUploadDays: z.number().optional().describe("Number of days after which incomplete multipart uploads are aborted"),
      })).min(1, {
        message: L({ ko: "최소 1개 이상의 라이프사이클 규칙이 필요합니다.", en: "At least one lifecycle rule is required." }),
      }).describe("Array of lifecycle rules to apply"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually applying the configuration"),
    },
    async (params) => {
      const xmlBody = buildLifecycleConfigXml(params.rules);

      if (params.dryRun) {
        // 실제로 보내는 것은 XML 본문이다 — 입력 규칙 배열을 다시 찍으면
        // XML 직렬화 단계의 결함을 프리뷰가 가려버린다.
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Bucket Lifecycle Configuration",
          endpoint: `/${params.bucketName}?lifecycle`,
          method: "PUT",
          requestParams: {
            bucket: params.bucketName,
            queryParams: { lifecycle: "" },
            headers: { "content-type": "application/xml" },
            body: xmlBody,
          },
          noun: { ko: "라이프사이클 규칙", en: "lifecycle rule" },
          verb: "apply",
        });
      }

      await client.request({
        method: "PUT",
        bucket: params.bucketName,
        queryParams: { lifecycle: "" },
        headers: { "content-type": "application/xml" },
        body: xmlBody,
      });

      const summary = {
        message: L({ ko: `✅ 버킷 '${params.bucketName}'의 라이프사이클 규칙이 설정되었습니다.`, en: `✅ Lifecycle rules for bucket '${params.bucketName}' have been set.` }),
        bucket: params.bucketName,
        rulesApplied: params.rules.length,
        rules: params.rules.map((rule) => ({
          id: rule.id,
          status: rule.status,
          prefix: rule.prefix || "(all objects)",
        })),
      };
      return summary;
    }
  );

  // ─── Lifecycle Delete Tools ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_bucket_lifecycle",
    "⚠️ Destructive: Delete all lifecycle configuration rules from a Ncloud Storage bucket. Set confirm=true to execute.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to delete lifecycle configuration from"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {

      await client.request({
        method: "DELETE",
        bucket: params.bucketName,
        queryParams: { lifecycle: "" },
      });

      const result = { message: deletedMessage({ ko: `버킷 '${params.bucketName}'의 라이프사이클 규칙`, en: `the lifecycle rules of bucket '${params.bucketName}'` }) };
      return result;
    },
    { destructive: { noun: "all lifecycle rules from Bucket", describe: (params) => params.bucketName } }
  );

  // ─── CORS Query Tools ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_bucket_cors",
    "Get the CORS (Cross-Origin Resource Sharing) configuration for a Ncloud Storage bucket. Returns allowed origins, methods, headers, and max age settings.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to retrieve CORS configuration for"),
    },
    async (params) => {
      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        queryParams: { cors: "" },
      });
      const result = parseCorsConfigXml(response.body);
      return result;
    }
  );

  // ─── CORS Management Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_put_bucket_cors",
    "Set CORS (Cross-Origin Resource Sharing) configuration for a Ncloud Storage bucket. Defines which origins, methods, and headers are allowed for cross-origin requests.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to set CORS configuration for"),
      corsRules: z.array(z.object({
        allowedOrigins: z.array(z.string()).min(1, {
          message: L({ ko: "최소 1개 이상의 allowedOrigins가 필요합니다.", en: "At least one allowedOrigins entry is required." }),
        }).describe("List of origins allowed to make cross-origin requests (e.g., 'https://example.com' or '*')"),
        allowedMethods: z.array(z.enum(["GET", "PUT", "POST", "DELETE", "HEAD"])).min(1, {
          message: L({ ko: "최소 1개 이상의 allowedMethods가 필요합니다.", en: "At least one allowedMethods entry is required." }),
        }).describe("HTTP methods allowed for cross-origin requests"),
        allowedHeaders: z.array(z.string()).optional().describe("Headers allowed in preflight requests (e.g., 'Content-Type', 'Authorization', or '*')"),
        exposeHeaders: z.array(z.string()).optional().describe("Response headers exposed to the browser (e.g., 'x-amz-request-id', 'ETag')"),
        maxAgeSeconds: z.number().optional().describe("Time in seconds the browser can cache preflight response (e.g., 3600)"),
      })).min(1, {
        message: L({ ko: "최소 1개 이상의 CORS 규칙이 필요합니다.", en: "At least one CORS rule is required." }),
      }).describe("Array of CORS rules to apply to the bucket"),
    },
    async (params) => {
      const xmlBody = buildCorsConfigXml(params.corsRules);

      await client.request({
        method: "PUT",
        bucket: params.bucketName,
        queryParams: { cors: "" },
        headers: { "content-type": "application/xml" },
        body: xmlBody,
      });

      const summary = {
        message: L({ ko: `✅ 버킷 '${params.bucketName}'의 CORS 설정이 적용되었습니다.`, en: `✅ The CORS configuration for bucket '${params.bucketName}' has been applied.` }),
        bucket: params.bucketName,
        rulesApplied: params.corsRules.length,
        rules: params.corsRules.map((rule, index) => ({
          ruleIndex: index + 1,
          allowedOrigins: rule.allowedOrigins,
          allowedMethods: rule.allowedMethods,
          allowedHeaders: rule.allowedHeaders ?? [],
          exposeHeaders: rule.exposeHeaders ?? [],
          maxAgeSeconds: rule.maxAgeSeconds,
        })),
      };
      return summary;
    }
  );

  // ─── CORS Delete Tools ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_bucket_cors",
    "⚠️ Destructive: Delete the CORS configuration from a Ncloud Storage bucket. This will remove all cross-origin access rules. Set confirm=true to execute.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to delete CORS configuration from"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {

      await client.request({
        method: "DELETE",
        bucket: params.bucketName,
        queryParams: { cors: "" },
      });

      const result = { message: deletedMessage({ ko: `버킷 '${params.bucketName}'의 CORS 설정`, en: `the CORS configuration of bucket '${params.bucketName}'` }) };
      return result;
    },
    { destructive: { noun: "all CORS rules from Bucket", describe: (params) => params.bucketName } }
  );

  // ─── Encryption Query Tools ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_bucket_encryption",
    "Get the default server-side encryption (SSE) configuration for a Ncloud Storage bucket. Returns the encryption algorithm applied to new objects by default.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to retrieve encryption configuration for"),
    },
    async (params) => {
      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        queryParams: { encryption: "" },
      });
      const result = parseEncryptionConfigXml(response.body);
      return result;
    }
  );

  // ─── Encryption Management Tools ───────────────────────────────────────────

  defineTool(
    server,
    "ncloud_put_bucket_encryption",
    "Set the default server-side encryption (SSE) configuration for a Ncloud Storage bucket. All new objects will be encrypted with the specified algorithm.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to set encryption configuration for"),
      sseAlgorithm: z.enum(["AES256"], {
        required_error: requiredError("sseAlgorithm"),
      }).describe("Server-side encryption algorithm (AES256)"),
    },
    async (params) => {
      const xmlBody = buildEncryptionConfigXml(params.sseAlgorithm);

      await client.request({
        method: "PUT",
        bucket: params.bucketName,
        queryParams: { encryption: "" },
        headers: { "content-type": "application/xml" },
        body: xmlBody,
      });

      const summary = {
        message: L({ ko: `✅ 버킷 '${params.bucketName}'의 기본 암호화가 '${params.sseAlgorithm}'로 설정되었습니다.`, en: `✅ Default encryption for bucket '${params.bucketName}' has been set to '${params.sseAlgorithm}'.` }),
        bucket: params.bucketName,
        sseAlgorithm: params.sseAlgorithm,
      };
      return summary;
    }
  );

  // ─── Encryption Delete Tools ───────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_bucket_encryption",
    "⚠️ Destructive: Delete the default server-side encryption (SSE) configuration from a Ncloud Storage bucket. New objects will no longer be encrypted by default. Set confirm=true to execute.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to delete encryption configuration from"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {

      await client.request({
        method: "DELETE",
        bucket: params.bucketName,
        queryParams: { encryption: "" },
      });

      const result = { message: deletedMessage({ ko: `버킷 '${params.bucketName}'의 기본 암호화 설정`, en: `the default encryption configuration of bucket '${params.bucketName}'` }) };
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete the default encryption configuration from Bucket [${params.bucketName}]. New objects will no longer be encrypted by default. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Ncloud Storage Basic CRUD Tools (Bucket & Object)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── List Buckets ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_list_buckets",
    "List all Ncloud Storage buckets in the current region",
    {},
    async () => {
      const response = await client.request({ method: "GET" });
      const result = parseListBucketsXml(response.body);
      return result;
    }
  );

  // ─── Create Bucket ─────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_create_bucket",
    "Create a new Ncloud Storage bucket. Use dryRun=true to preview.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to create"),
      dryRun: z.boolean().optional().default(true).describe("If true (default), returns a preview without actually creating the bucket"),
    },
    async (params) => {
      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Ncloud Storage Bucket Creation",
          endpoint: `/${params.bucketName}`,
          method: "PUT",
          requestParams: { bucket: params.bucketName },
          noun: { ko: "버킷", en: "bucket" },
          notes: { region: client.getRegionCode() },
        });
      }
      await client.request({ method: "PUT", bucket: params.bucketName });
      const summary = {
        리소스타입: "Ncloud Storage Bucket",
        리소스명: params.bucketName,
        리전: client.getRegionCode(),
        상태: "created",
      };
      return summary;
    }
  );

  // ─── Delete Bucket ─────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_delete_bucket",
    "⚠️ Destructive: Permanently delete a Ncloud Storage bucket. The bucket must be empty. Set confirm=true to execute.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      await client.request({ method: "DELETE", bucket: params.bucketName });
      const result = { message: deletedMessage({ ko: `Ncloud Storage 버킷 '${params.bucketName}'`, en: `Ncloud Storage bucket '${params.bucketName}'` }) };
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Ncloud Storage Bucket [${params.bucketName}]. The bucket must be empty. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Head Bucket ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_head_bucket",
    "Check if a Ncloud Storage bucket exists and retrieve its metadata (region, access permissions)",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to check"),
    },
    async (params) => {
      try {
        const response = await client.request({ method: "HEAD", bucket: params.bucketName });
        const result = {
          bucket: params.bucketName,
          exists: true,
          statusCode: response.status,
          region: response.headers.get("x-amz-bucket-region") ?? client.getRegionCode(),
        };
        return result;
      } catch (error: any) {
        if (error.message.includes("404")) {
          const result = {
            bucket: params.bucketName,
            exists: false,
            statusCode: 404,
          };
          return result;
        }
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── List Objects (V2) ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_list_objects",
    "List objects in a Ncloud Storage bucket",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      prefix: z.string().optional().describe("Limits results to keys beginning with this prefix"),
      delimiter: z.string().optional().describe("Delimiter for grouping keys (commonly '/')"),
      maxKeys: z.number().optional().describe("Maximum number of keys to return (default 1000)"),
      continuationToken: z.string().optional().describe("Token for pagination (from previous response's nextContinuationToken)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { "list-type": "2" };
      if (params.prefix) queryParams["prefix"] = params.prefix;
      if (params.delimiter) queryParams["delimiter"] = params.delimiter;
      if (params.maxKeys) queryParams["max-keys"] = String(params.maxKeys);
      if (params.continuationToken) queryParams["continuation-token"] = params.continuationToken;

      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        queryParams,
      });
      const result = parseListObjectsV2Xml(response.body);
      return result;
    }
  );

  // ─── Put Object ────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_put_object",
    "Upload (put) an object to a Ncloud Storage bucket. Optionally selects a storage class (STANDARD | ONEZONE_IA | DEEP_ARCHIVE). Use dryRun=true to preview.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      key: z.string({
        required_error: requiredError("key"),
      }).describe("Object key (path) to upload to"),
      body: z.string({
        required_error: requiredError("body"),
      }).describe("Content to upload as the object body"),
      contentType: z.string().optional().describe("Content-Type header for the object (e.g., 'text/plain', 'application/json')"),
      storageClass: z.enum(STORAGE_CLASSES).optional().describe(`Storage class to store the object in — ${STORAGE_CLASS_DESC}. Sent as the x-amz-storage-class header; omit to use STANDARD`),
      dryRun: z.boolean().optional().default(true).describe("If true (default), returns a preview without actually uploading"),
    },
    async (params) => {
      const headers: Record<string, string> = {};
      if (params.contentType) {
        headers["content-type"] = params.contentType;
      }
      if (params.storageClass) {
        headers["x-amz-storage-class"] = params.storageClass;
      }

      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Ncloud Storage Object Upload",
          endpoint: `/${params.bucketName}/${params.key}`,
          method: "PUT",
          requestParams: { bucket: params.bucketName, key: params.key, headers },
          noun: { ko: "오브젝트", en: "object" },
          verb: "upload",
          notes: {
            bodySize: `${params.body.length} bytes`,
            ...(params.storageClass ? {} : { note_storageClass: "(x-amz-storage-class not sent — the server stores it as STANDARD)" }),
          },
        });
      }

      await client.request({
        method: "PUT",
        bucket: params.bucketName,
        key: params.key,
        headers,
        body: params.body,
      });

      const summary = {
        리소스타입: "Ncloud Storage Object",
        버킷: params.bucketName,
        키: params.key,
        크기: `${params.body.length} bytes`,
        상태: "uploaded",
      };
      return summary;
    }
  );

  // ─── Get Object ────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_get_object",
    "Get (download) an object from a Ncloud Storage bucket. Returns the object content as text.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      key: z.string({
        required_error: requiredError("key"),
      }).describe("Object key (path) to retrieve"),
    },
    async (params) => {
      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        key: params.key,
      });
      const result = {
        bucket: params.bucketName,
        key: params.key,
        contentLength: response.headers.get("content-length"),
        contentType: response.headers.get("content-type"),
        lastModified: response.headers.get("last-modified"),
        body: response.body,
      };
      return result;
    }
  );

  // ─── Head Object ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_head_object",
    "Get metadata of an object in a Ncloud Storage bucket without downloading the body, including its storage class",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      key: z.string({
        required_error: requiredError("key"),
      }).describe("Object key (path) to check"),
    },
    async (params) => {
      const response = await client.request({
        method: "HEAD",
        bucket: params.bucketName,
        key: params.key,
      });
      // S3 호환 서비스는 STANDARD 오브젝트에 `x-amz-storage-class`를 붙이지 않는다.
      // 헤더 원본을 그대로 두면 `null`이라 판단이 어려워, 없을 때는 STANDARD로 해석하되
      // 해석 여부를 `storageClassHeader`로 함께 노출해 근거를 남긴다.
      const storageClassHeader = response.headers.get("x-amz-storage-class");
      const result = {
        bucket: params.bucketName,
        key: params.key,
        contentLength: response.headers.get("content-length"),
        contentType: response.headers.get("content-type"),
        lastModified: response.headers.get("last-modified"),
        etag: response.headers.get("etag"),
        storageClass: storageClassHeader ?? "STANDARD",
        storageClassHeader: storageClassHeader ?? "(absent — S3 omits this header for STANDARD)",
        statusCode: response.status,
      };
      return result;
    }
  );

  // ─── Copy Object ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_copy_object",
    "Copy an object within Ncloud Storage. Optionally sets the copy's storage class (STANDARD | ONEZONE_IA | DEEP_ARCHIVE)",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Destination bucket name"),
      key: z.string({
        required_error: requiredError("key"),
      }).describe("Destination object key (path)"),
      copySource: z.string({
        required_error: requiredError("copySource"),
      }).describe("Source object path in format: /{sourceBucket}/{sourceKey}"),
      storageClass: z.enum(STORAGE_CLASSES).optional().describe(`Storage class for the copy — ${STORAGE_CLASS_DESC}. Sent as the x-amz-storage-class header; omit to use STANDARD. Copying an object onto itself with a different class is the way to change an existing object's storage class`),
    },
    async (params) => {
      const headers: Record<string, string> = {
        "x-amz-copy-source": params.copySource,
      };
      if (params.storageClass) {
        headers["x-amz-storage-class"] = params.storageClass;
      }

      const response = await client.request({
        method: "PUT",
        bucket: params.bucketName,
        key: params.key,
        headers,
      });
      const result = {
        리소스타입: "Ncloud Storage Object Copy",
        대상버킷: params.bucketName,
        대상키: params.key,
        복사원본: params.copySource,
        스토리지클래스: params.storageClass ?? "STANDARD (default)",
        상태: "copied",
        response: response.body,
      };
      return result;
    }
  );

  // ─── Delete Object ─────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_delete_object",
    "⚠️ Destructive: Permanently delete an object from a Ncloud Storage bucket. Set confirm=true to execute.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      key: z.string({
        required_error: requiredError("key"),
      }).describe("Object key (path) to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      await client.request({
        method: "DELETE",
        bucket: params.bucketName,
        key: params.key,
      });
      const result = { message: deletedMessage({ ko: `Ncloud Storage 오브젝트 '${params.bucketName}/${params.key}'`, en: `Ncloud Storage object '${params.bucketName}/${params.key}'` }) };
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Object [${params.bucketName}/${params.key}] from Ncloud Storage. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Delete Objects (Multi) ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_delete_objects",
    "⚠️ Destructive: Permanently delete multiple objects from a Ncloud Storage bucket. Set confirm=true to execute.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      keys: z.array(z.string(), {
        required_error: requiredError("keys"),
      }).describe("Array of object keys to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {

      const objectsXml = params.keys.map((k) => `<Object><Key>${k}</Key></Object>`).join("");
      const xmlBody = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>false</Quiet>${objectsXml}</Delete>`;

      const response = await client.request({
        method: "POST",
        bucket: params.bucketName,
        queryParams: { delete: "" },
        headers: {
          "content-type": "application/xml",
        },
        body: xmlBody,
      });

      const result = {
        message: L({ ko: `✅ Ncloud Storage 버킷 '${params.bucketName}'에서 ${params.keys.length}개 오브젝트가 삭제되었습니다.`, en: `✅ ${params.keys.length} object(s) have been deleted from Ncloud Storage bucket '${params.bucketName}'.` }),
        response: response.body,
      };
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete ${params.keys.length} objects from Ncloud Storage Bucket [${params.bucketName}]:\n${params.keys.map((k: any) => `  - ${k}`).join("\n")}\n\nDo you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );
}
