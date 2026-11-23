import type { ConversationWithMessages, Message } from '@rag/shared';
import { Trash2 } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { Link, useSearchParams } from 'react-router';
import { conversationName, messageBody } from '@/conversations/thread';
import { useConversation, useConversations, useDeleteConversation } from '@/conversations/queries';
import { ErrorState, Loading, Notice } from '@/components/states';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { formatRelative } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { answerMeta } from '@/playground/answer';
import { AnswerText, Sources } from '@/playground/answer-view';
import { lastTurn } from '@/playground/chat';
import { ChatBox, Sent, TurnView } from '@/playground/chat-view';
import { PassageDialog } from '@/playground/passage-dialog';
import { useChat } from '@/playground/use-chat';
import { useCurrentWorkspace } from '@/workspaces/current';

/**
 * `/w/:slug/conversations`: your conversations with this workspace, and one of them in full. The open
 * one is in the URL (`?c=cnv_…`), so the playground can link straight to the conversation it just started.
 */
export function Conversations() {
  const w = useCurrentWorkspace();
  const [params, setParams] = useSearchParams();
  const openId = params.get('c');
  const list = useConversations(w.slug);
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <>
      <TopBar trail={[w.name, 'Conversations']} />
      <div className="flex w-full max-w-350 flex-col gap-5 px-6 pt-7 pb-12">
        <div>
          <h1
            ref={heading}
            tabIndex={-1}
            className="mb-1.5 text-2xl font-semibold tracking-tight outline-none"
          >
            Conversations
          </h1>
          <p className="text-muted-foreground text-sm">
            Your conversations with this workspace, with the passages each reply was given.
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-5">
          <aside aria-label="Conversations" className="flex w-full max-w-80 flex-[1_1_260px] flex-col">
            {list.isPending && <Loading what="conversations" />}
            {list.isError && (
              <ErrorState
                title="The conversations could not be loaded"
                error={list.error}
                onRetry={() => void list.refetch()}
              />
            )}
            {list.data?.length === 0 && (
              <Notice
                title="No conversations yet"
                body="Start one in the playground's Chat mode to see it here."
              >
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/w/${w.slug}/playground?mode=chat`}>Open Chat</Link>
                </Button>
              </Notice>
            )}
            {list.data?.map((c) => (
              <button
                key={c.id}
                type="button"
                data-testid="conversation"
                onClick={() => setParams({ c: c.id }, { replace: true })}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border-b px-3 py-2.5 text-left last:border-b-0',
                  c.id === openId ? 'bg-accent' : 'hover:bg-accent/50',
                )}
              >
                <span className="truncate text-[13px] font-semibold">{conversationName(c)}</span>
                <span className="text-muted-foreground text-xs">{formatRelative(c.updatedAt)}</span>
              </button>
            ))}
            {list.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </aside>

          <div className="min-w-0 flex-[999_1_520px]">
            {openId === null ? (
              <Notice
                title="Open a conversation"
                body="Its messages, the passages each reply was given, and a box to carry it on."
              />
            ) : (
              // Keyed by conversation: each one has its own thread, and its own box to continue it.
              <Thread
                key={openId}
                slug={w.slug}
                id={openId}
                onDeleted={() => setParams({}, { replace: true })}
                // The Delete button that opened the dialog is gone with the conversation.
                focusAfterDelete={() => heading.current?.focus()}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** One conversation: what is stored, then whatever you add to it now. */
function Thread({
  slug,
  id,
  onDeleted,
  focusAfterDelete,
}: {
  slug: string;
  id: string;
  onDeleted(): void;
  focusAfterDelete(): void;
}) {
  const stored = useConversation(slug, id);
  const chat = useChat(slug, id);
  const [openPassage, setOpenPassage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const streaming = lastTurn(chat)?.status === 'streaming';

  if (stored.isPending) return <Loading what="the conversation" />;
  if (stored.isError) {
    return (
      <ErrorState
        title="The conversation could not be loaded"
        error={stored.error}
        onRetry={() => void stored.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{conversationName(stored.data)}</h2>
          <p className="text-muted-foreground text-xs">Started {formatRelative(stored.data.createdAt)}</p>
        </div>
        <Button ref={deleteButton} variant="outline" size="sm" onClick={() => setConfirming(true)}>
          <Trash2 /> Delete
        </Button>
      </div>

      {stored.data.messages.map((m) => (
        <StoredMessage key={m.id} message={m} onOpenPassage={setOpenPassage} />
      ))}

      {/* What this page added since it was opened; the stored list above is what was there before. */}
      {chat.turns.map((turn, i) => (
        <TurnView
          key={i}
          turn={turn}
          onOpenPassage={setOpenPassage}
          onRetry={streaming ? null : () => chat.send(turn.question)}
        />
      ))}

      <ChatBox
        first={stored.data.messages.length === 0 && chat.turns.length === 0}
        streaming={streaming}
        onSend={chat.send}
        onStop={chat.stop}
      >
        <span>Carries on this conversation, with its history.</span>
      </ChatBox>

      <PassageDialog slug={slug} passageId={openPassage} onClose={() => setOpenPassage(null)} />
      <DeleteDialog
        slug={slug}
        conversation={stored.data}
        open={confirming}
        onOpenChange={setConfirming}
        onDeleted={onDeleted}
        returnFocusTo={deleteButton}
        focusAfterDelete={focusAfterDelete}
      />
    </div>
  );
}

/** A message as the API stored it: yours in a bubble, a reply in a card with its sources. */
function StoredMessage({
  message,
  onOpenPassage,
}: {
  message: Message;
  onOpenPassage(passageId: string | null): void;
}) {
  const { text, error } = messageBody(message);
  if (message.role === 'user') return <Sent>{text}</Sent>;
  return (
    <div data-testid="stored-reply" className="flex flex-wrap items-start gap-4">
      <div className="bg-card flex min-w-0 flex-[999_1_460px] flex-col gap-3 rounded-xl border p-5">
        {text && (
          <AnswerText text={text} citations={message.citations} streaming={false} onOpen={onOpenPassage} />
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm whitespace-pre-wrap">
            {error}
          </p>
        )}
        <p className="text-muted-foreground border-t pt-3 text-xs">{answerMeta(message)}</p>
      </div>
      {message.citations.length > 0 && <Sources citations={message.citations} onOpen={onOpenPassage} />}
    </div>
  );
}

function DeleteDialog(props: {
  slug: string;
  conversation: ConversationWithMessages;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDeleted(): void;
  /** Gets focus back when the dialog closes without deleting (it is opened from state, so Radix can't). */
  returnFocusTo: RefObject<HTMLButtonElement | null>;
  focusAfterDelete(): void;
}) {
  const remove = useDeleteConversation(props.slug);
  const deleted = useRef(false);
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (remove.isPending) return;
        remove.reset();
        props.onOpenChange(open);
      }}
    >
      <DialogContent
        onCloseAutoFocus={(e) => {
          // Runs once the focus trap and aria-hidden are gone, so focus moved here stays and is announced.
          e.preventDefault();
          if (deleted.current) props.focusAfterDelete();
          else props.returnFocusTo.current?.focus();
        }}
      >
        <DialogTitle>Delete this conversation?</DialogTitle>
        <DialogDescription>
          "{conversationName(props.conversation)}" and its {props.conversation.messages.length} messages are
          removed. This can't be undone, and the answers they cite are not affected.
        </DialogDescription>
        {remove.error && (
          <p role="alert" className="text-destructive text-sm">
            {remove.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline" disabled={remove.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(props.conversation.id, {
                onSuccess: () => {
                  deleted.current = true;
                  props.onOpenChange(false);
                  props.onDeleted();
                },
              })
            }
          >
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
