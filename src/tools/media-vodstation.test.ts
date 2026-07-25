import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerVodStationTools } from "./media-vodstation.js";

function createMockClient(): NcloudClient {
  return new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl: "https://vodstation.apigw.ntruss.com",
    regionCode: "KR",
  });
}

function getToolHandler(server: McpServer, toolName: string): any {
  const tools = (server as any)._registeredTools;
  if (!tools) throw new Error("No registered tools found on server");
  const entry = tools instanceof Map ? tools.get(toolName) : tools[toolName];
  if (!entry) throw new Error(`Tool ${toolName} not found`);
  return entry.handler;
}

describe("VOD Station channel update", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerVodStationTools(server, client);
  });

  it("PUTs to /api/v2/channels/{id}, mapping channelName -> body.name with the required fields", async () => {
    const spy = vi.spyOn(client, "putRequest").mockResolvedValue({ content: { id: "vs-1" } });
    const handler = getToolHandler(server, "ncloud_vodstation_update_channel");
    await handler({ channelId: "vs-1", channelName: "my-channel", protocolList: ["HLS"], segmentDuration: 10 }, {} as any);

    expect(spy).toHaveBeenCalledWith("/api/v2/channels/vs-1", {
      name: "my-channel",
      protocolList: ["HLS"],
      segmentDuration: 10,
    });
    spy.mockRestore();
  });

  it("includes optional fields only when provided", async () => {
    const spy = vi.spyOn(client, "putRequest").mockResolvedValue({});
    const handler = getToolHandler(server, "ncloud_vodstation_update_channel");
    await handler({
      channelId: "vs-1",
      channelName: "c",
      protocolList: ["HLS", "DASH"],
      segmentDuration: 6,
      segmentDurationOption: "VARIABLE",
      drm: { siteId: "s1" },
    }, {} as any);

    const [, body] = spy.mock.calls[0];
    expect(body.segmentDurationOption).toBe("VARIABLE");
    expect(body.drm).toEqual({ siteId: "s1" });
    expect("encryptionList" in body).toBe(false);
    spy.mockRestore();
  });
});
