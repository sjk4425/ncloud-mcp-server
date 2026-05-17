import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

export function registerLogAnalyticsTools(server: McpServer, client: NcloudClient): void {
  // ncloud_search_logs — Search logs by keyword, period, and log source
  server.tool(
    "ncloud_search_logs",
    "Search cloud log analytics logs with filtering by keyword, time period, and log source",
    {
      keyword: z.string().optional().describe("Search keyword to filter logs"),
      startTime: z.string().optional().describe("Start time in ISO 8601 format (e.g., \"2024-01-01T00:00:00Z\")"),
      endTime: z.string().optional().describe("End time in ISO 8601 format (e.g., \"2024-01-31T23:59:59Z\")"),
      logSource: z.string().optional().describe("Log source identifier to filter (e.g., server, database, loadbalancer)"),
      regionCode: z.string().optional().describe("Region code (KR, JPN, SGN, etc.)"),
      pageNo: z.number().optional().describe("Page number (default 1)"),
      pageSize: z.number().optional().describe("Page size (default 50)"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string | number | undefined> = {};
        if (params.keyword !== undefined) apiParams.keyword = params.keyword;
        if (params.startTime !== undefined) apiParams.startTime = params.startTime;
        if (params.endTime !== undefined) apiParams.endTime = params.endTime;
        if (params.logSource !== undefined) apiParams.logSource = params.logSource;
        if (params.regionCode !== undefined) apiParams.regionCode = params.regionCode;
        if (params.pageNo !== undefined) apiParams.pageNo = params.pageNo;
        if (params.pageSize !== undefined) apiParams.pageSize = params.pageSize;

        const result = await client.request("/cloudloganalytics/v2/searchLogs", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_log_sources — List available log sources for collection
  server.tool(
    "ncloud_list_log_sources",
    "Get list of available log sources that can be collected by Cloud Log Analytics",
    {
      regionCode: z.string().optional().describe("Region code (KR, JPN, SGN, etc.)"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string | undefined> = {};
        if (params.regionCode !== undefined) apiParams.regionCode = params.regionCode;

        const result = await client.request("/cloudloganalytics/v2/getLogSourceList", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_log_config — Get current log collection configuration
  server.tool(
    "ncloud_get_log_config",
    "Get current log collection configuration for Cloud Log Analytics",
    {
      regionCode: z.string().optional().describe("Region code (KR, JPN, SGN, etc.)"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string | undefined> = {};
        if (params.regionCode !== undefined) apiParams.regionCode = params.regionCode;

        const result = await client.request("/cloudloganalytics/v2/getLogConfig", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_log_count_total — Get total collected log count
  server.tool(
    "ncloud_get_log_count_total",
    "Get total number of collected logs in Cloud Log Analytics",
    {
      regionCode: z.string({ required_error: "필수 파라미터 'regionCode'가 누락되었습니다." }).describe("Region code (KR, JPN, SGN, etc.)"),
    },
    async (params) => {
      try {
        const result = await client.request("/cloudloganalytics/v2/getLogCountTotal", {
          regionCode: params.regionCode,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_log_count_recent — Get recent (last 1 minute) collected log count
  server.tool(
    "ncloud_get_log_count_recent",
    "Get number of logs collected in the last 1 minute in Cloud Log Analytics",
    {
      regionCode: z.string({ required_error: "필수 파라미터 'regionCode'가 누락되었습니다." }).describe("Region code (KR, JPN, SGN, etc.)"),
    },
    async (params) => {
      try {
        const result = await client.request("/cloudloganalytics/v2/getLogCountRecent", {
          regionCode: params.regionCode,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_log_count_by_period — Get collected log count by period
  server.tool(
    "ncloud_get_log_count_by_period",
    "Get number of collected logs grouped by time period in Cloud Log Analytics",
    {
      regionCode: z.string({ required_error: "필수 파라미터 'regionCode'가 누락되었습니다." }).describe("Region code (KR, JPN, SGN, etc.)"),
      startTime: z.string({ required_error: "필수 파라미터 'startTime'이 누락되었습니다." }).describe("Start time in ISO 8601 format (e.g., \"2024-01-01T00:00:00Z\")"),
      endTime: z.string({ required_error: "필수 파라미터 'endTime'이 누락되었습니다." }).describe("End time in ISO 8601 format (e.g., \"2024-01-31T23:59:59Z\")"),
    },
    async (params) => {
      try {
        const result = await client.request("/cloudloganalytics/v2/getLogCountByPeriod", {
          regionCode: params.regionCode,
          startTime: params.startTime,
          endTime: params.endTime,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_log_count_by_type — Get collected log count by type
  server.tool(
    "ncloud_get_log_count_by_type",
    "Get number of collected logs grouped by log type in Cloud Log Analytics",
    {
      regionCode: z.string({ required_error: "필수 파라미터 'regionCode'가 누락되었습니다." }).describe("Region code (KR, JPN, SGN, etc.)"),
      startTime: z.string({ required_error: "필수 파라미터 'startTime'이 누락되었습니다." }).describe("Start time in ISO 8601 format (e.g., \"2024-01-01T00:00:00Z\")"),
      endTime: z.string({ required_error: "필수 파라미터 'endTime'이 누락되었습니다." }).describe("End time in ISO 8601 format (e.g., \"2024-01-31T23:59:59Z\")"),
    },
    async (params) => {
      try {
        const result = await client.request("/cloudloganalytics/v2/getLogCountByType", {
          regionCode: params.regionCode,
          startTime: params.startTime,
          endTime: params.endTime,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_export_logs — Export collected logs to Object Storage
  server.tool(
    "ncloud_export_logs",
    "Export collected logs to Object Storage bucket in Cloud Log Analytics",
    {
      regionCode: z.string({ required_error: "필수 파라미터 'regionCode'가 누락되었습니다." }).describe("Region code (KR, JPN, SGN, etc.)"),
      bucketName: z.string({ required_error: "필수 파라미터 'bucketName'이 누락되었습니다." }).describe("Object Storage bucket name to export logs to"),
      startTime: z.string({ required_error: "필수 파라미터 'startTime'이 누락되었습니다." }).describe("Export start time in ISO 8601 format (e.g., \"2024-01-01T00:00:00Z\")"),
      endTime: z.string({ required_error: "필수 파라미터 'endTime'이 누락되었습니다." }).describe("Export end time in ISO 8601 format (e.g., \"2024-01-31T23:59:59Z\")"),
      logType: z.string().optional().describe("Log type to export (optional filter)"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string> = {
          regionCode: params.regionCode,
          bucketName: params.bucketName,
          startTime: params.startTime,
          endTime: params.endTime,
        };
        if (params.logType !== undefined) apiParams.logType = params.logType;

        const result = await client.request("/cloudloganalytics/v2/exportLogs", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_log_export_history — Get log export history
  server.tool(
    "ncloud_get_log_export_history",
    "Get history of log exports to Object Storage in Cloud Log Analytics",
    {
      regionCode: z.string({ required_error: "필수 파라미터 'regionCode'가 누락되었습니다." }).describe("Region code (KR, JPN, SGN, etc.)"),
    },
    async (params) => {
      try {
        const result = await client.request("/cloudloganalytics/v2/getLogExportHistory", {
          regionCode: params.regionCode,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_log_usage — Get Cloud Log Analytics usage
  server.tool(
    "ncloud_get_log_usage",
    "Get Cloud Log Analytics usage information including storage and collection volume",
    {
      regionCode: z.string({ required_error: "필수 파라미터 'regionCode'가 누락되었습니다." }).describe("Region code (KR, JPN, SGN, etc.)"),
    },
    async (params) => {
      try {
        const result = await client.request("/cloudloganalytics/v2/getLogUsage", {
          regionCode: params.regionCode,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
