import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { S3CompatibleClient } from "../client/s3-compatible-client.js";
import { defineTool } from "./_tool.js";
import { L, deletedMessage, dryRunMessage, requiredError } from "./_messages.js";

/**
 * Parse S3 XML list buckets response into a structured object.
 */
function parseListBucketsXml(xml: string): { buckets: Array<{ name: string; creationDate: string }> } {
  const buckets: Array<{ name: string; creationDate: string }> = [];
  const bucketRegex = /<Bucket>\s*<Name>(.*?)<\/Name>\s*<CreationDate>(.*?)<\/CreationDate>\s*<\/Bucket>/gs;
  let match: RegExpExecArray | null;
  while ((match = bucketRegex.exec(xml)) !== null) {
    buckets.push({ name: match[1], creationDate: match[2] });
  }
  return { buckets };
}

/**
 * Parse S3 XML list objects response into a structured object.
 */
function parseListObjectsXml(xml: string): {
  name: string;
  prefix: string;
  isTruncated: boolean;
  contents: Array<{ key: string; lastModified: string; size: string; storageClass: string }>;
  commonPrefixes: string[];
} {
  const nameMatch = xml.match(/<Name>(.*?)<\/Name>/);
  const prefixMatch = xml.match(/<Prefix>(.*?)<\/Prefix>/);
  const truncatedMatch = xml.match(/<IsTruncated>(.*?)<\/IsTruncated>/);

  const contents: Array<{ key: string; lastModified: string; size: string; storageClass: string }> = [];
  const contentsRegex = /<Contents>\s*<Key>(.*?)<\/Key>\s*<LastModified>(.*?)<\/LastModified>.*?<Size>(.*?)<\/Size>.*?<StorageClass>(.*?)<\/StorageClass>\s*<\/Contents>/gs;
  let match: RegExpExecArray | null;
  while ((match = contentsRegex.exec(xml)) !== null) {
    contents.push({
      key: match[1],
      lastModified: match[2],
      size: match[3],
      storageClass: match[4],
    });
  }

  const commonPrefixes: string[] = [];
  const prefixRegex = /<CommonPrefixes>\s*<Prefix>(.*?)<\/Prefix>\s*<\/CommonPrefixes>/gs;
  while ((match = prefixRegex.exec(xml)) !== null) {
    commonPrefixes.push(match[1]);
  }

  return {
    name: nameMatch?.[1] ?? "",
    prefix: prefixMatch?.[1] ?? "",
    isTruncated: truncatedMatch?.[1] === "true",
    contents,
    commonPrefixes,
  };
}

/**
 * Parse S3 XML ACL response into a structured object.
 */
function parseAclXml(xml: string): {
  owner: { id: string; displayName: string };
  grants: Array<{ grantee: string; permission: string }>;
} {
  const ownerIdMatch = xml.match(/<Owner>\s*<ID>(.*?)<\/ID>/s);
  const ownerNameMatch = xml.match(/<Owner>.*?<DisplayName>(.*?)<\/DisplayName>/s);

  const grants: Array<{ grantee: string; permission: string }> = [];
  const grantRegex = /<Grant>\s*<Grantee[^>]*>.*?(?:<ID>(.*?)<\/ID>|<URI>(.*?)<\/URI>).*?<\/Grantee>\s*<Permission>(.*?)<\/Permission>\s*<\/Grant>/gs;
  let match: RegExpExecArray | null;
  while ((match = grantRegex.exec(xml)) !== null) {
    grants.push({
      grantee: match[1] || match[2] || "unknown",
      permission: match[3],
    });
  }

  return {
    owner: {
      id: ownerIdMatch?.[1] ?? "",
      displayName: ownerNameMatch?.[1] ?? "",
    },
    grants,
  };
}

/**
 * Parse S3 XML initiate multipart upload response.
 */
function parseInitiateMultipartXml(xml: string): { bucket: string; key: string; uploadId: string } {
  const bucketMatch = xml.match(/<Bucket>(.*?)<\/Bucket>/);
  const keyMatch = xml.match(/<Key>(.*?)<\/Key>/);
  const uploadIdMatch = xml.match(/<UploadId>(.*?)<\/UploadId>/);
  return {
    bucket: bucketMatch?.[1] ?? "",
    key: keyMatch?.[1] ?? "",
    uploadId: uploadIdMatch?.[1] ?? "",
  };
}

