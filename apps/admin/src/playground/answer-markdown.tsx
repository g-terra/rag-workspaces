import type { Parent, PhrasingContent, Root, RootContent } from 'mdast';
import type { ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { answerParts } from './answer';

/**
 * An answer's markdown as formatted text: bold, lists, tables and code, as the model writes them.
 * Raw HTML is never rendered (react-markdown shows it as text unless a rehype-raw plugin is added,
 * which this deliberately doesn't), and react-markdown's default URL check drops `javascript:` links.
 *
 * Each `[n]` that `answerParts` accepts becomes a `<cite-marker>` node in the tree, rendered by
 * `renderCitation`; markers inside inline code or code blocks are never touched, because those are
 * not text nodes. While the answer streams, a caret sits at the end of its last paragraph.
 */
export function AnswerMarkdown({
  text,
  ranks,
  streaming,
  renderCitation,
}: {
  text: string;
  ranks: number[];
  streaming: boolean;
  renderCitation(rank: number): ReactNode;
}) {
  const components = {
    'cite-marker': ({ 'data-rank': rank }: { 'data-rank'?: string }) => renderCitation(Number(rank)),
    'stream-caret': () => (
      <span data-testid="caret" className="bg-foreground ml-0.5 inline-block h-4 w-1.5 animate-pulse" />
    ),
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
    // An image would load from wherever the model pointed it; its alt text is enough.
    img: ({ alt }) => <>{alt}</>,
  } as Components;

  return (
    <Markdown
      remarkPlugins={[remarkGfm, [remarkCitations, { ranks }], [remarkCaret, { streaming }]]}
      components={components}
    >
      {text}
    </Markdown>
  );
}

/** Splits every text node at its citation markers (see `answerParts`). */
function remarkCitations({ ranks }: { ranks: number[] }) {
  return (tree: Root) => {
    const walk = (node: Parent) => {
      node.children = node.children.flatMap((child): RootContent[] => {
        if (child.type === 'text') {
          return answerParts(child.value, ranks).map((part) =>
            'rank' in part ? citationNode(part.rank) : { type: 'text', value: part.text },
          );
        }
        if ('children' in child) walk(child);
        return [child];
      }) as Parent['children'];
    };
    walk(tree);
  };
}

/** A node mdast doesn't know; `data.hName` makes it an element react-markdown hands to `components`. */
function citationNode(rank: number): PhrasingContent {
  return {
    type: 'text',
    value: '',
    data: { hName: 'cite-marker', hProperties: { dataRank: String(rank) }, hChildren: [] },
  } as PhrasingContent;
}

/**
 * While streaming, a caret at the end of the last paragraph, or on its own when the answer ends in a
 * list or table. Plugin options go in an object here and above: unified reads a bare `true` as "no
 * options".
 */
function remarkCaret({ streaming }: { streaming: boolean }) {
  return (tree: Root) => {
    if (!streaming) return;
    const caret = {
      type: 'text',
      value: '',
      data: { hName: 'stream-caret', hChildren: [] },
    } as PhrasingContent;
    const last = tree.children.at(-1);
    if (last?.type === 'paragraph') last.children.push(caret);
    else tree.children.push({ type: 'paragraph', children: [caret] });
  };
}
