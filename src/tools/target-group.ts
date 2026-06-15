import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

export function registerTargetGroupTools(server: McpServer, client: NcloudClient): void {
  // ─── Target Group Query Tools ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_target_groups",
    "List all target groups in the current region",
    {
      targetGroupNoList: z.array(z.string()).optional().describe("Filter by target group numbers"),
      loadBalancerInstanceNo: z.string().optional().describe("Filter by load balancer instance number"),
      vpcNo: z.string().optional().describe("Filter by VPC number"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vloadbalancer/v2/getTargetGroupList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_target_group_detail",
    "Get detailed information about a specific target group",
    {
      targetGroupNo: z.string({
        required_error: "필수 파라미터 'targetGroupNo'가 누락되었습니다.",
      }).describe("Target group number to query"),
    },
    async (params) => {
      return client.request("/vloadbalancer/v2/getTargetGroupDetail", params);
    }
  );

  // ─── Target Group Create Tool ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_target_group",
    "Create a new target group for a load balancer",
    {
      vpcNo: z.string({
        required_error: "필수 파라미터 'vpcNo'가 누락되었습니다.",
      }).describe("VPC number"),
      targetGroupName: z.string().max(30, {
        message: "잘못된 파라미터: 'targetGroupName'은 30자 이하여야 합니다.",
      }).optional().describe("Target group name (max 30 characters)"),
      targetGroupProtocolTypeCode: z.string({
        required_error: "필수 파라미터 'targetGroupProtocolTypeCode'가 누락되었습니다.",
      }).describe("Target group protocol type (HTTP, HTTPS, TCP, PROXY_TCP)"),
      targetTypeCode: z.string({
        required_error: "필수 파라미터 'targetTypeCode'가 누락되었습니다.",
      }).describe("Target type code (VSVR)"),
      targetGroupPort: z.number().optional().describe("Target group port number"),
      targetGroupDescription: z.string().optional().describe("Target group description"),
      healthCheckProtocolTypeCode: z.string().optional().describe("Health check protocol (HTTP, HTTPS, TCP)"),
      healthCheckPort: z.number().optional().describe("Health check port"),
      healthCheckUrlPath: z.string().optional().describe("Health check URL path (for HTTP/HTTPS)"),
      healthCheckHttpMethodTypeCode: z.string().optional().describe("HTTP method type for health check (HEAD, GET). Required if healthCheckProtocolTypeCode is HTTP or HTTPS"),
      healthCheckCycle: z.number().optional().describe("Health check cycle in seconds (5-300, default: 30)"),
      healthCheckUpThreshold: z.number().optional().describe("Healthy threshold count (2-10, default: 2)"),
      healthCheckDownThreshold: z.number().optional().describe("Unhealthy threshold count (2-10, default: 2)"),
      algorithmTypeCode: z.string().optional().describe("Load balancing algorithm (RR, LC, SIPHS, MH)"),
      targetNoList: z.array(z.string()).optional().describe("List of target numbers to bind to the target group at creation"),
    },
    async (params) => {
      return client.request("/vloadbalancer/v2/createTargetGroup", params);
    }
  );

  // ─── Target Group Destructive Tool ─────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_target_groups",
    "⚠️ Destructive: Permanently delete target groups. Set confirm=true to execute.",
    {
      targetGroupNoList: z.array(z.string(), {
        required_error: "필수 파라미터 'targetGroupNoList'가 누락되었습니다.",
      }).describe("List of target group numbers to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vloadbalancer/v2/deleteTargetGroups", apiParams);
      return result;
    },
    { destructive: { noun: "Target Group(s)", describe: (params) => params.targetGroupNoList.join(", ") } }
  );

  // ─── Target Management Tools ───────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_targets",
    "List all targets in a specific target group",
    {
      targetGroupNo: z.string({
        required_error: "필수 파라미터 'targetGroupNo'가 누락되었습니다.",
      }).describe("Target group number"),
    },
    async (params) => {
      return client.request("/vloadbalancer/v2/getTargetList", params);
    }
  );

  defineTool(
    server,
    "ncloud_add_target",
    "Add targets (server instances) to a target group",
    {
      targetGroupNo: z.string({
        required_error: "필수 파라미터 'targetGroupNo'가 누락되었습니다.",
      }).describe("Target group number"),
      targetNoList: z.array(z.string(), {
        required_error: "필수 파라미터 'targetNoList'가 누락되었습니다.",
      }).describe("List of target (server instance) numbers to add"),
    },
    async (params) => {
      return client.request("/vloadbalancer/v2/addTarget", params);
    }
  );

  defineTool(
    server,
    "ncloud_remove_target",
    "⚠️ Destructive: Remove targets from a target group. Set confirm=true to execute.",
    {
      targetGroupNo: z.string({
        required_error: "필수 파라미터 'targetGroupNo'가 누락되었습니다.",
      }).describe("Target group number"),
      targetNoList: z.array(z.string(), {
        required_error: "필수 파라미터 'targetNoList'가 누락되었습니다.",
      }).describe("List of target (server instance) numbers to remove"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vloadbalancer/v2/removeTarget", apiParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will remove Target(s) [${params.targetNoList.join(", ")}] from Target Group [${params.targetGroupNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Target Group Configuration Tools ──────────────────────────────────────

  defineTool(
    server,
    "ncloud_change_target_group_config",
    "Change target group configuration (algorithm, sticky session, proxy protocol)",
    {
      targetGroupNo: z.string({
        required_error: "필수 파라미터 'targetGroupNo'가 누락되었습니다.",
      }).describe("Target group number"),
      algorithmTypeCode: z.string().optional().describe("Load balancing algorithm type code (RR, SIPHS, LC, MH). HTTP/HTTPS/PROXY_TCP: RR|SIPHS|LC, TCP/UDP: RR|MH"),
      useStickySession: z.boolean().optional().describe("Whether to enable per-session access (true/false). Available for TCP, UDP, HTTP, HTTPS protocols"),
      useProxyProtocol: z.boolean().optional().describe("Whether to use proxy protocol (true/false). Available for PROXY_TCP protocol only"),
    },
    async (params) => {
      return client.request("/vloadbalancer/v2/changeTargetGroupConfiguration", params);
    }
  );

  defineTool(
    server,
    "ncloud_change_target_group_health",
    "Change target group health check configuration",
    {
      targetGroupNo: z.string({
        required_error: "필수 파라미터 'targetGroupNo'가 누락되었습니다.",
      }).describe("Target group number"),
      healthCheckPort: z.number().optional().describe("Health check port number (1-65534, default: 80)"),
      healthCheckUrlPath: z.string().optional().describe("Health check URL path (for HTTP/HTTPS, starts with /)"),
      healthCheckHttpMethodTypeCode: z.string().optional().describe("HTTP method type for health check (HEAD, GET). Available if health check protocol is HTTP or HTTPS"),
      healthCheckCycle: z.number().optional().describe("Health check cycle in seconds (5-300)"),
      healthCheckUpThreshold: z.number().optional().describe("Healthy threshold count (2-10)"),
      healthCheckDownThreshold: z.number().optional().describe("Unhealthy threshold count (2-10)"),
    },
    async (params) => {
      return client.request("/vloadbalancer/v2/changeTargetGroupHealthCheckConfiguration", params);
    }
  );

  defineTool(
    server,
    "ncloud_set_target_group_description",
    "Set or update the description of a target group",
    {
      targetGroupNo: z.string({
        required_error: "필수 파라미터 'targetGroupNo'가 누락되었습니다.",
      }).describe("Target group number"),
      targetGroupDescription: z.string({
        required_error: "필수 파라미터 'targetGroupDescription'가 누락되었습니다.",
      }).describe("Target group description"),
    },
    async (params) => {
      return client.request("/vloadbalancer/v2/setTargetGroupDescription", params);
    }
  );

  defineTool(
    server,
    "ncloud_set_targets",
    "Set targets for a target group (replaces all existing targets with the specified list)",
    {
      targetGroupNo: z.string({
        required_error: "필수 파라미터 'targetGroupNo'가 누락되었습니다.",
      }).describe("Target group number"),
      targetNoList: z.array(z.string(), {
        required_error: "필수 파라미터 'targetNoList'가 누락되었습니다.",
      }).describe("List of target (server instance) numbers to set (replaces existing targets)"),
    },
    async (params) => {
      return client.request("/vloadbalancer/v2/setTarget", params);
    }
  );
}
