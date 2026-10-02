import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

/**
 * Datafence — 민간존 전용 (api.ncloud-docs.com `datafence-overview`, 2026-10-02 대조).
 *
 * Base URL: https://datafence.apigw.ntruss.com (registry 에서 주입), REST JSON → client.requestRaw.
 * 가이드 슬러그가 서비스 접두 없이 등록돼 있다(`get-datafence`, `create-box`, `export-file-approve-1` 등).
 * 오퍼레이션 37종: Datafence 8 · Box 16 · Import 4 · Export 5 · Export Approval 4.
 * GET 은 쿼리 파라미터, POST/PATCH/DELETE 는 가이드 표대로(`cancel-file-export` 는 DELETE + 쿼리, 승인/반려는 PATCH + 바디).
 */

const PASSWORD_DESC = "8-14 chars with at least one upper, lower, digit and special char (', \", `, ₩, /, &, $, space not allowed)";

const pageParams = {
  page: z.number().int().min(0).max(100).optional().describe("Page number (0-100, default 0)"),
  size: z.number().int().min(1).max(100).optional().describe("Items per page (1-100, default 10)"),
};
const fenceId = z.number({ required_error: requiredError("fenceId") }).int().describe("Datafence number (see ncloud_datafence_get_datafence)");
const boxId = z.number({ required_error: requiredError("boxId") }).int().describe("Box number (see ncloud_datafence_list_boxes)");

/** 선언한 값만 쿼리/바디에 담는다(undefined 제거). */
function compact<T extends Record<string, unknown>>(obj: T): Record<string, string | number | boolean | undefined> {
  const out: Record<string, string | number | boolean | undefined> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v as string | number | boolean;
  return out;
}
function body<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

// ─── change-datafence-infra / change-box-infra 하위 객체 (가이드 fenceServerList / fenceNasList / connectServerList / … 표와 1:1) ──
const actionType3 = z.enum(["CREATE", "UPDATE", "DELETE"]).describe("CREATE | UPDATE | DELETE");
const fenceServerSchema = z.object({
  actionType: actionType3,
  serverInstanceNo: z.string().optional().describe("Datafence server instance number (required for UPDATE / DELETE)"),
  specCode: z.string().optional().describe("Server spec code (required for CREATE / UPDATE; see ncloud_datafence_get_product_specs)"),
  softwareCode: z.string().optional().describe("Server software code (required for CREATE / UPDATE)"),
  userPassword: z.string().optional().describe(`Server login password — ${PASSWORD_DESC}`),
  serverImageNo: z.string().optional().describe("Custom server image number (required for CREATE; see ncloud_datafence_get_fence_custom_images)"),
});
const fenceNasSchema = z.object({
  actionType: z.enum(["CREATE", "DELETE"]).describe("CREATE | DELETE"),
  nasInstanceNo: z.string().optional().describe("NAS instance number (required for DELETE)"),
  nasSize: z.number().int().optional().describe("NAS volume size in GB (500-10000, 100 GB steps; required for CREATE)"),
  count: z.number().int().optional().describe("Number of NAS volumes (required for CREATE)"),
});

