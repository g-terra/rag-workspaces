import { MessageSquarePlus, Send, SquareIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useCurrentWorkspace } from '@/workspaces/current';
import { answerMeta } from './answer';
import { AnswerFailure, AnswerText, Sources } from './answer-view';
import { lastTurn, type ChatTurn } from './chat';
import { PassageDialog } from './passage-dialog';
import { QuestionBox } from './question-box';
import { useChat } from './use-chat';

/**
 * The playground's Chat mode: a conversation the API remembers, so a follow-up ("why?") is answered
 * with the earlier turns in view. Each reply cites its passages, as an answer does.
 */
export function ChatPanel() {
  const w = useCurrentWorkspace();
  const chat = useChat(w.slug);
  const [message, setMessage] = useState('');
  const [openPassage, setOpenPassage] = useState<string | null>(null);
  const streaming = lastTurn(chat)?.status === 'streaming';
  const submit = () => {
    const text = message.trim();
    if (!text || streaming) return;
    chat.send(text);
    // The sent message is in the thread above, so the box starts empty for the follow-up.
    setMessage('');
  };

  return (
    <>
      {chat.turns.length > 0 && (
        <div className="flex flex-col gap-5">
          {chat.turns.map((turn, i) => (
            <Turn
              key={i}
              turn={turn}
              onOpenPassage={setOpenPassage}
              onRetry={() => chat.send(turn.question)}
            />
          ))}
        </div>
      )}

      <QuestionBox
        id="message"
        label={chat.turns.length === 0 ? 'Message' : 'Follow-up'}
        placeholder={
          chat.turns.length === 0 ? 'What is retrieval-augmented generation?' : 'Why does that matter?'
        }
        value={message}
        onChange={setMessage}
        onSubmit={submit}
      >
        <div className="text-muted-foreground flex min-w-0 flex-1 items-center gap-3 text-xs">
          {chat.conversationId !== null && (
            <>
              <span className="truncate font-mono" data-testid="conversation-id">
                {chat.conversationId}
              </span>
              <Button variant="ghost" size="sm" onClick={chat.reset} disabled={streaming}>
                <MessageSquarePlus /> New conversation
              </Button>
            </>
          )}
        </div>
        {streaming ? (
          <Button size="sm" variant="outline" onClick={chat.stop}>
            <SquareIcon /> Stop
          </Button>
        ) : (
          <Button size="sm" onClick={submit} disabled={!message.trim()}>
            <Send /> Send <span className="text-primary-foreground/60 font-mono text-xs">Ctrl ↵</span>
          </Button>
        )}
      </QuestionBox>

      <PassageDialog slug={w.slug} passageId={openPassage} onClose={() => setOpenPassage(null)} />
    </>
  );
}

/** One exchange: what you sent, then the reply with its sources. */
function Turn({
  turn,
  onOpenPassage,
  onRetry,
}: {
  turn: ChatTurn;
  onOpenPassage(passageId: string | null): void;
  onRetry(): void;
}) {
  const citations = turn.reply?.citations ?? [];
  return (
    <div data-testid="turn" className="flex flex-col gap-3">
      <p className="bg-accent ml-auto max-w-150 rounded-xl rounded-br-sm px-4 py-2.5 text-[15px] whitespace-pre-wrap">
        {turn.question}
      </p>
      {turn.status === 'failed' && turn.error ? (
        <AnswerFailure error={turn.error} onRetry={onRetry} />
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          <div className="bg-card flex min-w-0 flex-[999_1_460px] flex-col gap-3 rounded-xl border p-5">
            {turn.reply?.grounded === false ? (
              <p className="text-muted-foreground text-[15px] leading-relaxed">
                Nothing in this workspace was close enough to that, so no reply was generated. Ask in the
                words the material uses, or upload material that covers it.
              </p>
            ) : (
              <p data-testid="reply" className="text-[15px] leading-relaxed whitespace-pre-wrap">
                <AnswerText
                  text={turn.text}
                  citations={citations}
                  streaming={turn.status === 'streaming'}
                  onOpen={onOpenPassage}
                />
              </p>
            )}
            {turn.status === 'stopped' && (
              <p className="text-muted-foreground border-t pt-3 text-[13px]">
                Stopped. What had arrived is above; the API still stored the whole reply.
              </p>
            )}
            {turn.reply && (
              <p className="text-muted-foreground border-t pt-3 text-xs" data-testid="reply-meta">
                {answerMeta(turn.reply)}
              </p>
            )}
          </div>
          {citations.length > 0 && <Sources citations={citations} onOpen={onOpenPassage} />}
        </div>
      )}
    </div>
  );
}
