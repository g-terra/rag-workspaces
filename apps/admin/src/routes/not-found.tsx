import { Link } from 'react-router';

/** Any path the app doesn't know, for example an old link or a typo. */
export function NotFound() {
  return (
    <div className="w-full max-w-5xl space-y-3 px-6 py-7">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground text-sm">There's nothing at this address.</p>
      <Link className="text-sm underline" to="/">
        Go to the start page
      </Link>
    </div>
  );
}
