import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

/**
 * Data Query — 서버리스 대화형 쿼리 서비스 (Trino 기반)
 *
 * Base URL: https://kr.dataquery.naverncp.com
 * VPC 환경에서만 이용 가능
 *
 * API 목록:
 * - POST /api/v2/queries         — 쿼리 실행 (동기)
 * - POST /api/v2/queries/async   — 쿼리 비동기 실행
 * - GET  /api/v2/queries/{id}    — 쿼리 결과 조회
 * - GET  /api/v2/queries         — 쿼리 이력 조회
 * - DELETE /api/v2/queries/{id}  — 쿼리 취소
 */

export function registerDataQueryTools(server: McpServer, client: NcloudClient): void {

  // ─── 쿼리 실행 (동기) ────────────────────────────────────────────────

  server.tool(
    "ncloud_dataquery_execute",
    "Execute a SQL query synchronously on Ncloud Data Query (Trino-based serverless query service). Returns results directly with pagination support.",
    {
      query: z.string().describe("SQL query to execute"),
      executionParameters: z.array(z.string()).optional().describe("Query execution parameters (for parameterized queries with '?')"),
      timeout: z.number().min(1).max(60).optional().describe("Query execution timeout in seconds (1-60, default: 20)"),
      isReuse: z.boolean().optional().describe("Whether to reuse cached query results (default: false)"),
      reuseMaxAge: z.number().min(1).max(10080).optional().describe("Max age in minutes for reusing cached results (1-10080, default: 60). Required if isReuse=true"),
      dataSource: z.string().optional().describe("Data source name for query execution"),
      database: z.string().optional().describe("Database name for query execution"),
      projectId: z.number().optional().describe("Project ID for query execution"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          query: params.query,
        };
        if (params.executionParameters) body.executionParameters = params.executionParameters;
        if (params.timeout !== undefined) body.timeout = params.timeout;
        if (params.isReuse !== undefined) body.isReuse = params.isReuse;
        if (params.reuseMaxAge !== undefined) body.reuseMaxAge = params.reuseMaxAge;
        if (params.dataSource) body.dataSource = params.dataSource;
        if (params.database) body.database = params.database;
        if (params.projectId !== undefined) body.projectId = params.projectId;

        const result = await client.postRequest("/api/v2/queries", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── 쿼리 비동기 실행 ────────────────────────────────────────────────

  server.tool(
    "ncloud_dataquery_execute_async",
    "Execute a SQL query asynchronously on Ncloud Data Query. Returns execution ID immediately. Use ncloud_dataquery_get_result to retrieve results.",
    {
      query: z.string().describe("SQL query to execute"),
      executionParameters: z.array(z.string()).optional().describe("Query execution parameters (for parameterized queries with '?')"),
      isReuse: z.boolean().optional().describe("Whether to reuse cached query results (default: false)"),
      reuseMaxAge: z.number().min(1).max(10080).optional().describe("Max age in minutes for reusing cached results (1-10080, default: 60). Required if isReuse=true"),
      dataSource: z.string().optional().describe("Data source name for query execution"),
      database: z.string().optional().describe("Database name for query execution"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          query: params.query,
        };
        if (params.executionParameters) body.executionParameters = params.executionParameters;
        if (params.isReuse !== undefined) body.isReuse = params.isReuse;
        if (params.reuseMaxAge !== undefined) body.reuseMaxAge = params.reuseMaxAge;
        if (params.dataSource) body.dataSource = params.dataSource;
        if (params.database) body.database = params.database;

        const result = await client.postRequest("/api/v2/queries/async", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── 쿼리 결과 조회 ─────────────────────────────────────────────────

  server.tool(
    "ncloud_dataquery_get_result",
    "Get query execution result by execution ID. Supports pagination with offset. Use after async query execution or to fetch next page of sync query results.",
    {
      executionId: z.string().describe("Query execution ID (returned from execute or execute_async)"),
      offset: z.number().optional().describe("Offset for pagination (default: 0)"),
      pageSize: z.number().min(1).max(1000).optional().describe("Number of rows per page (1-1000, default: 100)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.offset !== undefined) queryParams.offset = params.offset;
        if (params.pageSize !== undefined) queryParams.pageSize = params.pageSize;

        const result = await client.requestRaw(
          "GET", `/api/v2/queries/${params.executionId}`, queryParams
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── 쿼리 이력 조회 ─────────────────────────────────────────────────

  server.tool(
    "ncloud_dataquery_list_queries",
    "List query execution history on Ncloud Data Query with optional status filtering and pagination.",
    {
      status: z.enum(["QUEUED", "STARTING", "RUNNING", "FINISHED", "FAILED", "CANCELED"]).optional()
        .describe("Filter by query status"),
      pageNo: z.number().min(1).optional().describe("Page number (default: 1)"),
      pageSize: z.number().min(1).max(500).optional().describe("Items per page (1-500, default: 20)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.status) queryParams.status = params.status;
        if (params.pageNo !== undefined) queryParams.pageNo = params.pageNo;
        if (params.pageSize !== undefined) queryParams.pageSize = params.pageSize;

        const result = await client.requestRaw(
          "GET", "/api/v2/queries", queryParams
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── 쿼리 취소 ──────────────────────────────────────────────────────

  server.tool(
    "ncloud_dataquery_cancel",
    "⚠️ Destructive: Cancel a running query execution on Ncloud Data Query. The query will be terminated and partial results may be lost.",
    {
      executionId: z.string().min(1).describe("Query execution ID to cancel (required)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute cancellation"),
    },
    async (params) => {
      try {
        if (!params.executionId) {
          return { content: [{ type: "text" as const, text: "Error: executionId is required." }], isError: true };
        }
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text:
            `⚠️ This will cancel query execution [${params.executionId}]. Partial results may be lost.\n\nTo execute, call again with confirm=true.`
          }] };
        }
        const result = await client.deleteRequest(`/api/v2/queries/${params.executionId}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
