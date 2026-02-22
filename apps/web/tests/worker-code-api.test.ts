import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOffice,
  createProject,
  createWorkspace,
  getWorkspace,
  listOffices,
  listProjects,
  listWorkspaces,
} from "@nosis/features/code/api/worker-code-api";

vi.mock("@nosis/features/shared/api/worker-http-client", () => ({
  workerJson: vi.fn(),
}));

import { workerJson } from "@nosis/features/shared/api/worker-http-client";

const mockWorkerJson = vi.mocked(workerJson);

describe("worker code api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds listWorkspaces query with optional filters", async () => {
    const projectId = "11111111-2222-4333-8444-555555555555";
    const officeId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    mockWorkerJson.mockResolvedValueOnce([]);

    await listWorkspaces(projectId, officeId);

    expect(mockWorkerJson).toHaveBeenCalledWith(
      `/api/workspaces?project_id=${projectId}&office_id=${officeId}`
    );
  });

  it("trims office names before submitting", async () => {
    mockWorkerJson.mockResolvedValueOnce({
      id: "office-1",
      user_id: "user-1",
      name: "Team",
      slug: "team",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    await createOffice({ name: "  Team  " });

    expect(mockWorkerJson).toHaveBeenCalledWith("/api/offices", {
      method: "POST",
      body: JSON.stringify({ name: "Team" }),
    });
  });

  it("rejects empty office names before request", async () => {
    await expect(createOffice({ name: "   " })).rejects.toThrow(
      "Invalid office name"
    );
    expect(mockWorkerJson).not.toHaveBeenCalled();
  });

  it("rejects invalid office ids when creating projects", async () => {
    await expect(
      createProject({
        repoUrl: "https://github.com/acme/repo",
        officeId: "invalid-office-id",
      })
    ).rejects.toThrow("Invalid office ID");
    expect(mockWorkerJson).not.toHaveBeenCalled();
  });

  it("creates projects with normalized payload", async () => {
    mockWorkerJson.mockResolvedValueOnce({
      id: "project-1",
    });

    await createProject({
      repoUrl: "https://github.com/acme/repo",
      defaultBranch: "main",
      officeId: "11111111-2222-4333-8444-555555555555",
    });

    expect(mockWorkerJson).toHaveBeenCalledWith("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        repo_url: "https://github.com/acme/repo",
        default_branch: "main",
        office_id: "11111111-2222-4333-8444-555555555555",
      }),
    });
  });

  it("builds listProjects query when office id is provided", async () => {
    mockWorkerJson.mockResolvedValueOnce([]);

    await listProjects("11111111-2222-4333-8444-555555555555");

    expect(mockWorkerJson).toHaveBeenCalledWith(
      "/api/projects?office_id=11111111-2222-4333-8444-555555555555"
    );
  });

  it("creates workspaces with expected request fields", async () => {
    mockWorkerJson.mockResolvedValueOnce({
      id: "workspace-1",
    });

    await createWorkspace({
      projectId: "11111111-2222-4333-8444-555555555555",
      kind: "cloud",
      name: "Cloud workspace",
      baseBranch: "main",
      workingBranch: "nosis/workspace-1",
    });

    expect(mockWorkerJson).toHaveBeenCalledWith("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({
        project_id: "11111111-2222-4333-8444-555555555555",
        kind: "cloud",
        name: "Cloud workspace",
        base_branch: "main",
        working_branch: "nosis/workspace-1",
        remote_url: undefined,
        local_path: undefined,
        status: undefined,
      }),
    });
  });

  it("rejects invalid workspace ids before getWorkspace request", async () => {
    await expect(getWorkspace("not-uuid")).rejects.toThrow(
      "Invalid workspace ID"
    );
    expect(mockWorkerJson).not.toHaveBeenCalled();
  });

  it("lists offices without query params", async () => {
    mockWorkerJson.mockResolvedValueOnce([]);

    await listOffices();

    expect(mockWorkerJson).toHaveBeenCalledWith("/api/offices");
  });
});
