import type { Workspace } from '@rag/shared';
import { useOutletContext } from 'react-router';

/** The workspace `WorkspaceLayout` loaded, for the screens under `/w/:slug`. */
export function useCurrentWorkspace(): Workspace {
  return useOutletContext<Workspace>();
}
