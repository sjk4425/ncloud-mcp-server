import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

export function registerCloudInsightRuleTools(server: McpServer, client: NcloudClient): void {
  // ncloud_list_rule_groups — Get event rule group list
  server.tool(
    "ncloud_list_rule_groups",
    "Get the list of Cloud Insight event rule groups for monitoring alerts.",
    {
      prodKey: z.string({ required_error: "필수 파라미터 'prodKey'가 누락되었습니다." }).describe("Product key (cw_key) to filter rule groups (required)"),
      pageSize: z.number({ required_error: "필수 파라미터 'pageSize'가 누락되었습니다." }).describe("Number of results per page (required)"),
      pageNum: z.number({ required_error: "필수 파라미터 'pageNum'이 누락되었습니다." }).describe("Page number (required, starts from 1)"),
      search: z.string().optional().describe("Search keyword to filter rule groups"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          prodKey: params.prodKey,
          pageSize: params.pageSize,
          pageNum: params.pageNum,
        };
        if (params.search !== undefined) body.search = params.search;

        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/ruleGrp/query", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_rule_group — Get details of a specific event rule group
  server.tool(
    "ncloud_get_rule_group",
    "Get detailed information about a specific Cloud Insight event rule group.",
    {
      ruleGroupId: z.string().describe("Rule group ID to retrieve details for"),
    },
    async (params) => {
      try {
        const body = {
          ruleGroupId: params.ruleGroupId,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/detail", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_create_rule_group — Create a new event rule group
  server.tool(
    "ncloud_create_rule_group",
    "Create a new Cloud Insight event rule group for monitoring alerts. Defines monitoring targets, metrics, thresholds, and notification recipients.",
    {
      groupName: z.string().describe("Name of the rule group"),
      prodKey: z.string().describe("Product key (cw_key) for the target service"),
      metricsGroupId: z.string().describe("Metrics group ID (rule template) to apply"),
      monitorGroupId: z.string().describe("Monitor group ID (target group) to monitor"),
      recipientNotification: z.array(z.object({
        notificationType: z.enum(["EMAIL", "SMS", "WEBHOOK"]).describe("Notification type"),
        recipient: z.string().describe("Notification recipient (email, phone, or webhook URL)"),
      })).optional().describe("Notification recipients for alerts"),
      cfgRuleList: z.array(z.object({
        metricGroupItemId: z.string().describe("Metric item ID"),
        condition: z.enum(["GT", "GTE", "LT", "LTE", "EQ"]).describe("Threshold condition (GT: >, GTE: >=, LT: <, LTE: <=, EQ: ==)"),
        threshold: z.number().describe("Threshold value"),
        duration: z.number().describe("Duration in minutes before triggering alert"),
        eventLevel: z.enum(["CRITICAL", "WARNING", "INFO"]).describe("Event severity level"),
        aggregation: z.enum(["AVG", "MIN", "MAX", "SUM", "COUNT"]).optional().describe("Aggregation type (default: AVG)"),
      })).describe("List of rule configurations defining alert conditions"),
      dryRun: z.boolean().optional().describe("If true, returns a preview without creating the rule group (default: false)"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "📋 생성 예상 결과 (미리보기 - 실제 생성되지 않음)",
            리소스타입: "Cloud Insight Rule Group",
            그룹명: params.groupName,
            대상서비스: params.prodKey,
            메트릭그룹: params.metricsGroupId,
            모니터그룹: params.monitorGroupId,
            규칙수: params.cfgRuleList.length,
            알림수신자: params.recipientNotification?.length ?? 0,
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }

        const body: Record<string, unknown> = {
          groupName: params.groupName,
          prodKey: params.prodKey,
          metricsGroupId: params.metricsGroupId,
          monitorGroupId: params.monitorGroupId,
          cfgRuleList: params.cfgRuleList,
        };
        if (params.recipientNotification !== undefined) body.recipientNotification = params.recipientNotification;

        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/create", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_delete_rule_group — Delete an event rule group
  server.tool(
    "ncloud_delete_rule_group",
    "⚠️ Destructive: Delete a Cloud Insight event rule group. This will permanently remove the rule group and stop all associated monitoring alerts.",
    {
      ruleGroupId: z.string().describe("Rule group ID to delete"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion. If false or omitted, returns a confirmation prompt."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will permanently delete Cloud Insight Rule Group [${params.ruleGroupId}]. All associated monitoring alerts will be stopped. Do you want to proceed? (yes/no)\n\nTo confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = {
          ruleGroupId: params.ruleGroupId,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/delete", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_monitor_groups — Get monitoring target group list
  server.tool(
    "ncloud_list_monitor_groups",
    "Get the list of Cloud Insight monitoring target groups for a specific product.",
    {
      prodKey: z.string({ required_error: "필수 파라미터 'prodKey'가 누락되었습니다." }).describe("Product key (cw_key) to get monitor groups for (required, use ncloud_get_schema_keys to find available keys)"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/cw_fea/real/cw/api/rule/group/monitor/${encodeURIComponent(params.prodKey)}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_metrics_groups — Get rule template (metrics group) list
  server.tool(
    "ncloud_list_metrics_groups",
    "Get the list of Cloud Insight rule templates (monitoring item groups / metrics groups).",
    {
      prodKey: z.string().optional().describe("Product key to filter metrics groups"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.prodKey !== undefined) body.prodKey = params.prodKey;

        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/metrics/list", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_notification_recipients — Get notification recipient list
  server.tool(
    "ncloud_get_notification_recipients",
    "Get the list of notification recipients configured for Cloud Insight event alerts.",
    {},
    async () => {
      try {
        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/recipient", {});
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_create_monitor_group — Create a monitoring target group
  server.tool(
    "ncloud_create_monitor_group",
    "Create a new Cloud Insight monitoring target group (감시 대상 그룹).",
    {
      prodKey: z.string().describe("Product key (cw_key) for the target service"),
      groupName: z.string().describe("Name of the monitor group"),
      resourceList: z.array(z.record(z.string())).describe("Array of resource dimension objects to include in the group"),
    },
    async (params) => {
      try {
        const body = {
          prodKey: params.prodKey,
          groupName: params.groupName,
          resourceList: params.resourceList,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/monitor/create", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_monitor_group — Get monitoring target group details
  server.tool(
    "ncloud_get_monitor_group",
    "Get detailed information about a specific Cloud Insight monitoring target group.",
    {
      monitorGroupId: z.string().describe("Monitor group ID to retrieve details for"),
    },
    async (params) => {
      try {
        const body = {
          monitorGroupId: params.monitorGroupId,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/monitor/detail", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_update_monitor_group — Update a monitoring target group
  server.tool(
    "ncloud_update_monitor_group",
    "Update an existing Cloud Insight monitoring target group.",
    {
      monitorGroupId: z.string().describe("Monitor group ID to update"),
      groupName: z.string().optional().describe("New name for the monitor group"),
      resourceList: z.array(z.record(z.string())).optional().describe("Updated array of resource dimension objects"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          monitorGroupId: params.monitorGroupId,
        };
        if (params.groupName !== undefined) body.groupName = params.groupName;
        if (params.resourceList !== undefined) body.resourceList = params.resourceList;

        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/monitor/update", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_delete_monitor_group — Delete a monitoring target group
  server.tool(
    "ncloud_delete_monitor_group",
    "⚠️ Destructive: Delete a Cloud Insight monitoring target group. This will permanently remove the group.",
    {
      monitorGroupId: z.string().describe("Monitor group ID to delete"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will permanently delete monitor group [${params.monitorGroupId}]. To confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = { monitorGroupId: params.monitorGroupId };
        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/monitor/delete", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_create_metrics_group — Create a rule template (metrics group)
  server.tool(
    "ncloud_create_metrics_group",
    "Create a new Cloud Insight rule template (감시 항목 그룹 / metrics group).",
    {
      prodKey: z.string().describe("Product key (cw_key) for the target service"),
      groupName: z.string().describe("Name of the metrics group"),
      metricList: z.array(z.object({
        metricGroupItemId: z.string().describe("Metric item ID"),
        condition: z.enum(["GT", "GTE", "LT", "LTE", "EQ"]).describe("Threshold condition"),
        threshold: z.number().describe("Threshold value"),
        duration: z.number().describe("Duration in minutes before triggering"),
        eventLevel: z.enum(["CRITICAL", "WARNING", "INFO"]).describe("Event severity level"),
        aggregation: z.enum(["AVG", "MIN", "MAX", "SUM", "COUNT"]).optional().describe("Aggregation type"),
      })).describe("List of metric configurations"),
    },
    async (params) => {
      try {
        const body = {
          prodKey: params.prodKey,
          groupName: params.groupName,
          metricList: params.metricList,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/metrics/create", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_metrics_group — Get rule template details
  server.tool(
    "ncloud_get_metrics_group",
    "Get detailed information about a specific Cloud Insight rule template (metrics group).",
    {
      metricsGroupId: z.string().describe("Metrics group ID to retrieve details for"),
    },
    async (params) => {
      try {
        const body = { metricsGroupId: params.metricsGroupId };
        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/metrics/detail", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_update_metrics_group — Update a rule template
  server.tool(
    "ncloud_update_metrics_group",
    "Update an existing Cloud Insight rule template (metrics group).",
    {
      metricsGroupId: z.string().describe("Metrics group ID to update"),
      groupName: z.string().optional().describe("New name for the metrics group"),
      metricList: z.array(z.object({
        metricGroupItemId: z.string().describe("Metric item ID"),
        condition: z.enum(["GT", "GTE", "LT", "LTE", "EQ"]).describe("Threshold condition"),
        threshold: z.number().describe("Threshold value"),
        duration: z.number().describe("Duration in minutes"),
        eventLevel: z.enum(["CRITICAL", "WARNING", "INFO"]).describe("Event severity level"),
        aggregation: z.enum(["AVG", "MIN", "MAX", "SUM", "COUNT"]).optional().describe("Aggregation type"),
      })).optional().describe("Updated metric configurations"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          metricsGroupId: params.metricsGroupId,
        };
        if (params.groupName !== undefined) body.groupName = params.groupName;
        if (params.metricList !== undefined) body.metricList = params.metricList;

        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/metrics/update", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_delete_metrics_group — Delete a rule template
  server.tool(
    "ncloud_delete_metrics_group",
    "⚠️ Destructive: Delete a Cloud Insight rule template (metrics group).",
    {
      metricsGroupId: z.string().describe("Metrics group ID to delete"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will permanently delete metrics group [${params.metricsGroupId}]. To confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = { metricsGroupId: params.metricsGroupId };
        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/metrics/delete", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_update_rule_group — Update an event rule group
  server.tool(
    "ncloud_update_rule_group",
    "Update an existing Cloud Insight event rule group.",
    {
      ruleGroupId: z.string().describe("Rule group ID to update"),
      groupName: z.string().optional().describe("New name for the rule group"),
      metricsGroupId: z.string().optional().describe("New metrics group ID"),
      monitorGroupId: z.string().optional().describe("New monitor group ID"),
      recipientNotification: z.array(z.object({
        notificationType: z.enum(["EMAIL", "SMS", "WEBHOOK"]).describe("Notification type"),
        recipient: z.string().describe("Notification recipient"),
      })).optional().describe("Updated notification recipients"),
      cfgRuleList: z.array(z.object({
        metricGroupItemId: z.string().describe("Metric item ID"),
        condition: z.enum(["GT", "GTE", "LT", "LTE", "EQ"]).describe("Threshold condition"),
        threshold: z.number().describe("Threshold value"),
        duration: z.number().describe("Duration in minutes"),
        eventLevel: z.enum(["CRITICAL", "WARNING", "INFO"]).describe("Event severity level"),
        aggregation: z.enum(["AVG", "MIN", "MAX", "SUM", "COUNT"]).optional().describe("Aggregation type"),
      })).optional().describe("Updated rule configurations"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          ruleGroupId: params.ruleGroupId,
        };
        if (params.groupName !== undefined) body.groupName = params.groupName;
        if (params.metricsGroupId !== undefined) body.metricsGroupId = params.metricsGroupId;
        if (params.monitorGroupId !== undefined) body.monitorGroupId = params.monitorGroupId;
        if (params.recipientNotification !== undefined) body.recipientNotification = params.recipientNotification;
        if (params.cfgRuleList !== undefined) body.cfgRuleList = params.cfgRuleList;

        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/update", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_create_rule_directly — Create event rule with direct target/metric specification
  server.tool(
    "ncloud_create_rule_directly",
    "Create a Cloud Insight event rule by directly specifying monitoring targets and metrics (without pre-created groups).",
    {
      groupName: z.string().describe("Name of the rule group"),
      prodKey: z.string().describe("Product key (cw_key)"),
      resourceList: z.array(z.record(z.string())).describe("Array of resource dimension objects to monitor"),
      cfgRuleList: z.array(z.object({
        metricGroupItemId: z.string().describe("Metric item ID"),
        condition: z.enum(["GT", "GTE", "LT", "LTE", "EQ"]).describe("Threshold condition"),
        threshold: z.number().describe("Threshold value"),
        duration: z.number().describe("Duration in minutes"),
        eventLevel: z.enum(["CRITICAL", "WARNING", "INFO"]).describe("Event severity level"),
        aggregation: z.enum(["AVG", "MIN", "MAX", "SUM", "COUNT"]).optional().describe("Aggregation type"),
      })).describe("Rule configurations"),
      recipientNotification: z.array(z.object({
        notificationType: z.enum(["EMAIL", "SMS", "WEBHOOK"]).describe("Notification type"),
        recipient: z.string().describe("Notification recipient"),
      })).optional().describe("Notification recipients"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          groupName: params.groupName,
          prodKey: params.prodKey,
          resourceList: params.resourceList,
          cfgRuleList: params.cfgRuleList,
        };
        if (params.recipientNotification !== undefined) body.recipientNotification = params.recipientNotification;

        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/createDirectly", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_copy_rule_group — Copy an event rule group
  server.tool(
    "ncloud_copy_rule_group",
    "Copy an existing Cloud Insight event rule group to create a new one.",
    {
      ruleGroupId: z.string().describe("Source rule group ID to copy from"),
      groupName: z.string().describe("Name for the new copied rule group"),
    },
    async (params) => {
      try {
        const body = {
          ruleGroupId: params.ruleGroupId,
          groupName: params.groupName,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/copy", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_search_metric_list — Search available metrics for a monitor group
  server.tool(
    "ncloud_search_metric_list",
    "Search available monitoring metrics for a specific product in Cloud Insight.",
    {
      prodKey: z.string().describe("Product key (cw_key) to search metrics for"),
    },
    async (params) => {
      try {
        const body = { prodKey: params.prodKey };
        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/metric/search", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_remove_resource_from_rules — Remove a resource from event rules
  server.tool(
    "ncloud_remove_resource_from_rules",
    "⚠️ Destructive: Remove a specific monitoring target from Cloud Insight event rules.",
    {
      prodKey: z.string().describe("Product key (cw_key)"),
      resourceId: z.string().describe("Resource ID to remove from rules"),
      confirm: z.boolean().optional().describe("Must be true to execute removal."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will remove resource [${params.resourceId}] from all associated event rules. To confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = {
          prodKey: params.prodKey,
          resourceId: params.resourceId,
        };
        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/resource/remove", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_rules_by_metrics_group — Get rules by metrics group IDs
  server.tool(
    "ncloud_get_rules_by_metrics_group",
    "Get Cloud Insight event rules associated with specific rule template (metrics group) IDs.",
    {
      metricsGroupIds: z.array(z.string()).describe("Array of metrics group IDs to query"),
    },
    async (params) => {
      try {
        const body = { metricsGroupIds: params.metricsGroupIds };
        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/byMetricGroupIds", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_rules_by_monitor_group — Get rules by monitor group IDs
  server.tool(
    "ncloud_get_rules_by_monitor_group",
    "Get Cloud Insight event rules associated with specific monitoring target group IDs.",
    {
      monitorGroupIds: z.array(z.string()).describe("Array of monitor group IDs to query"),
    },
    async (params) => {
      try {
        const body = { monitorGroupIds: params.monitorGroupIds };
        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/byMonitorGroupIds", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_delete_rule_group_by_id — Delete event rule by product key and ID
  server.tool(
    "ncloud_delete_rule_group_by_id",
    "⚠️ Destructive: Delete a Cloud Insight event rule by product key and rule group ID.",
    {
      prodKey: z.string().describe("Product key (cw_key)"),
      ruleGroupId: z.string().describe("Rule group ID to delete"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will permanently delete rule group [${params.ruleGroupId}]. To confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = {
          prodKey: params.prodKey,
          ruleGroupId: params.ruleGroupId,
        };
        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/deleteByProdKeyAndId", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_delete_metrics_group_by_id — Delete metrics group by product key and ID
  server.tool(
    "ncloud_delete_metrics_group_by_id",
    "⚠️ Destructive: Delete a Cloud Insight rule template by product key and metrics group ID.",
    {
      prodKey: z.string().describe("Product key (cw_key)"),
      metricsGroupId: z.string().describe("Metrics group ID to delete"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will permanently delete metrics group [${params.metricsGroupId}]. To confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = {
          prodKey: params.prodKey,
          metricsGroupId: params.metricsGroupId,
        };
        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/metrics/deleteByProdKeyAndId", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_delete_metrics_group_force — Force delete all rules related to a metrics group
  server.tool(
    "ncloud_delete_metrics_group_force",
    "⚠️ Destructive: Force delete ALL event rules associated with a specific rule template (metrics group). This is irreversible.",
    {
      metricsGroupId: z.string().describe("Metrics group ID whose related rules will be deleted"),
      confirm: z.boolean().optional().describe("Must be true to execute force deletion."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will permanently delete ALL event rules related to metrics group [${params.metricsGroupId}]. This is irreversible. To confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = { metricsGroupId: params.metricsGroupId };
        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/metrics/deleteForce", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_delete_monitor_group_force — Force delete all rules related to a monitor group
  server.tool(
    "ncloud_delete_monitor_group_force",
    "⚠️ Destructive: Force delete ALL event rules associated with a specific monitoring target group. This is irreversible.",
    {
      monitorGroupId: z.string().describe("Monitor group ID whose related rules will be deleted"),
      confirm: z.boolean().optional().describe("Must be true to execute force deletion."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will permanently delete ALL event rules related to monitor group [${params.monitorGroupId}]. This is irreversible. To confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = { monitorGroupId: params.monitorGroupId };
        const result = await client.postRequest("/cw_fea/real/cw/api/rule/group/monitor/deleteForce", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
