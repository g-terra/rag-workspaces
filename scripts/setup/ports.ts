import { createConnection, createServer } from 'node:net';

type ListenOutcome = 'free' | 'in-use' | 'eacces';

function tryListen(port: number): Promise<ListenOutcome> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      resolve(err.code === 'EACCES' ? 'eacces' : 'in-use');
    });
    server.listen(port, '127.0.0.1', () => server.close(() => resolve('free')));
  });
}

function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (free: boolean) => {
      socket.destroy();
      resolve(free);
    };
    socket.setTimeout(500);
    socket.once('connect', () => done(false));
    socket.once('timeout', () => done(false));
    socket.once('error', (err: NodeJS.ErrnoException) => done(err.code === 'ECONNREFUSED'));
  });
}

/**
 * Whether `127.0.0.1:<port>` is free for Docker Compose to publish.
 *
 * Tries to bind the port first. Binding a privileged port (< 1024, such as `PROXY_PORT=80`) from
 * a non-root Node process fails with `EACCES` even when nothing is listening and Docker can bind
 * it; in that case, fall back to a TCP connect probe where `ECONNREFUSED` proves the port is free.
 */
export async function portFree(
  port: number,
  options: {
    listen?: (port: number) => Promise<ListenOutcome>;
    probe?: (port: number) => Promise<boolean>;
  } = {},
): Promise<boolean> {
  const outcome = await (options.listen ?? tryListen)(port);
  if (outcome === 'free') return true;
  if (outcome === 'eacces') return (options.probe ?? probePort)(port);
  return false;
}
