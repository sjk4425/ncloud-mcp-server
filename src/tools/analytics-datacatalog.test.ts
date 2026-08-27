import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerDataCatalogTools } from "./analytics-datacatalog.js";

function createMockClient(): NcloudClient {
  return new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl: "https://datacatalog.apigw.ntruss.com",
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

describe("Data Catalog tools — 공식 API 문서 대조 수정분", () => {
  let server: McpServer;
  let client: NcloudClient;
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerDataCatalogTools(server, client);
    spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ ok: true });
  });

  describe("경로 세그먼트는 kebab-case (camelCase는 404였다)", () => {
    const base = "/api/v1/catalogs/4/databases/log_database/tables/log_table";

    it("get_table_partition_keys uses /partition-keys", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_get_table_partition_keys");
      await handler({ catalogId: 4, databaseName: "log_database", tableName: "log_table" }, {} as any);

      expect(spy.mock.calls[0][1]).toBe(`${base}/partition-keys`);
    });

    it("get_table_schema_and_partition_keys uses /schema-and-partition-keys", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_get_table_schema_and_partition_keys");
      await handler({ catalogId: 4, databaseName: "log_database", tableName: "log_table" }, {} as any);

      expect(spy.mock.calls[0][1]).toBe(`${base}/schema-and-partition-keys`);
    });

    it("get_table_schema_versions uses /schema-versions", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_get_table_schema_versions");
      await handler({ catalogId: 4, databaseName: "log_database", tableName: "log_table" }, {} as any);

      expect(spy.mock.calls[0][1]).toBe(`${base}/schema-versions`);
    });

    it("no request path contains a camelCase segment", async () => {
      const camelCasePaths = ["partitionKeys", "schemaAndPartitionKeys", "schemaVersions"];
      for (const tool of [
        "ncloud_datacatalog_get_table_partition_keys",
        "ncloud_datacatalog_get_table_schema_and_partition_keys",
        "ncloud_datacatalog_get_table_schema_versions",
        "ncloud_datacatalog_get_table_schema",
        "ncloud_datacatalog_get_table_partitions",
        "ncloud_datacatalog_get_table_tags",
      ]) {
        await getToolHandler(server, tool)({ catalogId: 4, databaseName: "d", tableName: "t" }, {} as any);
      }
      const paths = spy.mock.calls.map((c: any[]) => c[1] as string);
      for (const path of paths) {
        for (const camel of camelCasePaths) expect(path).not.toContain(camel);
      }
    });
  });

  describe("경로 변수 인코딩 — DB 이름은 공백이 허용된다", () => {
    it("encodes a database name containing a space", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_get_database");
      await handler({ catalogId: 4, databaseName: "my database", includeTags: true }, {} as any);

      expect(spy.mock.calls[0][1]).toBe("/api/v1/catalogs/4/databases/my%20database");
    });

    it("encodes both database and table names", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_get_table");
      await handler({ catalogId: 4, databaseName: "my db", tableName: "tbl #1" }, {} as any);

      expect(spy.mock.calls[0][1]).toBe("/api/v1/catalogs/4/databases/my%20db/tables/tbl%20%231");
    });
  });

  describe("database 쓰기 도구", () => {
    it("creates a database and resolves the location preview", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_create_database");
      await handler(
        { catalogId: 4, name: "mydatabase", location: "s3a://mybucket", description: "d", tagKeyTypeValueList: [{ tagKey: "env", tagType: "STRING", tagValue: "dev" }] },
        {} as any
      );

      expect(spy).toHaveBeenCalledWith("POST", "/api/v1/catalogs/4/databases", undefined, {
        name: "mydatabase",
        location: "s3a://mybucket",
        description: "d",
        tagKeyTypeValueList: [{ tagKey: "env", tagType: "STRING", tagValue: "dev" }],
      });
    });

    it("dryRun shows the resolved location without calling the API", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_create_database");
      const result = await handler({ catalogId: 4, name: "mydatabase", location: "s3a://mybucket/", dryRun: true }, {} as any);

      expect(spy).not.toHaveBeenCalled();
      expect(parsed(result).resolvedLocation).toBe("s3a://mybucket/mydatabase");
    });

    it("updates only the provided database fields", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_update_database");
      await handler({ catalogId: 4, databaseName: "mydatabase", description: "new" }, {} as any);

      expect(spy).toHaveBeenCalledWith("PUT", "/api/v1/catalogs/4/databases/mydatabase", undefined, { description: "new" });
    });

    it("rejects a database update with nothing to change", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_update_database");
      const result = await handler({ catalogId: 4, databaseName: "mydatabase" }, {} as any);

      expect(result.isError).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });

    it("replaces database tags via PUT /tag", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_update_database_tag");
      const tags = [{ tagKey: "team", tagType: "STRING", tagValue: "a" }];
      await handler({ catalogId: 4, databaseName: "mydatabase", tagKeyTypeValueList: tags }, {} as any);

      expect(spy).toHaveBeenCalledWith("PUT", "/api/v1/catalogs/4/databases/mydatabase/tag", undefined, {
        tagKeyTypeValueList: tags,
      });
    });
  });

  describe("table 쓰기 도구", () => {
    it("replaces the table schema via PUT /schema", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_update_table_schema");
      const columns = [{ name: "id", type: "bigint" }, { name: "payload", type: "string", description: "raw" }];
      await handler({ catalogId: 4, databaseName: "d", tableName: "t", columns }, {} as any);

      expect(spy).toHaveBeenCalledWith("PUT", "/api/v1/catalogs/4/databases/d/tables/t/schema", undefined, { columns });
    });

    it("replaces table tags via PUT /tag, allowing an empty list", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_update_table_tag");
      await handler({ catalogId: 4, databaseName: "d", tableName: "t", tagKeyTypeValueList: [] }, {} as any);

      expect(spy).toHaveBeenCalledWith("PUT", "/api/v1/catalogs/4/databases/d/tables/t/tag", undefined, {
        tagKeyTypeValueList: [],
      });
    });
  });

  describe("create_scanner", () => {
    const objectStorage = {
      catalogId: 4,
      name: "my-scanner",
      type: "OBJECT_STORAGE",
      databaseName: "mydatabase",
      scheduleType: "ON_DEMAND",
      opAddType: "UPDATE_TABLE",
      location: "s3a://mybucket/test/",
    };

    it("posts the scanner body without catalogId or dryRun", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_create_scanner");
      await handler({ ...objectStorage, tablePrefixName: "test-", isMergeForce: false }, {} as any);

      const [method, path, query, body] = spy.mock.calls[0] as any[];
      expect([method, path, query]).toEqual(["POST", "/api/v1/catalogs/4/scanners", undefined]);
      expect(body).toEqual({
        name: "my-scanner",
        type: "OBJECT_STORAGE",
        databaseName: "mydatabase",
        scheduleType: "ON_DEMAND",
        opAddType: "UPDATE_TABLE",
        location: "s3a://mybucket/test/",
        tablePrefixName: "test-",
        isMergeForce: false,
      });
      expect("catalogId" in body).toBe(false);
      expect("dryRun" in body).toBe(false);
    });

    it("accepts ICEBERG with a location", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_create_scanner");
      await handler({ ...objectStorage, type: "ICEBERG" }, {} as any);

      expect((spy.mock.calls[0] as any[])[3].type).toBe("ICEBERG");
    });

    it("requires location for OBJECT_STORAGE / ICEBERG", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_create_scanner");
      const { location, ...noLocation } = objectStorage;
      const result = await handler(noLocation, {} as any);

      expect(result.isError).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });

    it("requires connectionId for DB / JDBC types", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_create_scanner");
      const { location, ...rest } = objectStorage;
      const result = await handler({ ...rest, type: "CLOUD_DB_FOR_MYSQL" }, {} as any);

      expect(result.isError).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });

    it("accepts a DB type when connectionId is given", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_create_scanner");
      const { location, ...rest } = objectStorage;
      await handler({ ...rest, type: "CLOUD_DB_FOR_MYSQL", connectionId: 7 }, {} as any);

      expect((spy.mock.calls[0] as any[])[3].connectionId).toBe(7);
    });

    it("requires a cron expression when scheduleType is CRON", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_create_scanner");
      const result = await handler({ ...objectStorage, scheduleType: "CRON" }, {} as any);

      expect(result.isError).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });

    it("dryRun previews without calling the API and states that no scan runs", async () => {
      const handler = getToolHandler(server, "ncloud_datacatalog_create_scanner");
      const result = await handler({ ...objectStorage, dryRun: true }, {} as any);

      expect(spy).not.toHaveBeenCalled();
      expect(parsed(result).endpoint).toBe("POST /api/v1/catalogs/4/scanners");
      expect(parsed(result).note).toContain("run_scanner");
    });
  });
});
