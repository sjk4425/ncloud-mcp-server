import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

export function registerResourceManagerTools(server: McpServer, client: NcloudClient): void {
  // ncloud_resource_list_resources — List resources with optional filters
  server.tool(
    "ncloud_resource_list_resources",
    "List resources managed in Ncloud. When NRN is specified, returns single resource detail with tags and groups.",
    {
      nrn: z.string().optional().describe("Ncloud Resource Name for single resource detail lookup"),
      productName: z.string().optional().describe("Product name filter (e.g., 'Server (VPC)', 'VPC')"),
      regionCode: z.string().optional().describe("Region code filter (e.g., 'KR', 'JPN')"),
      resourceType: z.string().optional().describe("Resource type filter"),
      resourceId: z.string().optional().describe("Resource ID filter"),
      resourceName: z.string().optional().describe("Resource name filter"),
      tag: z.array(z.object({
        tagKey: z.string().describe("Tag key"),
        tagValue: z.string().describe("Tag value"),
      })).optional().describe("Tag filter array [{tagKey, tagValue}]"),
      groupName: z.string().optional().describe("Group name filter"),
      page: z.number().optional().describe("Page number (default 0)"),
      size: z.number().optional().describe("Page size (default 20)"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.nrn !== undefined) body.nrn = params.nrn;
        if (params.productName !== undefined) body.productName = params.productName;
        if (params.regionCode !== undefined) body.regionCode = params.regionCode;
        if (params.resourceType !== undefined) body.resourceType = params.resourceType;
        if (params.resourceId !== undefined) body.resourceId = params.resourceId;
        if (params.resourceName !== undefined) body.resourceName = params.resourceName;
        if (params.tag !== undefined) body.tag = params.tag;
        if (params.groupName !== undefined) body.groupName = params.groupName;
        if (params.page !== undefined) body.page = params.page;
        if (params.size !== undefined) body.size = params.size;

        const result = await client.postRequest("/api/v1/resources", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_resource_attach_tag — Attach tag to resources
  server.tool(
    "ncloud_resource_attach_tag",
    "Attach a tag to one or more resources. If the tag key already exists, the value is updated.",
    {
      nrnList: z.array(z.string()).describe("List of Ncloud Resource Names to tag"),
      tagKey: z.string().describe("Tag key to attach"),
      tagValue: z.string().describe("Tag value to attach"),
    },
    async (params) => {
      try {
        const body = {
          nrnList: params.nrnList,
          tagKey: params.tagKey,
          tagValue: params.tagValue,
        };

        const result = await client.postRequest("/api/v1/resource-tags", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_resource_detach_tag — Detach tag from resources (destructive)
  server.tool(
    "ncloud_resource_detach_tag",
    "\u26a0\ufe0f Destructive: Remove a tag from one or more resources. Set confirm=true to execute.",
    {
      nrnList: z.array(z.string()).describe("List of Ncloud Resource Names to remove tag from"),
      tagKey: z.string().describe("Tag key to remove"),
      tagValue: z.string().optional().describe("Tag value (optional, if omitted removes all values for the key)"),
      confirm: z.boolean().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `\u26a0\ufe0f This will remove tag [${params.tagKey}${params.tagValue ? `=${params.tagValue}` : ""}] from ${params.nrnList.length} resource(s).\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }

        const body: Record<string, unknown> = {
          nrnList: params.nrnList,
          tagKey: params.tagKey,
        };
        if (params.tagValue !== undefined) body.tagValue = params.tagValue;

        const result = await client.deleteRequest("/api/v1/resource-tags", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_resource_list_groups — List resource groups
  server.tool(
    "ncloud_resource_list_groups",
    "List resource groups with optional name filter and pagination.",
    {
      groupName: z.string().optional().describe("Group name filter"),
      page: z.number().optional().describe("Page number (default 0)"),
      size: z.number().optional().describe("Page size (default 20)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.groupName !== undefined) queryParams.groupName = params.groupName;
        if (params.page !== undefined) queryParams.page = String(params.page);
        if (params.size !== undefined) queryParams.size = String(params.size);

        const result = await client.requestRaw("GET", "/api/v1/groups", Object.keys(queryParams).length > 0 ? queryParams : undefined);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_resource_attach_group — Add resources to a group
  server.tool(
    "ncloud_resource_attach_group",
    "Add one or more resources to a resource group.",
    {
      groupId: z.string().describe("Resource group ID"),
      nrnList: z.array(z.string()).describe("List of Ncloud Resource Names to add to the group"),
    },
    async (params) => {
      try {
        const body = {
          nrnList: params.nrnList,
        };

        const result = await client.requestRaw(
          "POST",
          `/api/v1/groups/${encodeURIComponent(params.groupId)}/resources`,
          undefined,
          body
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_resource_detach_group — Remove resources from a group (destructive)
  server.tool(
    "ncloud_resource_detach_group",
    "\u26a0\ufe0f Destructive: Remove one or more resources from a resource group. Set confirm=true to execute.",
    {
      groupId: z.string().describe("Resource group ID"),
      nrnList: z.array(z.string()).describe("List of Ncloud Resource Names to remove from the group"),
      confirm: z.boolean().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `\u26a0\ufe0f This will remove ${params.nrnList.length} resource(s) from group [${params.groupId}].\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }

        const body = {
          nrnList: params.nrnList,
        };

        const result = await client.requestRaw(
          "DELETE",
          `/api/v1/groups/${encodeURIComponent(params.groupId)}/resources`,
          undefined,
          body
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
