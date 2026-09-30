import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { ZONE_PROFILES, type Zone } from "../client/endpoints.js";

// Cloud Log Analytics (NCP) API
// Base host: https://cloudloganalytics.apigw.ntruss.com (민간존) / https://cloudloganalytics.apigw.gov-ntruss.com (공공존) — registry에서 주입
// 경로: /api/{regionCode}-v1/...  (regionCode 는 소문자 path segment — 민간존 kr/sgn/jpn/uswn/den, 공공존 kr/krs, 금융존 fkr)
//   두 존 개요 페이지(analytics-cloudloganalytics): "요청 경로 파라미터에 리전 코드를 입력하는 경우 사용 중인 플랫폼과 리전 환경에 맞게 입력".
//   기본값은 클라이언트의 활성 리전(NCLOUD_REGION / ncloud_set_region) — 이전에는 리전과 무관하게 항상 kr 이었다.
// responseFormatType 미사용 → request() 대신 requestRaw() 사용.
// 공식 docs: analytics-cloudloganalytics-* (오퍼레이션 목록 민간·공공존 동일, 2026-09-30 대조)
//   금융존(api-fin): classic 플랫폼 페이지 없음(vpc 만), 서버 로그 수집 해제(deleteserverlogsetting-vpc-server)는 금융존 가이드에만 있다.

export interface LogAnalyticsToolOptions {
  /** 존 — 리전 코드 안내 문구·플랫폼 선택지·존 전용 도구에 쓴다. 기본 `public`. */
  zone?: Zone;
}

