import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerResourceManagerTools } from "./governance-resource-manager.js";

function createMockClient(): NcloudClient {
  return new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl: "https://resourcemanager.apigw.ntruss.com",
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

/** 도구 응답(JSON 텍스트)에서 원본 객체를 되돌린다. */
function parsed(result: any): any {
  return JSON.parse(result.content[0].text);
}

const DATA_QUERY_ITEM = {
  nrn: "nrn:PUB:DataQuery:KR:879496:DataSource/2942",
  productName: "DataQuery",
  productDisplayName: "Data Query",
  resourceType: "DataSource",
};

describe("Resource Manager tools — 공식 API 문서 대조 수정분", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerResourceManagerTools(server, client);
  });

  describe("list_resources — 필터 전달", () => {
    it("posts only the provided filters to /api/v1/resources", async () => {
      const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ itemCount: 1, items: [DATA_QUERY_ITEM] });
      const handler = getToolHandler(server, "ncloud_resource_list_resources");
      await handler({ productName: "DataQuery", regionCode: "KR", size: 100 }, {} as any);

      expect(spy).toHaveBeenCalledWith("/api/v1/resources", {
        productName: "DataQuery",
        regionCode: "KR",
        size: 100,
      });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("accepts a tag filter with the key alone (tagValue is optional in the API)", async () => {
      const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ items: [DATA_QUERY_ITEM] });
      const handler = getToolHandler(server, "ncloud_resource_list_resources");
      await handler({ tag: [{ tagKey: "env" }] }, {} as any);

      expect(spy).toHaveBeenCalledWith("/api/v1/resources", { tag: [{ tagKey: "env" }] });
    });

    it("does not probe when results were returned", async () => {
      const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ items: [DATA_QUERY_ITEM] });
      const handler = getToolHandler(server, "ncloud_resource_list_resources");
      const result = await handler({ productName: "DataQuery" }, {} as any);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(parsed(result)).not.toHaveProperty("productNameFilterHint");
    });

    it("does not probe when no productName filter was given", async () => {
      const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ items: [] });
      const handler = getToolHandler(server, "ncloud_resource_list_resources");
      const result = await handler({ resourceType: "DataSource" }, {} as any);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(parsed(result)).not.toHaveProperty("productNameFilterHint");
    });
  });

  describe("list_resources — productName 0건 진단 힌트 (#6 오탐 방지)", () => {
    it("probes without the productName filter and suggests the real service code", async () => {
      const spy = vi
        .spyOn(client, "postRequest")
        .mockResolvedValueOnce({ itemCount: 0, items: [] })
        .mockResolvedValueOnce({ items: [DATA_QUERY_ITEM, { productName: "Server", productDisplayName: "Server (VPC)" }] });
      const handler = getToolHandler(server, "ncloud_resource_list_resources");
      const result = await handler({ productName: "Data Query", regionCode: "KR" }, {} as any);

      // 프로브는 같은 조건에서 productName 만 제외하고 첫 100건을 본다.
      expect(spy).toHaveBeenNthCalledWith(2, "/api/v1/resources", { regionCode: "KR", page: 0, size: 100 });

      const hint = parsed(result).productNameFilterHint;
      expect(hint.suggestedProductName).toBe("DataQuery");
      expect(hint.availableProductNames).toEqual([
        { productName: "DataQuery", productDisplayName: "Data Query" },
        { productName: "Server", productDisplayName: "Server (VPC)" },
      ]);
    });

    it("omits the suggestion when no code matches, but still lists what exists", async () => {
      vi.spyOn(client, "postRequest")
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [{ productName: "Server", productDisplayName: "Server (VPC)" }] });
      const handler = getToolHandler(server, "ncloud_resource_list_resources");
      const result = await handler({ productName: "NoSuchService" }, {} as any);

      const hint = parsed(result).productNameFilterHint;
      expect(hint).not.toHaveProperty("suggestedProductName");
      expect(hint.availableProductNames).toEqual([{ productName: "Server", productDisplayName: "Server (VPC)" }]);
    });

    it("dedupes codes across items and keeps them sorted", async () => {
      vi.spyOn(client, "postRequest")
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({
          items: [
            { productName: "Server", productDisplayName: "Server (VPC)" },
            { productName: "DataQuery", productDisplayName: "Data Query" },
            { productName: "Server", productDisplayName: "Server (VPC)" },
          ],
        });
      const handler = getToolHandler(server, "ncloud_resource_list_resources");
      const result = await handler({ productName: "data-query" }, {} as any);

      const hint = parsed(result).productNameFilterHint;
      expect(hint.availableProductNames.map((p: any) => p.productName)).toEqual(["DataQuery", "Server"]);
      expect(hint.suggestedProductName).toBe("DataQuery");
    });

    it("returns the original response unchanged when the probe itself fails", async () => {
      vi.spyOn(client, "postRequest")
        .mockResolvedValueOnce({ itemCount: 0, items: [] })
        .mockRejectedValueOnce(new Error("403 권한 없음"));
      const handler = getToolHandler(server, "ncloud_resource_list_resources");
      const result = await handler({ productName: "Data Query" }, {} as any);

      expect(result.isError).toBeUndefined();
      expect(parsed(result)).toEqual({ itemCount: 0, items: [] });
    });
  });

  describe("tag / group 도구", () => {
    it("attaches a tag via POST /api/v1/resource-tags", async () => {
      const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ success: true });
      const handler = getToolHandler(server, "ncloud_resource_attach_tag");
      await handler({ nrnList: [DATA_QUERY_ITEM.nrn], tagKey: "env", tagValue: "dev" }, {} as any);

      expect(spy).toHaveBeenCalledWith("/api/v1/resource-tags", {
        nrnList: [DATA_QUERY_ITEM.nrn],
        tagKey: "env",
        tagValue: "dev",
      });
    });

    it("detaches a tag by key alone, behind the confirm gate", async () => {
      const spy = vi.spyOn(client, "deleteRequest").mockResolvedValue({ success: true });
      const handler = getToolHandler(server, "ncloud_resource_detach_tag");

      const blocked = await handler({ nrnList: [DATA_QUERY_ITEM.nrn], tagKey: "env" }, {} as any);
      expect(blocked.content[0].text).toContain("confirm=true");
      expect(spy).not.toHaveBeenCalled();

      await handler({ nrnList: [DATA_QUERY_ITEM.nrn], tagKey: "env", confirm: true }, {} as any);
      expect(spy).toHaveBeenCalledWith("/api/v1/resource-tags", { nrnList: [DATA_QUERY_ITEM.nrn], tagKey: "env" });
    });

    it("attaches resources to a group with an encoded groupId", async () => {
      const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ success: true });
      const handler = getToolHandler(server, "ncloud_resource_attach_group");
      await handler({ groupId: "grp 1", nrnList: [DATA_QUERY_ITEM.nrn] }, {} as any);

      expect(spy).toHaveBeenCalledWith("POST", "/api/v1/groups/grp%201/resources", undefined, {
        nrnList: [DATA_QUERY_ITEM.nrn],
      });
    });
  });
});
