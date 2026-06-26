import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerContainersRegistryTools } from "./containers-registry.js";

function createMockClient(): NcloudClient {
  return new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl: "https://ncr.apigw.ntruss.com",
    regionCode: "KR",
  });
}

function getToolHandler(server: McpServer, toolName: string): any {
  const tools = (server as any)._registeredTools;
  const entry = tools instanceof Map ? tools.get(toolName) : tools[toolName];
  if (!entry) throw new Error(`Tool ${toolName} not found`);
  return entry.handler;
}

describe("NCR create_registry: storageType (2026-06 API 변경)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerContainersRegistryTools(server, client);
  });

  it("storageType='ncloudStorage' → POST /repositories/{name} + body에 bucket 미포함", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ returnCode: "201" });
    const handler = getToolHandler(server, "ncloud_ncr_create_registry");
    const result = await handler({ registryName: "my-reg", storageType: "ncloudStorage" }, {} as any);

    expect(spy).toHaveBeenCalledTimes(1);
    const [method, path, query, body] = spy.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe("/ncr/api/v2/repositories/my-reg");
    expect(query).toBeUndefined();
    expect(body).toEqual({ storageType: "ncloudStorage" });

    const data = JSON.parse(result.content[0].text);
    expect(data.storageType).toBe("ncloudStorage");
    spy.mockRestore();
  });

  it("storageType='objectStorage' + bucket → body에 storageType+bucket", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ returnCode: "201" });
    const handler = getToolHandler(server, "ncloud_ncr_create_registry");
    await handler({ registryName: "my-reg", storageType: "objectStorage", bucket: "my-bucket" }, {} as any);

    const body = spy.mock.calls[0][3];
    expect(body).toEqual({ storageType: "objectStorage", bucket: "my-bucket" });
    spy.mockRestore();
  });

  it("storageType 미지정(기본 objectStorage) + bucket → 정상 body", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ returnCode: "201" });
    const handler = getToolHandler(server, "ncloud_ncr_create_registry");
    await handler({ registryName: "my-reg", bucket: "my-bucket" }, {} as any);

    const body = spy.mock.calls[0][3];
    expect(body).toEqual({ storageType: "objectStorage", bucket: "my-bucket" });
    spy.mockRestore();
  });

  it("기본 objectStorage인데 bucket 미지정 → 호출 전 에러(가드), requestRaw 미호출", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ returnCode: "201" });
    const handler = getToolHandler(server, "ncloud_ncr_create_registry");
    const result = await handler({ registryName: "my-reg" }, {} as any);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/bucket/i);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("dryRun=true → requestRaw 미호출, 프리뷰에 storageType 반영", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ returnCode: "201" });
    const handler = getToolHandler(server, "ncloud_ncr_create_registry");
    const result = await handler({ registryName: "my-reg", storageType: "ncloudStorage", dryRun: true }, {} as any);

    expect(spy).not.toHaveBeenCalled();
    const data = JSON.parse(result.content[0].text);
    expect(data.storageType).toBe("ncloudStorage");
    expect(data.label).toMatch(/Dry-Run/);
    spy.mockRestore();
  });
});

describe("NCR get_registry: 상세 경로 /info", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerContainersRegistryTools(server, client);
  });

  it("상세 조회는 /{registry}/info 경로로 호출하고 storage_type을 그대로 통과시킨다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue({ name: "my-reg", storage_type: "ncloudStorage" });
    const handler = getToolHandler(server, "ncloud_ncr_get_registry");
    const result = await handler({ registryName: "my-reg" }, {} as any);

    expect(spy).toHaveBeenCalledWith("/ncr/api/v2/repositories/my-reg/info");
    const data = JSON.parse(result.content[0].text);
    expect(data.storage_type).toBe("ncloudStorage");
    spy.mockRestore();
  });
});
