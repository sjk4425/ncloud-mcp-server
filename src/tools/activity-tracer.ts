import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

export function registerActivityTracerTools(server: McpServer, client: NcloudClient): void {
  // ncloud_get_activity_logs — Get activity list via POST /api/v1/activities
  server.tool(
    "ncloud_get_activity_logs",
    "Get cloud activity tracer logs with filtering by period, service, and user. Uses POST method with JSON body. Time parameters accept ISO 8601 strings and are converted to epoch milliseconds internally.",
    {
      startTime: z.string().describe("Start time in ISO 8601 format (e.g., \"2024-01-01T00:00:00Z\"). Converted to epoch ms internally. (Required)"),
      endTime: z.string().describe("End time in ISO 8601 format (e.g., \"2024-01-31T23:59:59Z\"). Converted to epoch ms internally. (Required)"),
      page: z.number().optional().describe("Page number (0-based, default 0)"),
      size: z.number().optional().describe("Page size (default 20)"),
      nrn: z.string().optional().describe("Ncloud Resource Name to filter specific resource activities"),
    },
    async (params) => {
      try {
        const fromEventTime = new Date(params.startTime).getTime();
        const toEventTime = new Date(params.endTime).getTime();

        if (isNaN(fromEventTime)) {
          return { content: [{ type: "text" as const, text: "startTime이 유효한 ISO 8601 형식이 아닙니다." }], isError: true };
        }
        if (isNaN(toEventTime)) {
          return { content: [{ type: "text" as const, text: "endTime이 유효한 ISO 8601 형식이 아닙니다." }], isError: true };
        }

        const body: Record<string, unknown> = {
          fromEventTime,
          toEventTime,
        };
        if (params.page !== undefined) body.page = params.page;
        if (params.size !== undefined) body.size = params.size;
        if (params.nrn !== undefined) body.nrn = params.nrn;

        const result = await client.postRequest("/api/v1/activities", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_activity_detail — Get detailed information of a specific activity
  server.tool(
    "ncloud_get_activity_detail",
    "Get detailed information about a specific cloud activity event. Queries the activity list with a narrow time range and filters by activityId.",
    {
      activityId: z.string().describe("The activity ID to get details for"),
      eventTime: z.string().describe("Approximate event time in ISO 8601 format to narrow the search window (e.g., \"2024-01-15T10:30:00Z\")"),
    },
    async (params) => {
      try {
        const eventTimeMs = new Date(params.eventTime).getTime();

        if (isNaN(eventTimeMs)) {
          return { content: [{ type: "text" as const, text: "eventTime이 유효한 ISO 8601 형식이 아닙니다." }], isError: true };
        }

        // Search within a 1-hour window around the event time
        const fromEventTime = eventTimeMs - 30 * 60 * 1000;
        const toEventTime = eventTimeMs + 30 * 60 * 1000;

        const body: Record<string, unknown> = {
          fromEventTime,
          toEventTime,
          size: 100,
        };

        const result = await client.postRequest("/api/v1/activities", body);

        // Filter by activityId from the response
        if (result && Array.isArray(result.content)) {
          const activity = result.content.find((item: any) => item.activityId === params.activityId);
          if (activity) {
            return toolText(activity);
          }
        }

        // If result is an array directly
        if (Array.isArray(result)) {
          const activity = result.find((item: any) => item.activityId === params.activityId);
          if (activity) {
            return toolText(activity);
          }
        }

        return { content: [{ type: "text" as const, text: `activityId '${params.activityId}'에 해당하는 활동을 찾을 수 없습니다. eventTime 범위를 확인해주세요.\n\n전체 응답:\n${JSON.stringify(result, null, 2)}` }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
