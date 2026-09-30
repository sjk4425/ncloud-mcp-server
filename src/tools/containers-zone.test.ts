import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerContainersNksTools } from "./containers-nks.js";
import { registerContainersRegistryTools } from "./containers-registry.js";
import { nksPathPrefix, ncrPathPrefix } from "../client/endpoints.js";

/**
 * containers 그룹 존 통합 — 2026-09-30 두 존 공식 가이드 원문 대조 결과에 대한 계약 테스트.
 *   NKS: nks-getclusterlist / nks-addsubnet / nks-updatenodepoolsubnet / nks-lbsubnet / nks-patchipacl /
 *        nks-createaccessentry / nks-updateaccessentry / nks-getaccessentry / nks-viewnodepool / nks-updatekubeconfig(민간존만)
 *   NCR: containerregistry-getregistry / getimages / getimagedetail / patchimage / deleteregistry / deleteimage /
 *        getimagetags / getimagetagdetail / deleteimagetag / postregistry
 */

function client(regionCode = "KR", baseUrl = "https://nks.apigw.ntruss.com"): NcloudClient {
  return new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl, regionCode });
}
function handler(server: McpServer, name: string): any {
  const tools = (server as any)._registeredTools;
  const entry = tools instanceof Map ? tools.get(name) : tools[name];
  if (!entry) throw new Error(`Tool ${name} not found`);
  return (args: any) => entry.handler(entry.inputSchema.parse(args), {} as any);
}
function has(server: McpServer, name: string): boolean {
  const tools = (server as any)._registeredTools;
  return tools instanceof Map ? tools.has(name) : name in tools;
}

describe("endpoints: NKS / NCR 리전별 경로 접두", () => {
  it("NKS: 민간존 KR/SGN/JPN, 공공존 KR/KRS, 미지의 리전은 /vnks/v2", () => {
    expect(nksPathPrefix("public", "KR")).toBe("/vnks/v2");
    expect(nksPathPrefix("public", "SGN")).toBe("/vnks/sgn-v2");
    expect(nksPathPrefix("public", "JPN")).toBe("/vnks/jpn-v2");
    expect(nksPathPrefix("gov", "KR")).toBe("/vnks/v2");
    expect(nksPathPrefix("gov", "KRS")).toBe("/vnks/krs-v2");
    expect(nksPathPrefix("gov", "SGN")).toBe("/vnks/v2");
  });
  it("NCR: 민간존 /ncr/api|sgn-api|jpn-api/v2, 공공존 /ncr/kr|krs/v2", () => {
    expect(ncrPathPrefix("public", "KR")).toBe("/ncr/api/v2");
    expect(ncrPathPrefix("public", "SGN")).toBe("/ncr/sgn-api/v2");
    expect(ncrPathPrefix("public", "JPN")).toBe("/ncr/jpn-api/v2");
    expect(ncrPathPrefix("gov", "KR")).toBe("/ncr/kr/v2");
    expect(ncrPathPrefix("gov", "KRS")).toBe("/ncr/krs/v2");
  });
});

