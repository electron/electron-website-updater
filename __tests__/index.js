const fs = require('fs').promises;
const { join } = require('path');
const got = require('got').default.extend({
  throwHttpErrors: false,
});

const mockSHA = '123456';
const utils = require('../utils/utils');
utils.sendRepositoryDispatchEvent = jest.fn().mockResolvedValue('');
utils.getLatestInformation = jest.fn().mockResolvedValue({
  version: '12.0.6',
  branch: '12-x-y',
});
utils.getSHAFromTag = jest.fn().mockResolvedValue(mockSHA);

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
  });

  afterEach(() => {
    server.close();
    freePort(server.port);
  });

  it('responds to /', async () => {
    const response = await got.get(`http://localhost:${server.port}/`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(`There's nothing here!`);
  });

  it('returns a 404 if it does not exists', async () => {
    const response = await got.get(
      `http://localhost:${server.port}/do-not-exists`
    );

    expect(response.statusCode).toBe(404);
  });

  describe('push event', () => {
    it('does not send a "repository_dispatch" when a "push" does not contain doc changes', async () => {
      const payload = await getPayload('push');
      payload.commits = [];

      const response = await got.post(
        `http://localhost:${server.port}/webhook`,
        {
          headers: {
            'X-GitHub-Event': 'push',
          },
          json: payload,
          responseType: 'text',
        }
      );

      expect(response.statusCode).toBe(200);
      expect(utils.sendRepositoryDispatchEvent).toBeCalledTimes(0);
    });

    it('does not send a "repository_dispatch" when a "push" is for the non stable branch', async () => {
      const payload = await getPayload('push');
      payload.ref = 'refs/heads/1-x-y';

      const response = await got.post(
        `http://localhost:${server.port}/webhook`,
        {
          headers: {
            'X-GitHub-Event': 'push',
          },
          json: payload,
          responseType: 'text',
        }
      );

      expect(response.statusCode).toBe(200);
      expect(utils.sendRepositoryDispatchEvent).toBeCalledTimes(0);
    });

    it('sends a "repository_dispatch" when a "push" contains doc changes', async () => {
      const payload = await getPayload('push');

      const response = await got.post(
        `http://localhost:${server.port}/webhook`,
        {
          headers: {
            'X-GitHub-Event': 'push',
          },
          json: payload,
          responseType: 'text',
        }
      );

      expect(response.statusCode).toBe(200);
      expect(utils.sendRepositoryDispatchEvent).toBeCalledTimes(1);
    });
  });

  describe('release event', () => {
    it('it sends a "repository_dispatch" when a "release" is for a newer version', async () => {
      const payload = await getPayload('release');
      payload.release.tag_name = 'v12.0.7';

      const response = await got.post(
        `http://localhost:${server.port}/webhook`,
        {
          headers: {
            'X-GitHub-Event': 'release',
          },
          json: payload,
          responseType: 'text',
        }
      );

      expect(response.statusCode).toBe(200);
      expect(utils.sendRepositoryDispatchEvent).toBeCalledTimes(1);
      expect(utils.sendRepositoryDispatchEvent).toBeCalledWith(
        'electron',
        'electronjs.org-new',
        mockSHA
      );
    });

    it('it does not send a "repository_dispatch" when a "release" is for a pre-release', async () => {
      const payload = await getPayload('release');
      payload.release.prerelease = true;

      const response = await got.post(
        `http://localhost:${server.port}/webhook`,
        {
          headers: {
            'X-GitHub-Event': 'release',
          },
          json: payload,
          responseType: 'text',
        }
      );

      expect(response.statusCode).toBe(200);
      expect(utils.sendRepositoryDispatchEvent).toBeCalledTimes(0);
    });

    it('it does not send a "repository_dispatch" when a "release" is for a draft', async () => {
      const payload = await getPayload('release');
      payload.release.draft = true;

      const response = await got.post(
        `http://localhost:${server.port}/webhook`,
        {
          headers: {
            'X-GitHub-Event': 'release',
          },
          json: payload,
          responseType: 'text',
        }
      );

      expect(response.statusCode).toBe(200);
      expect(utils.sendRepositoryDispatchEvent).toBeCalledTimes(0);
    });

    it('it does not send a "repository_dispatch" when a "release" is for a nightly', async () => {
      const payload = await getPayload('release');
      payload.release.tag_name = 'v14.0.0-nightly.20210506';

      const response = await got.post(
        `http://localhost:${server.port}/webhook`,
        {
          headers: {
            'X-GitHub-Event': 'release',
          },
          json: payload,
          responseType: 'text',
        }
      );

      expect(response.statusCode).toBe(200);
      expect(utils.sendRepositoryDispatchEvent).toBeCalledTimes(0);
    });

    it('it does not send a "repository_dispatch" when a "release" is for a previous version', async () => {
      const payload = await getPayload('release');
      payload.release.tag_name = 'v11.10.0';

      const response = await got.post(
        `http://localhost:${server.port}/webhook`,
        {
          headers: {
            'X-GitHub-Event': 'release',
          },
          json: payload,
          responseType: 'text',
        }
      );

      expect(response.statusCode).toBe(200);
      expect(utils.sendRepositoryDispatchEvent).toBeCalledTimes(0);
    });
  });
});
