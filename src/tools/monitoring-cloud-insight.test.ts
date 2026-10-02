import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerCloudInsightTools } from "./monitoring-cloud-insight.js";
import { registerCloudInsightRuleTools } from "./monitoring-cloud-insight-rule.js";
import { registerCloudInsightPluginTools } from "./monitoring-cloud-insight-plugin.js";

/**
 * Cloud Insight 경로·바디 — 공식 가이드 management-cloudinsight-* (2026-10-02 대조).
 * 1.16.0~2.0.0 의 rule group 모듈은 전부 가이드에 없는 경로(…/rule/group/<verb>)라 라이브에서 404 였다(zone-test-results §3.1).
 */
const CW = "/cw_fea/real/cw/api";

function setup() {
  const server = new McpServer({ name: "t", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl: "https://cw.apigw.ntruss.com", regionCode: "KR" });
  registerCloudInsightTools(server, client);
  registerCloudInsightRuleTools(server, client);
  registerCloudInsightPluginTools(server, client);
  const tools = (server as any)._registeredTools;
  const entry = (n: string) => (tools instanceof Map ? tools.get(n) : tools[n]);
  return {
    client,
    has: (n: string) => !!entry(n),
    call: (n: string, a: any) => entry(n).handler(entry(n).inputSchema.parse(a), {} as any),
    parse: (n: string, a: any) => entry(n).inputSchema.safeParse(a),
  };
}

