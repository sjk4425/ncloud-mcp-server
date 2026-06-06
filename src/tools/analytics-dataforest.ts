import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

/**
 * Data Forest — 빅데이터 분석 플랫폼 (Accounts & Apps 관리)
 *
 * Base URL: https://df.apigw.ntruss.com
 * VPC 환경에서만 이용 가능
 * 모든 API는 POST 메서드 사용, JSON body
 */

export function registerDataForestTools(server: McpServer, client: NcloudClient): void {

  // ═══════════════════════════════════════════════════════════════════════
  // Accounts API
  // ═══════════════════════════════════════════════════════════════════════

  server.tool(
    "ncloud_dataforest_check_account_name",
    "Check Data Forest account name availability and validity",
    {
      name: z.string().min(2).max(16).describe("Account name (lowercase + numbers + '-', 2-16 chars)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/accounts/checkAvailableName", {
          name: params.name,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_create_account",
    "Create a new Data Forest account",
    {
      name: z.string().min(2).max(16).describe("Account name (lowercase + numbers + '-', 2-16 chars)"),
      password: z.string().min(8).max(20).describe("Account password (letters + numbers + special chars, 8-20 chars)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/accounts/create", {
          name: params.name,
          password: params.password,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_list_accounts",
    "List all Data Forest accounts",
    {},
    async () => {
      try {
        const result = await client.postRequest("/api/v2/accounts/getList", {});
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_get_account_detail",
    "Get detailed information of a Data Forest account including HDFS quotas",
    {
      id: z.string().max(22).describe("Account unique identifier (Base62-encoded UUID)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/accounts/getDetail", {
          id: params.id,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_check_account_resource",
    "Check if a Data Forest account has any owned resources (before deletion)",
    {
      id: z.string().max(22).describe("Account unique identifier (Base62-encoded UUID)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/accounts/checkHasResource", {
          id: params.id,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_get_kerberos_keytab",
    "Download Kerberos keytab file for a Data Forest account (returns binary info)",
    {
      id: z.string().max(22).describe("Account unique identifier (Base62-encoded UUID)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/accounts/getKerberosKeytab", {
          id: params.id,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_reset_kerberos_keytab",
    "Reset Kerberos keytab for a Data Forest account",
    {
      id: z.string().max(22).describe("Account unique identifier (Base62-encoded UUID)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/accounts/resetKerberosKeytab", {
          id: params.id,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_reset_password",
    "Reset password for a Data Forest account",
    {
      id: z.string().max(22).describe("Account unique identifier (Base62-encoded UUID)"),
      password: z.string().min(8).max(20).describe("New password (letters + numbers + special chars, 8-20 chars)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/accounts/resetPassword", {
          id: params.id,
          password: params.password,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_set_quota",
    "Change HDFS quota for a Data Forest account",
    {
      id: z.string().max(22).describe("Account unique identifier (Base62-encoded UUID)"),
      namespace: z.enum(["koya", "tata"]).describe("HDFS namespace (koya or tata)"),
      fileCountMillion: z.number().min(1).max(5).describe("File count limit in millions (1-5, default: 1)"),
      spaceTb: z.number().min(200).max(500).describe("Max storage in TB (200-500, 100TB increments, default: 200)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/accounts/setQuota", {
          id: params.id,
          namespace: params.namespace,
          fileCountMillion: params.fileCountMillion,
          spaceTb: params.spaceTb,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_delete_account",
    "⚠️ Destructive: Delete a Data Forest account. Set confirm=true to execute. Check checkHasResource first.",
    {
      id: z.string().min(1).max(22).describe("Account unique identifier (Base62-encoded UUID, required)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute deletion"),
    },
    async (params) => {
      try {
        if (!params.id) {
          return { content: [{ type: "text" as const, text: "Error: id is required." }], isError: true };
        }
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text:
            `⚠️ This will permanently delete Data Forest account [${params.id}].\n\nTo execute, call again with confirm=true.`
          }] };
        }
        const result = await client.postRequest("/api/v2/accounts/delete", {
          id: params.id,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Apps API
  // ═══════════════════════════════════════════════════════════════════════

  server.tool(
    "ncloud_dataforest_check_app_name",
    "Check Data Forest app name availability and validity",
    {
      accountId: z.string().max(22).describe("Account unique identifier (Base62-encoded UUID)"),
      name: z.string().min(3).max(15).describe("App name (lowercase + numbers + '-', 3-15 chars, no consecutive '-')"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/apps/checkAvailableName", {
          accountId: params.accountId,
          name: params.name,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_get_app_basic_setting",
    "Get default creation settings for a Data Forest app type (components, queues, limits)",
    {
      accountId: z.string().max(22).describe("Account unique identifier (Base62-encoded UUID)"),
      appTypeId: z.string().max(60).describe("App type and version (e.g. DEV-1.0.0, KAFKA-2.4.0)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/apps/getAppBasicSetting", {
          accountId: params.accountId,
          appTypeId: params.appTypeId,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_get_app_type_ids",
    "Get available Data Forest app type ID list (e.g. DEV-1.0.0, KAFKA-2.4.0, ZEPPELIN-0.10.1)",
    {},
    async () => {
      try {
        const result = await client.postRequest("/api/v2/apps/getAppTypeIdList", {});
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_get_app_type_template",
    "Get YARN service template for a Data Forest app type",
    {
      appTypeId: z.string().max(60).describe("App type and version (e.g. DEV-1.0.0)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/apps/getAppTypeTemplate", {
          appTypeId: params.appTypeId,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_create_app",
    "Create a new Data Forest app (Kafka, Zeppelin, Spark, etc.)",
    {
      accountId: z.string().max(22).describe("Account unique identifier (Base62-encoded UUID)"),
      queueName: z.string().max(60).describe("YARN queue name (e.g. longlived, batch, dev)"),
      appTypeId: z.string().max(60).describe("App type and version (e.g. KAFKA-2.4.0)"),
      name: z.string().min(3).max(15).describe("App name (lowercase + numbers + '-', 3-15 chars)"),
      lifetime: z.number().describe("App lifetime in seconds (300-604800, or -1 for permanent)"),
      description: z.string().max(2048).optional().describe("App description (max 2048 chars)"),
      dependentIds: z.array(z.string()).optional().describe("Dependent app IDs required for creation"),
      components: z.array(z.object({
        name: z.string().describe("Component name (e.g. broker, shell)"),
        memoryMb: z.number().describe("Memory in MB per container"),
        cpuCount: z.number().describe("CPU count per container"),
        containerCount: z.number().describe("Number of containers"),
      })).describe("App component configurations"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          accountId: params.accountId,
          queueName: params.queueName,
          appTypeId: params.appTypeId,
          name: params.name,
          lifetime: params.lifetime,
          components: params.components,
        };
        if (params.description) body.description = params.description;
        if (params.dependentIds) body.dependentIds = params.dependentIds;
        const result = await client.postRequest("/api/v2/apps/create", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_list_apps",
    "List all apps for a Data Forest account",
    {
      accountId: z.string().max(22).describe("Account unique identifier (Base62-encoded UUID)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/apps/getList", {
          search: { accountId: params.accountId },
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_get_app_detail",
    "Get detailed information of a Data Forest app (state, components, links)",
    {
      id: z.string().max(22).describe("App unique identifier (Base62-encoded UUID)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/apps/getDetail", {
          id: params.id,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_set_container_count",
    "Change container count for a Data Forest app component",
    {
      id: z.string().max(22).describe("App unique identifier (Base62-encoded UUID)"),
      componentName: z.string().describe("Component name (e.g. shell, broker)"),
      containerCount: z.number().min(1).describe("New container count"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/apps/setContainerCount", {
          id: params.id,
          componentName: params.componentName,
          containerCount: params.containerCount,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_set_lifetime",
    "Change lifetime (running duration) for a Data Forest app",
    {
      id: z.string().max(22).describe("App unique identifier (Base62-encoded UUID)"),
      lifetime: z.number().min(300).max(604800).describe("New lifetime in seconds (300-604800)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/apps/setLifetime", {
          id: params.id,
          lifetime: params.lifetime,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_kill_container",
    "Restart a specific container in a Data Forest app component",
    {
      id: z.string().max(22).describe("App unique identifier (Base62-encoded UUID)"),
      containerName: z.string().max(60).describe("Container name (e.g. shell-0, broker-1)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/apps/killContainer", {
          id: params.id,
          containerName: params.containerName,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_kill_master",
    "Restart the Application Master of a Data Forest app",
    {
      id: z.string().max(22).describe("App unique identifier (Base62-encoded UUID)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/apps/killMaster", {
          id: params.id,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_start_app",
    "Start a stopped Data Forest app",
    {
      id: z.string().max(22).describe("App unique identifier (Base62-encoded UUID)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/apps/start", {
          id: params.id,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_stop_app",
    "Stop a running Data Forest app",
    {
      id: z.string().max(22).describe("App unique identifier (Base62-encoded UUID)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest("/api/v2/apps/stop", {
          id: params.id,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_dataforest_delete_app",
    "⚠️ Destructive: Delete a Data Forest app. Set confirm=true to execute.",
    {
      id: z.string().min(1).max(22).describe("App unique identifier (Base62-encoded UUID, required)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute deletion"),
    },
    async (params) => {
      try {
        if (!params.id) {
          return { content: [{ type: "text" as const, text: "Error: id is required." }], isError: true };
        }
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text:
            `⚠️ This will permanently delete Data Forest app [${params.id}].\n\nTo execute, call again with confirm=true.`
          }] };
        }
        const result = await client.postRequest("/api/v2/apps/delete", {
          id: params.id,
        });
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
