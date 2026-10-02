import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

/**
 * Cloud Data Box — 민간존 전용 (api.ncloud-docs.com `data-box-overview`, 2026-10-02 대조).
 *
 * Base URL: https://databox.apigw.ntruss.com (registry 에서 주입), REST JSON → client.requestRaw.
 * 가이드 슬러그가 접두 없이(`get-nas-list`, `apply-file-import-1`, `importget-import-apply-list`) 등록돼 있다.
 * 오퍼레이션 8종: 버킷/NAS 조회 2 · 반입 신청/조회 3 · 반출 신청/조회 3.
 * dataBoxNo 는 콘솔 My Space > 서버 상세 정보 > 인프라 탭에서 확인한다(조회 API 없음).
 */
function compact<T extends Record<string, unknown>>(obj: T): Record<string, string | number | boolean | undefined> {
  const out: Record<string, string | number | boolean | undefined> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v as string | number | boolean;
  return out;
}

const dataBoxNo = z.number({ required_error: requiredError("dataBoxNo") }).int().describe("Data Box number (console: My Space > server details > Infra tab)");
const applyListParams = {
  dataBoxNo,
  applyStartDate: z.string().optional().describe("Start datetime (yyyyMMddHHmmss)"),
  applyEndDate: z.string().optional().describe("End datetime (yyyyMMddHHmmss)"),
  pageNo: z.number().int().min(1).max(1000).optional().describe("Page number (1-1000)"),
  pageSize: z.number().int().min(1).max(1000).optional().describe("Items per page (1-1000)"),
};

const exportFileSchema = z.object({
  name: z.string().describe("File name to export"),
  description: z.string().min(30).describe("Description of the file (30+ chars; it is the basis of the export review)"),
  type: z.enum(["TABLE", "IMAGE", "MODEL", "LICENCE"]).describe("File type: TABLE (delimited text), IMAGE, MODEL (analysis model), LICENCE"),
  tableDetail: z.enum(["TAB", "SPACE", "COMMA", "CUSTOM"]).optional().describe("Field delimiter for TABLE files"),
  delimiter: z.string().optional().describe("Custom delimiter (required when tableDetail is CUSTOM)"),
  imageDetail: z.enum(["BMP", "GIF", "JPEG", "TIFF"]).optional().describe("Image extension for IMAGE files"),
  modelDetail: z.enum(["TENSORFLOW", "PYTORCH", "SCIKIT_LEARN", "R"]).optional().describe("Model format for MODEL files"),
  modelVersion: z.string().optional().describe("Model version (required when type is MODEL)"),
});

