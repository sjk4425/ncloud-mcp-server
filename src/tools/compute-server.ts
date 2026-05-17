import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

export function registerComputeServerTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  server.tool(
    "ncloud_list_servers",
    "List all server instances in the current region",
    {
      serverInstanceNoList: z.array(z.string()).optional().describe("Filter by server instance numbers"),
      vpcNo: z.string().optional().describe("Filter by VPC number"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getServerInstanceList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_server_detail",
    "Get detailed information about a specific server instance",
    {
      serverInstanceNo: z.string().describe("Server instance number to query"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getServerInstanceDetail", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_root_password",
    "Get the root password for a server instance",
    {
      serverInstanceNo: z.string().describe("Server instance number"),
      privateKey: z.string().optional().describe("Private key to decrypt the password"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getRootPassword", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Image & Spec Tools ────────────────────────────────────────────────────

  server.tool(
    "ncloud_get_server_images",
    "List available server images (supports Gen2 XEN and Gen3 KVM)",
    {
      serverImageNoList: z.array(z.string()).optional().describe("Filter by server image numbers"),
      serverImageName: z.string().optional().describe("Filter by image name"),
      serverImageTypeCodeList: z.array(z.string()).optional().describe("Filter by image type (SELF | NCP)"),
      hypervisorTypeCodeList: z.array(z.string()).optional().describe("Filter by hypervisor type (XEN | KVM)"),
      osTypeCodeList: z.array(z.string()).optional().describe("Filter by OS type (CENTOS | UBUNTU | WINDOWS | ROCKY | NAVIX)"),
      platformCategoryCodeList: z.array(z.string()).optional().describe("Filter by platform category (OS | APP | DBMS | GPU)"),
      serverImageStatusCode: z.string().optional().describe("Filter by image status (INIT | CREAT | CREFL)"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
      sortedBy: z.string().optional().describe("Sort field"),
      sortingOrder: z.string().optional().describe("Sort order (ASC | DESC)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getServerImageList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_server_specs",
    "List available server specifications (supports Gen2 XEN and Gen3 KVM). Use serverImageNo from ncloud_get_server_images to filter compatible specs.",
    {
      serverImageNo: z.string().optional().describe("Server image number to filter compatible specs (from ncloud_get_server_images)"),
      serverSpecCodeList: z.array(z.string()).optional().describe("Filter by server spec codes (e.g., c2-g3, m2-g2-h100)"),
      hypervisorTypeCodeList: z.array(z.string()).optional().describe("Filter by hypervisor type (XEN | KVM)"),
      zoneCode: z.string().optional().describe("Filter by zone code"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getServerSpecList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_member_server_image_list",
    "List member server images (custom images created from running servers)",
    {
      memberServerImageInstanceNoList: z.array(z.string()).optional().describe("Filter by member server image instance numbers"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getMemberServerImageInstanceList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Create Tools ──────────────────────────────────────────────────────────

  server.tool(
    "ncloud_create_server",
    "Create a new server instance. For KVM (Gen3): use serverImageNo + serverSpecCode. For XEN (Gen2): use serverImageProductCode + serverProductCode, or serverImageNo + serverSpecCode. Use dryRun=true to preview without creating.",
    {
      serverImageNo: z.string().optional().describe("Server image number from ncloud_get_server_images (required for KVM/Gen3)"),
      serverImageProductCode: z.string().optional().describe("Server image product code (legacy, XEN/RHV only)"),
      memberServerImageInstanceNo: z.string().optional().describe("Member server image instance number (custom image)"),
      serverSpecCode: z.string().optional().describe("Server spec code from ncloud_get_server_specs (required for KVM/Gen3, e.g., c2-g3, s2-g3)"),
      serverProductCode: z.string().optional().describe("Server product code (legacy, XEN/RHV only, use with serverImageProductCode)"),
      vpcNo: z.string().describe("VPC number"),
      subnetNo: z.string().describe("Subnet number"),
      serverName: z.string().optional().describe("Server name (lowercase+numbers+hyphen, 3-30 chars)"),
      serverDescription: z.string().optional().describe("Server description"),
      loginKeyName: z.string().optional().describe("Login key name for SSH access"),
      initScriptNo: z.string().optional().describe("Init script number"),
      feeSystemTypeCode: z.string().optional().describe("Fee system type (MTRAT: hourly, FXSUM: monthly)"),
      associateWithPublicIp: z.boolean().optional().describe("Associate a new public IP on creation"),
      isProtectServerTermination: z.boolean().optional().describe("Enable termination protection"),
      placementGroupNo: z.string().optional().describe("Placement group number"),
      networkInterfaceList: z.array(z.object({
        networkInterfaceOrder: z.number().describe("Network interface order (0 for primary)"),
        accessControlGroupNoList: z.array(z.string()).optional().describe("ACG numbers for this NIC (max 3)"),
        subnetNo: z.string().optional().describe("Subnet number for this NIC"),
        ip: z.string().optional().describe("Specific IP address for this NIC"),
      })).optional().describe("Network interface configuration list"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the server"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: Server Creation",
            serverImageNo: params.serverImageNo ?? "(not specified)",
            serverImageProductCode: params.serverImageProductCode ?? "(not specified)",
            memberServerImageInstanceNo: params.memberServerImageInstanceNo ?? "(not specified)",
            serverSpecCode: params.serverSpecCode ?? "(not specified)",
            serverProductCode: params.serverProductCode ?? "(not specified)",
            vpcNo: params.vpcNo,
            subnetNo: params.subnetNo,
            serverName: params.serverName ?? "(auto-generated)",
            loginKeyName: params.loginKeyName ?? "(none)",
            initScriptNo: params.initScriptNo ?? "(none)",
            feeSystemTypeCode: params.feeSystemTypeCode ?? "MTRAT",
            message: "이 요청은 실제 서버를 생성하지 않습니다. dryRun=false로 호출하면 서버가 생성됩니다.",
            hint_KVM: "KVM(Gen3) 서버: serverImageNo + serverSpecCode 조합 필수",
            hint_XEN: "XEN(Gen2) 서버: serverImageProductCode + serverProductCode 또는 serverImageNo + serverSpecCode",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }

        const { dryRun, networkInterfaceList, ...apiParams } = params;
        const requestParams: any = { ...apiParams };

        if (networkInterfaceList) {
          for (let i = 0; i < networkInterfaceList.length; i++) {
            const nic = networkInterfaceList[i];
            requestParams[`networkInterfaceList.${i + 1}.networkInterfaceOrder`] = nic.networkInterfaceOrder;
            if (nic.accessControlGroupNoList) {
              for (let j = 0; j < nic.accessControlGroupNoList.length; j++) {
                requestParams[`networkInterfaceList.${i + 1}.accessControlGroupNoList.${j + 1}`] = nic.accessControlGroupNoList[j];
              }
            }
            if (nic.subnetNo) {
              requestParams[`networkInterfaceList.${i + 1}.subnetNo`] = nic.subnetNo;
            }
            if (nic.ip) {
              requestParams[`networkInterfaceList.${i + 1}.ip`] = nic.ip;
            }
          }
        }

        const result = await client.request("/vserver/v2/createServerInstances", requestParams);
        const instance = result.serverInstanceList?.[0];
        const summary = {
          리소스타입: "Server",
          리소스ID: instance?.serverInstanceNo ?? "unknown",
          리소스명: instance?.serverName ?? params.serverName ?? "unknown",
          상태: instance?.serverInstanceStatus?.codeName ?? "creating",
          생성시각: instance?.createDate ?? new Date().toISOString(),
          서버스펙: params.serverSpecCode ?? params.serverProductCode ?? "default",
          이미지: params.serverImageNo ?? params.serverImageProductCode ?? params.memberServerImageInstanceNo ?? "unknown",
          VPC: params.vpcNo,
          서브넷: params.subnetNo,
          사설IP: instance?.privateIp ?? "pending",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_create_server_image",
    "Create a server image from an existing server instance",
    {
      serverInstanceNo: z.string().describe("Server instance number to create image from"),
      serverImageName: z.string().optional().describe("Name for the new server image"),
      serverImageDescription: z.string().optional().describe("Description for the new server image"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/createServerImage", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_create_member_server_image",
    "Create a member server image from a running server instance",
    {
      serverInstanceNo: z.string().describe("Server instance number to create member image from"),
      memberServerImageName: z.string().optional().describe("Name for the member server image"),
      memberServerImageDescription: z.string().optional().describe("Description for the member server image"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/createMemberServerImageInstance", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Operation Tools (non-destructive) ─────────────────────────────────────

  server.tool(
    "ncloud_start_server",
    "Start one or more stopped server instances",
    {
      serverInstanceNoList: z.array(z.string()).min(1).describe("List of server instance numbers to start"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/startServerInstances", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_stop_server",
    "Stop one or more running server instances",
    {
      serverInstanceNoList: z.array(z.string()).min(1).describe("List of server instance numbers to stop"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/stopServerInstances", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_reboot_server",
    "Reboot one or more running server instances",
    {
      serverInstanceNoList: z.array(z.string()).min(1).describe("List of server instance numbers to reboot"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/rebootServerInstances", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_change_server_spec",
    "Change the server spec (product code) of a stopped server instance",
    {
      serverInstanceNo: z.string().describe("Server instance number to change spec"),
      serverProductCode: z.string().describe("New server product code"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/changeServerInstanceSpec", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_set_protect_termination",
    "Set or unset termination protection on a server instance",
    {
      serverInstanceNo: z.string().describe("Server instance number"),
      isProtectServerTermination: z.boolean().describe("Whether to enable termination protection"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/setProtectServerTermination", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Destructive Tools (with confirm gate) ─────────────────────────────────

  server.tool(
    "ncloud_terminate_server",
    "⚠️ Destructive: Permanently terminate (delete) one or more server instances. Set confirm=true to execute.",
    {
      serverInstanceNoList: z.array(z.string()).min(1).describe("List of server instance numbers to terminate"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently terminate Server [${params.serverInstanceNoList.join(", ")}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vserver/v2/terminateServerInstances", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_delete_server_images",
    "⚠️ Destructive: Delete one or more server image instances. Set confirm=true to execute.",
    {
      serverImageInstanceNoList: z.array(z.string()).min(1).describe("List of server image instance numbers to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete ServerImage [${params.serverImageInstanceNoList.join(", ")}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vserver/v2/deleteServerImageInstances", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_delete_member_server_images",
    "⚠️ Destructive: Delete one or more member server image instances. Set confirm=true to execute.",
    {
      memberServerImageInstanceNoList: z.array(z.string()).min(1).describe("List of member server image instance numbers to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete MemberServerImage [${params.memberServerImageInstanceNoList.join(", ")}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vserver/v2/deleteMemberServerImageInstances", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Server Instance — Additional APIs ─────────────────────────────────────

  server.tool(
    "ncloud_get_root_password_list",
    "List server instances that can retrieve root password",
    {
      rootPasswordServerInstanceNoList: z.array(z.string()).optional().describe("Filter by server instance numbers for root password retrieval"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getRootPasswordServerInstanceList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_interrupt_server",
    "Interrupt a server instance for diagnostics of abnormal behavior",
    {
      serverInstanceNo: z.string().describe("Server instance number to interrupt"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/interruptServerInstance", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Server Image — Additional APIs ────────────────────────────────────────

  server.tool(
    "ncloud_get_server_image_detail",
    "Get detailed information about a specific server image",
    {
      serverImageNo: z.string().describe("Server image number to query"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getServerImageDetail", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_create_server_image_from_snapshot",
    "Create a server image from block storage snapshots",
    {
      originalServerImageNo: z.string().describe("Original server image number"),
      blockStorageSnapshotInstanceNoList: z.array(z.string()).min(1).describe("List of block storage snapshot instance numbers"),
      serverImageName: z.string().optional().describe("Name for the new server image"),
      serverImageDescription: z.string().optional().describe("Description for the new server image"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/createServerImageFromSnapshot", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_member_server_image_detail",
    "Get detailed information about a member server image instance",
    {
      memberServerImageInstanceNo: z.string().describe("Member server image instance number to query"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getMemberServerImageInstanceDetail", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Image Sharing Permission APIs ─────────────────────────────────────────

  server.tool(
    "ncloud_add_server_image_sharing",
    "Add sharing permission for a server image to specified accounts",
    {
      serverImageNo: z.string().describe("Server image number to share"),
      targetLoginIdList: z.array(z.string()).min(1).describe("List of target login IDs to grant sharing permission"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/addServerImageSharingPermission", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_remove_server_image_sharing",
    "⚠️ DESTRUCTIVE: Remove sharing permission for a server image. Set confirm=true to execute.",
    {
      serverImageNo: z.string().describe("Server image number to remove sharing from"),
      targetLoginIdList: z.array(z.string()).min(1).describe("List of target login IDs to revoke sharing permission"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will remove sharing permission for ServerImage [${params.serverImageNo}] from accounts [${params.targetLoginIdList.join(", ")}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vserver/v2/removeServerImageSharingPermission", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_add_member_server_image_sharing",
    "Add sharing permission for a member server image to specified accounts",
    {
      memberServerImageInstanceNo: z.string().describe("Member server image instance number to share"),
      targetLoginIdList: z.array(z.string()).min(1).describe("List of target login IDs to grant sharing permission"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/addMemberServerImageSharingPermission", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_set_member_server_image_sharing",
    "Set sharing permission for a member server image (replaces existing permissions)",
    {
      memberServerImageInstanceNo: z.string().describe("Member server image instance number"),
      targetLoginIdList: z.array(z.string()).min(1).describe("List of target login IDs to set as sharing permission (replaces existing)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/setMemberServerImageSharingPermission", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_remove_member_server_image_sharing",
    "⚠️ DESTRUCTIVE: Remove sharing permission for a member server image. Set confirm=true to execute.",
    {
      memberServerImageInstanceNo: z.string().describe("Member server image instance number to remove sharing from"),
      targetLoginIdList: z.array(z.string()).min(1).describe("List of target login IDs to revoke sharing permission"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will remove sharing permission for MemberServerImage [${params.memberServerImageInstanceNo}] from accounts [${params.targetLoginIdList.join(", ")}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vserver/v2/removeMemberServerImageSharingPermission", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

}
