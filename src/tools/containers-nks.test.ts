import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerContainersNksTools } from "./containers-nks.js";

function createMockClient(): NcloudClient {
  return new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl: "https://nks.apigw.ntruss.com",
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

describe("NKS Add-on Manager tools", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerContainersNksTools(server, client);
  });

  it("list_available_addons issues GET /vnks/v2/addon-configs with required k8sVersion", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ addonConfigs: [] });
    const handler = getToolHandler(server, "ncloud_nks_list_available_addons");
    await handler({ k8sVersion: "1.36.0" }, {} as any);
    expect(spy).toHaveBeenCalledWith("GET", "/vnks/v2/addon-configs", { k8sVersion: "1.36.0" });
    spy.mockRestore();
  });

  it("install_addons dryRun does NOT call the API and returns a preview", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const handler = getToolHandler(server, "ncloud_nks_install_addons");
    const result = await handler({
      clusterUuid: "uuid-1",
      addons: [{ addonName: "external-dns", version: "1.0.0" }],
      dryRun: true,
    }, {} as any);

    expect(spy).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.label).toContain("Dry-Run");
    expect(parsed.addons[0].addonName).toBe("external-dns");
    spy.mockRestore();
  });

  it("install_addons POSTs a bare top-level array body (not wrapped)", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ addons: [], totalCount: 0 });
    const handler = getToolHandler(server, "ncloud_nks_install_addons");
    const addons = [
      { addonName: "nks-csi", version: "1.0.0" },
      { addonName: "external-dns", version: "1.0.0", configurationValues: '{"policy":"sync"}', resolveConflicts: "Overwrite" },
    ];
    await handler({ clusterUuid: "uuid-1", addons, dryRun: false }, {} as any);

    expect(spy).toHaveBeenCalledWith("POST", "/vnks/v2/clusters/uuid-1/addons", undefined, addons);
    // body must be the array itself, not { addons: [...] }
    const [, , , body] = spy.mock.calls[0];
    expect(Array.isArray(body)).toBe(true);
    spy.mockRestore();
  });

  it("update_addon with no fields returns isError and does NOT call the API", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const handler = getToolHandler(server, "ncloud_nks_update_addon");
    const result = await handler({ clusterUuid: "uuid-1", addonRef: "external-dns" }, {} as any);

    expect(spy).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    spy.mockRestore();
  });

  it("update_addon PATCHes only the provided fields to the addonRef path", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ status: "updating" });
    const handler = getToolHandler(server, "ncloud_nks_update_addon");
    await handler({ clusterUuid: "uuid-1", addonRef: "external-dns", version: "1.1.0" }, {} as any);

    expect(spy).toHaveBeenCalledWith("PATCH", "/vnks/v2/clusters/uuid-1/addons/external-dns", undefined, { version: "1.1.0" });
    spy.mockRestore();
  });

  it("delete_addon with confirm=false does NOT call the API and returns a confirm prompt", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const handler = getToolHandler(server, "ncloud_nks_delete_addon");
    const result = await handler({ clusterUuid: "uuid-1", addonRef: "external-dns", confirm: false }, {} as any);

    expect(spy).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("⚠️");
    expect(result.content[0].text).toContain("external-dns");
    spy.mockRestore();
  });

  it("delete_addon with confirm=true issues DELETE on the addonRef path", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ status: "delete_in_progress" });
    const handler = getToolHandler(server, "ncloud_nks_delete_addon");
    await handler({ clusterUuid: "uuid-1", addonRef: "external-dns", confirm: true }, {} as any);

    expect(spy).toHaveBeenCalledWith("DELETE", "/vnks/v2/clusters/uuid-1/addons/external-dns");
    spy.mockRestore();
  });
});
