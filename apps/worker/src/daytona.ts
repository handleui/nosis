import {
  Daytona,
  DaytonaError,
  DaytonaNotFoundError,
  DaytonaRateLimitError,
  DaytonaTimeoutError,
  type CreateSandboxFromSnapshotParams,
  type DaytonaConfig,
} from "@daytonaio/sdk";
import { HTTPException } from "hono/http-exception";
import type {
  DaytonaCreateSandboxRequest,
  DaytonaExecuteRequest,
  DaytonaExecuteResponse,
  DaytonaListSandboxesResponse,
  DaytonaSandboxSummary,
} from "./types";

interface DaytonaClientOptions {
  apiUrl?: string;
  target?: string;
}

interface DaytonaSandboxLike {
  id: string;
  name: string;
  state?: string;
  labels?: Record<string, string>;
  target: string;
  autoStopInterval?: number;
  createdAt?: string;
  updatedAt?: string;
}

const DEFAULT_CREATE_TIMEOUT_SECONDS = 60;
const NOSIS_LABEL_APP_KEY = "nosis_app";
const NOSIS_LABEL_OWNER_KEY = "nosis_owner";
const NOSIS_LABEL_APP_VALUE = "worker";

function buildConfig(
  apiKey: string,
  options?: DaytonaClientOptions
): DaytonaConfig {
  const config: DaytonaConfig = { apiKey };

  if (options?.apiUrl) {
    config.apiUrl = options.apiUrl;
  }
  if (options?.target) {
    config.target = options.target;
  }

  return config;
}

function toSummary(sandbox: DaytonaSandboxLike): DaytonaSandboxSummary {
  return {
    id: sandbox.id,
    name: sandbox.name,
    state: sandbox.state ?? null,
    target: sandbox.target,
    autoStopInterval: sandbox.autoStopInterval ?? null,
    createdAt: sandbox.createdAt ?? null,
    updatedAt: sandbox.updatedAt ?? null,
  };
}

function buildOwnershipLabels(userId: string): Record<string, string> {
  return {
    [NOSIS_LABEL_APP_KEY]: NOSIS_LABEL_APP_VALUE,
    [NOSIS_LABEL_OWNER_KEY]: userId,
  };
}

function assertOwnedSandbox(sandbox: DaytonaSandboxLike, userId: string): void {
  const labels = sandbox.labels ?? {};
  const isOwnedByUser =
    labels[NOSIS_LABEL_APP_KEY] === NOSIS_LABEL_APP_VALUE &&
    labels[NOSIS_LABEL_OWNER_KEY] === userId;

  if (!isOwnedByUser) {
    throw new HTTPException(404, { message: "Sandbox not found" });
  }
}

function toHttpError(error: unknown): HTTPException {
  if (error instanceof HTTPException) {
    return error;
  }

  if (error instanceof DaytonaNotFoundError) {
    return new HTTPException(404, { message: "Sandbox not found" });
  }
  if (error instanceof DaytonaRateLimitError) {
    return new HTTPException(429, { message: "Daytona rate limit exceeded" });
  }
  if (error instanceof DaytonaTimeoutError) {
    return new HTTPException(504, { message: "Daytona request timed out" });
  }

  if (error instanceof DaytonaError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return new HTTPException(401, { message: "Invalid Daytona API key" });
    }
    if (error.statusCode === 404) {
      return new HTTPException(404, { message: "Sandbox not found" });
    }
    if (error.statusCode === 400 || error.statusCode === 422) {
      return new HTTPException(400, { message: "Invalid Daytona request" });
    }
    if (error.statusCode === 409) {
      return new HTTPException(409, {
        message: "Sandbox state conflict",
      });
    }
    if (error.statusCode === 429) {
      return new HTTPException(429, {
        message: "Daytona rate limit exceeded",
      });
    }
    if (error.statusCode === 408 || error.statusCode === 504) {
      return new HTTPException(504, { message: "Daytona request timed out" });
    }
    return new HTTPException(502, { message: "Daytona request failed" });
  }

  return new HTTPException(502, { message: "Daytona request failed" });
}