const connectServerCreate = z.object({
  specCode: z.string().describe("Connect server spec code (see ncloud_datafence_get_product_specs)"),
  softwareCode: z.string().optional().describe("Connect server software code"),
  storageSize: z.number().int().describe("Block storage size in GB (10-2000, 10 GB steps)"),
  userPassword1: z.string().optional().describe(`ncp1 account password — ${PASSWORD_DESC}`),
  userPassword2: z.string().optional().describe(`ncp2 account password — ${PASSWORD_DESC}`),
});
const osServerCreate = (label: string) => z.object({
  specCode: z.string().describe(`${label} server spec code`),
  softwareCode: z.string().describe(`${label} server software code`),
  storageSize: z.number().int().describe("Block storage size in GB (10-2000, 10 GB steps)"),
  userPassword: z.string().describe(`${label} server account password — ${PASSWORD_DESC}`),
});
const nasCreate = z.object({
  nasSize: z.number().int().optional().describe("NAS volume size in GB (500-10000, 100 GB steps)"),
  count: z.number().int().optional().describe("Number of NAS volumes"),
});
const hadoopCreate = z.object({
  EdgeNodeSpecCode: z.string().optional().describe("Edge node spec code (field name is capitalised in the guide)"),
  masterNodeSpecCode: z.string().optional().describe("Master node spec code"),
  masterNodeStorageSize: z.number().int().optional().describe("Master node block storage in GB (100-2000, 10 GB steps)"),
  workerNodeSpecCode: z.string().optional().describe("Worker node spec code"),
  workerNodeCount: z.number().int().optional().describe("Number of worker nodes"),
  workerNodeStorageSize: z.number().int().optional().describe("Worker node block storage in GB (100-2000, 10 GB steps)"),
  userPassword: z.string().optional().describe(`Hadoop cluster account password — ${PASSWORD_DESC}`),
});
const tfServerCreate = (label: string) => z.object({
  specCode: z.string().optional().describe(`${label} server spec code`),
  softwareCode: z.string().optional().describe(`${label} server software code`),
  storageSize: z.number().int().optional().describe("Block storage size in GB (100-2000, 10 GB steps)"),
  userPassword: z.string().optional().describe(`${label} server account password — ${PASSWORD_DESC}`),
});

const serverUpdate = (label: string, extra: Record<string, z.ZodTypeAny> = {}) => z.object({
  actionType: actionType3,
  serverInstanceNo: z.string().optional().describe(`${label} server instance number (required for UPDATE / DELETE)`),
  blockStorageInstanceNo: z.string().optional().describe(`${label} server block storage instance number (required for UPDATE / DELETE)`),
  specCode: z.string().optional().describe(`${label} server spec code (required for CREATE / UPDATE)`),
  softwareCode: z.string().optional().describe(`${label} server software code (required for CREATE / UPDATE)`),
  storageSize: z.number().int().optional().describe("Block storage size in GB (required for CREATE / UPDATE)"),
  ...extra,
});
const connectServerUpdate = z.object({
  actionType: actionType3,
  serverInstanceNo: z.string().optional().describe("Connect server instance number (required for UPDATE / DELETE)"),
  blockStorageInstanceNo: z.string().optional().describe("Connect server block storage instance number (required for UPDATE / DELETE)"),
  specCode: z.string().optional().describe("Connect server spec code (required for CREATE / UPDATE)"),
  storageSize: z.number().int().optional().describe("Block storage size in GB (10-2000, 10 GB steps; required for CREATE / UPDATE)"),
  userPassword1: z.string().optional().describe(`ncp1 account password — ${PASSWORD_DESC}`),
  userPassword2: z.string().optional().describe(`ncp2 account password — ${PASSWORD_DESC}`),
});
const boxNasUpdate = z.object({
  actionType: z.enum(["CREATE", "DELETE"]).describe("CREATE | DELETE"),
  nasInstanceNo: z.string().optional().describe("NAS instance number (required for DELETE)"),
  nasSize: z.number().int().optional().describe("NAS volume size in GB (500-10000, 100 GB steps)"),
  count: z.number().int().optional().describe("Number of NAS volumes (required for CREATE)"),
});
const hadoopUpdate = z.object({
  actionType: actionType3,
  hadoopClusterNo: z.string().optional().describe("Hadoop cluster number — instanceNo of the HD infra in ncloud_datafence_list_box_infra (required for UPDATE / DELETE)"),
  edgeNodeSpecCode: z.string().optional().describe("Edge node spec code (required for CREATE / UPDATE)"),
  masterNodeSpecCode: z.string().optional().describe("Master node spec code (required for CREATE / UPDATE)"),
  masterNodeStorageSize: z.number().int().optional().describe("Master node block storage in GB (required for CREATE; 100-2000 in 10 GB steps, 4000/6000 also allowed)"),
  workerNodeSpecCode: z.string().optional().describe("Worker node spec code (required for CREATE / UPDATE)"),
  workerNodeStorageSize: z.number().int().optional().describe("Worker node block storage in GB (required for CREATE)"),
  workerNodeCount: z.number().int().optional().describe("Number of worker nodes (required for CREATE / UPDATE)"),
  userPassword: z.string().optional().describe(`Hadoop cluster account password — ${PASSWORD_DESC}`),
});

