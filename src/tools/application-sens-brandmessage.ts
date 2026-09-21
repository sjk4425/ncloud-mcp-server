import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";
import {
  serviceIdParam, resolveServiceId, withQuery, reserveTimeSchema, reserveTimeZoneSchema,
  listWindowParams, listWindowProblem, failoverConfigSchema, telNoSchema,
} from "./_sens.js";

/**
 * SENS 브랜드 메시지(/brandmessage/v2) — 카카오톡 채널 광고성 메시지. serviceId는 알림톡과 같은 kkobizmsg NRN.
 * Base URL: https://sens.apigw.ntruss.com
 *
 * 2026-09-21 문서(sens-brandmessage-*) 기준 신규. 메시지 타입 8종(TEXT/IMAGE/WIDE_IMAGE/WIDE_ITEM_LIST/COMMERCE/
 * CAROUSEL_COMMERCE/CAROUSEL_FEED/PREMIUM_VIDEO)마다 `messages[]` 구조가 다르므로, 공통 필드(to/countryCode/
 * failover/templateParameters)만 엄격히 타이핑하고 타입별 객체(image/commerce/carousel/coupon/video/item/buttons)는
 * 문서 구조를 description으로 안내하는 느슨한 스키마로 받는다 — 서버가 타입별로 검증한다.
 *
 * 제약(문서): 야간 20:50~08:00 발송 불가(코드 3022), 예약은 현재+10분 이후, 버튼 name ≤14자(알림톡은 20),
 * 자유형 발송에 AC 버튼 불가·기본형(템플릿) 발송에 BC/BT 불가, 쿠폰 title은 고정 패턴만.
 * 이미지 업로드(`POST /images`)는 SENS에서 유일한 multipart/form-data라 MCP 텍스트 채널로는 감싸지 않는다(콘솔 업로드 후
 * 목록/조회/삭제만 지원).
 */

const MESSAGE_TYPES = ["TEXT", "IMAGE", "WIDE_IMAGE", "WIDE_ITEM_LIST", "COMMERCE", "CAROUSEL_COMMERCE", "CAROUSEL_FEED", "PREMIUM_VIDEO"] as const;
const BUTTON_TYPES = ["WL", "AL", "BF", "AC", "BK", "MD", "BC", "BT"] as const;

const linkFields = {
  linkMobile: z.string().max(1000).optional().describe("Mobile URL (≤1,000 chars)"),
  linkPc: z.string().max(1000).optional().describe("PC URL (≤1,000 chars)"),
  schemeIos: z.string().max(1000).optional().describe("iOS scheme (≤1,000 chars)"),
  schemeAndroid: z.string().max(1000).optional().describe("Android scheme (≤1,000 chars)"),
};

const buttonSchema = z.object({
  type: z.enum(BUTTON_TYPES).describe("WL web link | AL app link | BF business form | AC add channel | BK bot keyword | MD message | BC consult talk | BT chatbot"),
  name: z.string().max(14).describe("Button label (≤14 chars)"),
  bizFormId: z.string().optional().describe("Business form ID (BF)"),
  ...linkFields,
}).passthrough();

const couponSchema = z.object({
  title: z.string().describe("Fixed patterns only: '${N}원 할인 쿠폰' | '${1-100}% 할인 쿠폰' | '배송비 할인 쿠폰' | '${≤7 chars} 무료 쿠폰' | '${≤7 chars} UP 쿠폰'"),
  description: z.string().max(18).describe("≤12 chars (WIDE_IMAGE ≤8, WIDE_ITEM_LIST ≤18), no line breaks"),
  ...linkFields,
}).passthrough();

const imageSchema = z.object({
  imageId: z.string().optional().describe("Image ID from the console upload / ncloud_sens_list_brandmessage_images"),
  imageLink: z.string().max(1000).optional().describe("URL opened when the image is tapped"),
}).passthrough();

const loose = z.record(z.any());

