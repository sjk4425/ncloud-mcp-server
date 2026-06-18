import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { dryRunMessage } from "./_messages.js";

/**
 * Data Stream API Tools
 *
 * Base URLs:
 * - Topic/Connector/Schema: https://datastream.apigw.ntruss.com
 * - Message: https://api.datastream.naverncp.com
 *
 * RESTful API (POST/PUT/DELETE with JSON body)
 * 참조: DATASTREAM-API-SPEC.md
 */
export function registerDataStreamTools(
  server: McpServer,
  client: NcloudClient,
  messageClient: NcloudClient
): void {
  // ═══════════════════════════════════════════════════════════════════════════
  // Topic APIs
  // ═══════════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_datastream_get_topic_prefix",
    "Get the topic name prefix for the Data Stream service. The prefix is automatically prepended to topic names and is unique per account.",
    {},
    async () => {
      return client.requestRaw("GET", "/api/v1/topic-prefix");
    }
  );

  defineTool(
    server,
    "ncloud_datastream_list_topics",
    "List all topics on the Data Stream serverless streaming service",
    {
      sortBy: z.enum(["createdDate", "topicName"]).optional().describe("Sort field: createdDate (default) or topicName"),
      descending: z.boolean().optional().describe("Sort descending (default: true)"),
      searchText: z.string().optional().describe("Search by topic name or description"),
    },
    async (params) => {
      const queryParams: Record<string, string | boolean | undefined> = {};
      if (params.sortBy) queryParams.sortBy = params.sortBy;
      if (params.descending !== undefined) queryParams.descending = params.descending;
      if (params.searchText) queryParams.searchText = params.searchText;
      const result = await client.requestRaw("GET", "/api/v1/topics", queryParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datastream_get_topic",
    "Get detailed information of a specific Data Stream topic",
    {
      topicId: z.string().describe("Topic ID to query"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/topics/${params.topicId}`);
    }
  );

  defineTool(
    server,
    "ncloud_datastream_create_topic",
    "Create a new topic on the Data Stream service. Topic name must include the account prefix (use get_topic_prefix first). Use dryRun=true to preview.",
    {
      name: z.string().describe("Topic name including prefix (e.g. h4j6l-mytopic). Max 200 chars, lowercase+numbers+hyphen"),
      description: z.string().optional().describe("Topic description (max 200 chars)"),
      partitions: z.number().min(1).max(16).optional().describe("Number of partitions 1~16 (default: 1)"),
      retentionMs: z.number().min(3600000).max(1296000000).optional().describe("Message retention in ms (default: 86400000 = 24h)"),
      dryRun: z.boolean().optional().default(false).describe("If true, preview without creating"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "Dry-Run Preview: Data Stream Topic Creation",
          name: params.name,
          description: params.description ?? "(not set)",
          partitions: params.partitions ?? 1,
          retentionMs: params.retentionMs ?? 86400000,
          message: dryRunMessage({ ko: "토픽", en: "topic" }),
        };
        return preview;
      }
      const body: Record<string, any> = { name: params.name };
      if (params.description !== undefined) body.description = params.description;
      if (params.partitions !== undefined) body.partitions = params.partitions;
      if (params.retentionMs !== undefined) body.retentionMs = params.retentionMs;
      const result = await client.requestRaw("POST", "/api/v1/topics", undefined, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datastream_update_topic",
    "Update a Data Stream topic settings (partitions can only be increased, not decreased)",
    {
      topicId: z.string().describe("Topic ID to update"),
      description: z.string().describe("Topic description (max 200 chars)"),
      partitions: z.number().min(1).max(16).describe("Number of partitions (can only increase)"),
      retentionMs: z.number().min(3600000).max(1296000000).describe("Message retention in ms"),
    },
    async (params) => {
      const body = {
        description: params.description,
        partitions: params.partitions,
        retentionMs: params.retentionMs,
      };
      const result = await client.requestRaw("PUT", `/api/v1/topics/${params.topicId}`, undefined, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datastream_delete_topic",
    "⚠️ Destructive: Permanently delete a Data Stream topic. All messages in this topic will be lost. Set confirm=true to execute.",
    {
      topicId: z.string().describe("Topic ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `/api/v1/topics/${params.topicId}`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete topic [${params.topicId}]. All messages will be lost.\nTo execute, call again with confirm=true.` } }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Connector APIs
  // ═══════════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_datastream_get_connector",
    "Get connector information for a Data Stream topic (one connector per topic)",
    {
      topicId: z.string().describe("Topic ID to query connector"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/topics/${params.topicId}/connectors`);
    }
  );

  defineTool(
    server,
    "ncloud_datastream_create_connector",
    "Create a connector (Object Storage sink) for a Data Stream topic. Only one connector per topic. Use dryRun=true to preview.",
    {
      topicId: z.string().describe("Topic ID to create connector for"),
      consumerSpec: z.enum(["SMALL", "MEDIUM"]).describe("Consumer spec: SMALL (1 container, 250KB/s per partition) or MEDIUM (2 containers, 500KB/s per partition)"),
      exportType: z.literal("OBJECT_STORAGE").default("OBJECT_STORAGE").describe("Connector type (currently only OBJECT_STORAGE)"),
      location: z.string().describe("Storage path in s3a://{bucket}/{path} format"),
      includeTopicInPath: z.boolean().describe("Whether to create topic name directory in storage path"),
      dateFormat: z.enum(["NONE", "YEAR", "MONTH", "DAY", "HOUR"]).describe("Date format for sub-path: NONE, YEAR, MONTH, DAY, HOUR"),
      roleNrn: z.string().describe("NRN of the Data Stream service role for connector access"),
      description: z.string().optional().describe("Connector description (max 200 chars)"),
      flushInterval: z.number().min(1).max(10).optional().describe("File creation interval in minutes (default: 10)"),
      flushCount: z.number().min(5000).max(50000).optional().describe("Messages per file (default: 5000)"),
      schemaType: z.enum(["STRING", "JSON", "AVRO", "PROTOBUF"]).optional().describe("Message value serialization (default: STRING)"),
      dryRun: z.boolean().optional().default(false).describe("If true, preview without creating"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "Dry-Run Preview: Data Stream Connector Creation",
          topicId: params.topicId,
          consumerSpec: params.consumerSpec,
          exportType: params.exportType,
          location: params.location,
          includeTopicInPath: params.includeTopicInPath,
          dateFormat: params.dateFormat,
          roleNrn: params.roleNrn,
          flushInterval: params.flushInterval ?? 10,
          flushCount: params.flushCount ?? 5000,
          schemaType: params.schemaType ?? "STRING",
          message: dryRunMessage({ ko: "커넥터", en: "connector" }),
        };
        return preview;
      }
      const { topicId, dryRun, ...bodyParams } = params;
      const result = await client.requestRaw("POST", `/api/v1/topics/${topicId}/connectors`, undefined, bodyParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datastream_update_connector",
    "Update a Data Stream connector settings",
    {
      topicId: z.string().describe("Topic ID"),
      connectorId: z.string().describe("Connector ID to update"),
      consumerSpec: z.enum(["SMALL", "MEDIUM"]).describe("Consumer spec: SMALL or MEDIUM"),
      exportType: z.literal("OBJECT_STORAGE").default("OBJECT_STORAGE").describe("Connector type"),
      location: z.string().describe("Storage path in s3a://{bucket}/{path} format"),
      includeTopicInPath: z.boolean().describe("Whether to create topic name directory in storage path"),
      dateFormat: z.enum(["NONE", "YEAR", "MONTH", "DAY", "HOUR"]).describe("Date format for sub-path"),
      roleNrn: z.string().describe("NRN of the Data Stream service role"),
      description: z.string().optional().describe("Connector description (max 200 chars)"),
      flushInterval: z.number().min(1).max(10).optional().describe("File creation interval in minutes (default: 10)"),
      flushCount: z.number().min(5000).max(50000).optional().describe("Messages per file (default: 5000)"),
      schemaType: z.enum(["STRING", "JSON", "AVRO", "PROTOBUF"]).optional().describe("Message value serialization (default: STRING)"),
    },
    async (params) => {
      const { topicId, connectorId, ...bodyParams } = params;
      const result = await client.requestRaw("PUT", `/api/v1/topics/${topicId}/connectors/${connectorId}`, undefined, bodyParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datastream_delete_connector",
    "⚠️ Destructive: Delete a Data Stream connector. Set confirm=true to execute.",
    {
      topicId: z.string().describe("Topic ID"),
      connectorId: z.string().describe("Connector ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `/api/v1/topics/${params.topicId}/connectors/${params.connectorId}`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will delete connector [${params.connectorId}] from topic [${params.topicId}].\nTo execute, call again with confirm=true.` } }
  );


  // ═══════════════════════════════════════════════════════════════════════════
  // Schema APIs
  // ═══════════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_datastream_create_schema",
    "Create a schema for a Data Stream topic (AVRO, JSON, or PROTOBUF)",
    {
      topicId: z.string().describe("Topic ID to create schema for"),
      schemaType: z.enum(["AVRO", "JSON", "PROTOBUF"]).describe("Schema type"),
      schema: z.string().describe("Schema definition as JSON string"),
    },
    async (params) => {
      const body = { schemaType: params.schemaType, schema: params.schema };
      const result = await client.requestRaw("POST", `/api/v1/topics/${params.topicId}/schemas`, undefined, body);
      return result ?? { success: true };
    }
  );

  defineTool(
    server,
    "ncloud_datastream_list_schemas",
    "List schemas registered for a Data Stream topic",
    {
      topicId: z.string().describe("Topic ID to query schemas"),
      schemaType: z.enum(["AVRO", "JSON", "PROTOBUF"]).optional().describe("Filter by schema type"),
      schemaId: z.number().optional().describe("Filter by schema registry ID"),
      page: z.number().optional().describe("Page number (0-based, default: 0)"),
      size: z.number().optional().describe("Page size (default: 10)"),
    },
    async (params) => {
      const queryParams: Record<string, string | number | undefined> = {};
      if (params.schemaType) queryParams.schemaType = params.schemaType;
      if (params.schemaId !== undefined) queryParams.schemaId = params.schemaId;
      if (params.page !== undefined) queryParams.page = params.page;
      if (params.size !== undefined) queryParams.size = params.size;
      const result = await client.requestRaw("GET", `/api/v1/topics/${params.topicId}/schemas`, queryParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_datastream_get_schema",
    "Get detailed schema definition for a specific schema resource",
    {
      topicId: z.string().describe("Topic ID"),
      resourceId: z.string().describe("Schema resource ID (from list schemas response)"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/topics/${params.topicId}/schemas/${params.resourceId}`);
    }
  );

  defineTool(
    server,
    "ncloud_datastream_delete_schema",
    "⚠️ Destructive: Delete a schema from a Data Stream topic. May affect message serialization/deserialization. Set confirm=true to execute.",
    {
      topicId: z.string().describe("Topic ID"),
      resourceId: z.string().describe("Schema resource ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `/api/v1/topics/${params.topicId}/schemas/${params.resourceId}`);
      return result ?? { success: true };
    },
    { destructive: { message: (params) => `⚠️ This will delete schema [${params.resourceId}] from topic [${params.topicId}]. This may affect message serialization.\nTo execute, call again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_datastream_get_registry_config",
    "Get schema registry compatibility configuration for a Data Stream topic",
    {
      topicId: z.string().describe("Topic ID"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/topics/${params.topicId}/registry-config`);
    }
  );

  defineTool(
    server,
    "ncloud_datastream_update_registry_config",
    "Update schema registry compatibility setting for a Data Stream topic",
    {
      topicId: z.string().describe("Topic ID"),
      compatibility: z.boolean().describe("true: enable BACKWARD compatibility check, false: disable (NONE)"),
    },
    async (params) => {
      const body = { compatibility: params.compatibility };
      const result = await client.requestRaw("PUT", `/api/v1/topics/${params.topicId}/registry-config`, undefined, body);
      return result ?? { success: true };
    }
  );

  defineTool(
    server,
    "ncloud_datastream_get_registry_info",
    "Get schema registry endpoint and modifiability info for a Data Stream topic",
    {
      topicId: z.string().describe("Topic ID"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/topics/${params.topicId}/registry-info`);
    }
  );

  defineTool(
    server,
    "ncloud_datastream_check_schema_compatibility",
    "Check if a new schema is compatible with the latest existing schema for a Data Stream topic",
    {
      topicId: z.string().describe("Topic ID"),
      schemaType: z.enum(["AVRO", "JSON", "PROTOBUF"]).describe("Schema type"),
      schema: z.string().describe("New schema definition as JSON string to validate"),
    },
    async (params) => {
      const body = { schemaType: params.schemaType, schema: params.schema };
      const result = await client.requestRaw("POST", `/api/v1/topics/${params.topicId}/schemas/validate/compatibility/latest`, undefined, body);
      return result;
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Message API (different base URL: api.datastream.naverncp.com)
  // ═══════════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_datastream_send_message",
    "Send a message to a Data Stream topic. NOTE: Requires Sub Account credentials (main account keys are not allowed for this API).",
    {
      topic: z.string().describe("Topic name (full name including prefix)"),
      key: z.string().describe("Message key for partitioning"),
      value: z.string().describe("Message value (STRING type supported)"),
      partition: z.number().optional().describe("Specific partition index (0-based). If omitted, sent to random partition"),
    },
    async (params) => {
      const body: Record<string, any> = {
        topic: params.topic,
        key: params.key,
        value: params.value,
      };
      if (params.partition !== undefined) body.partition = params.partition;
      const result = await messageClient.requestRaw("POST", "/api/produce", undefined, body);
      return result;
    }
  );
}
