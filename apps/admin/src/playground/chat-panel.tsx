import { MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { useCurrentWorkspace } from '@/workspaces/current';
import { lastTurn } from './chat';
import { ChatBox, TurnView } from './chat-view';
import { PassageDialog } from './passage-dialog';
import { useChat } from './use-chat';

/**
 * The playground's Chat mode: a conversation the API remembers, so a follow-up ("why?") is answered
 * with the earlier turns in view. Each reply cites its passages, as an answer does.
 */
export function ChatPanel() {
  const w = useCurrentWorkspace();
  const chat = useChat(w.slug);
  const [openPassage, setOpenPassage] = useState<string | null>(null);
  const streaming = lastTurn(chat)?.status === 'streaming';

  return (
    <>
      {chat.turns.length > 0 && (
        <div className="flex flex-col gap-5">
          {chat.turns.map((turn, i) => (
            <TurnView
              key={i}
              turn={turn}
              onOpenPassage={setOpenPassage}
              // Retrying sends the question again, which would abort a reply still streaming.
              onRetry={streaming ? null : () => chat.send(turn.question)}
            />
          ))}
        </div>
      )}

      <ChatBox first={chat.turns.length === 0} streaming={streaming} onSend={chat.send} onStop={chat.stop}>
        {chat.conversationId !== null && (
          <>
            {/* The conversation outlives this page, so its id links to where it is kept. */}
            <Link
              to={`/w/${w.slug}/conversations?c=${encodeURIComponent(chat.conversationId)}`}
              data-testid="conversation-id"
              className="truncate font-mono hover:underline"
            >
              {chat.conversationId}
            </Link>
            <Button variant="ghost" size="sm" onClick={chat.reset} disabled={streaming}>
              <MessageSquarePlus /> New conversation
            </Button>
          </>
        )}
      </ChatBox>

      <PassageDialog slug={w.slug} passageId={openPassage} onClose={() => setOpenPassage(null)} />
    </>
  );
}