describe("Cloud Insight rule group: 가이드 경로", () => {
  it("Event Rule: query(POST)/{prodKey}/{id}(GET)/ruleGrp(POST)/update/del/copy(PUT)/createDirectly", async () => {
    const t = setup();
    const post = vi.spyOn(t.client, "postRequest").mockResolvedValue({});
    const raw = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    const del = vi.spyOn(t.client, "deleteRequest").mockResolvedValue({});

    await t.call("ncloud_list_rule_groups", { prodKey: "pk", pageSize: 3, pageNum: 1 });
    expect(post).toHaveBeenCalledWith(`${CW}/rule/group/ruleGrp/query`, { prodKey: "pk", pageSize: 3, pageNum: 1 });

    await t.call("ncloud_get_rule_group", { prodKey: "pk", ruleGroupId: "rg1" });
    expect(raw).toHaveBeenCalledWith("GET", `${CW}/rule/group/ruleGrp/query/pk/rg1`);

    await t.call("ncloud_create_rule_group", { prodKey: "pk", groupName: "g", metricsGroupKey: ["m1"], monitorGroupKey: ["t1"], groupDesc: "d" });
    expect(post).toHaveBeenCalledWith(`${CW}/rule/group/ruleGrp`, { prodKey: "pk", groupName: "g", metricsGroupKey: ["m1"], monitorGroupKey: ["t1"], groupDesc: "d" });

    await t.call("ncloud_update_rule_group", { ruleGroupId: "rg1", prodKey: "pk", groupName: "g", metricsGroupKey: ["m1"], monitorGroupKey: ["t1"], recipientNotifications: [{ groupNum: 1, notifyTypes: ["SMS"] }] });
    expect(post).toHaveBeenCalledWith(`${CW}/rule/group/ruleGrp/update`, { id: "rg1", prodKey: "pk", groupName: "g", metricsGroupKey: ["m1"], monitorGroupKey: ["t1"], recipientNotifications: [{ groupNum: 1, notifyTypes: ["SMS"] }] });

    await t.call("ncloud_delete_rule_group", { prodKey: "pk", ruleGroupIds: ["rg1", "rg2"], confirm: true });
    expect(post).toHaveBeenCalledWith(`${CW}/rule/group/ruleGrp/del`, { items: [{ prodKey: "pk", ruleGroupId: "rg1" }, { prodKey: "pk", ruleGroupId: "rg2" }] });

    await t.call("ncloud_delete_rule_group_by_id", { prodKey: "pk", ruleGroupId: "rg1", confirm: true });
    expect(del).toHaveBeenCalledWith(`${CW}/rule/group/ruleGrp/del/pk/rg1`);

    await t.call("ncloud_copy_rule_group", { ruleGroupId: "rg1" });
    expect(raw).toHaveBeenCalledWith("PUT", `${CW}/rule/group/ruleGrp/copy/rg1`, undefined, undefined, { regionHeader: true });

    await t.call("ncloud_create_rule_directly", {
      prodKey: "pk", groupName: "g",
      monitorGroup: { prodKey: "pk", groupName: "mg", monitorGroupItemList: [{ resourceId: "r1" }] },
      metricsGroup: { prodKey: "pk", groupName: "tg", metricsGroupItems: [{ metric: "avg_cpu_used_rto", eventLevel: "INFO", condition: "GT", calculation: "AVG", duration: 1, threshold: 1 }] },
    });
    const direct = post.mock.calls.find((c) => c[0] === `${CW}/rule/group/ruleGrp/createDirectly`)![1] as any;
    expect(direct.monitorGroup.monitorGroupItemList).toEqual([{ resourceId: "r1" }]);
    expect(direct.metricsGroup.temporaryGroup).toBe(false);
  });

  it("삭제는 confirm 없이는 API 호출 없음", async () => {
    const t = setup();
    const post = vi.spyOn(t.client, "postRequest").mockResolvedValue({});
    const res = await t.call("ncloud_delete_rule_group", { prodKey: "pk", ruleGroupIds: ["rg1"] });
    expect(post).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).toContain("confirm=true");
  });

  it("Monitor group: GET monitor/{prodKey}[/{id}], POST/PUT monitor, DELETE monitor?prodKey= [ids], DELETE monitor/groups?prodKey=", async () => {
    const t = setup();
    const post = vi.spyOn(t.client, "postRequest").mockResolvedValue({});
    const put = vi.spyOn(t.client, "putRequest").mockResolvedValue({});
    const raw = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});

    await t.call("ncloud_list_monitor_groups", { prodKey: "pk" });
    expect(raw).toHaveBeenCalledWith("GET", `${CW}/rule/group/monitor/pk`);
    await t.call("ncloud_get_monitor_group", { prodKey: "pk", monitorGroupId: "mg1" });
    expect(raw).toHaveBeenCalledWith("GET", `${CW}/rule/group/monitor/pk/mg1`);

    await t.call("ncloud_create_monitor_group", { prodKey: "pk", groupName: "mg", monitorGroupItemList: [{ resourceId: "r1", nrn: "nrn:1" }] });
    expect(post).toHaveBeenCalledWith(`${CW}/rule/group/monitor`, { prodKey: "pk", groupName: "mg", monitorGroupItemList: [{ resourceId: "r1", nrn: "nrn:1" }] });

    await t.call("ncloud_update_monitor_group", { monitorGroupId: "mg1", prodKey: "pk", groupName: "mg", monitorGroupItemList: [{ resourceId: "r1" }], type: "NORMAL" });
    expect(put).toHaveBeenCalledWith(`${CW}/rule/group/monitor`, { id: "mg1", prodKey: "pk", groupName: "mg", monitorGroupItemList: [{ resourceId: "r1" }], type: "NORMAL" });

    await t.call("ncloud_delete_monitor_group", { prodKey: "pk", monitorGroupIds: ["mg1", "mg2"], confirm: true });
    expect(raw).toHaveBeenCalledWith("DELETE", `${CW}/rule/group/monitor`, { prodKey: "pk" }, ["mg1", "mg2"], { regionHeader: true });

    const groups = [{ id: "mg1", ruleGroupItemDtoList: [{ id: "rg1", groupName: "x" }] }];
    await t.call("ncloud_delete_monitor_group_force", { prodKey: "pk", groups, confirm: true });
    expect(raw).toHaveBeenCalledWith("DELETE", `${CW}/rule/group/monitor/groups`, { prodKey: "pk" }, groups, { regionHeader: true });
  });

  it("Metrics group: GET metrics/query/{prodKey}[/{id}], POST metrics[/update], DELETE metrics/del(?prodKey=|/{prodKey}/{id}), DELETE metric/groups", async () => {
    const t = setup();
    const post = vi.spyOn(t.client, "postRequest").mockResolvedValue({});
    const raw = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    const del = vi.spyOn(t.client, "deleteRequest").mockResolvedValue({});

    await t.call("ncloud_list_metrics_groups", { prodKey: "pk" });
    expect(raw).toHaveBeenCalledWith("GET", `${CW}/rule/group/metrics/query/pk`);
    await t.call("ncloud_get_metrics_group", { prodKey: "pk", metricsGroupId: "tg1" });
    expect(raw).toHaveBeenCalledWith("GET", `${CW}/rule/group/metrics/query/pk/tg1`);

    const item = { metric: "avg_cpu_used_rto", eventLevel: "WARNING", condition: "GE", calculation: "AVG", duration: 5, threshold: 80, dimensions: [{ dim: "type", val: "svr" }] };
    await t.call("ncloud_create_metrics_group", { prodKey: "pk", groupName: "tg", metricsGroupItems: [item] });
    expect(post).toHaveBeenCalledWith(`${CW}/rule/group/metrics`, { prodKey: "pk", groupName: "tg", metricsGroupItems: [item], temporaryGroup: false });

    await t.call("ncloud_update_metrics_group", { metricsGroupId: "tg1", prodKey: "pk", groupName: "tg", metricsGroupItems: [item], temporaryGroup: false });
    expect(post).toHaveBeenCalledWith(`${CW}/rule/group/metrics/update`, { id: "tg1", prodKey: "pk", groupName: "tg", metricsGroupItems: [item], temporaryGroup: false });

    await t.call("ncloud_delete_metrics_group", { prodKey: "pk", metricsGroupIds: ["tg1"], confirm: true });
    expect(raw).toHaveBeenCalledWith("DELETE", `${CW}/rule/group/metrics/del`, { prodKey: "pk" }, ["tg1"], { regionHeader: true });
    await t.call("ncloud_delete_metrics_group_by_id", { prodKey: "pk", metricsGroupId: "tg1", confirm: true });
    expect(del).toHaveBeenCalledWith(`${CW}/rule/group/metrics/del/pk/tg1`);
    await t.call("ncloud_delete_metrics_group_force", { prodKey: "pk", groups: [{ id: "tg1", ruleGroupItemDtoList: [] }], confirm: true });
    expect(raw).toHaveBeenCalledWith("DELETE", `${CW}/rule/group/metric/groups`, { prodKey: "pk" }, [{ id: "tg1", ruleGroupItemDtoList: [] }], { regionHeader: true });

    // 가이드 condition 집합은 LT|LE|EQ|GE|GT — 과거의 GTE/LTE 는 거부
    expect(t.parse("ncloud_create_metrics_group", { prodKey: "pk", groupName: "tg", metricsGroupItems: [{ ...item, condition: "GTE" }] }).success).toBe(false);
  });

  it("조회 보조: notify/groups(GET), metric|monitor/group/related?prodKey= [ids], metric/search, removeResourceFromRules", async () => {
    const t = setup();
    const post = vi.spyOn(t.client, "postRequest").mockResolvedValue({});
    const raw = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});

    await t.call("ncloud_get_notification_recipients", {});
    expect(raw).toHaveBeenCalledWith("GET", `${CW}/rule/notify/groups`);
    await t.call("ncloud_get_rules_by_metrics_group", { prodKey: "pk", metricsGroupIds: ["tg1"] });
    expect(raw).toHaveBeenCalledWith("POST", `${CW}/rule/group/metric/group/related`, { prodKey: "pk" }, ["tg1"], { regionHeader: true });
    await t.call("ncloud_get_rules_by_monitor_group", { prodKey: "pk", monitorGroupIds: ["mg1"] });
    expect(raw).toHaveBeenCalledWith("POST", `${CW}/rule/group/monitor/group/related`, { prodKey: "pk" }, ["mg1"], { regionHeader: true });
    await t.call("ncloud_search_metric_list", { prodKey: "pk", query: "used", dimValues: [{ name: "type", value: "cpu" }] });
    expect(post).toHaveBeenCalledWith(`${CW}/rule/group/metric/search`, { prodKey: "pk", query: "used", dimValues: [{ name: "type", value: "cpu" }] });
    await t.call("ncloud_remove_resource_from_rules", { prodKey: "pk", resourceId: "r1", ruleGroupIds: ["rg1"], confirm: true });
    expect(post).toHaveBeenCalledWith(`${CW}/rule/group/monitor/removeResourceFromRules`, { prodKey: "pk", resourceId: "r1", ruleGroupIds: ["rg1"] });
  });
});