export function registerDataBoxTools(server: McpServer, client: NcloudClient): void {
  // get-bucket-list-1: GET /api/v1/storage/get-bucket-list
  defineTool(server, "ncloud_databox_list_buckets", "List Object Storage buckets usable as Data Box import source / export target.", {}, async () => {
    return client.requestRaw("GET", "/api/v1/storage/get-bucket-list");
  });

  // get-nas-list: GET /api/v1/storage/get-nas-list
  defineTool(server, "ncloud_databox_list_nas", "List the NAS volumes of a Data Box.", { dataBoxNo }, async (params) => {
    return client.requestRaw("GET", "/api/v1/storage/get-nas-list", compact(params));
  });

  // apply-file-import-1: POST /api/v1/import/apply-file-import
  defineTool(server, "ncloud_databox_apply_file_import", "Request a file import from an Object Storage bucket into a Data Box NAS (up to 5 files, 500 MB each). Use dryRun=true to preview.", {
    dataBoxNo,
    bucketName: z.string({ required_error: requiredError("bucketName") }).describe("Source bucket name (see ncloud_databox_list_buckets)"),
    fileList: z.array(z.object({ name: z.string().describe("Object name in the bucket, including extension") })).min(1).max(5).describe("Files to import (up to 5)"),
    nasInstanceNo: z.number({ required_error: requiredError("nasInstanceNo") }).int().describe("Target NAS instance number (see ncloud_databox_list_nas)"),
    dryRun: z.boolean().optional().default(false).describe("If true, returns the request without sending it"),
  }, async (params) => {
    const { dryRun, ...b } = params;
    if (dryRun) return dryRunPreview({ label: "🔍 Dry-Run Preview: Data Box file import", endpoint: "/api/v1/import/apply-file-import", method: "POST", requestParams: b, noun: { ko: "반입 신청", en: "file import request" } });
    return client.requestRaw("POST", "/api/v1/import/apply-file-import", undefined, b);
  });

  // importget-import-apply-list: GET /api/v1/import/get-import-apply-list
  defineTool(server, "ncloud_databox_list_import_requests", "List file import requests of a Data Box.", applyListParams, async (params) => {
    return client.requestRaw("GET", "/api/v1/import/get-import-apply-list", compact(params));
  });

  // get-import-apply-detail-1: GET /api/v1/import/get-import-apply-detail
  defineTool(server, "ncloud_databox_get_import_request", "Get a file import request of a Data Box.", {
    dataBoxNo,
    importNo: z.number({ required_error: requiredError("importNo") }).int().describe("Import request number (see ncloud_databox_list_import_requests)"),
  }, async (params) => {
    return client.requestRaw("GET", "/api/v1/import/get-import-apply-detail", compact(params));
  });

  // apply-file-export-1: POST /api/v1/export/apply-file-export (the page's curl example wrongly shows the import URL; the method table is authoritative)
  defineTool(server, "ncloud_databox_apply_file_export", "Request a file export from a Data Box NAS to an Object Storage bucket; each file needs a 30+ char description and a type for the export review. Use dryRun=true to preview.", {
    dataBoxNo,
    nasInstanceNo: z.number({ required_error: requiredError("nasInstanceNo") }).int().describe("Source NAS instance number (see ncloud_databox_list_nas)"),
    bucketName: z.string({ required_error: requiredError("bucketName") }).describe("Target bucket name (see ncloud_databox_list_buckets)"),
    fileList: z.array(exportFileSchema).min(1).describe("Files to export with review metadata"),
    dryRun: z.boolean().optional().default(false).describe("If true, returns the request without sending it"),
  }, async (params) => {
    const { dryRun, ...b } = params;
    for (const [i, f] of b.fileList.entries()) {
      if (f.type === "TABLE" && f.tableDetail === "CUSTOM" && !f.delimiter) return { content: [{ type: "text" as const, text: `fileList[${i}]: delimiter is required when tableDetail is CUSTOM.` }], isError: true };
      if (f.type === "MODEL" && !f.modelVersion) return { content: [{ type: "text" as const, text: `fileList[${i}]: modelVersion is required when type is MODEL.` }], isError: true };
    }
    if (dryRun) return dryRunPreview({ label: "🔍 Dry-Run Preview: Data Box file export", endpoint: "/api/v1/export/apply-file-export", method: "POST", requestParams: b, noun: { ko: "반출 신청", en: "file export request" } });
    return client.requestRaw("POST", "/api/v1/export/apply-file-export", undefined, b);
  });

  // get-export-apply-list-1: GET /api/v1/export/get-export-apply-list
  defineTool(server, "ncloud_databox_list_export_requests", "List file export requests of a Data Box.", applyListParams, async (params) => {
    return client.requestRaw("GET", "/api/v1/export/get-export-apply-list", compact(params));
  });

  // get-export-apply-detail-1: GET /api/v1/export/get-export-apply-detail
  defineTool(server, "ncloud_databox_get_export_request", "Get a file export request of a Data Box.", {
    dataBoxNo,
    exportNo: z.number({ required_error: requiredError("exportNo") }).int().describe("Export request number (see ncloud_databox_list_export_requests)"),
  }, async (params) => {
    return client.requestRaw("GET", "/api/v1/export/get-export-apply-detail", compact(params));
  });
}
