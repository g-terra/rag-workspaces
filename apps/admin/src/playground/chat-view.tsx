import { Send, SquareIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { answerMeta, foundNothing, NOT_GROUNDED, UNCITED } from './answer';
import { AnswerFailure, AnswerText, Sources } from './answer-view';
import type { ChatTurn } from './chat';
import { QuestionBox } from './question-box';

/**
 * The box a conversation is typed into, wherever it is held: the playground's Chat mode, or a stored
 * conversation being continued. `children` is whatever belongs in the footer beside the button.
 */
export function ChatBox({
  first,
  streaming,
  onSend,
  onStop,
  children,
}: {
  /** The first message of a thread reads as "Message", a later one as "Follow-up". */
  first: boolean;
  streaming: boolean;
  onSend(message: string): void;
  onStop(): void;
  children?: ReactNode;
}) {
  const [message, setMessage] = useState('');
  const submit = () => {
    const text = message.trim();
    if (!text || streaming) return;
    onSend(text);
    // The sent message is in the thread above, so the box starts empty for the follow-up.
    setMessage('');
  };

  return (
    <QuestionBox
      id="message"
      label={first ? 'Message' : 'Follow-up'}
      placeholder={first ? 'What is retrieval-augmented generation?' : 'Why does that matter?'}
      value={message}
      onChange={setMessage}
      onSubmit={submit}
    >
      <div className="text-muted-foreground flex min-w-0 flex-1 items-center gap-3 text-xs">{children}</div>
      {streaming ? (
        <Button size="sm" variant="outline" onClick={onStop}>
          <SquareIcon /> Stop
        </Button>
      ) : (
        <Button size="sm" onClick={submit} disabled={!message.trim()}>
          <Send /> Send <span className="text-primary-foreground/60 font-mono text-xs">Ctrl ↵</span>
        </Button>
      )}
    </QuestionBox>
  );
}

/** One exchange: what you sent, then the reply with its sources. */
export function TurnView({
  turn,
  onOpenPassage,
  onRetry,
}: {
  turn: ChatTurn;
  onOpenPassage(passageId: string | null): void;
  /** null while another reply is streaming, which retrying would abort. */
  onRetry: (() => void) | null;
}) {
  const citations = turn.reply?.citations ?? [];
  const failed = turn.status === 'failed' && turn.error !== null;
  return (
    <div data-testid="turn" className="flex flex-col gap-3">
      <Sent>{turn.question}</Sent>
      {failed && turn.error && <AnswerFailure error={turn.error} onRetry={onRetry} />}
      {/* A reply that failed part-way through still showed those words: they stay above the reason. */}
      {(!failed || turn.text !== '') && (
        <div className="flex flex-wrap items-start gap-4">
          <div className="bg-card flex min-w-0 flex-[999_1_460px] flex-col gap-3 rounded-xl border p-5">
            {turn.reply && foundNothing(turn.reply) ? (
              <p className="text-muted-foreground text-[15px] leading-relaxed">
                {NOT_GROUNDED} Ask in the words the material uses, or upload material that covers it.
              </p>
            ) : (
              <div data-testid="reply">
                <AnswerText
                  text={turn.text}
                  citations={citations}
                  streaming={turn.status === 'streaming'}
                  onOpen={onOpenPassage}
                />
              </div>
            )}
            {turn.reply?.grounded === false && citations.length > 0 && (
              <p className="text-muted-foreground border-t pt-3 text-[13px]" data-testid="uncited">
                {UNCITED}
              </p>
            )}
            {turn.status === 'stopped' && (
              <p className="text-muted-foreground border-t pt-3 text-[13px]">
                Stopped. What had arrived is above; the API stopped generating too and stored the reply as it
                stood.
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

/** A message you sent: the bubble on the right, in both the live thread and a stored one. */
export function Sent({ children }: { children: ReactNode }) {
  return (
    <p className="bg-accent ml-auto max-w-150 rounded-xl rounded-br-sm px-4 py-2.5 text-[15px] whitespace-pre-wrap">
      {children}
    </p>
  );
}