/**
 * Parse S3 XML versioning configuration response.
 */
function parseVersioningXml(xml: string): { status: string } {
  const statusMatch = xml.match(/<Status>(.*?)<\/Status>/);
  return { status: statusMatch?.[1] ?? "Disabled" };
}

/**
 * Parse S3 XML list object versions response.
 */
function parseListObjectVersionsXml(xml: string): {
  name: string;
  prefix: string;
  isTruncated: boolean;
  keyMarker: string;
  versionIdMarker: string;
  nextKeyMarker: string;
  nextVersionIdMarker: string;
  versions: Array<{ key: string; versionId: string; isLatest: boolean; lastModified: string; size: string; storageClass: string }>;
  deleteMarkers: Array<{ key: string; versionId: string; isLatest: boolean; lastModified: string }>;
  commonPrefixes: string[];
} {
  const nameMatch = xml.match(/<Name>(.*?)<\/Name>/);
  const prefixMatch = xml.match(/<ListVersionsResult[^>]*>.*?<Prefix>(.*?)<\/Prefix>/s);
  const truncatedMatch = xml.match(/<IsTruncated>(.*?)<\/IsTruncated>/);
  const keyMarkerMatch = xml.match(/<KeyMarker>(.*?)<\/KeyMarker>/);
  const versionIdMarkerMatch = xml.match(/<VersionIdMarker>(.*?)<\/VersionIdMarker>/);
  const nextKeyMarkerMatch = xml.match(/<NextKeyMarker>(.*?)<\/NextKeyMarker>/);
  const nextVersionIdMarkerMatch = xml.match(/<NextVersionIdMarker>(.*?)<\/NextVersionIdMarker>/);

  const versions: Array<{ key: string; versionId: string; isLatest: boolean; lastModified: string; size: string; storageClass: string }> = [];
  const versionRegex = /<Version>\s*<Key>(.*?)<\/Key>\s*<VersionId>(.*?)<\/VersionId>\s*<IsLatest>(.*?)<\/IsLatest>\s*<LastModified>(.*?)<\/LastModified>.*?<Size>(.*?)<\/Size>.*?<StorageClass>(.*?)<\/StorageClass>\s*<\/Version>/gs;
  let match: RegExpExecArray | null;
  while ((match = versionRegex.exec(xml)) !== null) {
    versions.push({
      key: match[1],
      versionId: match[2],
      isLatest: match[3] === "true",
      lastModified: match[4],
      size: match[5],
      storageClass: match[6],
    });
  }

  const deleteMarkers: Array<{ key: string; versionId: string; isLatest: boolean; lastModified: string }> = [];
  const deleteMarkerRegex = /<DeleteMarker>\s*<Key>(.*?)<\/Key>\s*<VersionId>(.*?)<\/VersionId>\s*<IsLatest>(.*?)<\/IsLatest>\s*<LastModified>(.*?)<\/LastModified>.*?<\/DeleteMarker>/gs;
  while ((match = deleteMarkerRegex.exec(xml)) !== null) {
    deleteMarkers.push({
      key: match[1],
      versionId: match[2],
      isLatest: match[3] === "true",
      lastModified: match[4],
    });
  }

  const commonPrefixes: string[] = [];
  const prefixRegex = /<CommonPrefixes>\s*<Prefix>(.*?)<\/Prefix>\s*<\/CommonPrefixes>/gs;
  while ((match = prefixRegex.exec(xml)) !== null) {
    commonPrefixes.push(match[1]);
  }

  return {
    name: nameMatch?.[1] ?? "",
    prefix: prefixMatch?.[1] ?? "",
    isTruncated: truncatedMatch?.[1] === "true",
    keyMarker: keyMarkerMatch?.[1] ?? "",
    versionIdMarker: versionIdMarkerMatch?.[1] ?? "",
    nextKeyMarker: nextKeyMarkerMatch?.[1] ?? "",
    nextVersionIdMarker: nextVersionIdMarkerMatch?.[1] ?? "",
    versions,
    deleteMarkers,
    commonPrefixes,
  };
}