describe("NKS: 두 존 공통 스펙으로 정정한 오퍼레이션 (민간존 KR)", () => {
  let server: McpServer;
  let c: NcloudClient;
  beforeEach(() => {
    server = new McpServer({ name: "t", version: "1.0.0" });
    c = client();
    registerContainersNksTools(server, c);
  });

  it("add_subnet: PATCH .../add-subnet + { subnets: [{ number }] }", async () => {
    const spy = vi.spyOn(c, "requestRaw").mockResolvedValue({ uuid: "u" });
    await handler(server, "ncloud_nks_add_subnet")({ clusterUuid: "u", subnetNoList: [1, 2] });
    expect(spy).toHaveBeenCalledWith("PATCH", "/vnks/v2/clusters/u/add-subnet", undefined, { subnets: [{ number: 1 }, { number: 2 }] });
  });
  it("update_node_pool_subnet: PATCH .../node-pool/{no}/subnets + { subnets: [number] }", async () => {
    const spy = vi.spyOn(c, "requestRaw").mockResolvedValue({});
    await handler(server, "ncloud_nks_update_node_pool_subnet")({ clusterUuid: "u", instanceNo: 7, subnetNoList: [3] });
    expect(spy).toHaveBeenCalledWith("PATCH", "/vnks/v2/clusters/u/node-pool/7/subnets", undefined, { subnets: [3] });
  });
  it("update_lb_subnet: 쿼리 파라미터만(lbSubnetNo/igwYn), 본문 없음; 둘 다 없으면 거절", async () => {
    const spy = vi.spyOn(c, "requestRaw").mockResolvedValue({});
    const h = handler(server, "ncloud_nks_update_lb_subnet");
    await h({ clusterUuid: "u", lbSubnetNo: 140000, igwYn: "Y" });
    expect(spy).toHaveBeenCalledWith("PATCH", "/vnks/v2/clusters/u/lb-subnet", { lbSubnetNo: "140000", igwYn: "Y" });
    spy.mockClear();
    const res = await h({ clusterUuid: "u" });
    expect(res.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
  it("set_ip_acl: defaultAction 필수 + entries[].comment", async () => {
    const spy = vi.spyOn(c, "requestRaw").mockResolvedValue({});
    await handler(server, "ncloud_nks_set_ip_acl")({ clusterUuid: "u", defaultAction: "deny", entries: [{ action: "allow", address: "10.0.0.0/8", comment: "office" }] });
    expect(spy).toHaveBeenCalledWith("PATCH", "/vnks/v2/clusters/u/ip-acl", undefined, { defaultAction: "deny", entries: [{ action: "allow", address: "10.0.0.0/8", comment: "office" }] });
    expect(() => handler(server, "ncloud_nks_set_ip_acl")({ clusterUuid: "u", entries: [] })).toThrow(); // defaultAction 누락은 스키마에서 거절
  });
  it("access entries: /access-entries, entryUuid, POST {type, entry, groups, policies}, PUT 수정", async () => {
    const spy = vi.spyOn(c, "requestRaw").mockResolvedValue({});
    await handler(server, "ncloud_nks_list_access_entries")({ clusterUuid: "u" });
    await handler(server, "ncloud_nks_get_access_entry")({ clusterUuid: "u", entryUuid: "e1" });
    await handler(server, "ncloud_nks_create_access_entry")({ clusterUuid: "u", type: "USER", entry: "nrn:PUB:IAM::1:User/x", policies: [{ type: "NKSViewPolicy", scope: "cluster" }] });
    await handler(server, "ncloud_nks_update_access_entry")({ clusterUuid: "u", entryUuid: "e1", groups: ["dev"] });
    await handler(server, "ncloud_nks_delete_access_entry")({ clusterUuid: "u", entryUuid: "e1", confirm: true });
    expect(spy.mock.calls.map((x) => [x[0], x[1], x[3]])).toEqual([
      ["GET", "/vnks/v2/clusters/u/access-entries", undefined],
      ["GET", "/vnks/v2/clusters/u/access-entries/e1", undefined],
      ["POST", "/vnks/v2/clusters/u/access-entries", { type: "USER", entry: "nrn:PUB:IAM::1:User/x", policies: [{ type: "NKSViewPolicy", scope: "cluster" }] }],
      ["PUT", "/vnks/v2/clusters/u/access-entries/e1", { groups: ["dev"] }],
      ["DELETE", "/vnks/v2/clusters/u/access-entries/e1", undefined],
    ]);
  });
  it("create_access_entry: scope=namespace 인데 namespaces 가 없으면 API 호출 없이 거절", async () => {
    const spy = vi.spyOn(c, "requestRaw");
    const res = await handler(server, "ncloud_nks_create_access_entry")({ clusterUuid: "u", type: "ROLE", entry: "nrn", policies: [{ type: "NKSEditPolicy", scope: "namespace" }] });
    expect(res.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
  it("list_node_pools: hypervisorCode 쿼리", async () => {
    const spy = vi.spyOn(c, "requestRaw").mockResolvedValue({});
    await handler(server, "ncloud_nks_list_node_pools")({ clusterUuid: "u", hypervisorCode: "KVM" });
    expect(spy).toHaveBeenCalledWith("GET", "/vnks/v2/clusters/u/node-pool", { hypervisorCode: "KVM" });
  });
  it("create_cluster: 새 파라미터(authType/addons/nodePool.subnetNoList 등)가 본문에 그대로 실린다", async () => {
    const spy = vi.spyOn(c, "requestRaw").mockResolvedValue({ uuid: "new" });
    await handler(server, "ncloud_nks_create_cluster")({
      name: "c1", clusterType: "SVR.VNKS.STAND.C002.M008.G002", loginKeyName: "k", regionCode: "KR", vpcNo: 1, subnetNoList: [2], lbPublicSubnetNo: 3,
      zoneCode: "KR-1", authType: "API", bootstrapAccessEntry: true, kmsKeyTag: "tag",
      addons: [{ addonName: "istio", version: "1.0" }],
      nodePool: [{ name: "np", nodeCount: 1, subnetNoList: [2], fabricCluster: { poolNo: 9 } }],
    });
    const body = spy.mock.calls[0][3] as any;
    expect(spy.mock.calls[0][1]).toBe("/vnks/v2/clusters");
    expect(body.authType).toBe("API");
    expect(body.addons).toEqual([{ addonName: "istio", version: "1.0" }]);
    expect(body.nodePool[0].fabricCluster).toEqual({ poolNo: 9 });
    expect(body.dryRun).toBeUndefined();
  });
  it("create_cluster: lbPublicSubnetNo 도 lbPublicSubnetNoList 도 없으면 거절", async () => {
    const res = await handler(server, "ncloud_nks_create_cluster")({ name: "c1", clusterType: "x", loginKeyName: "k", regionCode: "KR", vpcNo: 1, subnetNoList: [2], zoneCode: "KR-1" });
    expect(res.isError).toBe(true);
  });
});

describe("NKS: 존·리전별 경로 접두와 공공존 도구 집합", () => {
  it("민간존 SGN 은 /vnks/sgn-v2, 리전 변경 후 호출 시점에 반영된다", async () => {
    const server = new McpServer({ name: "t", version: "1.0.0" });
    const c = client("SGN");
    registerContainersNksTools(server, c);
    const spy = vi.spyOn(c, "requestRaw").mockResolvedValue({});
    await handler(server, "ncloud_nks_list_clusters")({});
    expect(spy).toHaveBeenCalledWith("GET", "/vnks/sgn-v2/clusters");
    c.setRegionCode("JPN");
    await handler(server, "ncloud_nks_get_versions")({});
    expect(spy.mock.calls[1][1]).toBe("/vnks/jpn-v2/option/version");
  });
  it("공공존 KRS 는 /vnks/krs-v2, reset_kubeconfig 는 등록되지 않는다", async () => {
    const server = new McpServer({ name: "t", version: "1.0.0" });
    const c = client("KRS", "https://nks.apigw.gov-ntruss.com");
    registerContainersNksTools(server, c, { zone: "gov", resetKubeconfig: false });
    const spy = vi.spyOn(c, "requestRaw").mockResolvedValue({});
    await handler(server, "ncloud_nks_get_kubeconfig")({ clusterUuid: "u" });
    expect(spy).toHaveBeenCalledWith("GET", "/vnks/krs-v2/clusters/u/kubeconfig");
    expect(has(server, "ncloud_nks_reset_kubeconfig")).toBe(false);
    expect(has(server, "ncloud_nks_list_access_entries")).toBe(true);
  });
});

describe("NCR: 공식 가이드 경로·메서드·쿼리 (containerregistry-*)", () => {
  let server: McpServer;
  let c: NcloudClient;
  beforeEach(() => {
    server = new McpServer({ name: "t", version: "1.0.0" });
    c = client("KR", "https://ncr.apigw.ntruss.com");
    registerContainersRegistryTools(server, c);
  });

  it("목록 조회는 page/pagesize 쿼리, 이미지 목록은 /repositories/{registry}", async () => {
    const spy = vi.spyOn(c, "requestRaw").mockResolvedValue({});
    await handler(server, "ncloud_ncr_list_registries")({ pageNo: 2, pageSize: 50 });
    await handler(server, "ncloud_ncr_list_images")({ registryName: "reg" });
    await handler(server, "ncloud_ncr_list_tags")({ registryName: "reg", imageName: "hello/world", pageNo: 1 });
    expect(spy.mock.calls.map((x) => [x[0], x[1], x[2]])).toEqual([
      ["GET", "/ncr/api/v2/repositories", { page: "2", pagesize: "50" }],
      ["GET", "/ncr/api/v2/repositories/reg", undefined],
      ["GET", "/ncr/api/v2/repositories/reg/hello%2Fworld/tags", { page: "1" }],
    ]);
  });
  it("상세·수정·삭제: 이미지는 /{registry}/{imageName}(URI 인코딩), 삭제는 DELETE, 수정은 PATCH {description, full_description}", async () => {
    const spy = vi.spyOn(c, "requestRaw").mockResolvedValue(undefined);
    await handler(server, "ncloud_ncr_get_image")({ registryName: "reg", imageName: "hello/world" });
    await handler(server, "ncloud_ncr_update_image")({ registryName: "reg", imageName: "img", description: "d", full_description: "# md" });
    await handler(server, "ncloud_ncr_delete_image")({ registryName: "reg", imageName: "img", confirm: true });
    await handler(server, "ncloud_ncr_get_tag_detail")({ registryName: "reg", imageName: "img", tagName: "v1" });
    await handler(server, "ncloud_ncr_delete_tag")({ registryName: "reg", imageName: "img", tag: "v1", confirm: true });
    await handler(server, "ncloud_ncr_delete_registry")({ registryName: "reg", confirm: true });
    expect(spy.mock.calls.map((x) => [x[0], x[1], x[3]])).toEqual([
      ["GET", "/ncr/api/v2/repositories/reg/hello%2Fworld", undefined],
      ["PATCH", "/ncr/api/v2/repositories/reg/img", { description: "d", full_description: "# md" }],
      ["DELETE", "/ncr/api/v2/repositories/reg/img", undefined],
      ["GET", "/ncr/api/v2/repositories/reg/img/tags/v1", undefined],
      ["DELETE", "/ncr/api/v2/repositories/reg/img/tags/v1", undefined],
      ["DELETE", "/ncr/api/v2/repositories/reg", undefined],
    ]);
  });
  it("confirm 없는 삭제는 호출하지 않는다", async () => {
    const spy = vi.spyOn(c, "requestRaw");
    await handler(server, "ncloud_ncr_delete_registry")({ registryName: "reg" });
    await handler(server, "ncloud_ncr_delete_image")({ registryName: "reg", imageName: "i" });
    expect(spy).not.toHaveBeenCalled();
  });
  it("공공존 KRS: /ncr/krs/v2 접두", async () => {
    const s2 = new McpServer({ name: "t", version: "1.0.0" });
    const gc = client("KRS", "https://gov-ncr.apigw.gov-ntruss.com");
    registerContainersRegistryTools(s2, gc, { zone: "gov" });
    const spy = vi.spyOn(gc, "requestRaw").mockResolvedValue({});
    await handler(s2, "ncloud_ncr_list_registries")({});
    expect(spy).toHaveBeenCalledWith("GET", "/ncr/krs/v2/repositories", undefined);
  });
});
