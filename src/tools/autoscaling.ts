import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

export function registerAutoScalingTools(server: McpServer, client: NcloudClient): void {
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
      launchConfigurationNo: z.string({
        required_error: "필수 파라미터 'launchConfigurationNo'가 누락되었습니다.",
      }).describe("Launch configuration number to query"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/getLaunchConfigurationDetail", params);
    }
  );

  // ─── Launch Configuration Create Tool ──────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_launch_config",
    "Create a new launch configuration for Auto Scaling. Use dryRun=true to preview without creating.",
    {
      serverImageProductCode: z.string({
        required_error: "필수 파라미터 'serverImageProductCode'가 누락되었습니다.",
      }).describe("Server image product code"),
      serverProductCode: z.string({
        required_error: "필수 파라미터 'serverProductCode'가 누락되었습니다.",
      }).describe("Server product (spec) code"),
      launchConfigurationName: z.string().max(255, {
        message: "잘못된 파라미터: 'launchConfigurationName'은 255자 이하여야 합니다.",
      }).optional().describe("Launch configuration name"),
      loginKeyName: z.string().optional().describe("Login key name for SSH access"),
      initScriptNo: z.string().optional().describe("Init script number to run on launch"),
      isEncryptedVolume: z.boolean().optional().describe("Whether to encrypt the root volume"),
      memberServerImageInstanceNo: z.string().optional().describe("Member server image instance number (alternative to serverImageProductCode)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: Launch Configuration Creation",
          serverImageProductCode: params.serverImageProductCode,
          serverProductCode: params.serverProductCode,
          launchConfigurationName: params.launchConfigurationName ?? "(auto-generated)",
          loginKeyName: params.loginKeyName ?? "(none)",
          initScriptNo: params.initScriptNo ?? "(none)",
          isEncryptedVolume: params.isEncryptedVolume ?? false,
          message: "이 요청은 실제 런치 설정을 생성하지 않습니다. dryRun=false로 호출하면 생성됩니다.",
        };
        return preview;
      }
      const { dryRun, ...apiParams } = params;
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
      launchConfigurationNo: z.string({
        required_error: "필수 파라미터 'launchConfigurationNo'가 누락되었습니다.",
      }).describe("Launch configuration number to delete"),
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
      autoScalingGroupName: z.string().optional().describe("Filter by Auto Scaling Group name"),
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
      autoScalingGroupNo: z.string({
        required_error: "필수 파라미터 'autoScalingGroupNo'가 누락되었습니다.",
      }).describe("Auto Scaling Group number to query"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/getAutoScalingGroupDetail", params);
    }
  );

  // ─── Auto Scaling Group Create Tool ────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_asg",
    "Create a new Auto Scaling Group. Use dryRun=true to preview without creating.",
    {
      launchConfigurationNo: z.string({
        required_error: "필수 파라미터 'launchConfigurationNo'가 누락되었습니다.",
      }).describe("Launch configuration number to use"),
      autoScalingGroupName: z.string().max(255, {
        message: "잘못된 파라미터: 'autoScalingGroupName'은 255자 이하여야 합니다.",
      }).optional().describe("Auto Scaling Group name"),
      subnetNoList: z.array(z.string(), {
        required_error: "필수 파라미터 'subnetNoList'가 누락되었습니다.",
      }).min(1).describe("List of subnet numbers for the ASG"),
      minSize: z.number({
        required_error: "필수 파라미터 'minSize'가 누락되었습니다.",
      }).min(0).describe("Minimum number of instances"),
      maxSize: z.number({
        required_error: "필수 파라미터 'maxSize'가 누락되었습니다.",
      }).min(0).describe("Maximum number of instances"),
      desiredCapacity: z.number().optional().describe("Desired number of instances"),
      defaultCooldown: z.number().optional().describe("Default cooldown period in seconds"),
      healthCheckGracePeriod: z.number().optional().describe("Health check grace period in seconds"),
      healthCheckTypeCode: z.string().optional().describe("Health check type (SVR or LOADB)"),
      targetGroupNoList: z.array(z.string()).optional().describe("List of target group numbers to attach"),
      accessControlGroupNoList: z.array(z.string()).optional().describe("List of ACG numbers"),
      serverNamePrefix: z.string().optional().describe("Prefix for server instance names"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: Auto Scaling Group Creation",
          launchConfigurationNo: params.launchConfigurationNo,
          autoScalingGroupName: params.autoScalingGroupName ?? "(auto-generated)",
          subnetNoList: params.subnetNoList,
          minSize: params.minSize,
          maxSize: params.maxSize,
          desiredCapacity: params.desiredCapacity ?? params.minSize,
          healthCheckTypeCode: params.healthCheckTypeCode ?? "SVR",
          targetGroupNoList: params.targetGroupNoList ?? [],
          message: "이 요청은 실제 Auto Scaling Group을 생성하지 않습니다. dryRun=false로 호출하면 생성됩니다.",
        };
        return preview;
      }
      const { dryRun, ...apiParams } = params;
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
      autoScalingGroupNo: z.string({
        required_error: "필수 파라미터 'autoScalingGroupNo'가 누락되었습니다.",
      }).describe("Auto Scaling Group number to delete"),
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
      autoScalingGroupNo: z.string({
        required_error: "필수 파라미터 'autoScalingGroupNo'가 누락되었습니다.",
      }).describe("Auto Scaling Group number"),
      desiredCapacity: z.number({
        required_error: "필수 파라미터 'desiredCapacity'가 누락되었습니다.",
      }).min(0).describe("Desired number of instances"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/setDesiredCapacity", params);
    }
  );

  // ─── Scaling Policy Tools ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_put_scaling_policy",
    "Create or update a scaling policy for an Auto Scaling Group",
    {
      autoScalingGroupNo: z.string({
        required_error: "필수 파라미터 'autoScalingGroupNo'가 누락되었습니다.",
      }).describe("Auto Scaling Group number"),
      policyName: z.string({
        required_error: "필수 파라미터 'policyName'이 누락되었습니다.",
      }).describe("Scaling policy name"),
      adjustmentTypeCode: z.string({
        required_error: "필수 파라미터 'adjustmentTypeCode'가 누락되었습니다.",
      }).describe("Adjustment type (CHANG — exact change, PRCNT — percentage, EXACT — set to exact number)"),
      scalingAdjustment: z.number({
        required_error: "필수 파라미터 'scalingAdjustment'가 누락되었습니다.",
      }).describe("Scaling adjustment value"),
      cooldown: z.number().optional().describe("Cooldown period in seconds after scaling"),
      minAdjustmentStep: z.number().optional().describe("Minimum adjustment step for percentage-based scaling"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/putScalingPolicy", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_scaling_policies",
    "List all scaling policies for an Auto Scaling Group",
    {
      autoScalingGroupNo: z.string({
        required_error: "필수 파라미터 'autoScalingGroupNo'가 누락되었습니다.",
      }).describe("Auto Scaling Group number"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
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
      autoScalingGroupNo: z.string({
        required_error: "필수 파라미터 'autoScalingGroupNo'가 누락되었습니다.",
      }).describe("Auto Scaling Group number"),
      policyName: z.string({
        required_error: "필수 파라미터 'policyName'이 누락되었습니다.",
      }).describe("Scaling policy name to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vautoscaling/v2/deleteScalingPolicy", apiParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete ScalingPolicy [${params.policyName}] from AutoScalingGroup [${params.autoScalingGroupNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Auto Scaling Group Update Tool ────────────────────────────────────────

  defineTool(
    server,
    "ncloud_update_asg",
    "Update an existing Auto Scaling Group configuration (e.g. min/max size, desired capacity, cooldown)",
    {
      autoScalingGroupNo: z.string({
        required_error: "필수 파라미터 'autoScalingGroupNo'가 누락되었습니다.",
      }).describe("Auto Scaling Group number to update"),
      launchConfigurationNo: z.string().optional().describe("New launch configuration number"),
      minSize: z.number().optional().describe("New minimum number of instances"),
      maxSize: z.number().optional().describe("New maximum number of instances"),
      desiredCapacity: z.number().optional().describe("New desired number of instances"),
      defaultCoolDown: z.number().optional().describe("Default cooldown period in seconds"),
      healthCheckGracePeriod: z.number().optional().describe("Health check grace period in seconds"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/updateAutoScalingGroup", params);
    }
  );

  // ─── Execute Scaling Policy Tool ───────────────────────────────────────────

  defineTool(
    server,
    "ncloud_execute_policy",
    "Manually execute a scaling policy for an Auto Scaling Group",
    {
      autoScalingGroupNo: z.string({
        required_error: "필수 파라미터 'autoScalingGroupNo'가 누락되었습니다.",
      }).describe("Auto Scaling Group number"),
      policyName: z.string({
        required_error: "필수 파라미터 'policyName'이 누락되었습니다.",
      }).describe("Scaling policy name to execute"),
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
      autoScalingGroupNo: z.string({
        required_error: "필수 파라미터 'autoScalingGroupNo'가 누락되었습니다.",
      }).describe("Auto Scaling Group number"),
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
      autoScalingGroupNo: z.string({
        required_error: "필수 파라미터 'autoScalingGroupNo'가 누락되었습니다.",
      }).describe("Auto Scaling Group number"),
      scalingProcessCodeList: z.array(z.string(), {
        required_error: "필수 파라미터 'scalingProcessCodeList'가 누락되었습니다.",
      }).min(1).describe("List of scaling process codes to suspend"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/suspendProcesses", params);
    }
  );

  defineTool(
    server,
    "ncloud_resume_processes",
    "Resume previously suspended scaling processes for an Auto Scaling Group",
    {
      autoScalingGroupNo: z.string({
        required_error: "필수 파라미터 'autoScalingGroupNo'가 누락되었습니다.",
      }).describe("Auto Scaling Group number"),
      scalingProcessCodeList: z.array(z.string(), {
        required_error: "필수 파라미터 'scalingProcessCodeList'가 누락되었습니다.",
      }).min(1).describe("List of scaling process codes to resume"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/resumeProcesses", params);
    }
  );

  // ─── Scheduled Action Tools ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_put_scheduled_action",
    "Create or update a scheduled action for an Auto Scaling Group",
    {
      autoScalingGroupNo: z.string({
        required_error: "필수 파라미터 'autoScalingGroupNo'가 누락되었습니다.",
      }).describe("Auto Scaling Group number"),
      scheduledActionName: z.string({
        required_error: "필수 파라미터 'scheduledActionName'이 누락되었습니다.",
      }).describe("Scheduled action name"),
      desiredCapacity: z.number().optional().describe("Desired capacity at scheduled time"),
      minSize: z.number().optional().describe("Minimum size at scheduled time"),
      maxSize: z.number().optional().describe("Maximum size at scheduled time"),
      startTime: z.string().optional().describe("Start time in ISO 8601 format (e.g. 2024-01-01T00:00:00+0900)"),
      endTime: z.string().optional().describe("End time in ISO 8601 format (e.g. 2024-12-31T23:59:59+0900)"),
      recurrenceInKST: z.string().optional().describe("Cron expression in KST (e.g. '0 9 * * 1-5' for weekdays at 9am KST)"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/putScheduledUpdateGroupAction", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_scheduled_actions",
    "List scheduled actions that have not yet been executed for an Auto Scaling Group",
    {
      autoScalingGroupNo: z.string({
        required_error: "필수 파라미터 'autoScalingGroupNo'가 누락되었습니다.",
      }).describe("Auto Scaling Group number"),
    },
    async (params) => {
      return client.request("/vautoscaling/v2/getScheduledActionList", params);
    }
  );

  defineTool(
    server,
    "ncloud_delete_scheduled_action",
    "[⚠️ DESTRUCTIVE] Delete a scheduled action from an Auto Scaling Group. Set confirm=true to execute.",
    {
      autoScalingGroupNo: z.string({
        required_error: "필수 파라미터 'autoScalingGroupNo'가 누락되었습니다.",
      }).describe("Auto Scaling Group number"),
      scheduledActionName: z.string({
        required_error: "필수 파라미터 'scheduledActionName'이 누락되었습니다.",
      }).describe("Scheduled action name to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vautoscaling/v2/deleteScheduledAction", apiParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete ScheduledAction [${params.scheduledActionName}] from AutoScalingGroup [${params.autoScalingGroupNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
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
