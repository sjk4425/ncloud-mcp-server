import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, requiredError } from "./_messages.js";

export function registerSensTools(server: McpServer, client: NcloudClient): void {
  const smsServiceId = process.env.NCLOUD_SENS_SMS_SERVICE_ID ?? process.env.NCLOUD_SENS_SERVICE_ID ?? "";
  const alimtalkServiceId = process.env.NCLOUD_SENS_ALIMTALK_SERVICE_ID ?? process.env.NCLOUD_SENS_SERVICE_ID ?? "";
  const pushServiceId = process.env.NCLOUD_SENS_PUSH_SERVICE_ID ?? process.env.NCLOUD_SENS_SERVICE_ID ?? "";

  // ─── SMS Tools ─────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_sens_send_sms",
    "Send SMS/LMS/MMS message via SENS. Requires NCLOUD_SENS_SERVICE_ID or NCLOUD_SENS_SMS_SERVICE_ID environment variable.",
    {
      type: z.enum(["SMS", "LMS", "MMS"]).describe("Message type: SMS (short), LMS (long), MMS (multimedia)"),
      from: z.string({ required_error: requiredError("from") }).describe("Caller ID (registered phone number, numbers only)"),
      content: z.string({ required_error: requiredError("content") }).describe("Default message content (SMS: 0-90 bytes, LMS/MMS: 0-2000 bytes)"),
      messages: z.array(z.object({
        to: z.string().describe("Recipient phone number (numbers only)"),
        subject: z.string().optional().describe("Individual message subject (LMS/MMS only, 0-40 bytes)"),
        content: z.string().optional().describe("Individual message content (overrides default content)"),
      })).describe("Array of message recipients (up to 100)"),
      contentType: z.enum(["COMM", "AD"]).optional().describe("Content type: COMM (general, default) or AD (advertisement)"),
      countryCode: z.string().optional().describe("Country code (default: 82 for Korea)"),
      subject: z.string().optional().describe("Default message subject (LMS/MMS only, 0-40 bytes)"),
      reserveTime: z.string().optional().describe("Reserved send time (YYYY-MM-DD HH:mm format)"),
      reserveTimeZone: z.string().optional().describe("Reserved time zone (default: Asia/Seoul)"),
    },
    async (params) => {
      if (!smsServiceId) {
        return { content: [{ type: "text" as const, text: L({ ko: "Error: NCLOUD_SENS_SERVICE_ID 또는 NCLOUD_SENS_SMS_SERVICE_ID 환경 변수가 설정되지 않았습니다.", en: "Error: the NCLOUD_SENS_SERVICE_ID or NCLOUD_SENS_SMS_SERVICE_ID environment variable is not set." }) }], isError: true };
      }

      const body: Record<string, any> = {
        type: params.type,
        from: params.from,
        content: params.content,
        messages: params.messages,
      };
      if (params.contentType) body.contentType = params.contentType;
      if (params.countryCode) body.countryCode = params.countryCode;
      if (params.subject) body.subject = params.subject;
      if (params.reserveTime) body.reserveTime = params.reserveTime;
      if (params.reserveTimeZone) body.reserveTimeZone = params.reserveTimeZone;

      const result = await client.postRequest(`/sms/v2/services/${encodeURIComponent(smsServiceId)}/messages`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_sens_get_sms_status",
    "Get SMS message delivery result by message ID. Requires NCLOUD_SENS_SERVICE_ID or NCLOUD_SENS_SMS_SERVICE_ID environment variable.",
    {
      messageId: z.string({ required_error: requiredError("messageId") }).describe("Message ID to check delivery status"),
    },
    async (params) => {
      if (!smsServiceId) {
        return { content: [{ type: "text" as const, text: L({ ko: "Error: NCLOUD_SENS_SERVICE_ID 또는 NCLOUD_SENS_SMS_SERVICE_ID 환경 변수가 설정되지 않았습니다.", en: "Error: the NCLOUD_SENS_SERVICE_ID or NCLOUD_SENS_SMS_SERVICE_ID environment variable is not set." }) }], isError: true };
      }

      const result = await client.request(`/sms/v2/services/${encodeURIComponent(smsServiceId)}/messages/${encodeURIComponent(params.messageId)}`);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_sens_list_sms_requests",
    "Get SMS message delivery request list (within last 90 days). Requires NCLOUD_SENS_SERVICE_ID or NCLOUD_SENS_SMS_SERVICE_ID environment variable.",
    {
      requestId: z.string().optional().describe("Request ID (conditional: one of requestId, requestStartTime+requestEndTime, or completeStartTime+completeEndTime required)"),
      requestStartTime: z.string().optional().describe("Query start time based on delivery request (YYYY-MM-DD HH:mm:ss format)"),
      requestEndTime: z.string().optional().describe("Query end time based on delivery request (within 30 days of requestStartTime)"),
      completeStartTime: z.string().optional().describe("Query start time based on delivery completion (YYYY-MM-DD HH:mm:ss format)"),
      completeEndTime: z.string().optional().describe("Query end time based on delivery completion (within 24 hours of completeStartTime)"),
      messageId: z.string().optional().describe("Filter by message ID"),
      type: z.enum(["SMS", "LMS", "MMS"]).optional().describe("Filter by message type"),
      status: z.enum(["READY", "PROCESSING", "COMPLETED"]).optional().describe("Filter by request status"),
      statusName: z.enum(["success", "fail"]).optional().describe("Filter by reception status"),
      from: z.string().optional().describe("Filter by caller ID (numbers only)"),
      to: z.string().optional().describe("Filter by recipient number (numbers only)"),
      pageSize: z.number().optional().describe("Number of items per page (1-100, default: 20)"),
      nextToken: z.string().optional().describe("Page location token for pagination"),
    },
    async (params) => {
      if (!smsServiceId) {
        return { content: [{ type: "text" as const, text: L({ ko: "Error: NCLOUD_SENS_SERVICE_ID 또는 NCLOUD_SENS_SMS_SERVICE_ID 환경 변수가 설정되지 않았습니다.", en: "Error: the NCLOUD_SENS_SERVICE_ID or NCLOUD_SENS_SMS_SERVICE_ID environment variable is not set." }) }], isError: true };
      }

      const apiParams: Record<string, string | undefined> = {};
      if (params.requestId) apiParams.requestId = params.requestId;
      if (params.requestStartTime) apiParams.requestStartTime = params.requestStartTime;
      if (params.requestEndTime) apiParams.requestEndTime = params.requestEndTime;
      if (params.completeStartTime) apiParams.completeStartTime = params.completeStartTime;
      if (params.completeEndTime) apiParams.completeEndTime = params.completeEndTime;
      if (params.messageId) apiParams.messageId = params.messageId;
      if (params.type) apiParams.type = params.type;
      if (params.status) apiParams.status = params.status;
      if (params.statusName) apiParams.statusName = params.statusName;
      if (params.from) apiParams.from = params.from;
      if (params.to) apiParams.to = params.to;
      if (params.pageSize !== undefined) apiParams.pageSize = String(params.pageSize);
      if (params.nextToken) apiParams.nextToken = params.nextToken;

      const result = await client.request(`/sms/v2/services/${encodeURIComponent(smsServiceId)}/messages`, apiParams);
      return result;
    }
  );

  // ─── AlimTalk Tools ────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_sens_send_alimtalk",
    "Send Alim Talk (KakaoTalk notification) message via SENS. Requires NCLOUD_SENS_SERVICE_ID or NCLOUD_SENS_ALIMTALK_SERVICE_ID environment variable.",
    {
      plusFriendId: z.string({ required_error: requiredError("plusFriendId") }).describe("KakaoTalk Channel ID (e.g., @channelname)"),
      templateCode: z.string({ required_error: requiredError("templateCode") }).describe("Approved template code"),
      messages: z.array(z.object({
        to: z.string().describe("Recipient phone number (numbers only)"),
        content: z.string().describe("Message content (must match template)"),
        countryCode: z.string().optional().describe("Country code (default: 82)"),
        title: z.string().optional().describe("Highlight title (highlight-type templates only)"),
        buttons: z.array(z.object({
          type: z.enum(["DS", "WL", "AL", "BK", "MD", "AC"]).describe("Button type"),
          name: z.string().describe("Button name"),
          linkMobile: z.string().optional().describe("Mobile web link (required for WL type)"),
          linkPc: z.string().optional().describe("PC web link (required for WL type)"),
          schemeIos: z.string().optional().describe("iOS app link (required for AL type)"),
          schemeAndroid: z.string().optional().describe("Android app link (required for AL type)"),
        })).optional().describe("Button list (must match template)"),
        useSmsFailover: z.boolean().optional().describe("Enable SMS failover delivery"),
        failoverConfig: z.object({
          type: z.enum(["SMS", "LMS"]).optional().describe("Failover message type"),
          from: z.string().optional().describe("Failover caller ID"),
          subject: z.string().optional().describe("Failover message subject (LMS only)"),
          content: z.string().optional().describe("Failover message content"),
        }).optional().describe("SMS failover configuration"),
      })).describe("Array of message recipients (up to 100)"),
      reserveTime: z.string().optional().describe("Reserved send time (YYYY-MM-DD HH:mm format)"),
      reserveTimeZone: z.string().optional().describe("Reserved time zone (default: Asia/Seoul)"),
    },
    async (params) => {
      if (!alimtalkServiceId) {
        return { content: [{ type: "text" as const, text: L({ ko: "Error: NCLOUD_SENS_SERVICE_ID 또는 NCLOUD_SENS_ALIMTALK_SERVICE_ID 환경 변수가 설정되지 않았습니다.", en: "Error: the NCLOUD_SENS_SERVICE_ID or NCLOUD_SENS_ALIMTALK_SERVICE_ID environment variable is not set." }) }], isError: true };
      }

      const body: Record<string, any> = {
        plusFriendId: params.plusFriendId,
        templateCode: params.templateCode,
        messages: params.messages,
      };
      if (params.reserveTime) body.reserveTime = params.reserveTime;
      if (params.reserveTimeZone) body.reserveTimeZone = params.reserveTimeZone;

      const result = await client.postRequest(`/alimtalk/v2/services/${encodeURIComponent(alimtalkServiceId)}/messages`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_sens_list_alimtalk_templates",
    "List registered Alim Talk templates. Requires NCLOUD_SENS_SERVICE_ID or NCLOUD_SENS_ALIMTALK_SERVICE_ID environment variable.",
    {
      channelId: z.string({ required_error: requiredError("channelId") }).describe("KakaoTalk Channel ID (e.g., @channelname)"),
      templateCode: z.string().optional().describe("Template code (if provided, returns template details including inspection info)"),
      templateName: z.string().optional().describe("Template name filter (partial match)"),
      pageSize: z.number().optional().describe("Number of items per page (1-100, default: 100)"),
      pageIndex: z.number().optional().describe("Page index (0-N, default: 0)"),
    },
    async (params) => {
      if (!alimtalkServiceId) {
        return { content: [{ type: "text" as const, text: L({ ko: "Error: NCLOUD_SENS_SERVICE_ID 또는 NCLOUD_SENS_ALIMTALK_SERVICE_ID 환경 변수가 설정되지 않았습니다.", en: "Error: the NCLOUD_SENS_SERVICE_ID or NCLOUD_SENS_ALIMTALK_SERVICE_ID environment variable is not set." }) }], isError: true };
      }

      const apiParams: Record<string, string | undefined> = {
        channelId: params.channelId,
      };
      if (params.templateCode) apiParams.templateCode = params.templateCode;
      if (params.templateName) apiParams.templateName = params.templateName;
      if (params.pageSize !== undefined) apiParams.pageSize = String(params.pageSize);
      if (params.pageIndex !== undefined) apiParams.pageIndex = String(params.pageIndex);

      const result = await client.request(`/alimtalk/v2/services/${encodeURIComponent(alimtalkServiceId)}/templates`, apiParams);
      return result;
    }
  );

  // ─── Push Notification Tool ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_sens_send_push",
    "Send push notification via SENS. Requires NCLOUD_SENS_SERVICE_ID or NCLOUD_SENS_PUSH_SERVICE_ID environment variable.",
    {
      target: z.object({
        type: z.enum(["ALL", "USER", "TOPIC"]).describe("Target type: ALL (all devices), USER (specific users), TOPIC (topic subscribers)"),
        to: z.array(z.string()).optional().describe("Target user IDs or topic names (required for USER/TOPIC type)"),
        country: z.string().optional().describe("Target country code filter"),
      }).describe("Push notification target"),
      message: z.object({
        default: z.object({
          title: z.string().optional().describe("Notification title"),
          body: z.string().describe("Notification body text"),
          custom: z.record(z.string()).optional().describe("Custom key-value data payload"),
        }).describe("Default message content"),
        apns: z.object({
          title: z.string().optional().describe("iOS notification title"),
          body: z.string().optional().describe("iOS notification body"),
          custom: z.record(z.string()).optional().describe("iOS custom data payload"),
        }).optional().describe("iOS-specific message (overrides default)"),
        gcm: z.object({
          title: z.string().optional().describe("Android notification title"),
          body: z.string().optional().describe("Android notification body"),
          custom: z.record(z.string()).optional().describe("Android custom data payload"),
        }).optional().describe("Android-specific message (overrides default)"),
      }).describe("Push notification message content"),
      reserveTime: z.string().optional().describe("Reserved send time (YYYY-MM-DD HH:mm format)"),
      reserveTimeZone: z.string().optional().describe("Reserved time zone (default: Asia/Seoul)"),
    },
    async (params) => {
      if (!pushServiceId) {
        return { content: [{ type: "text" as const, text: L({ ko: "Error: NCLOUD_SENS_SERVICE_ID 또는 NCLOUD_SENS_PUSH_SERVICE_ID 환경 변수가 설정되지 않았습니다.", en: "Error: the NCLOUD_SENS_SERVICE_ID or NCLOUD_SENS_PUSH_SERVICE_ID environment variable is not set." }) }], isError: true };
      }

      const body: Record<string, any> = {
        target: params.target,
        message: params.message,
      };
      if (params.reserveTime) body.reserveTime = params.reserveTime;
      if (params.reserveTimeZone) body.reserveTimeZone = params.reserveTimeZone;

      const result = await client.postRequest(`/push/v2/services/${encodeURIComponent(pushServiceId)}/messages`, body);
      return result;
    }
  );
}
