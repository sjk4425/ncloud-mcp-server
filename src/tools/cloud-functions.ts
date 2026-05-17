import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

export function registerCloudFunctionsTools(server: McpServer, client: NcloudClient): void {
  // ─── Package Management Tools ──────────────────────────────────────────────

  // ncloud_functions_list_packages — List all Cloud Functions packages
  server.tool(
    "ncloud_functions_list_packages",
    "List all Cloud Functions packages",
    {
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        const result = await client.requestRaw("GET", "/api/v2/packages", queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_get_package — Get detailed information about a specific package
  server.tool(
    "ncloud_functions_get_package",
    "Get detailed information about a specific package",
    {
      packageName: z.string().describe("Name of the package to retrieve"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        const result = await client.requestRaw(
          "GET",
          `/api/v2/packages/${encodeURIComponent(params.packageName)}`,
          queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_create_package — Create or update a Cloud Functions package
  server.tool(
    "ncloud_functions_create_package",
    "Create or update a Cloud Functions package",
    {
      packageName: z.string().describe("Name of the package to create or update"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
      description: z.string().optional().describe("Description of the package"),
      parameters: z.record(z.unknown()).optional().describe("Default parameters for the package as a JSON object"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        const body: Record<string, unknown> = {};
        if (params.description !== undefined) {
          body.description = params.description;
        }
        if (params.parameters !== undefined) {
          body.parameters = params.parameters;
        }
        const result = await client.requestRaw(
          "PUT",
          `/api/v2/packages/${encodeURIComponent(params.packageName)}`,
          queryParams,
          body
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_delete_package — Permanently delete a Cloud Functions package (destructive)
  server.tool(
    "ncloud_functions_delete_package",
    "\u26a0\ufe0f Destructive: Permanently delete a Cloud Functions package. Set confirm=true to execute.",
    {
      packageName: z.string().describe("Name of the package to delete"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
      confirm: z.boolean().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `\u26a0\ufe0f This will permanently delete Cloud Functions package [${params.packageName}]. All actions within this package will also be removed.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        const result = await client.requestRaw(
          "DELETE",
          `/api/v2/packages/${encodeURIComponent(params.packageName)}`,
          queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Action Management Tools ───────────────────────────────────────────────

  // ncloud_functions_list_actions — List all actions in a package
  server.tool(
    "ncloud_functions_list_actions",
    "List all actions in a package (use '-' for unpackaged actions)",
    {
      packageName: z.string().default("-").describe("Package name (use '-' for unpackaged actions)"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        const result = await client.requestRaw(
          "GET",
          `/api/v2/packages/${encodeURIComponent(params.packageName)}/actions`,
          queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_get_action — Get detailed information about a specific action
  server.tool(
    "ncloud_functions_get_action",
    "Get detailed information about a specific action including source code",
    {
      packageName: z.string().describe("Package name containing the action"),
      actionName: z.string().describe("Name of the action to retrieve"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        const result = await client.requestRaw(
          "GET",
          `/api/v2/packages/${encodeURIComponent(params.packageName)}/actions/${encodeURIComponent(params.actionName)}`,
          queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_create_action — Create or update a Cloud Functions action
  server.tool(
    "ncloud_functions_create_action",
    "Create or update a Cloud Functions action (Basic or Sequence type)",
    {
      packageName: z.string().default("-").describe("Package name (use '-' for unpackaged actions)"),
      actionName: z.string().describe("Name of the action to create or update"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
      exec_kind: z.string().describe("Runtime string (e.g. 'nodejs:16', 'python:3.9', 'java:11', 'dotnet:6.0', or 'sequence')"),
      exec_code: z.string().optional().describe("Source code string (required for basic actions)"),
      exec_binary: z.boolean().optional().describe("Whether code is base64 encoded"),
      exec_main: z.string().optional().describe("Entry function name (required for basic actions)"),
      exec_components: z.array(z.string()).optional().describe("Array of '{packageName}/{actionName}' for sequence actions"),
      limits_timeout: z.number().optional().describe("Timeout in milliseconds (500~300000)"),
      limits_memory: z.number().optional().describe("Memory in MB (128, 256, 512, or 1024)"),
      description: z.string().optional().describe("Description of the action"),
      web: z.boolean().optional().describe("Enable web action"),
      raw_http: z.boolean().optional().describe("Enable raw HTTP handling"),
      custom_options: z.boolean().optional().describe("Enable custom options"),
      parameters: z.record(z.unknown()).optional().describe("Default parameters as a JSON object"),
      vpc_no: z.number().optional().describe("VPC number"),
      subnet_no: z.number().optional().describe("Subnet number"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };

        const exec: Record<string, unknown> = { kind: params.exec_kind };
        if (params.exec_code !== undefined) {
          exec.code = params.exec_code;
        }
        if (params.exec_binary !== undefined) {
          exec.binary = params.exec_binary;
        }
        if (params.exec_main !== undefined) {
          exec.main = params.exec_main;
        }
        if (params.exec_components !== undefined) {
          exec.components = params.exec_components;
        }

        const body: Record<string, unknown> = { exec };

        if (params.limits_timeout !== undefined || params.limits_memory !== undefined) {
          const limits: Record<string, unknown> = {};
          if (params.limits_timeout !== undefined) {
            limits.timeout = params.limits_timeout;
          }
          if (params.limits_memory !== undefined) {
            limits.memory = params.limits_memory;
          }
          body.limits = limits;
        }
        if (params.description !== undefined) {
          body.description = params.description;
        }
        if (params.web !== undefined) {
          body.web = params.web;
        }
        if (params.raw_http !== undefined) {
          body.raw_http = params.raw_http;
        }
        if (params.custom_options !== undefined) {
          body.custom_options = params.custom_options;
        }
        if (params.parameters !== undefined) {
          body.parameters = params.parameters;
        }
        if (params.vpc_no !== undefined) {
          body.vpc_no = params.vpc_no;
        }
        if (params.subnet_no !== undefined) {
          body.subnet_no = params.subnet_no;
        }

        const result = await client.requestRaw(
          "PUT",
          `/api/v2/packages/${encodeURIComponent(params.packageName)}/actions/${encodeURIComponent(params.actionName)}`,
          queryParams,
          body
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_delete_action — Permanently delete a Cloud Functions action (destructive)
  server.tool(
    "ncloud_functions_delete_action",
    "\u26a0\ufe0f Destructive: Permanently delete a Cloud Functions action. Set confirm=true to execute.",
    {
      packageName: z.string().describe("Package name containing the action"),
      actionName: z.string().describe("Name of the action to delete"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
      confirm: z.boolean().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `\u26a0\ufe0f This will permanently delete Cloud Functions action [${params.actionName}] from package [${params.packageName}].\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        const result = await client.requestRaw(
          "DELETE",
          `/api/v2/packages/${encodeURIComponent(params.packageName)}/actions/${encodeURIComponent(params.actionName)}`,
          queryParams
        );
        return { content: [{ type: "text" as const, text: result ? JSON.stringify(result, null, 2) : "Action deleted successfully (204 No Content)" }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Action Invocation Tools ───────────────────────────────────────────────

  // ncloud_functions_invoke_action — Invoke a Cloud Functions action
  server.tool(
    "ncloud_functions_invoke_action",
    "Invoke a Cloud Functions action and return the execution result",
    {
      packageName: z.string().describe("Package name containing the action"),
      actionName: z.string().describe("Name of the action to invoke"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
      timeout: z.number().min(0).max(60000).optional().default(60000).describe("Invocation timeout in milliseconds (0~60000, default: 60000)"),
      params: z.record(z.unknown()).optional().describe("Runtime parameters to pass to the action"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
          timeout: String(params.timeout),
        };
        const body: Record<string, unknown> = params.params ?? {};
        const result = await client.requestRaw(
          "POST",
          `/api/v2/packages/${encodeURIComponent(params.packageName)}/actions/${encodeURIComponent(params.actionName)}`,
          queryParams,
          body
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Trigger Management Tools ──────────────────────────────────────────────

  // ncloud_functions_list_triggers — List all Cloud Functions triggers
  server.tool(
    "ncloud_functions_list_triggers",
    "List all Cloud Functions triggers",
    {
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        const result = await client.requestRaw("GET", "/api/v2/triggers", queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_get_trigger — Get detailed information about a specific trigger
  server.tool(
    "ncloud_functions_get_trigger",
    "Get detailed information about a specific trigger",
    {
      triggerName: z.string().describe("Name of the trigger to retrieve"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        const result = await client.requestRaw(
          "GET",
          `/api/v2/triggers/${encodeURIComponent(params.triggerName)}`,
          queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_create_trigger — Create or update a Cloud Functions trigger
  server.tool(
    "ncloud_functions_create_trigger",
    "Create or update a Cloud Functions trigger",
    {
      triggerName: z.string().describe("Name of the trigger to create or update"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
      type: z.enum(["cron", "github", "insight", "object_storage", "source_commit"]).describe("Trigger type"),
      trigger: z.record(z.unknown()).describe("Trigger configuration object (structure varies by type)"),
      link: z.record(z.unknown()).optional().describe("Link configuration for GitHub type: { productId, apiName, stageName }"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
          type: params.type,
        };
        const body: Record<string, unknown> = {
          trigger: params.trigger,
        };
        if (params.link !== undefined) {
          body.link = params.link;
        }
        const result = await client.requestRaw(
          "PUT",
          `/api/v2/triggers/${encodeURIComponent(params.triggerName)}`,
          queryParams,
          body
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_invoke_trigger — Manually invoke a Cloud Functions trigger
  server.tool(
    "ncloud_functions_invoke_trigger",
    "Manually invoke a Cloud Functions trigger",
    {
      triggerName: z.string().describe("Name of the trigger to invoke"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
      params: z.record(z.unknown()).optional().describe("Runtime parameters to pass to the trigger"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        const body: Record<string, unknown> = params.params ?? {};
        const result = await client.requestRaw(
          "POST",
          `/api/v2/triggers/${encodeURIComponent(params.triggerName)}`,
          queryParams,
          body
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_delete_trigger — Permanently delete a Cloud Functions trigger (destructive)
  server.tool(
    "ncloud_functions_delete_trigger",
    "\u26a0\ufe0f Destructive: Permanently delete a Cloud Functions trigger. Set confirm=true to execute.",
    {
      triggerName: z.string().describe("Name of the trigger to delete"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
      confirm: z.boolean().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `\u26a0\ufe0f This will permanently delete Cloud Functions trigger [${params.triggerName}].\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        const result = await client.requestRaw(
          "DELETE",
          `/api/v2/triggers/${encodeURIComponent(params.triggerName)}`,
          queryParams
        );
        return { content: [{ type: "text" as const, text: result ? JSON.stringify(result, null, 2) : "Trigger deleted successfully (204 No Content)" }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Trigger-Action Linking Tools ──────────────────────────────────────────

  // ncloud_functions_link_trigger_action — Link an action to a trigger
  server.tool(
    "ncloud_functions_link_trigger_action",
    "Link an action to a trigger for event-based execution",
    {
      triggerName: z.string().describe("Name of the trigger"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
      actionName: z.string().describe("Action name in \"{packageName}/{actionName}\" format"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        const body: Record<string, unknown> = {
          actionName: params.actionName,
        };
        const result = await client.requestRaw(
          "POST",
          `/api/v2/triggers/${encodeURIComponent(params.triggerName)}/link`,
          queryParams,
          body
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_unlink_trigger_action — Unlink an action from a trigger (destructive)
  server.tool(
    "ncloud_functions_unlink_trigger_action",
    "\u26a0\ufe0f Destructive: Unlink an action from a trigger. Set confirm=true to execute.",
    {
      triggerName: z.string().describe("Name of the trigger"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
      actionName: z.string().describe("Action name in \"{packageName}/{actionName}\" format"),
      confirm: z.boolean().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `\u26a0\ufe0f This will unlink action [${params.actionName}] from trigger [${params.triggerName}].\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const queryParams: Record<string, string> = {
          platform: params.platform,
          actionName: params.actionName,
        };
        const result = await client.requestRaw(
          "DELETE",
          `/api/v2/triggers/${encodeURIComponent(params.triggerName)}/link`,
          queryParams
        );
        return { content: [{ type: "text" as const, text: result ? JSON.stringify(result, null, 2) : "Action unlinked from trigger successfully (204 No Content)" }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Activation (Execution History) Tools ──────────────────────────────────

  // ncloud_functions_get_action_activations — Get activation history for a specific action
  server.tool(
    "ncloud_functions_get_action_activations",
    "Get activation (execution) history for a specific action",
    {
      packageName: z.string().describe("Package name containing the action"),
      actionName: z.string().describe("Name of the action"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
      start: z.string().optional().describe("Start time filter (format: yyyy-MM-ddTHH:mm:ss)"),
      end: z.string().optional().describe("End time filter (format: yyyy-MM-ddTHH:mm:ss)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        if (params.pageNo !== undefined) queryParams.pageNo = String(params.pageNo);
        if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);
        if (params.start !== undefined) queryParams.start = params.start;
        if (params.end !== undefined) queryParams.end = params.end;
        const result = await client.requestRaw(
          "GET",
          `/api/v2/packages/${encodeURIComponent(params.packageName)}/actions/${encodeURIComponent(params.actionName)}/activations`,
          queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_get_action_activation_detail — Get detailed information about a specific action activation
  server.tool(
    "ncloud_functions_get_action_activation_detail",
    "Get detailed information about a specific action activation",
    {
      packageName: z.string().describe("Package name containing the action"),
      actionName: z.string().describe("Name of the action"),
      activationId: z.string().describe("Activation ID to retrieve details for"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        const result = await client.requestRaw(
          "GET",
          `/api/v2/packages/${encodeURIComponent(params.packageName)}/actions/${encodeURIComponent(params.actionName)}/activations/${encodeURIComponent(params.activationId)}`,
          queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_get_trigger_activations — Get activation history for a specific trigger
  server.tool(
    "ncloud_functions_get_trigger_activations",
    "Get activation history for a specific trigger",
    {
      triggerName: z.string().describe("Name of the trigger"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
      start: z.string().optional().describe("Start time filter (format: yyyy-MM-ddTHH:mm:ss)"),
      end: z.string().optional().describe("End time filter (format: yyyy-MM-ddTHH:mm:ss)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        if (params.pageNo !== undefined) queryParams.pageNo = String(params.pageNo);
        if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);
        if (params.start !== undefined) queryParams.start = params.start;
        if (params.end !== undefined) queryParams.end = params.end;
        const result = await client.requestRaw(
          "GET",
          `/api/v2/triggers/${encodeURIComponent(params.triggerName)}/activations`,
          queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_get_trigger_activation_detail — Get detailed information about a specific trigger activation
  server.tool(
    "ncloud_functions_get_trigger_activation_detail",
    "Get detailed information about a specific trigger activation",
    {
      triggerName: z.string().describe("Name of the trigger"),
      activationId: z.string().describe("Activation ID to retrieve details for"),
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        const result = await client.requestRaw(
          "GET",
          `/api/v2/triggers/${encodeURIComponent(params.triggerName)}/activations/${encodeURIComponent(params.activationId)}`,
          queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_functions_get_activations — Get all activation history across all actions
  server.tool(
    "ncloud_functions_get_activations",
    "Get all activation history across all actions (last 1 month)",
    {
      platform: z.enum(["vpc", "classic"]).optional().default("vpc").describe("Platform type (default: vpc)"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
      start: z.string().optional().describe("Start time filter (format: yyyy-MM-ddTHH:mm:ss)"),
      end: z.string().optional().describe("End time filter (format: yyyy-MM-ddTHH:mm:ss)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          platform: params.platform,
        };
        if (params.pageNo !== undefined) queryParams.pageNo = String(params.pageNo);
        if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);
        if (params.start !== undefined) queryParams.start = params.start;
        if (params.end !== undefined) queryParams.end = params.end;
        const result = await client.requestRaw(
          "GET",
          "/api/v2/activations",
          queryParams
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
