import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import type { Zone } from "../client/endpoints.js";
import { defineTool } from "./_tool.js";
import { reqField } from "./_zod.js";
import { L, maxLenMessage } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

// 파라미터 규칙은 세 존 가이드(compute-vautoscaling-*) 공통 — 2026-11-21 22개 오퍼레이션 전량 대조.
// 존 차이는 putScheduledUpdateGroupAction 의 desiredCapacity(공공·금융존 Required) 하나뿐이다.

/** Auto Scaling 이름(ASG·정책·일정): 1~255자, 영소문자로 시작, 영소문자·숫자·'-', 영소문자·숫자로 끝. */
const ASG_NAME = /^[a-z](?:[a-z0-9-]{0,253}[a-z0-9])?$/;
/** 서버 이름 Prefix: 3~7자, 규칙은 ASG_NAME 과 같다. */
const SERVER_NAME_PREFIX = /^[a-z][a-z0-9-]{1,5}[a-z0-9]$/;
/** 일정 시각: yyyy-MM-ddTHH:mm:ssZ (예: 2026-12-01T09:00:00+0900). */
const SCHEDULE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})$/;

function asgName(field: string) {
  return z.string().regex(ASG_NAME, {
    message: `${field}: 1-255 chars of lowercase letters, numbers and '-' — start with a letter, end with a letter or number`,
  });
}

/** 용량(min/max/desired): 0~30. */
function capacity(field: string, required = false) {
  const base = required ? z.number(reqField(field)) : z.number();
  return base.int().min(0, { message: `${field}: 0-30` }).max(30, { message: `${field}: 0-30` });
}

function validationError(pair: { ko: string; en: string }) {
  return { content: [{ type: "text" as const, text: L(pair) }], isError: true };
}

/** minSize ≤ desiredCapacity ≤ maxSize (가이드 공통). 위반이면 오류 응답, 아니면 undefined. */
function checkCapacityOrder(p: { minSize?: number; maxSize?: number; desiredCapacity?: number }) {
  if (p.minSize !== undefined && p.maxSize !== undefined && p.minSize > p.maxSize) {
    return validationError({ ko: "❌ minSize 는 maxSize 이하여야 합니다.", en: "❌ minSize must be less than or equal to maxSize." });
  }
  if (p.desiredCapacity !== undefined) {
    if ((p.minSize !== undefined && p.desiredCapacity < p.minSize) || (p.maxSize !== undefined && p.desiredCapacity > p.maxSize)) {
      return validationError({
        ko: "❌ desiredCapacity 는 minSize 이상, maxSize 이하여야 합니다.",
        en: "❌ desiredCapacity must be between minSize and maxSize.",
      });
    }
  }
  return undefined;
}

/** healthCheckTypeCode=LOADB 이면 healthCheckGracePeriod 필수 (가이드 Conditional). */
function checkHealthCheck(p: { healthCheckTypeCode?: string; healthCheckGracePeriod?: number }) {
  if (p.healthCheckTypeCode === "LOADB" && p.healthCheckGracePeriod === undefined) {
    return validationError({
      ko: "❌ healthCheckTypeCode=LOADB 이면 healthCheckGracePeriod(초)가 필수입니다.",
      en: "❌ healthCheckGracePeriod (seconds) is required when healthCheckTypeCode=LOADB.",
    });
  }
  return undefined;
}

export interface AutoScalingToolsOpts {
  /** 공공·금융존은 putScheduledUpdateGroupAction 의 desiredCapacity 가 Required. 기본 pub. */
  zone?: Zone;
}

