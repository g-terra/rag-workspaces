import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { portFree } from './ports.ts';

function openServer(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

describe('portFree', () => {
  it('returns true for a free loopback port', async () => {
    const server = await openServer();
    const { port } = server;
    await server.close();
    assert.equal(await portFree(port), true);
  });

  it('returns false when a listener already holds the port', async () => {
    const server = await openServer();
    try {
      assert.equal(await portFree(server.port), false);
    } finally {
      await server.close();
    }
  });

  it('probes on EACCES and returns true when nothing is listening', async () => {
    const server = await openServer();
    const { port } = server;
    await server.close();
    assert.equal(await portFree(port, { listen: async () => 'eacces' }), true);
  });

  it('probes on EACCES and returns false when a listener is accepting connections', async () => {
    const server = await openServer();
    try {
      assert.equal(await portFree(server.port, { listen: async () => 'eacces' }), false);
    } finally {
      await server.close();
    }
  });

  it('returns false without probing when listen reports the port is in use', async () => {
    let probed = false;
    const result = await portFree(80, {
      listen: async () => 'in-use',
      probe: async () => {
        probed = true;
        return true;
      },
    });
    assert.equal(result, false);
    assert.equal(probed, false);
  });
});
