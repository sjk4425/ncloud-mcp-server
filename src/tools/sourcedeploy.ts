import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

export function registerSourceDeployTools(server: McpServer, client: NcloudClient): void {
  // ─── Project Tools ─────────────────────────────────────────────────────────

  server.tool(
    "ncloud_sourcedeploy_list_projects",
    "List all SourceDeploy deployment projects with optional name filter",
    {
      projectName: z.string().optional().describe("Filter by project name (partial match)"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Number of items per page (default: 100, max: 100)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.projectName) queryParams.projectName = params.projectName;
        if (params.pageNo !== undefined) queryParams.pageNo = String(params.pageNo);
        if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);
        const result = await client.requestRaw("GET", "/api/v1/project", queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_create_project",
    "Create a new SourceDeploy deployment project. Use dryRun=true to preview without creating.",
    {
      name: z.string().describe("Project name (1-100 chars: letters, numbers, '-', '_')"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: SourceDeploy Project Creation",
            projectName: params.name,
            message: "이 요청은 실제 배포 프로젝트를 생성하지 않습니다. dryRun=false로 호출하면 프로젝트가 생성됩니다.",
          };
          return toolText(preview);
        }
        const result = await client.requestRaw("POST", "/api/v1/project", undefined, { name: params.name });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  server.tool(
    "ncloud_sourcedeploy_delete_project",
    "⚠️ Destructive: Permanently delete a SourceDeploy project. All stages, scenarios, and history will be removed. Set confirm=true to execute.",
    {
      projectId: z.string().describe("ID of the deployment project to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text: `⚠️ This will permanently delete SourceDeploy Project [${params.projectId}]. All stages, scenarios, and deployment history will be removed.\n\nTo execute, call this tool again with confirm=true.` }] };
        }
        const result = await client.deleteRequest(`/api/v1/project/${encodeURIComponent(params.projectId)}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Stage Tools ───────────────────────────────────────────────────────────

  server.tool(
    "ncloud_sourcedeploy_list_stages",
    "List all deployment stages in a SourceDeploy project",
    {
      projectId: z.string().describe("ID of the deployment project"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_get_stage",
    "Get detailed information about a specific deployment stage",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  server.tool(
    "ncloud_sourcedeploy_create_stage",
    "Create a new deployment stage in a SourceDeploy project",
    {
      projectId: z.string().describe("ID of the deployment project"),
      name: z.string().describe("Stage name (up to 100 chars: letters, numbers, '-', '_')"),
      type: z.enum(["Server", "AutoScalingGroup", "KubernetesService", "ObjectStorage"]).describe("Deployment target type"),
      config: z.record(z.any()).describe("Deployment target config. Server: {serverNo: [number[]]}. AutoScalingGroup: {autoScalingGroupNo: number}. KubernetesService: {clusterNo: number}. ObjectStorage: {bucketName: string}"),
    },
    async (params) => {
      try {
        const body = { name: params.name, type: params.type, config: params.config };
        const result = await client.requestRaw("POST", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage`, undefined, body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_edit_stage",
    "Edit deployment stage settings (name, type, or config)",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
      name: z.string().optional().describe("New stage name"),
      type: z.enum(["Server", "AutoScalingGroup", "KubernetesService", "ObjectStorage"]).optional().describe("New deployment target type"),
      config: z.record(z.any()).optional().describe("New deployment target config"),
    },
    async (params) => {
      try {
        const body: Record<string, any> = {};
        if (params.name) body.name = params.name;
        if (params.type) body.type = params.type;
        if (params.config) body.config = params.config;
        const result = await client.requestRaw("PATCH", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}`, undefined, body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  server.tool(
    "ncloud_sourcedeploy_delete_stage",
    "⚠️ Destructive: Delete a deployment stage from a SourceDeploy project. Set confirm=true to execute.",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text: `⚠️ This will permanently delete Stage [${params.stageId}] from Project [${params.projectId}]. All scenarios in this stage will also be removed.\n\nTo execute, call this tool again with confirm=true.` }] };
        }
        const result = await client.deleteRequest(`/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Scenario Tools ────────────────────────────────────────────────────────

  server.tool(
    "ncloud_sourcedeploy_list_scenarios",
    "List all deployment scenarios in a SourceDeploy project stage",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}/scenario`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_get_scenario",
    "Get detailed information about a specific deployment scenario",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
      scenarioId: z.string().describe("ID of the deployment scenario"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}/scenario/${encodeURIComponent(params.scenarioId)}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  server.tool(
    "ncloud_sourcedeploy_create_scenario",
    "Create a new deployment scenario in a stage",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
      name: z.string().describe("Scenario name"),
      config: z.record(z.any()).describe("Scenario configuration (source, deployment strategy, commands, etc.)"),
    },
    async (params) => {
      try {
        const body = { name: params.name, ...params.config };
        const result = await client.requestRaw("POST", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}/scenario`, undefined, body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_edit_scenario",
    "Edit deployment scenario settings",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
      scenarioId: z.string().describe("ID of the deployment scenario"),
      config: z.record(z.any()).describe("Updated scenario configuration"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("PATCH", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}/scenario/${encodeURIComponent(params.scenarioId)}`, undefined, params.config);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  server.tool(
    "ncloud_sourcedeploy_delete_scenario",
    "⚠️ Destructive: Delete a deployment scenario. Set confirm=true to execute.",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
      scenarioId: z.string().describe("ID of the deployment scenario to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text: `⚠️ This will permanently delete Scenario [${params.scenarioId}] from Stage [${params.stageId}].\n\nTo execute, call this tool again with confirm=true.` }] };
        }
        const result = await client.deleteRequest(`/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}/scenario/${encodeURIComponent(params.scenarioId)}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Deployment Execution Tools ────────────────────────────────────────────

  server.tool(
    "ncloud_sourcedeploy_start_deploy",
    "Start a deployment for a specific scenario",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
      scenarioId: z.string().describe("ID of the deployment scenario to execute"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}/scenario/${encodeURIComponent(params.scenarioId)}/deploy`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_cancel_deploy",
    "Cancel an ongoing SourceDeploy deployment",
    {
      projectId: z.string().describe("ID of the deployment project"),
      historyId: z.string().describe("Job result ID (from deployment history)"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/api/v1/project/${encodeURIComponent(params.projectId)}/history/${encodeURIComponent(params.historyId)}/cancel`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Deployment Approval Tools ─────────────────────────────────────────────

  server.tool(
    "ncloud_sourcedeploy_request_deploy_approval",
    "Request approval for a scenario deployment",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
      scenarioId: z.string().describe("ID of the deployment scenario"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}/scenario/${encodeURIComponent(params.scenarioId)}/deploy/request`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_approve_deploy",
    "Approve a scenario deployment request",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
      scenarioId: z.string().describe("ID of the deployment scenario"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}/scenario/${encodeURIComponent(params.scenarioId)}/deploy/accept`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_reject_deploy",
    "Reject a scenario deployment request",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
      scenarioId: z.string().describe("ID of the deployment scenario"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}/scenario/${encodeURIComponent(params.scenarioId)}/deploy/reject`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Deployment History Tools ──────────────────────────────────────────────

  server.tool(
    "ncloud_sourcedeploy_get_deploy_history",
    "Get deployment history list for a project",
    {
      projectId: z.string().describe("ID of the deployment project"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Number of items per page (default: 100, max: 100)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.pageNo !== undefined) queryParams.pageNo = String(params.pageNo);
        if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);
        const result = await client.requestRaw("GET", `/api/v1/project/${encodeURIComponent(params.projectId)}/history`, queryParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_get_deploy_history_detail",
    "Get detailed information about a specific deployment history entry",
    {
      projectId: z.string().describe("ID of the deployment project"),
      historyId: z.string().describe("Job result ID"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/project/${encodeURIComponent(params.projectId)}/history/${encodeURIComponent(params.historyId)}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Canary Deployment Tools ───────────────────────────────────────────────

  server.tool(
    "ncloud_sourcedeploy_approve_canary",
    "Approve a manually analyzed canary version deployment",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
      scenarioId: z.string().describe("ID of the deployment scenario"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}/scenario/${encodeURIComponent(params.scenarioId)}/canary/accept`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_reject_canary",
    "Reject a manually analyzed canary version deployment",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
      scenarioId: z.string().describe("ID of the deployment scenario"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}/scenario/${encodeURIComponent(params.scenarioId)}/canary/reject`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_get_canary_analysis_steps",
    "Get the canary analysis step list for a deployment",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
      scenarioId: z.string().describe("ID of the deployment scenario"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}/scenario/${encodeURIComponent(params.scenarioId)}/canary/analysis`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_get_canary_analysis_report",
    "Get the canary analysis report for a specific step",
    {
      projectId: z.string().describe("ID of the deployment project"),
      stageId: z.string().describe("ID of the deployment stage"),
      scenarioId: z.string().describe("ID of the deployment scenario"),
      stepNo: z.number().describe("Canary analysis step number"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/project/${encodeURIComponent(params.projectId)}/stage/${encodeURIComponent(params.stageId)}/scenario/${encodeURIComponent(params.scenarioId)}/canary/analysis/${params.stepNo}/report`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Resource Query Tools (for stage configuration) ────────────────────────

  server.tool(
    "ncloud_sourcedeploy_get_servers",
    "Get the list of available servers for SourceDeploy stage configuration",
    {},
    async () => {
      try {
        const result = await client.requestRaw("GET", "/api/v1/server");
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_get_autoscaling_groups",
    "Get the list of available Auto Scaling groups for SourceDeploy stage configuration",
    {},
    async () => {
      try {
        const result = await client.requestRaw("GET", "/api/v1/autoscalinggroup");
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_get_k8s_clusters",
    "Get the list of available Kubernetes Service clusters for SourceDeploy stage configuration",
    {},
    async () => {
      try {
        const result = await client.requestRaw("GET", "/api/v1/kubernetesservice");
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_get_objectstorage_buckets",
    "Get the list of available Object Storage buckets for SourceDeploy stage configuration",
    {},
    async () => {
      try {
        const result = await client.requestRaw("GET", "/api/v1/objectstorage");
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_get_objectstorage_objects",
    "Get the list of objects in an Object Storage bucket",
    {
      bucketName: z.string().describe("Name of the Object Storage bucket"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/objectstorage/${encodeURIComponent(params.bucketName)}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  server.tool(
    "ncloud_sourcedeploy_get_sourcecommit_repos",
    "Get the list of available SourceCommit repositories for scenario source configuration",
    {},
    async () => {
      try {
        const result = await client.requestRaw("GET", "/api/v1/sourcecommit");
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_get_sourcecommit_branches",
    "Get the list of branches in a SourceCommit repository",
    {
      repositoryName: z.string().describe("Name of the SourceCommit repository"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/sourcecommit/${encodeURIComponent(params.repositoryName)}/branch`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_get_sourcebuild_projects",
    "Get the list of available SourceBuild projects for scenario source configuration",
    {},
    async () => {
      try {
        const result = await client.requestRaw("GET", "/api/v1/sourcebuild");
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_sourcedeploy_get_target_groups",
    "Get the list of load balancer target groups connected to an Auto Scaling group",
    {
      autoScalingGroupNo: z.number().describe("Auto Scaling group number"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/autoscalinggroup/${params.autoScalingGroupNo}/targetgroup`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
