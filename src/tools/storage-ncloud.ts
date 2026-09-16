import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { S3CompatibleClient, S3CompatibleError } from "../client/s3-compatible-client.js";
import { defineTool } from "./_tool.js";
import { L, deletedMessage, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";
import { tag, wrap, xmlDocument, text, block, blocks, texts, intText, boolText } from "./_s3xml.js";
import { registerStorageNcloudMultipartTools } from "./storage-ncloud-multipart.js";

/**
 * Ncloud Storage 도구 (`ncloud_ncs_*`).
 *
 * 공식 문서: https://api.ncloud-docs.com/docs/storage-ncloudstorage (개별 op 는 `ncloudstorage-<op>`)
 *
 * Ncloud Storage 는 **레거시 Object Storage 와 별개 서비스**다 — 엔드포인트
 * (`{bucket}.kr.ncloudstorage.com` vs `kr.object.ncloudstorage.com`)와 버킷 네임스페이스가 다르다.
 * 이 파일의 모든 도구는 `ncloud_ncs_` 접두를 쓴다. 이전에는 lifecycle/cors/encryption 9개가
 * 접두 없이 `ncloud_put_bucket_lifecycle` 처럼 등록돼 있어 Object Storage 도구
 * (`ncloud_put_bucket_versioning` 등)와 이름 체계가 뒤섞였고, 모델이 두 서비스를 구분하지 못해
 * 반대편 엔드포인트로 요청이 나가는 라우팅 오류가 있었다(v1.15.0 에서 통일).
 */

const NCS = "[Ncloud Storage]";

/**
 * Ncloud Storage 스토리지 클래스.
 *
 * 오브젝트 저장 시점(PutObject/CopyObject/CreateMultipartUpload 의 `x-amz-storage-class`) 값이며
 * `STANDARD`가 기본이다. AWS S3의 `STANDARD_IA`/`GLACIER`는 이 서비스에 없다.
 * 라이프사이클 전환 대상은 `STANDARD`를 제외한 두 클래스뿐이다(TRANSITION_STORAGE_CLASSES).
 */
const STORAGE_CLASSES = ["STANDARD", "ONEZONE_IA", "DEEP_ARCHIVE"] as const;

/** 라이프사이클 `Transition.StorageClass` 허용 값 — 상위 클래스(STANDARD)로의 전환은 없다. */
const TRANSITION_STORAGE_CLASSES = ["ONEZONE_IA", "DEEP_ARCHIVE"] as const;

const STORAGE_CLASS_DESC =
  "STANDARD (default): Standard Class | ONEZONE_IA: One Zone-IA (Infrequent Access) Class | DEEP_ARCHIVE: Archive Class";

const OBJECT_LOCK_MODES = ["GOVERNANCE", "COMPLIANCE"] as const;
const LEGAL_HOLD = ["ON", "OFF"] as const;
const SSE_ALGORITHMS = ["AES256", "aws:kms"] as const;

/** 버킷 이름 규칙(공식 가이드): 3~63자, 소문자·숫자·하이픈, 시작/끝은 영숫자. 점(.)은 불가. */
const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

// ─── 공용 스키마 ─────────────────────────────────────────────────────────────

function bucketNameSchema(desc = "Name of the Ncloud Storage bucket") {
  return z.string({ required_error: requiredError("bucketName") }).describe(desc);
}
function keySchema(desc = "Object key (path)") {
  return z.string({ required_error: requiredError("key") }).describe(desc);
}
function versionIdSchema(desc = "Version ID of the object (versioning-enabled buckets). Omit for the current version") {
  return z.string().optional().describe(desc);
}
function positiveInt(what: string) {
  return z.number().int({ message: L({ ko: `${what}은(는) 정수여야 합니다.`, en: `${what} must be an integer.` }) })
    .positive({ message: L({ ko: `${what}은(는) 1 이상이어야 합니다.`, en: `${what} must be a positive integer (> 0).` }) });
}

// ─── 헤더 → 메타데이터 ───────────────────────────────────────────────────────

/**
 * 오브젝트 응답 헤더를 구조화한다. 없는 헤더는 `undefined`(직렬화 시 생략).
 *
 * `x-amz-storage-class`: S3 호환 서비스는 STANDARD 오브젝트에 이 헤더를 붙이지 않는다.
 * 없을 때는 STANDARD 로 해석하되 근거를 `storageClassHeader`로 남긴다.
 */
function objectMetaFromHeaders(headers: Headers) {
  const get = (h: string) => headers.get(h) ?? undefined;
  const storageClassHeader = get("x-amz-storage-class");
  return {
    contentLength: get("content-length"),
    contentType: get("content-type"),
    lastModified: get("last-modified"),
    etag: get("etag"),
    versionId: get("x-amz-version-id"),
    deleteMarker: get("x-amz-delete-marker"),
    storageClass: storageClassHeader ?? "STANDARD",
    storageClassHeader: storageClassHeader ?? "(absent — S3 omits this header for STANDARD)",
    restore: get("x-amz-restore"),
    serverSideEncryption: get("x-amz-server-side-encryption"),
    objectLockMode: get("x-amz-object-lock-mode"),
    objectLockRetainUntilDate: get("x-amz-object-lock-retain-until-date"),
    objectLockLegalHold: get("x-amz-object-lock-legal-hold"),
    checksumType: get("x-amz-checksum-type"),
  };
}

/** 소스 표기 정규화: 문서 형식은 `{bucket}/{object}`(`?versionId=` 선택). 앞 슬래시가 붙어 와도 받아준다. */
function normalizeCopySource(source: string, versionId?: string): string {
  let s = source.startsWith("/") ? source.slice(1) : source;
  if (versionId && !s.includes("?versionId=")) s += `?versionId=${encodeURIComponent(versionId)}`;
  return s;
}

// ─── XML 파서 ────────────────────────────────────────────────────────────────

function parseListBucketsXml(xml: string) {
  const owner = block(xml, "Owner");
  return {
    owner: owner ? { id: text(owner, "ID") ?? "", displayName: text(owner, "DisplayName") ?? "" } : undefined,
    prefix: text(xml, "Prefix"),
    continuationToken: text(xml, "ContinuationToken"),
    buckets: blocks(xml, "Bucket").map((b) => ({
      name: text(b, "Name") ?? "",
      creationDate: text(b, "CreationDate") ?? "",
    })),
  };
}

function parseListObjectsV2Xml(xml: string) {
  // <Contents> 블록을 먼저 잘라내고 필드는 개별로 뽑는다 — 요소 순서(ETag 가 Size 보다 앞)에 의존하지 않는다.
  const contents = blocks(xml, "Contents").map((item) => ({
    key: text(item, "Key") ?? "",
    lastModified: text(item, "LastModified") ?? "",
    size: intText(item, "Size") ?? 0,
    etag: text(item, "ETag") ?? "",
    storageClass: text(item, "StorageClass") ?? "",
  }));
  const commonPrefixes = blocks(xml, "CommonPrefixes").map((cp) => text(cp, "Prefix") ?? "");
  // 루트의 <Prefix> 는 CommonPrefixes 안의 <Prefix> 와 이름이 같다 — CommonPrefixes 를 제거한 뒤 읽는다.
  const rootOnly = xml.replace(/<CommonPrefixes>[\s\S]*?<\/CommonPrefixes>/g, "");
  return {
    name: text(rootOnly, "Name") ?? "",
    prefix: text(rootOnly, "Prefix") ?? "",
    startAfter: text(rootOnly, "StartAfter"),
    keyCount: intText(rootOnly, "KeyCount") ?? contents.length,
    maxKeys: intText(rootOnly, "MaxKeys") ?? 1000,
    isTruncated: boolText(rootOnly, "IsTruncated") ?? false,
    nextContinuationToken: text(rootOnly, "NextContinuationToken"),
    contents,
    commonPrefixes,
  };
}

function parseListObjectVersionsXml(xml: string) {
  const rootOnly = xml.replace(/<Version>[\s\S]*?<\/Version>|<DeleteMarker>[\s\S]*?<\/DeleteMarker>|<CommonPrefixes>[\s\S]*?<\/CommonPrefixes>/g, "");
  return {
    name: text(rootOnly, "Name") ?? "",
    prefix: text(rootOnly, "Prefix") ?? "",
    keyMarker: text(rootOnly, "KeyMarker"),
    versionIdMarker: text(rootOnly, "VersionIdMarker"),
    nextKeyMarker: text(rootOnly, "NextKeyMarker"),
    nextVersionIdMarker: text(rootOnly, "NextVersionIdMarker"),
    maxKeys: intText(rootOnly, "MaxKeys"),
    isTruncated: boolText(rootOnly, "IsTruncated") ?? false,
    versions: blocks(xml, "Version").map((v) => ({
      key: text(v, "Key") ?? "",
      versionId: text(v, "VersionId") ?? "",
      isLatest: boolText(v, "IsLatest") ?? false,
      lastModified: text(v, "LastModified") ?? "",
      etag: text(v, "ETag") ?? "",
      size: intText(v, "Size") ?? 0,
      storageClass: text(v, "StorageClass") ?? "",
      checksumAlgorithm: text(v, "ChecksumAlgorithm"),
      checksumType: text(v, "ChecksumType"),
    })),
    deleteMarkers: blocks(xml, "DeleteMarker").map((d) => ({
      key: text(d, "Key") ?? "",
      versionId: text(d, "VersionId") ?? "",
      isLatest: boolText(d, "IsLatest") ?? false,
      lastModified: text(d, "LastModified") ?? "",
    })),
    commonPrefixes: blocks(xml, "CommonPrefixes").map((cp) => text(cp, "Prefix") ?? ""),
  };
}

function parseCorsConfigXml(xml: string) {
  return {
    corsRules: blocks(xml, "CORSRule").map((rule) => ({
      id: text(rule, "ID"),
      allowedOrigins: texts(rule, "AllowedOrigin"),
      allowedMethods: texts(rule, "AllowedMethod"),
      allowedHeaders: texts(rule, "AllowedHeader"),
      exposeHeaders: texts(rule, "ExposeHeader"),
      maxAgeSeconds: intText(rule, "MaxAgeSeconds"),
    })),
  };
}

function buildCorsConfigXml(corsRules: Array<{
  id?: string;
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders?: string[];
  exposeHeaders?: string[];
  maxAgeSeconds?: number;
}>): string {
  const rulesXml = corsRules.map((rule) => {
    let c = tag("ID", rule.id);
    for (const o of rule.allowedOrigins) c += tag("AllowedOrigin", o);
    for (const m of rule.allowedMethods) c += tag("AllowedMethod", m);
    for (const h of rule.allowedHeaders ?? []) c += tag("AllowedHeader", h);
    for (const h of rule.exposeHeaders ?? []) c += tag("ExposeHeader", h);
    c += tag("MaxAgeSeconds", rule.maxAgeSeconds);
    return wrap("CORSRule", c);
  }).join("");
  return xmlDocument("CORSConfiguration", rulesXml);
}

// ─── 라이프사이클 ─────────────────────────────────────────────────────────────

/**
 * 라이프사이클 규칙 — PutBucketLifecycleConfiguration 스펙의 요소와 1:1.
 *
 *   Rule.ID(≤255) / Status / Filter.Prefix / Expiration{Days|Date} / Transition{Days|Date, StorageClass}
 *   / NoncurrentVersionExpiration{NoncurrentDays, NewerNoncurrentVersions≤100}
 *   / NoncurrentVersionTransition{NoncurrentDays, NewerNoncurrentVersions≤100, StorageClass}
 *
 * `AbortIncompleteMultipartUpload` 는 Ncloud Storage 스펙 페이지에 **없다**(S3 표준 요소).
 * 이전 버전이 노출하던 파라미터라 유지하되 설명에 미문서화임을 밝힌다.
 */
interface LifecycleRule {
  id: string;
  status?: "Enabled" | "Disabled";
  prefix?: string;
  transitions?: Array<{ days?: number; date?: string; storageClass: string }>;
  expiration?: { days?: number; date?: string };
  noncurrentVersionTransitions?: Array<{ noncurrentDays?: number; newerNoncurrentVersions?: number; storageClass: string }>;
  noncurrentVersionExpiration?: { noncurrentDays?: number; newerNoncurrentVersions?: number };
  abortIncompleteMultipartUploadDays?: number;
}

const transitionSchema = z.object({
  days: positiveInt("days").optional().describe("Days after object creation to transition (positive integer). Give exactly one of days / date"),
  date: z.string().optional().describe("Date to transition, ISO 8601 (e.g. 2027-01-01T00:00:00Z). Give exactly one of days / date"),
  storageClass: z.enum(TRANSITION_STORAGE_CLASSES).describe("Target storage class — ONEZONE_IA (One Zone-IA) | DEEP_ARCHIVE (Archive). Ncloud Storage has no STANDARD_IA/GLACIER; those AWS names are rejected"),
});

const lifecycleRuleSchema = z.object({
  id: z.string().min(1).max(255, { message: L({ ko: "규칙 ID 는 255자 이하여야 합니다.", en: "Rule ID must be 255 characters or fewer." }) })
    .describe("Unique rule identifier (≤ 255 chars). In merge mode a rule with the same id replaces the existing one"),
  status: z.enum(["Enabled", "Disabled"]).optional().default("Enabled").describe("Enabled (default) | Disabled"),
  prefix: z.string().optional().default("").describe("Filter.Prefix — object key prefix the rule applies to; empty string (default) = all objects"),
  transitions: z.array(transitionSchema).optional().describe("Transition rules for the current version (Transition elements)"),
  expiration: z.object({
    days: positiveInt("days").optional().describe("Days after creation to delete (positive integer). Give exactly one of days / date"),
    date: z.string().optional().describe("Date to delete, ISO 8601. Give exactly one of days / date"),
  }).optional().describe("Expiration of the current version"),
  noncurrentVersionTransitions: z.array(z.object({
    noncurrentDays: positiveInt("noncurrentDays").optional().describe("Days after becoming noncurrent to transition"),
    newerNoncurrentVersions: z.number().int().min(1).max(100).optional().describe("Keep this many newer noncurrent versions untouched (≤ 100)"),
    storageClass: z.enum(TRANSITION_STORAGE_CLASSES).describe("ONEZONE_IA | DEEP_ARCHIVE"),
  })).optional().describe("NoncurrentVersionTransition rules — previous versions in a versioning-enabled bucket"),
  noncurrentVersionExpiration: z.object({
    noncurrentDays: positiveInt("noncurrentDays").optional().describe("Days after becoming noncurrent to delete"),
    newerNoncurrentVersions: z.number().int().min(1).max(100).optional().describe("Keep this many newer noncurrent versions (≤ 100)"),
  }).optional().describe("NoncurrentVersionExpiration — delete previous versions in a versioning-enabled bucket"),
  abortIncompleteMultipartUploadDays: positiveInt("abortIncompleteMultipartUploadDays").optional()
    .describe("AbortIncompleteMultipartUpload.DaysAfterInitiation. ⚠️ Not listed in the Ncloud Storage PutBucketLifecycleConfiguration spec (S3 standard element) — the API may reject it with MalformedXML; use ncloud_ncs_list_multipart_uploads / abort_multipart_upload instead if so"),
});

type LifecycleRuleInput = z.infer<typeof lifecycleRuleSchema>;

/** 스키마로 표현하기 어려운 조합 규칙. 위반 시 메시지(ko/en), 정상이면 null. */
function validateLifecycleRule(rule: LifecycleRuleInput, index: number): string | null {
  const where = (what: string) => L({ ko: `rules[${index}] (id '${rule.id}') ${what}`, en: `rules[${index}] (id '${rule.id}') ${what}` });
  const exactlyOne = (o: { days?: number; date?: string } | undefined, label: string) => {
    if (!o) return null;
    const n = (o.days !== undefined ? 1 : 0) + (o.date ? 1 : 0);
    if (n !== 1) return where(L({ ko: `${label}: days 와 date 중 정확히 하나만 지정해야 합니다.`, en: `${label}: give exactly one of days / date.` }));
    return null;
  };
  let err = exactlyOne(rule.expiration, "expiration");
  if (err) return err;
  for (const t of rule.transitions ?? []) {
    err = exactlyOne(t, "transitions[]");
    if (err) return err;
  }
  for (const t of rule.noncurrentVersionTransitions ?? []) {
    if (t.noncurrentDays === undefined) {
      return where(L({ ko: "noncurrentVersionTransitions[]: noncurrentDays 가 필요합니다.", en: "noncurrentVersionTransitions[]: noncurrentDays is required." }));
    }
  }
  if (rule.noncurrentVersionExpiration
    && rule.noncurrentVersionExpiration.noncurrentDays === undefined
    && rule.noncurrentVersionExpiration.newerNoncurrentVersions === undefined) {
    return where(L({ ko: "noncurrentVersionExpiration: noncurrentDays 또는 newerNoncurrentVersions 중 하나는 필요합니다.", en: "noncurrentVersionExpiration: noncurrentDays or newerNoncurrentVersions is required." }));
  }
  const hasAction = (rule.transitions?.length ?? 0) > 0
    || rule.expiration !== undefined
    || (rule.noncurrentVersionTransitions?.length ?? 0) > 0
    || rule.noncurrentVersionExpiration !== undefined
    || rule.abortIncompleteMultipartUploadDays !== undefined;
  if (!hasAction) {
    return where(L({ ko: "동작이 없습니다 — transitions / expiration / noncurrentVersion* 중 하나 이상을 지정하세요.", en: "has no action — specify at least one of transitions / expiration / noncurrentVersion*." }));
  }
  return null;
}

function buildLifecycleConfigXml(rules: LifecycleRule[]): string {
  const rulesXml = rules.map((rule) => {
    let c = tag("ID", rule.id) + tag("Status", rule.status ?? "Enabled");
    // Filter 는 항상 보낸다. 전체 대상이면 <Filter><Prefix></Prefix></Filter>.
    c += `<Filter>${tag("Prefix", rule.prefix ?? "")}</Filter>`;
    for (const t of rule.transitions ?? []) {
      c += wrap("Transition", tag("Days", t.days) + tag("Date", t.date) + tag("StorageClass", t.storageClass));
    }
    if (rule.expiration) {
      c += wrap("Expiration", tag("Days", rule.expiration.days) + tag("Date", rule.expiration.date));
    }
    for (const t of rule.noncurrentVersionTransitions ?? []) {
      c += wrap("NoncurrentVersionTransition",
        tag("NoncurrentDays", t.noncurrentDays) + tag("NewerNoncurrentVersions", t.newerNoncurrentVersions) + tag("StorageClass", t.storageClass));
    }
    if (rule.noncurrentVersionExpiration) {
      c += wrap("NoncurrentVersionExpiration",
        tag("NoncurrentDays", rule.noncurrentVersionExpiration.noncurrentDays) + tag("NewerNoncurrentVersions", rule.noncurrentVersionExpiration.newerNoncurrentVersions));
    }
    if (rule.abortIncompleteMultipartUploadDays !== undefined) {
      c += wrap("AbortIncompleteMultipartUpload", tag("DaysAfterInitiation", rule.abortIncompleteMultipartUploadDays));
    }
    return wrap("Rule", c);
  }).join("");
  return xmlDocument("LifecycleConfiguration", rulesXml);
}

/** 응답 XML → 입력 스키마와 같은 형태(merge 에 그대로 재사용). */
function parseLifecycleConfigXml(xml: string): { rules: LifecycleRule[] } {
  const rules = blocks(xml, "Rule").map((ruleXml) => {
    const filter = block(ruleXml, "Filter");
    const rule: LifecycleRule = {
      id: text(ruleXml, "ID") ?? "",
      status: (text(ruleXml, "Status") as "Enabled" | "Disabled" | undefined) ?? "Disabled",
      // Filter.Prefix 우선, 없으면 (구형 표기) Rule.Prefix
      prefix: (filter !== undefined ? text(filter, "Prefix") : undefined) ?? text(ruleXml, "Prefix") ?? "",
    };
    const transitions = blocks(ruleXml, "Transition").map((t) => ({
      days: intText(t, "Days"),
      date: text(t, "Date"),
      storageClass: text(t, "StorageClass") ?? "",
    }));
    if (transitions.length) rule.transitions = transitions;
    const exp = block(ruleXml, "Expiration");
    if (exp !== undefined) rule.expiration = { days: intText(exp, "Days"), date: text(exp, "Date") };
    const nvt = blocks(ruleXml, "NoncurrentVersionTransition").map((t) => ({
      noncurrentDays: intText(t, "NoncurrentDays"),
      newerNoncurrentVersions: intText(t, "NewerNoncurrentVersions"),
      storageClass: text(t, "StorageClass") ?? "",
    }));
    if (nvt.length) rule.noncurrentVersionTransitions = nvt;
    const nve = block(ruleXml, "NoncurrentVersionExpiration");
    if (nve !== undefined) {
      rule.noncurrentVersionExpiration = { noncurrentDays: intText(nve, "NoncurrentDays"), newerNoncurrentVersions: intText(nve, "NewerNoncurrentVersions") };
    }
    const abort = block(ruleXml, "AbortIncompleteMultipartUpload");
    if (abort !== undefined) rule.abortIncompleteMultipartUploadDays = intText(abort, "DaysAfterInitiation");
    return rule;
  });
  return { rules };
}

/** 사람이 읽는 규칙 요약(응답용). */
function summarizeLifecycleRule(rule: LifecycleRule) {
  const actions: string[] = [];
  for (const t of rule.transitions ?? []) actions.push(`transition → ${t.storageClass} after ${t.days !== undefined ? `${t.days} days` : t.date}`);
  if (rule.expiration) actions.push(`expire after ${rule.expiration.days !== undefined ? `${rule.expiration.days} days` : rule.expiration.date}`);
  for (const t of rule.noncurrentVersionTransitions ?? []) actions.push(`noncurrent → ${t.storageClass} after ${t.noncurrentDays} days${t.newerNoncurrentVersions ? ` (keep ${t.newerNoncurrentVersions} newer)` : ""}`);
  if (rule.noncurrentVersionExpiration) {
    const e = rule.noncurrentVersionExpiration;
    actions.push(`noncurrent expire${e.noncurrentDays !== undefined ? ` after ${e.noncurrentDays} days` : ""}${e.newerNoncurrentVersions ? ` (keep ${e.newerNoncurrentVersions} newer)` : ""}`);
  }
  if (rule.abortIncompleteMultipartUploadDays !== undefined) actions.push(`abort incomplete multipart after ${rule.abortIncompleteMultipartUploadDays} days`);
  return { id: rule.id, status: rule.status ?? "Enabled", prefix: rule.prefix || "(all objects)", actions };
}

/**
 * 현재 라이프사이클 설정. 미설정(`NoSuchLifecycleConfiguration`)은 빈 배열로 정규화한다 —
 * "설정이 없다"는 정상 상태인데 에러로 던지면 모델이 실패로 오판한다.
 */
async function fetchLifecycle(client: S3CompatibleClient, bucket: string): Promise<{ configured: boolean; rules: LifecycleRule[] }> {
  try {
    const response = await client.request({ method: "GET", bucket, queryParams: { lifecycle: "" } });
    return { configured: true, ...parseLifecycleConfigXml(response.body) };
  } catch (error) {
    if (error instanceof S3CompatibleError && error.code === "NoSuchLifecycleConfiguration") {
      return { configured: false, rules: [] };
    }
    throw error;
  }
}

// ─── 기타 파서 ────────────────────────────────────────────────────────────────

function parseEncryptionConfigXml(xml: string) {
  return {
    rules: blocks(xml, "Rule").map((rule) => ({
      applyServerSideEncryptionByDefault: {
        sseAlgorithm: text(rule, "SSEAlgorithm") ?? "",
        kmsMasterKeyId: text(rule, "KMSMasterKeyID"),
      },
      bucketKeyEnabled: boolText(rule, "BucketKeyEnabled"),
    })),
  };
}

function parseObjectLockConfigXml(xml: string) {
  const retention = block(xml, "DefaultRetention");
  return {
    objectLockEnabled: text(xml, "ObjectLockEnabled") ?? "",
    defaultRetention: retention !== undefined
      ? { mode: text(retention, "Mode") ?? "", days: intText(retention, "Days"), years: intText(retention, "Years") }
      : undefined,
  };
}

function parseDeleteResultXml(xml: string) {
  return {
    deleted: blocks(xml, "Deleted").map((d) => ({
      key: text(d, "Key") ?? "",
      versionId: text(d, "VersionId"),
      deleteMarker: boolText(d, "DeleteMarker"),
      deleteMarkerVersionId: text(d, "DeleteMarkerVersionId"),
    })),
    errors: blocks(xml, "Error").map((e) => ({
      key: text(e, "Key") ?? "",
      versionId: text(e, "VersionId"),
      code: text(e, "Code") ?? "",
      message: text(e, "Message") ?? "",
    })),
  };
}

function parseObjectAttributesXml(xml: string) {
  const checksum = block(xml, "Checksum");
  const parts = block(xml, "ObjectParts");
  return {
    etag: text(xml, "ETag"),
    objectSize: intText(xml, "ObjectSize"),
    storageClass: text(xml, "StorageClass"),
    checksum: checksum !== undefined
      ? {
          crc32: text(checksum, "ChecksumCRC32"),
          crc32c: text(checksum, "ChecksumCRC32C"),
          sha1: text(checksum, "ChecksumSHA1"),
          sha256: text(checksum, "ChecksumSHA256"),
          crc64nvme: text(checksum, "ChecksumCRC64NVME"),
          checksumType: text(checksum, "ChecksumType"),
        }
      : undefined,
    objectParts: parts !== undefined
      ? {
          isTruncated: boolText(parts, "IsTruncated") ?? false,
          maxParts: intText(parts, "MaxParts"),
          partNumberMarker: intText(parts, "PartNumberMarker"),
          nextPartNumberMarker: intText(parts, "NextPartNumberMarker"),
          partsCount: intText(parts, "PartsCount"),
          parts: blocks(parts, "Part").map((p) => ({ partNumber: intText(p, "PartNumber") ?? 0, size: intText(p, "Size") ?? 0 })),
        }
      : undefined,
  };
}

// ═════════════════════════════════════════════════════════════════════════════

export function registerStorageNcloudTools(server: McpServer, client: S3CompatibleClient): void {
  // ═══ Bucket ═════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_ncs_list_buckets",
    `${NCS} List Ncloud Storage buckets (GET / on kr.ncloudstorage.com). Ncloud Storage is the newer S3-compatible object storage at {bucket}.kr.ncloudstorage.com (KR only) and is a separate service from the legacy Object Storage (kr.object.ncloudstorage.com) with its own bucket namespace — for Object Storage buckets use ncloud_list_buckets and the other ncloud_* tools without the ncs_ prefix.`,
    {
      prefix: z.string().optional().describe("Only buckets whose name starts with this prefix"),
      maxBuckets: z.number().int().min(1).max(10000).optional().describe("Buckets per page (1–10,000)"),
      continuationToken: z.string().optional().describe("Pagination: continuationToken from the previous response"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.prefix) queryParams["prefix"] = params.prefix;
      if (params.maxBuckets !== undefined) queryParams["max-buckets"] = String(params.maxBuckets);
      if (params.continuationToken) queryParams["continuation-token"] = params.continuationToken;
      const response = await client.request({ method: "GET", queryParams: Object.keys(queryParams).length ? queryParams : undefined });
      return { service: "Ncloud Storage", region: client.getServiceRegion(), ...parseListBucketsXml(response.body) };
    }
  );

  defineTool(
    server,
    "ncloud_ncs_create_bucket",
    `${NCS} Create a Ncloud Storage bucket (PUT / on {bucket}.kr.ncloudstorage.com). Bucket names: 3–63 chars, lowercase letters/digits/hyphens, start and end alphanumeric, no dots. Optionally enable Object Lock at creation (this also turns on versioning). Use dryRun=true to preview.`,
    {
      bucketName: bucketNameSchema("Name of the bucket to create").regex(BUCKET_NAME_RE, {
        message: L({ ko: "버킷 이름은 3~63자의 소문자·숫자·하이픈이며 영숫자로 시작하고 끝나야 합니다(점 불가).", en: "Bucket name must be 3–63 chars of lowercase letters, digits and hyphens, starting and ending alphanumeric (no dots)." }),
      }),
      objectLockEnabled: z.boolean().optional().default(false).describe("Send x-amz-bucket-object-lock-enabled: true — enables Object Lock (WORM) and versioning on the new bucket. Cannot be enabled later on an existing bucket through this header"),
      dryRun: z.boolean().optional().default(true).describe("If true (default), returns a preview without actually creating the bucket"),
    },
    async (params) => {
      const headers: Record<string, string> = {};
      if (params.objectLockEnabled) headers["x-amz-bucket-object-lock-enabled"] = "true";
      const endpoint = `https://${params.bucketName}.kr.ncloudstorage.com/`;
      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Ncloud Storage Bucket Creation",
          endpoint,
          method: "PUT",
          requestParams: { bucket: params.bucketName, headers },
          noun: { ko: "버킷", en: "bucket" },
          notes: { region: client.getServiceRegion(), objectLockEnabled: params.objectLockEnabled },
        });
      }
      await client.request({ method: "PUT", bucket: params.bucketName, headers });
      return {
        리소스타입: "Ncloud Storage Bucket",
        리소스명: params.bucketName,
        리전: client.getServiceRegion(),
        endpoint,
        objectLockEnabled: params.objectLockEnabled,
        상태: "created",
      };
    }
  );

  defineTool(
    server,
    "ncloud_ncs_delete_bucket",
    `${NCS} ⚠️ Destructive: Permanently delete a Ncloud Storage bucket (DELETE /). The bucket must be empty (all object versions and delete markers removed, no in-progress multipart uploads). Set confirm=true to execute.`,
    {
      bucketName: bucketNameSchema("Name of the bucket to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      await client.request({ method: "DELETE", bucket: params.bucketName });
      return { message: deletedMessage({ ko: `Ncloud Storage 버킷 '${params.bucketName}'`, en: `Ncloud Storage bucket '${params.bucketName}'` }) };
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Ncloud Storage Bucket [${params.bucketName}]. The bucket must be empty. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_ncs_head_bucket",
    `${NCS} Check whether a Ncloud Storage bucket exists and is accessible (HEAD /). exists=false on 404. A NoSuchBucket here may mean the bucket lives in the legacy Object Storage instead — try ncloud_head_bucket.`,
    {
      bucketName: bucketNameSchema("Name of the bucket to check"),
    },
    async (params) => {
      try {
        const response = await client.request({ method: "HEAD", bucket: params.bucketName });
        return {
          service: "Ncloud Storage",
          bucket: params.bucketName,
          exists: true,
          statusCode: response.status,
          region: response.headers.get("x-amz-bucket-region") ?? client.getServiceRegion(),
        };
      } catch (error) {
        if (error instanceof S3CompatibleError && error.status === 404) {
          return {
            service: "Ncloud Storage",
            bucket: params.bucketName,
            exists: false,
            statusCode: 404,
            hint: L({
              ko: "Ncloud Storage 에 이 버킷이 없습니다. 레거시 Object Storage 의 버킷이면 ncloud_head_bucket / ncloud_list_buckets 를 사용하세요.",
              en: "Not found in Ncloud Storage. If this is a legacy Object Storage bucket, use ncloud_head_bucket / ncloud_list_buckets instead.",
            }),
          };
        }
        throw error;
      }
    }
  );

  defineTool(
    server,
    "ncloud_ncs_get_bucket_location",
    `${NCS} Get the region of a Ncloud Storage bucket (GET /?location). Returns the LocationConstraint (e.g. 'kr').`,
    { bucketName: bucketNameSchema() },
    async (params) => {
      const response = await client.request({ method: "GET", bucket: params.bucketName, queryParams: { location: "" } });
      return { bucket: params.bucketName, locationConstraint: text(response.body, "LocationConstraint") ?? "" };
    }
  );

  // ─── Versioning ────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_get_bucket_versioning",
    `${NCS} Get the versioning state of a Ncloud Storage bucket (GET /?versioning). status is Enabled | Suspended | NotConfigured (the API returns an empty body when versioning was never enabled).`,
    { bucketName: bucketNameSchema() },
    async (params) => {
      const response = await client.request({ method: "GET", bucket: params.bucketName, queryParams: { versioning: "" } });
      const status = text(response.body, "Status") ?? "NotConfigured";
      return { bucket: params.bucketName, status, versioningEnabled: status === "Enabled" };
    }
  );

  defineTool(
    server,
    "ncloud_ncs_put_bucket_versioning",
    `${NCS} Set the versioning state of a Ncloud Storage bucket (PUT /?versioning). Enabled keeps every version of every object; Suspended stops creating new versions but keeps existing ones. Once enabled, versioning cannot be turned back to NotConfigured — only Suspended.`,
    {
      bucketName: bucketNameSchema(),
      status: z.enum(["Enabled", "Suspended"], { required_error: requiredError("status") }).describe("Enabled | Suspended"),
    },
    async (params) => {
      const body = xmlDocument("VersioningConfiguration", tag("Status", params.status));
      await client.request({
        method: "PUT",
        bucket: params.bucketName,
        queryParams: { versioning: "" },
        headers: { "content-type": "application/xml" },
        body,
      });
      return {
        message: L({ ko: `✅ 버킷 '${params.bucketName}'의 버전 관리가 '${params.status}'로 설정되었습니다.`, en: `✅ Versioning for bucket '${params.bucketName}' has been set to '${params.status}'.` }),
        bucket: params.bucketName,
        status: params.status,
      };
    }
  );

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_get_bucket_lifecycle",
    `${NCS} Get the lifecycle configuration of a Ncloud Storage bucket (GET /?lifecycle): transitions to ONEZONE_IA / DEEP_ARCHIVE, expiration, and noncurrent-version rules. Returns configured=false with an empty rule list when no configuration exists (instead of a NoSuchLifecycleConfiguration error).`,
    { bucketName: bucketNameSchema("Name of the bucket to retrieve lifecycle configuration for") },
    async (params) => {
      const current = await fetchLifecycle(client, params.bucketName);
      return {
        bucket: params.bucketName,
        configured: current.configured,
        ruleCount: current.rules.length,
        rules: current.rules,
        summary: current.rules.map(summarizeLifecycleRule),
      };
    }
  );

  defineTool(
    server,
    "ncloud_ncs_put_bucket_lifecycle",
    `${NCS} Set lifecycle rules on a Ncloud Storage bucket (PUT /?lifecycle). Supports current-version transitions (ONEZONE_IA | DEEP_ARCHIVE) and expiration by days or date, plus NoncurrentVersionTransition / NoncurrentVersionExpiration for versioning-enabled buckets. ⚠️ The API replaces the ENTIRE configuration on every call — a rule left out disappears. Default mergeWithExisting=false replaces (the response lists the rules that were removed); mergeWithExisting=true reads the current rules first and keeps those whose id you did not resend. Use dryRun=true to preview the exact XML.`,
    {
      bucketName: bucketNameSchema("Name of the bucket to set lifecycle configuration for"),
      rules: z.array(lifecycleRuleSchema)
        .min(1, { message: L({ ko: "최소 1개 이상의 라이프사이클 규칙이 필요합니다.", en: "At least one lifecycle rule is required." }) })
        .max(1000, { message: L({ ko: "라이프사이클 규칙은 최대 1,000개입니다.", en: "At most 1,000 lifecycle rules are allowed." }) })
        .describe("Lifecycle rules to apply"),
      mergeWithExisting: z.boolean().optional().default(false).describe("true: keep existing rules whose id is not in `rules` (same-id rules are replaced). false (default): the configuration becomes exactly `rules`"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns the XML that would be sent and what would change, without applying"),
    },
    async (params) => {
      for (let i = 0; i < params.rules.length; i++) {
        const err = validateLifecycleRule(params.rules[i], i);
        if (err) return { content: [{ type: "text" as const, text: `❌ ${err}` }], isError: true };
      }
      const ids = params.rules.map((r) => r.id);
      const dup = ids.find((id, i) => ids.indexOf(id) !== i);
      if (dup) {
        return { content: [{ type: "text" as const, text: `❌ ${L({ ko: `규칙 ID '${dup}'가 중복됩니다.`, en: `Duplicate rule id '${dup}'.` })}` }], isError: true };
      }

      // 기존 설정 조회(best effort). 실패해도 replace 모드는 진행할 수 있지만, merge 모드는 기존 규칙이
      // 필요하므로 그대로 던진다.
      let existing: LifecycleRule[] | undefined;
      let existingReadError: string | undefined;
      try {
        existing = (await fetchLifecycle(client, params.bucketName)).rules;
      } catch (error: any) {
        if (params.mergeWithExisting) throw error;
        existingReadError = error?.message ?? String(error);
      }

      const newIds = new Set(ids);
      const kept = params.mergeWithExisting ? (existing ?? []).filter((r) => !newIds.has(r.id)) : [];
      const finalRules: LifecycleRule[] = [...kept, ...params.rules];
      const removed = (existing ?? []).filter((r) => !newIds.has(r.id) && !params.mergeWithExisting).map((r) => r.id);
      const replaced = (existing ?? []).filter((r) => newIds.has(r.id)).map((r) => r.id);

      if (finalRules.length > 1000) {
        return { content: [{ type: "text" as const, text: `❌ ${L({ ko: `병합 결과 규칙이 ${finalRules.length}개로 최대 1,000개를 넘습니다.`, en: `Merged configuration has ${finalRules.length} rules, over the 1,000 limit.` })}` }], isError: true };
      }

      const xmlBody = buildLifecycleConfigXml(finalRules);
      const change = {
        mode: params.mergeWithExisting ? "merge" : "replace",
        existingRuleIds: existing?.map((r) => r.id) ?? (existingReadError ? "(could not read: " + existingReadError.split("\n")[0] + ")" : []),
        rulesReplacedById: replaced,
        rulesRemoved: removed,
        rulesKeptFromExisting: kept.map((r) => r.id),
        resultingRuleCount: finalRules.length,
      };

      if (params.dryRun) {
        // 실제로 보내는 것은 XML 본문이다 — 입력 규칙 배열을 다시 찍으면 직렬화 단계의 결함을 프리뷰가 가린다.
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Ncloud Storage Bucket Lifecycle Configuration",
          endpoint: `https://${params.bucketName}.kr.ncloudstorage.com/?lifecycle`,
          method: "PUT",
          requestParams: {
            bucket: params.bucketName,
            queryParams: { lifecycle: "" },
            headers: { "content-type": "application/xml", "content-md5": "(auto)" },
            body: xmlBody,
          },
          noun: { ko: "라이프사이클 규칙", en: "lifecycle rule" },
          verb: "apply",
          notes: { change, resultingRules: finalRules.map(summarizeLifecycleRule) },
        });
      }

      await client.request({
        method: "PUT",
        bucket: params.bucketName,
        queryParams: { lifecycle: "" },
        headers: { "content-type": "application/xml" },
        body: xmlBody,
      });

      return {
        message: L({ ko: `✅ 버킷 '${params.bucketName}'의 라이프사이클 규칙이 설정되었습니다(${finalRules.length}개).`, en: `✅ Lifecycle rules for bucket '${params.bucketName}' have been set (${finalRules.length} rule(s)).` }),
        bucket: params.bucketName,
        change,
        ...(removed.length
          ? { warning: L({ ko: `기존 규칙 ${removed.length}개가 제거되었습니다: ${removed.join(", ")}. 유지하려면 mergeWithExisting=true 로 다시 적용하세요.`, en: `${removed.length} existing rule(s) were removed: ${removed.join(", ")}. Re-apply with mergeWithExisting=true to keep them.` }) }
          : {}),
        rules: finalRules.map(summarizeLifecycleRule),
      };
    }
  );

  defineTool(
    server,
    "ncloud_ncs_delete_bucket_lifecycle",
    `${NCS} ⚠️ Destructive: Delete ALL lifecycle rules from a Ncloud Storage bucket (DELETE /?lifecycle). Deletions or transitions already queued by the rules are not cancelled. Set confirm=true to execute.`,
    {
      bucketName: bucketNameSchema("Name of the bucket to delete lifecycle configuration from"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      await client.request({ method: "DELETE", bucket: params.bucketName, queryParams: { lifecycle: "" } });
      return { message: deletedMessage({ ko: `버킷 '${params.bucketName}'의 라이프사이클 규칙`, en: `the lifecycle rules of bucket '${params.bucketName}'` }) };
    },
    { destructive: { noun: "all lifecycle rules from Ncloud Storage Bucket", describe: (params) => params.bucketName } }
  );

  // ─── CORS ──────────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_get_bucket_cors",
    `${NCS} Get the CORS configuration of a Ncloud Storage bucket (GET /?cors).`,
    { bucketName: bucketNameSchema("Name of the bucket to retrieve CORS configuration for") },
    async (params) => {
      try {
        const response = await client.request({ method: "GET", bucket: params.bucketName, queryParams: { cors: "" } });
        return { bucket: params.bucketName, configured: true, ...parseCorsConfigXml(response.body) };
      } catch (error) {
        if (error instanceof S3CompatibleError && error.code === "NoSuchCORSConfiguration") {
          return { bucket: params.bucketName, configured: false, corsRules: [] };
        }
        throw error;
      }
    }
  );

  defineTool(
    server,
    "ncloud_ncs_put_bucket_cors",
    `${NCS} Set the CORS configuration of a Ncloud Storage bucket (PUT /?cors). Replaces the whole configuration. Up to 100 rules; each needs at least one AllowedOrigin and one AllowedMethod; one '*' wildcard per origin/header item; ExposeHeader does not allow wildcards.`,
    {
      bucketName: bucketNameSchema("Name of the bucket to set CORS configuration for"),
      corsRules: z.array(z.object({
        id: z.string().max(255).optional().describe("Optional rule ID (≤ 255 chars, unique). Auto-generated when omitted"),
        allowedOrigins: z.array(z.string()).min(1, {
          message: L({ ko: "최소 1개 이상의 allowedOrigins가 필요합니다.", en: "At least one allowedOrigins entry is required." }),
        }).describe("Origins allowed to make cross-origin requests (e.g. 'https://example.com' or '*')"),
        allowedMethods: z.array(z.enum(["GET", "PUT", "POST", "DELETE", "HEAD"])).min(1, {
          message: L({ ko: "최소 1개 이상의 allowedMethods가 필요합니다.", en: "At least one allowedMethods entry is required." }),
        }).describe("HTTP methods allowed for cross-origin requests"),
        allowedHeaders: z.array(z.string()).optional().describe("Headers allowed in preflight requests (e.g. 'Content-Type', 'Authorization', '*')"),
        exposeHeaders: z.array(z.string()).optional().describe("Response headers exposed to the browser (e.g. 'ETag', 'x-amz-request-id'); no wildcard"),
        maxAgeSeconds: z.number().int().nonnegative().optional().describe("Seconds the browser may cache the preflight response (e.g. 3600)"),
      })).min(1, {
        message: L({ ko: "최소 1개 이상의 CORS 규칙이 필요합니다.", en: "At least one CORS rule is required." }),
      }).max(100, {
        message: L({ ko: "CORS 규칙은 최대 100개입니다.", en: "At most 100 CORS rules are allowed." }),
      }).describe("CORS rules to apply to the bucket"),
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
      return {
        message: L({ ko: `✅ 버킷 '${params.bucketName}'의 CORS 설정이 적용되었습니다.`, en: `✅ The CORS configuration for bucket '${params.bucketName}' has been applied.` }),
        bucket: params.bucketName,
        rulesApplied: params.corsRules.length,
        rules: params.corsRules.map((rule, index) => ({
          ruleIndex: index + 1,
          id: rule.id,
          allowedOrigins: rule.allowedOrigins,
          allowedMethods: rule.allowedMethods,
          allowedHeaders: rule.allowedHeaders ?? [],
          exposeHeaders: rule.exposeHeaders ?? [],
          maxAgeSeconds: rule.maxAgeSeconds,
        })),
      };
    }
  );

  defineTool(
    server,
    "ncloud_ncs_delete_bucket_cors",
    `${NCS} ⚠️ Destructive: Delete the CORS configuration of a Ncloud Storage bucket (DELETE /?cors), removing all cross-origin access rules. Set confirm=true to execute.`,
    {
      bucketName: bucketNameSchema("Name of the bucket to delete CORS configuration from"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      await client.request({ method: "DELETE", bucket: params.bucketName, queryParams: { cors: "" } });
      return { message: deletedMessage({ ko: `버킷 '${params.bucketName}'의 CORS 설정`, en: `the CORS configuration of bucket '${params.bucketName}'` }) };
    },
    { destructive: { noun: "all CORS rules from Ncloud Storage Bucket", describe: (params) => params.bucketName } }
  );

  // ─── Encryption ────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_get_bucket_encryption",
    `${NCS} Get the default server-side encryption configuration of a Ncloud Storage bucket (GET /?encryption).`,
    { bucketName: bucketNameSchema("Name of the bucket to retrieve encryption configuration for") },
    async (params) => {
      try {
        const response = await client.request({ method: "GET", bucket: params.bucketName, queryParams: { encryption: "" } });
        return { bucket: params.bucketName, configured: true, ...parseEncryptionConfigXml(response.body) };
      } catch (error) {
        if (error instanceof S3CompatibleError && error.code === "ServerSideEncryptionConfigurationNotFoundError") {
          return { bucket: params.bucketName, configured: false, rules: [] };
        }
        throw error;
      }
    }
  );

  defineTool(
    server,
    "ncloud_ncs_put_bucket_encryption",
    `${NCS} Set default server-side encryption for a Ncloud Storage bucket (PUT /?encryption). Exactly one rule: AES256 (SSE-S3) or aws:kms (Ncloud-managed KMS key; customer-managed keys and aws:kms:dsse are not supported yet). New objects are encrypted with it by default.`,
    {
      bucketName: bucketNameSchema("Name of the bucket to set encryption configuration for"),
      sseAlgorithm: z.enum(SSE_ALGORITHMS, { required_error: requiredError("sseAlgorithm") }).describe("AES256 (SSE-S3) | aws:kms (SSE-KMS, Ncloud-managed key)"),
    },
    async (params) => {
      const xmlBody = xmlDocument("ServerSideEncryptionConfiguration",
        wrap("Rule", wrap("ApplyServerSideEncryptionByDefault", tag("SSEAlgorithm", params.sseAlgorithm))));
      await client.request({
        method: "PUT",
        bucket: params.bucketName,
        queryParams: { encryption: "" },
        headers: { "content-type": "application/xml" },
        body: xmlBody,
      });
      return {
        message: L({ ko: `✅ 버킷 '${params.bucketName}'의 기본 암호화가 '${params.sseAlgorithm}'로 설정되었습니다.`, en: `✅ Default encryption for bucket '${params.bucketName}' has been set to '${params.sseAlgorithm}'.` }),
        bucket: params.bucketName,
        sseAlgorithm: params.sseAlgorithm,
      };
    }
  );

  defineTool(
    server,
    "ncloud_ncs_delete_bucket_encryption",
    `${NCS} ⚠️ Destructive: Delete the default server-side encryption configuration of a Ncloud Storage bucket (DELETE /?encryption). New objects will no longer be encrypted by default; existing objects are unchanged. Set confirm=true to execute.`,
    {
      bucketName: bucketNameSchema("Name of the bucket to delete encryption configuration from"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      await client.request({ method: "DELETE", bucket: params.bucketName, queryParams: { encryption: "" } });
      return { message: deletedMessage({ ko: `버킷 '${params.bucketName}'의 기본 암호화 설정`, en: `the default encryption configuration of bucket '${params.bucketName}'` }) };
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete the default encryption configuration from Ncloud Storage Bucket [${params.bucketName}]. New objects will no longer be encrypted by default. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Object Lock (bucket) ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_get_object_lock_configuration",
    `${NCS} Get the Object Lock (WORM) configuration of a Ncloud Storage bucket (GET /?object-lock): whether Object Lock is enabled and the default retention (mode + days/years) applied to new objects. Returns configured=false when the bucket has no Object Lock. Note: the official per-operation page was unavailable when this tool was written; the request follows the S3 shape.`,
    { bucketName: bucketNameSchema() },
    async (params) => {
      try {
        const response = await client.request({ method: "GET", bucket: params.bucketName, queryParams: { "object-lock": "" } });
        return { bucket: params.bucketName, configured: true, ...parseObjectLockConfigXml(response.body) };
      } catch (error) {
        if (error instanceof S3CompatibleError && (error.code === "ObjectLockConfigurationNotFoundError" || error.status === 404)) {
          return { bucket: params.bucketName, configured: false, objectLockEnabled: "", errorCode: error.code };
        }
        throw error;
      }
    }
  );

  defineTool(
    server,
    "ncloud_ncs_put_object_lock_configuration",
    `${NCS} Set the Object Lock default retention of a Ncloud Storage bucket (PUT /?object-lock): every new object gets the given mode for the given period. GOVERNANCE can be overridden by users with bypass permission; COMPLIANCE cannot be shortened or removed by anyone until it expires — it requires confirm=true. The bucket must have been created with objectLockEnabled=true. Give exactly one of days / years. Note: the official per-operation page was unavailable when this tool was written; the request follows the S3 shape.`,
    {
      bucketName: bucketNameSchema(),
      mode: z.enum(OBJECT_LOCK_MODES, { required_error: requiredError("mode") }).describe("GOVERNANCE | COMPLIANCE"),
      days: positiveInt("days").optional().describe("Default retention period in days (exactly one of days / years)"),
      years: positiveInt("years").optional().describe("Default retention period in years (exactly one of days / years)"),
      confirm: z.boolean().optional().default(false).describe("Required (true) when mode=COMPLIANCE, because COMPLIANCE retention is irreversible"),
    },
    async (params) => {
      if ((params.days === undefined) === (params.years === undefined)) {
        return { content: [{ type: "text" as const, text: `❌ ${L({ ko: "days 와 years 중 정확히 하나만 지정해야 합니다.", en: "Give exactly one of days / years." })}` }], isError: true };
      }
      if (params.mode === "COMPLIANCE" && !params.confirm) {
        return {
          content: [{ type: "text" as const, text: `⚠️ COMPLIANCE default retention on Ncloud Storage Bucket [${params.bucketName}] cannot be shortened or removed by anyone (including the account owner) until it expires — every new object will be locked for ${params.days ?? params.years} ${params.days !== undefined ? "day(s)" : "year(s)"}. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` }],
        };
      }
      const body = xmlDocument("ObjectLockConfiguration",
        tag("ObjectLockEnabled", "Enabled")
        + wrap("Rule", wrap("DefaultRetention", tag("Mode", params.mode) + tag("Days", params.days) + tag("Years", params.years))));
      await client.request({
        method: "PUT",
        bucket: params.bucketName,
        queryParams: { "object-lock": "" },
        headers: { "content-type": "application/xml" },
        body,
      });
      return {
        message: L({ ko: `✅ 버킷 '${params.bucketName}'의 Object Lock 기본 보존이 ${params.mode} / ${params.days !== undefined ? `${params.days}일` : `${params.years}년`}로 설정되었습니다.`, en: `✅ Object Lock default retention for bucket '${params.bucketName}' has been set to ${params.mode} / ${params.days !== undefined ? `${params.days} day(s)` : `${params.years} year(s)`}.` }),
        bucket: params.bucketName,
        mode: params.mode,
        days: params.days,
        years: params.years,
      };
    },
    // COMPLIANCE 기본 보존은 되돌릴 수 없다 — confirm 게이트(수동)에 맞춰 파괴 힌트를 명시한다.
    { annotations: { destructiveHint: true, idempotentHint: true } }
  );

  // ═══ Object ═════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_ncs_list_objects",
    `${NCS} List objects in a Ncloud Storage bucket (GET /?list-type=2). Supports prefix, delimiter, maxKeys, startAfter and continuation-token pagination; each entry includes its storage class.`,
    {
      bucketName: bucketNameSchema(),
      prefix: z.string().optional().describe("Limits results to keys beginning with this prefix"),
      delimiter: z.string().optional().describe("Delimiter for grouping keys (commonly '/')"),
      maxKeys: z.number().int().min(1).max(1000).optional().describe("Maximum number of keys to return (1–1,000, default 1,000)"),
      startAfter: z.string().optional().describe("Start listing after this key"),
      continuationToken: z.string().optional().describe("Pagination: nextContinuationToken of the previous response"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { "list-type": "2" };
      if (params.prefix) queryParams["prefix"] = params.prefix;
      if (params.delimiter) queryParams["delimiter"] = params.delimiter;
      if (params.maxKeys) queryParams["max-keys"] = String(params.maxKeys);
      if (params.startAfter) queryParams["start-after"] = params.startAfter;
      if (params.continuationToken) queryParams["continuation-token"] = params.continuationToken;
      const response = await client.request({ method: "GET", bucket: params.bucketName, queryParams });
      return parseListObjectsV2Xml(response.body);
    }
  );

  defineTool(
    server,
    "ncloud_ncs_list_object_versions",
    `${NCS} List all versions and delete markers of objects in a versioning-enabled Ncloud Storage bucket (GET /?versions). Use it to find noncurrent versions to restore or delete, and to empty a versioned bucket before deleting it.`,
    {
      bucketName: bucketNameSchema(),
      prefix: z.string().optional().describe("Limits results to keys beginning with this prefix"),
      keyMarker: z.string().optional().describe("Pagination: nextKeyMarker of the previous response"),
      versionIdMarker: z.string().optional().describe("Pagination: nextVersionIdMarker of the previous response"),
      maxKeys: z.number().int().min(1).max(1000).optional().describe("Items per page (1–1,000, default 1,000)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { versions: "" };
      if (params.prefix) queryParams["prefix"] = params.prefix;
      if (params.keyMarker) queryParams["key-marker"] = params.keyMarker;
      if (params.versionIdMarker) queryParams["version-id-marker"] = params.versionIdMarker;
      if (params.maxKeys) queryParams["max-keys"] = String(params.maxKeys);
      const response = await client.request({ method: "GET", bucket: params.bucketName, queryParams });
      return parseListObjectVersionsXml(response.body);
    }
  );

  defineTool(
    server,
    "ncloud_ncs_put_object",
    `${NCS} Upload a text object to a Ncloud Storage bucket (PUT /{key}). Optional storage class (${STORAGE_CLASS_DESC}), server-side encryption and Object Lock headers. Use dryRun=true to preview.`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema("Object key (path) to upload to, e.g. 'folder/file.txt'"),
      body: z.string({ required_error: requiredError("body") }).describe("Content to upload as the object body"),
      contentType: z.string().optional().describe("Content-Type of the object (e.g. 'text/plain', 'application/json')"),
      storageClass: z.enum(STORAGE_CLASSES).optional().describe(`x-amz-storage-class — ${STORAGE_CLASS_DESC}. Omit to use STANDARD`),
      serverSideEncryption: z.enum(SSE_ALGORITHMS).optional().describe("x-amz-server-side-encryption — AES256 (SSE-S3) | aws:kms"),
      objectLockMode: z.enum(OBJECT_LOCK_MODES).optional().describe("x-amz-object-lock-mode — GOVERNANCE | COMPLIANCE (bucket must have Object Lock enabled; give objectLockRetainUntilDate too)"),
      objectLockRetainUntilDate: z.string().optional().describe("x-amz-object-lock-retain-until-date, ISO 8601 (e.g. 2027-01-01T00:00:00Z)"),
      objectLockLegalHold: z.enum(LEGAL_HOLD).optional().describe("x-amz-object-lock-legal-hold — ON | OFF"),
      dryRun: z.boolean().optional().default(true).describe("If true (default), returns a preview without actually uploading"),
    },
    async (params) => {
      const headers: Record<string, string> = {};
      if (params.contentType) headers["content-type"] = params.contentType;
      if (params.storageClass) headers["x-amz-storage-class"] = params.storageClass;
      if (params.serverSideEncryption) headers["x-amz-server-side-encryption"] = params.serverSideEncryption;
      if (params.objectLockMode) headers["x-amz-object-lock-mode"] = params.objectLockMode;
      if (params.objectLockRetainUntilDate) headers["x-amz-object-lock-retain-until-date"] = params.objectLockRetainUntilDate;
      if (params.objectLockLegalHold) headers["x-amz-object-lock-legal-hold"] = params.objectLockLegalHold;
      const size = Buffer.byteLength(params.body, "utf8");

      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Ncloud Storage Object Upload",
          endpoint: `https://${params.bucketName}.kr.ncloudstorage.com/${params.key}`,
          method: "PUT",
          requestParams: { bucket: params.bucketName, key: params.key, headers },
          noun: { ko: "오브젝트", en: "object" },
          verb: "upload",
          notes: {
            bodySize: `${size} bytes`,
            ...(params.storageClass ? {} : { note_storageClass: "(x-amz-storage-class not sent — the server stores it as STANDARD)" }),
          },
        });
      }

      const response = await client.request({
        method: "PUT",
        bucket: params.bucketName,
        key: params.key,
        headers,
        body: params.body,
      });
      return {
        리소스타입: "Ncloud Storage Object",
        버킷: params.bucketName,
        키: params.key,
        크기: `${size} bytes`,
        스토리지클래스: params.storageClass ?? "STANDARD (default)",
        etag: response.headers.get("etag") ?? undefined,
        versionId: response.headers.get("x-amz-version-id") ?? undefined,
        상태: "uploaded",
      };
    }
  );

  defineTool(
    server,
    "ncloud_ncs_get_object",
    `${NCS} Download an object from a Ncloud Storage bucket as text (GET /{key}). Supports a specific versionId and a byte Range. A DEEP_ARCHIVE object must be restored first (ncloud_ncs_restore_object) or the call fails with InvalidObjectState.`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema("Object key (path) to retrieve"),
      versionId: versionIdSchema(),
      range: z.string().optional().describe("Byte range to fetch, e.g. 'bytes=0-1023'"),
    },
    async (params) => {
      const headers: Record<string, string> = {};
      if (params.range) headers["range"] = params.range;
      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        key: params.key,
        queryParams: params.versionId ? { versionId: params.versionId } : undefined,
        headers,
      });
      return {
        bucket: params.bucketName,
        key: params.key,
        statusCode: response.status,
        ...objectMetaFromHeaders(response.headers),
        contentRange: response.headers.get("content-range") ?? undefined,
        body: response.body,
      };
    }
  );

  defineTool(
    server,
    "ncloud_ncs_head_object",
    `${NCS} Get an object's metadata without downloading it (HEAD /{key}): size, type, ETag, storage class, version ID, restore status and Object Lock retention / legal hold.`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema("Object key (path) to check"),
      versionId: versionIdSchema(),
    },
    async (params) => {
      const response = await client.request({
        method: "HEAD",
        bucket: params.bucketName,
        key: params.key,
        queryParams: params.versionId ? { versionId: params.versionId } : undefined,
      });
      return {
        bucket: params.bucketName,
        key: params.key,
        statusCode: response.status,
        ...objectMetaFromHeaders(response.headers),
      };
    }
  );

  defineTool(
    server,
    "ncloud_ncs_get_object_attributes",
    `${NCS} Get selected attributes of an object in one call (GET /{key}?attributes with x-amz-object-attributes): ETag, ObjectSize, StorageClass, Checksum, ObjectParts (multipart part sizes).`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema(),
      versionId: versionIdSchema(),
      attributes: z.array(z.enum(["ETag", "ObjectSize", "StorageClass", "Checksum", "ObjectParts"])).min(1).optional()
        .default(["ETag", "ObjectSize", "StorageClass", "Checksum"])
        .describe("Attributes to return (x-amz-object-attributes). Default: ETag, ObjectSize, StorageClass, Checksum"),
      maxParts: z.number().int().min(0).optional().describe("x-amz-max-parts — parts per page when ObjectParts is requested (default 1,000)"),
      partNumberMarker: z.number().int().min(0).optional().describe("x-amz-part-number-marker — start after this part number"),
    },
    async (params) => {
      const headers: Record<string, string> = { "x-amz-object-attributes": params.attributes.join(",") };
      if (params.maxParts !== undefined) headers["x-amz-max-parts"] = String(params.maxParts);
      if (params.partNumberMarker !== undefined) headers["x-amz-part-number-marker"] = String(params.partNumberMarker);
      const queryParams: Record<string, string> = { attributes: "" };
      if (params.versionId) queryParams["versionId"] = params.versionId;
      const response = await client.request({ method: "GET", bucket: params.bucketName, key: params.key, queryParams, headers });
      return {
        bucket: params.bucketName,
        key: params.key,
        lastModified: response.headers.get("last-modified") ?? undefined,
        versionId: response.headers.get("x-amz-version-id") ?? undefined,
        deleteMarker: response.headers.get("x-amz-delete-marker") ?? undefined,
        ...parseObjectAttributesXml(response.body),
      };
    }
  );

  defineTool(
    server,
    "ncloud_ncs_copy_object",
    `${NCS} Copy an object within Ncloud Storage (PUT /{key} with x-amz-copy-source). Optionally change the storage class (${STORAGE_CLASS_DESC}) — copying an object onto itself with a new class is how an existing object's class is changed. Source objects up to 5 GB; larger ones need ncloud_ncs_upload_part_copy. A DEEP_ARCHIVE source must be restored first.`,
    {
      bucketName: bucketNameSchema("Destination bucket name"),
      key: keySchema("Destination object key (path)"),
      copySource: z.string({ required_error: requiredError("copySource") }).describe("Source object as {sourceBucket}/{sourceKey} (a leading slash is tolerated)"),
      copySourceVersionId: z.string().optional().describe("Version ID of the source object to copy (versioning-enabled buckets)"),
      storageClass: z.enum(STORAGE_CLASSES).optional().describe(`x-amz-storage-class for the copy — ${STORAGE_CLASS_DESC}. Omit to use STANDARD`),
      metadataDirective: z.enum(["COPY", "REPLACE"]).optional().describe("COPY (default) keeps the source metadata; REPLACE uses the headers given in this request (contentType)"),
      contentType: z.string().optional().describe("Content-Type for the copy (applied with metadataDirective=REPLACE)"),
      serverSideEncryption: z.enum(SSE_ALGORITHMS).optional().describe("x-amz-server-side-encryption for the copy — AES256 | aws:kms"),
      objectLockMode: z.enum(OBJECT_LOCK_MODES).optional().describe("x-amz-object-lock-mode for the copy"),
      objectLockRetainUntilDate: z.string().optional().describe("x-amz-object-lock-retain-until-date for the copy, ISO 8601"),
      objectLockLegalHold: z.enum(LEGAL_HOLD).optional().describe("x-amz-object-lock-legal-hold for the copy — ON | OFF"),
    },
    async (params) => {
      const headers: Record<string, string> = {
        "x-amz-copy-source": normalizeCopySource(params.copySource, params.copySourceVersionId),
      };
      if (params.storageClass) headers["x-amz-storage-class"] = params.storageClass;
      if (params.metadataDirective) headers["x-amz-metadata-directive"] = params.metadataDirective;
      if (params.contentType) headers["content-type"] = params.contentType;
      if (params.serverSideEncryption) headers["x-amz-server-side-encryption"] = params.serverSideEncryption;
      if (params.objectLockMode) headers["x-amz-object-lock-mode"] = params.objectLockMode;
      if (params.objectLockRetainUntilDate) headers["x-amz-object-lock-retain-until-date"] = params.objectLockRetainUntilDate;
      if (params.objectLockLegalHold) headers["x-amz-object-lock-legal-hold"] = params.objectLockLegalHold;

      const response = await client.request({ method: "PUT", bucket: params.bucketName, key: params.key, headers });
      return {
        리소스타입: "Ncloud Storage Object Copy",
        대상버킷: params.bucketName,
        대상키: params.key,
        복사원본: headers["x-amz-copy-source"],
        스토리지클래스: params.storageClass ?? "STANDARD (default)",
        etag: text(response.body, "ETag") ?? "",
        lastModified: text(response.body, "LastModified") ?? "",
        versionId: response.headers.get("x-amz-version-id") ?? undefined,
        상태: "copied",
      };
    }
  );

  defineTool(
    server,
    "ncloud_ncs_delete_object",
    `${NCS} ⚠️ Destructive: Delete an object from a Ncloud Storage bucket (DELETE /{key}). In a versioning-enabled bucket, omitting versionId only adds a delete marker (the versions stay and keep billing); pass versionId to permanently remove one version. bypassGovernanceRetention=true is needed for objects under GOVERNANCE retention. Set confirm=true to execute.`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema("Object key (path) to delete"),
      versionId: versionIdSchema("Version ID to delete permanently. Omit to delete the current version (adds a delete marker on versioned buckets)"),
      bypassGovernanceRetention: z.boolean().optional().default(false).describe("Send x-amz-bypass-governance-retention: true to delete an object locked in GOVERNANCE mode (requires the bypass permission)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const headers: Record<string, string> = {};
      if (params.bypassGovernanceRetention) headers["x-amz-bypass-governance-retention"] = "true";
      const response = await client.request({
        method: "DELETE",
        bucket: params.bucketName,
        key: params.key,
        queryParams: params.versionId ? { versionId: params.versionId } : undefined,
        headers,
      });
      const deleteMarker = response.headers.get("x-amz-delete-marker");
      return {
        message: deletedMessage({ ko: `Ncloud Storage 오브젝트 '${params.bucketName}/${params.key}'${params.versionId ? ` (versionId ${params.versionId})` : ""}`, en: `Ncloud Storage object '${params.bucketName}/${params.key}'${params.versionId ? ` (versionId ${params.versionId})` : ""}` }),
        deleteMarker: deleteMarker ?? undefined,
        versionId: response.headers.get("x-amz-version-id") ?? undefined,
        ...(deleteMarker === "true"
          ? { note: L({ ko: "버전 관리 버킷이라 삭제 마커만 추가되었습니다. 버전을 완전히 지우려면 ncloud_ncs_list_object_versions 로 versionId 를 확인해 다시 삭제하세요.", en: "Versioned bucket: only a delete marker was added. To remove versions permanently, look them up with ncloud_ncs_list_object_versions and delete by versionId." }) }
          : {}),
      };
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Object [${params.bucketName}/${params.key}]${params.versionId ? ` version [${params.versionId}]` : ""} from Ncloud Storage. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_ncs_delete_objects",
    `${NCS} ⚠️ Destructive: Delete multiple objects (optionally specific versions) from a Ncloud Storage bucket in one call (POST /?delete). Give plain keys or objects with versionId. Returns per-key results (deleted / errors) — the call is HTTP 200 even when some keys fail. Set confirm=true to execute.`,
    {
      bucketName: bucketNameSchema(),
      keys: z.array(z.string()).optional().describe("Object keys to delete (current versions). Use `objects` instead to target versions"),
      objects: z.array(z.object({
        key: z.string().describe("Object key"),
        versionId: z.string().optional().describe("Version ID to delete permanently"),
      })).optional().describe("Objects to delete, each optionally with a versionId"),
      quiet: z.boolean().optional().default(false).describe("Quiet mode — the response lists only failures"),
      bypassGovernanceRetention: z.boolean().optional().default(false).describe("Send x-amz-bypass-governance-retention: true for objects under GOVERNANCE retention"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const targets = [
        ...(params.keys ?? []).map((k) => ({ key: k, versionId: undefined as string | undefined })),
        ...(params.objects ?? []),
      ];
      if (targets.length === 0) {
        return { content: [{ type: "text" as const, text: `❌ ${L({ ko: "keys 또는 objects 중 하나에 삭제 대상을 1개 이상 지정하세요.", en: "Specify at least one target in keys or objects." })}` }], isError: true };
      }
      if (targets.length > 1000) {
        return { content: [{ type: "text" as const, text: `❌ ${L({ ko: `한 번에 최대 1,000개까지 삭제할 수 있습니다(요청 ${targets.length}개).`, en: `At most 1,000 objects per call (got ${targets.length}).` })}` }], isError: true };
      }
      const objectsXml = targets.map((t) => wrap("Object", tag("Key", t.key) + tag("VersionId", t.versionId))).join("");
      const xmlBody = xmlDocument("Delete", objectsXml + tag("Quiet", params.quiet));
      const headers: Record<string, string> = { "content-type": "application/xml" };
      if (params.bypassGovernanceRetention) headers["x-amz-bypass-governance-retention"] = "true";

      const response = await client.request({
        method: "POST",
        bucket: params.bucketName,
        queryParams: { delete: "" },
        headers,
        body: xmlBody,
      });
      const result = parseDeleteResultXml(response.body);
      return {
        message: L({
          ko: `${result.errors.length ? "⚠️" : "✅"} Ncloud Storage 버킷 '${params.bucketName}'에서 ${targets.length}개 요청 중 ${params.quiet ? `실패 ${result.errors.length}개` : `${result.deleted.length}개 삭제, ${result.errors.length}개 실패`}.`,
          en: `${result.errors.length ? "⚠️" : "✅"} Ncloud Storage bucket '${params.bucketName}': ${targets.length} requested, ${params.quiet ? `${result.errors.length} failed` : `${result.deleted.length} deleted, ${result.errors.length} failed`}.`,
        }),
        requested: targets.length,
        ...result,
      };
    },
    { destructive: { message: (params) => {
      const list = [
        ...((params.keys ?? []) as string[]).map((k) => `  - ${k}`),
        ...((params.objects ?? []) as Array<{ key: string; versionId?: string }>).map((o) => `  - ${o.key}${o.versionId ? ` (versionId ${o.versionId})` : ""}`),
      ];
      return `⚠️ This will permanently delete ${list.length} object(s) from Ncloud Storage Bucket [${params.bucketName}]:\n${list.join("\n")}\n\nDo you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
    } } }
  );

  defineTool(
    server,
    "ncloud_ncs_restore_object",
    `${NCS} Request a temporary restored copy of a DEEP_ARCHIVE (Archive Class) object (POST /{key}?restore). The copy is readable with ncloud_ncs_get_object for the given number of days; check progress with ncloud_ncs_head_object (x-amz-restore). HTTP 202 = restore started, 200 = a restored copy already exists.`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema("Key of the archived object"),
      versionId: versionIdSchema(),
      days: positiveInt("days").optional().describe("How many days the restored copy stays available (RestoreRequest.Days)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { restore: "" };
      if (params.versionId) queryParams["versionId"] = params.versionId;
      const body = xmlDocument("RestoreRequest", tag("Days", params.days));
      const response = await client.request({
        method: "POST",
        bucket: params.bucketName,
        key: params.key,
        queryParams,
        headers: { "content-type": "application/xml" },
        body,
      });
      return {
        message: response.status === 202
          ? L({ ko: `✅ '${params.bucketName}/${params.key}' 복원이 시작되었습니다(202 Accepted). 완료 여부는 ncloud_ncs_head_object 의 restore 필드로 확인하세요.`, en: `✅ Restore of '${params.bucketName}/${params.key}' has started (202 Accepted). Check the restore field of ncloud_ncs_head_object for completion.` })
          : L({ ko: `ℹ️ '${params.bucketName}/${params.key}' 는 이미 복원된 복사본이 있습니다(HTTP ${response.status}).`, en: `ℹ️ '${params.bucketName}/${params.key}' already has a restored copy (HTTP ${response.status}).` }),
        bucket: params.bucketName,
        key: params.key,
        versionId: params.versionId,
        days: params.days,
        statusCode: response.status,
      };
    }
  );

  // ─── Object Lock (object) ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ncs_get_object_retention",
    `${NCS} Get the Object Lock retention of an object (GET /{key}?retention): mode (GOVERNANCE | COMPLIANCE) and retainUntilDate. Returns configured=false when the object has no retention (NoSuchObjectLockConfiguration).`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema(),
      versionId: versionIdSchema(),
    },
    async (params) => {
      const queryParams: Record<string, string> = { retention: "" };
      if (params.versionId) queryParams["versionId"] = params.versionId;
      try {
        const response = await client.request({ method: "GET", bucket: params.bucketName, key: params.key, queryParams });
        return {
          bucket: params.bucketName,
          key: params.key,
          versionId: params.versionId,
          configured: true,
          mode: text(response.body, "Mode") ?? "",
          retainUntilDate: text(response.body, "RetainUntilDate") ?? "",
        };
      } catch (error) {
        if (error instanceof S3CompatibleError && error.code === "NoSuchObjectLockConfiguration") {
          return { bucket: params.bucketName, key: params.key, versionId: params.versionId, configured: false };
        }
        throw error;
      }
    }
  );

  defineTool(
    server,
    "ncloud_ncs_put_object_retention",
    `${NCS} Set or clear the Object Lock retention of an object (PUT /{key}?retention). GOVERNANCE can later be shortened/removed with bypassGovernanceRetention; COMPLIANCE can never be shortened or removed before retainUntilDate — it requires confirm=true. clear=true sends an empty Retention to remove retention (GOVERNANCE only, with bypass). The bucket must have Object Lock enabled; retainUntilDate must be in the future.`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema(),
      versionId: versionIdSchema(),
      mode: z.enum(OBJECT_LOCK_MODES).optional().describe("GOVERNANCE | COMPLIANCE (required unless clear=true)"),
      retainUntilDate: z.string().optional().describe("ISO 8601 date in the future, e.g. 2027-01-01T00:00:00Z (required unless clear=true)"),
      clear: z.boolean().optional().default(false).describe("true: remove the retention (sends an empty Retention). Needs bypassGovernanceRetention for GOVERNANCE; impossible for COMPLIANCE"),
      bypassGovernanceRetention: z.boolean().optional().default(false).describe("Send x-amz-bypass-governance-retention: true to shorten/remove an existing GOVERNANCE retention"),
      confirm: z.boolean().optional().default(false).describe("Required (true) when mode=COMPLIANCE, because COMPLIANCE retention is irreversible"),
    },
    async (params) => {
      if (!params.clear && (!params.mode || !params.retainUntilDate)) {
        return { content: [{ type: "text" as const, text: `❌ ${L({ ko: "mode 와 retainUntilDate 를 모두 지정하거나 clear=true 를 사용하세요.", en: "Give both mode and retainUntilDate, or use clear=true." })}` }], isError: true };
      }
      if (params.mode === "COMPLIANCE" && !params.confirm) {
        return {
          content: [{ type: "text" as const, text: `⚠️ COMPLIANCE retention on Object [${params.bucketName}/${params.key}] until ${params.retainUntilDate} cannot be shortened or removed by anyone (including the account owner). Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` }],
        };
      }
      const queryParams: Record<string, string> = { retention: "" };
      if (params.versionId) queryParams["versionId"] = params.versionId;
      const headers: Record<string, string> = { "content-type": "application/xml" };
      if (params.bypassGovernanceRetention) headers["x-amz-bypass-governance-retention"] = "true";
      const body = xmlDocument("Retention", params.clear ? "" : tag("Mode", params.mode) + tag("RetainUntilDate", params.retainUntilDate));

      await client.request({ method: "PUT", bucket: params.bucketName, key: params.key, queryParams, headers, body });
      return {
        message: params.clear
          ? L({ ko: `✅ '${params.bucketName}/${params.key}'의 보존 설정이 해제되었습니다.`, en: `✅ Retention on '${params.bucketName}/${params.key}' has been cleared.` })
          : L({ ko: `✅ '${params.bucketName}/${params.key}'에 ${params.mode} 보존이 ${params.retainUntilDate}까지 설정되었습니다.`, en: `✅ ${params.mode} retention on '${params.bucketName}/${params.key}' has been set until ${params.retainUntilDate}.` }),
        bucket: params.bucketName,
        key: params.key,
        versionId: params.versionId,
        mode: params.clear ? undefined : params.mode,
        retainUntilDate: params.clear ? undefined : params.retainUntilDate,
        cleared: params.clear,
      };
    },
    // COMPLIANCE 보존은 되돌릴 수 없다 — confirm 게이트(수동)에 맞춰 파괴 힌트를 명시한다.
    { annotations: { destructiveHint: true, idempotentHint: true } }
  );

  defineTool(
    server,
    "ncloud_ncs_get_object_legal_hold",
    `${NCS} Get the Object Lock legal hold status of an object (GET /{key}?legal-hold): ON | OFF. Returns configured=false when the object has no legal hold setting.`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema(),
      versionId: versionIdSchema(),
    },
    async (params) => {
      const queryParams: Record<string, string> = { "legal-hold": "" };
      if (params.versionId) queryParams["versionId"] = params.versionId;
      try {
        const response = await client.request({ method: "GET", bucket: params.bucketName, key: params.key, queryParams });
        return { bucket: params.bucketName, key: params.key, versionId: params.versionId, configured: true, status: text(response.body, "Status") ?? "" };
      } catch (error) {
        if (error instanceof S3CompatibleError && error.code === "NoSuchObjectLockConfiguration") {
          return { bucket: params.bucketName, key: params.key, versionId: params.versionId, configured: false, status: "OFF" };
        }
        throw error;
      }
    }
  );

  defineTool(
    server,
    "ncloud_ncs_put_object_legal_hold",
    `${NCS} Turn an object's Object Lock legal hold ON or OFF (PUT /{key}?legal-hold). While ON the object cannot be deleted or overwritten regardless of retention; OFF releases it. The bucket must have Object Lock enabled.`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema(),
      versionId: versionIdSchema(),
      status: z.enum(LEGAL_HOLD, { required_error: requiredError("status") }).describe("ON | OFF"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { "legal-hold": "" };
      if (params.versionId) queryParams["versionId"] = params.versionId;
      const body = xmlDocument("LegalHold", tag("Status", params.status));
      await client.request({ method: "PUT", bucket: params.bucketName, key: params.key, queryParams, headers: { "content-type": "application/xml" }, body });
      return {
        message: L({ ko: `✅ '${params.bucketName}/${params.key}'의 법적 보존(legal hold)이 ${params.status}로 설정되었습니다.`, en: `✅ Legal hold on '${params.bucketName}/${params.key}' has been set to ${params.status}.` }),
        bucket: params.bucketName,
        key: params.key,
        versionId: params.versionId,
        status: params.status,
      };
    }
  );

  // ═══ Multipart ══════════════════════════════════════════════════════════════
  registerStorageNcloudMultipartTools(server, client);
}
