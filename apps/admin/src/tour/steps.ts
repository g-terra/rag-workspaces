/** One stop on the first-time walkthrough. `target` is the `data-tour` value of the element it points at. */
export interface TourStep {
  id: string;
  target?: string;
  title: string;
  body: string;
}

/**
 * The walkthrough, in order. A step is skipped when its element isn't on screen, which covers role
 * (readers have no Upload), admin-only links and being outside a workspace, without branching here.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to rag-workspaces',
    body:
      'Material lives in workspaces: separate collections of documents, each with its own models, ' +
      'settings, members and REST API. Ask a question in a workspace and the answer comes only from ' +
      'its documents, with citations. This short tour shows where everything is.',
  },
  {
    id: 'switcher',
    target: 'switcher',
    title: 'Your workspaces',
    body:
      'Switch between the workspaces you can open here. Admins also create new ones from this menu: ' +
      'a short wizard sets the name, the chat and embedding models and how answers are retrieved.',
  },
  {
    id: 'upload',
    target: 'upload',
    title: 'Upload material',
    body:
      'Add PDFs, slides, notes and other files to the open workspace. Each file is split, embedded and ' +
      'indexed in the background, and you can watch its status live.',
  },
  {
    id: 'documents',
    target: 'documents',
    title: 'Documents',
    body: 'Everything in the workspace: preview a file, see how it was indexed, retry or delete it.',
  },
  {
    id: 'playground',
    target: 'playground',
    title: 'Playground',
    body:
      'Try the workspace out: ask a question and get a cited answer, search for matching passages, or ' +
      'chat with follow-ups. Rate answers to help tune it.',
  },
  {
    id: 'conversations',
    target: 'conversations',
    title: 'Conversations',
    body: 'Your past questions and chats in this workspace. Only you and admins can see them.',
  },
  {
    id: 'usage',
    target: 'usage',
    title: 'Usage',
    body: "How much the workspace is used: questions, tokens, response times and what's being asked.",
  },
  {
    id: 'settings',
    target: 'settings',
    title: 'Workspace settings',
    body:
      'Change the models, enter API keys for hosted providers, tune retrieval and the system prompt, ' +
      'and choose who can read or edit this workspace.',
  },
  {
    id: 'all-workspaces',
    target: 'all-workspaces',
    title: 'All workspaces',
    body: 'As an admin you see every workspace here, whether or not you are a member.',
  },
  {
    id: 'api-keys',
    target: 'api-keys',
    title: 'API keys',
    body:
      'Apps and agents call the API with keys you create here. Each key is limited to the workspaces ' +
      'you choose, as a reader or an editor.',
  },
  {
    id: 'system',
    target: 'system',
    title: 'System',
    body: 'The version, the health of each service and links to the tools behind the API: Langflow, Keycloak and Swagger.',
  },
  {
    id: 'help',
    target: 'help',
    title: 'Help is here',
    body: 'Open this menu to take the tour again or read the API docs. That’s it, enjoy!',
  },
];

/**
 * The index of the next step to show from `from`, going `direction`, skipping steps whose target isn't
 * on screen (`exists`). Steps without a target are always shown. Null when there is none left.
 */
export function nextStepIndex(
  steps: TourStep[],
  from: number,
  direction: 1 | -1,
  exists: (target: string) => boolean,
): number | null {
  for (let i = from + direction; i >= 0 && i < steps.length; i += direction) {
    const target = steps[i]!.target;
    if (target === undefined || exists(target)) return i;
  }
  return null;
}

/** "n of m" for step `index`, counting only the steps that can be shown now. */
export function stepPosition(
  steps: TourStep[],
  index: number,
  exists: (target: string) => boolean,
): { n: number; of: number } {
  const available = steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.target === undefined || exists(s.target));
  return { n: available.findIndex(({ i }) => i === index) + 1, of: available.length };
}
