import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

export function registerComputeStorageTools(server: McpServer, client: NcloudClient): void {
  // ─── Block Storage Query Tools ─────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_block_storage",
    "List all block storage instances in the current region",
    {
      blockStorageInstanceNoList: z.array(z.string()).optional().describe("Filter by block storage instance numbers"),
      serverInstanceNo: z.string().optional().describe("Filter by attached server instance number"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vserver/v2/getBlockStorageInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_block_storage_detail",
    "Get detailed information about a specific block storage instance",
    {
      blockStorageInstanceNo: z.string().describe("Block storage instance number to query"),
    },
    async (params) => {
      return client.request("/vserver/v2/getBlockStorageInstanceDetail", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_block_storage_volume_types",
    "Get list of block storage volume types available in the region",
    {
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN)"),
    },
    async (params) => {
      return client.request("/vserver/v2/getBlockStorageVolumeTypeList", params);
    }
  );

  // ─── Block Storage Create Tools ────────────────────────────────────────────

  defineTool(
    server,
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
      // serverInstanceNo 없으면 (KVM) zoneCode 필수
      if (!params.serverInstanceNo && !params.zoneCode) {
        return {
          content: [{ type: "text" as const, text: "zoneCode is required when serverInstanceNo is not provided (KVM standalone creation)." }],
          isError: true,
        };
      }

      const { dryRun, ...apiParams } = params;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Block Storage Creation",
          endpoint: "/vserver/v2/createBlockStorageInstance",
          requestParams: apiParams,
          noun: { ko: "블록 스토리지", en: "block storage" },
          notes: {
            mode: params.serverInstanceNo ? "XEN (attach to server)" : "KVM (standalone, attach later)",
          },
        });
      }

      const result = await client.request("/vserver/v2/createBlockStorageInstance", apiParams);
      return result;
    }
  );


  // ─── Block Storage Operation Tools ─────────────────────────────────────────

  defineTool(
    server,
    "ncloud_attach_block_storage",
    "Attach a block storage instance to a server. Automatically waits if the block storage is still being created (polls until status is CREAT).",
    {
      serverInstanceNo: z.string().describe("Server instance number to attach to"),
      blockStorageInstanceNo: z.string().describe("Block storage instance number to attach"),
    },
    async (params) => {
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
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_detach_block_storage",
    "Detach block storage instances from their servers",
    {
      blockStorageInstanceNoList: z.array(z.string()).min(1).describe("List of block storage instance numbers to detach"),
    },
    async (params) => {
      return client.request("/vserver/v2/detachBlockStorageInstances", params);
    }
  );

  defineTool(
    server,
    "ncloud_change_block_storage",
    "Change block storage instance (resize volume and/or update name/description). Supports both Gen2 (XEN) and Gen3 (KVM). For attached storage, server must be stopped to resize.",
    {
      blockStorageInstanceNo: z.string().describe("Block storage instance number to change"),
      blockStorageSize: z.number().describe("New block storage size in GB (XEN: 10~2000, KVM: 10~16380, 10GB increments, must be >= current size)"),
      blockStorageName: z.string().optional().describe("New block storage name"),
      blockStorageDescription: z.string().optional().describe("New block storage description"),
    },
    async (params) => {
      return client.request("/vserver/v2/changeBlockStorageInstance", params);
    }
  );

  defineTool(
    server,
    "ncloud_set_block_storage_protection",
    "Set return protection for a block storage instance",
    {
      blockStorageInstanceNo: z.string().describe("Block storage instance number to set protection"),
      isReturnProtection: z.boolean().describe("Whether to enable return protection (true to protect, false to unprotect)"),
    },
    async (params) => {
      return client.request("/vserver/v2/setBlockStorageReturnProtection", params);
    }
  );

  // ─── Block Storage Destructive Tools ───────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_block_storage",
    "⚠️ Destructive: Permanently delete one or more block storage instances. Set confirm=true to execute.",
    {
      blockStorageInstanceNoList: z.array(z.string()).min(1).describe("List of block storage instance numbers to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vserver/v2/deleteBlockStorageInstances", apiParams);
      return result;
    },
    { destructive: { noun: "BlockStorage", describe: (params) => params.blockStorageInstanceNoList.join(", ") } }
  );

  // ─── Snapshot Query Tools ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_snapshots",
    "List all block storage snapshot instances",
    {
      blockStorageSnapshotInstanceNoList: z.array(z.string()).optional().describe("Filter by snapshot instance numbers"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vserver/v2/getBlockStorageSnapshotInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_snapshot_detail",
    "Get detailed information about a specific block storage snapshot instance",
    {
      blockStorageSnapshotInstanceNo: z.string().describe("Block storage snapshot instance number to query"),
    },
    async (params) => {
      return client.request("/vserver/v2/getBlockStorageSnapshotInstanceDetail", params);
    }
  );

  // ─── Snapshot Create Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_snapshot",
    "Create a snapshot from a block storage instance. The source volume is sent to the API as 'originalBlockStorageInstanceNo' — either parameter name is accepted here. Use dryRun=true to preview.",
    {
      blockStorageInstanceNo: z.string().optional().describe("Block storage instance number to create snapshot from. Sent to the API as originalBlockStorageInstanceNo. Provide this or originalBlockStorageInstanceNo."),
      originalBlockStorageInstanceNo: z.string().optional().describe("Same as blockStorageInstanceNo, spelled with the Ncloud API's own parameter name. Takes precedence when both are given."),
      blockStorageSnapshotName: z.string().optional().describe("Name for the snapshot (3-30 chars: letters, digits, '-', '_'). Auto-generated when omitted"),
      blockStorageSnapshotDescription: z.string().optional().describe("Description for the snapshot (max 1000 bytes)"),
      snapshotTypeCode: z.enum(["FULL", "INCREMENTAL"]).optional().describe("Snapshot type — XEN (Gen2, HDD/SSD volumes) ONLY: FULL (default) or INCREMENTAL. INCREMENTAL requires an existing full snapshot of the same volume and is capped at 7 per full snapshot. KVM (Gen3, CB1/CB2/FB1/FB2 volumes) has no snapshot type: the API accepts this parameter on a KVM volume but SILENTLY IGNORES it and creates a FULL snapshot (verified against the live API), so do not rely on it there — omit it for KVM volumes."),
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN). Defaults to the client region"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      // NCP createBlockStorageSnapshotInstance 의 원본 볼륨 파라미터명은 originalBlockStorageInstanceNo 다.
      // 도구 입력명 blockStorageInstanceNo 는 하위호환으로 유지하고 전송 시점에만 변환한다.
      const originalBlockStorageInstanceNo =
        params.originalBlockStorageInstanceNo ?? params.blockStorageInstanceNo;
      if (!originalBlockStorageInstanceNo) {
        return {
          content: [{
            type: "text" as const,
            text: L({
              ko: "blockStorageInstanceNo 또는 originalBlockStorageInstanceNo 중 하나는 필수입니다.",
              en: "One of blockStorageInstanceNo or originalBlockStorageInstanceNo is required.",
            }),
          }],
          isError: true,
        };
      }

      const apiParams = {
        originalBlockStorageInstanceNo,
        blockStorageSnapshotName: params.blockStorageSnapshotName,
        blockStorageSnapshotDescription: params.blockStorageSnapshotDescription,
        snapshotTypeCode: params.snapshotTypeCode,
        regionCode: params.regionCode,
      };

      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Snapshot Creation",
          endpoint: "/vserver/v2/createBlockStorageSnapshotInstance",
          requestParams: apiParams,
          noun: { ko: "스냅샷", en: "snapshot" },
          notes: {
            // 생략된 값은 전송되지 않는다 — requestParams에 기본값을 섞지 않고 여기서 설명한다.
            ...(params.blockStorageSnapshotName
              ? {}
              : { note_blockStorageSnapshotName: "(not sent — the server auto-generates the name)" }),
            // KVM 볼륨은 스냅샷 유형 선택 자체가 없어 "FULL 기본"이라고 단정하지 않는다.
            ...(params.snapshotTypeCode
              ? {
                  // KVM 볼륨에 유형을 지정하면 API가 조용히 무시하고 FULL로 만든다(라이브 실측).
                  warning_snapshotTypeCode: L({
                    ko: "snapshotTypeCode는 XEN(HDD/SSD) 볼륨에서만 적용됩니다. KVM(CB/FB) 볼륨은 이 값을 무시하고 FULL 스냅샷을 만듭니다(오류도 나지 않음).",
                    en: "snapshotTypeCode applies to XEN (HDD/SSD) volumes only. On a KVM (CB/FB) volume the API ignores it and creates a FULL snapshot without raising an error.",
                  }),
                }
              : { note_snapshotTypeCode: "(not sent — XEN defaults to FULL; KVM has no snapshot type)" }),
          },
        });
      }
      const result = await client.request("/vserver/v2/createBlockStorageSnapshotInstance", apiParams);
      return result;
    }
  );

  // ─── Snapshot Destructive Tools ────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_snapshots",
    "⚠️ Destructive: Permanently delete one or more block storage snapshot instances. Set confirm=true to execute.",
    {
      blockStorageSnapshotInstanceNoList: z.array(z.string()).min(1).describe("List of snapshot instance numbers to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vserver/v2/deleteBlockStorageSnapshotInstances", apiParams);
      return result;
    },
    { destructive: { noun: "Snapshot", describe: (params) => params.blockStorageSnapshotInstanceNoList.join(", ") } }
  );
}
