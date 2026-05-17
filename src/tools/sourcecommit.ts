import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

/**
 * SourceCommit API Tools
 *
 * Base URL: https://sourcecommit.apigw.ntruss.com
 * API Style: RESTful (POST/GET/PATCH/DELETE with JSON body)
 * Auth Headers: x-ncp-apigw-timestamp, x-ncp-iam-access-key, x-ncp-apigw-signature-v2
 *
 * Note: SourceCommit uses standard REST methods, NOT the legacy Ncloud GET-with-query style.
 *       Therefore we use client.requestRaw() to avoid adding responseFormatType/regionCode params.
 */
export function registerSourceCommitTools(server: McpServer, client: NcloudClient): void {
  // ─── Repository List ───────────────────────────────────────────────────────

  server.tool(
    "ncloud_sourcecommit_list_repos",
    "List all SourceCommit repositories. Supports filtering by name and pagination.",
    {
      repositoryName: z.string().optional().describe("Search keyword to filter repositories by name (partial match)"),
      pageNo: z.number().optional().describe("Page number (1-N, default: 1)"),
      pageSize: z.number().optional().describe("Number of items per page (1-N, displays entire list if not entered)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.repositoryName !== undefined) queryParams.repositoryName = params.repositoryName;
        if (params.pageNo !== undefined) queryParams.pageNo = String(params.pageNo);
        if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);

        const result = await client.requestRaw("GET", "/api/v1/repository", queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Repository Detail (by Name) ──────────────────────────────────────────

  server.tool(
    "ncloud_sourcecommit_get_repo",
    "Get detailed information about a specific SourceCommit repository by name",
    {
      repositoryName: z.string().describe("Name of the repository to query"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET",
          `/api/v1/repository/${encodeURIComponent(params.repositoryName)}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Repository Detail (by ID) ────────────────────────────────────────────

  server.tool(
    "ncloud_sourcecommit_get_repo_by_id",
    "Get detailed information about a specific SourceCommit repository by ID",
    {
      repositoryId: z.string().describe("Repository ID (from repository list)"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET",
          `/api/v1/repository/id/${encodeURIComponent(params.repositoryId)}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Repository Create ─────────────────────────────────────────────────────

  server.tool(
    "ncloud_sourcecommit_create_repo",
    "Create a new SourceCommit repository. Use dryRun=true to preview without creating.",
    {
      name: z.string().describe("Repository name (1-100 chars: English letters, numbers, '-', '_')"),
      description: z.string().optional().describe("Repository description (0-500 bytes)"),
      fileSafer: z.boolean().optional().describe("Integrate File Safer service (default: false)"),
      objectStorage: z.boolean().optional().describe("Integrate Object Storage service (default: false)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the repository"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: SourceCommit Repository Creation",
            repositoryName: params.name,
            description: params.description ?? "(none)",
            linked: {
              FileSafer: params.fileSafer ?? false,
              ObjectStorage: params.objectStorage ?? false,
            },
            message: "이 요청은 실제 저장소를 생성하지 않습니다. dryRun=false로 호출하면 저장소가 생성됩니다.",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }

        const body: Record<string, unknown> = { name: params.name };
        if (params.description !== undefined) body.description = params.description;
        const linked: Record<string, boolean> = {};
        if (params.fileSafer !== undefined) linked.FileSafer = params.fileSafer;
        if (params.objectStorage !== undefined) linked.ObjectStorage = params.objectStorage;
        if (Object.keys(linked).length > 0) body.linked = linked;

        const result = await client.requestRaw("POST", "/api/v1/repository", undefined, body);
        const summary = {
          리소스타입: "SourceCommit Repository",
          저장소명: params.name,
          설명: params.description ?? "(none)",
          linked: linked,
          상태: "created",
          result,
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Repository Edit (by Name) ─────────────────────────────────────────────

  server.tool(
    "ncloud_sourcecommit_edit_repo",
    "Edit SourceCommit repository settings (description, service integrations)",
    {
      repositoryName: z.string().describe("Name of the repository to edit"),
      description: z.string().optional().describe("New repository description (0-500 bytes)"),
      fileSafer: z.boolean().optional().describe("Integrate File Safer service (true/false)"),
      objectStorage: z.boolean().optional().describe("Integrate Object Storage service (true/false)"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.description !== undefined) body.description = params.description;
        const linked: Record<string, boolean> = {};
        if (params.fileSafer !== undefined) linked.FileSafer = params.fileSafer;
        if (params.objectStorage !== undefined) linked.ObjectStorage = params.objectStorage;
        if (Object.keys(linked).length > 0) body.linked = linked;

        const result = await client.requestRaw(
          "PATCH",
          `/api/v1/repository/${encodeURIComponent(params.repositoryName)}`,
          undefined,
          body
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Repository Edit (by ID) ───────────────────────────────────────────────

  server.tool(
    "ncloud_sourcecommit_edit_repo_by_id",
    "Edit SourceCommit repository settings by ID (description, service integrations)",
    {
      repositoryId: z.string().describe("Repository ID to edit"),
      description: z.string().optional().describe("New repository description (0-500 bytes)"),
      fileSafer: z.boolean().optional().describe("Integrate File Safer service (true/false)"),
      objectStorage: z.boolean().optional().describe("Integrate Object Storage service (true/false)"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.description !== undefined) body.description = params.description;
        const linked: Record<string, boolean> = {};
        if (params.fileSafer !== undefined) linked.FileSafer = params.fileSafer;
        if (params.objectStorage !== undefined) linked.ObjectStorage = params.objectStorage;
        if (Object.keys(linked).length > 0) body.linked = linked;

        const result = await client.requestRaw(
          "PATCH",
          `/api/v1/repository/id/${encodeURIComponent(params.repositoryId)}`,
          undefined,
          body
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Repository Delete (by Name) ───────────────────────────────────────────

  server.tool(
    "ncloud_sourcecommit_delete_repo",
    "⚠️ Destructive: Permanently delete a SourceCommit repository. Set confirm=true to execute.",
    {
      repositoryName: z.string().describe("Name of the repository to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete SourceCommit Repository [${params.repositoryName}]. All branches, commits, and history will be destroyed.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.requestRaw(
          "DELETE",
          `/api/v1/repository/${encodeURIComponent(params.repositoryName)}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Repository Delete (by ID) ─────────────────────────────────────────────

  server.tool(
    "ncloud_sourcecommit_delete_repo_by_id",
    "⚠️ Destructive: Permanently delete a SourceCommit repository by ID. Set confirm=true to execute.",
    {
      repositoryId: z.string().describe("Repository ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete SourceCommit Repository ID [${params.repositoryId}]. All branches, commits, and history will be destroyed.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.requestRaw(
          "DELETE",
          `/api/v1/repository/id/${encodeURIComponent(params.repositoryId)}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Branch List ───────────────────────────────────────────────────────────

  server.tool(
    "ncloud_sourcecommit_list_branches",
    "List all branches in a SourceCommit repository (includes default branch info)",
    {
      repositoryName: z.string().describe("Name of the repository"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET",
          `/api/v1/repository/${encodeURIComponent(params.repositoryName)}/branch`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Tag List ──────────────────────────────────────────────────────────────

  server.tool(
    "ncloud_sourcecommit_list_tags",
    "List all tags in a SourceCommit repository",
    {
      repositoryName: z.string().describe("Name of the repository"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET",
          `/api/v1/repository/${encodeURIComponent(params.repositoryName)}/tag`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Set Default Branch ────────────────────────────────────────────────────

  server.tool(
    "ncloud_sourcecommit_set_default_branch",
    "Set the default branch for a SourceCommit repository",
    {
      repositoryName: z.string().describe("Name of the repository"),
      branchName: z.string().describe("Name of the branch to set as default"),
    },
    async (params) => {
      try {
        const body = { default: params.branchName };
        const result = await client.requestRaw(
          "POST",
          `/api/v1/repository/${encodeURIComponent(params.repositoryName)}/branch/default`,
          undefined,
          body
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
