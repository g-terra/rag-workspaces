import type { ResponseStyle } from '@rag/shared';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/auth-context';
import { DeleteStyleDialog, StyleDialog } from '@/components/style-dialogs';
import { ErrorState, Loading, Notice } from '@/components/states';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { useStyles } from '@/styles/queries';

/**
 * `/styles`: the response styles every workspace can use. The built-in ones are read-only; admins create,
 * edit and delete custom ones, as the API allows.
 */
export function Styles() {
  const { me } = useAuth();
  const styles = useStyles();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ResponseStyle | null>(null);
  const [deleting, setDeleting] = useState<ResponseStyle | null>(null);

  if (!me) {
    return (
      <>
        <TopBar trail={['Response styles']} />
        <Loading what="your account" />
      </>
    );
  }
  if (!me.isAdmin) {
    return (
      <>
        <TopBar trail={['Response styles']} />
        <div className="px-6 py-7">
          <Notice
            title="Admins only"
            body="Response styles are shared by every workspace, so only administrators manage them. You can pick one in the playground."
            alert
          />
        </div>
      </>
    );
  }

  const builtIn = styles.data?.filter((s) => s.builtIn) ?? [];
  const custom = styles.data?.filter((s) => !s.builtIn) ?? [];
  const taken = styles.data?.map((s) => s.slug) ?? [];

  return (
    <>
      <TopBar trail={['Admin', 'Response styles']}>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> New style
        </Button>
      </TopBar>
      <div className="flex w-full max-w-290 flex-col gap-6 px-6 pt-7 pb-12">
        <div>
          <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">Response styles</h1>
          <p className="text-muted-foreground text-sm">
            How answers read: tone, length and format. A style is added after a workspace's system prompt and
            never replaces its rules, so answers still cite the material and refuse what it doesn't cover.
            Pick one per question in the playground or the API, or set a workspace's default in its settings.
          </p>
        </div>

        {styles.isPending && <Loading what="response styles" />}
        {styles.isError && (
          <ErrorState
            title="Couldn't load response styles"
            error={styles.error}
            onRetry={() => void styles.refetch()}
          />
        )}

        {styles.data && (
          <>
            <StyleList title="Custom" styles={custom} onEdit={setEditing} onDelete={setDeleting}>
              <Notice
                title="No custom styles yet"
                body="Write one for a tone the built-in styles don't cover."
              >
                <Button onClick={() => setCreating(true)}>
                  <Plus /> New style
                </Button>
              </Notice>
            </StyleList>
            <StyleList title="Built in" styles={builtIn} />
          </>
        )}
      </div>

      {creating && <StyleDialog taken={taken} onOpenChange={setCreating} />}
      {editing && <StyleDialog style={editing} taken={taken} onOpenChange={() => setEditing(null)} />}
      {deleting && <DeleteStyleDialog style={deleting} onOpenChange={() => setDeleting(null)} />}
    </>
  );
}

/** A section of styles, each with its instructions. Without `onEdit` they are read-only. */
function StyleList({
  title,
  styles,
  onEdit,
  onDelete,
  children,
}: {
  title: string;
  styles: ResponseStyle[];
  onEdit?(style: ResponseStyle): void;
  onDelete?(style: ResponseStyle): void;
  /** Shown when there are none. */
  children?: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {styles.length === 0 && children}
      {styles.map((s) => (
        <article
          key={s.slug}
          data-testid="style"
          className="bg-card flex flex-col gap-2 rounded-xl border p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-[15px] font-semibold">
                {s.name} <span className="text-muted-foreground font-mono text-xs font-normal">{s.slug}</span>
              </h3>
              {s.description && <p className="text-muted-foreground text-sm">{s.description}</p>}
            </div>
            {onEdit && onDelete && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => onEdit(s)}>
                  <Pencil /> Edit
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => onDelete(s)}>
                  <Trash2 /> Delete
                </Button>
              </div>
            )}
          </div>
          <p className="bg-muted/50 rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
            {s.instructions}
          </p>
        </article>
      ))}
    </section>
  );
}
