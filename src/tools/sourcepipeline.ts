import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

/**
 * SourcePipeline API
 * Base URL: https://vpcsourcepipeline.apigw.ntruss.com (VPC)
 *           https://sourcepipeline.apigw.ntruss.com (Classic)
 *
 * RESTful JSON API — responseFormatType 불필요
 * 인증: x-ncp-apigw-timestamp, x-ncp-iam-access-key, x-ncp-apigw-signature-v2
 * 리전: x-ncp-region_code 헤더 (선택, 기본값 KR)
 */
export function registerSourcePipelineTools(server: McpServer, client: NcloudClient): void {
  // ─── Pipeline CRUD ──────────────────────────────────────────────────────────

  server.tool(
    "ncloud_list_pipelines",
    "List SourcePipeline pipelines with optional pagination and name search",
    {
      pageNo: z.number().optional().describe("Page number (1~N, required if pageSize is set)"),
      pageSize: z.number().optional().describe("Items per page (1~N, required if pageNo is set)"),
      projectName: z.string().optional().describe("Filter by pipeline name (partial match)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.pageNo !== undefined) queryParams.pageNo = String(params.pageNo);
        if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);
        if (params.projectName) queryParams.projectName = params.projectName;
        const result = await client.requestRaw("GET", "/api/v1/project", queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_pipeline",
    "Get detailed information about a specific SourcePipeline pipeline including tasks and triggers",
    {
      projectId: z.number().describe("Pipeline ID (from ncloud_list_pipelines)"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/project/${params.projectId}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_create_pipeline",
    "Create a new SourcePipeline pipeline with tasks and optional triggers",
    {
      name: z.string().describe("Pipeline name (1-30 chars, alphanumeric + '-' and '_')"),
      description: z.string().optional().describe("Pipeline description"),
      tasks: z.array(z.object({
        name: z.string().describe("Task name (1-50 chars, alphanumeric + '-' and '_')"),
        type: z.enum(["SourceBuild", "SourceDeploy"]).describe("Task type"),
        config: z.object({
          projectId: z.number().describe("Project ID (SourceBuild or SourceDeploy project)"),
          stageId: z.number().optional().describe("Deploy stage ID (required if type is SourceDeploy)"),
          scenarioId: z.number().optional().describe("Deploy scenario ID (required if type is SourceDeploy)"),
          target: z.object({
            info: z.object({
              branch: z.string().optional().describe("Branch name (for SourceBuild tasks)"),
            }).optional(),
          }).optional(),
        }),
        linkedTasks: z.array(z.string()).describe("Preceding task names (empty array [] if none)"),
      })).describe("Task list (at least one task required)"),
      trigger: z.object({
        repository: z.array(z.object({
          type: z.string().describe("Repository type (sourcecommit)"),
          name: z.string().describe("Repository name"),
          branch: z.string().describe("Branch name"),
        })).optional().describe("Push trigger settings"),
        sourcepipeline: z.array(z.object({
          id: z.number().describe("Pipeline ID to trigger from"),
        })).optional().describe("Pipeline trigger settings"),
        schedule: z.array(z.object({
          day: z.array(z.string()).describe("Days of week (MON|TUE|WED|THU|FRI|SAT|SUN)"),
          time: z.string().describe("Execution time in HH:mm format (24h)"),
          timeZone: z.string().describe("Timezone (from ncloud_get_pipeline_timezones)"),
          scheduleOnlyWithChange: z.boolean().describe("Run only when source changed (true/false)"),
        })).optional().describe("Schedule trigger settings"),
      }).optional().describe("Trigger configuration"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns preview without creating"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: SourcePipeline Creation",
            name: params.name,
            description: params.description ?? "(none)",
            taskCount: params.tasks.length,
            tasks: params.tasks.map(t => ({ name: t.name, type: t.type })),
            trigger: params.trigger ?? "(none)",
            message: "dryRun=false로 호출하면 실제 파이프라인이 생성됩니다.",
          };
          return toolText(preview);
        }

        const body: Record<string, unknown> = {
          name: params.name,
          tasks: params.tasks,
        };
        if (params.description) body.description = params.description;
        if (params.trigger) body.trigger = params.trigger;

        const result = await client.requestRaw("POST", "/api/v1/project", undefined, body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_update_pipeline",
    "Update an existing SourcePipeline pipeline (tasks and triggers)",
    {
      projectId: z.number().describe("Pipeline ID to update"),
      description: z.string().optional().describe("Pipeline description"),
      tasks: z.array(z.object({
        name: z.string().describe("Task name (1-50 chars, alphanumeric + '-' and '_')"),
        type: z.enum(["SourceBuild", "SourceDeploy"]).describe("Task type"),
        config: z.object({
          projectId: z.number().describe("Project ID (SourceBuild or SourceDeploy project)"),
          stageId: z.number().optional().describe("Deploy stage ID (required if type is SourceDeploy)"),
          scenarioId: z.number().optional().describe("Deploy scenario ID (required if type is SourceDeploy)"),
          target: z.object({
            info: z.object({
              branch: z.string().optional().describe("Branch name (for SourceBuild tasks)"),
            }).optional(),
          }).optional(),
        }),
        linkedTasks: z.array(z.string()).describe("Preceding task names (empty array [] if none)"),
      })).describe("Updated task list"),
      trigger: z.object({
        repository: z.array(z.object({
          type: z.string().describe("Repository type (sourcecommit)"),
          name: z.string().describe("Repository name"),
          branch: z.string().describe("Branch name"),
        })).optional().describe("Push trigger settings"),
        sourcepipeline: z.array(z.object({
          id: z.number().describe("Pipeline ID to trigger from"),
        })).optional().describe("Pipeline trigger settings"),
        schedule: z.array(z.object({
          day: z.array(z.string()).describe("Days of week (MON|TUE|WED|THU|FRI|SAT|SUN)"),
          time: z.string().describe("Execution time in HH:mm format (24h)"),
          timeZone: z.string().describe("Timezone (from ncloud_get_pipeline_timezones)"),
          scheduleOnlyWithChange: z.boolean().describe("Run only when source changed (true/false)"),
        })).optional().describe("Schedule trigger settings"),
      }).optional().describe("Trigger configuration"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          tasks: params.tasks,
        };
        if (params.description !== undefined) body.description = params.description;
        if (params.trigger) body.trigger = params.trigger;

        const result = await client.requestRaw("PATCH", `/api/v1/project/${params.projectId}`, undefined, body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_delete_pipeline",
    "⚠️ Destructive: Permanently delete a SourcePipeline pipeline. Set confirm=true to execute.",
    {
      projectId: z.number().describe("Pipeline ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete SourcePipeline [${params.projectId}]. All pipeline configuration and execution history will be removed.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.requestRaw("DELETE", `/api/v1/project/${params.projectId}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Pipeline Execution ─────────────────────────────────────────────────────

  server.tool(
    "ncloud_run_pipeline",
    "Execute a SourcePipeline pipeline",
    {
      projectId: z.number().describe("Pipeline ID to run"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/api/v1/project/${params.projectId}/do`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cancel_pipeline",
    "Cancel a running SourcePipeline pipeline execution",
    {
      projectId: z.number().describe("Pipeline ID"),
      historyId: z.number().describe("Execution history ID to cancel (from ncloud_run_pipeline or ncloud_list_pipeline_history)"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/api/v1/project/${params.projectId}/history/${params.historyId}/cancel`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Pipeline History ───────────────────────────────────────────────────────

  server.tool(
    "ncloud_list_pipeline_history",
    "Get execution history list for a SourcePipeline pipeline",
    {
      projectId: z.number().describe("Pipeline ID"),
      pageNo: z.number().optional().describe("Page number (1~N)"),
      pageSize: z.number().optional().describe("Items per page (1~N)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.pageNo !== undefined) queryParams.pageNo = String(params.pageNo);
        if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);
        const result = await client.requestRaw("GET", `/api/v1/project/${params.projectId}/history`, queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_pipeline_history_detail",
    "Get detailed execution history for a specific pipeline run",
    {
      projectId: z.number().describe("Pipeline ID"),
      historyId: z.number().describe("Execution history ID"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/project/${params.projectId}/history/${params.historyId}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Trigger Timezone ───────────────────────────────────────────────────────

  server.tool(
    "ncloud_get_pipeline_timezones",
    "Get available timezones for SourcePipeline schedule triggers",
    {},
    async () => {
      try {
        const result = await client.requestRaw("GET", "/api/v1/trigger/timezone");
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── SourceCommit Integration ───────────────────────────────────────────────

  server.tool(
    "ncloud_pipeline_list_sourcecommit_repos",
    "List available SourceCommit repositories for pipeline configuration",
    {
      pageNo: z.number().optional().describe("Page number (1~N)"),
      pageSize: z.number().optional().describe("Items per page (1~N)"),
      searchWord: z.string().optional().describe("Filter by repository name (partial match)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.pageNo !== undefined) queryParams.pageNo = String(params.pageNo);
        if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);
        if (params.searchWord) queryParams.searchWord = params.searchWord;
        const result = await client.requestRaw("GET", "/api/v1/sourcecommit/repository", queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_pipeline_list_sourcecommit_branches",
    "List branches of a SourceCommit repository for pipeline configuration",
    {
      repositoryName: z.string().describe("SourceCommit repository name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/sourcecommit/repository/${encodeURIComponent(params.repositoryName)}/branch`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── SourceBuild Integration ────────────────────────────────────────────────

  server.tool(
    "ncloud_pipeline_list_sourcebuild_projects",
    "List available SourceBuild projects for pipeline task configuration",
    {
      pageNo: z.number().optional().describe("Page number (1~N)"),
      pageSize: z.number().optional().describe("Items per page (1~N)"),
      searchWord: z.string().optional().describe("Filter by project name (partial match)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.pageNo !== undefined) queryParams.pageNo = String(params.pageNo);
        if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);
        if (params.searchWord) queryParams.searchWord = params.searchWord;
        const result = await client.requestRaw("GET", "/api/v1/sourcebuild/project", queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── SourceDeploy Integration ───────────────────────────────────────────────

  server.tool(
    "ncloud_pipeline_list_sourcedeploy_projects",
    "List available SourceDeploy projects for pipeline task configuration",
    {
      pageNo: z.number().optional().describe("Page number (1~N)"),
      pageSize: z.number().optional().describe("Items per page (1~N)"),
      searchWord: z.string().optional().describe("Filter by project name (partial match)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.pageNo !== undefined) queryParams.pageNo = String(params.pageNo);
        if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);
        if (params.searchWord) queryParams.searchWord = params.searchWord;
        const result = await client.requestRaw("GET", "/api/v1/sourcedeploy/project", queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_pipeline_list_sourcedeploy_stages",
    "List available SourceDeploy stages for a project",
    {
      projectId: z.number().describe("SourceDeploy project ID"),
      pageNo: z.number().optional().describe("Page number (1~N)"),
      pageSize: z.number().optional().describe("Items per page (1~N)"),
      searchWord: z.string().optional().describe("Filter by stage name (partial match)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.pageNo !== undefined) queryParams.pageNo = String(params.pageNo);
        if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);
        if (params.searchWord) queryParams.searchWord = params.searchWord;
        const result = await client.requestRaw("GET", `/api/v1/sourcedeploy/project/${params.projectId}/stage`, queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_pipeline_list_sourcedeploy_scenarios",
    "List available SourceDeploy scenarios for a project stage",
    {
      projectId: z.number().describe("SourceDeploy project ID"),
      stageId: z.number().describe("SourceDeploy stage ID"),
      pageNo: z.number().optional().describe("Page number (1~N)"),
      pageSize: z.number().optional().describe("Items per page (1~N)"),
      searchWord: z.string().optional().describe("Filter by scenario name (partial match)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.pageNo !== undefined) queryParams.pageNo = String(params.pageNo);
        if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);
        if (params.searchWord) queryParams.searchWord = params.searchWord;
        const result = await client.requestRaw("GET", `/api/v1/sourcedeploy/project/${params.projectId}/stage/${params.stageId}/scenario`, queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
