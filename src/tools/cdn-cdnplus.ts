import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError } from "./_messages.js";

/**
 * CDN+ — **금융존 전용**.
 *
 * 민간존은 이미 종료(fade-out)됐고 공공존도 2026-12-31 종료 예정이라 두 존에는 등록하지 않는다([[ncloud-cdn-scope]]).
 * 금융존은 Global Edge 가 없고 CDN+ 만 제공되며 종료 공지가 없다(api-fin `cdnplus` 개요, 2026-10-02 대조) → 금융존에만 등록.
 *
 * Base URL: 금융존 기본 게이트웨이 https://fin-ncloud.apigw.fin-ntruss.com, 경로 접두 /cdn/v2/
 * API 스타일: classic Ncloud (GET + 쿼리 + responseFormatType) → client.request (responseFormatType=json 자동, 배열은 `{param}.{N}`).
 *
 * 오퍼레이션 5종(금융존 가이드 슬러그는 접두 없는 `getcdnplusinstancelist` 등):
 *   getCdnPlusInstanceList / getCdnPlusMonitoringData / getCdnPlusUsageData / requestCdnPlusPurge / getCdnPlusPurgeHistoryList
 * 최초 구현은 ncloud-gov-mcp-server v0.2.0 의 공공존 CDN+ 모듈(동일 경로·파라미터)을 가져왔다.
 */
export function registerCdnPlusTools(server: McpServer, client: NcloudClient): void {
  defineTool(
    server,
    "ncloud_cdnplus_list_instances",
    "List CDN+ instances (Financial zone only; optional filtering by instance number and pagination).",
    {
      cdnInstanceNo: z.string().optional().describe("Filter by CDN+ instance number"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/cdn/v2/getCdnPlusInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_cdnplus_get_monitoring",
    "Get CDN+ monitoring data (traffic, requests) for one or more instances over a time range (Financial zone only).",
    {
      cdnInstanceNoList: z.array(z.string()).min(1).describe("List of CDN+ instance numbers to query"),
      startDate: z.string({ required_error: requiredError("startDate") }).describe("Query start datetime (format: yyyyMMddHHmm)"),
      endDate: z.string({ required_error: requiredError("endDate") }).describe("Query end datetime (format: yyyyMMddHHmm)"),
      regionNo: z.string().optional().describe("Region number (defaults to the FKR region when omitted)"),
    },
    async (params) => {
      return client.request("/cdn/v2/getCdnPlusMonitoringData", params);
    }
  );

  defineTool(
    server,
    "ncloud_cdnplus_get_usage",
    "Get CDN+ usage data (transfer volume) for one or more instances over a date range (Financial zone only).",
    {
      cdnInstanceNoList: z.array(z.string()).min(1).describe("List of CDN+ instance numbers to query"),
      startDate: z.string({ required_error: requiredError("startDate") }).describe("Query start date (format: yyyyMMdd)"),
      endDate: z.string({ required_error: requiredError("endDate") }).describe("Query end date (format: yyyyMMdd)"),
      regionNo: z.string().optional().describe("Region number (defaults to the FKR region when omitted)"),
    },
    async (params) => {
      return client.request("/cdn/v2/getCdnPlusUsageData", params);
    }
  );

  defineTool(
    server,
    "ncloud_cdnplus_request_purge",
    "Request a CDN+ cache purge (Financial zone only). isWholeDomain / isWholePurge select the scope; otherwise give domainIdList and targetFileList or targetDirectoryName.",
    {
      cdnInstanceNo: z.string({ required_error: requiredError("cdnInstanceNo") }).describe("CDN+ instance number to purge"),
      isWholeDomain: z.boolean({ required_error: requiredError("isWholeDomain") }).describe("true: purge across all domains; false: only domains in domainIdList"),
      domainIdList: z.array(z.string()).optional().describe("Domain IDs to purge (required when isWholeDomain=false)"),
      isWholePurge: z.boolean({ required_error: requiredError("isWholePurge") }).describe("true: purge all files; false: only targetFileList / targetDirectoryName"),
      targetFileList: z.array(z.string()).optional().describe("Specific file paths to purge (when isWholePurge=false)"),
      targetDirectoryName: z.string().optional().describe("Directory to purge — invalidates all files within (when isWholePurge=false)"),
    },
    async (params) => {
      if (!params.isWholeDomain && (!params.domainIdList || params.domainIdList.length === 0)) {
        return {
          content: [{ type: "text" as const, text: "domainIdList is required when isWholeDomain=false." }],
          isError: true,
        };
      }
      if (!params.isWholePurge && (!params.targetFileList || params.targetFileList.length === 0) && !params.targetDirectoryName) {
        return {
          content: [{ type: "text" as const, text: "Provide targetFileList or targetDirectoryName when isWholePurge=false." }],
          isError: true,
        };
      }
      return client.request("/cdn/v2/requestCdnPlusPurge", params);
    }
  );

  defineTool(
    server,
    "ncloud_cdnplus_get_purge_history",
    "Get CDN+ purge request history for an instance, optionally filtered by purge IDs (Financial zone only).",
    {
      cdnInstanceNo: z.string({ required_error: requiredError("cdnInstanceNo") }).describe("CDN+ instance number"),
      purgeIdList: z.array(z.string()).optional().describe("Specific purge IDs to look up"),
    },
    async (params) => {
      return client.request("/cdn/v2/getCdnPlusPurgeHistoryList", params);
    }
  );
}
