import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

export function registerSecurityMonitoringTools(server: McpServer, client: NcloudClient): void {
  // ncloud_list_security_events — List security events with optional filters
  server.tool(
    "ncloud_list_security_events",
    "List security monitoring events with filtering by period, severity, and event type. Only available for users subscribed to the Security Monitoring service.",
    {
      startTime: z.string().optional().describe("Start time in ISO 8601 format (e.g., \"2024-01-01T00:00:00Z\")"),
      endTime: z.string().optional().describe("End time in ISO 8601 format (e.g., \"2024-01-31T23:59:59Z\")"),
      severityCode: z.string().optional().describe("Severity level filter (e.g., \"HIGH\", \"MEDIUM\", \"LOW\")"),
      eventTypeCode: z.string().optional().describe("Event type filter (e.g., \"IDS\", \"IPS\", \"AV\")"),
      regionCode: z.string().optional().describe("Region code (KR, JPN, SGN, etc.)"),
      pageNo: z.number().optional().describe("Page number (default 1)"),
      pageSize: z.number().optional().describe("Page size (default 50)"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string | number | undefined> = {};
        if (params.startTime !== undefined) apiParams.startTime = params.startTime;
        if (params.endTime !== undefined) apiParams.endTime = params.endTime;
        if (params.severityCode !== undefined) apiParams.severityCode = params.severityCode;
        if (params.eventTypeCode !== undefined) apiParams.eventTypeCode = params.eventTypeCode;
        if (params.regionCode !== undefined) apiParams.regionCode = params.regionCode;
        if (params.pageNo !== undefined) apiParams.pageNo = params.pageNo;
        if (params.pageSize !== undefined) apiParams.pageSize = params.pageSize;

        const result = await client.request("/vsecuritymonitoring/v1/getSecurityEventList", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_security_event_detail — Get detailed information of a specific security event
  server.tool(
    "ncloud_get_security_event_detail",
    "Get detailed information about a specific security monitoring event. Only available for users subscribed to the Security Monitoring service.",
    {
      eventId: z.string().describe("The security event ID to get details for"),
      regionCode: z.string().optional().describe("Region code (KR, JPN, SGN, etc.)"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string | undefined> = {
          eventId: params.eventId,
        };
        if (params.regionCode !== undefined) apiParams.regionCode = params.regionCode;

        const result = await client.request("/vsecuritymonitoring/v1/getSecurityEventDetail", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_ids_events — List IDS/IPS detection and blocking events
  server.tool(
    "ncloud_list_ids_events",
    "List IDS/IPS intrusion detection and prevention events. Use for tracking intrusion attempts and blocked attacks. Only available for users subscribed to the Security Monitoring service.",
    {
      startTime: z.string().optional().describe("Start time in ISO 8601 format (e.g., \"2024-01-01T00:00:00Z\")"),
      endTime: z.string().optional().describe("End time in ISO 8601 format (e.g., \"2024-01-31T23:59:59Z\")"),
      severityCode: z.string().optional().describe("Severity level filter (e.g., \"HIGH\", \"MEDIUM\", \"LOW\")"),
      targetServerInstanceNo: z.string().optional().describe("Target server instance number to filter events"),
      regionCode: z.string().optional().describe("Region code (KR, JPN, SGN, etc.)"),
      pageNo: z.number().optional().describe("Page number (default 1)"),
      pageSize: z.number().optional().describe("Page size (default 50)"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string | number | undefined> = {};
        if (params.startTime !== undefined) apiParams.startTime = params.startTime;
        if (params.endTime !== undefined) apiParams.endTime = params.endTime;
        if (params.severityCode !== undefined) apiParams.severityCode = params.severityCode;
        if (params.targetServerInstanceNo !== undefined) apiParams.targetServerInstanceNo = params.targetServerInstanceNo;
        if (params.regionCode !== undefined) apiParams.regionCode = params.regionCode;
        if (params.pageNo !== undefined) apiParams.pageNo = params.pageNo;
        if (params.pageSize !== undefined) apiParams.pageSize = params.pageSize;

        const result = await client.request("/vsecuritymonitoring/v1/getIdsEventList", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_av_events — List Anti-Virus malware detection events
  server.tool(
    "ncloud_list_av_events",
    "List Anti-Virus malware detection events. Use for tracking malware threats detected on servers. Only available for users subscribed to the Security Monitoring service.",
    {
      startTime: z.string().optional().describe("Start time in ISO 8601 format (e.g., \"2024-01-01T00:00:00Z\")"),
      endTime: z.string().optional().describe("End time in ISO 8601 format (e.g., \"2024-01-31T23:59:59Z\")"),
      severityCode: z.string().optional().describe("Severity level filter (e.g., \"HIGH\", \"MEDIUM\", \"LOW\")"),
      targetServerInstanceNo: z.string().optional().describe("Target server instance number to filter events"),
      regionCode: z.string().optional().describe("Region code (KR, JPN, SGN, etc.)"),
      pageNo: z.number().optional().describe("Page number (default 1)"),
      pageSize: z.number().optional().describe("Page size (default 50)"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string | number | undefined> = {};
        if (params.startTime !== undefined) apiParams.startTime = params.startTime;
        if (params.endTime !== undefined) apiParams.endTime = params.endTime;
        if (params.severityCode !== undefined) apiParams.severityCode = params.severityCode;
        if (params.targetServerInstanceNo !== undefined) apiParams.targetServerInstanceNo = params.targetServerInstanceNo;
        if (params.regionCode !== undefined) apiParams.regionCode = params.regionCode;
        if (params.pageNo !== undefined) apiParams.pageNo = params.pageNo;
        if (params.pageSize !== undefined) apiParams.pageSize = params.pageSize;

        const result = await client.request("/vsecuritymonitoring/v1/getAntiVirusEventList", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_ddos_events — List Anti-DDoS security events
  server.tool(
    "ncloud_list_ddos_events",
    "List Anti-DDoS security events that occurred while using the Anti-DDoS service. Use for tracking DDoS attack attempts and mitigation actions. Only available for users subscribed to the Security Monitoring service.",
    {
      startDateTime: z.string().describe("Start date/time for event search in ISO 8601 format (e.g., \"2024-01-01T00:00:00Z\")"),
      endDateTime: z.string().describe("End date/time for event search in ISO 8601 format (e.g., \"2024-01-31T23:59:59Z\")"),
      pageNo: z.number().optional().describe("Page number (default 1)"),
      pageSize: z.number().optional().describe("Page size (default 50)"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string | number | undefined> = {
          startDateTime: params.startDateTime,
          endDateTime: params.endDateTime,
        };
        if (params.pageNo !== undefined) apiParams.pageNo = params.pageNo;
        if (params.pageSize !== undefined) apiParams.pageSize = params.pageSize;

        const result = await client.request("/vsecuritymonitoring/v1/getDDoSList", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_ddos_event_detail — Get Anti-DDoS event detail
  server.tool(
    "ncloud_get_ddos_event_detail",
    "Get detailed information about a specific Anti-DDoS security event. Use for investigating DDoS attack details including attack vectors, duration, and mitigation results. Only available for users subscribed to the Security Monitoring service.",
    {
      eventId: z.string().describe("The DDoS event ID to get details for"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string> = {
          eventId: params.eventId,
        };

        const result = await client.request("/vsecuritymonitoring/v1/getDDoSEventDetail", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_waf_events — List WAF security events
  server.tool(
    "ncloud_list_waf_events",
    "List WAF (Web Application Firewall) security events that occurred while using the WAF service. Use for tracking web application attacks such as SQL injection, XSS, and other OWASP threats. Only available for users subscribed to the Security Monitoring service.",
    {
      startDateTime: z.string().describe("Start date/time for event search in ISO 8601 format (e.g., \"2024-01-01T00:00:00Z\")"),
      endDateTime: z.string().describe("End date/time for event search in ISO 8601 format (e.g., \"2024-01-31T23:59:59Z\")"),
      pageNo: z.number().optional().describe("Page number (default 1)"),
      pageSize: z.number().optional().describe("Page size (default 50)"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string | number | undefined> = {
          startDateTime: params.startDateTime,
          endDateTime: params.endDateTime,
        };
        if (params.pageNo !== undefined) apiParams.pageNo = params.pageNo;
        if (params.pageSize !== undefined) apiParams.pageSize = params.pageSize;

        const result = await client.request("/vsecuritymonitoring/v1/getWAFList", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
