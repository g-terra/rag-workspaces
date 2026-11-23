import { MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { WORKSPACE_DEFAULT } from '@/styles/styles';
import { useCurrentWorkspace } from '@/workspaces/current';
import { lastTurn } from './chat';
import { ChatBox, TurnView } from './chat-view';
import { PassageDialog } from './passage-dialog';
import { StylePicker } from './style-picker';
import { useChat } from './use-chat';

/**
 * The playground's Chat mode: a conversation the API remembers, so a follow-up ("why?") is answered
 * with the earlier turns in view. Each reply cites its passages, as an answer does.
 */
export function ChatPanel() {
  const w = useCurrentWorkspace();
  const chat = useChat(w.slug);
  const [openPassage, setOpenPassage] = useState<string | null>(null);
  // Per message, so it can change mid-conversation; it applies to the next message sent.
  const [style, setStyle] = useState(WORKSPACE_DEFAULT);
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
              onRetry={streaming ? null : () => chat.send(turn.question, style)}
            />
          ))}
        </div>
      )}

      <ChatBox
        first={chat.turns.length === 0}
        streaming={streaming}
        onSend={(message) => chat.send(message, style)}
        onStop={chat.stop}
      >
        <StylePicker value={style} onChange={setStyle} />
        {chat.conversationId !== null && (
          <>
            {/* The conversation outlives this page, so this links to where it is kept. Its id is for
                the API, not for people, so it is only in an attribute the tests read. */}
            <Link
              to={`/w/${w.slug}/conversations?c=${encodeURIComponent(chat.conversationId)}`}
              data-testid="conversation-link"
              data-conversation-id={chat.conversationId}
              className="text-muted-foreground truncate hover:underline"
            >
              Saved in Conversations
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
