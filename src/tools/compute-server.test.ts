import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerComputeServerTools } from "./compute-server.js";

// Helper to create a mock client
function createMockClient(): NcloudClient {
  const client = new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl: "https://ncloud.apigw.ntruss.com",
    regionCode: "KR",
  });
  return client;
}

// Helper to extract tool handler from McpServer
function getToolHandler(server: McpServer, toolName: string): any {
  // Access internal tool registry
  const tools = (server as any)._registeredTools;
  if (!tools) {
    throw new Error("No registered tools found on server");
  }
  // _registeredTools may be a Map or plain object
  const entry = tools instanceof Map ? tools.get(toolName) : tools[toolName];
  if (!entry) {
    throw new Error(`Tool ${toolName} not found`);
  }
  return entry.handler;
}

describe("Feature: ncloud-mcp-server, Property 9: 파괴적 작업 확인 게이트", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerComputeServerTools(server, client);
  });

  it("ncloud_terminate_server with confirm=false should NOT call API and should return confirmation prompt", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.stringMatching(/^[0-9]{4,10}$/), { minLength: 1, maxLength: 5 }),
        async (serverInstanceNoList) => {
          const requestSpy = vi.spyOn(client, "request");
          const handler = getToolHandler(server, "ncloud_terminate_server");
          const result = await handler({ serverInstanceNoList, confirm: false }, {} as any);

          // Should NOT call the API
          expect(requestSpy).not.toHaveBeenCalled();
          // Should return a confirmation prompt containing resource IDs
          const text = result.content[0].text;
          expect(text).toContain("⚠️");
          for (const id of serverInstanceNoList) {
            expect(text).toContain(id);
          }
          // Should NOT have isError
          expect(result.isError).toBeUndefined();
          requestSpy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("ncloud_delete_server_images with confirm=false should NOT call API and should return confirmation prompt", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.stringMatching(/^[0-9]{4,10}$/), { minLength: 1, maxLength: 5 }),
        async (serverImageInstanceNoList) => {
          const requestSpy = vi.spyOn(client, "request");
          const handler = getToolHandler(server, "ncloud_delete_server_images");
          const result = await handler({ serverImageInstanceNoList, confirm: false }, {} as any);

          expect(requestSpy).not.toHaveBeenCalled();
          const text = result.content[0].text;
          expect(text).toContain("⚠️");
          for (const id of serverImageInstanceNoList) {
            expect(text).toContain(id);
          }
          expect(result.isError).toBeUndefined();
          requestSpy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("ncloud_delete_member_server_images with confirm=false should NOT call API and should return confirmation prompt", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.stringMatching(/^[0-9]{4,10}$/), { minLength: 1, maxLength: 5 }),
        async (memberServerImageInstanceNoList) => {
          const requestSpy = vi.spyOn(client, "request");
          const handler = getToolHandler(server, "ncloud_delete_member_server_images");
          const result = await handler({ memberServerImageInstanceNoList, confirm: false }, {} as any);

          expect(requestSpy).not.toHaveBeenCalled();
          const text = result.content[0].text;
          expect(text).toContain("⚠️");
          for (const id of memberServerImageInstanceNoList) {
            expect(text).toContain(id);
          }
          expect(result.isError).toBeUndefined();
          requestSpy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe("Feature: ncloud-mcp-server, Property 10: Dry-Run API 호출 차단", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerComputeServerTools(server, client);
  });

  it("ncloud_create_server with dryRun=true should NOT call API and should return preview", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          serverImageProductCode: fc.stringMatching(/^[A-Z0-9_-]{5,30}$/),
          serverProductCode: fc.stringMatching(/^[A-Z0-9_-]{5,30}$/),
          vpcNo: fc.stringMatching(/^[0-9]{4,10}$/),
          subnetNo: fc.stringMatching(/^[0-9]{4,10}$/),
        }),
        async ({ serverImageProductCode, serverProductCode, vpcNo, subnetNo }) => {
          const requestSpy = vi.spyOn(client, "request");
          const handler = getToolHandler(server, "ncloud_create_server");
          const result = await handler({
            serverImageProductCode,
            serverProductCode,
            vpcNo,
            subnetNo,
            dryRun: true,
          }, {} as any);

          // Should NOT call the API
          expect(requestSpy).not.toHaveBeenCalled();
          // Should return a preview response
          const text = result.content[0].text;
          const parsed = JSON.parse(text);
          expect(parsed.label).toContain("Dry-Run");
          // 프리뷰는 입력 에코가 아니라 실제 전송 객체를 보여준다(B-8).
          expect(parsed.endpoint).toBe("/vserver/v2/createServerInstances");
          expect(parsed.requestParams.serverImageProductCode).toBe(serverImageProductCode);
          expect(parsed.requestParams.serverProductCode).toBe(serverProductCode);
          expect(parsed.requestParams.vpcNo).toBe(vpcNo);
          expect(parsed.requestParams.subnetNo).toBe(subnetNo);
          // Should NOT have isError
          expect(result.isError).toBeUndefined();
          requestSpy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Unit: confirm=true triggers API call", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerComputeServerTools(server, client);
  });

  it("ncloud_terminate_server with confirm=true should call terminateServerInstances API", async () => {
    const mockResponse = {
      serverInstanceList: [
        { serverInstanceNo: "12345", serverInstanceStatus: { code: "NSTOP" } },
      ],
    };
    const requestSpy = vi.spyOn(client, "request").mockResolvedValue(mockResponse);
    const handler = getToolHandler(server, "ncloud_terminate_server");
    const result = await handler({ serverInstanceNoList: ["12345"], confirm: true }, {} as any);

    expect(requestSpy).toHaveBeenCalledWith("/vserver/v2/terminateServerInstances", {
      serverInstanceNoList: ["12345"],
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.serverInstanceList).toBeDefined();
    requestSpy.mockRestore();
  });

  it("ncloud_terminate_server with confirm=true pre-checks status and BLOCKS a running server (no terminate API call)", async () => {
    const requestSpy = vi.spyOn(client, "request").mockImplementation(async (path: string) => {
      if (path === "/vserver/v2/getServerInstanceList") {
        return {
          serverInstanceList: [
            { serverInstanceNo: "12345", serverName: "web-1", serverInstanceStatus: { code: "RUN" }, serverInstanceStatusName: "running", isProtectServerTermination: false },
          ],
        };
      }
      throw new Error(`terminate API must not be called; got ${path}`);
    });
    const handler = getToolHandler(server, "ncloud_terminate_server");
    const result = await handler({ serverInstanceNoList: ["12345"], confirm: true }, {} as any);

    expect(requestSpy).toHaveBeenCalledWith("/vserver/v2/getServerInstanceList", { serverInstanceNoList: ["12345"] });
    expect(requestSpy).not.toHaveBeenCalledWith("/vserver/v2/terminateServerInstances", expect.anything());
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.terminated).toBe(false);
    expect(parsed.blockedServers[0].serverInstanceNo).toBe("12345");
    requestSpy.mockRestore();
  });

  it("ncloud_terminate_server with confirm=true BLOCKS a stopped-but-protected server", async () => {
    const requestSpy = vi.spyOn(client, "request").mockImplementation(async (path: string) => {
      if (path === "/vserver/v2/getServerInstanceList") {
        return {
          serverInstanceList: [
            { serverInstanceNo: "12345", serverInstanceStatus: { code: "NSTOP" }, isProtectServerTermination: true },
          ],
        };
      }
      throw new Error(`terminate API must not be called; got ${path}`);
    });
    const handler = getToolHandler(server, "ncloud_terminate_server");
    const result = await handler({ serverInstanceNoList: ["12345"], confirm: true }, {} as any);

    expect(requestSpy).not.toHaveBeenCalledWith("/vserver/v2/terminateServerInstances", expect.anything());
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.terminated).toBe(false);
    requestSpy.mockRestore();
  });

  it("ncloud_terminate_server with confirm=true PROCEEDS when all target servers are stopped and unprotected", async () => {
    const requestSpy = vi.spyOn(client, "request").mockImplementation(async (path: string) => {
      if (path === "/vserver/v2/getServerInstanceList") {
        return { serverInstanceList: [{ serverInstanceNo: "12345", serverInstanceStatus: { code: "NSTOP" }, isProtectServerTermination: false }] };
      }
      if (path === "/vserver/v2/terminateServerInstances") {
        return { serverInstanceList: [{ serverInstanceNo: "12345" }] };
      }
      throw new Error(`unexpected ${path}`);
    });
    const handler = getToolHandler(server, "ncloud_terminate_server");
    const result = await handler({ serverInstanceNoList: ["12345"], confirm: true }, {} as any);

    expect(requestSpy).toHaveBeenCalledWith("/vserver/v2/terminateServerInstances", { serverInstanceNoList: ["12345"] });
    expect(result.isError).toBeUndefined();
    requestSpy.mockRestore();
  });

  it("ncloud_delete_server_images with confirm=true should call deleteServerImageInstances API", async () => {
    const mockResponse = { serverImageInstanceList: [] };
    const requestSpy = vi.spyOn(client, "request").mockResolvedValue(mockResponse);
    const handler = getToolHandler(server, "ncloud_delete_server_images");
    const result = await handler({ serverImageInstanceNoList: ["99999"], confirm: true }, {} as any);

    expect(requestSpy).toHaveBeenCalledWith("/vserver/v2/deleteServerImageInstances", {
      serverImageInstanceNoList: ["99999"],
    });
    expect(result.isError).toBeUndefined();
    requestSpy.mockRestore();
  });
});

