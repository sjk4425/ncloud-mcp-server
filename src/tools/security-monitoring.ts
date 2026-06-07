import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

// Security Monitoring (NCP) API
// Base host: https://securitymonitoring.apigw.ntruss.com (registry에서 주입)
// VPC prefix /vsecuritymonitoring/v1/ , 모든 엔드포인트 POST(JSON body).
// 공통 필수: startDateTime/endDateTime(epoch ms), page, countPerPage.
// 공식 docs: security-securitymonitoring-*
const PREFIX = "/vsecuritymonitoring/v1";

// 목록 공통 파라미터(시간·페이지·공통 필터)
const listBase = {
  startDateTime: z.number().describe("Search start time in Unix epoch milliseconds"),
  endDateTime: z.number().describe("Search end time in Unix epoch milliseconds"),
  page: z.number().optional().default(1).describe("Page number (>= 1, default 1)"),
  countPerPage: z.number().optional().default(50).describe("Items per page (>= 1, default 50)"),
  order: z.string().optional().describe("Sort order"),
  regionCode: z.string().optional().describe("Region code"),
  zoneName: z.string().optional().describe("Zone name"),
};

function buildListBody(p: any): Record<string, unknown> {
  const body: Record<string, unknown> = {
    startDateTime: p.startDateTime,
    endDateTime: p.endDateTime,
    page: p.page ?? 1,
    countPerPage: p.countPerPage ?? 50,
  };
  if (p.order !== undefined) body.order = p.order;
  if (p.regionCode !== undefined) body.regionCode = p.regionCode;
  if (p.zoneName !== undefined) body.zoneName = p.zoneName;
  return body;
}

export function registerSecurityMonitoringTools(server: McpServer, client: NcloudClient): void {
  // ncloud_list_av_events — Anti-Virus detection events
  server.tool(
    "ncloud_list_av_events",
    "List Anti-Virus malware detection events from Security Monitoring. Only for users subscribed to the Security Monitoring service.",
    {
      ...listBase,
      infectedServerIp: z.string().optional().describe("Filter by infected server IP"),
      detectionPath: z.string().optional().describe("Filter by detection path"),
      malwareType: z.string().optional().describe("Filter by malware type"),
    },
    async (params) => {
      try {
        const body = buildListBody(params);
        if (params.infectedServerIp !== undefined) body.infectedServerIp = params.infectedServerIp;
        if (params.detectionPath !== undefined) body.detectionPath = params.detectionPath;
        if (params.malwareType !== undefined) body.malwareType = params.malwareType;
        const result = await client.postRequest(`${PREFIX}/getAVList`, body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_ids_events — IDS detection events
  server.tool(
    "ncloud_list_ids_events",
    "List IDS intrusion detection events from Security Monitoring. Only for users subscribed to the Security Monitoring service.",
    {
      ...listBase,
      attackType: z.string().optional().describe("Filter by attack type"),
      attackIp: z.string().optional().describe("Filter by attack source IP"),
      targetIp: z.string().optional().describe("Filter by target IP"),
    },
    async (params) => {
      try {
        const body = buildListBody(params);
        if (params.attackType !== undefined) body.attackType = params.attackType;
        if (params.attackIp !== undefined) body.attackIp = params.attackIp;
        if (params.targetIp !== undefined) body.targetIp = params.targetIp;
        const result = await client.postRequest(`${PREFIX}/getIDSList`, body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_ips_events — IPS prevention events
  server.tool(
    "ncloud_list_ips_events",
    "List IPS intrusion prevention events from Security Monitoring. Only for users subscribed to the Security Monitoring service.",
    {
      ...listBase,
      eventNm: z.string().optional().describe("Filter by event name"),
      attackIp: z.string().optional().describe("Filter by attack source IP"),
      targetIp: z.string().optional().describe("Filter by target IP"),
      protocol: z.string().optional().describe("Filter by protocol (VPC only)"),
    },
    async (params) => {
      try {
        const body = buildListBody(params);
        if (params.eventNm !== undefined) body.eventNm = params.eventNm;
        if (params.attackIp !== undefined) body.attackIp = params.attackIp;
        if (params.targetIp !== undefined) body.targetIp = params.targetIp;
        if (params.protocol !== undefined) body.protocol = params.protocol;
        const result = await client.postRequest(`${PREFIX}/getIPSList`, body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_waf_events — WAF events
  server.tool(
    "ncloud_list_waf_events",
    "List WAF (Web Application Firewall) security events from Security Monitoring. Only for users subscribed to the Security Monitoring service.",
    {
      ...listBase,
      attackType: z.string().optional().describe("Filter by attack type"),
      eventNm: z.string().optional().describe("Filter by event name"),
      attackIp: z.string().optional().describe("Filter by attack source IP"),
      targetIp: z.string().optional().describe("Filter by target IP"),
    },
    async (params) => {
      try {
        const body = buildListBody(params);
        if (params.attackType !== undefined) body.attackType = params.attackType;
        if (params.eventNm !== undefined) body.eventNm = params.eventNm;
        if (params.attackIp !== undefined) body.attackIp = params.attackIp;
        if (params.targetIp !== undefined) body.targetIp = params.targetIp;
        const result = await client.postRequest(`${PREFIX}/getWAFList`, body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_ddos_events — Anti-DDoS events
  server.tool(
    "ncloud_list_ddos_events",
    "List Anti-DDoS security events from Security Monitoring. Only for users subscribed to the Security Monitoring service.",
    {
      ...listBase,
      attackIp: z.string().optional().describe("Filter by attack source IP"),
      targetIp: z.string().optional().describe("Filter by target IP"),
    },
    async (params) => {
      try {
        const body = buildListBody(params);
        if (params.attackIp !== undefined) body.attackIp = params.attackIp;
        if (params.targetIp !== undefined) body.targetIp = params.targetIp;
        const result = await client.postRequest(`${PREFIX}/getDDoSList`, body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_ddos_event_detail — Anti-DDoS event detail
  server.tool(
    "ncloud_get_ddos_event_detail",
    "Get detailed information about a specific Anti-DDoS security event. Only for users subscribed to the Security Monitoring service.",
    {
      ticketId: z.string().describe("The DDoS event ticket ID to get details for"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(`${PREFIX}/getDDoSEventDetail`, { ticketId: params.ticketId });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_ids_event_detail — IDS event detail
  server.tool(
    "ncloud_get_ids_event_detail",
    "Get detailed information about a specific IDS intrusion detection event. Only for users subscribed to the Security Monitoring service.",
    {
      ticketId: z.string().describe("The IDS event ticket ID to get details for"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(`${PREFIX}/getIDSEventDetail`, { ticketId: params.ticketId });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
