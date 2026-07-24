import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

export function registerCloudInsightTools(server: McpServer, client: NcloudClient): void {
  // ncloud_query_monitoring_data — Query time-series monitoring data from Cloud Insight
  defineTool(
    server,
    "ncloud_query_monitoring_data",
    "Query time-series monitoring data from Cloud Insight. Returns metric data for a specific product and metric.",
    {
      cw_key: z.string().describe("Product key (cw_key) identifying the service (see Cloud Insight metrics)"),
      prodName: z.string().describe("Product name (e.g., \"System/Server(VPC)\")"),
      metric: z.string().describe("Metric name to query (e.g., \"avg_cpu_used_rto\", \"mem_usert\")"),
      timeStart: z.number().describe("Start time in Unix epoch milliseconds"),
      timeEnd: z.number().describe("End time in Unix epoch milliseconds"),
      interval: z.enum(["Min1", "Min5", "Min30", "Hour2", "Day1"]).optional().describe("Aggregation interval (default: Min5)"),
      aggregation: z.enum(["AVG", "MIN", "MAX", "SUM", "COUNT"]).optional().describe("Aggregation type (default: AVG)"),
      dimensions: z.record(z.string()).optional().describe("Dimension filters as key-value pairs (e.g., {\"instanceNo\": \"12345\"})"),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        cw_key: params.cw_key,
        prodName: params.prodName,
        metric: params.metric,
        timeStart: params.timeStart,
        timeEnd: params.timeEnd,
      };
      if (params.interval !== undefined) body.interval = params.interval;
      if (params.aggregation !== undefined) body.aggregation = params.aggregation;
      if (params.dimensions !== undefined) body.dimensions = params.dimensions;

      const result = await client.postRequest("/cw_fea/real/cw/api/data/query", body);
      return result;
    }
  );

  // ncloud_query_monitoring_data_multiple — Query multiple time-series monitoring data
  defineTool(
    server,
    "ncloud_query_monitoring_data_multiple",
    "Query multiple time-series monitoring data from Cloud Insight in a single request. Supports querying multiple metrics at once.",
    {
      metrics: z.array(z.object({
        prodKey: z.string().describe("Product key (cw_key)"),
        metricGroupItemId: z.string().describe("Metric group item ID"),
        metricGroupId: z.string().describe("Metric group ID"),
        dimensions: z.record(z.string()).optional().describe("Dimension filters"),
      })).describe("Array of metric queries to execute"),
      timeStart: z.number().describe("Start time in Unix epoch milliseconds"),
      timeEnd: z.number().describe("End time in Unix epoch milliseconds"),
      interval: z.enum(["Min1", "Min5", "Min30", "Hour2", "Day1"]).optional().describe("Aggregation interval (default: Min5)"),
      aggregation: z.enum(["AVG", "MIN", "MAX", "SUM", "COUNT"]).optional().describe("Aggregation type (default: AVG)"),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        metrics: params.metrics,
        timeStart: params.timeStart,
        timeEnd: params.timeEnd,
      };
      if (params.interval !== undefined) body.interval = params.interval;
      if (params.aggregation !== undefined) body.aggregation = params.aggregation;

      const result = await client.postRequest("/cw_fea/real/cw/api/data/query/multiple", body);
      return result;
    }
  );

  // ncloud_search_events — Search monitoring events
  defineTool(
    server,
    "ncloud_search_events",
    "Search and get monitoring events from Cloud Insight with filtering options.",
    {
      startTime: z.number().describe("Start time in Unix epoch milliseconds"),
      endTime: z.number().describe("End time in Unix epoch milliseconds"),
      prodKey: z.string().optional().describe("Product key to filter events"),
      ruleGroupId: z.string().optional().describe("Rule group ID to filter events"),
      eventLevel: z.enum(["CRITICAL", "WARNING", "INFO"]).optional().describe("Event severity level filter"),
      pageSize: z.number().optional().describe("Number of results per page (default: 20)"),
      pageNum: z.number().optional().describe("Page number (default: 1)"),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        startTime: params.startTime,
        endTime: params.endTime,
      };
      if (params.prodKey !== undefined) body.prodKey = params.prodKey;
      if (params.ruleGroupId !== undefined) body.ruleGroupId = params.ruleGroupId;
      if (params.eventLevel !== undefined) body.eventLevel = params.eventLevel;
      if (params.pageSize !== undefined) body.pageSize = params.pageSize;
      if (params.pageNum !== undefined) body.pageNum = params.pageNum;

      const result = await client.postRequest("/cw_fea/real/cw/api/event/search", body);
      return result;
    }
  );

  // ncloud_search_event_by_id — Get event details by event ID
  defineTool(
    server,
    "ncloud_search_event_by_id",
    "Get detailed information about a specific monitoring event by event ID and rule ID.",
    {
      eventId: z.string().describe("Event ID to retrieve details for"),
      ruleId: z.string().describe("Rule ID associated with the event"),
    },
    async (params) => {
      const body = {
        eventId: params.eventId,
        ruleId: params.ruleId,
      };

      const result = await client.postRequest("/cw_fea/real/cw/api/event/searchById", body);
      return result;
    }
  );

  // ncloud_list_dashboards — Get Cloud Insight dashboard list
  defineTool(
    server,
    "ncloud_list_dashboards",
    "Get the list of Cloud Insight monitoring dashboards.",
    {},
    async () => {
      return client.requestRaw("GET", "/cw_fea/real/cw/api/chart/dashboard");
    }
  );

  // ncloud_send_monitoring_data — Send custom monitoring data to Cloud Insight
  defineTool(
    server,
    "ncloud_send_monitoring_data",
    "Send custom JSON monitoring data to Cloud Insight for user-defined metrics.",
    {
      prodKey: z.string().describe("Product key (cw_key) for the custom schema"),
      data: z.array(z.object({
        dimensions: z.record(z.string()).describe("Dimension key-value pairs identifying the resource"),
        metrics: z.array(z.object({
          metricGroupId: z.string().describe("Metric group ID"),
          metricGroupItemId: z.string().describe("Metric group item ID"),
          value: z.number().describe("Metric value"),
          timestamp: z.number().optional().describe("Timestamp in Unix epoch milliseconds (default: current time)"),
        })).describe("Array of metric data points"),
      })).describe("Array of data entries to send"),
    },
    async (params) => {
      const body = {
        prodKey: params.prodKey,
        data: params.data,
      };

      const result = await client.postRequest("/cw_fea/real/cw/api/data", body);
      return result;
    }
  );

  // ncloud_search_event_count — Search event count
  defineTool(
    server,
    "ncloud_search_event_count",
    "Get the count of monitoring events from Cloud Insight within a specified time range.",
    {
      startTime: z.number().describe("Start time in Unix epoch milliseconds"),
      endTime: z.number().describe("End time in Unix epoch milliseconds"),
      prodKey: z.string().optional().describe("Product key to filter events"),
      ruleGroupId: z.string().optional().describe("Rule group ID to filter events"),
      eventLevel: z.enum(["CRITICAL", "WARNING", "INFO"]).optional().describe("Event severity level filter"),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        startTime: params.startTime,
        endTime: params.endTime,
      };
      if (params.prodKey !== undefined) body.prodKey = params.prodKey;
      if (params.ruleGroupId !== undefined) body.ruleGroupId = params.ruleGroupId;
      if (params.eventLevel !== undefined) body.eventLevel = params.eventLevel;

      const result = await client.postRequest("/cw_fea/real/cw/api/event/search/count", body);
      return result;
    }
  );

  // ncloud_get_dashboard_widgets — Get dashboard widget list
  defineTool(
    server,
    "ncloud_get_dashboard_widgets",
    "Get the list of widgets for a specific Cloud Insight dashboard.",
    {
      dashboardId: z.string().describe("Dashboard ID to get widgets for"),
    },
    async (params) => {
      return client.requestRaw("GET", `/cw_fea/real/cw/api/chart/dashboard/${encodeURIComponent(params.dashboardId)}/widget`);
    }
  );

  // ncloud_get_dashboard_widget_image — Get dashboard widget image
  defineTool(
    server,
    "ncloud_get_dashboard_widget_image",
    "Download a dashboard widget image from Cloud Insight. Returns image data as base64.",
    {
      dashboardId: z.string().describe("Dashboard ID"),
      widgetId: z.string().describe("Widget ID to get image for"),
    },
    async (params) => {
      return client.requestRaw("GET", `/cw_fea/real/cw/api/chart/dashboard/${encodeURIComponent(params.dashboardId)}/widget/${encodeURIComponent(params.widgetId)}/image`);
    }
  );

  // ncloud_query_widget_preview — Query widget data preview
  defineTool(
    server,
    "ncloud_query_widget_preview",
    "Query widget preview data from Cloud Insight by specifying metrics directly.",
    {
      prodKey: z.string().describe("Product key (cw_key)"),
      metric: z.string().describe("Metric name to query"),
      interval: z.enum(["Min1", "Min5", "Min30", "Hour2", "Day1"]).optional().describe("Aggregation interval"),
      aggregation: z.enum(["AVG", "MIN", "MAX", "SUM", "COUNT"]).optional().describe("Aggregation type"),
      timeStart: z.number().describe("Start time in Unix epoch milliseconds"),
      timeEnd: z.number().describe("End time in Unix epoch milliseconds"),
      dimensions: z.record(z.string()).optional().describe("Dimension filters as key-value pairs"),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        prodKey: params.prodKey,
        metric: params.metric,
        timeStart: params.timeStart,
        timeEnd: params.timeEnd,
      };
      if (params.interval !== undefined) body.interval = params.interval;
      if (params.aggregation !== undefined) body.aggregation = params.aggregation;
      if (params.dimensions !== undefined) body.dimensions = params.dimensions;

      const result = await client.postRequest("/cw_fea/real/cw/api/data/widget/preview", body);
      return result;
    }
  );

  // ncloud_get_servers_top — Get top 5 servers by CPU/memory/filesystem usage
  defineTool(
    server,
    "ncloud_get_servers_top",
    "Get the top 5 servers by CPU, memory, or filesystem usage from Cloud Insight monitoring.",
    {
      metricType: z.enum(["cpu", "memory", "fs"]).describe("Metric type to rank servers by (cpu, memory, or fs)"),
    },
    async (params) => {
      const body = {
        metricType: params.metricType,
      };

      const result = await client.postRequest("/cw_fea/real/cw/api/server/top", body);
      return result;
    }
  );
}
