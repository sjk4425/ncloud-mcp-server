import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

/**
 * Cloud Insight Event Rule / Monitor Group / Rule Template(Metrics Group) 도구.
 *
 * 경로·메서드·바디는 공식 가이드(management-cloudinsight-{getrulegrouplist,getrulegroup,createrulegroup,
 * updaterulegroup,deleterulegroup,deleterulegroupbyprodkeyandid,copyrulegroup,createruledirectly,
 * getallmonitorgrp,getmonitorgrp,createmonitorgrp,updatemonitorgrp,deletemonitorgrp,deletemonitorgroupforce,
 * getmetricsgrouplist,getmetricsgroup,createmetricsgrp,updatemetricsgroup,deletemetricsgrp,
 * deletemetricsgrpbyprodkeyandid,deletemetricgroupforce,getnotificationrecipientlist,
 * getrulegroupbymetricgroupids,getrulegroupbymonitorgroupids,searchmetriclist,removeresourcefromrules},
 * 2026-10-02 대조)를 따른다. 세 존 모두 cw.apigw.* 호스트 + 동일 경로.
 *
 * 바디 DTO: common-vapidatatype-ci{createorupdaterulegroupdto,monitorgrpdto,createorupdatemetricsgrpdto,
 * directrulegroupcreatedto,metricsgroupitem,monitorgroupitem,recipientnotification,suspendruleitemdto,
 * metriclistrequest,typegrouprelatedruledto,deleterulegroupitemdto}.
 *
 * 쿼리 + 바디를 함께 쓰는 DELETE/POST 는 requestRaw(..., { regionHeader: true }) 로 호출해
 * postRequest/deleteRequest 와 같은 x-ncp-region_code 헤더를 유지한다.
 */
const CW = "/cw_fea/real/cw/api";

