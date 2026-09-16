import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { S3CompatibleClient } from "../client/s3-compatible-client.js";
import { defineTool } from "./_tool.js";
import { L, requiredError } from "./_messages.js";
import { tag, wrap, xmlDocument, text, blocks, intText, boolText } from "./_s3xml.js";

/**
 * Ncloud Storage 멀티파트 업로드 도구 7종.
 *
 * 공식 문서 https://api.ncloud-docs.com/docs/storage-ncloudstorage 의 Multipart Upload 섹션
 * (CreateMultipartUpload / UploadPart / UploadPartCopy / ListParts / ListMultipartUploads /
 * CompleteMultipartUpload / AbortMultipartUpload) 을 1:1 로 래핑한다.
 * `registerStorageNcloudTools` 안에서 호출되므로 registry 에는 따로 등록하지 않는다.
 *
 * 주의: MCP 는 텍스트 채널이라 `ncloud_ncs_upload_part` 의 본문은 문자열이다. 대용량 바이너리
 * 업로드 용도가 아니라 API 동작 확인·소형 파트 조립·정리(list/abort) 용도로 본다.
 */

const STORAGE_CLASSES = ["STANDARD", "ONEZONE_IA", "DEEP_ARCHIVE"] as const;
const OBJECT_LOCK_MODES = ["GOVERNANCE", "COMPLIANCE"] as const;
const LEGAL_HOLD = ["ON", "OFF"] as const;
const SSE_ALGORITHMS = ["AES256", "aws:kms"] as const;

const NCS = "[Ncloud Storage]";

function bucketNameSchema() {
  return z.string({ required_error: requiredError("bucketName") }).describe("Name of the Ncloud Storage bucket");
}
function keySchema(desc = "Object key (path) of the multipart upload target") {
  return z.string({ required_error: requiredError("key") }).describe(desc);
}
function uploadIdSchema() {
  return z.string({ required_error: requiredError("uploadId") }).describe("Upload ID returned by ncloud_ncs_create_multipart_upload");
}
function partNumberSchema() {
  return z.number({ required_error: requiredError("partNumber") }).int().min(1).max(10000).describe("Part number (1–10,000)");
}

/** 소스 표기 정규화: 문서 형식은 `{bucket}/{object}`. 앞 슬래시가 붙어 와도 받아준다. */
function normalizeCopySource(source: string, versionId?: string): string {
  let s = source.startsWith("/") ? source.slice(1) : source;
  if (versionId) s += (s.includes("?versionId=") ? "" : `?versionId=${encodeURIComponent(versionId)}`);
  return s;
}

function parseInitiateXml(xml: string) {
  return {
    bucket: text(xml, "Bucket") ?? "",
    key: text(xml, "Key") ?? "",
    uploadId: text(xml, "UploadId") ?? "",
  };
}

function parseListPartsXml(xml: string) {
  return {
    bucket: text(xml, "Bucket") ?? "",
    key: text(xml, "Key") ?? "",
    uploadId: text(xml, "UploadId") ?? "",
    storageClass: text(xml, "StorageClass"),
    partNumberMarker: intText(xml, "PartNumberMarker"),
    nextPartNumberMarker: intText(xml, "NextPartNumberMarker"),
    maxParts: intText(xml, "MaxParts"),
    isTruncated: boolText(xml, "IsTruncated") ?? false,
    parts: blocks(xml, "Part").map((p) => ({
      partNumber: intText(p, "PartNumber") ?? 0,
      lastModified: text(p, "LastModified") ?? "",
      etag: text(p, "ETag") ?? "",
      size: intText(p, "Size") ?? 0,
    })),
  };
}