async function withDaytona<T>(
  apiKey: string,
  options: DaytonaClientOptions | undefined,
  run: (daytona: Daytona) => Promise<T>
): Promise<T> {
  const daytona = new Daytona(buildConfig(apiKey, options));

  try {
    return await run(daytona);
  } catch (error) {
    throw toHttpError(error);
  } finally {
    const asyncDispose = daytona[Symbol.asyncDispose];
    if (typeof asyncDispose === "function") {
      try {
        await asyncDispose.call(daytona);
      } catch {
        // No-op.
      }
    }
  }
}

export function listDaytonaSandboxes(
  apiKey: string,
  userId: string,
  options?: DaytonaClientOptions,
  page?: number,
  limit?: number
): Promise<DaytonaListSandboxesResponse> {
  return withDaytona(apiKey, options, async (daytona) => {
    const response = await daytona.list(
      buildOwnershipLabels(userId),
      page,
      limit
    );

    return {
      items: response.items.map((sandbox) => toSummary(sandbox)),
      total: response.total,
      page: response.page,
      totalPages: response.totalPages,
    };
  });
}

export function createDaytonaSandbox(
  apiKey: string,
  userId: string,
  request: DaytonaCreateSandboxRequest,
  options?: DaytonaClientOptions
): Promise<DaytonaSandboxSummary> {
  return withDaytona(apiKey, options, async (daytona) => {
    const params: CreateSandboxFromSnapshotParams = {
      labels: buildOwnershipLabels(userId),
    };

    if (request.name !== undefined) {
      params.name = request.name;
    }
    if (request.language !== undefined) {
      params.language = request.language;
    }
    if (request.autoStopInterval !== undefined) {
      params.autoStopInterval = request.autoStopInterval;
    }
    if (request.envVars !== undefined) {
      params.envVars = request.envVars;
    }

    const timeout = request.timeout ?? DEFAULT_CREATE_TIMEOUT_SECONDS;
    const sandbox = await daytona.create(params, { timeout });

    return toSummary(sandbox);
  });
}

export function executeDaytonaSandboxCommand(
  apiKey: string,
  userId: string,
  sandboxId: string,
  request: DaytonaExecuteRequest,
  options?: DaytonaClientOptions
): Promise<DaytonaExecuteResponse> {
  return withDaytona(apiKey, options, async (daytona) => {
    const sandbox = await daytona.get(sandboxId);
    assertOwnedSandbox(sandbox, userId);
    const result = await sandbox.process.executeCommand(
      request.command,
      request.cwd,
      request.env,
      request.timeout
    );

    return {
      exitCode: result.exitCode,
      result: result.result,
      stdout: result.artifacts?.stdout ?? result.result,
    };
  });
}

export function startDaytonaSandbox(
  apiKey: string,
  userId: string,
  sandboxId: string,
  timeout?: number,
  options?: DaytonaClientOptions
): Promise<DaytonaSandboxSummary> {
  return withDaytona(apiKey, options, async (daytona) => {
    const sandbox = await daytona.get(sandboxId);
    assertOwnedSandbox(sandbox, userId);
    await sandbox.start(timeout);
    await sandbox.refreshData();
    return toSummary(sandbox);
  });
}

export function stopDaytonaSandbox(
  apiKey: string,
  userId: string,
  sandboxId: string,
  timeout?: number,
  options?: DaytonaClientOptions
): Promise<DaytonaSandboxSummary> {
  return withDaytona(apiKey, options, async (daytona) => {
    const sandbox = await daytona.get(sandboxId);
    assertOwnedSandbox(sandbox, userId);
    await sandbox.stop(timeout);
    await sandbox.refreshData();
    return toSummary(sandbox);
  });
}

export async function deleteDaytonaSandbox(
  apiKey: string,
  userId: string,
  sandboxId: string,
  timeout?: number,
  options?: DaytonaClientOptions
): Promise<void> {
  await withDaytona(apiKey, options, async (daytona) => {
    const sandbox = await daytona.get(sandboxId);
    assertOwnedSandbox(sandbox, userId);
    await sandbox.delete(timeout);
  });
}