describe("Cloud Insight 데이터·이벤트·대시보드: 가이드 경로", () => {
  it("data/query(productName, dimensions 필수), query/multiple(metricInfoList), event/search(EventSearchRequest), searchEventCountConsole", async () => {
    const t = setup();
    const post = vi.spyOn(t.client, "postRequest").mockResolvedValue({});

    await t.call("ncloud_query_monitoring_data", { cw_key: "pk", metric: "avg_cpu_used_rto", timeStart: 1, timeEnd: 2, dimensions: { instanceNo: "1" }, productName: "System/Server(VPC)", interval: "Min1" });
    expect(post).toHaveBeenCalledWith(`${CW}/data/query`, { cw_key: "pk", metric: "avg_cpu_used_rto", timeStart: 1, timeEnd: 2, dimensions: { instanceNo: "1" }, productName: "System/Server(VPC)", interval: "Min1" });
    expect(t.parse("ncloud_query_monitoring_data", { cw_key: "pk", metric: "m", timeStart: 1, timeEnd: 2 }).success).toBe(false);

    const info = { prodKey: "pk", metric: "avg_cpu_used_rto", interval: "Min1", dimensions: { instanceNo: "1" }, aggregation: "AVG" };
    await t.call("ncloud_query_monitoring_data_multiple", { timeStart: 1, timeEnd: 2, metricInfoList: [info] });
    expect(post).toHaveBeenCalledWith(`${CW}/data/query/multiple`, { timeStart: 1, timeEnd: 2, metricInfoList: [info] });

    await t.call("ncloud_search_events", { startTime: 1, endTime: 2, ruleId: "rg1", onlyFetchUnCloseEvent: true });
    expect(post).toHaveBeenCalledWith(`${CW}/event/search`, { startTime: 1, endTime: 2, ruleId: "rg1", onlyFetchUnCloseEvent: true });
    await t.call("ncloud_search_event_by_id", { eventId: "e1", ruleId: "rg1", startTime: 1, endTime: 2 });
    expect(post).toHaveBeenCalledWith(`${CW}/event/searchById`, { eventId: "e1", ruleId: "rg1", startTime: 1, endTime: 2 });
    await t.call("ncloud_search_event_count", { startTime: 1, endTime: 2 });
    expect(post).toHaveBeenCalledWith(`${CW}/event/searchEventCountConsole`, { startTime: 1, endTime: 2 });
  });

  it("dashboard/{id}/widgets, widgets/{widgetId}?startTime&endTime (binary), data/chart/preview, cw_collector/real/data, servers/top?query=&prod=", async () => {
    const t = setup();
    const post = vi.spyOn(t.client, "postRequest").mockResolvedValue({});
    const raw = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    const bin = vi.spyOn(t.client, "requestBinary").mockResolvedValue({ contentType: "image/png", bytes: 3 });

    await t.call("ncloud_get_dashboard_widgets", { dashboardId: "d1" });
    expect(raw).toHaveBeenCalledWith("GET", `${CW}/chart/dashboard/d1/widgets`);

    await t.call("ncloud_get_dashboard_widget_image", { dashboardId: "d1", widgetId: "w1", startTime: 1, endTime: 2, widgetResolutionMode: "HIGH", savePath: "/tmp/w.png" });
    expect(bin).toHaveBeenCalledWith("GET", `${CW}/chart/dashboard/d1/widgets/w1`, { startTime: 1, endTime: 2, widgetResolutionMode: "HIGH" }, undefined, { savePath: "/tmp/w.png" });

    const mi = { prodKey: "pk", metric: "avg_write_cnt", statistic: "COUNT", period: "Min30", dimensions: { type: "svr" } };
    await t.call("ncloud_query_widget_preview", { periodStart: 1, periodEnd: 2, metricsInfo: [mi] });
    expect(post).toHaveBeenCalledWith(`${CW}/data/chart/preview`, { periodStart: 1, periodEnd: 2, metricsInfo: [mi] });

    await t.call("ncloud_send_monitoring_data", { cw_key: "pk", data: { cpu: 1.5, instanceId: "i1" } });
    expect(post).toHaveBeenCalledWith("/cw_collector/real/data", { cw_key: "pk", data: { cpu: 1.5, instanceId: "i1" } });

    await t.call("ncloud_get_servers_top", { query: "avg_cpu_used_rto", prod: "VPC" });
    expect(raw).toHaveBeenCalledWith("POST", `${CW}/servers/top`, { query: "avg_cpu_used_rto", prod: "VPC" }, undefined, { regionHeader: true });
  });
});

