import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError } from "./_messages.js";

/**
 * WMS (Web service Monitoring System) 도구 — 두 존 제공.
 *
 * Base URL: https://wms.apigw.ntruss.com (민간존) / https://wms.apigw.gov-ntruss.com (공공존) — registry 에서 주입.
 * REST(JSON), 인증 HMAC-SHA256, 리전 파라미터 없음 → client.requestRaw.
 *
 * 오퍼레이션 5종(두 존 동일, 2026-09-30 원문 대조 — management-wms-scripts/scriptinfo/scriptresult/scriptstart/scriptstop):
 *   GET /api/v1/scenarios                                   모니터링 목록
 *   GET /api/v1/scenarios/{scenarioId}                      모니터링 조회
 *   GET /api/v1/scenarios/{scenarioId}/results              결과 조회 (?from&to&type[&resultStatus&locationTypeCodes])
 *   GET /api/v1/scenarios/{scenarioId}/results/{resultId}   상세 결과 조회 (?type)
 *   PUT /api/v1/scenarios/{scenarioId}/settings             상태 변경 { serviceYn }
 * 최초 구현은 ncloud-gov-mcp-server v0.1.0(공공존 가이드 기반)에서 가져왔다.
 */
const AGGREGATION_TYPES = ["RAW", "MIN5", "MIN30", "HOUR2", "DAY1"] as const;

export function registerWmsTools(server: McpServer, client: NcloudClient): void {
  // ─── Monitoring (Scenario) Query ───────────────────────────────────────────

  defineTool(
    server,
    "ncloud_wms_list_monitors",
    "List all Web service Monitoring System (WMS) scenarios: name, monitoringType (URL | SCENARIO), interval, serviceYn (active/paused), url, scenarioId",
    {},
    async () => client.requestRaw("GET", "/api/v1/scenarios")
  );

  defineTool(
    server,
    "ncloud_wms_get_monitor",
    "Get the configuration of one WMS monitoring scenario",
    {
      scenarioId: z.number().int({ message: "scenarioId must be an integer" }).describe("Scenario ID (from ncloud_wms_list_monitors)"),
    },
    async (params) => client.requestRaw("GET", `/api/v1/scenarios/${params.scenarioId}`)
  );

  // ─── Monitoring Results ────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_wms_get_results",
    "Get the results of a WMS scenario over a time window: average load time, success/error counts and availability, per monitoring location",
    {
      scenarioId: z.number().int().describe("Scenario ID"),
      from: z.number({ required_error: requiredError("from") }).int().describe("Window start as a Unix timestamp"),
      to: z.number({ required_error: requiredError("to") }).int().describe("Window end as a Unix timestamp"),
      type: z.enum(AGGREGATION_TYPES, { required_error: requiredError("type") }).describe("Aggregation: RAW | MIN5 | MIN30 | HOUR2 | DAY1"),
      resultStatus: z.enum(["SUCCESS", "ERROR"]).optional().describe("Filter by result status"),
      locationTypeCodes: z.string().optional().describe("Monitoring agent locations, comma-separated: KR, USW, JP, SG, DE"),
    },
    async (params) => {
      const query: Record<string, string> = { from: String(params.from), to: String(params.to), type: params.type };
      if (params.resultStatus !== undefined) query.resultStatus = params.resultStatus;
      if (params.locationTypeCodes !== undefined) query.locationTypeCodes = params.locationTypeCodes;
      return client.requestRaw("GET", `/api/v1/scenarios/${params.scenarioId}/results`, query);
    }
  );

  defineTool(
    server,
    "ncloud_wms_get_result_detail",
    "Get one WMS monitoring result in detail (load time, transactions/steps, error logs)",
    {
      scenarioId: z.number().int().describe("Scenario ID"),
      resultId: z.number().int().describe("Monitoring result ID (from ncloud_wms_get_results)"),
      type: z.enum(AGGREGATION_TYPES, { required_error: requiredError("type") }).describe("Aggregation: RAW | MIN5 | MIN30 | HOUR2 | DAY1"),
    },
    async (params) => client.requestRaw("GET", `/api/v1/scenarios/${params.scenarioId}/results/${params.resultId}`, { type: params.type })
  );

  // ─── Monitoring Status Change ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_wms_set_status",
    "Start or pause a WMS monitoring scenario (PUT .../settings with serviceYn: true = start, false = pause)",
    {
      scenarioId: z.number().int().describe("Scenario ID"),
      serviceYn: z.boolean({ required_error: requiredError("serviceYn") }).describe("true = start monitoring, false = pause monitoring"),
    },
    async (params) => client.requestRaw("PUT", `/api/v1/scenarios/${params.scenarioId}/settings`, undefined, { serviceYn: params.serviceYn }),
    // 서버 로컬 설정 변경(시작/일시정지) — 파괴적이지 않다.
    { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } }
  );
}
