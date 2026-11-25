import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withStorageContext } from "../client/_storage-context.js";
import { L } from "./_messages.js";

/**
 * Ncloud Storage 조건부 요청 · 버킷 소유자 확인 (2026-11-24 민간존 릴리스, ncloudstorage-releasenote).
 *
 * - 조건부 쓰기: PutObject · CopyObject · CompleteMultipartUpload 의 If-Match / If-None-Match, DeleteObject 의 If-Match.
 * - 복사 원본 조건: CopyObject · UploadPartCopy 의 x-amz-copy-source-if-(none-)match / -if-(un)modified-since.
 * - 버킷 소유자 확인: 공통 헤더 x-amz-expected-bucket-owner(모든 오퍼레이션), 복사 원본 x-amz-source-expected-bucket-owner.
 * - DeleteObjects Delete.Object.ETag 는 공공존 가이드에도 있으므로 여기 플래그와 무관하게 등록한다(storage-ncloud.ts).
 *
 * 공공존 가이드(2026-10-22 판)에는 위 헤더가 없다 → `conditional=false` 로 등록해 파라미터를 노출하지 않는다.
 */

/**
 * 버킷 소유자 계정 ID. 형식은 서버가 판단한다.
 * 2026-11-25~26 라이브: 받는 값은 **리소스 NRN 의 계정 번호**(`nrn:PUB:<service>:<region>:<accountNo>:…`, 6자리 숫자)다 —
 * 일치하면 성공, 다른 번호는 403 AccessDenied. ncloud_ncs_list_buckets 의 owner.id·STS caller id(36자 UUID)는
 * 400 InvalidBucketOwnerAWSAccountID(가이드 표기는 InvalidBucketOwnerAccountID).
 */
const ownerSchema = (header: string) =>
  z.string().min(1).describe(
    `${header} — expected owner account number of the bucket: the account number inside any resource NRN (nrn:PUB:<service>:<region>:<accountNo>:…, e.g. from ncloud_resource_list_resources). ` +
      "The 36-char owner ID from ncloud_ncs_list_buckets is rejected as InvalidBucketOwnerAWSAccountID. A different owner is rejected with AccessDenied (403)"
  );

/**
 * 모든 Ncloud Storage 도구에 공통 파라미터 `expectedBucketOwner` 를 붙이는 server 프록시.
 * 핸들러는 파라미터를 보지 않고, 실행 컨텍스트로 클라이언트에 전달돼 `x-amz-expected-bucket-owner` 헤더가 된다.
 */
export function withNcsCommonParams(server: McpServer): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (name: string, config: any, handler: (params: any, extra: any) => any) => {
          const inputSchema = { ...(config?.inputSchema ?? {}), expectedBucketOwner: ownerSchema("x-amz-expected-bucket-owner").optional() };
          const wrapped = (params: any, extra: any) => {
            const { expectedBucketOwner, ...rest } = params ?? {};
            return withStorageContext({ expectedBucketOwner }, () => handler(rest, extra));
          };
          return (target as any).registerTool(name, { ...config, inputSchema }, wrapped);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as McpServer;
}

// ─── 대상 쓰기 조건 (If-Match / If-None-Match) ──────────────────────────────

const etagValue = z.string().min(1, { message: "ETag must not be empty" });

/** PutObject · CopyObject · CompleteMultipartUpload: If-Match(ETag, '*' 불가) / If-None-Match('*' 만). */
export const writeConditionShape = {
  ifMatch: etagValue.optional().describe(
    "If-Match — write only if the current object's ETag equals this value (quotes optional). '*' is not supported. Cannot be combined with ifNoneMatch. Fails with 412 PreconditionFailed otherwise"
  ),
  ifNoneMatch: z.literal("*").optional().describe(
    "If-None-Match — only '*': write only if no object with this key exists (create-only). Cannot be combined with ifMatch. Fails with 412 PreconditionFailed if the key exists"
  ),
};

