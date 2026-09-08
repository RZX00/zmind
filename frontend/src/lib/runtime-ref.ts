type ProjectLike = {
  id?: string | null;
  runtime?: {
    runtime_ref?: string | null;
  } | null;
  sandbox?: string | { id?: string | null } | null;
};

export const resolveProjectRuntimeRef = (
  project?: ProjectLike | null,
): string | null => {
  if (!project) return null;

  const runtimeRef = project.runtime?.runtime_ref?.trim();
  if (runtimeRef) return runtimeRef;

  if (typeof project.sandbox === 'string') {
    const sandboxRef = project.sandbox.trim();
    if (sandboxRef) return sandboxRef;
  } else if (project.sandbox?.id) {
    const sandboxRef = project.sandbox.id.trim();
    if (sandboxRef) return sandboxRef;
  }

  const projectId = project.id?.trim();
  return projectId || null;
};
