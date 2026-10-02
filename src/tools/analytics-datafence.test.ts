import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerDatafenceTools } from "./analytics-datafence.js";
import { registerDataBoxTools } from "./analytics-databox.js";

function harness(register: (s: McpServer, c: NcloudClient) => void, baseUrl: string) {
  const server = new McpServer({ name: "t", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl, regionCode: "KR" });
  register(server, client);
  const tools = (server as any)._registeredTools;
  const entry = (n: string) => (tools instanceof Map ? tools.get(n) : tools[n]);
  return {
    client,
    has: (n: string) => !!entry(n),
    call: (n: string, a: any) => entry(n).handler(entry(n).inputSchema.parse(a), {} as any),
  };
}

/** Datafence 37종 — 민간존 가이드(datafence-overview + 접두 없는 슬러그) 계약. */
describe("Datafence", () => {
  let t: ReturnType<typeof harness>;
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    t = harness(registerDatafenceTools, "https://datafence.apigw.ntruss.com");
    spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({ ok: true });
  });

  it("GET 조회는 쿼리 파라미터로, 선언한 값만 보낸다", async () => {
    await t.call("ncloud_datafence_get_datafence", {});
    await t.call("ncloud_datafence_list_boxes", { fenceId: 26, size: 20 });
    await t.call("ncloud_datafence_get_hadoop_cluster", { fenceId: 26, boxId: 74, hadoopClusterNo: 5 });
    await t.call("ncloud_datafence_list_file_exports", { fenceId: 26, boxId: 74, status: "REQUEST", from: "20260101000000" });
    await t.call("ncloud_datafence_get_file_export", { fenceId: 26, boxId: 74, fileId: 99 });
    await t.call("ncloud_datafence_list_export_approvals", { fenceId: 26, boxId: 74 });
    expect(spy.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      ["GET", "/api/v1/fence/get-datafence", undefined],
      ["GET", "/api/v1/box/get-box-list", { fenceId: 26, size: 20 }],
      ["GET", "/api/v1/box/get-hadoop-cluster-info", { fenceId: 26, boxId: 74, hadoopClusterNo: 5 }],
      ["GET", "/api/v1/export/get-export-list", { fenceId: 26, boxId: 74, status: "REQUEST", from: "20260101000000" }],
      ["GET", "/api/v1/export/get-export-detail", { fenceId: 26, boxId: 74, fileId: 99 }],
      ["GET", "/api/v1/export-approval/get-export-file-approve-list", { fenceId: 26, boxId: 74 }],
    ]);
  });

  it("POST 바디: change-datafence-infra 는 updateFence 로, create-box 는 createBoxInfo 로 감싼다", async () => {
    await t.call("ncloud_datafence_change_fence_infra", {
      fenceId: 1,
      fenceNasList: [{ actionType: "CREATE", nasSize: 500, count: 2 }],
    });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v1/fence/change-datafence-infra", undefined, {
      fenceId: 1,
      updateFence: { fenceNasList: [{ actionType: "CREATE", nasSize: 500, count: 2 }] },
    });
    await t.call("ncloud_datafence_create_box", {
      fenceId: 26,
      connectServerList: [{ specCode: "SVR.CON", storageSize: 300, userPassword1: "Password1000#", userPassword2: "Password1000#" }],
      linuxServerList: [{ specCode: "SVR.LNX", softwareCode: "SW.UBNTU", storageSize: 500, userPassword: "Password1000#" }],
      nasList: [{ nasSize: 500, count: 1 }],
    });
    const last = spy.mock.calls.at(-1)!;
    expect(last[0]).toBe("POST");
    expect(last[1]).toBe("/api/v1/box/create-box");
    expect((last[3] as any).createBoxInfo.linuxServerList[0].softwareCode).toBe("SW.UBNTU");
    expect((last[3] as any).createBoxInfo).not.toHaveProperty("windowsServerList");
  });

  it("create-box: Linux·Windows 서버가 모두 없으면 호출 없이 isError", async () => {
    const r = await t.call("ncloud_datafence_create_box", {
      fenceId: 26,
      connectServerList: [{ specCode: "SVR.CON", storageSize: 300 }],
      linuxServerList: [],
      nasList: [],
    });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("change-box-infra: boxId 는 updateBoxInfo 안으로, dryRun 은 호출하지 않는다", async () => {
    const r = await t.call("ncloud_datafence_change_box_infra", {
      fenceId: 26, boxId: 74, boxNasList: [{ actionType: "DELETE", nasInstanceNo: "100" }], dryRun: true,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(r.content[0].text).toContain("change-box-infra");
    await t.call("ncloud_datafence_change_box_infra", { fenceId: 26, boxId: 74, boxNasList: [{ actionType: "DELETE", nasInstanceNo: "100" }] });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v1/box/change-box-infra", undefined, {
      fenceId: 26, updateBoxInfo: { boxId: 74, boxNasList: [{ actionType: "DELETE", nasInstanceNo: "100" }] },
    });
  });

  it("승인은 PATCH + 바디, 취소는 DELETE + 쿼리", async () => {
    await t.call("ncloud_datafence_approve_file_export", { fenceId: 26, boxId: 74, fileId: 99 });
    expect(spy).toHaveBeenLastCalledWith("PATCH", "/api/v1/export-approval/export-file-approve", undefined, { fenceId: 26, boxId: 74, fileId: 99 });
    await t.call("ncloud_datafence_cancel_file_export", { fenceId: 26, boxId: 74, fileId: 99, confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", "/api/v1/export/cancel-file-export", { fenceId: 26, boxId: 74, fileId: 99 });
  });

  it("confirm 게이트: return-box / reject 는 confirm 없이는 호출하지 않는다", async () => {
    const r1 = await t.call("ncloud_datafence_return_box", { fenceId: 26, boxId: 74 });
    expect(r1.content[0].text).toContain("⚠️");
    const r2 = await t.call("ncloud_datafence_reject_file_export", { fenceId: 26, boxId: 74, fileId: 99, rejectReason: "no" });
    expect(r2.content[0].text).toContain("⚠️");
    expect(spy).not.toHaveBeenCalled();
    await t.call("ncloud_datafence_return_box", { fenceId: 26, boxId: 74, confirm: true });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v1/box/return-box", undefined, { fenceId: 26, boxId: 74 });
    await t.call("ncloud_datafence_reject_file_export", { fenceId: 26, boxId: 74, fileId: 99, rejectReason: "no", confirm: true });
    expect(spy).toHaveBeenLastCalledWith("PATCH", "/api/v1/export-approval/export-file-reject", undefined, { fenceId: 26, boxId: 74, fileId: 99, rejectReason: "no" });
  });

  it("37개 도구가 등록된다", () => {
    const names = [
      "get_datafence", "list_fence_infra", "get_fence_infra_history", "get_fence_custom_images", "change_fence_infra", "change_fence_nas_volume", "list_buckets", "get_product_specs",
      "list_boxes", "get_box_summary", "list_box_infra", "get_box_infra_history", "get_box_history", "get_box_custom_images", "get_connect_server", "get_linux_server", "get_windows_server", "get_tensorflow_server", "get_hadoop_cluster", "create_box", "change_box_infra", "change_box_nas_volume", "set_box_external_network_block", "return_box",
      "list_import_target_nas", "create_file_import", "list_file_imports", "get_file_import",
      "list_export_source_nas", "create_file_export", "list_file_exports", "get_file_export", "cancel_file_export",
      "list_export_approvals", "get_export_approval", "approve_file_export", "reject_file_export",
    ];
    expect(names.length).toBe(37);
    for (const n of names) expect(t.has(`ncloud_datafence_${n}`), n).toBe(true);
  });
});

/** Cloud Data Box 8종 — data-box-overview 계약. */
describe("Cloud Data Box", () => {
  let t: ReturnType<typeof harness>;
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    t = harness(registerDataBoxTools, "https://databox.apigw.ntruss.com");
    spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({ ok: true });
  });

  it("GET 조회 경로와 쿼리", async () => {
    await t.call("ncloud_databox_list_buckets", {});
    await t.call("ncloud_databox_list_nas", { dataBoxNo: 7 });
    await t.call("ncloud_databox_list_import_requests", { dataBoxNo: 7, applyStartDate: "20250304080000", pageNo: 1 });
    await t.call("ncloud_databox_get_export_request", { dataBoxNo: 7, exportNo: 3 });
    expect(spy.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      ["GET", "/api/v1/storage/get-bucket-list", undefined],
      ["GET", "/api/v1/storage/get-nas-list", { dataBoxNo: 7 }],
      ["GET", "/api/v1/import/get-import-apply-list", { dataBoxNo: 7, applyStartDate: "20250304080000", pageNo: 1 }],
      ["GET", "/api/v1/export/get-export-apply-detail", { dataBoxNo: 7, exportNo: 3 }],
    ]);
  });

  it("반입/반출 신청은 POST 바디; 반출은 표의 경로(apply-file-export)를 쓴다", async () => {
    await t.call("ncloud_databox_apply_file_import", { dataBoxNo: 7, bucketName: "b", fileList: [{ name: "a.csv" }], nasInstanceNo: 11 });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v1/import/apply-file-import", undefined, { dataBoxNo: 7, bucketName: "b", fileList: [{ name: "a.csv" }], nasInstanceNo: 11 });
    await t.call("ncloud_databox_apply_file_export", {
      dataBoxNo: 7, nasInstanceNo: 11, bucketName: "b",
      fileList: [{ name: "out.csv", description: "x".repeat(30), type: "TABLE", tableDetail: "COMMA" }],
    });
    expect(spy.mock.calls.at(-1)![1]).toBe("/api/v1/export/apply-file-export");
  });

  it("반출: CUSTOM 구분자·MODEL 버전 누락은 호출 전 거부", async () => {
    const r = await t.call("ncloud_databox_apply_file_export", {
      dataBoxNo: 7, nasInstanceNo: 11, bucketName: "b",
      fileList: [{ name: "m.pt", description: "x".repeat(30), type: "MODEL", modelDetail: "PYTORCH" }],
    });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