function parseListMultipartUploadsXml(xml: string) {
  return {
    bucket: text(xml, "Bucket") ?? "",
    prefix: text(xml, "Prefix") ?? "",
    keyMarker: text(xml, "KeyMarker") ?? "",
    uploadIdMarker: text(xml, "UploadIdMarker") ?? "",
    nextKeyMarker: text(xml, "NextKeyMarker"),
    nextUploadIdMarker: text(xml, "NextUploadIdMarker"),
    maxUploads: intText(xml, "MaxUploads"),
    isTruncated: boolText(xml, "IsTruncated") ?? false,
    uploads: blocks(xml, "Upload").map((u) => ({
      key: text(u, "Key") ?? "",
      uploadId: text(u, "UploadId") ?? "",
      storageClass: text(u, "StorageClass"),
      initiated: text(u, "Initiated") ?? "",
    })),
  };
}

export function registerStorageNcloudMultipartTools(server: McpServer, client: S3CompatibleClient): void {
  // ─── CreateMultipartUpload ─────────────────────────────────────────────────
  defineTool(
    server,
    "ncloud_ncs_create_multipart_upload",
    `${NCS} Start a multipart upload (POST /{key}?uploads) and get the uploadId used by ncloud_ncs_upload_part / upload_part_copy / complete_multipart_upload / abort_multipart_upload. Optional storage class, SSE and Object Lock headers apply to the final object.`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema("Object key (path) the assembled object will have"),
      contentType: z.string().optional().describe("Content-Type of the final object"),
      storageClass: z.enum(STORAGE_CLASSES).optional().describe("x-amz-storage-class — STANDARD (default) | ONEZONE_IA | DEEP_ARCHIVE"),
      serverSideEncryption: z.enum(SSE_ALGORITHMS).optional().describe("x-amz-server-side-encryption — AES256 (SSE-S3) | aws:kms (Ncloud-managed KMS key)"),
      objectLockMode: z.enum(OBJECT_LOCK_MODES).optional().describe("x-amz-object-lock-mode (bucket must have Object Lock enabled)"),
      objectLockRetainUntilDate: z.string().optional().describe("x-amz-object-lock-retain-until-date, ISO 8601 (e.g. 2027-01-01T00:00:00Z)"),
      objectLockLegalHold: z.enum(LEGAL_HOLD).optional().describe("x-amz-object-lock-legal-hold — ON | OFF"),
    },
    async (params) => {
      const headers: Record<string, string> = {};
      if (params.contentType) headers["content-type"] = params.contentType;
      if (params.storageClass) headers["x-amz-storage-class"] = params.storageClass;
      if (params.serverSideEncryption) headers["x-amz-server-side-encryption"] = params.serverSideEncryption;
      if (params.objectLockMode) headers["x-amz-object-lock-mode"] = params.objectLockMode;
      if (params.objectLockRetainUntilDate) headers["x-amz-object-lock-retain-until-date"] = params.objectLockRetainUntilDate;
      if (params.objectLockLegalHold) headers["x-amz-object-lock-legal-hold"] = params.objectLockLegalHold;

      const response = await client.request({
        method: "POST",
        bucket: params.bucketName,
        key: params.key,
        queryParams: { uploads: "" },
        headers,
      });
      return {
        ...parseInitiateXml(response.body),
        storageClass: params.storageClass ?? "STANDARD (default)",
        next: L({
          ko: "ncloud_ncs_upload_part 로 파트를 올린 뒤(partNumber 1부터), 각 ETag 를 모아 ncloud_ncs_complete_multipart_upload 를 호출하세요. 중단하려면 ncloud_ncs_abort_multipart_upload.",
          en: "Upload parts with ncloud_ncs_upload_part (partNumber from 1), then pass the collected ETags to ncloud_ncs_complete_multipart_upload. Use ncloud_ncs_abort_multipart_upload to cancel.",
        }),
      };
    }
  );

  // ─── UploadPart ────────────────────────────────────────────────────────────
  defineTool(
    server,
    "ncloud_ncs_upload_part",
    `${NCS} Upload one part of a multipart upload (PUT /{key}?partNumber&uploadId) and return its ETag. Body is text over MCP, so this suits small parts and API verification rather than bulk binary transfer. Every part except the last must be at least 5 MB (S3 convention) or CompleteMultipartUpload fails with EntityTooSmall.`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema(),
      uploadId: uploadIdSchema(),
      partNumber: partNumberSchema(),
      body: z.string({ required_error: requiredError("body") }).describe("Content of this part"),
    },
    async (params) => {
      const response = await client.request({
        method: "PUT",
        bucket: params.bucketName,
        key: params.key,
        queryParams: { partNumber: String(params.partNumber), uploadId: params.uploadId },
        body: params.body,
      });
      return {
        bucket: params.bucketName,
        key: params.key,
        uploadId: params.uploadId,
        partNumber: params.partNumber,
        etag: response.headers.get("etag") ?? "",
        size: `${Buffer.byteLength(params.body, "utf8")} bytes`,
      };
    }
  );

  // ─── UploadPartCopy ────────────────────────────────────────────────────────
  defineTool(
    server,
    "ncloud_ncs_upload_part_copy",
    `${NCS} Copy a byte range of an existing object into a part of a multipart upload (PUT /{key}?partNumber&uploadId with x-amz-copy-source). Use it to assemble or re-class objects larger than the 5 GB CopyObject limit without downloading them.`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema(),
      uploadId: uploadIdSchema(),
      partNumber: partNumberSchema(),
      copySource: z.string({ required_error: requiredError("copySource") }).describe("Source object as {sourceBucket}/{sourceKey} (a leading slash is tolerated)"),
      copySourceVersionId: z.string().optional().describe("Version ID of the source object (versioning-enabled buckets)"),
      copySourceRange: z.string().optional().describe("Byte range to copy from the source, e.g. 'bytes=0-5242879'. Omit to copy the whole source object as this part"),
    },
    async (params) => {
      const headers: Record<string, string> = {
        "x-amz-copy-source": normalizeCopySource(params.copySource, params.copySourceVersionId),
      };
      if (params.copySourceRange) headers["x-amz-copy-source-range"] = params.copySourceRange;

      const response = await client.request({
        method: "PUT",
        bucket: params.bucketName,
        key: params.key,
        queryParams: { partNumber: String(params.partNumber), uploadId: params.uploadId },
        headers,
      });
      return {
        bucket: params.bucketName,
        key: params.key,
        uploadId: params.uploadId,
        partNumber: params.partNumber,
        copySource: headers["x-amz-copy-source"],
        copySourceRange: params.copySourceRange ?? "(entire source object)",
        etag: text(response.body, "ETag") ?? "",
        lastModified: text(response.body, "LastModified") ?? "",
      };
    }
  );

  // ─── ListParts ─────────────────────────────────────────────────────────────
  defineTool(
    server,
    "ncloud_ncs_list_parts",
    `${NCS} List the parts uploaded so far for a multipart upload (GET /{key}?uploadId). Paginate with maxParts / partNumberMarker.`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema(),
      uploadId: uploadIdSchema(),
      maxParts: z.number().int().min(1).max(1000).optional().describe("Parts per page (1–1,000)"),
      partNumberMarker: z.number().int().min(0).optional().describe("Start after this part number (nextPartNumberMarker of the previous page)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { uploadId: params.uploadId };
      if (params.maxParts !== undefined) queryParams["max-parts"] = String(params.maxParts);
      if (params.partNumberMarker !== undefined) queryParams["part-number-marker"] = String(params.partNumberMarker);
      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        key: params.key,
        queryParams,
      });
      return parseListPartsXml(response.body);
    }
  );

  // ─── ListMultipartUploads ──────────────────────────────────────────────────
  defineTool(
    server,
    "ncloud_ncs_list_multipart_uploads",
    `${NCS} List in-progress (not yet completed or aborted) multipart uploads in a bucket (GET /?uploads). Incomplete uploads keep consuming storage until completed or aborted — use this to find leftovers, then ncloud_ncs_abort_multipart_upload.`,
    {
      bucketName: bucketNameSchema(),
      prefix: z.string().optional().describe("Only uploads whose key starts with this prefix"),
      maxUploads: z.number().int().min(1).max(1000).optional().describe("Uploads per page (1–1,000)"),
      keyMarker: z.string().optional().describe("Pagination: nextKeyMarker of the previous page"),
      uploadIdMarker: z.string().optional().describe("Pagination: nextUploadIdMarker of the previous page (requires keyMarker)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { uploads: "" };
      if (params.prefix) queryParams["prefix"] = params.prefix;
      if (params.maxUploads !== undefined) queryParams["max-uploads"] = String(params.maxUploads);
      if (params.keyMarker) queryParams["key-marker"] = params.keyMarker;
      if (params.uploadIdMarker) queryParams["upload-id-marker"] = params.uploadIdMarker;
      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        queryParams,
      });
      return parseListMultipartUploadsXml(response.body);
    }
  );

  // ─── CompleteMultipartUpload ───────────────────────────────────────────────
  defineTool(
    server,
    "ncloud_ncs_complete_multipart_upload",
    `${NCS} Assemble uploaded parts into the final object (POST /{key}?uploadId). Pass every part's partNumber and the ETag returned when it was uploaded; parts are sent in ascending part-number order as the API requires.`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema(),
      uploadId: uploadIdSchema(),
      parts: z.array(z.object({
        partNumber: z.number().int().min(1).max(10000).describe("Part number"),
        etag: z.string().describe("ETag returned by ncloud_ncs_upload_part / upload_part_copy for this part"),
      })).min(1, { message: L({ ko: "최소 1개 이상의 파트가 필요합니다.", en: "At least one part is required." }) })
        .describe("Parts to assemble"),
    },
    async (params) => {
      const sorted = [...params.parts].sort((a, b) => a.partNumber - b.partNumber);
      const partsXml = sorted.map((p) => wrap("Part", tag("PartNumber", p.partNumber) + tag("ETag", p.etag))).join("");
      const body = xmlDocument("CompleteMultipartUpload", partsXml);

      const response = await client.request({
        method: "POST",
        bucket: params.bucketName,
        key: params.key,
        queryParams: { uploadId: params.uploadId },
        headers: { "content-type": "application/xml" },
        body,
      });
      return {
        message: L({ ko: `✅ 멀티파트 업로드가 완료되어 오브젝트 '${params.bucketName}/${params.key}'가 생성되었습니다.`, en: `✅ Multipart upload completed; object '${params.bucketName}/${params.key}' has been created.` }),
        bucket: text(response.body, "Bucket") ?? params.bucketName,
        key: text(response.body, "Key") ?? params.key,
        location: text(response.body, "Location") ?? "",
        etag: text(response.body, "ETag") ?? "",
        checksumType: text(response.body, "ChecksumType"),
        partsAssembled: sorted.length,
        versionId: response.headers.get("x-amz-version-id") ?? undefined,
      };
    }
  );

  // ─── AbortMultipartUpload ──────────────────────────────────────────────────
  defineTool(
    server,
    "ncloud_ncs_abort_multipart_upload",
    `${NCS} ⚠️ Destructive: Abort a multipart upload (DELETE /{key}?uploadId) and discard every uploaded part. The uploadId cannot be reused afterwards. Set confirm=true to execute.`,
    {
      bucketName: bucketNameSchema(),
      key: keySchema(),
      uploadId: uploadIdSchema(),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      await client.request({
        method: "DELETE",
        bucket: params.bucketName,
        key: params.key,
        queryParams: { uploadId: params.uploadId },
      });
      return {
        message: L({ ko: `✅ 멀티파트 업로드 '${params.uploadId}'이(가) 중단되었고 업로드된 파트가 삭제되었습니다.`, en: `✅ Multipart upload '${params.uploadId}' has been aborted and its uploaded parts discarded.` }),
        bucket: params.bucketName,
        key: params.key,
        uploadId: params.uploadId,
      };
    },
    { destructive: { message: (params) => `⚠️ This will permanently abort multipart upload [${params.uploadId}] for object [${params.bucketName}/${params.key}] in Ncloud Storage and discard all uploaded parts. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );
}
