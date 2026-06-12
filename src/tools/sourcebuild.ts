import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

export function registerSourceBuildTools(server: McpServer, client: NcloudClient): void {
  // ─── Project Management ────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_sourcebuild_list_projects",
    "List SourceBuild projects with optional name filter and pagination",
    {
      projectName: z.string().optional().describe("Filter by project name (partial match)"),
      pageNo: z.number().optional().describe("Page number (1-based, default: 1)"),
      pageSize: z.number().optional().describe("Items per page (omit for all)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.projectName) queryParams.projectName = params.projectName;
      if (params.pageNo !== undefined) queryParams.pageNo = String(params.pageNo);
      if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);

      const result = await client.requestRaw("GET", "/api/v1/project", queryParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_sourcebuild_get_project",
    "Get detailed information about a specific SourceBuild project",
    {
      projectId: z.string().describe("Project ID to query"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/project/${encodeURIComponent(params.projectId)}`);
    }
  );

  defineTool(
    server,
    "ncloud_sourcebuild_create_project",
    "Create a new SourceBuild project with full configuration",
    {
      name: z.string().describe("Project name (alphanumeric, '_', '-', 1-80 chars)"),
      description: z.string().optional().describe("Project description"),
      sourceType: z.string().default("SourceCommit").describe("Source repository type (SourceCommit)"),
      repository: z.string().describe("Source repository name"),
      branch: z.string().describe("Branch to build from"),
      computeId: z.number().describe("Compute type ID (from list_compute)"),
      platformType: z.string().default("SourceBuild").describe("Platform type: SourceBuild | ContainerRegistry | PublicRegistry"),
      osId: z.number().optional().describe("OS ID (required if platformType=SourceBuild, from list_os)"),
      runtimeId: z.number().optional().describe("Runtime type ID (required if platformType=SourceBuild, from list_runtimes)"),
      runtimeVersionId: z.number().optional().describe("Runtime version ID (required if platformType=SourceBuild, from list_runtime_versions)"),
      registryName: z.string().optional().describe("Container Registry name (required if platformType=ContainerRegistry)"),
      image: z.string().optional().describe("Image name (required if platformType=ContainerRegistry|PublicRegistry)"),
      tag: z.string().optional().describe("Image tag (required if platformType=ContainerRegistry|PublicRegistry)"),
      dockerUse: z.boolean().optional().default(false).describe("Include Docker engine for build"),
      dockerId: z.number().optional().describe("Docker engine version ID (required if dockerUse=true, from list_docker_engines)"),
      timeout: z.number().optional().default(60).describe("Build timeout in minutes (5-540, default: 5)"),
      envVars: z.array(z.object({ key: z.string(), value: z.string() })).optional().describe("Build environment variables"),
      preBuildCommands: z.array(z.string()).optional().describe("Pre-build commands"),
      buildCommands: z.array(z.string()).optional().describe("Build commands"),
      postBuildCommands: z.array(z.string()).optional().describe("Post-build commands"),
      dockerbuildUse: z.boolean().optional().default(false).describe("Enable Docker image build"),
      dockerbuildDockerfile: z.string().optional().describe("Dockerfile path"),
      dockerbuildRegistry: z.string().optional().describe("Docker build target Container Registry name"),
      dockerbuildImage: z.string().optional().describe("Docker build image name"),
      dockerbuildTag: z.string().optional().describe("Docker build image tag"),
      dockerbuildLatest: z.boolean().optional().default(false).describe("Set latest tag for Docker build"),
      artifactUse: z.boolean().optional().default(false).describe("Save build artifacts"),
      artifactPath: z.array(z.string()).optional().describe("Build artifact paths"),
      artifactBucket: z.string().optional().describe("Object Storage bucket for artifacts"),
      artifactStoragePath: z.string().optional().describe("Path within bucket"),
      artifactFilename: z.string().optional().describe("Artifact filename"),
      artifactBackup: z.boolean().optional().default(false).describe("Backup artifacts"),
      cacheUse: z.boolean().optional().default(false).describe("Save build image after completion"),
      cacheRegistry: z.string().optional().describe("Container Registry for cache"),
      cacheImage: z.string().optional().describe("Cache image name"),
      cacheTag: z.string().optional().describe("Cache image tag"),
      cacheLatest: z.boolean().optional().default(false).describe("Set latest tag for cache"),
      linkedCloudLogAnalytics: z.boolean().optional().default(false).describe("Enable Cloud Log Analytics integration"),
      linkedFileSafer: z.boolean().optional().default(false).describe("Enable File Safer integration"),
    },
    async (params) => {
      // Build platform config
      const platformConfig: Record<string, any> = {};
      if (params.platformType === "SourceBuild") {
        if (params.osId !== undefined) platformConfig.os = { id: params.osId };
        if (params.runtimeId !== undefined) {
          const runtime: Record<string, any> = { id: params.runtimeId };
          if (params.runtimeVersionId !== undefined) {
            runtime.version = { id: params.runtimeVersionId };
          }
          platformConfig.runtime = runtime;
        }
      } else {
        if (params.registryName) platformConfig.registry = { name: params.registryName };
        if (params.image) platformConfig.image = params.image;
        if (params.tag) platformConfig.tag = params.tag;
      }

      // Build request body
      const body: Record<string, any> = {
        name: params.name,
        source: {
          type: params.sourceType,
          config: {
            repository: params.repository,
            branch: params.branch,
          },
        },
        env: {
          compute: { id: params.computeId },
          platform: {
            type: params.platformType,
            config: platformConfig,
          },
          docker: {
            use: params.dockerUse ?? false,
            ...(params.dockerUse && params.dockerId ? { id: params.dockerId } : {}),
          },
          timeout: params.timeout ?? 60,
          envVars: params.envVars ?? [],
        },
        cmd: {
          pre: params.preBuildCommands ?? [],
          build: params.buildCommands ?? [],
          post: params.postBuildCommands ?? [],
          dockerbuild: {
            use: params.dockerbuildUse ?? false,
            ...(params.dockerbuildUse ? {
              dockerfile: params.dockerbuildDockerfile ?? "",
              registry: params.dockerbuildRegistry ?? "",
              image: params.dockerbuildImage ?? "",
              tag: params.dockerbuildTag ?? "",
              latest: params.dockerbuildLatest ?? false,
            } : {}),
          },
        },
        artifact: {
          use: params.artifactUse ?? false,
          ...(params.artifactUse ? {
            path: params.artifactPath ?? [],
            storage: {
              bucket: params.artifactBucket ?? "",
              path: params.artifactStoragePath ?? "",
              filename: params.artifactFilename ?? "",
            },
            backup: params.artifactBackup ?? false,
          } : {}),
        },
        cache: {
          use: params.cacheUse ?? false,
          ...(params.cacheUse ? {
            registry: params.cacheRegistry ?? "",
            image: params.cacheImage ?? "",
            tag: params.cacheTag ?? "",
            latest: params.cacheLatest ?? false,
          } : {}),
        },
        linked: {
          CloudLogAnalytics: params.linkedCloudLogAnalytics ?? false,
          FileSafer: params.linkedFileSafer ?? false,
        },
      };

      if (params.description) body.description = params.description;

      const result = await client.requestRaw("POST", "/api/v1/project", undefined, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_sourcebuild_update_project",
    "Update an existing SourceBuild project configuration",
    {
      projectId: z.string().describe("Project ID to update"),
      description: z.string().optional().describe("Project description"),
      sourceType: z.string().optional().describe("Source repository type"),
      repository: z.string().optional().describe("Source repository name"),
      branch: z.string().optional().describe("Branch to build from"),
      computeId: z.number().optional().describe("Compute type ID"),
      platformType: z.string().optional().describe("Platform type: SourceBuild | ContainerRegistry | PublicRegistry"),
      osId: z.number().optional().describe("OS ID (if platformType=SourceBuild)"),
      runtimeId: z.number().optional().describe("Runtime type ID"),
      runtimeVersionId: z.number().optional().describe("Runtime version ID"),
      registryName: z.string().optional().describe("Container Registry name"),
      image: z.string().optional().describe("Image name"),
      tag: z.string().optional().describe("Image tag"),
      dockerUse: z.boolean().optional().describe("Include Docker engine"),
      dockerId: z.number().optional().describe("Docker engine version ID"),
      timeout: z.number().optional().describe("Build timeout in minutes (5-540)"),
      envVars: z.array(z.object({ key: z.string(), value: z.string() })).optional().describe("Build environment variables"),
      preBuildCommands: z.array(z.string()).optional().describe("Pre-build commands"),
      buildCommands: z.array(z.string()).optional().describe("Build commands"),
      postBuildCommands: z.array(z.string()).optional().describe("Post-build commands"),
      dockerbuildUse: z.boolean().optional().describe("Enable Docker image build"),
      dockerbuildDockerfile: z.string().optional().describe("Dockerfile path"),
      dockerbuildRegistry: z.string().optional().describe("Docker build target registry"),
      dockerbuildImage: z.string().optional().describe("Docker build image name"),
      dockerbuildTag: z.string().optional().describe("Docker build image tag"),
      dockerbuildLatest: z.boolean().optional().describe("Set latest tag"),
      artifactUse: z.boolean().optional().describe("Save build artifacts"),
      artifactPath: z.array(z.string()).optional().describe("Artifact paths"),
      artifactBucket: z.string().optional().describe("Object Storage bucket"),
      artifactStoragePath: z.string().optional().describe("Path within bucket"),
      artifactFilename: z.string().optional().describe("Artifact filename"),
      artifactBackup: z.boolean().optional().describe("Backup artifacts"),
      cacheUse: z.boolean().optional().describe("Save build image"),
      cacheRegistry: z.string().optional().describe("Cache registry"),
      cacheImage: z.string().optional().describe("Cache image name"),
      cacheTag: z.string().optional().describe("Cache image tag"),
      cacheLatest: z.boolean().optional().describe("Set latest tag for cache"),
      linkedCloudLogAnalytics: z.boolean().optional().describe("Cloud Log Analytics integration"),
      linkedFileSafer: z.boolean().optional().describe("File Safer integration"),
    },
    async (params) => {
      const body: Record<string, any> = {};

      if (params.description !== undefined) body.description = params.description;

      // Source
      if (params.sourceType || params.repository || params.branch) {
        body.source = {
          ...(params.sourceType ? { type: params.sourceType } : {}),
          ...(params.repository || params.branch ? {
            config: {
              ...(params.repository ? { repository: params.repository } : {}),
              ...(params.branch ? { branch: params.branch } : {}),
            },
          } : {}),
        };
      }

      // Env
      const env: Record<string, any> = {};
      if (params.computeId !== undefined) env.compute = { id: params.computeId };
      if (params.platformType) {
        const platformConfig: Record<string, any> = {};
        if (params.platformType === "SourceBuild") {
          if (params.osId !== undefined) platformConfig.os = { id: params.osId };
          if (params.runtimeId !== undefined) {
            const runtime: Record<string, any> = { id: params.runtimeId };
            if (params.runtimeVersionId !== undefined) runtime.version = { id: params.runtimeVersionId };
            platformConfig.runtime = runtime;
          }
        } else {
          if (params.registryName) platformConfig.registry = { name: params.registryName };
          if (params.image) platformConfig.image = params.image;
          if (params.tag) platformConfig.tag = params.tag;
        }
        env.platform = { type: params.platformType, config: platformConfig };
      }
      if (params.dockerUse !== undefined) {
        env.docker = { use: params.dockerUse, ...(params.dockerUse && params.dockerId ? { id: params.dockerId } : {}) };
      }
      if (params.timeout !== undefined) env.timeout = params.timeout;
      if (params.envVars !== undefined) env.envVars = params.envVars;
      if (Object.keys(env).length > 0) body.env = env;

      // Cmd
      const cmd: Record<string, any> = {};
      if (params.preBuildCommands !== undefined) cmd.pre = params.preBuildCommands;
      if (params.buildCommands !== undefined) cmd.build = params.buildCommands;
      if (params.postBuildCommands !== undefined) cmd.post = params.postBuildCommands;
      if (params.dockerbuildUse !== undefined) {
        cmd.dockerbuild = {
          use: params.dockerbuildUse,
          ...(params.dockerbuildUse ? {
            dockerfile: params.dockerbuildDockerfile ?? "",
            registry: params.dockerbuildRegistry ?? "",
            image: params.dockerbuildImage ?? "",
            tag: params.dockerbuildTag ?? "",
            latest: params.dockerbuildLatest ?? false,
          } : {}),
        };
      }
      if (Object.keys(cmd).length > 0) body.cmd = cmd;

      // Artifact
      if (params.artifactUse !== undefined) {
        body.artifact = {
          use: params.artifactUse,
          ...(params.artifactUse ? {
            path: params.artifactPath ?? [],
            storage: {
              bucket: params.artifactBucket ?? "",
              path: params.artifactStoragePath ?? "",
              filename: params.artifactFilename ?? "",
            },
            backup: params.artifactBackup ?? false,
          } : {}),
        };
      }

      // Cache
      if (params.cacheUse !== undefined) {
        body.cache = {
          use: params.cacheUse,
          ...(params.cacheUse ? {
            registry: params.cacheRegistry ?? "",
            image: params.cacheImage ?? "",
            tag: params.cacheTag ?? "",
            latest: params.cacheLatest ?? false,
          } : {}),
        };
      }

      // Linked
      if (params.linkedCloudLogAnalytics !== undefined || params.linkedFileSafer !== undefined) {
        body.linked = {
          ...(params.linkedCloudLogAnalytics !== undefined ? { CloudLogAnalytics: params.linkedCloudLogAnalytics } : {}),
          ...(params.linkedFileSafer !== undefined ? { FileSafer: params.linkedFileSafer } : {}),
        };
      }

      const result = await client.requestRaw("PATCH", `/api/v1/project/${encodeURIComponent(params.projectId)}`, undefined, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_sourcebuild_delete_project",
    "⚠️ Destructive: Permanently delete a SourceBuild project and all its build history. Set confirm=true to execute.",
    {
      projectId: z.string().describe("Project ID to delete"),
      confirm: z.boolean().default(false).describe("Must be true to execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        return {
          content: [{
            type: "text" as const,
            text: `⚠️ This will permanently delete SourceBuild project [${params.projectId}] and all build history.\n\nTo execute, call again with confirm=true.`,
          }],
        };
      }
      const result = await client.requestRaw("DELETE", `/api/v1/project/${encodeURIComponent(params.projectId)}`);
      return result;
    }
  );

  // ─── Build Execution ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_sourcebuild_start_build",
    "Start a build for a SourceBuild project",
    {
      projectId: z.string().describe("Project ID to build"),
    },
    async (params) => {
      return client.requestRaw("POST", `/api/v1/project/${encodeURIComponent(params.projectId)}/build`);
    }
  );

  defineTool(
    server,
    "ncloud_sourcebuild_get_build_history",
    "Get build history for a SourceBuild project",
    {
      projectId: z.string().describe("Project ID to query build history"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/project/${encodeURIComponent(params.projectId)}/history`);
    }
  );

  defineTool(
    server,
    "ncloud_sourcebuild_cancel_build",
    "⚠️ Destructive: Cancel a running SourceBuild build. Set confirm=true to execute.",
    {
      projectId: z.string().describe("Project ID"),
      buildId: z.string().describe("Build ID to cancel (from build history)"),
      confirm: z.boolean().default(false).describe("Must be true to execute the cancel operation"),
    },
    async (params) => {
      if (!params.confirm) {
        return {
          content: [{
            type: "text" as const,
            text: `⚠️ This will cancel build [${params.buildId}] of project [${params.projectId}].\n\nTo execute, call again with confirm=true.`,
          }],
        };
      }
      const result = await client.requestRaw(
        "DELETE",
        `/api/v1/project/${encodeURIComponent(params.projectId)}/build`,
        undefined,
        { buildId: params.buildId }
      );
      return result;
    }
  );

  // ─── Build Environment Query ───────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_sourcebuild_list_os",
    "List available operating systems for SourceBuild build environment",
    {},
    async () => {
      return client.requestRaw("GET", "/api/v1/env/os");
    }
  );

  defineTool(
    server,
    "ncloud_sourcebuild_list_compute",
    "List available compute types for SourceBuild build environment",
    {},
    async () => {
      return client.requestRaw("GET", "/api/v1/env/compute");
    }
  );

  defineTool(
    server,
    "ncloud_sourcebuild_list_runtimes",
    "List available runtime types for a specific OS in SourceBuild",
    {
      osId: z.string().describe("OS ID (from list_os)"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/env/os/${encodeURIComponent(params.osId)}/runtime`);
    }
  );

  defineTool(
    server,
    "ncloud_sourcebuild_list_runtime_versions",
    "List available runtime versions for a specific OS and runtime in SourceBuild",
    {
      osId: z.string().describe("OS ID (from list_os)"),
      runtimeId: z.string().describe("Runtime type ID (from list_runtimes)"),
    },
    async (params) => {
      return client.requestRaw(
          "GET",
          `/api/v1/env/os/${encodeURIComponent(params.osId)}/runtime/${encodeURIComponent(params.runtimeId)}/version`
        );
    }
  );

  defineTool(
    server,
    "ncloud_sourcebuild_list_docker_engines",
    "List available Docker engine versions for SourceBuild",
    {},
    async () => {
      return client.requestRaw("GET", "/api/v1/env/docker");
    }
  );

  // ─── Linked Service Query ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_sourcebuild_list_repositories",
    "List SourceCommit repositories available for SourceBuild",
    {},
    async () => {
      return client.requestRaw("GET", "/api/v1/sourcecommit/repository");
    }
  );

  defineTool(
    server,
    "ncloud_sourcebuild_list_branches",
    "List branches of a SourceCommit repository",
    {
      repositoryName: z.string().describe("Repository name (from list_repositories)"),
    },
    async (params) => {
      return client.requestRaw(
          "GET",
          `/api/v1/sourcecommit/repository/${encodeURIComponent(params.repositoryName)}/branch`
        );
    }
  );

  defineTool(
    server,
    "ncloud_sourcebuild_list_buckets",
    "List Object Storage buckets available for SourceBuild artifact storage",
    {},
    async () => {
      return client.requestRaw("GET", "/api/v1/objectstorage/bucket");
    }
  );

  defineTool(
    server,
    "ncloud_sourcebuild_list_registries",
    "List Container Registry registries available for SourceBuild",
    {},
    async () => {
      return client.requestRaw("GET", "/api/v1/containerregistry/registry");
    }
  );
}
