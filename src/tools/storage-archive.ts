import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SwiftCompatibleClient } from "../client/swift-compatible-client.js";
import { defineTool } from "./_tool.js";
import { deletedMessage, dryRunMessage, requiredError } from "./_messages.js";

/**
 * Parse JSON array response from Swift (when format=json is specified).
 */
function parseJsonResponse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/**
 * Extract metadata from response headers.
 * Swift returns metadata as X-Container-Meta-* or X-Object-Meta-* headers.
 */
function extractMetadata(headers: Headers, prefix: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith(prefix)) {
      const metaKey = key.substring(prefix.length);
      metadata[metaKey] = value;
    }
  });
  return metadata;
}

export function registerStorageArchiveTools(server: McpServer, client: SwiftCompatibleClient): void {
  // ─── Container Query Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_archive_containers",
    "List all containers in the Archive Storage account",
    {
      limit: z.number().optional().describe("Maximum number of containers to return"),
      marker: z.string().optional().describe("Container name to start listing after (for pagination)"),
      prefix: z.string().optional().describe("Filter containers by name prefix"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { format: "json" };
      if (params.limit) queryParams["limit"] = String(params.limit);
      if (params.marker) queryParams["marker"] = params.marker;
      if (params.prefix) queryParams["prefix"] = params.prefix;

      const response = await client.request({
        method: "GET",
        queryParams,
      });
      const result = parseJsonResponse(response.body);
      return result;
    }
  );

  // ─── Container Create Tools ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_archive_container",
    "Create a new container in Archive Storage. Use dryRun=true to preview.",
    {
      containerName: z.string({
        required_error: requiredError("containerName"),
      }).describe("Name of the container to create"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: Archive Container Creation",
          containerName: params.containerName,
          region: client.getRegionCode(),
          message: dryRunMessage({ ko: "컨테이너", en: "container" }),
        };
        return preview;
      }
      await client.request({
        method: "PUT",
        container: params.containerName,
      });
      const summary = {
        리소스타입: "Archive Container",
        리소스명: params.containerName,
        리전: client.getRegionCode(),
        상태: "created",
      };
      return summary;
    }
  );

  // ─── Container Destructive Tools ───────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_archive_container",
    "⚠️ Destructive: Permanently delete an empty container from Archive Storage. The container must be empty. Set confirm=true to execute.",
    {
      containerName: z.string({
        required_error: requiredError("containerName"),
      }).describe("Name of the container to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      await client.request({
        method: "DELETE",
        container: params.containerName,
      });
      const result = { message: deletedMessage({ ko: `Archive 컨테이너 '${params.containerName}'`, en: `Archive container '${params.containerName}'` }) };
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Archive Container [${params.containerName}]. The container must be empty. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Container Metadata Tools ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_head_archive_container",
    "Get metadata for an Archive Storage container (object count, bytes used, custom metadata)",
    {
      containerName: z.string({
        required_error: requiredError("containerName"),
      }).describe("Name of the container"),
    },
    async (params) => {
      const response = await client.request({
        method: "HEAD",
        container: params.containerName,
      });
      const metadata = extractMetadata(response.headers, "x-container-meta-");
      const result = {
        container: params.containerName,
        objectCount: response.headers.get("x-container-object-count") ?? "0",
        bytesUsed: response.headers.get("x-container-bytes-used") ?? "0",
        metadata,
      };
      return result;
    }
  );

  // ─── Object Query Tools ────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_archive_objects",
    "List objects in an Archive Storage container",
    {
      containerName: z.string({
        required_error: requiredError("containerName"),
      }).describe("Name of the container"),
      limit: z.number().optional().describe("Maximum number of objects to return"),
      marker: z.string().optional().describe("Object name to start listing after (for pagination)"),
      prefix: z.string().optional().describe("Filter objects by name prefix"),
      delimiter: z.string().optional().describe("Delimiter for pseudo-directory grouping (commonly '/')"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { format: "json" };
      if (params.limit) queryParams["limit"] = String(params.limit);
      if (params.marker) queryParams["marker"] = params.marker;
      if (params.prefix) queryParams["prefix"] = params.prefix;
      if (params.delimiter) queryParams["delimiter"] = params.delimiter;

      const response = await client.request({
        method: "GET",
        container: params.containerName,
        queryParams,
      });
      const result = parseJsonResponse(response.body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_download_archive_object",
    "Download (GET) an object from an Archive Storage container. Returns the object content as text.",
    {
      containerName: z.string({
        required_error: requiredError("containerName"),
      }).describe("Name of the container"),
      objectName: z.string({
        required_error: requiredError("objectName"),
      }).describe("Object name (path) to download"),
    },
    async (params) => {
      const response = await client.request({
        method: "GET",
        container: params.containerName,
        object: params.objectName,
      });
      const result = {
        container: params.containerName,
        object: params.objectName,
        contentLength: response.headers.get("content-length"),
        contentType: response.headers.get("content-type"),
        lastModified: response.headers.get("last-modified"),
        etag: response.headers.get("etag"),
        body: response.body,
      };
      return result;
    }
  );

  // ─── Object Metadata Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_head_archive_object",
    "Get metadata for an object in Archive Storage (size, content-type, custom metadata)",
    {
      containerName: z.string({
        required_error: requiredError("containerName"),
      }).describe("Name of the container"),
      objectName: z.string({
        required_error: requiredError("objectName"),
      }).describe("Object name (path) to inspect"),
    },
    async (params) => {
      const response = await client.request({
        method: "HEAD",
        container: params.containerName,
        object: params.objectName,
      });
      const metadata = extractMetadata(response.headers, "x-object-meta-");
      const result = {
        container: params.containerName,
        object: params.objectName,
        contentLength: response.headers.get("content-length"),
        contentType: response.headers.get("content-type"),
        lastModified: response.headers.get("last-modified"),
        etag: response.headers.get("etag"),
        metadata,
      };
      return result;
    }
  );

  // ─── Object Create/Update Tools ────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_upload_archive_object",
    "Upload (PUT) an object to an Archive Storage container. Use dryRun=true to preview.",
    {
      containerName: z.string({
        required_error: requiredError("containerName"),
      }).describe("Name of the container"),
      objectName: z.string({
        required_error: requiredError("objectName"),
      }).describe("Object name (path) to upload to"),
      body: z.string({
        required_error: requiredError("body"),
      }).describe("Content to upload as the object body"),
      contentType: z.string().optional().describe("Content-Type for the object (e.g., 'text/plain', 'application/json')"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually uploading"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: Archive Object Upload",
          containerName: params.containerName,
          objectName: params.objectName,
          contentType: params.contentType ?? "application/octet-stream",
          bodySize: `${params.body.length} bytes`,
          message: dryRunMessage({ ko: "오브젝트", en: "object" }, "upload"),
        };
        return preview;
      }

      const headers: Record<string, string> = {};
      if (params.contentType) {
        headers["Content-Type"] = params.contentType;
      }

      const response = await client.request({
        method: "PUT",
        container: params.containerName,
        object: params.objectName,
        headers,
        body: params.body,
      });

      const summary = {
        리소스타입: "Archive Object",
        컨테이너: params.containerName,
        오브젝트: params.objectName,
        크기: `${params.body.length} bytes`,
        etag: response.headers.get("etag") ?? "",
        상태: "uploaded",
      };
      return summary;
    }
  );

  // ─── Object Copy Tools ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_copy_archive_object",
    "Copy an object to another location within Archive Storage",
    {
      containerName: z.string({
        required_error: requiredError("containerName"),
      }).describe("Source container name"),
      objectName: z.string({
        required_error: requiredError("objectName"),
      }).describe("Source object name"),
      destination: z.string({
        required_error: requiredError("destination"),
      }).describe("Destination path in format: /{destContainer}/{destObject}"),
    },
    async (params) => {
      await client.request({
        method: "COPY",
        container: params.containerName,
        object: params.objectName,
        headers: {
          Destination: params.destination,
        },
      });
      const result = {
        source: `${params.containerName}/${params.objectName}`,
        destination: params.destination,
        상태: "copied",
      };
      return result;
    }
  );

  // ─── Object Destructive Tools ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_archive_object",
    "⚠️ Destructive: Permanently delete an object from an Archive Storage container. Set confirm=true to execute.",
    {
      containerName: z.string({
        required_error: requiredError("containerName"),
      }).describe("Name of the container"),
      objectName: z.string({
        required_error: requiredError("objectName"),
      }).describe("Object name (path) to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      await client.request({
        method: "DELETE",
        container: params.containerName,
        object: params.objectName,
      });
      const result = { message: deletedMessage({ ko: `Archive 오브젝트 '${params.containerName}/${params.objectName}'`, en: `Archive object '${params.containerName}/${params.objectName}'` }) };
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Archive Object [${params.containerName}/${params.objectName}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );
}