describe("Unit: Server creation summary format", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerComputeServerTools(server, client);
  });

  it("ncloud_create_server with dryRun=false should return structured summary", async () => {
    const mockResponse = {
      serverInstanceList: [
        {
          serverInstanceNo: "12345",
          serverName: "my-server",
          serverInstanceStatus: { codeName: "init" },
          createDate: "2025-01-01T00:00:00+0900",
          privateIp: "10.0.0.5",
        },
      ],
    };
    const requestSpy = vi.spyOn(client, "request").mockResolvedValue(mockResponse);
    const handler = getToolHandler(server, "ncloud_create_server");
    const result = await handler({
      serverImageProductCode: "SW.VSVR.OS.LNX64.UBNTU.SVR2004.B050",
      serverProductCode: "SVR.VSVR.HICPU.C002.M004.NET.SSD.B050.G002",
      vpcNo: "1111",
      subnetNo: "2222",
      serverName: "my-server",
      dryRun: false,
    }, {} as any);

    expect(requestSpy).toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.리소스타입).toBe("Server");
    expect(parsed.리소스ID).toBe("12345");
    expect(parsed.리소스명).toBe("my-server");
    expect(parsed.상태).toBe("init");
    expect(parsed.서버스펙).toBe("SVR.VSVR.HICPU.C002.M004.NET.SSD.B050.G002");
    expect(parsed.이미지).toBe("SW.VSVR.OS.LNX64.UBNTU.SVR2004.B050");
    expect(parsed.VPC).toBe("1111");
    expect(parsed.서브넷).toBe("2222");
    expect(parsed.사설IP).toBe("10.0.0.5");
    requestSpy.mockRestore();
  });

  it("ncloud_create_server dryRun preview should contain Dry-Run label", async () => {
    const handler = getToolHandler(server, "ncloud_create_server");
    const result = await handler({
      serverImageProductCode: "IMG001",
      serverProductCode: "SPEC001",
      vpcNo: "1111",
      subnetNo: "2222",
      dryRun: true,
    }, {} as any);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.label).toContain("Dry-Run");
    expect(parsed.requestParams.serverImageProductCode).toBe("IMG001");
    expect(parsed.requestParams.serverProductCode).toBe("SPEC001");
  });
});

