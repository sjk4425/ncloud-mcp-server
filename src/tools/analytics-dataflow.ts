import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

/**
 * Data Flow API Tools
 *
 * Base URL: https://dataflow.apigw.ntruss.com
 *
 * Data Flow는 대규모 데이터를 추출, 변환, 적재하기 위한 복잡한 워크플로를 구성하고
 * 실행하며, 모니터링할 수 있는 완전 관리형 데이터 통합 서비스입니다.
 *
 * RESTful API (GET/POST/PUT/DELETE with JSON body)
 * VPC 환경에서만 이용 가능
 *
 * 참조: https://api.ncloud-docs.com/docs/analytics-dataflow
 */
export function registerDataFlowTools(
  server: McpServer,
  client: NcloudClient
): void {
  // ═══════════════════════════════════════════════════════════════════════════
  // Dashboard APIs
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "ncloud_dataflow_get_execution_interval",
    "Get job execution count statistics for Data Flow dashboard. Returns execution counts grouped by time interval.",
    {
      startTime: z.string().optional().describe("Start time for query range (ISO 8601 format, e.g. 2024-01-01T00:00:00Z)"),
      endTime: z.string().optional().describe("End time for query range (ISO 8601 format)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.startTime) queryParams.startTime = params.startTime;
        if (params.endTime) queryParams.endTime = params.endTime;
        const result = await client.requestRaw("GET", "/api/v1/dashboard/execution-interval", Object.keys(queryParams).length > 0 ? queryParams : undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_get_execution_result",
    "Get job execution result statistics (execution count, success count, failure count) for Data Flow dashboard.",
    {
      startTime: z.string().optional().describe("Start time for query range (ISO 8601 format)"),
      endTime: z.string().optional().describe("End time for query range (ISO 8601 format)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.startTime) queryParams.startTime = params.startTime;
        if (params.endTime) queryParams.endTime = params.endTime;
        const result = await client.requestRaw("GET", "/api/v1/dashboard/execution-result", Object.keys(queryParams).length > 0 ? queryParams : undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_get_execution_times",
    "Get job execution time statistics for Data Flow dashboard.",
    {
      startTime: z.string().optional().describe("Start time for query range (ISO 8601 format)"),
      endTime: z.string().optional().describe("End time for query range (ISO 8601 format)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.startTime) queryParams.startTime = params.startTime;
        if (params.endTime) queryParams.endTime = params.endTime;
        const result = await client.requestRaw("GET", "/api/v1/dashboard/execution-times", Object.keys(queryParams).length > 0 ? queryParams : undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Workflow APIs
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "ncloud_dataflow_list_workflows",
    "List all workflows in the Data Flow service. Workflows define the data pipeline structure with nodes and edges.",
    {
      page: z.number().optional().describe("Page number (0-based)"),
      size: z.number().optional().describe("Page size"),
      searchText: z.string().optional().describe("Search by workflow name or description"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number> = {};
        if (params.page !== undefined) queryParams.page = params.page;
        if (params.size !== undefined) queryParams.size = params.size;
        if (params.searchText) queryParams.searchText = params.searchText;
        const result = await client.requestRaw("GET", "/api/v1/workflows", Object.keys(queryParams).length > 0 ? queryParams : undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_get_workflow",
    "Get detailed information of a specific Data Flow workflow by ID.",
    {
      workflowId: z.string().describe("Workflow ID to query"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/workflows/${params.workflowId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_create_workflow",
    "Create a new Data Flow workflow. A workflow defines the data pipeline with nodes (source, filter, sink) and edges connecting them.",
    {
      name: z.string().describe("Workflow name"),
      description: z.string().optional().describe("Workflow description"),
      nodes: z.array(z.object({
        id: z.string().describe("Node ID (unique within workflow)"),
        type: z.string().describe("Node type (e.g. SOURCE, FILTER, SINK)"),
        name: z.string().describe("Node name"),
        properties: z.record(z.any()).optional().describe("Node-specific properties"),
      })).optional().describe("List of nodes in the workflow"),
      edges: z.array(z.object({
        from: z.string().describe("Source node ID"),
        to: z.string().describe("Target node ID"),
      })).optional().describe("List of edges connecting nodes"),
      dryRun: z.boolean().optional().default(false).describe("If true, preview without creating"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "Dry-Run Preview: Data Flow Workflow Creation",
            name: params.name,
            description: params.description ?? "(not set)",
            nodeCount: params.nodes?.length ?? 0,
            edgeCount: params.edges?.length ?? 0,
            message: "dryRun=false로 호출하면 워크플로가 생성됩니다.",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }
        const body: Record<string, any> = { name: params.name };
        if (params.description !== undefined) body.description = params.description;
        if (params.nodes !== undefined) body.nodes = params.nodes;
        if (params.edges !== undefined) body.edges = params.edges;
        const result = await client.requestRaw("POST", "/api/v1/workflows", undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_update_workflow",
    "Update an existing Data Flow workflow.",
    {
      workflowId: z.string().describe("Workflow ID to update"),
      name: z.string().optional().describe("New workflow name"),
      description: z.string().optional().describe("New workflow description"),
      nodes: z.array(z.object({
        id: z.string().describe("Node ID"),
        type: z.string().describe("Node type"),
        name: z.string().describe("Node name"),
        properties: z.record(z.any()).optional().describe("Node-specific properties"),
      })).optional().describe("Updated list of nodes"),
      edges: z.array(z.object({
        from: z.string().describe("Source node ID"),
        to: z.string().describe("Target node ID"),
      })).optional().describe("Updated list of edges"),
    },
    async (params) => {
      try {
        const { workflowId, ...bodyParams } = params;
        const body: Record<string, any> = {};
        if (bodyParams.name !== undefined) body.name = bodyParams.name;
        if (bodyParams.description !== undefined) body.description = bodyParams.description;
        if (bodyParams.nodes !== undefined) body.nodes = bodyParams.nodes;
        if (bodyParams.edges !== undefined) body.edges = bodyParams.edges;
        const result = await client.requestRaw("PUT", `/api/v1/workflows/${workflowId}`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_delete_workflow",
    "⚠️ Destructive: Delete a Data Flow workflow permanently. Set confirm=true to execute.",
    {
      workflowId: z.string().describe("Workflow ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text: `⚠️ This will permanently delete workflow [${params.workflowId}].\nTo execute, call again with confirm=true.` }] };
        }
        const result = await client.requestRaw("DELETE", `/api/v1/workflows/${params.workflowId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result ?? { success: true }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_get_workflow_executions",
    "Get execution history of a specific Data Flow workflow.",
    {
      workflowId: z.string().describe("Workflow ID to query executions"),
      page: z.number().optional().describe("Page number (0-based)"),
      size: z.number().optional().describe("Page size"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number> = {};
        if (params.page !== undefined) queryParams.page = params.page;
        if (params.size !== undefined) queryParams.size = params.size;
        const result = await client.requestRaw("GET", `/api/v1/workflows/${params.workflowId}/executions`, Object.keys(queryParams).length > 0 ? queryParams : undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Job APIs
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "ncloud_dataflow_list_jobs",
    "List all jobs in the Data Flow service. Jobs are executable units within workflows.",
    {
      page: z.number().optional().describe("Page number (0-based)"),
      size: z.number().optional().describe("Page size"),
      searchText: z.string().optional().describe("Search by job name or description"),
      status: z.string().optional().describe("Filter by job status"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number> = {};
        if (params.page !== undefined) queryParams.page = params.page;
        if (params.size !== undefined) queryParams.size = params.size;
        if (params.searchText) queryParams.searchText = params.searchText;
        if (params.status) queryParams.status = params.status;
        const result = await client.requestRaw("GET", "/api/v1/jobs", Object.keys(queryParams).length > 0 ? queryParams : undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_get_job",
    "Get detailed information of a specific Data Flow job by ID.",
    {
      jobId: z.string().describe("Job ID to query"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/jobs/${params.jobId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_create_job",
    "Create a new Data Flow job. A job defines the execution configuration for a workflow.",
    {
      name: z.string().describe("Job name"),
      description: z.string().optional().describe("Job description"),
      workflowId: z.string().optional().describe("Associated workflow ID"),
      options: z.record(z.any()).optional().describe("Job execution options (e.g. resource spec, parallelism)"),
      dryRun: z.boolean().optional().default(false).describe("If true, preview without creating"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "Dry-Run Preview: Data Flow Job Creation",
            name: params.name,
            description: params.description ?? "(not set)",
            workflowId: params.workflowId ?? "(not set)",
            options: params.options ?? {},
            message: "dryRun=false로 호출하면 작업이 생성됩니다.",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }
        const body: Record<string, any> = { name: params.name };
        if (params.description !== undefined) body.description = params.description;
        if (params.workflowId !== undefined) body.workflowId = params.workflowId;
        if (params.options !== undefined) body.options = params.options;
        const result = await client.requestRaw("POST", "/api/v1/jobs", undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_update_job",
    "Update an existing Data Flow job configuration.",
    {
      jobId: z.string().describe("Job ID to update"),
      name: z.string().optional().describe("New job name"),
      description: z.string().optional().describe("New job description"),
      workflowId: z.string().optional().describe("New associated workflow ID"),
      options: z.record(z.any()).optional().describe("Updated job execution options"),
    },
    async (params) => {
      try {
        const { jobId, ...bodyParams } = params;
        const body: Record<string, any> = {};
        if (bodyParams.name !== undefined) body.name = bodyParams.name;
        if (bodyParams.description !== undefined) body.description = bodyParams.description;
        if (bodyParams.workflowId !== undefined) body.workflowId = bodyParams.workflowId;
        if (bodyParams.options !== undefined) body.options = bodyParams.options;
        const result = await client.requestRaw("PUT", `/api/v1/jobs/${jobId}`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_verify_job",
    "Verify (validate) a Data Flow job's execution request items before running. Checks if the job configuration is valid.",
    {
      jobId: z.string().describe("Job ID to verify"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/api/v1/jobs/${params.jobId}/verify`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_execute_job",
    "Execute a Data Flow job. Starts the data pipeline processing.",
    {
      jobId: z.string().describe("Job ID to execute"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/api/v1/jobs/${params.jobId}/execute`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_get_job_executions",
    "Get execution history of a specific Data Flow job.",
    {
      jobId: z.string().describe("Job ID to query executions"),
      page: z.number().optional().describe("Page number (0-based)"),
      size: z.number().optional().describe("Page size"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number> = {};
        if (params.page !== undefined) queryParams.page = params.page;
        if (params.size !== undefined) queryParams.size = params.size;
        const result = await client.requestRaw("GET", `/api/v1/jobs/${params.jobId}/executions`, Object.keys(queryParams).length > 0 ? queryParams : undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_get_job_execution",
    "Get detailed information of a specific Data Flow job execution.",
    {
      jobId: z.string().describe("Job ID"),
      executionId: z.string().describe("Execution ID to query"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/jobs/${params.jobId}/executions/${params.executionId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_update_job_execute_config",
    "Update the execution configuration (options) of a Data Flow job.",
    {
      jobId: z.string().describe("Job ID to update execution config"),
      options: z.record(z.any()).describe("Execution options to update (e.g. resource spec, parallelism, timeout)"),
    },
    async (params) => {
      try {
        const body = { options: params.options };
        const result = await client.requestRaw("PUT", `/api/v1/jobs/${params.jobId}/execute-config`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_delete_job",
    "⚠️ Destructive: Delete a Data Flow job permanently. Set confirm=true to execute.",
    {
      jobId: z.string().describe("Job ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text: `⚠️ This will permanently delete job [${params.jobId}].\nTo execute, call again with confirm=true.` }] };
        }
        const result = await client.requestRaw("DELETE", `/api/v1/jobs/${params.jobId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result ?? { success: true }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Trigger APIs
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "ncloud_dataflow_list_triggers",
    "List all triggers in the Data Flow service. Triggers define scheduled or event-based job execution.",
    {
      page: z.number().optional().describe("Page number (0-based)"),
      size: z.number().optional().describe("Page size"),
      searchText: z.string().optional().describe("Search by trigger name or description"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number> = {};
        if (params.page !== undefined) queryParams.page = params.page;
        if (params.size !== undefined) queryParams.size = params.size;
        if (params.searchText) queryParams.searchText = params.searchText;
        const result = await client.requestRaw("GET", "/api/v1/triggers", Object.keys(queryParams).length > 0 ? queryParams : undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_get_trigger",
    "Get detailed information of a specific Data Flow trigger.",
    {
      triggerId: z.string().describe("Trigger ID to query"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/triggers/${params.triggerId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_create_trigger",
    "Create a new Data Flow trigger for scheduled or event-based job execution.",
    {
      name: z.string().describe("Trigger name"),
      description: z.string().optional().describe("Trigger description"),
      jobId: z.string().describe("Job ID to associate with this trigger"),
      type: z.string().optional().describe("Trigger type (e.g. CRON, EVENT)"),
      schedule: z.string().optional().describe("Cron expression for scheduled triggers (e.g. '0 0 * * *')"),
      enabled: z.boolean().optional().describe("Whether the trigger is enabled (default: true)"),
      dryRun: z.boolean().optional().default(false).describe("If true, preview without creating"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "Dry-Run Preview: Data Flow Trigger Creation",
            name: params.name,
            description: params.description ?? "(not set)",
            jobId: params.jobId,
            type: params.type ?? "(not set)",
            schedule: params.schedule ?? "(not set)",
            enabled: params.enabled ?? true,
            message: "dryRun=false로 호출하면 트리거가 생성됩니다.",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }
        const body: Record<string, any> = {
          name: params.name,
          jobId: params.jobId,
        };
        if (params.description !== undefined) body.description = params.description;
        if (params.type !== undefined) body.type = params.type;
        if (params.schedule !== undefined) body.schedule = params.schedule;
        if (params.enabled !== undefined) body.enabled = params.enabled;
        const result = await client.requestRaw("POST", "/api/v1/triggers", undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataflow_delete_trigger",
    "⚠️ Destructive: Delete a Data Flow trigger permanently. Set confirm=true to execute.",
    {
      triggerId: z.string().describe("Trigger ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text: `⚠️ This will permanently delete trigger [${params.triggerId}].\nTo execute, call again with confirm=true.` }] };
        }
        const result = await client.requestRaw("DELETE", `/api/v1/triggers/${params.triggerId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result ?? { success: true }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
