export const SANDBOX_EXECUTION_TARGET = "sandbox" as const;
export const LOCAL_EXECUTION_TARGET = "local" as const;

export type SharedExecutionTarget =
  | typeof SANDBOX_EXECUTION_TARGET
  | typeof LOCAL_EXECUTION_TARGET;
export type CloudExecutionTarget = typeof SANDBOX_EXECUTION_TARGET;
export type DesktopExecutionTarget = SharedExecutionTarget;
export type ExecutionSurface = "worker" | "web" | "desktop";
export type SandboxExecutionTarget = typeof SANDBOX_EXECUTION_TARGET;

export function canonicalizeExecutionTarget(
  value: string | null | undefined
): SandboxExecutionTarget {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === SANDBOX_EXECUTION_TARGET
  ) {
    return SANDBOX_EXECUTION_TARGET;
  }

  throw new Error(
    `Unsupported cloud execution target: ${value}. Worker supports sandbox only.`
  );
}

export function supportsExecutionTargetOnSurface(
  target: SharedExecutionTarget,
  surface: ExecutionSurface
): boolean {
  if (surface === "desktop") {
    return (
      target === SANDBOX_EXECUTION_TARGET || target === LOCAL_EXECUTION_TARGET
    );
  }
  return target === SANDBOX_EXECUTION_TARGET;
}

export function supportedExecutionTargetsForSurface(
  surface: ExecutionSurface
): readonly SharedExecutionTarget[] {
  if (surface === "desktop") {
    return [SANDBOX_EXECUTION_TARGET, LOCAL_EXECUTION_TARGET];
  }
  return [SANDBOX_EXECUTION_TARGET];
}
