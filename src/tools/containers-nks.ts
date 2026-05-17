import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

/**
 * NKS (Ncloud Kubernetes Service) API Tools
 *
 * Base URL: https://nks.apigw.ntruss.com
 * API Style: RESTful (GET/POST/PATCH/PUT/DELETE with JSON body)
 * Auth: x-ncp-apigw-timestamp, x-ncp-iam-access-key, x-ncp-apigw-signature-v2, Content-Type: application/json
 *
 * NOTE: NKS API does NOT use responseFormatType=json (always returns JSON).
 * All requests use client.requestRaw() instead of client.request().
 */
export function registerContainersNksTools(server: McpServer, client: NcloudClient): void {
  // ─── Cluster Query Tools ───────────────────────────────────────────────────

  server.tool(
    "ncloud_nks_list_clusters",
    "List all NKS (Ncloud Kubernetes Service) clusters in the current region",
    {},
    async () => {
      try {
        const result = await client.requestRaw("GET", "/vnks/v2/clusters");
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_get_cluster",
    "Get detailed information about a specific NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster to query"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/vnks/v2/clusters/${params.clusterUuid}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Cluster Create Tool ───────────────────────────────────────────────────

  server.tool(
    "ncloud_nks_create_cluster",
    "Create a new NKS Kubernetes cluster. Use dryRun=true to preview without creating. Requires loginKeyName, regionCode, vpcNo, subnetNoList, lbPublicSubnetNo.",
    {
      name: z.string({ required_error: "필수 파라미터 'name'이 누락되었습니다." }).describe("Cluster name (3-30 chars, lowercase+numbers+'-')"),
      clusterType: z.string({ required_error: "필수 파라미터 'clusterType'이 누락되었습니다." }).describe("Cluster type (e.g., SVR.VNKS.STAND.C004.M016.G003)"),
      loginKeyName: z.string({ required_error: "필수 파라미터 'loginKeyName'이 누락되었습니다." }).describe("Login key name for node access"),
      regionCode: z.string({ required_error: "필수 파라미터 'regionCode'가 누락되었습니다." }).describe("Region code (e.g., KR, SGN, JPN)"),
      vpcNo: z.number({ required_error: "필수 파라미터 'vpcNo'가 누락되었습니다." }).describe("VPC number"),
      subnetNoList: z.array(z.number(), { required_error: "필수 파라미터 'subnetNoList'가 누락되었습니다." }).describe("Subnet number list for the cluster"),
      lbPublicSubnetNo: z.number({ required_error: "필수 파라미터 'lbPublicSubnetNo'가 누락되었습니다." }).describe("Load balancer public subnet number"),
      k8sVersion: z.string().optional().describe("Kubernetes version (from ncloud_nks_get_versions)"),
      hypervisorCode: z.string().optional().describe("Hypervisor code: XEN (default) or KVM"),
      zoneCode: z.string().optional().describe("Zone code (e.g., KR-1). Not needed if isRegional=true"),
      lbPrivateSubnetNo: z.number().optional().describe("Load balancer private subnet number"),
      isRegional: z.boolean().optional().describe("Multi-zone (Regional) cluster. Default: false"),
      publicNetwork: z.boolean().optional().describe("Subnet network type. true=Public, false=Private (default)"),
      log: z.object({ audit: z.boolean().optional() }).optional().describe("Log settings (audit log)"),
      nodePool: z.array(z.object({
        name: z.string().optional().describe("Node pool name"),
        nodeCount: z.number().optional().describe("Number of nodes"),
        softwareCode: z.string().optional().describe("Server image code (from ncloud_nks_get_server_images)"),
        productCode: z.string().optional().describe("Product code (XEN only)"),
        serverSpecCode: z.string().optional().describe("Server spec code (KVM only, from ncloud_nks_get_server_specs)"),
        storageSize: z.number().optional().describe("Storage size in GB (KVM only, 100-2000)"),
        labels: z.array(z.object({ key: z.string(), value: z.string() })).optional().describe("Node labels"),
        taints: z.array(z.object({ key: z.string(), value: z.string().optional(), effect: z.string() })).optional().describe("Node taints"),
        serverRoleId: z.string().optional().describe("IAM server role ID"),
        zoneCode: z.string().optional().describe("Zone code (required for Regional clusters)"),
      })).optional().describe("Initial node pool configurations"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: NKS Cluster Creation",
            ...params,
            dryRun: undefined,
            message: "이 요청은 실제 클러스터를 생성하지 않습니다. dryRun=false로 호출하면 클러스터가 생성됩니다.",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }

        const { dryRun, ...body } = params;
        const result = await client.requestRaw("POST", "/vnks/v2/clusters", undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Cluster Delete Tool ───────────────────────────────────────────────────
  // ⚠️ Destructive: DELETE method, confirm=true required, description has warning

  server.tool(
    "ncloud_nks_delete_cluster",
    "⚠️ Destructive: Permanently delete an NKS Kubernetes cluster. Set confirm=true to execute.",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete NKS Cluster [${params.clusterUuid}]. All node pools and workloads will be destroyed.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.requestRaw("DELETE", `/vnks/v2/clusters/${params.clusterUuid}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result ?? { success: true }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Cluster Upgrade Tool ──────────────────────────────────────────────────

  server.tool(
    "ncloud_nks_upgrade_cluster",
    "Upgrade the Kubernetes version of an NKS cluster. Uses PATCH with query parameters.",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster to upgrade"),
      k8sVersion: z.string({ required_error: "필수 파라미터 'k8sVersion'이 누락되었습니다." }).describe("Target Kubernetes version (e.g., 1.27.9-nks.1)"),
      maxSurge: z.number().optional().describe("Max nodes that can be added during upgrade (default: 1)"),
      maxUnavailable: z.number().optional().describe("Max nodes that can be unavailable during upgrade (default: 0)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = { k8sVersion: params.k8sVersion };
        if (params.maxSurge !== undefined) queryParams.maxSurge = String(params.maxSurge);
        if (params.maxUnavailable !== undefined) queryParams.maxUnavailable = String(params.maxUnavailable);
        const result = await client.requestRaw("PATCH", `/vnks/v2/clusters/${params.clusterUuid}/upgrade`, queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Cluster Configuration Tools ──────────────────────────────────────────

  server.tool(
    "ncloud_nks_set_audit_log",
    "Configure audit log collection via Cloud Log Analytics for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      audit: z.boolean({ required_error: "필수 파라미터 'audit'가 누락되었습니다." }).describe("Whether to enable audit log collection (true/false)"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("PATCH", `/vnks/v2/clusters/${params.clusterUuid}/log`, undefined, { audit: params.audit });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_add_subnet",
    "Add subnets to an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      subnetNoList: z.array(z.number(), { required_error: "필수 파라미터 'subnetNoList'가 누락되었습니다." }).describe("List of subnet numbers to add"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("PATCH", `/vnks/v2/clusters/${params.clusterUuid}/subnet`, undefined, { subnetNoList: params.subnetNoList });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_set_oidc",
    "Configure OIDC (OpenID Connect) authentication for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      status: z.boolean({ required_error: "필수 파라미터 'status'가 누락되었습니다." }).describe("OIDC activation status (true=enable, false=disable)"),
      clientId: z.string({ required_error: "필수 파라미터 'clientId'가 누락되었습니다." }).describe("OIDC provider Client ID"),
      issuerURL: z.string({ required_error: "필수 파라미터 'issuerURL'이 누락되었습니다." }).describe("OIDC provider URL"),
      usernameClaim: z.string().optional().describe("JWT claim for username"),
      usernamePrefix: z.string().optional().describe("Prefix for username claim"),
      groupsClaim: z.string().optional().describe("JWT claim for groups"),
      groupsPrefix: z.string().optional().describe("Prefix for groups claim"),
      requiredClaim: z.string().optional().describe("Required claim as key=value pair"),
    },
    async (params) => {
      try {
        const { clusterUuid, ...body } = params;
        const result = await client.requestRaw("PATCH", `/vnks/v2/clusters/${clusterUuid}/oidc`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_get_oidc",
    "Get OIDC (OpenID Connect) provider configuration for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/vnks/v2/clusters/${params.clusterUuid}/oidc`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_get_ip_acl",
    "Get IP ACL configuration for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/vnks/v2/clusters/${params.clusterUuid}/ip-acl`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_set_ip_acl",
    "Configure IP ACL for an NKS cluster to restrict API server access",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      entries: z.array(z.object({
        action: z.string().describe("ACL action (allow or deny)"),
        address: z.string().describe("IP address or CIDR block"),
      }), { required_error: "필수 파라미터 'entries'가 누락되었습니다." }).describe("IP ACL entries"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("PATCH", `/vnks/v2/clusters/${params.clusterUuid}/ip-acl`, undefined, { entries: params.entries });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_set_return_protection",
    "Configure return (deletion) protection for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      returnProtection: z.boolean({ required_error: "필수 파라미터 'returnProtection'이 누락되었습니다." }).describe("Enable/disable deletion protection"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("PATCH", `/vnks/v2/clusters/${params.clusterUuid}/return-protection`, undefined, { returnProtection: params.returnProtection });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_update_lb_subnet",
    "Update load balancer subnet for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      lbPrivateSubnetNo: z.number().optional().describe("New LB private subnet number"),
      lbPublicSubnetNo: z.number().optional().describe("New LB public subnet number"),
    },
    async (params) => {
      try {
        const { clusterUuid, ...body } = params;
        const result = await client.requestRaw("PATCH", `/vnks/v2/clusters/${clusterUuid}/lb-subnet`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_update_secret_encryption",
    "Configure secret encryption for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      kmsKeyTag: z.string().optional().describe("KMS key tag for secret encryption"),
    },
    async (params) => {
      try {
        const { clusterUuid, ...body } = params;
        const result = await client.requestRaw("PATCH", `/vnks/v2/clusters/${clusterUuid}/secret-encryption`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_update_auth_type",
    "Update authentication mode for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      authType: z.string({ required_error: "필수 파라미터 'authType'가 누락되었습니다." }).describe("Auth type: API or CONFIG_MAP"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("PATCH", `/vnks/v2/clusters/${params.clusterUuid}/auth-type`, undefined, { authType: params.authType });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Kubeconfig Tools ──────────────────────────────────────────────────────

  server.tool(
    "ncloud_nks_get_kubeconfig",
    "Retrieve the kubeconfig for a specified NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/vnks/v2/clusters/${params.clusterUuid}/kubeconfig`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_reset_kubeconfig",
    "Reset the kubeconfig credentials for a specified NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("PATCH", `/vnks/v2/clusters/${params.clusterUuid}/kubeconfig`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Worker Node Tools ─────────────────────────────────────────────────────

  server.tool(
    "ncloud_nks_list_worker_nodes",
    "List worker nodes in an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/vnks/v2/clusters/${params.clusterUuid}/nodes`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ⚠️ Destructive: DELETE worker node, confirm=true required
  server.tool(
    "ncloud_nks_delete_worker_node",
    "⚠️ Destructive: Delete a specific worker node from an NKS cluster. Set confirm=true to execute.",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      instanceNo: z.number({ required_error: "필수 파라미터 'instanceNo'가 누락되었습니다." }).describe("Instance number of the worker node to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text: `⚠️ This will permanently delete Worker Node [${params.instanceNo}] from Cluster [${params.clusterUuid}].\n\nTo execute, call this tool again with confirm=true.` }] };
        }
        const result = await client.requestRaw("DELETE", `/vnks/v2/clusters/${params.clusterUuid}/nodes/${params.instanceNo}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result ?? { success: true }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Node Pool Tools ───────────────────────────────────────────────────────

  server.tool(
    "ncloud_nks_list_node_pools",
    "List all node pools in a specified NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/vnks/v2/clusters/${params.clusterUuid}/node-pool`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_create_node_pool",
    "Create a new node pool in an NKS cluster. Use dryRun=true to preview.",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      name: z.string({ required_error: "필수 파라미터 'name'이 누락되었습니다." }).describe("Node pool name"),
      nodeCount: z.number().optional().describe("Number of nodes (required if autoscale not set)"),
      softwareCode: z.string().optional().describe("Server image code"),
      serverSpecCode: z.string().optional().describe("Server spec code (KVM)"),
      storageSize: z.number().optional().describe("Storage size in GB (KVM, 100-2000)"),
      autoscale: z.object({
        enabled: z.boolean().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }).optional().describe("Autoscale configuration"),
      labels: z.array(z.object({ key: z.string(), value: z.string() })).optional().describe("Node labels"),
      taints: z.array(z.object({ key: z.string(), value: z.string().optional(), effect: z.string() })).optional().describe("Node taints"),
      serverRoleId: z.string().optional().describe("IAM server role ID"),
      zoneCode: z.string().optional().describe("Zone code (required for Regional clusters)"),
      dryRun: z.boolean().optional().default(false).describe("If true, preview only"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = { label: "🔍 Dry-Run Preview: Node Pool Creation", ...params, dryRun: undefined, message: "dryRun=false로 호출하면 노드풀이 생성됩니다." };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }
        const { clusterUuid, dryRun, ...body } = params;
        const result = await client.requestRaw("POST", `/vnks/v2/clusters/${clusterUuid}/node-pool`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_update_node_pool",
    "Update node pool settings (node count or autoscale) in an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      instanceNo: z.number({ required_error: "필수 파라미터 'instanceNo'가 누락되었습니다." }).describe("Node pool instance number"),
      nodeCount: z.number().optional().describe("Desired node count (required if autoscale disabled)"),
      autoscale: z.object({
        enabled: z.boolean().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }).optional().describe("Autoscale configuration"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.nodeCount !== undefined) body.nodeCount = params.nodeCount;
        if (params.autoscale !== undefined) body.autoscale = params.autoscale;
        const result = await client.requestRaw("PATCH", `/vnks/v2/clusters/${params.clusterUuid}/node-pool/${params.instanceNo}`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ⚠️ Destructive: DELETE node pool, confirm=true required
  server.tool(
    "ncloud_nks_delete_node_pool",
    "⚠️ Destructive: Permanently delete a node pool from an NKS cluster. Set confirm=true to execute.",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      instanceNo: z.number({ required_error: "필수 파라미터 'instanceNo'가 누락되었습니다." }).describe("Node pool instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text: `⚠️ This will permanently delete Node Pool [${params.instanceNo}] from Cluster [${params.clusterUuid}].\n\nTo execute, call this tool again with confirm=true.` }] };
        }
        const result = await client.requestRaw("DELETE", `/vnks/v2/clusters/${params.clusterUuid}/node-pool/${params.instanceNo}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result ?? { success: true }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Node Pool Label / Taint / Upgrade / Subnet ────────────────────────────

  server.tool(
    "ncloud_nks_update_node_pool_label",
    "Update labels on a node pool in an NKS cluster (PUT replaces all labels)",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      instanceNo: z.number({ required_error: "필수 파라미터 'instanceNo'가 누락되었습니다." }).describe("Node pool instance number"),
      labels: z.array(z.object({
        key: z.string({ required_error: "필수 파라미터 'labels[].key'가 누락되었습니다." }),
        value: z.string({ required_error: "필수 파라미터 'labels[].value'가 누락되었습니다." }),
      }), { required_error: "필수 파라미터 'labels'가 누락되었습니다." }).describe("Label key/value pairs"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("PUT", `/vnks/v2/clusters/${params.clusterUuid}/node-pool/${params.instanceNo}/labels`, undefined, { labels: params.labels });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_update_node_pool_taint",
    "Update taints on a node pool in an NKS cluster (PUT replaces all taints)",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      instanceNo: z.number({ required_error: "필수 파라미터 'instanceNo'가 누락되었습니다." }).describe("Node pool instance number"),
      taints: z.array(z.object({
        key: z.string({ required_error: "필수 파라미터 'taints[].key'가 누락되었습니다." }),
        value: z.string().optional().describe("Taint value"),
        effect: z.string({ required_error: "필수 파라미터 'taints[].effect'가 누락되었습니다." }).describe("NoSchedule | PreferNoSchedule | NoExecute"),
      }), { required_error: "필수 파라미터 'taints'가 누락되었습니다." }).describe("Taint key/value/effect objects"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("PUT", `/vnks/v2/clusters/${params.clusterUuid}/node-pool/${params.instanceNo}/taints`, undefined, { taints: params.taints });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_upgrade_node_pool",
    "Upgrade the Kubernetes version of a node pool. Uses PATCH with query parameters.",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      instanceNo: z.number({ required_error: "필수 파라미터 'instanceNo'가 누락되었습니다." }).describe("Node pool instance number"),
      k8sVersion: z.string({ required_error: "필수 파라미터 'k8sVersion'이 누락되었습니다." }).describe("Target Kubernetes version"),
      maxSurge: z.number().optional().describe("Max nodes added during upgrade (default: 1)"),
      maxUnavailable: z.number().optional().describe("Max unavailable nodes during upgrade (default: 0)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = { k8sVersion: params.k8sVersion };
        if (params.maxSurge !== undefined) queryParams.maxSurge = String(params.maxSurge);
        if (params.maxUnavailable !== undefined) queryParams.maxUnavailable = String(params.maxUnavailable);
        const result = await client.requestRaw("PATCH", `/vnks/v2/clusters/${params.clusterUuid}/node-pool/${params.instanceNo}/upgrade`, queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_update_node_pool_subnet",
    "Update subnet for a node pool in an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      instanceNo: z.number({ required_error: "필수 파라미터 'instanceNo'가 누락되었습니다." }).describe("Node pool instance number"),
      subnetNoList: z.array(z.number(), { required_error: "필수 파라미터 'subnetNoList'가 누락되었습니다." }).describe("New subnet number list"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("PATCH", `/vnks/v2/clusters/${params.clusterUuid}/node-pool/${params.instanceNo}/subnet`, undefined, { subnetNoList: params.subnetNoList });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── IAM Access Entry Tools ────────────────────────────────────────────────

  server.tool(
    "ncloud_nks_list_access_entries",
    "List IAM access entries for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/vnks/v2/clusters/${params.clusterUuid}/access-entry`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_get_access_entry",
    "Get a specific IAM access entry for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      accessEntryNo: z.number({ required_error: "필수 파라미터 'accessEntryNo'가 누락되었습니다." }).describe("Access entry number"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/vnks/v2/clusters/${params.clusterUuid}/access-entry/${params.accessEntryNo}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_create_access_entry",
    "Create an IAM access entry for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      principalArn: z.string().optional().describe("IAM principal ARN"),
      kubernetesGroups: z.array(z.string()).optional().describe("Kubernetes groups"),
      type: z.string().optional().describe("Access entry type"),
    },
    async (params) => {
      try {
        const { clusterUuid, ...body } = params;
        const result = await client.requestRaw("POST", `/vnks/v2/clusters/${clusterUuid}/access-entry`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_update_access_entry",
    "Update an IAM access entry for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      accessEntryNo: z.number({ required_error: "필수 파라미터 'accessEntryNo'가 누락되었습니다." }).describe("Access entry number"),
      kubernetesGroups: z.array(z.string()).optional().describe("Kubernetes groups"),
    },
    async (params) => {
      try {
        const { clusterUuid, accessEntryNo, ...body } = params;
        const result = await client.requestRaw("PATCH", `/vnks/v2/clusters/${clusterUuid}/access-entry/${accessEntryNo}`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ⚠️ Destructive: DELETE access entry, confirm=true required
  server.tool(
    "ncloud_nks_delete_access_entry",
    "⚠️ Destructive: Delete an IAM access entry from an NKS cluster. Set confirm=true to execute.",
    {
      clusterUuid: z.string({ required_error: "필수 파라미터 'clusterUuid'가 누락되었습니다." }).describe("UUID of the cluster"),
      accessEntryNo: z.number({ required_error: "필수 파라미터 'accessEntryNo'가 누락되었습니다." }).describe("Access entry number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text: `⚠️ This will delete IAM Access Entry [${params.accessEntryNo}] from Cluster [${params.clusterUuid}].\n\nTo execute, call this tool again with confirm=true.` }] };
        }
        const result = await client.requestRaw("DELETE", `/vnks/v2/clusters/${params.clusterUuid}/access-entry/${params.accessEntryNo}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result ?? { success: true }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Reference/Query Tools (Versions, Images, Specs) ───────────────────────

  server.tool(
    "ncloud_nks_get_versions",
    "List available Kubernetes versions for NKS cluster creation",
    {
      hypervisorCode: z.string().optional().describe("Hypervisor code filter: XEN (default) or KVM"),
      isRegionalSupport: z.boolean().optional().describe("Filter only Regional (multi-zone) cluster supported versions"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.hypervisorCode) queryParams.hypervisorCode = params.hypervisorCode;
        if (params.isRegionalSupport !== undefined) queryParams.isRegionalSupport = String(params.isRegionalSupport);
        const result = await client.requestRaw("GET", "/vnks/v2/option/version", Object.keys(queryParams).length > 0 ? queryParams : undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_get_server_images",
    "List available server image types for NKS cluster/node pool creation",
    {
      hypervisorCode: z.string().optional().describe("Hypervisor type code filter: XEN (default) or KVM"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.hypervisorCode) queryParams.hypervisorCode = params.hypervisorCode;
        const result = await client.requestRaw("GET", "/vnks/v2/option/server-image", Object.keys(queryParams).length > 0 ? queryParams : undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_nks_get_server_specs",
    "List available server specifications for NKS cluster/node pool creation. Requires softwareCode (from ncloud_nks_get_server_images) and zoneCode or zoneNo.",
    {
      softwareCode: z.string({ required_error: "필수 파라미터 'softwareCode'가 누락되었습니다." }).describe("Server image code (value from ncloud_nks_get_server_images)"),
      zoneCode: z.string().optional().describe("Zone code (e.g., KR-1). Required if zoneNo not provided."),
      zoneNo: z.string().optional().describe("Zone number. Required if zoneCode not provided."),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = { softwareCode: params.softwareCode };
        if (params.zoneCode) queryParams.zoneCode = params.zoneCode;
        if (params.zoneNo) queryParams.zoneNo = params.zoneNo;
        const result = await client.requestRaw("GET", "/vnks/v2/option/server-product-code", queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
