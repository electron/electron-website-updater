const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { afterEach, beforeEach, describe, mock, it } = require('node:test');

const utils = require('../utils/utils');
utils.sendRepositoryDispatchEvent = mock.fn(() => Promise.resolve(''));
utils.getLatestInformation = mock.fn(() =>
  Promise.resolve({
    version: '12.0.6',
    branch: '12-x-y',
  }),
);

const { start } = require('../index');

const fixtures = {
  push: join(__dirname, 'fixtures', 'push.json'),
  release: join(__dirname, 'fixtures', 'release.json'),
};

/**
 * Returns a fresh payload
 * @param {'push'|'release'} name
 */
const getPayload = async (name) => {
  const content = await fs.readFile(fixtures[name], 'utf-8');
  return JSON.parse(content);
};

const ports = new Set();
const getPort = () => {
  let port = Math.ceil(Math.random() * 65536);

  if (ports.has(port) || port < 3000) {
    port = getPort();
  }
  ports.add(port);

  return port;
};

const freePort = (port) => {
  ports.delete(port);
};

describe('webhook server', () => {
  let server;

  beforeEach(async () => {
    const port = getPort();
    server = await start(port);
    utils.sendRepositoryDispatchEvent.mock.resetCalls();
    utils.getLatestInformation.mock.resetCalls();
  });

  afterEach(() => {
    server.close();
    freePort(server.port);
  });

  it.only('responds to /', async () => {
    const response = await fetch(`http://localhost:${server.port}/`);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), `There's nothing here!`);
  });

  it('returns a 404 if it does not exists', async () => {
    const response = await fetch(
      `http://localhost:${server.port}/do-not-exists`,
    );

    assert.strictEqual(response.status, 404);
  });

  describe('push event', () => {
    it('does not send a "repository_dispatch" when a "push" does not contain doc changes', async () => {
      const payload = await getPayload('push');
      payload.commits = [];

      const response = await fetch(`http://localhost:${server.port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
        },
        body: JSON.stringify(payload),
      });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(utils.sendRepositoryDispatchEvent.mock.callCount(), 0);
    });

    it('does send a "repository_dispatch" when a "push" is for the non stable branch with "doc_changes_branches"', async () => {
      const payload = await getPayload('push');
      payload.ref = 'refs/heads/1-x-y';

      const response = await fetch(`http://localhost:${server.port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
        },
        body: JSON.stringify(payload),
      });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(utils.sendRepositoryDispatchEvent.mock.callCount(), 1);
      assert.deepStrictEqual(
        utils.sendRepositoryDispatchEvent.mock.calls[0].arguments,
        [
          'electron',
          'website',
          'doc_changes_branches',
          { branch: '1-x-y', sha: 'd07ca4f716c62d6f4a481a74b54b448b95bbe3d9' },
        ],
      );
    });

    it('sends 2 "repository_dispatch" when a "push" contains doc changes in the current branch with "doc_changes" and "doc_changes_branches"', async () => {
      const payload = await getPayload('push');

      const response = await fetch(`http://localhost:${server.port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
        },
        body: JSON.stringify(payload),
      });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(utils.sendRepositoryDispatchEvent.mock.callCount(), 2);
      assert.deepStrictEqual(
        utils.sendRepositoryDispatchEvent.mock.calls[1].arguments,
        [
          'electron',
          'website',
          'doc_changes',
          { branch: '12-x-y', sha: 'd07ca4f716c62d6f4a481a74b54b448b95bbe3d9' },
        ],
      );

      assert.deepStrictEqual(
        utils.sendRepositoryDispatchEvent.mock.calls[0].arguments,
        [
          'electron',
          'website',
          'doc_changes_branches',
          { branch: '12-x-y', sha: 'd07ca4f716c62d6f4a481a74b54b448b95bbe3d9' },
        ],
      );
    });

    it('does not send a "repository_dispatch" if "push" is for an unreleased version', async () => {
      // Latest stable is 12 and here the event is for 13
      const payload = await getPayload('push');
      payload.ref = 'refs/heads/13-x-y';

      const response = await fetch(`http://localhost:${server.port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
        },
        body: JSON.stringify(payload),
      });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(utils.sendRepositoryDispatchEvent.mock.callCount(), 0);
    });

    it('does not send a "repository_dispatch" if "push" is for a trop branch targetting a release version', async () => {
      // Latest stable is 12 and here the event is for 13
      const payload = await getPayload('push');
      payload.ref =
        'refs/heads/trop/12-x-y-bp-docs-win-getparentwindow-returns-browserwindow-null--1635174659170';

      const response = await fetch(`http://localhost:${server.port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
        },
        body: JSON.stringify(payload),
      });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(utils.sendRepositoryDispatchEvent.mock.callCount(), 0);
    });
  });
});