export function registerAutoScalingTools(server: McpServer, client: NcloudClient, opts: AutoScalingToolsOpts = {}): void {
  const scheduleDesiredRequired = (opts.zone ?? "pub") !== "pub";

  // ─── Launch Configuration Query Tools ──────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_launch_configs",
    "List all launch configurations for Auto Scaling in the current region",
    {
      launchConfigurationNoList: z.array(z.string()).optional().describe("Filter by launch configuration numbers"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/getLaunchConfigurationList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_launch_config_detail",
    "Get detailed information about a specific launch configuration for Auto Scaling",
    {
      launchConfigurationNo: z.string(reqField("launchConfigurationNo")).describe("Launch configuration number to query"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/getLaunchConfigurationDetail", params);
    }
  );

  // ─── Launch Configuration Create Tool ──────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_launch_config",
    // 스펙(세 존 동일, compute-vautoscaling-launchconfiguration-createlaunchconfiguration): 이미지 소스는
    // serverImageProductCode / serverImageNo / memberServerImageInstanceNo 중 **정확히 하나**.
    // 스펙 코드(serverImageProductCode ↔ serverProductCode, serverImageNo ↔ serverSpecCode)는 가이드상 Conditional이지만
    // 실제 API는 생략 시 `900 Required field… serverProductCode or serverSpecNo or serverSpecCode`를 돌려준다(2026-10-01 라이브 확인)
    // → 도구에서 하나를 필수로 검증한다.
    "Create a new launch configuration for Auto Scaling. Exactly one image source must be provided: serverImageProductCode, serverImageNo, or memberServerImageInstanceNo. A server spec is also required: serverImageProductCode → serverProductCode (XEN/RHV); serverImageNo / memberServerImageInstanceNo → serverSpecCode (KVM, see ncloud_get_server_specs). Use dryRun=true to preview without creating.",
    {
      serverImageProductCode: z.string().optional().describe("Server image product code — for a new (public) server image, RHV/XEN. One of serverImageProductCode / serverImageNo / memberServerImageInstanceNo is required."),
      serverImageNo: z.string().optional().describe("Server image number — for a new (public) server image (required path for KVM/Gen3). One of serverImageProductCode / serverImageNo / memberServerImageInstanceNo is required."),
      memberServerImageInstanceNo: z.string().optional().describe("Member server image instance number — for a user-created server image. One of serverImageProductCode / serverImageNo / memberServerImageInstanceNo is required."),
      serverProductCode: z.string().optional().describe("Server product (spec) code — pair with serverImageProductCode (XEN/RHV). One of serverProductCode / serverSpecCode is required (the API rejects a request without a spec)."),
      serverSpecCode: z.string().optional().describe("Server spec code — pair with serverImageNo or memberServerImageInstanceNo (KVM/Gen3, e.g. c2-g3, s2-g3). One of serverProductCode / serverSpecCode is required (the API rejects a request without a spec)."),
      launchConfigurationName: z.string().max(255, {
        message: maxLenMessage("launchConfigurationName", 255),
      }).optional().describe("Launch configuration name (1-255 chars: lowercase letters, digits, '-'; auto-generated when omitted)"),
      loginKeyName: z.string().optional().describe("Login key name for SSH access (defaults to the most recently created key)"),
      initScriptNo: z.string().optional().describe("Init script number to run on first boot"),
      isEncryptedVolume: z.boolean().optional().describe("Whether to encrypt the root volume (RHV only)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      const imageSources = [
        params.serverImageProductCode,
        params.serverImageNo,
        params.memberServerImageInstanceNo,
      ].filter((v) => v !== undefined && v !== "");
      if (imageSources.length === 0) {
        return {
          content: [{ type: "text" as const, text: "One image source is required: provide exactly one of serverImageProductCode, serverImageNo, or memberServerImageInstanceNo." }],
          isError: true,
        };
      }
      if (imageSources.length > 1) {
        return {
          content: [{ type: "text" as const, text: "Only one image source may be provided. Choose exactly one of serverImageProductCode, serverImageNo, or memberServerImageInstanceNo." }],
          isError: true,
        };
      }
      if (!params.serverProductCode && !params.serverSpecCode) {
        return {
          content: [{ type: "text" as const, text: "A server spec is required: provide serverSpecCode (with serverImageNo / memberServerImageInstanceNo; see ncloud_get_server_specs) or serverProductCode (with serverImageProductCode). The API rejects a launch configuration without a spec (error 900)." }],
          isError: true,
        };
      }
      const imageSource =
        params.serverImageProductCode !== undefined ? `serverImageProductCode=${params.serverImageProductCode}` :
        params.serverImageNo !== undefined ? `serverImageNo=${params.serverImageNo}` :
        `memberServerImageInstanceNo=${params.memberServerImageInstanceNo}`;

      const { dryRun, ...apiParams } = params;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Launch Configuration Creation",
          endpoint: "/vautoscaling/v2/createLaunchConfiguration",
          requestParams: apiParams,
          noun: { ko: "런치 설정", en: "launch configuration" },
          notes: {
            imageSource,
            serverSpec: params.serverSpecCode ?? params.serverProductCode,
          },
        });
      }
      const result = await client.request("/vautoscaling/v2/createLaunchConfiguration", apiParams);
      return result;
    }
  );

  // ─── Launch Configuration Destructive Tool ─────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_launch_config",
    "⚠️ Destructive: Permanently delete a launch configuration. Set confirm=true to execute.",
    {
      launchConfigurationNo: z.string(reqField("launchConfigurationNo")).describe("Launch configuration number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vautoscaling/v2/deleteLaunchConfiguration", apiParams);
      return result;
    },
    { destructive: { noun: "LaunchConfiguration", describe: (params) => params.launchConfigurationNo } }
  );

  // ─── Auto Scaling Group Query Tools ────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_asgs",
    "List all Auto Scaling Groups in the current region",
    {
      autoScalingGroupNoList: z.array(z.string()).optional().describe("Filter by Auto Scaling Group numbers"),
      // 가이드 파라미터는 autoScalingGroupNameList.N — 예전 단수형 autoScalingGroupName 은 API 가 무시해 전체 목록이 나왔다.
      autoScalingGroupNameList: z.array(z.string()).optional().describe("Filter by Auto Scaling Group names"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/getAutoScalingGroupList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_asg_detail",
    "Get detailed information about a specific Auto Scaling Group",
    {
      autoScalingGroupNo: z.string(reqField("autoScalingGroupNo")).describe("Auto Scaling Group number to query"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/getAutoScalingGroupDetail", params);
    }
  );

  // ─── Auto Scaling Group Create Tool ────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_asg",
    // 가이드(세 존 공통): vpcNo·subnetNo(단일 값)·accessControlGroupNoList(1~3) 필수, 쿨다운 키는 defaultCoolDown.
    // 예전 스키마는 vpcNo 가 없고 subnetNoList·defaultCooldown 을 보내 `900 Required field … vpcNo` 로 생성 자체가 불가했다.
    "Create a new Auto Scaling Group (VPC). Requires a launch configuration, one subnet (subnetNo) and 1-3 ACGs. vpcNo is looked up from the subnet when omitted. For load-balancer health checks set healthCheckTypeCode=LOADB with healthCheckGracePeriod and targetGroupNoList. Use dryRun=true to preview without creating.",
    {
      launchConfigurationNo: z.string(reqField("launchConfigurationNo")).describe("Launch configuration number to use (from ncloud_list_launch_configs)"),
      autoScalingGroupName: asgName("autoScalingGroupName").max(255, {
        message: maxLenMessage("autoScalingGroupName", 255),
      }).optional().describe("Auto Scaling Group name (1-255 chars: lowercase letters, digits, '-'; start with a letter, end with a letter or digit; auto-generated when omitted)"),
      vpcNo: z.string().optional().describe("VPC number. Optional: when omitted, the tool reads it from subnetNo (ncloud_get_subnet_detail)."),
      subnetNo: z.string(reqField("subnetNo")).describe("Subnet number for the servers (a single subnet — the API takes one value)"),
      accessControlGroupNoList: z.array(z.string(), reqField("accessControlGroupNoList")).min(1, { message: "accessControlGroupNoList: 1-3 ACG numbers" })
        .max(3, { message: "accessControlGroupNoList: 1-3 ACG numbers" })
        .describe("ACG numbers applied to servers created by scale-out (1-3)"),
      minSize: capacity("minSize", true).describe("Minimum number of servers (0-30, ≤ maxSize; 0 keeps no servers)"),
      maxSize: capacity("maxSize", true).describe("Maximum number of servers (0-30, ≥ minSize)"),
      desiredCapacity: capacity("desiredCapacity").optional().describe("Desired number of servers (between minSize and maxSize; defaults to minSize)"),
      defaultCoolDown: z.number().int().min(0).optional().describe("Default cooldown in seconds (default 300)"),
      healthCheckTypeCode: z.enum(["SVR", "LOADB"]).optional().describe("Health check type: SVR (server, default) or LOADB (load balancer — requires healthCheckGracePeriod)"),
      healthCheckGracePeriod: z.number().int().min(0).optional().describe("Health check grace period in seconds (default 300). Required when healthCheckTypeCode=LOADB."),
      targetGroupNoList: z.array(z.string()).optional().describe("Target group numbers to attach. Only valid with healthCheckTypeCode=LOADB."),
      serverNamePrefix: z.string().regex(SERVER_NAME_PREFIX, {
        message: "serverNamePrefix: 3-7 chars of lowercase letters, numbers and '-' — start with a letter, end with a letter or number",
      }).optional().describe("Server name prefix (3-7 chars: lowercase letters, digits, '-'). Servers are named {prefix}-{random}."),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      const invalid = checkCapacityOrder(params) ?? checkHealthCheck(params);
      if (invalid) return invalid;
      // 가이드: targetGroupNoList 는 LOADB 일 때만 유효 — SVR 이면 조용히 무시돼 LB 에 붙지 않는다.
      if (params.targetGroupNoList?.length && params.healthCheckTypeCode !== "LOADB") {
        return validationError({
          ko: "❌ targetGroupNoList 는 healthCheckTypeCode=LOADB 일 때만 적용됩니다. LOADB 와 healthCheckGracePeriod 를 함께 지정하세요.",
          en: "❌ targetGroupNoList only applies with healthCheckTypeCode=LOADB. Set LOADB together with healthCheckGracePeriod.",
        });
      }

      const { dryRun, ...apiParams } = params;
      let vpcNoSource: string | undefined;
      if (!apiParams.vpcNo) {
        // 서브넷 조회는 읽기 전용이라 dryRun 에서도 수행 — 프리뷰가 실제 요청과 같아진다.
        const subnet = (await client.request("/vpc/v2/getSubnetDetail", { subnetNo: apiParams.subnetNo }))?.subnetList?.[0];
        if (!subnet?.vpcNo) {
          return validationError({
            ko: `❌ 서브넷 [${apiParams.subnetNo}]을(를) 찾을 수 없어 vpcNo 를 정할 수 없습니다. subnetNo 를 확인하거나 vpcNo 를 직접 지정하세요.`,
            en: `❌ Subnet [${apiParams.subnetNo}] was not found, so vpcNo could not be determined. Check subnetNo or pass vpcNo.`,
          });
        }
        apiParams.vpcNo = String(subnet.vpcNo);
        vpcNoSource = `subnet ${apiParams.subnetNo}`;
      }
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Auto Scaling Group Creation",
          endpoint: "/vautoscaling/v2/createAutoScalingGroup",
          requestParams: apiParams,
          noun: { ko: "Auto Scaling Group", en: "Auto Scaling Group" },
          ...(vpcNoSource ? { notes: { vpcNoFrom: vpcNoSource } } : {}),
        });
      }
      const result = await client.request("/vautoscaling/v2/createAutoScalingGroup", apiParams);
      return result;
    }
  );

  // ─── Auto Scaling Group Destructive Tool ───────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_asg",
    "⚠️ Destructive: Permanently delete an Auto Scaling Group. Set confirm=true to execute.",
    {
      autoScalingGroupNo: z.string(reqField("autoScalingGroupNo")).describe("Auto Scaling Group number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vautoscaling/v2/deleteAutoScalingGroup", apiParams);
      return result;
    },
    { destructive: { noun: "AutoScalingGroup", describe: (params) => params.autoScalingGroupNo } }
  );

  // ─── Auto Scaling Group Operation Tools ────────────────────────────────────

  defineTool(
    server,
    "ncloud_set_desired_capacity",
    "Set the desired capacity for an Auto Scaling Group",
    {
      autoScalingGroupNo: z.string(reqField("autoScalingGroupNo")).describe("Auto Scaling Group number"),
      desiredCapacity: z.number(reqField("desiredCapacity")).min(0).describe("Desired number of instances"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/setDesiredCapacity", params);
    }
  );

  // ─── Scaling Policy Tools ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_put_scaling_policy",
    // 가이드: 정책 생성은 새 policyName, 수정은 policyNo 또는 기존 policyName. 쿨다운 키는 coolDown(예전 cooldown 은 무시됐다).
    "Create or update a scaling policy for an Auto Scaling Group. A new policyName creates a policy; to update, pass policyNo or the existing policyName.",
    {
      autoScalingGroupNo: z.string(reqField("autoScalingGroupNo")).describe("Auto Scaling Group number"),
      policyNo: z.string().optional().describe("Policy number to update (from ncloud_list_scaling_policies). Omit when creating."),
      policyName: asgName("policyName").optional().describe("Policy name (1-255 chars: lowercase letters, digits, '-'). A new name creates a policy; an existing name updates it. One of policyNo / policyName is required."),
      adjustmentTypeCode: z.enum(["CHANG", "PRCNT", "EXACT"], reqField("adjustmentTypeCode")).describe("Adjustment type: CHANG (add/remove N servers), PRCNT (change by N percent), EXACT (set capacity to N). See ncloud_get_adjustment_types."),
      scalingAdjustment: z.number(reqField("scalingAdjustment")).int().describe("Adjustment value: CHANG ≥ -2147483648, PRCNT ≥ -100, EXACT ≥ 0; negative values scale in for CHANG/PRCNT"),
      minAdjustmentStep: z.number().int().min(1).optional().describe("Minimum adjustment step (servers). Only valid with adjustmentTypeCode=PRCNT."),
      coolDown: z.number().int().min(0).optional().describe("Cooldown in seconds after scaling (default 300)"),
    },
    async (params) => {
      if (!params.policyNo && !params.policyName) {
        return validationError({
          ko: "❌ policyNo 또는 policyName 중 하나가 필요합니다(생성은 새 policyName, 수정은 policyNo 또는 기존 policyName).",
          en: "❌ One of policyNo or policyName is required (a new policyName creates; policyNo or an existing policyName updates).",
        });
      }
      return client.request("/vautoscaling/v2/putScalingPolicy", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_scaling_policies",
    "List all scaling policies for an Auto Scaling Group (includes each policy's policyNo)",
    {
      autoScalingGroupNo: z.string(reqField("autoScalingGroupNo")).describe("Auto Scaling Group number"),
      // 가이드에 페이지 파라미터는 없다 — 필터는 policyNoList.N 뿐.
      policyNoList: z.array(z.string()).optional().describe("Filter by policy numbers"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/getAutoScalingPolicyList", params);
    }
  );

  defineTool(
    server,
    "ncloud_delete_scaling_policy",
    "⚠️ Destructive: Delete a scaling policy from an Auto Scaling Group. Set confirm=true to execute.",
    {
      autoScalingGroupNo: z.string(reqField("autoScalingGroupNo")).describe("Auto Scaling Group number"),
      // 가이드: 식별자는 policyNo(Required). 예전 policyName 은 API 파라미터가 아니었다.
      policyNo: z.string(reqField("policyNo")).describe("Scaling policy number to delete (from ncloud_list_scaling_policies)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vautoscaling/v2/deleteScalingPolicy", apiParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete ScalingPolicy [${params.policyNo}] from AutoScalingGroup [${params.autoScalingGroupNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Auto Scaling Group Update Tool ────────────────────────────────────────

  defineTool(
    server,
    "ncloud_update_asg",
    // 가이드: minSize·maxSize 는 수정 때도 Required(나머지는 생략 시 기존 값 유지). Scaling 진행 중이면 실패한다.
    "Update an existing Auto Scaling Group. minSize and maxSize are always required (pass the current values to keep them — see ncloud_get_asg_detail); other omitted fields keep their current values. Fails while the group is scaling. A new launch configuration applies only to servers created afterwards.",
    {
      autoScalingGroupNo: z.string(reqField("autoScalingGroupNo")).describe("Auto Scaling Group number to update"),
      launchConfigurationNo: z.string().optional().describe("New launch configuration number (applies to servers created after the update)"),
      serverNamePrefix: z.string().regex(SERVER_NAME_PREFIX, {
        message: "serverNamePrefix: 3-7 chars of lowercase letters, numbers and '-' — start with a letter, end with a letter or number",
      }).optional().describe("New server name prefix (3-7 chars: lowercase letters, digits, '-')"),
      minSize: capacity("minSize", true).describe("Minimum number of servers (0-30, ≤ maxSize). Required by the API even when unchanged."),
      maxSize: capacity("maxSize", true).describe("Maximum number of servers (0-30, ≥ minSize). Required by the API even when unchanged."),
      desiredCapacity: capacity("desiredCapacity").optional().describe("Desired number of servers (between minSize and maxSize)"),
      defaultCoolDown: z.number().int().min(0).optional().describe("Default cooldown in seconds"),
      healthCheckTypeCode: z.enum(["SVR", "LOADB"]).optional().describe("Health check type: SVR (server) or LOADB (load balancer — requires healthCheckGracePeriod)"),
      healthCheckGracePeriod: z.number().int().min(0).optional().describe("Health check grace period in seconds. Required when healthCheckTypeCode=LOADB."),
    },
    async (params) => {
      const invalid = checkCapacityOrder(params) ?? checkHealthCheck(params);
      if (invalid) return invalid;
      return client.request("/vautoscaling/v2/updateAutoScalingGroup", params);
    }
  );

  // ─── Execute Scaling Policy Tool ───────────────────────────────────────────

  defineTool(
    server,
    "ncloud_execute_policy",
    "Manually execute a scaling policy for an Auto Scaling Group",
    {
      autoScalingGroupNo: z.string(reqField("autoScalingGroupNo")).describe("Auto Scaling Group number"),
      // 가이드: 식별자는 policyNo(Required). 예전 policyName 은 API 파라미터가 아니었다.
      policyNo: z.string(reqField("policyNo")).describe("Scaling policy number to execute (from ncloud_list_scaling_policies)"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/executePolicy", params);
    }
  );

  // ─── Auto Scaling Activity Log Tool ────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_asg_activity_logs",
    "List activity logs (scaling actions) for an Auto Scaling Group",
    {
      autoScalingGroupNo: z.string(reqField("autoScalingGroupNo")).describe("Auto Scaling Group number"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/getAutoScalingActivityLogList", params);
    }
  );

  // ─── Suspend/Resume Processes Tools ────────────────────────────────────────

  defineTool(
    server,
    "ncloud_suspend_processes",
    "Suspend specific scaling processes for an Auto Scaling Group",
    {
      autoScalingGroupNo: z.string(reqField("autoScalingGroupNo")).describe("Auto Scaling Group number"),
      scalingProcessCodeList: z.array(z.string(), reqField("scalingProcessCodeList")).min(1).describe("List of scaling process codes to suspend"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/suspendProcesses", params);
    }
  );

  defineTool(
    server,
    "ncloud_resume_processes",
    "Resume previously suspended scaling processes for an Auto Scaling Group. Note: Ncloud suspends LAUNCH automatically (administrative suspension) after repeated server-creation failures — spec not offered in the zone, Launch Configuration / image / snapshot problems, server quota exceeded, or repeated failures from a custom image; the cases were expanded on 2026-11-24 and the account now gets an email. It does not resume by itself: fix the cause first, then resume LAUNCH (the guide shows the console Process tab; this tool calls resumeProcesses)",
    {
      autoScalingGroupNo: z.string(reqField("autoScalingGroupNo")).describe("Auto Scaling Group number"),
      scalingProcessCodeList: z.array(z.string(), reqField("scalingProcessCodeList")).min(1).describe("List of scaling process codes to resume"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/resumeProcesses", params);
    }
  );

  // ─── Scheduled Action Tools ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_put_scheduled_action",
    // 가이드: minSize·maxSize Required(공공·금융존은 desiredCapacity 도), 반복은 recurrence + timeZone(KST|UTC).
    // 예전 recurrenceInKST 는 API 파라미터가 아니어서 반복 일정이 만들어지지 않았다.
    "Create or update a scheduled action for an Auto Scaling Group. A new scheduledActionName creates one; to update, pass scheduledActionNo or the existing name. Set startTime for a one-off run, recurrence (cron) for a repeating one, or both.",
    {
      autoScalingGroupNo: z.string(reqField("autoScalingGroupNo")).describe("Auto Scaling Group number"),
      scheduledActionNo: z.string().optional().describe("Scheduled action number to update (from ncloud_list_scheduled_actions). Omit when creating."),
      scheduledActionName: asgName("scheduledActionName").optional().describe("Scheduled action name (1-255 chars: lowercase letters, digits, '-'). A new name creates an action; an existing name updates it. One of scheduledActionNo / scheduledActionName is required."),
      minSize: capacity("minSize", true).describe("Minimum number of servers at the scheduled time (0-30)"),
      maxSize: capacity("maxSize", true).describe("Maximum number of servers at the scheduled time (0-30)"),
      desiredCapacity: scheduleDesiredRequired
        ? capacity("desiredCapacity", true).describe("Desired number of servers at the scheduled time (between minSize and maxSize)")
        : capacity("desiredCapacity").optional().describe("Desired number of servers at the scheduled time (between minSize and maxSize; defaults to minSize)"),
      startTime: z.string().regex(SCHEDULE_TIME, { message: "startTime: yyyy-MM-ddTHH:mm:ssZ (e.g. 2026-12-01T09:00:00+0900)" })
        .optional().describe("Start time, yyyy-MM-ddTHH:mm:ssZ (e.g. 2026-12-01T09:00:00+0900). Must be in the future. Required when recurrence is not set."),
      endTime: z.string().regex(SCHEDULE_TIME, { message: "endTime: yyyy-MM-ddTHH:mm:ssZ (e.g. 2026-12-31T18:00:00+0900)" })
        .optional().describe("End time, yyyy-MM-ddTHH:mm:ssZ — after startTime; with recurrence, repeats stop after it"),
      recurrence: z.string().optional().describe("Repeat schedule in crontab format 'min hour day month weekday' (e.g. '0 9 * * 1-5' = weekdays 09:00). Required when startTime is not set."),
      timeZone: z.enum(["KST", "UTC"]).optional().describe("Time zone for recurrence: KST (default) or UTC"),
    },
    async (params) => {
      if (!params.scheduledActionNo && !params.scheduledActionName) {
        return validationError({
          ko: "❌ scheduledActionNo 또는 scheduledActionName 중 하나가 필요합니다(생성은 새 이름, 수정은 번호 또는 기존 이름).",
          en: "❌ One of scheduledActionNo or scheduledActionName is required (a new name creates; the number or an existing name updates).",
        });
      }
      if (!params.startTime && !params.recurrence) {
        return validationError({
          ko: "❌ startTime(1회 실행) 또는 recurrence(반복) 중 하나 이상이 필요합니다.",
          en: "❌ Set startTime (one-off), recurrence (repeating), or both.",
        });
      }
      const invalid = checkCapacityOrder(params);
      if (invalid) return invalid;
      return client.request("/vautoscaling/v2/putScheduledUpdateGroupAction", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_scheduled_actions",
    "List scheduled actions that have not yet been executed for an Auto Scaling Group",
    {
      autoScalingGroupNo: z.string(reqField("autoScalingGroupNo")).describe("Auto Scaling Group number"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/getScheduledActionList", params);
    }
  );

  defineTool(
    server,
    "ncloud_delete_scheduled_action",
    "⚠️ Destructive: Delete a scheduled action from an Auto Scaling Group. Set confirm=true to execute.",
    {
      autoScalingGroupNo: z.string(reqField("autoScalingGroupNo")).describe("Auto Scaling Group number"),
      // 가이드: 식별자는 scheduledActionNo(Required). 예전 scheduledActionName 은 API 파라미터가 아니었다.
      scheduledActionNo: z.string(reqField("scheduledActionNo")).describe("Scheduled action number to delete (from ncloud_list_scheduled_actions)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vautoscaling/v2/deleteScheduledAction", apiParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete ScheduledAction [${params.scheduledActionNo}] from AutoScalingGroup [${params.autoScalingGroupNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Reference Query Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_scaling_process_types",
    "List available scaling process types for Auto Scaling Groups",
    {},
    async () => {
      return client.request("/vautoscaling/v2/getScalingProcessTypeList", {});
    }
  );

  defineTool(
    server,
    "ncloud_get_adjustment_types",
    "List available adjustment type codes for Auto Scaling policy configuration",
    {},
    async () => {
      return client.request("/vautoscaling/v2/getAdjustmentTypeList", {});
    }
  );
}
