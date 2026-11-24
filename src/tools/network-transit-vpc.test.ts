import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerVpcTools } from "./network-vpc.js";
import { registerTransitVpcTools } from "./network-transit-vpc.js";
import { registerEndpointRouteTableTools } from "./network-endpoint-route-table.js";

/**
 * 2026-11-24 민간존 VPC 릴리스 — createVpc vpcTypeCode, Subnet SFC, Transit VPC Connect / Service Function Chain /
 * Endpoint Route Table. 가이드(networking-vpc-*)의 파라미터명·리스트 형식(`x.N.y`)·조건부 규칙을 mock 으로 검사한다.
 */
function setup(opts: { transitVpc?: boolean } = { transitVpc: true }) {
  const client = new NcloudClient({ accessKey: "a", secretKey: "s", regionCode: "KR" });
  const spy = vi.spyOn(client, "request").mockResolvedValue({ ok: true } as any);
  const server = new McpServer({ name: "t", version: "1" });
  registerVpcTools(server, client, opts);
  if (opts.transitVpc) {
    registerTransitVpcTools(server, client);
    registerEndpointRouteTableTools(server, client);
  }
  const tools = (server as any)._registeredTools;
  const tool = (name: string) => {
    const entry = tools instanceof Map ? tools.get(name) : tools[name];
    if (!entry) throw new Error(`Tool ${name} not found`);
    return {
      entry,
      safeParse: (args: any) => entry.inputSchema.safeParse(args),
      call: (args: any) => entry.handler(entry.inputSchema.parse(args), {} as any),
    };
  };
  return { spy, tool, tools };
}

const text = (r: any) => r.content.map((c: any) => c.text).join("\n");

describe("createVpc vpcTypeCode / createSubnet SFC", () => {
  it("민간존: vpcTypeCode=TRANSIT 를 그대로 전달", async () => {
    const { spy, tool } = setup();
    await tool("ncloud_create_vpc").call({ ipv4CidrBlock: "10.0.0.0/16", vpcTypeCode: "TRANSIT" });
    expect(spy).toHaveBeenCalledWith("/vpc/v2/createVpc", { ipv4CidrBlock: "10.0.0.0/16", vpcTypeCode: "TRANSIT" });
    expect(tool("ncloud_create_vpc").safeParse({ ipv4CidrBlock: "10.0.0.0/16", vpcTypeCode: "HUB" }).success).toBe(false);
  });

  it("공공·금융존(transitVpc=false): 스키마에 vpcTypeCode 가 없다", () => {
    const { tool } = setup({ transitVpc: false });
    expect(Object.keys(tool("ncloud_create_vpc").entry.inputSchema.shape)).not.toContain("vpcTypeCode");
    expect(tool("ncloud_create_subnet").entry.inputSchema.shape.usageTypeCode.description).not.toContain("SFC");
    expect(setup().tool("ncloud_create_subnet").entry.inputSchema.shape.usageTypeCode.description).toContain("SFC");
  });

  it("SFC 는 PUBLIC 서브넷에서만 허용", async () => {
    const { spy, tool } = setup();
    const base = { vpcNo: "1", subnet: "10.0.1.0/24", zoneCode: "KR-1", networkAclNo: "2", usageTypeCode: "SFC" };
    const r = await tool("ncloud_create_subnet").call({ ...base, subnetTypeCode: "PRIVATE" });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    await tool("ncloud_create_subnet").call({ ...base, subnetTypeCode: "PUBLIC" });
    expect(spy).toHaveBeenCalledWith("/vpc/v2/createSubnet", expect.objectContaining({ usageTypeCode: "SFC", subnetTypeCode: "PUBLIC" }));
  });
});

