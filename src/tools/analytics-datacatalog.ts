import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

/**
 * Data Catalog — 메타데이터 통합 및 관리 서비스
 *
 * Base URL: https://datacatalog.apigw.ntruss.com
 * API 경로: /api/v1/...
 * VPC 환경에서만 이용 가능
 */

export function registerDataCatalogTools(server: McpServer, client: NcloudClient): void {

  // ─── Catalog ─────────────────────────────────────────────────────────

  server.tool(
    "ncloud_datacatalog_get_catalogs",
    "Get Data Catalog list. Returns catalog ID, status, and metastore status.",
    {
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.pageNo) queryParams.pageNo = params.pageNo;
        if (params.pageSize) queryParams.pageSize = params.pageSize;
        const result = await client.requestRaw("GET", "/api/v1/catalogs", queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Database ────────────────────────────────────────────────────────

  server.tool(
    "ncloud_datacatalog_get_databases",
    "Get database list in a catalog",
    {
      catalogId: z.number().describe("Catalog ID (from getCatalogs)"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
      searchValue: z.string().optional().describe("Search keyword (database name)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.pageNo) queryParams.pageNo = params.pageNo;
        if (params.pageSize) queryParams.pageSize = params.pageSize;
        if (params.searchValue) queryParams.searchValue = params.searchValue;
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/databases`, queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_get_database",
    "Get database detail information including tags",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name (from getDatabases)"),
      includeTags: z.boolean().describe("Include tags in response (true/false)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {
          includeTags: params.includeTags,
        };
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/databases/${params.databaseName}`, queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Table ───────────────────────────────────────────────────────────

  server.tool(
    "ncloud_datacatalog_get_tables",
    "Get table list in a catalog with optional filtering and sorting",
    {
      catalogId: z.number().describe("Catalog ID"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
      databaseName: z.string().optional().describe("Filter by database name"),
      tableName: z.string().optional().describe("Filter by table name"),
      location: z.string().optional().describe("Filter by location string"),
      tagKeyValue: z.string().optional().describe("Filter by tag key:value"),
      dataFormats: z.string().optional().describe("Filter by data format (csv|json|xml|parquet|avro|orc|unknown|CLOUD_DB_FOR_MYSQL|CLOUD_DB_FOR_MSSQL|CLOUD_DB_FOR_MONGODB|CLOUD_DB_FOR_POSTGRESQL|JDBC)"),
      sortField: z.string().optional().describe("Sort field (tableName|databaseName|createTime)"),
      sortIsAsc: z.boolean().optional().describe("Sort ascending (true/false)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.pageNo) queryParams.pageNo = params.pageNo;
        if (params.pageSize) queryParams.pageSize = params.pageSize;
        if (params.databaseName) queryParams.databaseName = params.databaseName;
        if (params.tableName) queryParams.tableName = params.tableName;
        if (params.location) queryParams.location = params.location;
        if (params.tagKeyValue) queryParams.tagKeyValue = params.tagKeyValue;
        if (params.dataFormats) queryParams.dataFormats = params.dataFormats;
        if (params.sortField) queryParams["sort.field"] = params.sortField;
        if (params.sortIsAsc !== undefined) queryParams["sort.isAsc"] = params.sortIsAsc;
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/tables`, queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_get_tables_by_database",
    "Get table list in a specific database",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.pageNo) queryParams.pageNo = params.pageNo;
        if (params.pageSize) queryParams.pageSize = params.pageSize;
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/databases/${params.databaseName}/tables`, queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_get_table",
    "Get table detail information including properties",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name"),
      tableName: z.string().describe("Table name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/databases/${params.databaseName}/tables/${params.tableName}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_get_table_schema",
    "Get table schema (column names, types, descriptions)",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name"),
      tableName: z.string().describe("Table name"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.pageNo) queryParams.pageNo = params.pageNo;
        if (params.pageSize) queryParams.pageSize = params.pageSize;
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/databases/${params.databaseName}/tables/${params.tableName}/schema`, queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_get_table_partitions",
    "Get table partition list",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name"),
      tableName: z.string().describe("Table name"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.pageNo) queryParams.pageNo = params.pageNo;
        if (params.pageSize) queryParams.pageSize = params.pageSize;
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/databases/${params.databaseName}/tables/${params.tableName}/partitions`, queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_get_table_partition_keys",
    "Get table partition key list",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name"),
      tableName: z.string().describe("Table name"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.pageNo) queryParams.pageNo = params.pageNo;
        if (params.pageSize) queryParams.pageSize = params.pageSize;
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/databases/${params.databaseName}/tables/${params.tableName}/partitionKeys`, queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_get_table_properties",
    "Get table detailed properties",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name"),
      tableName: z.string().describe("Table name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/databases/${params.databaseName}/tables/${params.tableName}/properties`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_get_table_schema_and_partition_keys",
    "Get table schema and partition keys together",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name"),
      tableName: z.string().describe("Table name"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.pageNo) queryParams.pageNo = params.pageNo;
        if (params.pageSize) queryParams.pageSize = params.pageSize;
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/databases/${params.databaseName}/tables/${params.tableName}/schemaAndPartitionKeys`, queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_get_table_schema_versions",
    "Get table schema version history",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name"),
      tableName: z.string().describe("Table name"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.pageNo) queryParams.pageNo = params.pageNo;
        if (params.pageSize) queryParams.pageSize = params.pageSize;
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/databases/${params.databaseName}/tables/${params.tableName}/schemaVersions`, queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_get_table_schema_by_version",
    "Get table schema for a specific version",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name"),
      tableName: z.string().describe("Table name"),
      versionId: z.number().describe("Schema version ID (from getTableSchemaVersions)"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.pageNo) queryParams.pageNo = params.pageNo;
        if (params.pageSize) queryParams.pageSize = params.pageSize;
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/databases/${params.databaseName}/tables/${params.tableName}/schema/${params.versionId}`, queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_get_table_tags",
    "Get table tag list",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name"),
      tableName: z.string().describe("Table name"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.pageNo) queryParams.pageNo = params.pageNo;
        if (params.pageSize) queryParams.pageSize = params.pageSize;
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/databases/${params.databaseName}/tables/${params.tableName}/tags`, queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Scanner ─────────────────────────────────────────────────────────

  server.tool(
    "ncloud_datacatalog_get_scanners",
    "Get scanner list in a catalog",
    {
      catalogId: z.number().describe("Catalog ID"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
      searchValue: z.string().optional().describe("Search keyword (scanner name or description)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.pageNo) queryParams.pageNo = params.pageNo;
        if (params.pageSize) queryParams.pageSize = params.pageSize;
        if (params.searchValue) queryParams.searchValue = params.searchValue;
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/scanners`, queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_get_scanner",
    "Get scanner detail information",
    {
      catalogId: z.number().describe("Catalog ID"),
      scannerId: z.number().describe("Scanner ID (from getScanners)"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/scanners/${params.scannerId}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_get_scanner_histories",
    "Get scanner execution history",
    {
      catalogId: z.number().describe("Catalog ID"),
      scannerId: z.number().describe("Scanner ID"),
      fromTimestamp: z.number().describe("Start time in milliseconds (Unix timestamp)"),
      toTimestamp: z.number().describe("End time in milliseconds (Unix timestamp)"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {
          fromTimestamp: params.fromTimestamp,
          toTimestamp: params.toTimestamp,
        };
        if (params.pageNo) queryParams.pageNo = params.pageNo;
        if (params.pageSize) queryParams.pageSize = params.pageSize;
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/scanners/${params.scannerId}/histories`, queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_run_scanner",
    "Run (execute) a scanner to scan data sources",
    {
      catalogId: z.number().describe("Catalog ID"),
      scannerId: z.number().describe("Scanner ID to run"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "PUT", `/api/v1/catalogs/${params.catalogId}/scanners/${params.scannerId}/run-scanner`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_stop_scanner",
    "Stop a running scanner",
    {
      catalogId: z.number().describe("Catalog ID"),
      scannerId: z.number().describe("Scanner ID to stop"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "PUT", `/api/v1/catalogs/${params.catalogId}/scanners/${params.scannerId}/stop-scanner`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Connection ──────────────────────────────────────────────────────

  server.tool(
    "ncloud_datacatalog_get_connections",
    "Get connection list in a catalog",
    {
      catalogId: z.number().describe("Catalog ID"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
      searchValue: z.string().optional().describe("Search keyword (connection name or description)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.pageNo) queryParams.pageNo = params.pageNo;
        if (params.pageSize) queryParams.pageSize = params.pageSize;
        if (params.searchValue) queryParams.searchValue = params.searchValue;
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/connections`, queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_datacatalog_get_connection",
    "Get connection detail information",
    {
      catalogId: z.number().describe("Catalog ID"),
      connectionId: z.number().describe("Connection ID (from getConnections)"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/connections/${params.connectionId}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