export function registerLogAnalyticsTools(server: McpServer, client: NcloudClient, opts: LogAnalyticsToolOptions = {}): void {
  const zone: Zone = opts.zone ?? "pub";
  const regionCodes = ZONE_PROFILES[zone].regions.map((r) => r.code.toLowerCase()).join(", ");
  const REGION_DESC = `Region code as a lowercase path segment (${regionCodes}). Default: the client's active region`;
  /** 경로 세그먼트: 명시값 > 클라이언트 활성 리전. */
  const regionSeg = (regionCode?: string): string => (regionCode ?? client.getRegionCode()).toLowerCase();
  // 금융존 가이드에는 classic 서버 목록 페이지가 없다(getserverlist-classic-* 404) — vpc 만 허용.
  const platformSchema = zone === "fin"
    ? z.enum(["vpc"]).optional().describe("Platform (Financial zone: vpc only)")
    : z.enum(["vpc", "classic"]).optional().describe("Platform (default vpc)");

  // ncloud_search_logs — Search logs
  defineTool(
    server,
    "ncloud_search_logs",
    "Search collected logs in Cloud Log Analytics.",
    {
      regionCode: z.string().optional().describe(REGION_DESC),
      interval: z.string().optional().describe("Time interval, e.g. 5m/1h/1d (default 5m)"),
      keyword: z.string().optional().describe("Search keyword (default: all)"),
      logTypes: z.string().optional().describe("Log type filter, e.g. SYSLOG, security_log"),
      timestampFrom: z.string().optional().describe("Start Unix timestamp"),
      timestampTo: z.string().optional().describe("End Unix timestamp"),
      pageNo: z.number().optional().describe("Page number (1-100, default 1)"),
      pageSize: z.number().optional().describe("Page size (10-100, default 10)"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.interval !== undefined) body.interval = params.interval;
      if (params.keyword !== undefined) body.keyword = params.keyword;
      if (params.logTypes !== undefined) body.logTypes = params.logTypes;
      if (params.timestampFrom !== undefined) body.timestampFrom = params.timestampFrom;
      if (params.timestampTo !== undefined) body.timestampTo = params.timestampTo;
      if (params.pageNo !== undefined) body.pageNo = params.pageNo;
      if (params.pageSize !== undefined) body.pageSize = params.pageSize;
      const result = await client.requestRaw("POST", `/api/${regionSeg(params.regionCode)}-v1/logs/search`, undefined, body);
      return result;
    }
  );

  // ncloud_list_log_servers — List servers that can collect logs (replaces fictional getLogSourceList)
  defineTool(
    server,
    "ncloud_list_log_servers",
    "List servers eligible for log collection in Cloud Log Analytics (includes per-server collection status).",
    {
      regionCode: z.string().optional().describe(REGION_DESC),
      platform: platformSchema,
      pageNo: z.number().optional().describe("Page number (1-100, default 1)"),
      pageSize: z.number().optional().describe("Page size (10-100, default 10)"),
    },
    async (params) => {
      const q: Record<string, number> = {};
      if (params.pageNo !== undefined) q.pageNo = params.pageNo;
      if (params.pageSize !== undefined) q.pageSize = params.pageSize;
      const platform = params.platform ?? "vpc";
      const result = await client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/${platform}/servers`, q);
      return result;
    }
  );

  // ncloud_set_server_log_collection — 서버 로그 수집 설정 (analytics-cloudloganalytics-changeserverlogsetting-vpc-server, 세 존 동일 바디)
  defineTool(
    server,
    "ncloud_set_server_log_collection",
    "Configure log collection on VPC servers in Cloud Log Analytics. Returns the agent install key and the install command to run on each server.",
    {
      regionCode: z.string().optional().describe(REGION_DESC),
      collectingInfos: z
        .array(
          z.object({
            logPath: z.string().describe("Log path to collect, e.g. /var/log/messages"),
            logTemplate: z.string().describe("Log template, e.g. SYSLOG, APACHE, TOMCAT"),
            logType: z.string().describe("Log type, e.g. SYSLOG, security_log"),
            servername: z.string().describe("Target server name (from ncloud_list_log_servers)"),
            osType: z.string().describe("Target server OS type (from ncloud_list_log_servers)"),
            instanceNo: z.number().describe("Target server instance number"),
            ip: z.string().optional().describe("Target server IP address"),
            macAddr: z.string().describe("Target server MAC address (from ncloud_list_log_servers)"),
          })
        )
        .min(1)
        .describe("Log collection settings, one entry per log path/server"),
    },
    async (params) => {
      const body = { collectingInfos: params.collectingInfos };
      return client.requestRaw("POST", `/api/${regionSeg(params.regionCode)}-v1/vpc/servers/collecting-infos`, undefined, body);
    }
  );

  // ncloud_delete_server_log_collection — 서버 로그 수집 해제 (금융존 가이드에만: analytics-cloudloganalytics-deleteserverlogsetting-vpc-server)
  if (zone === "fin") {
    defineTool(
      server,
      "ncloud_delete_server_log_collection",
      "⚠️ Destructive: Stop log collection for a VPC server in Cloud Log Analytics (the agent must be removed on the server separately). Set confirm=true to execute.",
      {
        regionCode: z.string().optional().describe(REGION_DESC),
        instanceNo: z.number().describe("Instance number of the server to stop collecting from"),
        confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
      },
      async (params) => client.requestRaw("DELETE", `/api/${regionSeg(params.regionCode)}-v1/vpc/servers/collecting-infos/${params.instanceNo}`),
      { destructive: { message: (params) => `⚠️ This will stop log collection for server instance [${params.instanceNo}]. To execute, call again with confirm=true.` } }
    );
  }

  // ncloud_get_log_count_total — Total log count
  defineTool(
    server,
    "ncloud_get_log_count_total",
    "Get the total collected log count in Cloud Log Analytics.",
    { regionCode: z.string().optional().describe(REGION_DESC) },
    async (params) => {
      return client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/logs/count/total`);
    }
  );

  // ncloud_get_log_count_recent — Recent log count
  defineTool(
    server,
    "ncloud_get_log_count_recent",
    "Get the recent log count in Cloud Log Analytics.",
    { regionCode: z.string().optional().describe(REGION_DESC) },
    async (params) => {
      return client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/logs/count/recent`);
    }
  );

  // ncloud_get_log_count_by_period — Log count over an interval
  defineTool(
    server,
    "ncloud_get_log_count_by_period",
    "Get log counts over a time interval in Cloud Log Analytics.",
    {
      regionCode: z.string().optional().describe(REGION_DESC),
      startTime: z.string().optional().describe("Start time (Unix ts or relative e.g. now-1h)"),
      endTime: z.string().optional().describe("End time (Unix ts or relative e.g. now)"),
      interval: z.string().optional().describe("Bucket interval: 1d/1h/1m"),
    },
    async (params) => {
      const q: Record<string, string> = {};
      if (params.startTime !== undefined) q.startTime = params.startTime;
      if (params.endTime !== undefined) q.endTime = params.endTime;
      if (params.interval !== undefined) q.interval = params.interval;
      const result = await client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/logs/count/interval`, q);
      return result;
    }
  );

  // ncloud_get_log_count_by_type — Aggregated log count by server or log name
  defineTool(
    server,
    "ncloud_get_log_count_by_type",
    "Get aggregated log counts by type (server or log_name) in Cloud Log Analytics.",
    {
      regionCode: z.string().optional().describe(REGION_DESC),
      type: z.enum(["server", "log_name"]).describe("Aggregation type"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/logs/count/aggregation`, { type: params.type });
    }
  );

  // ncloud_export_logs — Export logs to Object Storage
  defineTool(
    server,
    "ncloud_export_logs",
    "Export searched logs to an Object Storage bucket in Cloud Log Analytics.",
    {
      regionCode: z.string().optional().describe(REGION_DESC),
      bucketname: z.string().describe("Object Storage bucket name (required)"),
      keyword: z.string().optional().describe("Search keyword"),
      logTypes: z.string().optional().describe("Log type filter (e.g. SYSLOG, security_log, tomcat)"),
      timestampFrom: z.string().optional().describe("Start time (default now-1h)"),
      timestampTo: z.string().optional().describe("End time (default now)"),
      regionNo: z.number().optional().describe("Region number"),
    },
    async (params) => {
      const body: Record<string, unknown> = { bucketname: params.bucketname };
      if (params.keyword !== undefined) body.keyword = params.keyword;
      if (params.logTypes !== undefined) body.logTypes = params.logTypes;
      if (params.timestampFrom !== undefined) body.timestampFrom = params.timestampFrom;
      if (params.timestampTo !== undefined) body.timestampTo = params.timestampTo;
      if (params.regionNo !== undefined) body.regionNo = params.regionNo;
      const result = await client.requestRaw("POST", `/api/${regionSeg(params.regionCode)}-v1/logs/search/export`, undefined, body);
      return result;
    }
  );

  // ncloud_get_log_export_history — Export history
  defineTool(
    server,
    "ncloud_get_log_export_history",
    "Get the log export history in Cloud Log Analytics.",
    {
      regionCode: z.string().optional().describe(REGION_DESC),
      pageNo: z.number().optional().describe("Page number (1-100, default 1)"),
      pageSize: z.number().optional().describe("Page size (20-100, default 20)"),
    },
    async (params) => {
      const q: Record<string, number> = {};
      if (params.pageNo !== undefined) q.pageNo = params.pageNo;
      if (params.pageSize !== undefined) q.pageSize = params.pageSize;
      const result = await client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/export/history`, q);
      return result;
    }
  );

  // ncloud_list_export_buckets — List Object Storage buckets available as export targets
  defineTool(
    server,
    "ncloud_list_export_buckets",
    "List Object Storage buckets available as log export targets in Cloud Log Analytics.",
    { regionCode: z.string().optional().describe(REGION_DESC) },
    async (params) => {
      return client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/export/buckets`);
    }
  );

  // ncloud_get_log_usage — Capacity/usage
  defineTool(
    server,
    "ncloud_get_log_usage",
    "Get the Cloud Log Analytics storage capacity and usage.",
    { regionCode: z.string().optional().describe(REGION_DESC) },
    async (params) => {
      return client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/capacity`);
    }
  );
}