export function registerCloudInsightRuleTools(server: McpServer, client: NcloudClient): void {
  // ─── 공용 스키마 (가이드 DTO) ────────────────────────────────────────────
  const dimensionDto = z.object({
    dim: z.string().describe("Dimension name defined in the schema (e.g. \"type\")"),
    val: z.string().describe("Dimension value (e.g. \"svr\")"),
  });

  // MetricsGroupItem — condition 은 LT|LE|EQ|GE|GT (가이드), calculation 은 COUNT|SUM|MAX|MIN|AVG
  const metricsGroupItem = z.object({
    metric: z.string().describe("Metric name (e.g. avg_cpu_used_rto)"),
    eventLevel: z.enum(["INFO", "WARNING", "CRITICAL"]).describe("Event level"),
    condition: z.enum(["LT", "LE", "EQ", "GE", "GT"]).describe("Threshold operator (LT, LE, EQ, GE, GT)"),
    calculation: z.enum(["COUNT", "SUM", "MAX", "MIN", "AVG"]).describe("Aggregation of the metric"),
    duration: z.number().describe("Duration (>= 1)"),
    threshold: z.number().describe("Threshold value"),
    dimensions: z.array(dimensionDto).optional().describe("Dimension filters, e.g. [{dim:\"type\", val:\"svr\"}]"),
    desc: z.string().optional().describe("Metric description"),
    metricGroupItemId: z.string().optional().describe("Metric group item ID (when updating an existing item)"),
  });

  const monitorGroupItem = z.object({
    resourceId: z.string().describe("Monitoring target resource ID (e.g. server instance number)"),
    nrn: z.string().optional().describe("Resource NRN (Resource Manager)"),
    resourceName: z.string().optional().describe("Resource name"),
  });

  const recipientNotification = z.object({
    groupNum: z.number().optional().describe("Notification recipient group number"),
    groupName: z.string().optional().describe("Notification recipient group name"),
    notifyTypes: z.array(z.enum(["SMS", "EMAIL"])).optional().describe("Notification methods (SMS, EMAIL)"),
    reminderTime: z.number().optional().describe("Reminder interval in minutes (5-720)"),
    enableNotiWhenEventClose: z.boolean().optional().describe("Send a notification when the event closes"),
  });

  const asgPolicy = z.object({
    autoScalingGroupNo: z.number().optional().describe("Auto Scaling group number"),
    autoScalingPolicyNo: z.number().optional().describe("Auto Scaling policy number"),
    policyName: z.string().optional().describe("Auto Scaling policy name"),
  });

  const suspendRuleItem = z.object({
    resourceId: z.string().describe("Monitoring target ID"),
    metricGroupItemId: z.string().describe("Metric item ID"),
  });

  // MonitorGrpDto (createDirectly 의 monitorGroup / create·update monitor group 바디)
  const monitorGrpShape = {
    prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key) for the target service"),
    groupName: z.string().optional().describe("Name of the monitor group"),
    groupDesc: z.string().optional().describe("Description of the monitor group"),
    monitorGroupItemList: z.array(monitorGroupItem).describe("Monitoring targets ([{resourceId, nrn?}])"),
    temporaryGroup: z.boolean().optional().describe("true: create the Event Rule without creating a monitor group"),
    type: z.enum(["NORMAL", "ASG"]).optional().describe("Target group type: NORMAL (default) or ASG (Auto Scaling Group)"),
    prodName: z.string().optional().describe("Product name"),
  };

  // CreateOrUpdateMetricsGrpDto
  const metricsGrpShape = {
    prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key) for the target service"),
    groupName: z.string({ required_error: requiredError("groupName") }).describe("Name of the metrics group (1-100 chars)"),
    groupDesc: z.string().optional().describe("Description (<= 300 chars)"),
    metricsGroupItems: z.array(metricsGroupItem).min(1).describe("Metric items (at least one)"),
    temporaryGroup: z.boolean().optional().default(false).describe("true: create the Event Rule without creating a metrics group (default false)"),
    prodType: z.enum(["system", "custom"]).optional().describe("Product type: system (Ncloud product) or custom (Custom Schema)"),
  };

  /** TypeGroupRelatedRuleDto[] — get_rules_by_*_group 응답을 그대로 넘긴다. */
  const relatedRuleGroups = z.array(z.object({
    id: z.string().describe("Monitor group or metrics group ID to delete"),
    ruleGroupItemDtoList: z.array(z.record(z.unknown())).describe("Event Rules related to the group (RuleGroupItemDto[], as returned by ncloud_get_rules_by_metrics_group / ncloud_get_rules_by_monitor_group)"),
  }));

  const pick = (src: Record<string, unknown>, keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
    return out;
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Event Rule (rule group)
  // ═══════════════════════════════════════════════════════════════════════

  // ncloud_list_rule_groups — POST /rule/group/ruleGrp/query (getrulegrouplist)
  defineTool(
    server,
    "ncloud_list_rule_groups",
    "Get the list of Cloud Insight event rule groups for monitoring alerts.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key) to filter rule groups (required)"),
      pageSize: z.number({ required_error: requiredError("pageSize") }).describe("Number of results per page (required)"),
      pageNum: z.number({ required_error: requiredError("pageNum") }).describe("Page number (required, starts from 1)"),
      search: z.string().optional().describe("Search keyword to filter rule groups"),
    },
    async (params) => {
      const body: Record<string, unknown> = { prodKey: params.prodKey, pageSize: params.pageSize, pageNum: params.pageNum };
      if (params.search !== undefined) body.search = params.search;
      return client.postRequest(`${CW}/rule/group/ruleGrp/query`, body);
    }
  );

  // ncloud_get_rule_group — GET /rule/group/ruleGrp/query/{prodKey}/{id} (getrulegroup)
  defineTool(
    server,
    "ncloud_get_rule_group",
    "Get detailed information about a specific Cloud Insight event rule group.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key) the rule group belongs to"),
      ruleGroupId: z.string({ required_error: requiredError("ruleGroupId") }).describe("Rule group (Event Rule) ID to retrieve"),
    },
    async (params) => {
      return client.requestRaw("GET", `${CW}/rule/group/ruleGrp/query/${encodeURIComponent(params.prodKey)}/${encodeURIComponent(params.ruleGroupId)}`);
    }
  );

  const ruleGroupBodyShape = {
    prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key) for the target service"),
    groupName: z.string({ required_error: requiredError("groupName") }).describe("Name of the rule group (1-1000 chars)"),
    metricsGroupKey: z.array(z.string()).min(1).describe("Metrics group (rule template) IDs to apply (at least one)"),
    monitorGroupKey: z.array(z.string()).min(1).describe("Monitor group (target group) IDs to monitor (at least one)"),
    groupDesc: z.string().optional().describe("Description (<= 300 chars)"),
    recipientNotifications: z.array(recipientNotification).optional().describe("Notification recipient groups"),
    personalNotificationRecipients: z.array(recipientNotification).optional().describe("Personal notification recipients"),
    asgPolicyList: z.array(asgPolicy).optional().describe("Auto Scaling group policies"),
    suspendRuleItems: z.array(suspendRuleItem).optional().describe("Rule items to suspend ([{resourceId, metricGroupItemId}])"),
  };
  const RULE_GROUP_KEYS = ["prodKey", "groupName", "metricsGroupKey", "monitorGroupKey", "groupDesc", "recipientNotifications", "personalNotificationRecipients", "asgPolicyList", "suspendRuleItems"];

  // ncloud_create_rule_group — POST /rule/group/ruleGrp (createrulegroup, CreateOrUpdateRuleGroupDto)
  defineTool(
    server,
    "ncloud_create_rule_group",
    "Create a new Cloud Insight event rule group for monitoring alerts. Links existing monitor groups (targets) and metrics groups (rule templates) and optional notification recipients.",
    {
      ...ruleGroupBodyShape,
      dryRun: z.boolean().optional().describe("If true, returns a preview without creating the rule group (default: false)"),
    },
    async (params) => {
      const body = pick(params, RULE_GROUP_KEYS);
      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Cloud Insight Rule Group Creation",
          endpoint: `${CW}/rule/group/ruleGrp`,
          method: "POST",
          requestParams: body,
          noun: { ko: "이벤트 규칙 그룹", en: "event rule group" },
        });
      }
      return client.postRequest(`${CW}/rule/group/ruleGrp`, body);
    }
  );

  // ncloud_update_rule_group — POST /rule/group/ruleGrp/update (updaterulegroup)
  defineTool(
    server,
    "ncloud_update_rule_group",
    "Update an existing Cloud Insight event rule group. groupName cannot be changed — pass the current name.",
    {
      ruleGroupId: z.string({ required_error: requiredError("ruleGroupId") }).describe("Rule group (Event Rule) ID to update"),
      ...ruleGroupBodyShape,
    },
    async (params) => {
      const body = { id: params.ruleGroupId, ...pick(params, RULE_GROUP_KEYS) };
      return client.postRequest(`${CW}/rule/group/ruleGrp/update`, body);
    }
  );

  // ncloud_delete_rule_group — POST /rule/group/ruleGrp/del (deleterulegroup, items: DeleteRuleGroupItemDto[])
  defineTool(
    server,
    "ncloud_delete_rule_group",
    "⚠️ Destructive: Delete one or more Cloud Insight event rule groups. This permanently removes the rule groups and stops their monitoring alerts.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key) the rule groups belong to"),
      ruleGroupIds: z.array(z.string()).min(1).describe("Rule group (Event Rule) IDs to delete"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion. If false or omitted, returns a confirmation prompt."),
    },
    async (params) => {
      const body = { items: params.ruleGroupIds.map((ruleGroupId) => ({ prodKey: params.prodKey, ruleGroupId })) };
      return client.postRequest(`${CW}/rule/group/ruleGrp/del`, body);
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Cloud Insight Rule Group(s) [${params.ruleGroupIds.join(", ")}]. All associated monitoring alerts will be stopped. Do you want to proceed? (yes/no)\n\nTo confirm, call this tool again with confirm=true.` } }
  );

  // ncloud_delete_rule_group_by_id — DELETE /rule/group/ruleGrp/del/{prodKey}/{id} (deleterulegroupbyprodkeyandid)
  defineTool(
    server,
    "ncloud_delete_rule_group_by_id",
    "⚠️ Destructive: Delete a Cloud Insight event rule by product key and rule group ID.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key)"),
      ruleGroupId: z.string({ required_error: requiredError("ruleGroupId") }).describe("Rule group ID to delete"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion."),
    },
    async (params) => {
      return client.deleteRequest(`${CW}/rule/group/ruleGrp/del/${encodeURIComponent(params.prodKey)}/${encodeURIComponent(params.ruleGroupId)}`);
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete rule group [${params.ruleGroupId}]. To confirm, call this tool again with confirm=true.` } }
  );

  // ncloud_copy_rule_group — PUT /rule/group/ruleGrp/copy/{id} (copyrulegroup)
  defineTool(
    server,
    "ncloud_copy_rule_group",
    "Copy an existing Cloud Insight event rule group to create a new one.",
    {
      ruleGroupId: z.string({ required_error: requiredError("ruleGroupId") }).describe("Source rule group ID to copy from"),
    },
    async (params) => {
      return client.requestRaw("PUT", `${CW}/rule/group/ruleGrp/copy/${encodeURIComponent(params.ruleGroupId)}`, undefined, undefined, { regionHeader: true });
    }
  );

  // ncloud_create_rule_directly — POST /rule/group/ruleGrp/createDirectly (createruledirectly, DirectRuleGroupCreateDto)
  defineTool(
    server,
    "ncloud_create_rule_directly",
    "Create a Cloud Insight event rule by directly specifying the monitor group (targets) and metrics group (rule template) inline, without pre-created groups.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key)"),
      groupName: z.string({ required_error: requiredError("groupName") }).describe("Name of the rule group (1-100 chars)"),
      groupDesc: z.string().optional().describe("Description (<= 300 chars)"),
      monitorGroup: z.object(monitorGrpShape).describe("Monitor group definition (MonitorGrpDto)"),
      metricsGroup: z.object(metricsGrpShape).describe("Metrics group definition (CreateOrUpdateMetricsGrpDto)"),
      recipientNotifications: z.array(recipientNotification).optional().describe("Notification recipient groups"),
      personalNotificationRecipients: z.array(recipientNotification).optional().describe("Personal notification recipients"),
      asgPolicys: z.array(asgPolicy).optional().describe("VPC Auto Scaling group policies"),
      classicAsgPolicys: z.array(asgPolicy).optional().describe("Classic Auto Scaling group policies"),
      cfTriggers: z.array(z.string()).optional().describe("Cloud Functions trigger names"),
    },
    async (params) => {
      const body = pick(params, ["prodKey", "groupName", "groupDesc", "monitorGroup", "metricsGroup", "recipientNotifications", "personalNotificationRecipients", "asgPolicys", "classicAsgPolicys", "cfTriggers"]);
      return client.postRequest(`${CW}/rule/group/ruleGrp/createDirectly`, body);
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Monitor group (감시 대상 그룹)
  // ═══════════════════════════════════════════════════════════════════════

  // ncloud_list_monitor_groups — GET /rule/group/monitor/{prodKey} (getallmonitorgrp)
  defineTool(
    server,
    "ncloud_list_monitor_groups",
    "Get the list of Cloud Insight monitoring target groups for a specific product.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key) to get monitor groups for (required, use ncloud_get_schema_keys to find available keys)"),
    },
    async (params) => {
      return client.requestRaw("GET", `${CW}/rule/group/monitor/${encodeURIComponent(params.prodKey)}`);
    }
  );

  // ncloud_get_monitor_group — GET /rule/group/monitor/{prodKey}/{id} (getmonitorgrp)
  defineTool(
    server,
    "ncloud_get_monitor_group",
    "Get detailed information about a specific Cloud Insight monitoring target group.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key) the monitor group belongs to"),
      monitorGroupId: z.string({ required_error: requiredError("monitorGroupId") }).describe("Monitor group ID to retrieve details for"),
    },
    async (params) => {
      return client.requestRaw("GET", `${CW}/rule/group/monitor/${encodeURIComponent(params.prodKey)}/${encodeURIComponent(params.monitorGroupId)}`);
    }
  );

  const MONITOR_KEYS = ["prodKey", "groupName", "groupDesc", "monitorGroupItemList", "temporaryGroup", "type", "prodName"];

  // ncloud_create_monitor_group — POST /rule/group/monitor (createmonitorgrp, MonitorGrpDto)
  defineTool(
    server,
    "ncloud_create_monitor_group",
    "Create a new Cloud Insight monitoring target group (감시 대상 그룹).",
    monitorGrpShape,
    async (params) => {
      return client.postRequest(`${CW}/rule/group/monitor`, pick(params, MONITOR_KEYS));
    }
  );

  // ncloud_update_monitor_group — PUT /rule/group/monitor (updatemonitorgrp, MonitorGrpDto with id)
  defineTool(
    server,
    "ncloud_update_monitor_group",
    "Update an existing Cloud Insight monitoring target group.",
    {
      monitorGroupId: z.string({ required_error: requiredError("monitorGroupId") }).describe("Monitor group ID to update"),
      ...monitorGrpShape,
    },
    async (params) => {
      return client.putRequest(`${CW}/rule/group/monitor`, { id: params.monitorGroupId, ...pick(params, MONITOR_KEYS) });
    }
  );

  // ncloud_delete_monitor_group — DELETE /rule/group/monitor?prodKey= body [ids] (deletemonitorgrp)
  defineTool(
    server,
    "ncloud_delete_monitor_group",
    "⚠️ Destructive: Delete one or more Cloud Insight monitoring target groups. This will permanently remove the groups.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key) the monitor groups belong to"),
      monitorGroupIds: z.array(z.string()).min(1).describe("Monitor group IDs to delete"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion."),
    },
    async (params) => {
      return client.requestRaw("DELETE", `${CW}/rule/group/monitor`, { prodKey: params.prodKey }, params.monitorGroupIds, { regionHeader: true });
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete monitor group(s) [${params.monitorGroupIds.join(", ")}]. To confirm, call this tool again with confirm=true.` } }
  );

  // ncloud_delete_monitor_group_force — DELETE /rule/group/monitor/groups?prodKey= body TypeGroupRelatedRuleDto[] (deletemonitorgroupforce)
  defineTool(
    server,
    "ncloud_delete_monitor_group_force",
    "⚠️ Destructive: Force delete monitoring target groups together with ALL event rules related to them. Pass the groups as returned by ncloud_get_rules_by_monitor_group. This is irreversible.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key)"),
      groups: relatedRuleGroups.describe("Monitor groups and their related event rules ([{id, ruleGroupItemDtoList}], from ncloud_get_rules_by_monitor_group)"),
      confirm: z.boolean().optional().describe("Must be true to execute force deletion."),
    },
    async (params) => {
      return client.requestRaw("DELETE", `${CW}/rule/group/monitor/groups`, { prodKey: params.prodKey }, params.groups, { regionHeader: true });
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete monitor group(s) [${params.groups.map((g: { id: string }) => g.id).join(", ")}] and ALL related event rules. This is irreversible. To confirm, call this tool again with confirm=true.` } }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Metrics group (Rule Template / 감시 항목 그룹)
  // ═══════════════════════════════════════════════════════════════════════

  // ncloud_list_metrics_groups — GET /rule/group/metrics/query/{prodKey} (getmetricsgrouplist)
  defineTool(
    server,
    "ncloud_list_metrics_groups",
    "Get the list of Cloud Insight rule templates (monitoring item groups / metrics groups) for a product.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key) to list metrics groups for (required)"),
    },
    async (params) => {
      return client.requestRaw("GET", `${CW}/rule/group/metrics/query/${encodeURIComponent(params.prodKey)}`);
    }
  );

  // ncloud_get_metrics_group — GET /rule/group/metrics/query/{prodKey}/{id} (getmetricsgroup)
  defineTool(
    server,
    "ncloud_get_metrics_group",
    "Get detailed information about a specific Cloud Insight rule template (metrics group).",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key) the metrics group belongs to"),
      metricsGroupId: z.string({ required_error: requiredError("metricsGroupId") }).describe("Metrics group ID to retrieve details for"),
    },
    async (params) => {
      return client.requestRaw("GET", `${CW}/rule/group/metrics/query/${encodeURIComponent(params.prodKey)}/${encodeURIComponent(params.metricsGroupId)}`);
    }
  );

  const METRICS_KEYS = ["prodKey", "groupName", "groupDesc", "metricsGroupItems", "temporaryGroup", "prodType"];

  // ncloud_create_metrics_group — POST /rule/group/metrics (createmetricsgrp, CreateOrUpdateMetricsGrpDto)
  defineTool(
    server,
    "ncloud_create_metrics_group",
    "Create a new Cloud Insight rule template (감시 항목 그룹 / metrics group).",
    metricsGrpShape,
    async (params) => {
      return client.postRequest(`${CW}/rule/group/metrics`, pick(params, METRICS_KEYS));
    }
  );

  // ncloud_update_metrics_group — POST /rule/group/metrics/update (updatemetricsgroup)
  defineTool(
    server,
    "ncloud_update_metrics_group",
    "Update an existing Cloud Insight rule template (metrics group).",
    {
      metricsGroupId: z.string({ required_error: requiredError("metricsGroupId") }).describe("Metrics group ID to update"),
      ...metricsGrpShape,
    },
    async (params) => {
      return client.postRequest(`${CW}/rule/group/metrics/update`, { id: params.metricsGroupId, ...pick(params, METRICS_KEYS) });
    }
  );

  // ncloud_delete_metrics_group — DELETE /rule/group/metrics/del?prodKey= body [ids] (deletemetricsgrp)
  defineTool(
    server,
    "ncloud_delete_metrics_group",
    "⚠️ Destructive: Delete one or more Cloud Insight rule templates (metrics groups).",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key) the metrics groups belong to"),
      metricsGroupIds: z.array(z.string()).min(1).describe("Metrics group IDs to delete"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion."),
    },
    async (params) => {
      return client.requestRaw("DELETE", `${CW}/rule/group/metrics/del`, { prodKey: params.prodKey }, params.metricsGroupIds, { regionHeader: true });
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete metrics group(s) [${params.metricsGroupIds.join(", ")}]. To confirm, call this tool again with confirm=true.` } }
  );

  // ncloud_delete_metrics_group_by_id — DELETE /rule/group/metrics/del/{prodKey}/{id} (deletemetricsgrpbyprodkeyandid)
  defineTool(
    server,
    "ncloud_delete_metrics_group_by_id",
    "⚠️ Destructive: Delete a Cloud Insight rule template by product key and metrics group ID.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key)"),
      metricsGroupId: z.string({ required_error: requiredError("metricsGroupId") }).describe("Metrics group ID to delete"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion."),
    },
    async (params) => {
      return client.deleteRequest(`${CW}/rule/group/metrics/del/${encodeURIComponent(params.prodKey)}/${encodeURIComponent(params.metricsGroupId)}`);
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete metrics group [${params.metricsGroupId}]. To confirm, call this tool again with confirm=true.` } }
  );

  // ncloud_delete_metrics_group_force — DELETE /rule/group/metric/groups?prodKey= body TypeGroupRelatedRuleDto[] (deletemetricgroupforce)
  defineTool(
    server,
    "ncloud_delete_metrics_group_force",
    "⚠️ Destructive: Force delete rule templates (metrics groups) together with ALL event rules related to them. Pass the groups as returned by ncloud_get_rules_by_metrics_group. This is irreversible.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key)"),
      groups: relatedRuleGroups.describe("Metrics groups and their related event rules ([{id, ruleGroupItemDtoList}], from ncloud_get_rules_by_metrics_group)"),
      confirm: z.boolean().optional().describe("Must be true to execute force deletion."),
    },
    async (params) => {
      return client.requestRaw("DELETE", `${CW}/rule/group/metric/groups`, { prodKey: params.prodKey }, params.groups, { regionHeader: true });
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete metrics group(s) [${params.groups.map((g: { id: string }) => g.id).join(", ")}] and ALL related event rules. This is irreversible. To confirm, call this tool again with confirm=true.` } }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Lookups
  // ═══════════════════════════════════════════════════════════════════════

  // ncloud_get_notification_recipients — GET /rule/notify/groups (getnotificationrecipientlist)
  defineTool(
    server,
    "ncloud_get_notification_recipients",
    "Get the list of notification recipient groups configured for Cloud Insight event alerts.",
    {},
    async () => {
      return client.requestRaw("GET", `${CW}/rule/notify/groups`);
    }
  );

  // ncloud_get_rules_by_metrics_group — POST /rule/group/metric/group/related?prodKey= body [ids] (getrulegroupbymetricgroupids)
  defineTool(
    server,
    "ncloud_get_rules_by_metrics_group",
    "Get Cloud Insight event rules associated with specific rule template (metrics group) IDs.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key)"),
      metricsGroupIds: z.array(z.string()).min(1).describe("Metrics group IDs to query"),
    },
    async (params) => {
      return client.requestRaw("POST", `${CW}/rule/group/metric/group/related`, { prodKey: params.prodKey }, params.metricsGroupIds, { regionHeader: true });
    }
  );

  // ncloud_get_rules_by_monitor_group — POST /rule/group/monitor/group/related?prodKey= body [ids] (getrulegroupbymonitorgroupids)
  defineTool(
    server,
    "ncloud_get_rules_by_monitor_group",
    "Get Cloud Insight event rules associated with specific monitoring target group IDs.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key)"),
      monitorGroupIds: z.array(z.string()).min(1).describe("Monitor group IDs to query"),
    },
    async (params) => {
      return client.requestRaw("POST", `${CW}/rule/group/monitor/group/related`, { prodKey: params.prodKey }, params.monitorGroupIds, { regionHeader: true });
    }
  );

  // ncloud_search_metric_list — POST /rule/group/metric/search (searchmetriclist, MetricListRequest)
  defineTool(
    server,
    "ncloud_search_metric_list",
    "Search available monitoring metrics for a specific product in Cloud Insight.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key) to search metrics for"),
      query: z.string().optional().describe("Keyword to search metric names"),
      idDimensions: z.array(z.string()).optional().describe("idDimension names to query"),
      dimValues: z.array(z.object({ name: z.string(), value: z.string() })).optional().describe("Dimension filters ([{name, value}])"),
      dimensionsSelectedList: z.array(z.object({ name: z.string(), values: z.array(z.string()).min(1) })).optional().describe("Search by specific dimension values ([{name, values[]}])"),
    },
    async (params) => {
      return client.postRequest(`${CW}/rule/group/metric/search`, pick(params, ["prodKey", "query", "idDimensions", "dimValues", "dimensionsSelectedList"]));
    }
  );

  // ncloud_remove_resource_from_rules — POST /rule/group/monitor/removeResourceFromRules (removeresourcefromrules)
  defineTool(
    server,
    "ncloud_remove_resource_from_rules",
    "⚠️ Destructive: Remove a specific monitoring target from the given Cloud Insight event rules.",
    {
      prodKey: z.string({ required_error: requiredError("prodKey") }).describe("Product key (cw_key)"),
      resourceId: z.string({ required_error: requiredError("resourceId") }).describe("Resource ID (monitoring target) to remove from rules"),
      ruleGroupIds: z.array(z.string()).min(1).describe("Event Rule (rule group) IDs to remove the resource from"),
      confirm: z.boolean().optional().describe("Must be true to execute removal."),
    },
    async (params) => {
      return client.postRequest(`${CW}/rule/group/monitor/removeResourceFromRules`, { prodKey: params.prodKey, resourceId: params.resourceId, ruleGroupIds: params.ruleGroupIds });
    },
    { destructive: { message: (params) => `⚠️ This will remove resource [${params.resourceId}] from event rule(s) [${params.ruleGroupIds.join(", ")}]. To confirm, call this tool again with confirm=true.` } }
  );
}