export function registerSensBrandMessageTools(server: McpServer, client: NcloudClient): void {
  const kkoService = serviceIdParam("brandmessage");

  defineTool(
    server,
    "ncloud_sens_send_brandmessage",
    "Send KakaoTalk Brand Messages through SENS (POST /brandmessage/v2/services/{serviceId}/messages → 202). Free-form: set messageType and type-specific fields per message; template-based: set templateCode (+ messageType of the template) and messages[].templateParameters. " +
      "Not deliverable 20:50-08:00 (code 3022). targeting I (default) = ad-consented channel friends, M = all ad-consented, N = ad-consented non-friends (M/N need an 080 number). Use dryRun=true to preview.",
    {
      serviceId: kkoService,
      plusFriendId: z.string({ required_error: requiredError("plusFriendId") }).describe("KakaoTalk channel ID (e.g. @channelname)"),
      messageType: z.enum(MESSAGE_TYPES).describe("Message layout type"),
      templateCode: z.string().optional().describe("Template code for template-based (기본형) sending"),
      targeting: z.enum(["M", "N", "I"]).optional().describe("Audience: M | N | I (default I)"),
      isAdult: z.boolean().optional().describe("Adult-only content (default false)"),
      messages: z.array(z.object({
        to: telNoSchema.describe("Recipient number (digits only)"),
        countryCode: z.string().optional().describe("Country code (default 82)"),
        templateParameters: z.record(z.string()).optional().describe("Template variables #{name} → value (template-based sending)"),
        content: z.string().max(1300).optional().describe("TEXT/IMAGE ≤1,300 chars; WIDE_IMAGE/PREMIUM_VIDEO ≤76 chars"),
        headerContent: z.string().max(20).optional().describe("WIDE_ITEM_LIST (required) / PREMIUM_VIDEO header, ≤20 chars"),
        additionalContent: z.string().max(34).optional().describe("COMMERCE additional text (≤34 chars, ≤1 line break)"),
        image: imageSchema.optional().describe("IMAGE/WIDE_IMAGE/COMMERCE image"),
        item: loose.optional().describe("WIDE_ITEM_LIST: { list: [{ title, imageId, linkMobile, linkPc, schemeAndroid, schemeIos }] } (item 1 = main image, items 2-4 = sub images)"),
        commerce: loose.optional().describe("COMMERCE: { title(≤30), regularPrice, discountPrice, discountRate | discountFixed } (send as strings)"),
        carousel: loose.optional().describe("CAROUSEL_COMMERCE/CAROUSEL_FEED: { head?, list: [2-6 cards], tail: { linkMobile(required), linkPc, schemeAndroid, schemeIos } }"),
        video: loose.optional().describe("PREMIUM_VIDEO: { thumbnailId, videoUrl (KakaoTV) }"),
        coupon: couponSchema.optional().describe("One coupon per message"),
        buttons: z.array(buttonSchema).max(5).optional().describe("Buttons (TEXT/IMAGE ≤5, WIDE ≤2, COMMERCE 1-2, PREMIUM_VIDEO ≤1). No AC in free-form, no BC/BT with a template"),
        useSmsFailover: z.boolean().optional().describe("Send SMS/LMS when not delivered"),
        failoverConfig: failoverConfigSchema,
      }).passthrough()).min(1).max(100).describe("Recipients with type-specific payload (1-100)"),
      reserveTime: reserveTimeSchema,
      reserveTimeZone: reserveTimeZoneSchema,
      dryRun: z.boolean().optional().default(false).describe("If true, returns the request preview without sending"),
    },
    async (params) => {
      const svc = resolveServiceId("brandmessage", params.serviceId);
      if (!svc.ok) return svc.result;
      const problems: string[] = [];
      const templated = params.templateCode !== undefined;
      params.messages.forEach((m, i) => {
        for (const b of m.buttons ?? []) {
          if (!templated && b.type === "AC") problems.push(`messages[${i}]: AC (add channel) button is not allowed in free-form sending`);
          if (templated && (b.type === "BC" || b.type === "BT")) problems.push(`messages[${i}]: ${b.type} button is not allowed in template-based sending`);
          if (b.type === "WL" && !b.linkMobile) problems.push(`messages[${i}] button '${b.name}': WL requires linkMobile`);
          if (b.type === "AL" && (!b.schemeIos || !b.schemeAndroid)) problems.push(`messages[${i}] button '${b.name}': AL requires schemeIos and schemeAndroid`);
        }
        if (!templated && (params.messageType === "TEXT" || params.messageType === "IMAGE" || params.messageType === "WIDE_IMAGE") && !m.content)
          problems.push(`messages[${i}]: content is required for ${params.messageType}`);
        if (!templated && params.messageType === "WIDE_ITEM_LIST" && !m.headerContent) problems.push(`messages[${i}]: headerContent is required for WIDE_ITEM_LIST`);
        if (!templated && params.messageType === "COMMERCE" && !m.commerce) problems.push(`messages[${i}]: commerce is required for COMMERCE`);
        if (!templated && params.messageType.startsWith("CAROUSEL") && !m.carousel) problems.push(`messages[${i}]: carousel is required for ${params.messageType}`);
        if (!templated && params.messageType === "PREMIUM_VIDEO" && !m.video) problems.push(`messages[${i}]: video is required for PREMIUM_VIDEO`);
      });
      if (problems.length > 0) return { content: [{ type: "text" as const, text: `❌ ${problems.join("\n❌ ")}` }], isError: true };

      const { serviceId: _s, dryRun, ...body } = params;
      for (const k of Object.keys(body)) if ((body as any)[k] === undefined) delete (body as any)[k];
      const endpoint = `${svc.base}/messages`;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: SENS Brand Message Send", endpoint, method: "POST", requestParams: body,
          noun: { ko: "브랜드 메시지", en: "brand message" },
          notes: {
            recipientCount: params.messages.length,
            mode: templated ? "template-based" : "free-form",
            note: L({ ko: "브랜드 메시지는 20:50~08:00에 발송할 수 없습니다(코드 3022).", en: "Brand messages cannot be delivered 20:50-08:00 (code 3022)." }),
          },
        });
      }
      return client.requestRaw("POST", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_sens_list_brandmessage_requests",
    "List Brand Message delivery requests (GET /brandmessage/v2/services/{serviceId}/messages). Requires requestId, or requestStartTime+requestEndTime (≤31 days), or completeStartTime+completeEndTime (≤24 h); plusFriendId is required unless requestId is given. An empty HTTP 404 reply means no matching records (observed live with an unknown requestId).",
    {
      serviceId: kkoService,
      plusFriendId: z.string().optional().describe("Channel ID (required when requestId is not given)"),
      ...listWindowParams,
      messageId: z.string().optional().describe("Filter by message ID"),
      requestStatusName: z.enum(["success", "fail"]).optional().describe("Filter by request result"),
      messageStatusName: z.enum(["success", "processing", "fail"]).optional().describe("Filter by delivery result"),
      templateCode: z.string().optional().describe("Filter by template code"),
      to: z.string().optional().describe("Filter by recipient number (digits only)"),
    },
    async (params) => {
      const svc = resolveServiceId("brandmessage", params.serviceId);
      if (!svc.ok) return svc.result;
      const problem = listWindowProblem(params, "plusFriendId");
      if (problem) return problem;
      const { serviceId: _s, ...query } = params;
      return client.requestRaw("GET", withQuery(`${svc.base}/messages`, query));
    }
  );

  defineTool(
    server,
    "ncloud_sens_get_brandmessage_status",
    "Get one Brand Message delivery result with its full payload (GET /brandmessage/v2/services/{serviceId}/messages/{messageId}). messageStatusCode 0000 = delivered, 3022 = outside 08:00-20:50, 3050 = N targeting without 080 unsubscribe, B004 = quota exceeded.",
    {
      serviceId: kkoService,
      messageId: z.string({ required_error: requiredError("messageId") }).describe("Message ID"),
    },
    async (params) => {
      const svc = resolveServiceId("brandmessage", params.serviceId);
      if (!svc.ok) return svc.result;
      return client.requestRaw("GET", `${svc.base}/messages/${encodeURIComponent(params.messageId)}`);
    },
    { prune: true }
  );

  defineTool(
    server,
    "ncloud_sens_list_brandmessage_templates",
    "List Brand Message templates of a channel (GET /brandmessage/v2/services/{serviceId}/templates). Note the channel parameter is plusFriendId here (Alim Talk uses channelId). Returns { items[], totalCount, hasNext }.",
    {
      serviceId: kkoService,
      plusFriendId: z.string({ required_error: requiredError("plusFriendId") }).describe("KakaoTalk channel ID (e.g. @channelname)"),
      templateCode: z.string().optional().describe("Filter by template code"),
      templateName: z.string().optional().describe("Filter by name (full or partial match)"),
      messageType: z.enum(MESSAGE_TYPES).optional().describe("Filter by message type"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Items per page (1-100, default 100)"),
      pageIndex: z.number().int().min(0).optional().describe("Page index (0-based, default 0)"),
    },
    async (params) => {
      const svc = resolveServiceId("brandmessage", params.serviceId);
      if (!svc.ok) return svc.result;
      const { serviceId: _s, ...query } = params;
      return client.requestRaw("GET", withQuery(`${svc.base}/templates`, query));
    }
  );

  defineTool(
    server,
    "ncloud_sens_list_brandmessage_images",
    "List images uploaded for Brand Messages (GET /brandmessage/v2/services/{serviceId}/images): imageId, imageUrl, imageType (BASIC|WIDE|WIDE_ITEM_LIST_MAIN|WIDE_ITEM_LIST_SUB|CAROUSEL_FEED|CAROUSEL_COMMERCE). Images are kept for 1 year. Upload itself is multipart and must be done in the console.",
    {
      serviceId: kkoService,
      pageSize: z.number().int().min(1).max(200).optional().describe("Items per page (1-200, default 20)"),
      pageIndex: z.number().int().min(0).optional().describe("Page index (0-based, default 0)"),
    },
    async (params) => {
      const svc = resolveServiceId("brandmessage", params.serviceId);
      if (!svc.ok) return svc.result;
      const { serviceId: _s, ...query } = params;
      return client.requestRaw("GET", withQuery(`${svc.base}/images`, query));
    }
  );

  defineTool(
    server,
    "ncloud_sens_get_brandmessage_image",
    "Get one Brand Message image (GET /brandmessage/v2/services/{serviceId}/images/{imageId}).",
    {
      serviceId: kkoService,
      imageId: z.string({ required_error: requiredError("imageId") }).describe("Image ID"),
    },
    async (params) => {
      const svc = resolveServiceId("brandmessage", params.serviceId);
      if (!svc.ok) return svc.result;
      return client.requestRaw("GET", `${svc.base}/images/${encodeURIComponent(params.imageId)}`);
    }
  );

  defineTool(
    server,
    "ncloud_sens_delete_brandmessage_image",
    "⚠️ Destructive: Delete an uploaded Brand Message image (DELETE /brandmessage/v2/services/{serviceId}/images/{imageId} → 204). Messages referencing the imageId can no longer be sent. Set confirm=true to execute.",
    {
      serviceId: kkoService,
      imageId: z.string({ required_error: requiredError("imageId") }).describe("Image ID to delete"),
    },
    async (params) => {
      const svc = resolveServiceId("brandmessage", params.serviceId);
      if (!svc.ok) return svc.result;
      return client.requestRaw("DELETE", `${svc.base}/images/${encodeURIComponent(params.imageId)}`);
    },
    { destructive: { noun: "brand message image", describe: (p) => p.imageId } }
  );
}
