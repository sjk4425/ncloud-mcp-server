import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

export function registerLoadBalancerTools(server: McpServer, client: NcloudClient): void {
  // ─── Load Balancer Query Tools ─────────────────────────────────────────────

  server.tool(
    "ncloud_list_load_balancers",
    "List all load balancer instances in the current region",
    {
      loadBalancerInstanceNoList: z.array(z.string()).optional().describe("Filter by load balancer instance numbers"),
      loadBalancerType: z.string().optional().describe("Filter by LB type (APPLICATION, NETWORK, NETWORK_PROXY)"),
      loadBalancerNetworkType: z.string().optional().describe("Filter by network type (PUBLIC, PRIVATE)"),
      vpcNo: z.string().optional().describe("Filter by VPC number"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      try {
        const result = await client.request("/vloadbalancer/v2/getLoadBalancerInstanceList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_load_balancer_detail",
    "Get detailed information about a specific load balancer instance",
    {
      loadBalancerInstanceNo: z.string().describe("Load balancer instance number to query"),
    },
    async (params) => {
      try {
        const result = await client.request("/vloadbalancer/v2/getLoadBalancerInstanceDetail", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Load Balancer Create Tool ─────────────────────────────────────────────

  server.tool(
    "ncloud_create_load_balancer",
    "Create a new load balancer instance. Use dryRun=true to preview without creating.",
    {
      loadBalancerTypeCode: z.string({
        required_error: "필수 파라미터 'loadBalancerTypeCode'가 누락되었습니다.",
      }).describe("Load balancer type (APPLICATION, NETWORK, NETWORK_PROXY)"),
      loadBalancerNetworkTypeCode: z.string().optional().describe("Network type (PUBLIC or PRIVATE). Default: PUBLIC"),
      loadBalancerName: z.string().max(30, {
        message: "잘못된 파라미터: 'loadBalancerName'은 30자 이하여야 합니다.",
      }).optional().describe("Load balancer name (max 30 characters)"),
      loadBalancerDescription: z.string().optional().describe("Load balancer description"),
      vpcNo: z.string({
        required_error: "필수 파라미터 'vpcNo'가 누락되었습니다.",
      }).describe("VPC number"),
      subnetNoList: z.array(z.string(), {
        required_error: "필수 파라미터 'subnetNoList'가 누락되었습니다.",
      }).describe("List of subnet numbers for the load balancer (one LB-only subnet per zone)"),
      throughputTypeCode: z.string().optional().describe("Throughput type (SMALL, MEDIUM, LARGE, XLARGE for ALB/NProxy; DYNAMIC for NLB)"),
      idleTimeout: z.number().optional().describe("Idle timeout in seconds (1-3600, default: 60). Cannot be set for NETWORK type"),
      listenerList: z.array(z.object({
        protocolTypeCode: z.string().describe("Listener protocol (HTTP, HTTPS, TCP, UDP, TLS)"),
        port: z.number().describe("Listener port number (1-65534)"),
        targetGroupNo: z.string().describe("Target group number for default rule"),
        sslCertificateNo: z.string().optional().describe("SSL certificate number (required for HTTPS/TLS)"),
        useHttp2: z.boolean().optional().describe("Whether to use HTTP/2 protocol (only for HTTPS listener)"),
        tlsMinVersionTypeCode: z.string().optional().describe("TLS minimum version (TLSV10, TLSV11, TLSV12, TLSV13). Only for HTTPS/TLS"),
        cipherSuiteList: z.array(z.string()).optional().describe("List of cipher suites. Only for HTTPS/TLS"),
      }), {
        required_error: "필수 파라미터 'listenerList'가 누락되었습니다.",
      }).describe("List of listener configurations"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the load balancer"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: Load Balancer Creation",
            loadBalancerTypeCode: params.loadBalancerTypeCode,
            loadBalancerNetworkTypeCode: params.loadBalancerNetworkTypeCode ?? "PUBLIC",
            loadBalancerName: params.loadBalancerName ?? "(auto-generated)",
            vpcNo: params.vpcNo,
            subnetNoList: params.subnetNoList,
            listenerCount: params.listenerList.length,
            listeners: params.listenerList.map((l) => `${l.protocolTypeCode}:${l.port} → TG:${l.targetGroupNo}`),
            message: "이 요청은 실제 로드 밸런서를 생성하지 않습니다. dryRun=false로 호출하면 로드 밸런서가 생성됩니다.",
          };
          return toolText(preview);
        }

        const { dryRun, listenerList, subnetNoList, ...restParams } = params;
        const apiParams: Record<string, any> = { ...restParams, subnetNoList };

        // Serialize listenerList for Ncloud API format (loadBalancerListenerList.N.*)
        listenerList.forEach((listener, idx) => {
          const n = idx + 1;
          apiParams[`loadBalancerListenerList.${n}.protocolTypeCode`] = listener.protocolTypeCode;
          apiParams[`loadBalancerListenerList.${n}.port`] = listener.port;
          apiParams[`loadBalancerListenerList.${n}.targetGroupNo`] = listener.targetGroupNo;
          if (listener.sslCertificateNo) {
            apiParams[`loadBalancerListenerList.${n}.sslCertificateNo`] = listener.sslCertificateNo;
          }
          if (listener.useHttp2 !== undefined) {
            apiParams[`loadBalancerListenerList.${n}.useHttp2`] = listener.useHttp2;
          }
          if (listener.tlsMinVersionTypeCode) {
            apiParams[`loadBalancerListenerList.${n}.tlsMinVersionTypeCode`] = listener.tlsMinVersionTypeCode;
          }
          if (listener.cipherSuiteList) {
            listener.cipherSuiteList.forEach((cipher, cIdx) => {
              apiParams[`loadBalancerListenerList.${n}.cipherSuiteList.${cIdx + 1}`] = cipher;
            });
          }
        });

        const result = await client.request("/vloadbalancer/v2/createLoadBalancerInstance", apiParams);
        const instance = result.loadBalancerInstanceList?.[0];
        const summary = {
          리소스타입: "LoadBalancer",
          리소스ID: instance?.loadBalancerInstanceNo ?? "unknown",
          리소스명: instance?.loadBalancerName ?? params.loadBalancerName ?? "unknown",
          상태: instance?.loadBalancerInstanceStatus?.codeName ?? "creating",
          생성시각: instance?.createDate ?? new Date().toISOString(),
          타입: params.loadBalancerTypeCode,
          도메인: instance?.loadBalancerDomain ?? "pending",
          리스너설정: params.listenerList.map((l) => `${l.protocolTypeCode}:${l.port}`).join(", "),
        };
        return toolText(summary);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Load Balancer Destructive Tool ────────────────────────────────────────

  server.tool(
    "ncloud_delete_load_balancers",
    "⚠️ Destructive: Permanently delete load balancer instances. Set confirm=true to execute.",
    {
      loadBalancerInstanceNoList: z.array(z.string(), {
        required_error: "필수 파라미터 'loadBalancerInstanceNoList'가 누락되었습니다.",
      }).describe("List of load balancer instance numbers to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Load Balancer(s) [${params.loadBalancerInstanceNoList.join(", ")}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vloadbalancer/v2/deleteLoadBalancerInstances", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Load Balancer Configuration Tools ──────────────────────────────────────

  server.tool(
    "ncloud_change_lb_config",
    "Change load balancer instance configuration (idle timeout, throughput type)",
    {
      loadBalancerInstanceNo: z.string({
        required_error: "필수 파라미터 'loadBalancerInstanceNo'가 누락되었습니다.",
      }).describe("Load balancer instance number"),
      idleTimeout: z.number().optional().describe("Idle timeout in seconds (1-3600, default: 60). Cannot be set for NETWORK type"),
      throughputTypeCode: z.string().optional().describe("Throughput type code (SMALL, MEDIUM, LARGE, XLARGE for ALB/NProxy; DYNAMIC for NLB)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vloadbalancer/v2/changeLoadBalancerInstanceConfiguration", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_set_lb_description",
    "Set or update the description of a load balancer instance",
    {
      loadBalancerInstanceNo: z.string({
        required_error: "필수 파라미터 'loadBalancerInstanceNo'가 누락되었습니다.",
      }).describe("Load balancer instance number"),
      loadBalancerDescription: z.string({
        required_error: "필수 파라미터 'loadBalancerDescription'이 누락되었습니다.",
      }).describe("New description for the load balancer"),
    },
    async (params) => {
      try {
        const result = await client.request("/vloadbalancer/v2/setLoadBalancerDescription", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_set_lb_subnet",
    "Set subnets for a load balancer instance",
    {
      loadBalancerInstanceNo: z.string({
        required_error: "필수 파라미터 'loadBalancerInstanceNo'가 누락되었습니다.",
      }).describe("Load balancer instance number"),
      subnetNoList: z.array(z.string(), {
        required_error: "필수 파라미터 'subnetNoList'가 누락되었습니다.",
      }).describe("List of subnet numbers to assign to the load balancer"),
    },
    async (params) => {
      try {
        const result = await client.request("/vloadbalancer/v2/setLoadBalancerInstanceSubnet", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Listener Configuration Tools ─────────────────────────────────────────

  server.tool(
    "ncloud_change_lb_listener_config",
    "Change load balancer listener configuration (protocol, port, SSL, TLS settings)",
    {
      loadBalancerListenerNo: z.string({
        required_error: "필수 파라미터 'loadBalancerListenerNo'가 누락되었습니다.",
      }).describe("Load balancer listener number"),
      protocolTypeCode: z.string({
        required_error: "필수 파라미터 'protocolTypeCode'가 누락되었습니다.",
      }).describe("Listener protocol type (HTTP, HTTPS, TCP, UDP, TLS)"),
      port: z.number({
        required_error: "필수 파라미터 'port'가 누락되었습니다.",
      }).describe("Listener port number (1-65534)"),
      useHttp2: z.boolean().optional().describe("Whether to use HTTP/2 protocol (only for HTTPS listener)"),
      sslCertificateNo: z.string().optional().describe("SSL certificate number (required for HTTPS/TLS)"),
      tlsMinVersionTypeCode: z.string().optional().describe("TLS minimum version (TLSV10, TLSV11, TLSV12). Only for HTTPS/TLS"),
      cipherSuiteList: z.array(z.string()).optional().describe("List of cipher suites. Only for HTTPS/TLS"),
    },
    async (params) => {
      try {
        const result = await client.request("/vloadbalancer/v2/changeLoadBalancerListenerConfiguration", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Load Balancer Rule Tools ──────────────────────────────────────────────

  server.tool(
    "ncloud_list_lb_rules",
    "List rules registered to a load balancer listener",
    {
      loadBalancerListenerNo: z.string({
        required_error: "필수 파라미터 'loadBalancerListenerNo'가 누락되었습니다.",
      }).describe("Load balancer listener number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vloadbalancer/v2/getLoadBalancerRuleList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Listener Certificate Tools ────────────────────────────────────────────

  server.tool(
    "ncloud_add_lb_listener_certificate",
    "Add an SNI-based TLS certificate to a load balancer listener",
    {
      loadBalancerListenerNo: z.string({
        required_error: "필수 파라미터 'loadBalancerListenerNo'가 누락되었습니다.",
      }).describe("Load balancer listener number"),
      sslCertificateNo: z.string({
        required_error: "필수 파라미터 'sslCertificateNo'가 누락되었습니다.",
      }).describe("SSL certificate number to add"),
    },
    async (params) => {
      try {
        const result = await client.request("/vloadbalancer/v2/addLoadBalancerListenerCertificate", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_remove_lb_listener_certificate",
    "⚠️ DESTRUCTIVE: Remove an SNI-based TLS certificate from a load balancer listener. Set confirm=true to execute.",
    {
      loadBalancerListenerNo: z.string({
        required_error: "필수 파라미터 'loadBalancerListenerNo'가 누락되었습니다.",
      }).describe("Load balancer listener number"),
      sslCertificateNo: z.string({
        required_error: "필수 파라미터 'sslCertificateNo'가 누락되었습니다.",
      }).describe("SSL certificate number to remove"),
      confirm: z.boolean().optional().default(false).describe("⚠️ DESTRUCTIVE: Must be true to actually execute the certificate removal"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will remove SSL certificate [${params.sslCertificateNo}] from Listener [${params.loadBalancerListenerNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vloadbalancer/v2/removeLoadBalancerListenerCertificate", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_list_lb_listener_certificates",
    "List TLS certificates associated with a load balancer listener",
    {
      loadBalancerListenerNo: z.string({
        required_error: "필수 파라미터 'loadBalancerListenerNo'가 누락되었습니다.",
      }).describe("Load balancer listener number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vloadbalancer/v2/getLoadBalancerListenerCertificateList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Listener Query Tools ──────────────────────────────────────────────────

  server.tool(
    "ncloud_list_lb_listeners",
    "List all listeners for a specific load balancer",
    {
      loadBalancerInstanceNo: z.string({
        required_error: "필수 파라미터 'loadBalancerInstanceNo'가 누락되었습니다.",
      }).describe("Load balancer instance number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vloadbalancer/v2/getLoadBalancerListenerList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Listener Create Tool ──────────────────────────────────────────────────

  server.tool(
    "ncloud_create_lb_listener",
    "Create a new listener for a load balancer",
    {
      loadBalancerInstanceNo: z.string({
        required_error: "필수 파라미터 'loadBalancerInstanceNo'가 누락되었습니다.",
      }).describe("Load balancer instance number"),
      protocolTypeCode: z.string({
        required_error: "필수 파라미터 'protocolTypeCode'가 누락되었습니다.",
      }).describe("Listener protocol type (HTTP, HTTPS, TCP, UDP, TLS)"),
      port: z.number({
        required_error: "필수 파라미터 'port'가 누락되었습니다.",
      }).describe("Listener port number (1-65534)"),
      targetGroupNo: z.string({
        required_error: "필수 파라미터 'targetGroupNo'가 누락되었습니다.",
      }).describe("Target group number for default rule"),
      useHttp2: z.boolean().optional().describe("Whether to use HTTP/2 protocol (only for HTTPS listener)"),
      sslCertificateNo: z.string().optional().describe("SSL certificate number (required for HTTPS/TLS)"),
      tlsMinVersionTypeCode: z.string().optional().describe("TLS minimum version (TLSV10, TLSV11, TLSV12). Only for HTTPS/TLS"),
      cipherSuiteList: z.array(z.string()).optional().describe("List of cipher suites. Only for HTTPS/TLS"),
    },
    async (params) => {
      try {
        const result = await client.request("/vloadbalancer/v2/createLoadBalancerListener", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Listener Destructive Tool ─────────────────────────────────────────────

  server.tool(
    "ncloud_delete_lb_listeners",
    "⚠️ Destructive: Delete listeners from a load balancer. Set confirm=true to execute.",
    {
      loadBalancerInstanceNo: z.string({
        required_error: "필수 파라미터 'loadBalancerInstanceNo'가 누락되었습니다.",
      }).describe("Load balancer instance number"),
      loadBalancerListenerNoList: z.array(z.string(), {
        required_error: "필수 파라미터 'loadBalancerListenerNoList'가 누락되었습니다.",
      }).describe("List of listener numbers to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Listener(s) [${params.loadBalancerListenerNoList.join(", ")}] from Load Balancer [${params.loadBalancerInstanceNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vloadbalancer/v2/deleteLoadBalancerListeners", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