describe("Unit: blockStorageMappingList (KVM boot volume type)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerComputeServerTools(server, client);
  });

  it("flattens blockStorageMappingList into 1-based indexed query params (order 0 = CB2 boot volume)", async () => {
    const requestSpy = vi.spyOn(client, "request").mockResolvedValue({ serverInstanceList: [{ serverInstanceNo: "1" }] });
    const handler = getToolHandler(server, "ncloud_create_server");
    await handler({
      serverImageNo: "100",
      serverSpecCode: "c2-g3",
      vpcNo: "1111",
      subnetNo: "2222",
      blockStorageMappingList: [
        { order: 0, blockStorageVolumeTypeCode: "CB2" },
        { order: 1, blockStorageVolumeTypeCode: "CB1", blockStorageSize: 100, blockStorageName: "data" },
      ],
      dryRun: false,
    }, {} as any);

    expect(requestSpy).toHaveBeenCalledTimes(1);
    const [, sentParams] = requestSpy.mock.calls[0];
    expect(sentParams["blockStorageMappingList.1.order"]).toBe(0);
    expect(sentParams["blockStorageMappingList.1.blockStorageVolumeTypeCode"]).toBe("CB2");
    expect(sentParams["blockStorageMappingList.2.order"]).toBe(1);
    expect(sentParams["blockStorageMappingList.2.blockStorageVolumeTypeCode"]).toBe("CB1");
    expect(sentParams["blockStorageMappingList.2.blockStorageSize"]).toBe(100);
    expect(sentParams["blockStorageMappingList.2.blockStorageName"]).toBe("data");
    // 배열 원본 필드는 평탄화된 파라미터로만 전달되어야 한다
    expect(sentParams.blockStorageMappingList).toBeUndefined();
    requestSpy.mockRestore();
  });

  it("rejects a list with no boot volume (no order=0) without calling the API", async () => {
    const requestSpy = vi.spyOn(client, "request");
    const handler = getToolHandler(server, "ncloud_create_server");
    const result = await handler({
      serverImageNo: "100",
      serverSpecCode: "c2-g3",
      vpcNo: "1111",
      subnetNo: "2222",
      blockStorageMappingList: [{ order: 1, blockStorageVolumeTypeCode: "CB2" }],
      dryRun: false,
    }, {} as any);

    expect(requestSpy).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("order=0");
    requestSpy.mockRestore();
  });

  it("rejects duplicate boot volumes (two order=0 entries) without calling the API", async () => {
    const requestSpy = vi.spyOn(client, "request");
    const handler = getToolHandler(server, "ncloud_create_server");
    const result = await handler({
      serverImageNo: "100",
      serverSpecCode: "c2-g3",
      vpcNo: "1111",
      subnetNo: "2222",
      blockStorageMappingList: [
        { order: 0, blockStorageVolumeTypeCode: "CB2" },
        { order: 0, blockStorageVolumeTypeCode: "CB1" },
      ],
      dryRun: false,
    }, {} as any);

    expect(requestSpy).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    requestSpy.mockRestore();
  });

  it("dryRun preview surfaces the boot volume type without calling the API", async () => {
    const requestSpy = vi.spyOn(client, "request");
    const handler = getToolHandler(server, "ncloud_create_server");
    const result = await handler({
      serverImageNo: "100",
      serverSpecCode: "c2-g3",
      vpcNo: "1111",
      subnetNo: "2222",
      blockStorageMappingList: [{ order: 0, blockStorageVolumeTypeCode: "CB2" }],
      dryRun: true,
    }, {} as any);

    expect(requestSpy).not.toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    // 프리뷰는 평탄화된 최종 전송 파라미터명을 그대로 보여준다(B-8).
    expect(parsed.requestParams["blockStorageMappingList.1.order"]).toBe(0);
    expect(parsed.requestParams["blockStorageMappingList.1.blockStorageVolumeTypeCode"]).toBe("CB2");
    requestSpy.mockRestore();
  });
});
