import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerCloudDataStreamingTools } from "./analytics-cdss.js";
import { registerSearchEngineServiceTools } from "./analytics-ses.js";

/**
 * 2026-10-02 guide re-check: operations that only some zone guides document.
 *  - cdss-getclusternodestorage (pub, fin): GET {prefix}/cluster/getBlockStorage/{computeInstanceNo}
 *  - analytics-clouddatastreamingservice-cluster-restartcmakservice (gov only): GET {prefix}/cluster/restartCMAKService/{no}
 *  - ses-getclusternodestorage (pub only): POST {prefix}/cluster/getBlockStorage/{computeInstanceNo}
 */
type Zone = "pub" | "gov" | "fin";

function setup(zone: Zone, register: typeof registerCloudDataStreamingTools | typeof registerSearchEngineServiceTools) {
  const server = new McpServer({ name: "t", version: "1" });
  const regionCode = zone === "fin" ? "FKR" : "KR";
  const client = new NcloudClient({ accessKey: "a", secretKey: "b", baseUrl: "https://example.invalid", regionCode });
  register(server, client, { zone });
  const raw = (server as any)._registeredTools;
  const tools: Map<string, any> = raw instanceof Map ? raw : new Map(Object.entries(raw));
  return { tools, client };
}

describe("CDSS node storage / CMAK restart — zone gating and paths", () => {
  it("pub: get_node_storage registered (GET getBlockStorage), restart_cmak_service absent", async () => {
    const { tools, client } = setup("pub", registerCloudDataStreamingTools);
    expect(tools.has("ncloud_cdss_get_node_storage")).toBe(true);
    expect(tools.has("ncloud_cdss_restart_cmak_service")).toBe(false);
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ ok: true });
    await tools.get("ncloud_cdss_get_node_storage").handler({ computeInstanceNo: "1037" }, {});
    expect(spy).toHaveBeenCalledWith("GET", "/api/v1/cluster/getBlockStorage/1037");
  });

  it("fin: get_node_storage registered with the /api/v1 prefix, restart_cmak_service absent", async () => {
    const { tools, client } = setup("fin", registerCloudDataStreamingTools);
    expect(tools.has("ncloud_cdss_get_node_storage")).toBe(true);
    expect(tools.has("ncloud_cdss_restart_cmak_service")).toBe(false);
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ ok: true });
    await tools.get("ncloud_cdss_get_node_storage").handler({ computeInstanceNo: "1037" }, {});
    expect(spy).toHaveBeenCalledWith("GET", "/api/v1/cluster/getBlockStorage/1037");
  });

  it("gov: restart_cmak_service registered (GET restartCMAKService), get_node_storage absent", async () => {
    const { tools, client } = setup("gov", registerCloudDataStreamingTools);
    expect(tools.has("ncloud_cdss_restart_cmak_service")).toBe(true);
    expect(tools.has("ncloud_cdss_get_node_storage")).toBe(false);
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ ok: true });
    await tools.get("ncloud_cdss_restart_cmak_service").handler({ serviceGroupInstanceNo: "1009" }, {});
    expect(spy).toHaveBeenCalledWith("GET", "/api/v1/cluster/restartCMAKService/1009");
  });

  it("gov KRS: restart_cmak_service uses the /api/krs-v1 prefix", async () => {
    const server = new McpServer({ name: "t", version: "1" });
    const client = new NcloudClient({ accessKey: "a", secretKey: "b", baseUrl: "https://example.invalid", regionCode: "KRS" });
    registerCloudDataStreamingTools(server, client, { zone: "gov" });
    const raw = (server as any)._registeredTools;
    const tools: Map<string, any> = raw instanceof Map ? raw : new Map(Object.entries(raw));
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ ok: true });
    await tools.get("ncloud_cdss_restart_cmak_service").handler({ serviceGroupInstanceNo: "1009" }, {});
    expect(spy).toHaveBeenCalledWith("GET", "/api/krs-v1/cluster/restartCMAKService/1009");
  });
});

describe("SES node storage — public zone only", () => {
  it("pub: POST {prefix}/cluster/getBlockStorage/{computeInstanceNo}", async () => {
    const { tools, client } = setup("pub", registerSearchEngineServiceTools);
    expect(tools.has("ncloud_ses_get_node_storage")).toBe(true);
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ ok: true });
    await tools.get("ncloud_ses_get_node_storage").handler({ computeInstanceNo: "1037" }, {});
    expect(spy).toHaveBeenCalledWith("POST", "/api/v2/cluster/getBlockStorage/1037");
  });

  it("gov / fin: not registered", () => {
    expect(setup("gov", registerSearchEngineServiceTools).tools.has("ncloud_ses_get_node_storage")).toBe(false);
    expect(setup("fin", registerSearchEngineServiceTools).tools.has("ncloud_ses_get_node_storage")).toBe(false);
  });
});