export function registerDatafenceTools(server: McpServer, client: NcloudClient): void {
  // ─── Datafence ─────────────────────────────────────────────────────────────

  // get-datafence: GET /api/v1/fence/get-datafence
  defineTool(server, "ncloud_datafence_get_datafence", "Get the Datafence of this account (fenceId, name, status, box count, export screening bucket).", {}, async () => {
    return client.requestRaw("GET", "/api/v1/fence/get-datafence");
  });

  // get-datafence-infra-list: GET /api/v1/fence/get-datafence-infra-list
  defineTool(server, "ncloud_datafence_list_fence_infra", "List the infrastructure (servers, NAS) of a Datafence.", { fenceId, ...pageParams }, async (params) => {
    return client.requestRaw("GET", "/api/v1/fence/get-datafence-infra-list", compact(params));
  });

  // get-datafence-infra-history: GET /api/v1/fence/get-datafence-infra-history
  defineTool(server, "ncloud_datafence_get_fence_infra_history", "Get the infrastructure change history of a Datafence.", { fenceId, ...pageParams }, async (params) => {
    return client.requestRaw("GET", "/api/v1/fence/get-datafence-infra-history", compact(params));
  });

  // get-fence-custom-image: GET /api/v1/fence/get-fence-custom-image
  defineTool(server, "ncloud_datafence_get_fence_custom_images", "List custom server images usable for Datafence servers.", {
    fenceId,
    productCode: z.enum(["FENCE_UBUNTU"]).describe("Datafence product code (FENCE_UBUNTU)"),
  }, async (params) => {
    return client.requestRaw("GET", "/api/v1/fence/get-fence-custom-image", compact(params));
  });

  // change-datafence-infra: POST /api/v1/fence/change-datafence-infra
  defineTool(server, "ncloud_datafence_change_fence_infra", "Create, update or return Datafence servers (1-4) and NAS volumes. Each list item carries an actionType. Use dryRun=true to preview.", {
    fenceId,
    description: z.string().optional().describe("Description of the Datafence"),
    fenceServerList: z.array(fenceServerSchema).optional().describe("Datafence server changes (1-4 servers)"),
    fenceNasList: z.array(fenceNasSchema).optional().describe("Datafence NAS changes (at least 1)"),
    dryRun: z.boolean().optional().default(false).describe("If true, returns the request without sending it"),
  }, async (params) => {
    const b = body({ fenceId: params.fenceId, description: params.description, updateFence: body({ fenceServerList: params.fenceServerList, fenceNasList: params.fenceNasList }) });
    if (params.dryRun) return dryRunPreview({ label: "🔍 Dry-Run Preview: Datafence infra change", endpoint: "/api/v1/fence/change-datafence-infra", method: "POST", requestParams: b, noun: { ko: "Datafence 인프라", en: "Datafence infra" } });
    return client.requestRaw("POST", "/api/v1/fence/change-datafence-infra", undefined, b);
  });

  // change-fence-nas-volume: POST /api/v1/fence/change-fence-nas-volume
  defineTool(server, "ncloud_datafence_change_fence_nas_volume", "Resize a Datafence NAS volume (500-10000 GB, 100 GB steps).", {
    fenceId,
    instanceNo: z.number({ required_error: requiredError("instanceNo") }).int().describe("NAS instance number (see ncloud_datafence_list_fence_infra)"),
    volumeSize: z.number({ required_error: requiredError("volumeSize") }).int().min(500).max(10000).describe("New NAS volume size in GB"),
  }, async (params) => {
    return client.requestRaw("POST", "/api/v1/fence/change-fence-nas-volume", undefined, body(params));
  });

  // get-bucket-list-2: GET /api/v1/object-storage/get-bucket-list
  defineTool(server, "ncloud_datafence_list_buckets", "List Object Storage buckets available to Datafence (a sub account may need Object Storage permission).", {}, async () => {
    return client.requestRaw("GET", "/api/v1/object-storage/get-bucket-list");
  });

  // get-product-spec: GET /api/v1/product/get-product-spec
  defineTool(server, "ncloud_datafence_get_product_specs", "List server / NAS / Hadoop product spec codes usable in Datafence and Box requests.", {}, async () => {
    return client.requestRaw("GET", "/api/v1/product/get-product-spec");
  });

  // ─── Box ───────────────────────────────────────────────────────────────────

  // get-box-list: GET /api/v1/box/get-box-list
  defineTool(server, "ncloud_datafence_list_boxes", "List the Boxes of a Datafence.", { fenceId, ...pageParams }, async (params) => {
    return client.requestRaw("GET", "/api/v1/box/get-box-list", compact(params));
  });

  // get-box-summary-info: GET /api/v1/box/get-box-summary-info
  defineTool(server, "ncloud_datafence_get_box_summary", "Get the summary of a Box.", { fenceId, boxId }, async (params) => {
    return client.requestRaw("GET", "/api/v1/box/get-box-summary-info", compact(params));
  });

  // get-box-infra-list: GET /api/v1/box/get-box-infra-list
  defineTool(server, "ncloud_datafence_list_box_infra", "List the infrastructure of a Box (connect / linux / windows / tensorflow servers, NAS, Hadoop clusters with instanceNo and infraType).", { fenceId, boxId, ...pageParams }, async (params) => {
    return client.requestRaw("GET", "/api/v1/box/get-box-infra-list", compact(params));
  });

  // get-box-infra-history: GET /api/v1/box/get-box-infra-history
  defineTool(server, "ncloud_datafence_get_box_infra_history", "Get the infrastructure change history of a Box.", { fenceId, boxId, ...pageParams }, async (params) => {
    return client.requestRaw("GET", "/api/v1/box/get-box-infra-history", compact(params));
  });

  // get-box-history: GET /api/v1/box/get-box-history
  defineTool(server, "ncloud_datafence_get_box_history", "Get the Box creation / return history of a Datafence.", { fenceId, ...pageParams }, async (params) => {
    return client.requestRaw("GET", "/api/v1/box/get-box-history", compact(params));
  });

  // get-box-custom-image: GET /api/v1/box/get-box-custom-image
  defineTool(server, "ncloud_datafence_get_box_custom_images", "List custom server images usable for a Box server type.", {
    fenceId,
    productCode: z.enum(["CON", "TF_CPU", "TF_GPU", "SVR_LNX_UBUNTU", "SVR_WIN"]).describe("Box server type: CON (connect), TF_CPU, TF_GPU, SVR_LNX_UBUNTU, SVR_WIN"),
  }, async (params) => {
    return client.requestRaw("GET", "/api/v1/box/get-box-custom-image", compact(params));
  });

  const instanceNo = (label: string) => z.number({ required_error: requiredError("instanceNo") }).int().describe(`${label} instance number (see ncloud_datafence_list_box_infra)`);

  // get-connect-info: GET /api/v1/box/get-connect-info
  defineTool(server, "ncloud_datafence_get_connect_server", "Get a Box connect server's details.", { fenceId, boxId, instanceNo: instanceNo("Connect server") }, async (params) => {
    return client.requestRaw("GET", "/api/v1/box/get-connect-info", compact(params));
  });

  // get-linux-info-1: GET /api/v1/box/get-linux-info
  defineTool(server, "ncloud_datafence_get_linux_server", "Get a Box Linux server's details.", { fenceId, boxId, instanceNo: instanceNo("Linux server") }, async (params) => {
    return client.requestRaw("GET", "/api/v1/box/get-linux-info", compact(params));
  });

  // get-windows-info: GET /api/v1/box/get-windows-info
  defineTool(server, "ncloud_datafence_get_windows_server", "Get a Box Windows server's details.", { fenceId, boxId, instanceNo: instanceNo("Windows server") }, async (params) => {
    return client.requestRaw("GET", "/api/v1/box/get-windows-info", compact(params));
  });

  // get-tensorflow-info: GET /api/v1/box/get-tensorflow-info
  defineTool(server, "ncloud_datafence_get_tensorflow_server", "Get a Box Tensorflow (CPU or GPU) server's details.", { fenceId, boxId, instanceNo: instanceNo("Tensorflow server") }, async (params) => {
    return client.requestRaw("GET", "/api/v1/box/get-tensorflow-info", compact(params));
  });

  // get-hadoop-cluster-info-1: GET /api/v1/box/get-hadoop-cluster-info
  defineTool(server, "ncloud_datafence_get_hadoop_cluster", "Get a Box Hadoop cluster's details.", {
    fenceId, boxId,
    hadoopClusterNo: z.number({ required_error: requiredError("hadoopClusterNo") }).int().describe("Hadoop cluster number — instanceNo of the infra whose infraType is HD"),
  }, async (params) => {
    return client.requestRaw("GET", "/api/v1/box/get-hadoop-cluster-info", compact(params));
  });

  // create-box: POST /api/v1/box/create-box
  defineTool(server, "ncloud_datafence_create_box", "Create a Box in a Datafence: 1-4 connect servers, Linux and/or Windows servers (Windows required when no Linux), NAS, optional Hadoop clusters and Tensorflow CPU (1-4) / GPU (1-2) servers. Use dryRun=true to preview.", {
    fenceId,
    description: z.string().optional().describe("Description of the Box"),
    connectServerList: z.array(connectServerCreate).min(1).max(4).describe("Connect servers (1-4)"),
    linuxServerList: z.array(osServerCreate("Linux")).describe("Linux servers (empty array allowed when windowsServerList is given)"),
    windowsServerList: z.array(osServerCreate("Windows")).max(4).optional().describe("Windows servers (1-4; required when linuxServerList is empty)"),
    nasList: z.array(nasCreate).describe("NAS volumes"),
    hadoopList: z.array(hadoopCreate).optional().describe("Hadoop clusters"),
    tensorFlowCpuServerList: z.array(tfServerCreate("Tensorflow CPU")).max(4).optional().describe("Tensorflow CPU servers (1-4)"),
    tensorFlowGpuServerList: z.array(tfServerCreate("Tensorflow GPU")).max(2).optional().describe("Tensorflow GPU servers (1-2)"),
    dryRun: z.boolean().optional().default(false).describe("If true, returns the request without sending it"),
  }, async (params) => {
    if (params.linuxServerList.length === 0 && (!params.windowsServerList || params.windowsServerList.length === 0)) {
      return { content: [{ type: "text" as const, text: "Provide at least one Linux server or one Windows server." }], isError: true };
    }
    const b = body({
      fenceId: params.fenceId,
      description: params.description,
      createBoxInfo: body({
        connectServerList: params.connectServerList,
        linuxServerList: params.linuxServerList,
        windowsServerList: params.windowsServerList,
        nasList: params.nasList,
        hadoopList: params.hadoopList,
        tensorFlowCpuServerList: params.tensorFlowCpuServerList,
        tensorFlowGpuServerList: params.tensorFlowGpuServerList,
      }),
    });
    if (params.dryRun) return dryRunPreview({ label: "🔍 Dry-Run Preview: Datafence Box creation", endpoint: "/api/v1/box/create-box", method: "POST", requestParams: b, noun: { ko: "Box", en: "Box" } });
    return client.requestRaw("POST", "/api/v1/box/create-box", undefined, b);
  });

  // change-box-infra: POST /api/v1/box/change-box-infra
  defineTool(server, "ncloud_datafence_change_box_infra", "Create, update or return Box infrastructure (connect / Linux / Windows / Tensorflow servers, NAS, Hadoop clusters). Each list item carries an actionType. Use dryRun=true to preview.", {
    fenceId, boxId,
    description: z.string().optional().describe("Description of the Box"),
    connectServerList: z.array(connectServerUpdate).max(4).optional().describe("Connect server changes (1-4)"),
    linuxServerList: z.array(serverUpdate("Linux", { userPassword: z.string().optional().describe(`Linux server account password — ${PASSWORD_DESC}`) })).max(4).optional().describe("Linux server changes (1-4)"),
    windowsServerList: z.array(serverUpdate("Windows", { userPassword: z.string().optional().describe(`Windows server account password — ${PASSWORD_DESC}`) })).max(4).optional().describe("Windows server changes (0-4)"),
    boxNasList: z.array(boxNasUpdate).optional().describe("NAS changes (at least 1 NAS must remain)"),
    hadoopList: z.array(hadoopUpdate).max(2).optional().describe("Hadoop cluster changes (up to 2 clusters)"),
    tensorFlowCpuServerList: z.array(serverUpdate("Tensorflow CPU", { userPassword: z.string().optional().describe(`Tensorflow CPU server account password — ${PASSWORD_DESC}`) })).max(4).optional().describe("Tensorflow CPU server changes (up to 4)"),
    tensorFlowGpuServerList: z.array(serverUpdate("Tensorflow GPU", { userPassword: z.string().optional().describe(`Tensorflow GPU server account password — ${PASSWORD_DESC}`) })).max(2).optional().describe("Tensorflow GPU server changes (up to 2)"),
    dryRun: z.boolean().optional().default(false).describe("If true, returns the request without sending it"),
  }, async (params) => {
    const { fenceId: f, boxId: bId, dryRun, ...rest } = params;
    const b = { fenceId: f, updateBoxInfo: body({ boxId: bId, ...rest }) };
    if (dryRun) return dryRunPreview({ label: "🔍 Dry-Run Preview: Datafence Box infra change", endpoint: "/api/v1/box/change-box-infra", method: "POST", requestParams: b, noun: { ko: "Box 인프라", en: "Box infra" } });
    return client.requestRaw("POST", "/api/v1/box/change-box-infra", undefined, b);
  });

  // change-box-nas-volume: POST /api/v1/box/change-box-nas-volume
  defineTool(server, "ncloud_datafence_change_box_nas_volume", "Resize a Box NAS volume (500-10000 GB, 100 GB steps).", {
    fenceId, boxId,
    instanceNo: instanceNo("NAS"),
    volumeSize: z.number({ required_error: requiredError("volumeSize") }).int().min(500).max(10000).describe("New NAS volume size in GB"),
  }, async (params) => {
    return client.requestRaw("POST", "/api/v1/box/change-box-nas-volume", undefined, body(params));
  });

  // change-box-block-external-network: POST /api/v1/box/change-box-block-external-network
  defineTool(server, "ncloud_datafence_set_box_external_network_block", "Block (true) or allow (false) a Box's external network access.", {
    fenceId, boxId,
    isBlock: z.boolean({ required_error: requiredError("isBlock") }).describe("true: block external network, false: allow"),
  }, async (params) => {
    return client.requestRaw("POST", "/api/v1/box/change-box-block-external-network", undefined, body(params));
  });

  // return-box: POST /api/v1/box/return-box
  defineTool(server, "ncloud_datafence_return_box", "⚠️ Destructive: Return (terminate) a Box and all its servers, NAS and clusters. Set confirm=true to execute.", {
    fenceId, boxId,
    confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
  }, async (params) => {
    return client.requestRaw("POST", "/api/v1/box/return-box", undefined, { fenceId: params.fenceId, boxId: params.boxId });
  }, { destructive: { noun: "Datafence Box", action: "return", describe: (p) => `fenceId=${p.fenceId}, boxId=${p.boxId}` } });

  // ─── Import ────────────────────────────────────────────────────────────────

  // get-target-nas-list-1: GET /api/v1/import/get-target-nas-list
  defineTool(server, "ncloud_datafence_list_import_target_nas", "List the Box NAS volumes that can receive imported files.", { fenceId, boxId }, async (params) => {
    return client.requestRaw("GET", "/api/v1/import/get-target-nas-list", compact(params));
  });

  // create-file-import: POST /api/v1/import/create-file-import
  defineTool(server, "ncloud_datafence_create_file_import", "Request a file import from an Object Storage bucket into a Box NAS (up to 10 files, 2 GB each). Use dryRun=true to preview.", {
    fenceId, boxId,
    sourceBucketName: z.string({ required_error: requiredError("sourceBucketName") }).describe("Source bucket name"),
    sourceFilePathList: z.array(z.string()).min(1).max(10).describe("Files to import (bucket object names, up to 10)"),
    targetNasInstanceNo: z.string({ required_error: requiredError("targetNasInstanceNo") }).describe("Target NAS instance number (see ncloud_datafence_list_import_target_nas)"),
    description: z.string({ required_error: requiredError("description") }).min(1).max(50).describe("Description of the import request (1-50 chars)"),
    dryRun: z.boolean().optional().default(false).describe("If true, returns the request without sending it"),
  }, async (params) => {
    const { dryRun, ...b } = params;
    if (dryRun) return dryRunPreview({ label: "🔍 Dry-Run Preview: Datafence file import", endpoint: "/api/v1/import/create-file-import", method: "POST", requestParams: b, noun: { ko: "반입 신청", en: "file import request" } });
    return client.requestRaw("POST", "/api/v1/import/create-file-import", undefined, b);
  });

  // get-import-list: GET /api/v1/import/get-import-list
  defineTool(server, "ncloud_datafence_list_file_imports", "List file import requests of a Box.", {
    fenceId, boxId,
    status: z.string().optional().describe("Import status code filter (File Import Status Code in the guide)"),
    from: z.string().optional().describe("Start datetime (yyyyMMddHHmmss)"),
    to: z.string().optional().describe("End datetime (yyyyMMddHHmmss)"),
    ...pageParams,
  }, async (params) => {
    return client.requestRaw("GET", "/api/v1/import/get-import-list", compact(params));
  });

  // get-import-detail: GET /api/v1/import/get-import-detail
  defineTool(server, "ncloud_datafence_get_file_import", "Get a file import request.", {
    fenceId, boxId,
    fileId: z.number({ required_error: requiredError("fileId") }).int().describe("Import request number (see ncloud_datafence_list_file_imports)"),
  }, async (params) => {
    return client.requestRaw("GET", "/api/v1/import/get-import-detail", compact(params));
  });

  // ─── Export ────────────────────────────────────────────────────────────────

  // get-source-nas-list-1: GET /api/v1/export/get-source-nas-list
  defineTool(server, "ncloud_datafence_list_export_source_nas", "List the Box NAS volumes files can be exported from.", { fenceId, boxId }, async (params) => {
    return client.requestRaw("GET", "/api/v1/export/get-source-nas-list", compact(params));
  });

  // create-file-export: POST /api/v1/export/create-file-export
  defineTool(server, "ncloud_datafence_create_file_export", "Request a file export from a Box NAS to an Object Storage bucket (up to 10 files, 2 GB each; goes through export approval). Use dryRun=true to preview.", {
    fenceId, boxId,
    sourceNasInstanceNo: z.number({ required_error: requiredError("sourceNasInstanceNo") }).int().describe("Source NAS instance number (see ncloud_datafence_list_export_source_nas)"),
    sourceFilePathList: z.array(z.string()).min(1).max(10).describe("Files to export (up to 10)"),
    targetBucketName: z.string({ required_error: requiredError("targetBucketName") }).describe("Target bucket name"),
    fileDescription: z.string({ required_error: requiredError("fileDescription") }).min(1).max(1000).describe("Description of the exported files (1-1000 chars)"),
    exportPurpose: z.string({ required_error: requiredError("exportPurpose") }).min(1).max(1000).describe("Purpose of the export (1-1000 chars)"),
    description: z.string({ required_error: requiredError("description") }).max(50).describe("Description of the export request (0-50 chars)"),
    dryRun: z.boolean().optional().default(false).describe("If true, returns the request without sending it"),
  }, async (params) => {
    const { dryRun, ...b } = params;
    if (dryRun) return dryRunPreview({ label: "🔍 Dry-Run Preview: Datafence file export", endpoint: "/api/v1/export/create-file-export", method: "POST", requestParams: b, noun: { ko: "반출 신청", en: "file export request" } });
    return client.requestRaw("POST", "/api/v1/export/create-file-export", undefined, b);
  });

  const exportListParams = {
    fenceId, boxId,
    status: z.string().optional().describe("Export status code filter (File Export Status Code in the guide)"),
    from: z.string().optional().describe("Start datetime (yyyyMMddHHmmss)"),
    to: z.string().optional().describe("End datetime (yyyyMMddHHmmss)"),
    ...pageParams,
  };
  const exportFileId = z.number({ required_error: requiredError("fileId") }).int().describe("Export request number (see ncloud_datafence_list_file_exports)");

  // get-export-list: GET /api/v1/export/get-export-list
  defineTool(server, "ncloud_datafence_list_file_exports", "List file export requests of a Box.", exportListParams, async (params) => {
    return client.requestRaw("GET", "/api/v1/export/get-export-list", compact(params));
  });

  // get-export-detail: GET /api/v1/export/get-export-detail (the page labels the params "요청 바디" but the method is GET and the example sends them as query)
  defineTool(server, "ncloud_datafence_get_file_export", "Get a file export request.", { fenceId, boxId, fileId: exportFileId }, async (params) => {
    return client.requestRaw("GET", "/api/v1/export/get-export-detail", compact(params));
  });

  // cancel-file-export: DELETE /api/v1/export/cancel-file-export (query params)
  defineTool(server, "ncloud_datafence_cancel_file_export", "⚠️ Destructive: Cancel a pending file export request. Set confirm=true to execute.", {
    fenceId, boxId, fileId: exportFileId,
    confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
  }, async (params) => {
    return client.requestRaw("DELETE", "/api/v1/export/cancel-file-export", compact({ fenceId: params.fenceId, boxId: params.boxId, fileId: params.fileId }));
  }, { destructive: { noun: "Datafence file export request", action: "cancel", describe: (p) => `fileId=${p.fileId} (fenceId=${p.fenceId}, boxId=${p.boxId})` } });

  // ─── Export Approval ───────────────────────────────────────────────────────

  // get-export-file-approve-list-1: GET /api/v1/export-approval/get-export-file-approve-list
  defineTool(server, "ncloud_datafence_list_export_approvals", "List file export requests awaiting or past approval (approver view).", exportListParams, async (params) => {
    return client.requestRaw("GET", "/api/v1/export-approval/get-export-file-approve-list", compact(params));
  });

  // get-export-file-approve-detail-1: GET /api/v1/export-approval/get-export-file-approve-detail
  defineTool(server, "ncloud_datafence_get_export_approval", "Get a file export request for approval review.", { fenceId, boxId, fileId: exportFileId }, async (params) => {
    return client.requestRaw("GET", "/api/v1/export-approval/get-export-file-approve-detail", compact(params));
  });

  // export-file-approve-1: PATCH /api/v1/export-approval/export-file-approve (method from the curl example; the page has no method table)
  defineTool(server, "ncloud_datafence_approve_file_export", "Approve a file export request. The files are then copied to the target bucket.", { fenceId, boxId, fileId: exportFileId }, async (params) => {
    return client.requestRaw("PATCH", "/api/v1/export-approval/export-file-approve", undefined, body(params));
  });

  // export-file-reject-1: PATCH /api/v1/export-approval/export-file-reject
  defineTool(server, "ncloud_datafence_reject_file_export", "⚠️ Destructive: Reject a file export request with a reason. Set confirm=true to execute.", {
    fenceId, boxId, fileId: exportFileId,
    rejectReason: z.string({ required_error: requiredError("rejectReason") }).min(1).max(1000).describe("Reason for the rejection (1-1000 chars)"),
    confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
  }, async (params) => {
    return client.requestRaw("PATCH", "/api/v1/export-approval/export-file-reject", undefined, body({ fenceId: params.fenceId, boxId: params.boxId, fileId: params.fileId, rejectReason: params.rejectReason }));
  }, { annotations: { readOnlyHint: false, destructiveHint: true }, destructive: { noun: "Datafence file export request", action: "reject", describe: (p) => `fileId=${p.fileId} (fenceId=${p.fenceId}, boxId=${p.boxId})` } }); // 이름의 "export" 토큰이 읽기 전용으로 추정되는 것을 막는다
}
