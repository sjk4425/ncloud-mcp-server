import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

// Cloud Log Analytics (NCP) API
// Base host: https://cloudloganalytics.apigw.ntruss.com  (registry에서 주입)
// 경로: /api/{regionCode}-v1/...  (regionCode 는 소문자 path segment: kr/sgn/jpn/uswn/den)
// responseFormatType 미사용 → request() 대신 requestRaw() 사용.
// 공식 docs: analytics-cloudloganalytics-*

function regionSeg(regionCode?: string): string {
  return (regionCode ?? "kr").toLowerCase();
}

export function registerLogAnalyticsTools(server: McpServer, client: NcloudClient): void {
  // ncloud_search_logs — Search logs
  server.tool(
    "ncloud_search_logs",
    "Search collected logs in Cloud Log Analytics.",
    {
      regionCode: z.string().optional().describe("Region code (kr, sgn, jpn, uswn, den). Default kr"),
      interval: z.string().optional().describe("Time interval, e.g. 5m/1h/1d (default 5m)"),
      keyword: z.string().optional().describe("Search keyword (default: all)"),
      logTypes: z.string().optional().describe("Log type filter, e.g. SYSLOG, security_log"),
      timestampFrom: z.string().optional().describe("Start Unix timestamp"),
      timestampTo: z.string().optional().describe("End Unix timestamp"),
      pageNo: z.number().optional().describe("Page number (1-100, default 1)"),
      pageSize: z.number().optional().describe("Page size (10-100, default 10)"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.interval !== undefined) body.interval = params.interval;
        if (params.keyword !== undefined) body.keyword = params.keyword;
        if (params.logTypes !== undefined) body.logTypes = params.logTypes;
        if (params.timestampFrom !== undefined) body.timestampFrom = params.timestampFrom;
        if (params.timestampTo !== undefined) body.timestampTo = params.timestampTo;
        if (params.pageNo !== undefined) body.pageNo = params.pageNo;
        if (params.pageSize !== undefined) body.pageSize = params.pageSize;
        const result = await client.requestRaw("POST", `/api/${regionSeg(params.regionCode)}-v1/logs/search`, undefined, body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_log_servers — List servers that can collect logs (replaces fictional getLogSourceList)
  server.tool(
    "ncloud_list_log_servers",
    "List servers eligible for log collection in Cloud Log Analytics (includes per-server collection status).",
    {
      regionCode: z.string().optional().describe("Region code (kr, sgn, jpn). Default kr"),
      platform: z.enum(["vpc", "classic"]).optional().describe("Platform (default vpc)"),
      pageNo: z.number().optional().describe("Page number (1-100, default 1)"),
      pageSize: z.number().optional().describe("Page size (10-100, default 10)"),
    },
    async (params) => {
      try {
        const q: Record<string, number> = {};
        if (params.pageNo !== undefined) q.pageNo = params.pageNo;
        if (params.pageSize !== undefined) q.pageSize = params.pageSize;
        const platform = params.platform ?? "vpc";
        const result = await client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/${platform}/servers`, q);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_log_count_total — Total log count
  server.tool(
    "ncloud_get_log_count_total",
    "Get the total collected log count in Cloud Log Analytics.",
    { regionCode: z.string().optional().describe("Region code (default kr)") },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/logs/count/total`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_log_count_recent — Recent log count
  server.tool(
    "ncloud_get_log_count_recent",
    "Get the recent log count in Cloud Log Analytics.",
    { regionCode: z.string().optional().describe("Region code (default kr)") },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/logs/count/recent`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_log_count_by_period — Log count over an interval
  server.tool(
    "ncloud_get_log_count_by_period",
    "Get log counts over a time interval in Cloud Log Analytics.",
    {
      regionCode: z.string().optional().describe("Region code (default kr)"),
      startTime: z.string().optional().describe("Start time (Unix ts or relative e.g. now-1h)"),
      endTime: z.string().optional().describe("End time (Unix ts or relative e.g. now)"),
      interval: z.string().optional().describe("Bucket interval: 1d/1h/1m"),
    },
    async (params) => {
      try {
        const q: Record<string, string> = {};
        if (params.startTime !== undefined) q.startTime = params.startTime;
        if (params.endTime !== undefined) q.endTime = params.endTime;
        if (params.interval !== undefined) q.interval = params.interval;
        const result = await client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/logs/count/interval`, q);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_log_count_by_type — Aggregated log count by server or log name
  server.tool(
    "ncloud_get_log_count_by_type",
    "Get aggregated log counts by type (server or log_name) in Cloud Log Analytics.",
    {
      regionCode: z.string().optional().describe("Region code (default kr)"),
      type: z.enum(["server", "log_name"]).describe("Aggregation type"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/logs/count/aggregation`, { type: params.type });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_export_logs — Export logs to Object Storage
  server.tool(
    "ncloud_export_logs",
    "Export searched logs to an Object Storage bucket in Cloud Log Analytics.",
    {
      regionCode: z.string().optional().describe("Region code (default kr)"),
      bucketname: z.string().describe("Object Storage bucket name (required)"),
      keyword: z.string().optional().describe("Search keyword"),
      logTypes: z.string().optional().describe("Log type filter (e.g. SYSLOG, security_log, tomcat)"),
      timestampFrom: z.string().optional().describe("Start time (default now-1h)"),
      timestampTo: z.string().optional().describe("End time (default now)"),
      regionNo: z.number().optional().describe("Region number"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = { bucketname: params.bucketname };
        if (params.keyword !== undefined) body.keyword = params.keyword;
        if (params.logTypes !== undefined) body.logTypes = params.logTypes;
        if (params.timestampFrom !== undefined) body.timestampFrom = params.timestampFrom;
        if (params.timestampTo !== undefined) body.timestampTo = params.timestampTo;
        if (params.regionNo !== undefined) body.regionNo = params.regionNo;
        const result = await client.requestRaw("POST", `/api/${regionSeg(params.regionCode)}-v1/logs/search/export`, undefined, body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_log_export_history — Export history
  server.tool(
    "ncloud_get_log_export_history",
    "Get the log export history in Cloud Log Analytics.",
    {
      regionCode: z.string().optional().describe("Region code (default kr)"),
      pageNo: z.number().optional().describe("Page number (1-100, default 1)"),
      pageSize: z.number().optional().describe("Page size (20-100, default 20)"),
    },
    async (params) => {
      try {
        const q: Record<string, number> = {};
        if (params.pageNo !== undefined) q.pageNo = params.pageNo;
        if (params.pageSize !== undefined) q.pageSize = params.pageSize;
        const result = await client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/export/history`, q);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_export_buckets — List Object Storage buckets available as export targets
  server.tool(
    "ncloud_list_export_buckets",
    "List Object Storage buckets available as log export targets in Cloud Log Analytics.",
    { regionCode: z.string().optional().describe("Region code (default kr)") },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/export/buckets`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_log_usage — Capacity/usage
  server.tool(
    "ncloud_get_log_usage",
    "Get the Cloud Log Analytics storage capacity and usage.",
    { regionCode: z.string().optional().describe("Region code (default kr)") },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/${regionSeg(params.regionCode)}-v1/capacity`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