/**
 * Parse S3 XML ListParts response into a structured object.
 */
function parseListPartsXml(xml: string): {
  bucket: string;
  key: string;
  uploadId: string;
  isTruncated: boolean;
  nextPartNumberMarker: string;
  parts: Array<{ partNumber: number; lastModified: string; etag: string; size: string }>;
} {
  const bucketMatch = xml.match(/<Bucket>(.*?)<\/Bucket>/);
  const keyMatch = xml.match(/<Key>(.*?)<\/Key>/);
  const uploadIdMatch = xml.match(/<UploadId>(.*?)<\/UploadId>/);
  const truncatedMatch = xml.match(/<IsTruncated>(.*?)<\/IsTruncated>/);
  const nextMarkerMatch = xml.match(/<NextPartNumberMarker>(.*?)<\/NextPartNumberMarker>/);

  const parts: Array<{ partNumber: number; lastModified: string; etag: string; size: string }> = [];
  const partRegex = /<Part>\s*<PartNumber>(\d+)<\/PartNumber>\s*<LastModified>(.*?)<\/LastModified>\s*<ETag>(.*?)<\/ETag>\s*<Size>(\d+)<\/Size>\s*<\/Part>/gs;
  let match: RegExpExecArray | null;
  while ((match = partRegex.exec(xml)) !== null) {
    parts.push({
      partNumber: parseInt(match[1], 10),
      lastModified: match[2],
      etag: match[3],
      size: match[4],
    });
  }

  return {
    bucket: bucketMatch?.[1] ?? "",
    key: keyMatch?.[1] ?? "",
    uploadId: uploadIdMatch?.[1] ?? "",
    isTruncated: truncatedMatch?.[1] === "true",
    nextPartNumberMarker: nextMarkerMatch?.[1] ?? "",
    parts,
  };
}

/**
 * Parse S3 XML ListMultipartUploads response into a structured object.
 */
function parseListMultipartUploadsXml(xml: string): {
  bucket: string;
  isTruncated: boolean;
  nextKeyMarker: string;
  nextUploadIdMarker: string;
  uploads: Array<{ key: string; uploadId: string; initiated: string; storageClass: string }>;
  commonPrefixes: string[];
} {
  const bucketMatch = xml.match(/<Bucket>(.*?)<\/Bucket>/);
  const truncatedMatch = xml.match(/<IsTruncated>(.*?)<\/IsTruncated>/);
  const nextKeyMarkerMatch = xml.match(/<NextKeyMarker>(.*?)<\/NextKeyMarker>/);
  const nextUploadIdMarkerMatch = xml.match(/<NextUploadIdMarker>(.*?)<\/NextUploadIdMarker>/);

  const uploads: Array<{ key: string; uploadId: string; initiated: string; storageClass: string }> = [];
  const uploadRegex = /<Upload>\s*<Key>(.*?)<\/Key>\s*<UploadId>(.*?)<\/UploadId>.*?<Initiated>(.*?)<\/Initiated>.*?<StorageClass>(.*?)<\/StorageClass>\s*<\/Upload>/gs;
  let match: RegExpExecArray | null;
  while ((match = uploadRegex.exec(xml)) !== null) {
    uploads.push({
      key: match[1],
      uploadId: match[2],
      initiated: match[3],
      storageClass: match[4],
    });
  }

  const commonPrefixes: string[] = [];
  const prefixRegex = /<CommonPrefixes>\s*<Prefix>(.*?)<\/Prefix>\s*<\/CommonPrefixes>/gs;
  while ((match = prefixRegex.exec(xml)) !== null) {
    commonPrefixes.push(match[1]);
  }

  return {
    bucket: bucketMatch?.[1] ?? "",
    isTruncated: truncatedMatch?.[1] === "true",
    nextKeyMarker: nextKeyMarkerMatch?.[1] ?? "",
    nextUploadIdMarker: nextUploadIdMarkerMatch?.[1] ?? "",
    uploads,
    commonPrefixes,
  };
}

