import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { dryRunMessage } from "./_messages.js";

export function registerStorageNasTools(server: McpServer, client: NcloudClient): void {
  // ─── NAS Volume Query Tools ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_nas_volumes",
    "List all NAS volume instances in the current region",
    {
      nasVolumeInstanceNoList: z.array(z.string()).optional().describe("Filter by NAS volume instance numbers"),
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN)"),
      zoneCode: z.string().optional().describe("Zone code (e.g. KR-1, KR-2)"),
      volumeAllotmentProtocolTypeCode: z.string().optional().describe("Volume protocol type code (NFS or CIFS)"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vnas/v2/getNasVolumeInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_nas_volume_detail",
    "Get detailed information about a specific NAS volume instance",
    {
      nasVolumeInstanceNo: z.string().describe("NAS volume instance number to query"),
    },
    async (params) => {
      return client.request("/vnas/v2/getNasVolumeInstanceDetail", params);
    }
  );

  // ─── NAS Volume Create Tools ───────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_nas_volume",
    "Create a new NAS volume instance. Use dryRun=true to preview.",
    {
      volumeName: z.string().describe("NAS volume name (3~20 characters, alphanumeric)"),
      volumeSize: z.number().describe("Volume size in GB (500~10000, in 100GB increments)"),
      volumeAllotmentProtocolTypeCode: z.string().describe("Volume protocol type code (NFS or CIFS)"),
      vpcNo: z.string().describe("VPC number where the NAS volume will be created"),
      zoneCode: z.string().describe("Zone code (e.g. KR-1, KR-2)"),
      cifsUserName: z.string().optional().describe("CIFS user name (required when protocol is CIFS)"),
      cifsUserPassword: z.string().optional().describe("CIFS user password (required when protocol is CIFS)"),
      nasVolumeDescription: z.string().optional().describe("NAS volume description"),
      isEncryptedVolume: z.boolean().optional().describe("Whether to encrypt the volume"),
      isReturnProtection: z.boolean().optional().describe("Whether to enable return protection"),
      serverInstanceNoList: z.array(z.string()).optional().describe("List of server instance numbers for access control"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: NAS Volume Creation",
          volumeName: params.volumeName,
          volumeSize: `${params.volumeSize} GB`,
          volumeAllotmentProtocolTypeCode: params.volumeAllotmentProtocolTypeCode,
          vpcNo: params.vpcNo,
          zoneCode: params.zoneCode,
          cifsUserName: params.cifsUserName ?? "(N/A)",
          isEncryptedVolume: params.isEncryptedVolume ?? false,
          isReturnProtection: params.isReturnProtection ?? false,
          serverInstanceNoList: params.serverInstanceNoList ?? [],
          message: dryRunMessage({ ko: "NAS 볼륨", en: "NAS volume" }),
        };
        return preview;
      }
      const { dryRun, ...apiParams } = params;
      const result = await client.request("/vnas/v2/createNasVolumeInstance", apiParams);
      return result;
    }
  );

  // ─── NAS Volume Destructive Tools ──────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_nas_volumes",
    "⚠️ Destructive: Permanently delete one or more NAS volume instances. Set confirm=true to execute.",
    {
      nasVolumeInstanceNoList: z.array(z.string()).min(1).describe("List of NAS volume instance numbers to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vnas/v2/deleteNasVolumeInstances", apiParams);
      return result;
    },
    { destructive: { noun: "NAS Volume", describe: (params) => params.nasVolumeInstanceNoList.join(", ") } }
  );

  // ─── NAS Volume Size Change ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_change_nas_volume_size",
    "Change the size of a NAS volume instance",
    {
      nasVolumeInstanceNo: z.string().describe("NAS volume instance number"),
      volumeSize: z.number().describe("New volume size in GB (500~10000, in 100GB increments)"),
    },
    async (params) => {
      return client.request("/vnas/v2/changeNasVolumeSize", params);
    }
  );

  // ─── NAS Volume Access Control ─────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_set_nas_volume_access_control",
    "Set access control for a NAS volume instance (server-based or custom IP-based)",
    {
      nasVolumeInstanceNo: z.string().describe("NAS volume instance number"),
      serverInstanceNoList: z.array(z.string()).optional().describe("List of server instance numbers to allow access"),
      customIpList: z.array(z.string()).optional().describe("List of custom IPs to allow access"),
    },
    async (params) => {
      return client.request("/vnas/v2/setNasVolumeAccessControl", params);
    }
  );

  // ─── NAS Volume Access Control — Add/Remove ─────────────────────────────────

  defineTool(
    server,
    "ncloud_add_nas_volume_access_control",
    "Add server instance access control to a NAS volume (NFS protocol)",
    {
      nasVolumeInstanceNo: z.string().describe("NAS volume instance number"),
      serverInstanceNoList: z.array(z.string()).min(1).describe("List of server instance numbers to grant access"),
    },
    async (params) => {
      return client.request("/vnas/v2/addNasVolumeAccessControl", params);
    }
  );

  defineTool(
    server,
    "ncloud_remove_nas_volume_access_control",
    "⚠️ Destructive: Remove server instance access control from a NAS volume (NFS protocol). Set confirm=true to execute.",
    {
      nasVolumeInstanceNo: z.string().describe("NAS volume instance number"),
      serverInstanceNoList: z.array(z.string()).min(1).describe("List of server instance numbers to revoke access"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vnas/v2/removeNasVolumeAccessControl", apiParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will remove access control for server instances [${params.serverInstanceNoList.join(", ")}] from NAS Volume [${params.nasVolumeInstanceNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_get_nas_volume_access_control_rules",
    "Get the list of access control rules configured for a NAS volume",
    {
      nasVolumeInstanceNo: z.string().describe("NAS volume instance number"),
    },
    async (params) => {
      return client.request("/vnas/v2/getNasVolumeAccessControlRuleList", params);
    }
  );

  // ─── NAS Volume Return Protection ─────────────────────────────────────────

  defineTool(
    server,
    "ncloud_set_nas_volume_return_protection",
    "Set return protection for a NAS volume instance",
    {
      nasVolumeInstanceNo: z.string().describe("NAS volume instance number"),
      isReturnProtection: z.boolean().describe("Whether to enable return protection (true=protected, false=unprotected)"),
    },
    async (params) => {
      return client.request("/vnas/v2/setNasVolumeReturnProtection", params);
    }
  );

  // ─── NAS Volume Rating (Size Measurement) ─────────────────────────────────

  defineTool(
    server,
    "ncloud_get_nas_volume_rating_list",
    "Get NAS volume size measurement list for a specific time period",
    {
      nasVolumeInstanceNo: z.string().describe("NAS volume instance number"),
      startTime: z.string().describe("Start time for the measurement period (format: yyyy-MM-dd'T'HH:mm:ssZ)"),
      endTime: z.string().describe("End time for the measurement period (format: yyyy-MM-dd'T'HH:mm:ssZ)"),
      interval: z.string().optional().describe("Measurement interval (e.g. 5m, 1h, 1d)"),
    },
    async (params) => {
      return client.request("/vnas/v2/getNasVolumeInstanceRatingList", params);
    }
  );

  // ─── NAS Volume Snapshot Query Tools ───────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_nas_snapshots",
    "List snapshots for a NAS volume instance",
    {
      nasVolumeInstanceNo: z.string().describe("NAS volume instance number"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vnas/v2/getNasVolumeSnapshotList", params);
    }
  );

  // ─── NAS Volume Snapshot Create Tools ──────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_nas_snapshot",
    "Create a snapshot for a NAS volume instance. Use dryRun=true to preview.",
    {
      nasVolumeInstanceNo: z.string().describe("NAS volume instance number to create snapshot from"),
      nasVolumeSnapshotName: z.string().optional().describe("Name for the snapshot"),
      nasVolumeSnapshotDescription: z.string().optional().describe("Description for the snapshot"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: NAS Snapshot Creation",
          nasVolumeInstanceNo: params.nasVolumeInstanceNo,
          nasVolumeSnapshotName: params.nasVolumeSnapshotName ?? "(auto-generated)",
          message: dryRunMessage({ ko: "NAS 스냅샷", en: "NAS snapshot" }),
        };
        return preview;
      }
      const { dryRun, ...apiParams } = params;
      const result = await client.request("/vnas/v2/createNasVolumeSnapshot", apiParams);
      return result;
    }
  );

  // ─── NAS Volume Snapshot Destructive Tools ─────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_nas_snapshot",
    "⚠️ Destructive: Permanently delete a NAS volume snapshot. Set confirm=true to execute.",
    {
      nasVolumeSnapshotInstanceNo: z.string().describe("NAS volume snapshot instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vnas/v2/deleteNasVolumeSnapshot", apiParams);
      return result;
    },
    { destructive: { noun: "NAS Snapshot", describe: (params) => params.nasVolumeSnapshotInstanceNo } }
  );

  // ─── NAS Volume Snapshot Configuration Tools ───────────────────────────────

  defineTool(
    server,
    "ncloud_get_nas_snapshot_config_history",
    "Get the snapshot configuration history for a NAS volume instance",
    {
      nasVolumeInstanceNo: z.string().describe("NAS volume instance number"),
    },
    async (params) => {
      return client.request("/vnas/v2/getNasVolumeSnapshotConfigurationHistoryList", params);
    }
  );

  defineTool(
    server,
    "ncloud_change_nas_snapshot_config",
    "Change the snapshot configuration for a NAS volume (enable/disable auto snapshot, set schedule)",
    {
      nasVolumeInstanceNo: z.string().describe("NAS volume instance number"),
      isSnapshotConfiguration: z.boolean().describe("Whether to enable (true) or disable (false) automatic snapshots"),
      snapshotTime: z.string().optional().describe("Snapshot time in HH format (00~23, KST). Required when enabling snapshots."),
      snapshotFrequencyTypeCode: z.string().optional().describe("Snapshot frequency type code (e.g. DAILY, WEEKLY). Required when enabling snapshots."),
    },
    async (params) => {
      return client.request("/vnas/v2/changeNasVolumeSnapshotConfiguration", params);
    }
  );

  defineTool(
    server,
    "ncloud_restore_nas_volume_with_snapshot",
    "⚠️ Destructive: Restore a NAS volume to a previous snapshot state. Current data will be overwritten with the snapshot data. Set confirm=true to execute.",
    {
      nasVolumeInstanceNo: z.string().describe("NAS volume instance number to restore"),
      nasVolumeSnapshotNo: z.string().describe("NAS volume snapshot number to restore from"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vnas/v2/restoreNasVolumeWithSnapshot", apiParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will restore NAS Volume [${params.nasVolumeInstanceNo}] to Snapshot [${params.nasVolumeSnapshotNo}]. Current data will be overwritten with the snapshot data. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );
}