describe("Transit VPC Connect", () => {
  it("create: 다른 계정 Transit VPC 는 loginId·name 을 함께", async () => {
    const { spy, tool } = setup();
    const r = await tool("ncloud_create_transit_vpc_connect").call({ transitVpcNo: "1", normalVpcNo: "2", transitVpcName: "hub" });
    expect(r.isError).toBe(true);
    await tool("ncloud_create_transit_vpc_connect").call({
      transitVpcNo: "1", normalVpcNo: "2", transitVpcName: "hub", transitVpcLoginId: "owner@example.com", transitVpcConnectName: "conn-1",
    });
    expect(spy).toHaveBeenCalledWith("/vpc/v2/createTransitVpcConnectInstance", {
      transitVpcNo: "1", normalVpcNo: "2", transitVpcName: "hub", transitVpcLoginId: "owner@example.com", transitVpcConnectName: "conn-1",
    });
  });

  it("이름 규칙: 소문자 시작 3~30자", () => {
    const { tool } = setup();
    const t = tool("ncloud_create_transit_vpc_connect");
    expect(t.safeParse({ transitVpcNo: "1", normalVpcNo: "2", transitVpcConnectName: "1abc" }).success).toBe(false);
    expect(t.safeParse({ transitVpcNo: "1", normalVpcNo: "2", transitVpcConnectName: "Abc" }).success).toBe(false);
    expect(t.safeParse({ transitVpcNo: "1", normalVpcNo: "2", transitVpcConnectName: "abc-" }).success).toBe(false);
  });

  it("설명은 1,000 바이트(UTF-8) 상한", () => {
    const { tool } = setup();
    const t = tool("ncloud_set_transit_vpc_connect_description");
    expect(t.safeParse({ transitVpcConnectInstanceNo: "1", transitVpcConnectDescription: "가".repeat(334) }).success).toBe(false);
    expect(t.safeParse({ transitVpcConnectInstanceNo: "1", transitVpcConnectDescription: "가".repeat(333) }).success).toBe(true);
  });

  it("list: pageNo 만 주면 거부", async () => {
    const { spy, tool } = setup();
    const r = await tool("ncloud_list_transit_vpc_connects").call({ pageNo: 1 });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("delete: confirm 게이트", async () => {
    const { spy, tool } = setup();
    const r = await tool("ncloud_delete_transit_vpc_connect").call({ transitVpcConnectInstanceNo: "9" });
    expect(text(r)).toContain("confirm=true");
    expect(spy).not.toHaveBeenCalled();
    await tool("ncloud_delete_transit_vpc_connect").call({ transitVpcConnectInstanceNo: "9", confirm: true });
    expect(spy).toHaveBeenCalledWith("/vpc/v2/deleteTransitVpcConnectInstance", { transitVpcConnectInstanceNo: "9" });
  });
});

describe("Service Function Chain", () => {
  const chain = [
    { targetTypeCode: "SVR", targetNo: "100", ingressNetworkInterfaceNo: "200" },
    { targetTypeCode: "LB", targetNo: "300" },
    { targetTypeCode: "TRANSITVPCCONNECT", targetNo: "400" },
  ];

  it("create: chainList.N.* / destinationCidrBlockList.N 로 펼친다", async () => {
    const { spy, tool } = setup();
    await tool("ncloud_create_service_function_chain").call({
      zoneCode: "KR-1", vpcNo: "1", chainList: chain, destinationCidrBlockList: ["10.0.0.0/16", "192.168.0.0/24"],
    });
    expect(spy).toHaveBeenCalledWith("/vpc/v2/createServiceFunctionChain", {
      zoneCode: "KR-1",
      vpcNo: "1",
      "chainList.1.targetTypeCode": "SVR",
      "chainList.1.targetNo": "100",
      "chainList.1.ingressNetworkInterfaceNo": "200",
      "chainList.2.targetTypeCode": "LB",
      "chainList.2.targetNo": "300",
      "chainList.3.targetTypeCode": "TRANSITVPCCONNECT",
      "chainList.3.targetNo": "400",
      "destinationCidrBlockList.1": "10.0.0.0/16",
      "destinationCidrBlockList.2": "192.168.0.0/24",
    });
  });

  it("IGW 마지막 홉은 targetNo 없이", async () => {
    const { spy, tool } = setup();
    await tool("ncloud_create_service_function_chain").call({
      zoneCode: "KR-1", vpcNo: "1", chainList: [{ targetTypeCode: "LB", targetNo: "3" }, { targetTypeCode: "IGW" }],
    });
    const sent = spy.mock.calls[0][1] as Record<string, string>;
    expect(sent["chainList.2.targetTypeCode"]).toBe("IGW");
    expect(sent).not.toHaveProperty("chainList.2.targetNo");
  });

  it.each([
    ["마지막 홉이 SVR/LB", [{ targetTypeCode: "LB", targetNo: "1" }]],
    ["중간 홉이 SVR/LB 아님", [{ targetTypeCode: "NATGW", targetNo: "1" }, { targetTypeCode: "IGW" }]],
    ["IGW 에 targetNo", [{ targetTypeCode: "IGW", targetNo: "1" }]],
    ["VGW 에 targetNo 없음", [{ targetTypeCode: "VGW" }]],
    ["SVR 에 ingressNetworkInterfaceNo 없음", [{ targetTypeCode: "SVR", targetNo: "1" }, { targetTypeCode: "IGW" }]],
  ])("chainList 규칙 위반 거부: %s", async (_label, bad) => {
    const { spy, tool } = setup();
    const r = await tool("ncloud_create_service_function_chain").call({ zoneCode: "KR-1", vpcNo: "1", chainList: bad });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("chainList 는 최대 5개", () => {
    const { tool } = setup();
    const six = [...Array(5).fill({ targetTypeCode: "LB", targetNo: "1" }), { targetTypeCode: "IGW" }];
    expect(tool("ncloud_create_service_function_chain").safeParse({ zoneCode: "KR-1", vpcNo: "1", chainList: six }).success).toBe(false);
  });

  it("change: 둘 다 없으면 거부, CIDR 만 주면 CIDR 만 전송", async () => {
    const { spy, tool } = setup();
    const r = await tool("ncloud_change_service_function_chain_configuration").call({ serviceFunctionChainNo: "5" });
    expect(r.isError).toBe(true);
    await tool("ncloud_change_service_function_chain_configuration").call({ serviceFunctionChainNo: "5", destinationCidrBlockList: ["10.1.0.0/16"] });
    expect(spy).toHaveBeenCalledWith("/vpc/v2/changeServiceFunctionChainConfiguration", {
      serviceFunctionChainNo: "5",
      "destinationCidrBlockList.1": "10.1.0.0/16",
    });
  });
});

describe("Endpoint Route Table", () => {
  it("create: 유형 enum 검증", async () => {
    const { spy, tool } = setup();
    expect(tool("ncloud_create_endpoint_route_table").safeParse({ vpcNo: "1", endpointRouteTableTypeCode: "SFC" }).success).toBe(false);
    await tool("ncloud_create_endpoint_route_table").call({ vpcNo: "1", endpointRouteTableTypeCode: "VGW", endpointRouteTableName: "ert-vgw" });
    expect(spy).toHaveBeenCalledWith("/vpc/v2/createEndpointRouteTable", { vpcNo: "1", endpointRouteTableTypeCode: "VGW", endpointRouteTableName: "ert-vgw" });
  });

  it("add routes: routeList.N.* — IGW 는 targetNo 생략, SFC 대상 허용", async () => {
    const { spy, tool } = setup();
    await tool("ncloud_add_endpoint_route_table_routes").call({
      endpointRouteTableNo: "7",
      routeList: [
        { destinationCidrBlock: "0.0.0.0/0", targetTypeCode: "IGW" },
        { destinationCidrBlock: "10.0.0.0/16", targetTypeCode: "SFC", targetNo: "55" },
      ],
    });
    expect(spy).toHaveBeenCalledWith("/vpc/v2/addEndpointRouteTableRoute", {
      endpointRouteTableNo: "7",
      "routeList.1.destinationCidrBlock": "0.0.0.0/0",
      "routeList.1.targetTypeCode": "IGW",
      "routeList.2.destinationCidrBlock": "10.0.0.0/16",
      "routeList.2.targetTypeCode": "SFC",
      "routeList.2.targetNo": "55",
    });
  });

  it("add routes: NATGW 에 targetNo 없으면 거부", async () => {
    const { spy, tool } = setup();
    const r = await tool("ncloud_add_endpoint_route_table_routes").call({
      endpointRouteTableNo: "7", routeList: [{ destinationCidrBlock: "0.0.0.0/0", targetTypeCode: "NATGW" }],
    });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("associations: targetNoList.N", async () => {
    const { spy, tool } = setup();
    await tool("ncloud_add_endpoint_route_table_associations").call({ endpointRouteTableNo: "7", targetNoList: ["1", "2"] });
    expect(spy).toHaveBeenCalledWith("/vpc/v2/addEndpointRouteTableAssociation", {
      endpointRouteTableNo: "7", "targetNoList.1": "1", "targetNoList.2": "2",
    });
  });

  it("remove 계열은 confirm 게이트 후 propagationList.N.* 전송", async () => {
    const { spy, tool } = setup();
    const args = { endpointRouteTableNo: "7", propagationList: [{ targetTypeCode: "VGW", targetNo: "9" }] };
    const r = await tool("ncloud_remove_endpoint_route_table_propagations").call(args);
    expect(text(r)).toContain("confirm=true");
    expect(spy).not.toHaveBeenCalled();
    await tool("ncloud_remove_endpoint_route_table_propagations").call({ ...args, confirm: true });
    expect(spy).toHaveBeenCalledWith("/vpc/v2/removeEndpointRouteTablePropagation", {
      endpointRouteTableNo: "7", "propagationList.1.targetTypeCode": "VGW", "propagationList.1.targetNo": "9",
    });
  });

  it("파괴적 도구는 description 에 ⚠️ Destructive", () => {
    const { tools } = setup();
    const entries: [string, any][] = tools instanceof Map ? [...tools.entries()] : Object.entries(tools);
    for (const [name, e] of entries) {
      if (/^ncloud_(delete|remove)_/.test(name)) expect(e.description, name).toContain("⚠️ Destructive");
    }
  });
});
