import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, dryRunMessage, requiredError } from "./_messages.js";

/**
 * Data Catalog — 메타데이터 통합 및 관리 서비스
 *
 * Base URL: https://datacatalog.apigw.ntruss.com
 * API 경로: /api/v1/...
 * VPC 환경에서만 이용 가능
 *
 * ⚠️ 경로 규칙: 다중 단어 세그먼트는 **kebab-case** 다
 * (`partition-keys`, `schema-and-partition-keys`, `schema-versions`, `run-scanner`).
 * camelCase로 보내면 404 — 도구명(camelCase)과 경로를 혼동하지 말 것.
 */

/**
 * 데이터베이스 경로. 이름은 반드시 인코딩한다 — Data Catalog의 DB 이름 규칙은
 * `[a-z0-9_\-\s]+` 로 **공백을 허용**하므로 그대로 보간하면 URL과 서명이 깨진다.
 */
function dbPath(catalogId: number, databaseName: string): string {
  return `/api/v1/catalogs/${catalogId}/databases/${encodeURIComponent(databaseName)}`;
}

/** 테이블 경로. 테이블 이름도 같은 이유로 인코딩한다. */
function tablePath(catalogId: number, databaseName: string, tableName: string): string {
  return `${dbPath(catalogId, databaseName)}/tables/${encodeURIComponent(tableName)}`;
}

/** 태그 목록 항목. Data Catalog는 태그를 `{tagKey, tagType, tagValue}` 배열로 받는다. */
const TAG_ITEM_SCHEMA = z.object({
  tagKey: z.string().describe("Tag key (1-64 chars)"),
  tagType: z.enum(["STRING", "DOUBLE", "BOOLEAN", "DATETIME"]).describe("Tag value type"),
  tagValue: z.string().describe("Tag value (1-256 chars)"),
});