export function writeConditionHeaders(p: { ifMatch?: string; ifNoneMatch?: string }): Record<string, string> {
  if (p.ifMatch !== undefined && p.ifNoneMatch !== undefined) {
    throw new Error(L({ ko: "잘못된 파라미터: ifMatch 와 ifNoneMatch 는 함께 쓸 수 없습니다.", en: "Invalid parameter: ifMatch and ifNoneMatch cannot be combined." }));
  }
  if (p.ifMatch === "*") {
    throw new Error(L({ ko: "잘못된 파라미터: 쓰기의 ifMatch 는 '*' 를 지원하지 않습니다. 생성 전용이면 ifNoneMatch='*' 를 쓰세요.", en: "Invalid parameter: ifMatch='*' is not supported for writes. Use ifNoneMatch='*' for create-only." }));
  }
  const h: Record<string, string> = {};
  if (p.ifMatch !== undefined) h["if-match"] = p.ifMatch;
  if (p.ifNoneMatch !== undefined) h["if-none-match"] = p.ifNoneMatch;
  return h;
}

/** DeleteObject: If-Match(ETag 또는 '*' = 존재할 때만). versionId 와 함께 쓸 수 없다. */
export const deleteConditionShape = {
  ifMatch: etagValue.optional().describe(
    "If-Match — delete only if the current ETag equals this value, or '*' to delete only if the object exists. Cannot be used with versionId. Fails with 412 PreconditionFailed otherwise"
  ),
};

export function deleteConditionHeaders(p: { ifMatch?: string; versionId?: string }): Record<string, string> {
  if (p.ifMatch === undefined) return {};
  if (p.versionId !== undefined) {
    throw new Error(L({ ko: "잘못된 파라미터: ifMatch 는 versionId 와 함께 쓸 수 없습니다.", en: "Invalid parameter: ifMatch cannot be used with versionId." }));
  }
  return { "if-match": p.ifMatch };
}

// ─── 복사 원본 조건 (CopyObject · UploadPartCopy) ────────────────────────────

const httpDate = (header: string) =>
  z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: `${header}: not a valid date` }).describe(
    `${header} — date of the source object (ISO 8601 or HTTP-date; sent as HTTP-date)`
  );

export const copySourceConditionShape = {
  copySourceIfMatch: etagValue.optional().describe("x-amz-copy-source-if-match — copy only if the source ETag equals this value"),
  copySourceIfNoneMatch: etagValue.optional().describe("x-amz-copy-source-if-none-match — copy only if the source ETag differs from this value"),
  copySourceIfModifiedSince: httpDate("x-amz-copy-source-if-modified-since").optional(),
  copySourceIfUnmodifiedSince: httpDate("x-amz-copy-source-if-unmodified-since").optional(),
  sourceExpectedBucketOwner: ownerSchema("x-amz-source-expected-bucket-owner").optional(),
};

export function copySourceConditionHeaders(p: {
  copySourceIfMatch?: string;
  copySourceIfNoneMatch?: string;
  copySourceIfModifiedSince?: string;
  copySourceIfUnmodifiedSince?: string;
  sourceExpectedBucketOwner?: string;
}): Record<string, string> {
  const h: Record<string, string> = {};
  if (p.copySourceIfMatch !== undefined) h["x-amz-copy-source-if-match"] = p.copySourceIfMatch;
  if (p.copySourceIfNoneMatch !== undefined) h["x-amz-copy-source-if-none-match"] = p.copySourceIfNoneMatch;
  if (p.copySourceIfModifiedSince !== undefined) h["x-amz-copy-source-if-modified-since"] = new Date(p.copySourceIfModifiedSince).toUTCString();
  if (p.copySourceIfUnmodifiedSince !== undefined) h["x-amz-copy-source-if-unmodified-since"] = new Date(p.copySourceIfUnmodifiedSince).toUTCString();
  if (p.sourceExpectedBucketOwner !== undefined) h["x-amz-source-expected-bucket-owner"] = p.sourceExpectedBucketOwner;
  return h;
}

/** 조건 스키마 조각을 켜고 끈다(공공존은 빈 객체). 타입은 항상 켠 쪽으로 맞춘다. */
export function maybe<S extends Record<string, z.ZodTypeAny>>(enabled: boolean, shape: S): S {
  return (enabled ? shape : {}) as S;
}