describe("Cloud Insight plugin: 계획 점검·커스텀 스키마 (zone-test-results §3.2)", () => {
  it("list_maintenances 기본창은 30일(31일 한도), 초과 범위는 호출 없이 거절", async () => {
    const t = setup();
    const raw = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call("ncloud_list_maintenances", {});
    const q = raw.mock.calls[0][2] as any;
    expect(raw.mock.calls[0][1]).toBe(`${CW}/planned-maintenances`);
    expect(q.to - q.from).toBe(30 * 86_400_000);
    expect(q.timeType).toBe("startTime");
    raw.mockClear();
    const res = await t.call("ncloud_list_maintenances", { from: 0, to: 40 * 86_400_000 });
    expect(res.isError).toBe(true);
    expect(raw).not.toHaveBeenCalled();
    await t.call("ncloud_list_maintenances", { resourceId: "r1", productKey: "pk" });
    expect(raw).toHaveBeenCalledWith("GET", `${CW}/planned-maintenances`, { pageNum: 1, pageSize: 100, resourceId: "r1", productKey: "pk" });
  });

  it("create_maintenance dimensions 는 {cw_key: [{dim: val}]} (PMCreateUpdateDto)", async () => {
    const t = setup();
    const post = vi.spyOn(t.client, "postRequest").mockResolvedValue({});
    const dims = { "123": [{ instanceNo: "1111", type: "svr" }] };
    await t.call("ncloud_create_maintenance", { title: "pm", startTime: 1, endTime: 2, dimensions: dims });
    expect(post).toHaveBeenCalledWith(`${CW}/planned-maintenances`, { title: "pm", startTime: 1, endTime: 2, dimensions: dims });
    expect(t.parse("ncloud_create_maintenance", { title: "pm", startTime: 1, endTime: 2, dimensions: { instanceNo: "1" } }).success).toBe(false);
  });

  it("create_custom_schema: prodName 은 'Custom/' 접두 문자열, fields 는 FieldDto(name/dataType/…)", async () => {
    const t = setup();
    const post = vi.spyOn(t.client, "postRequest").mockResolvedValue({});
    const fields = [
      { name: "Dimension_test", dataType: "STRING", dimension: true, metric: false, idDimension: true },
      { name: "Metric_Test", dataType: "FLOAT", metric: true, aggregations: { Min1: ["AVG"] } },
    ];
    await t.call("ncloud_create_custom_schema", { prodName: "Custom/MyProduct", fields });
    expect(post).toHaveBeenCalledWith(`${CW}/schema`, { prodName: "Custom/MyProduct", fields });
    expect(t.parse("ncloud_create_custom_schema", { prodName: "my-product", fields }).success).toBe(false);
    expect(t.parse("ncloud_create_custom_schema", { prodName: "Custom/x", fields: [{ fieldName: "a", fieldType: "STRING" }] }).success).toBe(false);
  });
});
