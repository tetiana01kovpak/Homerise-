import type { Project } from '../model/types';
import { specToProject, type HouseSpec } from '../model/spec';
import { furnishProject, landscapeProject } from '../model/furnish';

/** Spec → fully furnished, landscaped project (no UI dependencies; usable in tests). */
export function buildFromSpec(spec: HouseSpec): Project {
  return specToProject(spec, { furnish: (p) => { furnishProject(p); }, landscape: landscapeProject });
}