export function registerDataCatalogTools(server: McpServer, client: NcloudClient): void {

  // ─── Catalog ─────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_datacatalog_get_catalogs",
    "Get Data Catalog list. Returns catalog ID, status, and metastore status.",
    {
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
    },
    async (params) => {
      const queryParams: Record<string, string | number | boolean | undefined> = {};
      if (params.pageNo) queryParams.pageNo = params.pageNo;
      if (params.pageSize) queryParams.pageSize = params.pageSize;
      const result = await client.requestRaw("GET", "/api/v1/catalogs", queryParams);
      return result;
    }
  );

  // ─── Database ────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_datacatalog_get_databases",
    "Get database list in a catalog",
    {
      catalogId: z.number().describe("Catalog ID (from getCatalogs)"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
      searchValue: z.string().optional().describe("Search keyword (database name)"),
    },
    async (params) => {
      const queryParams: Record<string, string | number | boolean | undefined> = {};
      if (params.pageNo) queryParams.pageNo = params.pageNo;
      if (params.pageSize) queryParams.pageSize = params.pageSize;
      if (params.searchValue) queryParams.searchValue = params.searchValue;
      const result = await client.requestRaw(
        "GET", `/api/v1/catalogs/${params.catalogId}/databases`, queryParams
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datacatalog_get_database",
    "Get database detail information including tags",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name (from getDatabases)"),
      includeTags: z.boolean().describe("Include tags in response (true/false)"),
    },
    async (params) => {
      const queryParams: Record<string, string | number | boolean | undefined> = {
        includeTags: params.includeTags,
      };
      const result = await client.requestRaw(
        "GET", `${dbPath(params.catalogId, params.databaseName)}`, queryParams
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datacatalog_create_database",
    "Create a database in a Data Catalog catalog. The database name is appended to location as a sub-path (location 's3a://mybucket' + name 'mydatabase' → 's3a://mybucket/mydatabase'). Use dryRun=true to preview without creating.",
    {
      catalogId: z.number({ required_error: requiredError("catalogId") }).describe("Catalog ID (from getCatalogs)"),
      name: z.string({ required_error: requiredError("name") }).describe("Database name (1-128 chars, lowercase letters/digits/'_'/'-'/spaces only — pattern [a-z0-9_\\-\\s]+)"),
      location: z.string({ required_error: requiredError("location") }).describe("Database location path, max 1000 chars (e.g. 's3a://mybucket'). The name is appended as a sub-path"),
      description: z.string().optional().describe("Database description (max 1000 chars)"),
      tagKeyTypeValueList: z.array(TAG_ITEM_SCHEMA).optional().describe("Tags to attach to the database"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the database"),
    },
    async (params) => {
      const bodyParams: Record<string, unknown> = { name: params.name, location: params.location };
      if (params.description !== undefined) bodyParams.description = params.description;
      if (params.tagKeyTypeValueList !== undefined) bodyParams.tagKeyTypeValueList = params.tagKeyTypeValueList;

      if (params.dryRun) {
        return {
          label: "🔍 Dry-Run Preview: Data Catalog Database Creation",
          endpoint: `POST /api/v1/catalogs/${params.catalogId}/databases`,
          request: bodyParams,
          resolvedLocation: `${params.location.replace(/\/+$/, "")}/${params.name}`,
          message: dryRunMessage({ ko: "데이터베이스", en: "database" }),
        };
      }

      return client.requestRaw("POST", `/api/v1/catalogs/${params.catalogId}/databases`, undefined, bodyParams);
    }
  );

  defineTool(
    server,
    "ncloud_datacatalog_update_database",
    "Update a database's location and/or description. Tags are managed separately by ncloud_datacatalog_update_database_tag.",
    {
      catalogId: z.number({ required_error: requiredError("catalogId") }).describe("Catalog ID"),
      databaseName: z.string({ required_error: requiredError("databaseName") }).describe("Database name to update (from getDatabases)"),
      location: z.string().optional().describe("New database location path"),
      description: z.string().optional().describe("New database description (max 1000 chars)"),
    },
    async (params) => {
      if (params.location === undefined && params.description === undefined) {
        return {
          content: [{
            type: "text" as const,
            text: L({
              ko: "location 또는 description 중 하나는 반드시 지정해야 합니다.",
              en: "At least one of location or description must be provided.",
            }),
          }],
          isError: true,
        };
      }
      const bodyParams: Record<string, unknown> = {};
      if (params.location !== undefined) bodyParams.location = params.location;
      if (params.description !== undefined) bodyParams.description = params.description;
      return client.requestRaw("PUT", dbPath(params.catalogId, params.databaseName), undefined, bodyParams);
    }
  );

  defineTool(
    server,
    "ncloud_datacatalog_update_database_tag",
    "⚠️ Replaces ALL tags on a database with the list given — tags not included are removed. Read the current tags first with ncloud_datacatalog_get_database (includeTags=true).",
    {
      catalogId: z.number({ required_error: requiredError("catalogId") }).describe("Catalog ID"),
      databaseName: z.string({ required_error: requiredError("databaseName") }).describe("Database name"),
      tagKeyTypeValueList: z
        .array(TAG_ITEM_SCHEMA)
        .describe("Full replacement tag list. Every existing tag not present here is deleted"),
    },
    async (params) => {
      return client.requestRaw(
        "PUT",
        `${dbPath(params.catalogId, params.databaseName)}/tag`,
        undefined,
        { tagKeyTypeValueList: params.tagKeyTypeValueList }
      );
    }
  );

  // ─── Table ───────────────────────────────────────────────────────────

  defineTool(
    server,
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
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datacatalog_get_tables_by_database",
    "Get table list in a specific database",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
    },
    async (params) => {
      const queryParams: Record<string, string | number | boolean | undefined> = {};
      if (params.pageNo) queryParams.pageNo = params.pageNo;
      if (params.pageSize) queryParams.pageSize = params.pageSize;
      const result = await client.requestRaw(
        "GET", `${dbPath(params.catalogId, params.databaseName)}/tables`, queryParams
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datacatalog_get_table",
    "Get table detail information including properties",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name"),
      tableName: z.string().describe("Table name"),
    },
    async (params) => {
      return client.requestRaw(
          "GET", `${tablePath(params.catalogId, params.databaseName, params.tableName)}`
        );
    }
  );

  defineTool(
    server,
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
      const queryParams: Record<string, string | number | boolean | undefined> = {};
      if (params.pageNo) queryParams.pageNo = params.pageNo;
      if (params.pageSize) queryParams.pageSize = params.pageSize;
      const result = await client.requestRaw(
        "GET", `${tablePath(params.catalogId, params.databaseName, params.tableName)}/schema`, queryParams
      );
      return result;
    }
  );

  defineTool(
    server,
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
      const queryParams: Record<string, string | number | boolean | undefined> = {};
      if (params.pageNo) queryParams.pageNo = params.pageNo;
      if (params.pageSize) queryParams.pageSize = params.pageSize;
      const result = await client.requestRaw(
        "GET", `${tablePath(params.catalogId, params.databaseName, params.tableName)}/partitions`, queryParams
      );
      return result;
    }
  );

  defineTool(
    server,
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
      const queryParams: Record<string, string | number | boolean | undefined> = {};
      if (params.pageNo) queryParams.pageNo = params.pageNo;
      if (params.pageSize) queryParams.pageSize = params.pageSize;
      const result = await client.requestRaw(
        "GET", `${tablePath(params.catalogId, params.databaseName, params.tableName)}/partition-keys`, queryParams
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datacatalog_get_table_properties",
    "Get table detailed properties",
    {
      catalogId: z.number().describe("Catalog ID"),
      databaseName: z.string().describe("Database name"),
      tableName: z.string().describe("Table name"),
    },
    async (params) => {
      return client.requestRaw(
          "GET", `${tablePath(params.catalogId, params.databaseName, params.tableName)}/properties`
        );
    }
  );

  defineTool(
    server,
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
      const queryParams: Record<string, string | number | boolean | undefined> = {};
      if (params.pageNo) queryParams.pageNo = params.pageNo;
      if (params.pageSize) queryParams.pageSize = params.pageSize;
      const result = await client.requestRaw(
        "GET", `${tablePath(params.catalogId, params.databaseName, params.tableName)}/schema-and-partition-keys`, queryParams
      );
      return result;
    }
  );

  defineTool(
    server,
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
      const queryParams: Record<string, string | number | boolean | undefined> = {};
      if (params.pageNo) queryParams.pageNo = params.pageNo;
      if (params.pageSize) queryParams.pageSize = params.pageSize;
      const result = await client.requestRaw(
        "GET", `${tablePath(params.catalogId, params.databaseName, params.tableName)}/schema-versions`, queryParams
      );
      return result;
    }
  );

  defineTool(
    server,
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
      const queryParams: Record<string, string | number | boolean | undefined> = {};
      if (params.pageNo) queryParams.pageNo = params.pageNo;
      if (params.pageSize) queryParams.pageSize = params.pageSize;
      const result = await client.requestRaw(
        "GET", `${tablePath(params.catalogId, params.databaseName, params.tableName)}/schema/${params.versionId}`, queryParams
      );
      return result;
    }
  );

  defineTool(
    server,
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
      const queryParams: Record<string, string | number | boolean | undefined> = {};
      if (params.pageNo) queryParams.pageNo = params.pageNo;
      if (params.pageSize) queryParams.pageSize = params.pageSize;
      const result = await client.requestRaw(
        "GET", `${tablePath(params.catalogId, params.databaseName, params.tableName)}/tags`, queryParams
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datacatalog_update_table_schema",
    "⚠️ Replaces the table's ENTIRE column schema with the list given — columns not included are removed. This is the only way to correct a column type a scanner inferred wrongly. Read the current schema first with ncloud_datacatalog_get_table_schema.",
    {
      catalogId: z.number({ required_error: requiredError("catalogId") }).describe("Catalog ID"),
      databaseName: z.string({ required_error: requiredError("databaseName") }).describe("Database name"),
      tableName: z.string({ required_error: requiredError("tableName") }).describe("Table name"),
      columns: z
        .array(
          z.object({
            name: z.string().describe("Column name (1-256 chars)"),
            type: z.string().describe("Column data type (e.g. string, int, bigint, double, boolean, timestamp)"),
            typeValue: z.string().optional().describe("Detailed definition for a complex type (array, struct, map)"),
            description: z.string().optional().describe("Column description (max 512 chars)"),
          })
        )
        .min(1, { message: L({ ko: "columns는 최소 1개 이상이어야 합니다(전달한 목록으로 스키마 전체가 대체됩니다).", en: "columns must contain at least one entry (the list replaces the whole schema)." }) })
        .describe("Full replacement column list, in the desired column order"),
    },
    async (params) => {
      return client.requestRaw(
        "PUT",
        `${tablePath(params.catalogId, params.databaseName, params.tableName)}/schema`,
        undefined,
        { columns: params.columns }
      );
    }
  );

  defineTool(
    server,
    "ncloud_datacatalog_update_table_tag",
    "⚠️ Replaces ALL tags on a table with the list given — tags not included are removed (an empty list clears every tag). Read the current tags first with ncloud_datacatalog_get_table_tags.",
    {
      catalogId: z.number({ required_error: requiredError("catalogId") }).describe("Catalog ID"),
      databaseName: z.string({ required_error: requiredError("databaseName") }).describe("Database name"),
      tableName: z.string({ required_error: requiredError("tableName") }).describe("Table name"),
      tagKeyTypeValueList: z
        .array(TAG_ITEM_SCHEMA)
        .describe("Full replacement tag list. Every existing tag not present here is deleted; pass [] to remove all tags"),
    },
    async (params) => {
      return client.requestRaw(
        "PUT",
        `${tablePath(params.catalogId, params.databaseName, params.tableName)}/tag`,
        undefined,
        { tagKeyTypeValueList: params.tagKeyTypeValueList }
      );
    }
  );

  // ─── Scanner ─────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_datacatalog_create_scanner",
    "Create a scanner that registers a data source as catalog tables — the standard path for exposing Object Storage or Iceberg data (and Cloud DB / JDBC sources) as queryable tables. Creating a scanner does not scan: run it with ncloud_datacatalog_run_scanner (or set scheduleType=CRON). Use dryRun=true to preview without creating.",
    {
      catalogId: z.number({ required_error: requiredError("catalogId") }).describe("Catalog ID (from getCatalogs)"),
      name: z.string({ required_error: requiredError("name") }).describe("Scanner name"),
      type: z
        .enum(["OBJECT_STORAGE", "ICEBERG", "CLOUD_DB_FOR_MYSQL", "CLOUD_DB_FOR_MSSQL", "CLOUD_DB_FOR_MONGODB", "CLOUD_DB_FOR_POSTGRESQL", "JDBC"])
        .describe("Data source type. OBJECT_STORAGE / ICEBERG require location; the Cloud DB types and JDBC require connectionId"),
      databaseName: z.string({ required_error: requiredError("databaseName") }).describe("Output database name — where the scanned tables are created"),
      scheduleType: z.enum(["ON_DEMAND", "CRON"]).describe("Run schedule. ON_DEMAND: only when requested, CRON: on a cron schedule (schedule is then required)"),
      opAddType: z
        .enum(["ADD_NEW_COLUMNS_ONLY", "UPDATE_TABLE", "IGNORE_UPDATE"])
        .describe("How to update an existing table when the source schema gains columns. ADD_NEW_COLUMNS_ONLY: add new columns only, UPDATE_TABLE: update the table definition, IGNORE_UPDATE: ignore"),
      location: z.string().optional().describe("Scan path (e.g. 's3a://mybucket/test/'). REQUIRED when type is OBJECT_STORAGE or ICEBERG"),
      connectionId: z.number().optional().describe("Connection ID (see ncloud_datacatalog_get_connections). REQUIRED when type is a Cloud DB type or JDBC"),
      schedule: z.string().optional().describe("Cron expression (e.g. '1 0 * * *'). REQUIRED when scheduleType is CRON"),
      scanFileLimitCnt: z.number().optional().describe("Scan only this many files, 1-100. Omit to scan everything. OBJECT_STORAGE only"),
      includePattern: z.string().optional().describe("Include pattern (e.g. '*.xml')"),
      excludePattern: z.string().optional().describe("Exclude pattern (e.g. '*.csv')"),
      isUseHivePartitionOnly: z.boolean().optional().describe("Recognize Hive-style partitions only"),
      tablePrefixName: z.string().optional().describe("Prefix for the created table names"),
      description: z.string().optional().describe("Scanner description"),
      opDelType: z.enum(["DEL_NO"]).optional().describe("How to update an existing table when source columns disappear. DEL_NO: ignore"),
      maxTableThreshold: z.number().optional().describe("Maximum number of tables the scanner may create"),
      isMergeForce: z.boolean().optional().describe("Force table merging"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the scanner"),
    },
    async (params) => {
      const needsLocation = params.type === "OBJECT_STORAGE" || params.type === "ICEBERG";
      if (needsLocation && params.location === undefined) {
        return {
          content: [{
            type: "text" as const,
            text: L({
              ko: `type이 ${params.type}인 경우 location(스캔 경로)은 필수입니다.`,
              en: `location is required when type is ${params.type}.`,
            }),
          }],
          isError: true,
        };
      }
      if (!needsLocation && params.connectionId === undefined) {
        return {
          content: [{
            type: "text" as const,
            text: L({
              ko: `type이 ${params.type}인 경우 connectionId는 필수입니다(ncloud_datacatalog_get_connections로 조회).`,
              en: `connectionId is required when type is ${params.type} (look it up with ncloud_datacatalog_get_connections).`,
            }),
          }],
          isError: true,
        };
      }
      if (params.scheduleType === "CRON" && params.schedule === undefined) {
        return {
          content: [{
            type: "text" as const,
            text: L({
              ko: "scheduleType이 CRON인 경우 schedule(크론식)은 필수입니다. 예: '1 0 * * *'",
              en: "schedule (a cron expression) is required when scheduleType is CRON. Example: '1 0 * * *'",
            }),
          }],
          isError: true,
        };
      }

      const { dryRun, catalogId, ...rest } = params;
      const bodyParams: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) bodyParams[k] = v;
      }

      if (dryRun) {
        return {
          label: "🔍 Dry-Run Preview: Data Catalog Scanner Creation",
          endpoint: `POST /api/v1/catalogs/${catalogId}/scanners`,
          request: bodyParams,
          note: L({
            ko: "스캐너 생성만으로는 스캔이 실행되지 않습니다 — ncloud_datacatalog_run_scanner로 실행하세요.",
            en: "Creating a scanner does not run a scan — execute it with ncloud_datacatalog_run_scanner.",
          }),
          message: dryRunMessage({ ko: "스캐너", en: "scanner" }),
        };
      }

      return client.requestRaw("POST", `/api/v1/catalogs/${catalogId}/scanners`, undefined, bodyParams);
    }
  );

  defineTool(
    server,
    "ncloud_datacatalog_get_scanners",
    "Get scanner list in a catalog",
    {
      catalogId: z.number().describe("Catalog ID"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
      searchValue: z.string().optional().describe("Search keyword (scanner name or description)"),
    },
    async (params) => {
      const queryParams: Record<string, string | number | boolean | undefined> = {};
      if (params.pageNo) queryParams.pageNo = params.pageNo;
      if (params.pageSize) queryParams.pageSize = params.pageSize;
      if (params.searchValue) queryParams.searchValue = params.searchValue;
      const result = await client.requestRaw(
        "GET", `/api/v1/catalogs/${params.catalogId}/scanners`, queryParams
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datacatalog_get_scanner",
    "Get scanner detail information",
    {
      catalogId: z.number().describe("Catalog ID"),
      scannerId: z.number().describe("Scanner ID (from getScanners)"),
    },
    async (params) => {
      return client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/scanners/${params.scannerId}`
        );
    }
  );

  defineTool(
    server,
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
      const queryParams: Record<string, string | number | boolean | undefined> = {
        fromTimestamp: params.fromTimestamp,
        toTimestamp: params.toTimestamp,
      };
      if (params.pageNo) queryParams.pageNo = params.pageNo;
      if (params.pageSize) queryParams.pageSize = params.pageSize;
      const result = await client.requestRaw(
        "GET", `/api/v1/catalogs/${params.catalogId}/scanners/${params.scannerId}/histories`, queryParams
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datacatalog_run_scanner",
    "Run (execute) a scanner to scan data sources",
    {
      catalogId: z.number().describe("Catalog ID"),
      scannerId: z.number().describe("Scanner ID to run"),
    },
    async (params) => {
      return client.requestRaw(
          "PUT", `/api/v1/catalogs/${params.catalogId}/scanners/${params.scannerId}/run-scanner`
        );
    }
  );

  defineTool(
    server,
    "ncloud_datacatalog_stop_scanner",
    "Stop a running scanner",
    {
      catalogId: z.number().describe("Catalog ID"),
      scannerId: z.number().describe("Scanner ID to stop"),
    },
    async (params) => {
      return client.requestRaw(
          "PUT", `/api/v1/catalogs/${params.catalogId}/scanners/${params.scannerId}/stop-scanner`
        );
    }
  );

  // ─── Connection ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_datacatalog_get_connections",
    "Get connection list in a catalog",
    {
      catalogId: z.number().describe("Catalog ID"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1~200 (default: 20)"),
      searchValue: z.string().optional().describe("Search keyword (connection name or description)"),
    },
    async (params) => {
      const queryParams: Record<string, string | number | boolean | undefined> = {};
      if (params.pageNo) queryParams.pageNo = params.pageNo;
      if (params.pageSize) queryParams.pageSize = params.pageSize;
      if (params.searchValue) queryParams.searchValue = params.searchValue;
      const result = await client.requestRaw(
        "GET", `/api/v1/catalogs/${params.catalogId}/connections`, queryParams
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datacatalog_get_connection",
    "Get connection detail information",
    {
      catalogId: z.number().describe("Catalog ID"),
      connectionId: z.number().describe("Connection ID (from getConnections)"),
    },
    async (params) => {
      return client.requestRaw(
          "GET", `/api/v1/catalogs/${params.catalogId}/connections/${params.connectionId}`
        );
    }
  );
}
