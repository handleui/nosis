import { assertUuid } from "@nosis/features/shared/api/worker-api-validation";
import { workerJson } from "@nosis/features/shared/api/worker-http-client";

export type WorkspaceKind = "cloud";
export type WorkspaceStatus = "ready" | "provisioning" | "error";

export interface Office {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  office_id: string;
  repo_url: string;
  owner: string;
  repo: string;
  default_branch: string | null;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  user_id: string;
  project_id: string;
  kind: WorkspaceKind;
  name: string;
  base_branch: string;
  working_branch: string;
  remote_url: string | null;
  local_path: string | null;
  status: WorkspaceStatus;
  created_at: string;
  updated_at: string;
}

export async function createProject(input: {
  repoUrl: string;
  defaultBranch?: string;
  officeId?: string;
}): Promise<Project> {
  if (input.officeId) {
    assertUuid(input.officeId, "office ID");
  }
  return await workerJson<Project>("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      repo_url: input.repoUrl,
      default_branch: input.defaultBranch,
      office_id: input.officeId,
    }),
  });
}

export async function listProjects(officeId?: string): Promise<Project[]> {
  if (officeId) {
    assertUuid(officeId, "office ID");
  }
  const query = officeId ? `?office_id=${encodeURIComponent(officeId)}` : "";
  return await workerJson<Project[]>(`/api/projects${query}`);
}

export async function createOffice(input: { name: string }): Promise<Office> {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("Invalid office name");
  }
  return await workerJson<Office>("/api/offices", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function listOffices(): Promise<Office[]> {
  return await workerJson<Office[]>("/api/offices");
}

export async function createWorkspace(input: {
  projectId: string;
  kind: WorkspaceKind;
  name?: string;
  baseBranch?: string;
  workingBranch?: string;
  remoteUrl?: string;
  localPath?: string;
  status?: WorkspaceStatus;
}): Promise<Workspace> {
  assertUuid(input.projectId, "project ID");
  return await workerJson<Workspace>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({
      project_id: input.projectId,
      kind: input.kind,
      name: input.name,
      base_branch: input.baseBranch,
      working_branch: input.workingBranch,
      remote_url: input.remoteUrl,
      local_path: input.localPath,
      status: input.status,
    }),
  });
}

export async function listWorkspaces(
  projectId?: string,
  officeId?: string
): Promise<Workspace[]> {
  if (projectId) {
    assertUuid(projectId, "project ID");
  }
  if (officeId) {
    assertUuid(officeId, "office ID");
  }
  const params = new URLSearchParams();
  if (projectId) {
    params.set("project_id", projectId);
  }
  if (officeId) {
    params.set("office_id", officeId);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return await workerJson<Workspace[]>(`/api/workspaces${query}`);
}

export async function getWorkspace(id: string): Promise<Workspace> {
  assertUuid(id, "workspace ID");
  return await workerJson<Workspace>(`/api/workspaces/${id}`);
}