export function registerStorageObjectTools(server: McpServer, client: S3CompatibleClient): void {
  // ─── Bucket Query Tools ────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_buckets",
    "List all Object Storage buckets in the current region",
    {},
    async () => {
      const response = await client.request({ method: "GET" });
      const result = parseListBucketsXml(response.body);
      return result;
    }
  );

  // ─── Bucket Create Tools ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_bucket",
    "Create a new Object Storage bucket. Use dryRun=true to preview.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to create"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: Bucket Creation",
          bucketName: params.bucketName,
          region: client.getRegionCode(),
          message: dryRunMessage({ ko: "버킷", en: "bucket" }),
        };
        return preview;
      }
      await client.request({ method: "PUT", bucket: params.bucketName });
      const summary = {
        리소스타입: "Bucket",
        리소스명: params.bucketName,
        리전: client.getRegionCode(),
        상태: "created",
      };
      return summary;
    }
  );

  // ─── Bucket Destructive Tools ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_bucket",
    "⚠️ Destructive: Permanently delete an Object Storage bucket. The bucket must be empty. Set confirm=true to execute.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      await client.request({ method: "DELETE", bucket: params.bucketName });
      const result = { message: deletedMessage({ ko: `버킷 '${params.bucketName}'`, en: `bucket '${params.bucketName}'` }) };
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Bucket [${params.bucketName}]. The bucket must be empty. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Object Query Tools ────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_objects",
    "List objects in an Object Storage bucket",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      prefix: z.string().optional().describe("Limits results to keys beginning with this prefix"),
      delimiter: z.string().optional().describe("Delimiter for grouping keys (commonly '/')"),
      maxKeys: z.number().optional().describe("Maximum number of keys to return (default 1000)"),
      marker: z.string().optional().describe("Marker for pagination (key to start after)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.prefix) queryParams["prefix"] = params.prefix;
      if (params.delimiter) queryParams["delimiter"] = params.delimiter;
      if (params.maxKeys) queryParams["max-keys"] = String(params.maxKeys);
      if (params.marker) queryParams["marker"] = params.marker;

      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        queryParams,
      });
      const result = parseListObjectsXml(response.body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_get_object",
    "Get (download) an object from an Object Storage bucket. Returns the object content as text.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      key: z.string({
        required_error: requiredError("key"),
      }).describe("Object key (path) to retrieve"),
    },
    async (params) => {
      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        key: params.key,
      });
      const result = {
        bucket: params.bucketName,
        key: params.key,
        contentLength: response.headers.get("content-length"),
        contentType: response.headers.get("content-type"),
        lastModified: response.headers.get("last-modified"),
        body: response.body,
      };
      return result;
    }
  );

  // ─── Object Create/Update Tools ────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_put_object",
    "Upload (put) an object to an Object Storage bucket. Use dryRun=true to preview.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      key: z.string({
        required_error: requiredError("key"),
      }).describe("Object key (path) to upload to"),
      body: z.string({
        required_error: requiredError("body"),
      }).describe("Content to upload as the object body"),
      contentType: z.string().optional().describe("Content-Type header for the object (e.g., 'text/plain', 'application/json')"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually uploading"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: Object Upload",
          bucketName: params.bucketName,
          key: params.key,
          contentType: params.contentType ?? "application/octet-stream",
          bodySize: `${params.body.length} bytes`,
          message: dryRunMessage({ ko: "오브젝트", en: "object" }, "upload"),
        };
        return preview;
      }

      const headers: Record<string, string> = {};
      if (params.contentType) {
        headers["content-type"] = params.contentType;
      }

      await client.request({
        method: "PUT",
        bucket: params.bucketName,
        key: params.key,
        headers,
        body: params.body,
      });

      const summary = {
        리소스타입: "Object",
        버킷: params.bucketName,
        키: params.key,
        크기: `${params.body.length} bytes`,
        상태: "uploaded",
      };
      return summary;
    }
  );

  // ─── Object Destructive Tools ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_object",
    "⚠️ Destructive: Permanently delete an object from an Object Storage bucket. Set confirm=true to execute.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      key: z.string({
        required_error: requiredError("key"),
      }).describe("Object key (path) to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      await client.request({
        method: "DELETE",
        bucket: params.bucketName,
        key: params.key,
      });
      const result = { message: deletedMessage({ ko: `오브젝트 '${params.bucketName}/${params.key}'`, en: `object '${params.bucketName}/${params.key}'` }) };
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Object [${params.bucketName}/${params.key}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Multipart Upload Tools ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_initiate_multipart_upload",
    "Initiate a multipart upload for a large object in Object Storage",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      key: z.string({
        required_error: requiredError("key"),
      }).describe("Object key (path) for the multipart upload"),
      contentType: z.string().optional().describe("Content-Type for the object"),
    },
    async (params) => {
      const headers: Record<string, string> = {};
      if (params.contentType) {
        headers["content-type"] = params.contentType;
      }

      const response = await client.request({
        method: "POST",
        bucket: params.bucketName,
        key: params.key,
        queryParams: { uploads: "" },
        headers,
      });
      const result = parseInitiateMultipartXml(response.body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_complete_multipart_upload",
    "Complete a multipart upload by assembling previously uploaded parts",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      key: z.string({
        required_error: requiredError("key"),
      }).describe("Object key (path) for the multipart upload"),
      uploadId: z.string({
        required_error: requiredError("uploadId"),
      }).describe("Upload ID returned from initiate multipart upload"),
      parts: z.array(z.object({
        partNumber: z.number().describe("Part number (1-based)"),
        etag: z.string().describe("ETag returned when the part was uploaded"),
      })).min(1).describe("List of parts with their part numbers and ETags"),
    },
    async (params) => {
      // Build the CompleteMultipartUpload XML body
      const partsXml = params.parts
        .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
        .join("");
      const body = `<CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`;

      const response = await client.request({
        method: "POST",
        bucket: params.bucketName,
        key: params.key,
        queryParams: { uploadId: params.uploadId },
        headers: { "content-type": "application/xml" },
        body,
      });

      // Parse completion response
      const locationMatch = response.body.match(/<Location>(.*?)<\/Location>/);
      const keyMatch = response.body.match(/<Key>(.*?)<\/Key>/);
      const etagMatch = response.body.match(/<ETag>(.*?)<\/ETag>/);

      const result = {
        location: locationMatch?.[1] ?? "",
        bucket: params.bucketName,
        key: keyMatch?.[1] ?? params.key,
        etag: etagMatch?.[1] ?? "",
      };
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_upload_part",
    "Upload a part in a multipart upload. Use InitiateMultipartUpload first to get an uploadId, then upload parts, then CompleteMultipartUpload.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      objectName: z.string({
        required_error: requiredError("objectName"),
      }).describe("Object key (path) for the multipart upload"),
      uploadId: z.string({
        required_error: requiredError("uploadId"),
      }).describe("Upload ID returned from initiate multipart upload"),
      partNumber: z.number({
        required_error: requiredError("partNumber"),
      }).min(1).max(10000).describe("Part number (1 to 10000)"),
      body: z.string({
        required_error: requiredError("body"),
      }).describe("Content of this part to upload"),
    },
    async (params) => {
      const response = await client.request({
        method: "PUT",
        bucket: params.bucketName,
        key: params.objectName,
        queryParams: {
          partNumber: String(params.partNumber),
          uploadId: params.uploadId,
        },
        body: params.body,
      });

      const etag = response.headers.get("etag") ?? "";
      const result = {
        bucket: params.bucketName,
        key: params.objectName,
        uploadId: params.uploadId,
        partNumber: params.partNumber,
        etag,
        size: `${params.body.length} bytes`,
      };
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_list_parts",
    "List uploaded parts for a multipart upload in progress",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      objectName: z.string({
        required_error: requiredError("objectName"),
      }).describe("Object key (path) for the multipart upload"),
      uploadId: z.string({
        required_error: requiredError("uploadId"),
      }).describe("Upload ID returned from initiate multipart upload"),
    },
    async (params) => {
      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        key: params.objectName,
        queryParams: { uploadId: params.uploadId },
      });
      const result = parseListPartsXml(response.body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_abort_multipart_upload",
    "⚠️ Destructive: Abort a multipart upload and delete all uploaded parts. Set confirm=true to execute.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      objectName: z.string({
        required_error: requiredError("objectName"),
      }).describe("Object key (path) for the multipart upload"),
      uploadId: z.string({
        required_error: requiredError("uploadId"),
      }).describe("Upload ID of the multipart upload to abort"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      await client.request({
        method: "DELETE",
        bucket: params.bucketName,
        key: params.objectName,
        queryParams: { uploadId: params.uploadId },
      });
      const result = {
        message: L({ ko: `✅ 멀티파트 업로드 '${params.uploadId}'이(가) 중단되었습니다. 업로드된 파트가 삭제되었습니다.`, en: `✅ Multipart upload '${params.uploadId}' has been aborted. Uploaded parts have been deleted.` }),
        bucket: params.bucketName,
        key: params.objectName,
        uploadId: params.uploadId,
      };
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently abort multipart upload [${params.uploadId}] for object [${params.bucketName}/${params.objectName}] and delete all uploaded parts. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_list_multipart_uploads",
    "List in-progress multipart uploads for a bucket",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      prefix: z.string().optional().describe("Limits results to uploads for keys beginning with this prefix"),
      delimiter: z.string().optional().describe("Delimiter for grouping keys (commonly '/')"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { uploads: "" };
      if (params.prefix) queryParams["prefix"] = params.prefix;
      if (params.delimiter) queryParams["delimiter"] = params.delimiter;

      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        queryParams,
      });
      const result = parseListMultipartUploadsXml(response.body);
      return result;
    }
  );

  // ─── ACL Management Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_bucket_acl",
    "Get the access control list (ACL) of an Object Storage bucket",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
    },
    async (params) => {
      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        queryParams: { acl: "" },
      });
      const result = parseAclXml(response.body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_put_bucket_acl",
    "Set the access control list (ACL) of an Object Storage bucket using a canned ACL",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      acl: z.enum(["private", "public-read", "public-read-write", "authenticated-read"], {
        required_error: requiredError("acl"),
      }).describe("Canned ACL to apply (private, public-read, public-read-write, authenticated-read)"),
    },
    async (params) => {
      await client.request({
        method: "PUT",
        bucket: params.bucketName,
        queryParams: { acl: "" },
        headers: { "x-amz-acl": params.acl },
      });
      const result = {
        message: L({ ko: `✅ 버킷 '${params.bucketName}'의 ACL이 '${params.acl}'로 설정되었습니다.`, en: `✅ The ACL of bucket '${params.bucketName}' has been set to '${params.acl}'.` }),
        bucket: params.bucketName,
        acl: params.acl,
      };
      return result;
    }
  );

  // ─── Object ACL Management Tools ────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_object_acl",
    "Get the access control list (ACL) of an object in Object Storage",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket containing the object"),
      objectName: z.string({
        required_error: requiredError("objectName"),
      }).describe("Object key (path) to get ACL for"),
    },
    async (params) => {
      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        key: params.objectName,
        queryParams: { acl: "" },
      });
      const result = parseAclXml(response.body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_put_object_acl",
    "Set the access control list (ACL) of an object in Object Storage using a canned ACL",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket containing the object"),
      objectName: z.string({
        required_error: requiredError("objectName"),
      }).describe("Object key (path) to set ACL for"),
      acl: z.enum(["private", "public-read", "public-read-write", "authenticated-read"], {
        required_error: requiredError("acl"),
      }).describe("Canned ACL to apply (private, public-read, public-read-write, authenticated-read)"),
    },
    async (params) => {
      await client.request({
        method: "PUT",
        bucket: params.bucketName,
        key: params.objectName,
        queryParams: { acl: "" },
        headers: { "x-amz-acl": params.acl },
      });
      const result = {
        message: L({ ko: `✅ 오브젝트 '${params.bucketName}/${params.objectName}'의 ACL이 '${params.acl}'로 설정되었습니다.`, en: `✅ The ACL of object '${params.bucketName}/${params.objectName}' has been set to '${params.acl}'.` }),
        bucket: params.bucketName,
        object: params.objectName,
        acl: params.acl,
      };
      return result;
    }
  );

  // ─── Versioning Management Tools ───────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_bucket_versioning",
    "Get the versioning state of an Object Storage bucket",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to check versioning status"),
    },
    async (params) => {
      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        queryParams: { versioning: "" },
      });
      const result = parseVersioningXml(response.body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_put_bucket_versioning",
    "Set the versioning state of an Object Storage bucket (Enabled or Suspended)",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      status: z.enum(["Enabled", "Suspended"], {
        required_error: requiredError("status"),
      }).describe("Versioning status to set (Enabled | Suspended)"),
    },
    async (params) => {
      const body = `<VersioningConfiguration><Status>${params.status}</Status></VersioningConfiguration>`;
      await client.request({
        method: "PUT",
        bucket: params.bucketName,
        queryParams: { versioning: "" },
        headers: { "content-type": "application/xml" },
        body,
      });
      const result = {
        message: L({ ko: `✅ 버킷 '${params.bucketName}'의 버전 관리가 '${params.status}'로 설정되었습니다.`, en: `✅ Versioning for bucket '${params.bucketName}' has been set to '${params.status}'.` }),
        bucket: params.bucketName,
        versioningStatus: params.status,
      };
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_list_object_versions",
    "List all versions of objects in a versioning-enabled Object Storage bucket",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      prefix: z.string().optional().describe("Limits results to keys beginning with this prefix"),
      delimiter: z.string().optional().describe("Delimiter for grouping keys (commonly '/')"),
      keyMarker: z.string().optional().describe("Key marker for pagination"),
      versionIdMarker: z.string().optional().describe("Version ID marker for pagination (used with keyMarker)"),
      maxKeys: z.number().optional().describe("Maximum number of keys to return (default 1000)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { versions: "" };
      if (params.prefix) queryParams["prefix"] = params.prefix;
      if (params.delimiter) queryParams["delimiter"] = params.delimiter;
      if (params.keyMarker) queryParams["key-marker"] = params.keyMarker;
      if (params.versionIdMarker) queryParams["version-id-marker"] = params.versionIdMarker;
      if (params.maxKeys) queryParams["max-keys"] = String(params.maxKeys);

      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        queryParams,
      });
      const result = parseListObjectVersionsXml(response.body);
      return result;
    }
  );

  // ─── Object Restore Tools ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_restore_object",
    "Restore an object stored in Archive class to make it accessible. The restored copy is available for the specified number of days.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket containing the archived object"),
      objectName: z.string({
        required_error: requiredError("objectName"),
      }).describe("Key (path) of the archived object to restore"),
      days: z.number({
        required_error: requiredError("days"),
      }).min(1, { message: L({ ko: "잘못된 파라미터: 'days'는 1 이상이어야 합니다.", en: "Invalid parameter: 'days' must be 1 or greater." }) })
        .describe("Number of days to keep the restored copy accessible"),
    },
    async (params) => {
      const body = `<RestoreRequest><Days>${params.days}</Days></RestoreRequest>`;
      await client.request({
        method: "POST",
        bucket: params.bucketName,
        key: params.objectName,
        queryParams: { restore: "" },
        headers: { "content-type": "application/xml" },
        body,
      });
      const result = {
        message: L({ ko: `✅ 오브젝트 '${params.bucketName}/${params.objectName}' 복원이 요청되었습니다. 복원 완료까지 수 시간이 소요될 수 있습니다.`, en: `✅ Restore of object '${params.bucketName}/${params.objectName}' has been requested. It may take several hours to complete.` }),
        bucket: params.bucketName,
        object: params.objectName,
        restoreDays: params.days,
      };
      return result;
    }
  );

  // ─── Bucket Location Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_bucket_location",
    "Get the region (location constraint) of an Object Storage bucket",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to get location for"),
    },
    async (params) => {
      const response = await client.request({
        method: "GET",
        bucket: params.bucketName,
        queryParams: { location: "" },
      });
      const locationMatch = response.body.match(/<LocationConstraint>(.*?)<\/LocationConstraint>/);
      const result = {
        bucket: params.bucketName,
        location: locationMatch?.[1] ?? "",
      };
      return result;
    }
  );

  // ─── Object Operations Tools ───────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_copy_object",
    "Copy an object within the same bucket or between different buckets in Object Storage",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Destination bucket name"),
      objectName: z.string({
        required_error: requiredError("objectName"),
      }).describe("Destination object key (path)"),
      copySource: z.string({
        required_error: requiredError("copySource"),
      }).describe("Source object in the format /{sourceBucket}/{sourceKey}"),
    },
    async (params) => {
      const response = await client.request({
        method: "PUT",
        bucket: params.bucketName,
        key: params.objectName,
        headers: { "x-amz-copy-source": params.copySource },
      });

      // Parse CopyObjectResult XML
      const lastModifiedMatch = response.body.match(/<LastModified>(.*?)<\/LastModified>/);
      const etagMatch = response.body.match(/<ETag>(.*?)<\/ETag>/);

      const result = {
        bucket: params.bucketName,
        key: params.objectName,
        copySource: params.copySource,
        lastModified: lastModifiedMatch?.[1] ?? "",
        etag: etagMatch?.[1] ?? "",
      };
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_head_object",
    "Retrieve metadata of an object without returning the object body (HEAD request)",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      objectName: z.string({
        required_error: requiredError("objectName"),
      }).describe("Object key (path) to get metadata for"),
    },
    async (params) => {
      const response = await client.request({
        method: "HEAD",
        bucket: params.bucketName,
        key: params.objectName,
      });

      const result: Record<string, string | null> = {
        bucket: params.bucketName,
        key: params.objectName,
        contentLength: response.headers.get("content-length"),
        contentType: response.headers.get("content-type"),
        lastModified: response.headers.get("last-modified"),
        etag: response.headers.get("etag"),
        acceptRanges: response.headers.get("accept-ranges"),
        storageClass: response.headers.get("x-amz-storage-class"),
      };
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_delete_multiple_objects",
    "⚠️ Destructive: Delete multiple objects from an Object Storage bucket in a single request. Set confirm=true to execute.",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket"),
      objectKeys: z.array(z.string()).min(1, {
        message: L({ ko: "잘못된 파라미터: 'objectKeys'는 최소 1개 이상의 키를 포함해야 합니다.", en: "Invalid parameter: 'objectKeys' must contain at least one key." }),
      }).describe("Array of object keys to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {

      const objectsXml = params.objectKeys
        .map((key) => `<Object><Key>${key}</Key></Object>`)
        .join("");
      const body = `<Delete><Quiet>false</Quiet>${objectsXml}</Delete>`;

      const contentMd5 = crypto.createHash("md5").update(body).digest("base64");

      const response = await client.request({
        method: "POST",
        bucket: params.bucketName,
        queryParams: { delete: "" },
        headers: {
          "content-type": "application/xml",
          "content-md5": contentMd5,
        },
        body,
      });

      // Parse DeleteResult XML
      const deleted: string[] = [];
      const errors: Array<{ key: string; code: string; message: string }> = [];

      const deletedMatches = response.body.matchAll(/<Deleted><Key>(.*?)<\/Key><\/Deleted>/g);
      for (const match of deletedMatches) {
        deleted.push(match[1]);
      }

      const errorMatches = response.body.matchAll(
        /<Error><Key>(.*?)<\/Key><Code>(.*?)<\/Code><Message>(.*?)<\/Message><\/Error>/g
      );
      for (const match of errorMatches) {
        errors.push({ key: match[1], code: match[2], message: match[3] });
      }

      const result = {
        message: L({ ko: `✅ ${deleted.length}개 오브젝트가 삭제되었습니다.${errors.length > 0 ? ` ${errors.length}개 실패.` : ""}`, en: `✅ ${deleted.length} object(s) have been deleted.${errors.length > 0 ? ` ${errors.length} failed.` : ""}` }),
        bucket: params.bucketName,
        deleted,
        errors: errors.length > 0 ? errors : undefined,
      };
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete ${params.objectKeys.length} object(s) from Bucket [${params.bucketName}]:\n${params.objectKeys.map((k: any) => `  - ${k}`).join("\n")}\n\nDo you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_head_bucket",
    "Check if a bucket exists and you have permission to access it (HEAD request, returns headers only)",
    {
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Name of the bucket to check"),
    },
    async (params) => {
      const response = await client.request({
        method: "HEAD",
        bucket: params.bucketName,
      });

      const result = {
        bucket: params.bucketName,
        exists: true,
        region: response.headers.get("x-amz-bucket-region"),
        statusCode: response.status,
      };
      return result;
    }
  );
}
