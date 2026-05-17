import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

export function registerComputeStorageTools(server: McpServer, client: NcloudClient): void {
  // ─── Block Storage Query Tools ─────────────────────────────────────────────

  server.tool(
    "ncloud_list_block_storage",
    "List all block storage instances in the current region",
    {
      blockStorageInstanceNoList: z.array(z.string()).optional().describe("Filter by block storage instance numbers"),
      serverInstanceNo: z.string().optional().describe("Filter by attached server instance number"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getBlockStorageInstanceList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_block_storage_detail",
    "Get detailed information about a specific block storage instance",
    {
      blockStorageInstanceNo: z.string().describe("Block storage instance number to query"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getBlockStorageInstanceDetail", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_block_storage_volume_types",
    "Get list of block storage volume types available in the region",
    {
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getBlockStorageVolumeTypeList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Block Storage Create Tools ────────────────────────────────────────────

  server.tool(
    "ncloud_create_block_storage",
    "Create a new block storage instance. Requires zoneCode + blockStorageVolumeTypeCode + blockStorageSize. For XEN: also provide serverInstanceNo to attach at creation. For KVM: cannot attach at creation — use ncloud_attach_block_storage after. Use dryRun=true to preview.",
    {
      blockStorageSize: z.number().describe("Block storage size in GB (XEN: 10~2000, KVM: 10~16380, in 10GB increments)"),
      zoneCode: z.string().optional().describe("Zone code (e.g. KR-1, KR-2). Required when serverInstanceNo is not provided."),
      blockStorageVolumeTypeCode: z.string().describe("Volume type code. Valid values: SSD, HDD, CB1, CB2, FB1, FB2. Use ncloud_get_block_storage_volume_types to check available types."),
      serverInstanceNo: z.string().optional().describe("Server instance number (XEN only — creates and attaches to this server. NOT available for KVM)"),
      blockStorageSnapshotInstanceNo: z.string().optional().describe("Snapshot instance number to create block storage from"),
      isReturnProtection: z.boolean().optional().describe("Whether to enable return protection"),
      blockStorageName: z.string().optional().describe("Block storage name"),
      blockStorageDescription: z.string().optional().describe("Block storage description"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      try {
        // serverInstanceNo 없으면 (KVM) zoneCode 필수
        if (!params.serverInstanceNo && !params.zoneCode) {
          return {
            content: [{ type: "text" as const, text: "zoneCode is required when serverInstanceNo is not provided (KVM standalone creation)." }],
            isError: true,
          };
        }

        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: Block Storage Creation",
            mode: params.serverInstanceNo ? "XEN (attach to server)" : "KVM (standalone, attach later)",
            blockStorageSize: `${params.blockStorageSize} GB`,
            zoneCode: params.zoneCode ?? "(resolved from server)",
            blockStorageVolumeTypeCode: params.blockStorageVolumeTypeCode,
            serverInstanceNo: params.serverInstanceNo ?? "(not set)",
            blockStorageSnapshotInstanceNo: params.blockStorageSnapshotInstanceNo ?? "(not set)",
            isReturnProtection: params.isReturnProtection ?? "(not set)",
            blockStorageName: params.blockStorageName ?? "(auto-generated)",
            message: "이 요청은 실제 블록 스토리지를 생성하지 않습니다. dryRun=false로 호출하면 생성됩니다.",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }

        const { dryRun, ...apiParams } = params;
        const result = await client.request("/vserver/v2/createBlockStorageInstance", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Block Storage Operation Tools ─────────────────────────────────────────

  server.tool(
    "ncloud_attach_block_storage",
    "Attach a block storage instance to a server. Automatically waits if the block storage is still being created (polls until status is CREAT).",
    {
      serverInstanceNo: z.string().describe("Server instance number to attach to"),
      blockStorageInstanceNo: z.string().describe("Block storage instance number to attach"),
    },
    async (params) => {
      try {
        // Poll until block storage is ready (status CREAT)
        const maxAttempts = 20;
        const intervalMs = 3000;
        for (let i = 0; i < maxAttempts; i++) {
          const detail = await client.request("/vserver/v2/getBlockStorageInstanceDetail", {
            blockStorageInstanceNo: params.blockStorageInstanceNo,
          });
          const instance = detail?.blockStorageInstanceList?.[0];
          const status = instance?.blockStorageInstanceStatus?.code;

          if (status === "CREAT") {
            break;
          }

          if (i === maxAttempts - 1) {
            return {
              content: [{ type: "text" as const, text: `Block storage ${params.blockStorageInstanceNo} is still in status '${status}' after ${maxAttempts * intervalMs / 1000}s. Please try again later.` }],
              isError: true,
            };
          }

          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }

        const result = await client.request("/vserver/v2/attachBlockStorageInstance", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_detach_block_storage",
    "Detach block storage instances from their servers",
    {
      blockStorageInstanceNoList: z.array(z.string()).min(1).describe("List of block storage instance numbers to detach"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/detachBlockStorageInstances", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_change_block_storage",
    "Change block storage instance (resize volume and/or update name/description). Supports both Gen2 (XEN) and Gen3 (KVM). For attached storage, server must be stopped to resize.",
    {
      blockStorageInstanceNo: z.string().describe("Block storage instance number to change"),
      blockStorageSize: z.number().describe("New block storage size in GB (XEN: 10~2000, KVM: 10~16380, 10GB increments, must be >= current size)"),
      blockStorageName: z.string().optional().describe("New block storage name"),
      blockStorageDescription: z.string().optional().describe("New block storage description"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/changeBlockStorageInstance", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_set_block_storage_protection",
    "Set return protection for a block storage instance",
    {
      blockStorageInstanceNo: z.string().describe("Block storage instance number to set protection"),
      isReturnProtection: z.boolean().describe("Whether to enable return protection (true to protect, false to unprotect)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/setBlockStorageReturnProtection", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Block Storage Destructive Tools ───────────────────────────────────────

  server.tool(
    "ncloud_delete_block_storage",
    "⚠️ Destructive: Permanently delete one or more block storage instances. Set confirm=true to execute.",
    {
      blockStorageInstanceNoList: z.array(z.string()).min(1).describe("List of block storage instance numbers to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete BlockStorage [${params.blockStorageInstanceNoList.join(", ")}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vserver/v2/deleteBlockStorageInstances", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Snapshot Query Tools ──────────────────────────────────────────────────

  server.tool(
    "ncloud_list_snapshots",
    "List all block storage snapshot instances",
    {
      blockStorageSnapshotInstanceNoList: z.array(z.string()).optional().describe("Filter by snapshot instance numbers"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getBlockStorageSnapshotInstanceList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_snapshot_detail",
    "Get detailed information about a specific block storage snapshot instance",
    {
      blockStorageSnapshotInstanceNo: z.string().describe("Block storage snapshot instance number to query"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getBlockStorageSnapshotInstanceDetail", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Snapshot Create Tools ─────────────────────────────────────────────────

  server.tool(
    "ncloud_create_snapshot",
    "Create a snapshot from a block storage instance. Use dryRun=true to preview.",
    {
      blockStorageInstanceNo: z.string().describe("Block storage instance number to create snapshot from"),
      blockStorageSnapshotName: z.string().optional().describe("Name for the snapshot"),
      blockStorageSnapshotDescription: z.string().optional().describe("Description for the snapshot"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: Snapshot Creation",
            blockStorageInstanceNo: params.blockStorageInstanceNo,
            blockStorageSnapshotName: params.blockStorageSnapshotName ?? "(auto-generated)",
            message: "이 요청은 실제 스냅샷을 생성하지 않습니다. dryRun=false로 호출하면 생성됩니다.",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }
        const { dryRun, ...apiParams } = params;
        const result = await client.request("/vserver/v2/createBlockStorageSnapshotInstance", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Snapshot Destructive Tools ────────────────────────────────────────────

  server.tool(
    "ncloud_delete_snapshots",
    "⚠️ Destructive: Permanently delete one or more block storage snapshot instances. Set confirm=true to execute.",
    {
      blockStorageSnapshotInstanceNoList: z.array(z.string()).min(1).describe("List of snapshot instance numbers to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Snapshot [${params.blockStorageSnapshotInstanceNoList.join(", ")}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vserver/v2/deleteBlockStorageSnapshotInstances", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
