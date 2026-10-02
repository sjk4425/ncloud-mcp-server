import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError } from "./_messages.js";

/**
 * Cloud Insight 데이터 조회·이벤트·대시보드 도구.
 *
 * 경로·바디는 공식 가이드(management-cloudinsight-{querydata,querydatamultiple,searchevent,searcheventbyid,
 * searcheventcountconsole,getdashboardlist,getdashboardwidgetlist,getdashboardwidgetimage,querywidgetdatapreview,
 * senddata,getserverstop}, DTO common-vapidatatype-ci{dataqueryrequest,dataqueryrequestmetricinfo,eventsearchrequest,
 * eventsearchrequestbyid,chartdatawidgetdto,widgetmetricinfodto}, 2026-10-02 대조)를 따른다.
 * 세 존 모두 cw.apigw.* 호스트 + 동일 경로.
 */
const CW = "/cw_fea/real/cw/api";

export function registerCloudInsightTools(server: McpServer, client: NcloudClient): void {
  const INTERVAL = z.enum(["Min1", "Min5", "Min30", "Hour2", "Day1"]);
  const CALC = z.enum(["COUNT", "SUM", "MAX", "MIN", "AVG"]);

  const pick = (src: Record<string, unknown>, keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
    return out;
  };

  // ncloud_query_monitoring_data — POST /data/query (querydata, DataQueryRequest)
  defineTool(
    server,
    "ncloud_query_monitoring_data",
    "Query time-series monitoring data from Cloud Insight. Returns metric data for a specific product and metric. The aggregation must match one configured in the product schema.",
    {
      cw_key: z.string({ required_error: requiredError("cw_key") }).describe("Product key (cw_key) identifying the service (see Cloud Insight metrics)"),
      metric: z.string({ required_error: requiredError("metric") }).describe("Metric name to query (e.g., \"avg_cpu_used_rto\", \"mem_usert\")"),
      timeStart: z.number({ required_error: requiredError("timeStart") }).describe("Start time in Unix epoch milliseconds"),
      timeEnd: z.number({ required_error: requiredError("timeEnd") }).describe("End time in Unix epoch milliseconds"),
      dimensions: z.record(z.string()).describe("Dimensions identifying the resource as key-value pairs (required, e.g., {\"instanceNo\": \"12345\"})"),
      productName: z.string().optional().describe("Product name (e.g., \"System/Server(VPC)\")"),
      interval: INTERVAL.optional().describe("Aggregation interval (default: Min1)"),
      aggregation: CALC.optional().describe("Aggregation type (default: AVG)"),
      queryAggregation: CALC.optional().describe("How to aggregate query results when the query interval is coarser than stored data (default: AVG)"),
    },
    async (params) => {
      const body = pick(params, ["cw_key", "metric", "timeStart", "timeEnd", "dimensions", "productName", "interval", "aggregation", "queryAggregation"]);
      return client.postRequest(`${CW}/data/query`, body);
    }
  );

  // ncloud_query_monitoring_data_multiple — POST /data/query/multiple (querydatamultiple, metricInfoList: DataQueryRequestMetricInfo[])
  defineTool(
    server,
    "ncloud_query_monitoring_data_multiple",
    "Query multiple time-series monitoring data from Cloud Insight in a single request (up to 20 metric conditions).",
    {
      metricInfoList: z.array(z.object({
        prodKey: z.string().describe("Product key (cw_key)"),
        metric: z.string().describe("Metric name to query"),
        interval: INTERVAL.describe("Aggregation interval"),
        dimensions: z.record(z.string()).describe("Dimensions identifying the resource as key-value pairs"),
        aggregation: CALC.optional().describe("Aggregation type (default: AVG)"),
        queryAggregation: CALC.optional().describe("Query result aggregation (default: AVG)"),
      })).min(1).max(20).describe("Array of metric queries to execute (max 20)"),
      timeStart: z.number({ required_error: requiredError("timeStart") }).describe("Start time in Unix epoch milliseconds"),
      timeEnd: z.number({ required_error: requiredError("timeEnd") }).describe("End time in Unix epoch milliseconds"),
    },
    async (params) => {
      return client.postRequest(`${CW}/data/query/multiple`, { timeStart: params.timeStart, timeEnd: params.timeEnd, metricInfoList: params.metricInfoList });
    }
  );

  // ncloud_search_events — POST /event/search (searchevent, EventSearchRequest)
  defineTool(
    server,
    "ncloud_search_events",
    "Search and get monitoring events from Cloud Insight with filtering options.",
    {
      startTime: z.number({ required_error: requiredError("startTime") }).describe("Start time in Unix epoch milliseconds"),
      endTime: z.number({ required_error: requiredError("endTime") }).describe("End time in Unix epoch milliseconds"),
      ruleId: z.string().optional().describe("Event Rule ID to filter events"),
      eventId: z.string().optional().describe("Event ID to filter"),
      query: z.string().optional().describe("Search by rule name, metric name or resource name"),
      pageSize: z.number().optional().describe("Number of results per page (default: 20)"),
      pageNum: z.number().optional().describe("Page number (default: 1)"),
      onlyFetchUnCloseEvent: z.boolean().optional().describe("Only return events that are not closed yet (default: false)"),
    },
    async (params) => {
      const body = pick(params, ["startTime", "endTime", "ruleId", "eventId", "query", "pageSize", "pageNum", "onlyFetchUnCloseEvent"]);
      return client.postRequest(`${CW}/event/search`, body);
    }
  );

  // ncloud_search_event_by_id — POST /event/searchById (searcheventbyid, EventSearchRequestById)
  defineTool(
    server,
    "ncloud_search_event_by_id",
    "Get detailed information about a specific monitoring event by event ID and rule ID.",
    {
      eventId: z.string({ required_error: requiredError("eventId") }).describe("Event ID to retrieve details for"),
      ruleId: z.string({ required_error: requiredError("ruleId") }).describe("Event Rule ID associated with the event"),
      startTime: z.number({ required_error: requiredError("startTime") }).describe("Start time in Unix epoch milliseconds"),
      endTime: z.number({ required_error: requiredError("endTime") }).describe("End time in Unix epoch milliseconds"),
      query: z.string().optional().describe("Search by rule name, metric name or resource name"),
      pageSize: z.number().optional().describe("Number of results per page (default: 20)"),
      pageNum: z.number().optional().describe("Page number (default: 1)"),
      onlyFetchUnCloseEvent: z.boolean().optional().describe("Only return events that are not closed yet (default: false)"),
    },
    async (params) => {
      const body = pick(params, ["eventId", "ruleId", "startTime", "endTime", "query", "pageSize", "pageNum", "onlyFetchUnCloseEvent"]);
      return client.postRequest(`${CW}/event/searchById`, body);
    }
  );

  // ncloud_search_event_count — POST /event/searchEventCountConsole (searcheventcountconsole)
  defineTool(
    server,
    "ncloud_search_event_count",
    "Get the count of monitoring events from Cloud Insight within a specified time range.",
    {
      startTime: z.number({ required_error: requiredError("startTime") }).describe("Start time in Unix epoch milliseconds"),
      endTime: z.number({ required_error: requiredError("endTime") }).describe("End time in Unix epoch milliseconds"),
    },
    async (params) => {
      return client.postRequest(`${CW}/event/searchEventCountConsole`, { startTime: params.startTime, endTime: params.endTime });
    }
  );

  // ncloud_list_dashboards — GET /chart/dashboard (getdashboardlist)
  defineTool(
    server,
    "ncloud_list_dashboards",
    "Get the list of Cloud Insight monitoring dashboards.",
    {},
    async () => {
      return client.requestRaw("GET", `${CW}/chart/dashboard`);
    }
  );

  // ncloud_get_dashboard_widgets — GET /chart/dashboard/{dashboardId}/widgets (getdashboardwidgetlist)
  defineTool(
    server,
    "ncloud_get_dashboard_widgets",
    "Get the list of widgets for a specific Cloud Insight dashboard.",
    {
      dashboardId: z.string({ required_error: requiredError("dashboardId") }).describe("Dashboard ID to get widgets for"),
    },
    async (params) => {
      return client.requestRaw("GET", `${CW}/chart/dashboard/${encodeURIComponent(params.dashboardId)}/widgets`);
    }
  );

  // ncloud_get_dashboard_widget_image — GET /chart/dashboard/{dashboardId}/widgets/{widgetId}?startTime&endTime&widgetResolutionMode (getdashboardwidgetimage)
  defineTool(
    server,
    "ncloud_get_dashboard_widget_image",
    "Download a dashboard widget image (binary) from Cloud Insight. Returns content type and size, plus base64 data when small; pass savePath to write the image to a file instead.",
    {
      dashboardId: z.string({ required_error: requiredError("dashboardId") }).describe("Dashboard ID"),
      widgetId: z.string({ required_error: requiredError("widgetId") }).describe("Widget ID (see ncloud_get_dashboard_widgets)"),
      startTime: z.number({ required_error: requiredError("startTime") }).describe("Start time in Unix epoch milliseconds"),
      endTime: z.number({ required_error: requiredError("endTime") }).describe("End time in Unix epoch milliseconds"),
      widgetResolutionMode: z.enum(["AUTO", "HIGH"]).optional().describe("Resolution: AUTO (same as dashboard, default) or HIGH (finer)"),
      savePath: z.string().optional().describe("Local file path to save the image to; when given, the image bytes are not returned inline"),
    },
    async (params) => {
      const q: Record<string, string | number> = { startTime: params.startTime, endTime: params.endTime };
      if (params.widgetResolutionMode !== undefined) q.widgetResolutionMode = params.widgetResolutionMode;
      return client.requestBinary("GET", `${CW}/chart/dashboard/${encodeURIComponent(params.dashboardId)}/widgets/${encodeURIComponent(params.widgetId)}`, q, undefined, { savePath: params.savePath });
    }
  );

  // ncloud_query_widget_preview — POST /data/chart/preview (querywidgetdatapreview, ChartDataWidgetDto)
  defineTool(
    server,
    "ncloud_query_widget_preview",
    "Query widget preview chart data from Cloud Insight by specifying metrics directly.",
    {
      periodStart: z.number({ required_error: requiredError("periodStart") }).describe("Start time in Unix epoch milliseconds"),
      periodEnd: z.number({ required_error: requiredError("periodEnd") }).describe("End time in Unix epoch milliseconds"),
      metricsInfo: z.array(z.object({
        prodKey: z.string().describe("Product key (cw_key)"),
        metric: z.string().describe("Metric name to query"),
        statistic: CALC.describe("Aggregation function"),
        period: INTERVAL.describe("Aggregation interval"),
        dimensions: z.record(z.string()).optional().describe("Dimension filters as key-value pairs"),
        productName: z.string().optional().describe("Product name (e.g., \"System/Server(VPC)\")"),
        displayName: z.string().optional().describe("Metric display name on the widget"),
        color: z.string().optional().describe("Chart color (e.g., #1f77b4)"),
        resourceId: z.string().optional().describe("Resource ID"),
        resourceName: z.string().optional().describe("Resource name"),
      })).min(1).describe("Metric definitions to preview (WidgetMetricInfoDto[])"),
    },
    async (params) => {
      return client.postRequest(`${CW}/data/chart/preview`, { periodStart: params.periodStart, periodEnd: params.periodEnd, metricsInfo: params.metricsInfo });
    }
  );

  // ncloud_send_monitoring_data — POST /cw_collector/real/data (senddata)
  defineTool(
    server,
    "ncloud_send_monitoring_data",
    "Send custom JSON monitoring data to Cloud Insight for a user-defined schema (cw_key). Each record holds the schema's metric and dimension fields as key-value pairs. (SGN region additionally requires header X-NCP-REGION_NO=7.)",
    {
      cw_key: z.string({ required_error: requiredError("cw_key") }).describe("Product key (cw_key) of the custom schema"),
      data: z.union([z.record(z.unknown()), z.array(z.record(z.unknown()))]).describe("Data record (object) or records (array) with the schema's metric/dimension fields, e.g. {\"cpu\": 1.5, \"instanceId\": \"i-1\"}"),
    },
    async (params) => {
      return client.postRequest("/cw_collector/real/data", { cw_key: params.cw_key, data: params.data });
    }
  );

  // ncloud_get_servers_top — POST /servers/top?query=&prod= (getserverstop)
  defineTool(
    server,
    "ncloud_get_servers_top",
    "Get the top 5 servers by CPU, memory, or filesystem usage from Cloud Insight monitoring.",
    {
      query: z.enum(["avg_cpu_used_rto", "mem_usert", "avg_fs_usert"]).describe("Metric to rank by: avg_cpu_used_rto (CPU), mem_usert (memory), avg_fs_usert (filesystem)"),
      prod: z.enum(["VPC", "Classic"]).optional().describe("Server environment: VPC (default) or Classic"),
    },
    async (params) => {
      const q: Record<string, string> = { query: params.query };
      if (params.prod !== undefined) q.prod = params.prod;
      return client.requestRaw("POST", `${CW}/servers/top`, q, undefined, { regionHeader: true });
    }
  );
}
