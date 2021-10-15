const { graphql } = require('@octokit/graphql');
const { verify } = require('@octokit/webhooks-methods');
const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');
const { compare } = require('semver');

const {
  GITHUB_TOKEN,
  WEBHOOK_SECRET,
  APP_ID,
  CLIENT_PRIVATE_KEY,
  INSTALLATION_ID,
  CLIENT_ID,
  CLIENT_SECRET,
} = process.env;

/**
 * @param {NodeResult} release
 */
const getVersion = (release) => {
  /**
   * Electron releases urls have a well-known format. E.g.:
   * https://github.com/electron/electron/releases/tag/v14.0.0-beta.2
   * We only need the latest part (i.e. `14.0.0-beta.2`)
   */
  return release.url.split('/v').pop();
};

/**
 * Transforms a NodeResult into a Release
 * @param {NodeResult[]} releases
 */
const toReleases = (releases) => {
  const stables = releases.filter((release) => !release.isPrerelease);

  const versions = stables.map((release) => {
    return getVersion(release);
  });

  return versions;
};

const getReleases = async () => {
  const query = `
{
  repository(owner: "electron", name: "electron") {
    refs(refPrefix: "refs/tags/", first: 1) {
      nodes {
        repository {
          releases(first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
            nodes {
              name
              url
              isPrerelease
            }
          }
        }
      }
    }
  }
}`;

  const graphqlWithAuth = await getAuthenticatedGraphql();
  const queryResults = await graphqlWithAuth(query);

  const releases = toReleases(
    queryResults.repository.refs.nodes[0].repository.releases.nodes
  );

  return releases.sort(compare);
};

const getLatestInformation = async () => {
  const releases = await getReleases();
  const latestVersion = releases.pop();
  const branch = latestVersion.replace(/\.\d+\.\d+$/, '-x-y');

  return {
    version: latestVersion,
    branch,
  };
};

/**
 * Middleware to verify the integrity of a GitHub webhook
 * using the `X-Hub-Signature` and `@octokit/webhook-methods/verify`
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const verifyIntegrity = async (req, res, next) => {
  if (!WEBHOOK_SECRET) {
    console.log('No secret specified, skipping integrity check');
    return next();
  }
  const signature = req.header('X-Hub-Signature-256');

  if (!signature) {
    console.error(`Missing signature in payload`);
    return res.status(400).send(`Missing signature in payload`);
  }

  const valid = await verify(WEBHOOK_SECRET, req.body, signature);

  if (valid) {
    return next();
  } else {
    console.error(`Invalid signature`);
    return res.status(400).send(`Invalid signature`);
  }
};

/**
 * Validates that all required values to create a GitHub App
 * are available
 */
const appInfoAvailable = () => {
  return (
    !!APP_ID &&
    !!CLIENT_PRIVATE_KEY &&
    !!INSTALLATION_ID &&
    !!CLIENT_ID &&
    !!CLIENT_SECRET
  );
};

let _authorization;

/**
 * Creates the right auth strategy based on the
 * available environment variables:
 * * `GITHUB_TOKEN`: Token Auth
 * * `APP_ID`: App Auth
 */
const getAuthorization = () => {
  if (_authorization) {
    return _authorization;
  } else if (appInfoAvailable()) {
    console.log(`Authenticating using GitHub app`);
    _authorization = {
      authStrategy: createAppAuth,
      auth: {
        appId: APP_ID,
        privateKey: JSON.parse(CLIENT_PRIVATE_KEY),
        installationId: INSTALLATION_ID,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      },
    };

    return _authorization;
  } else if (GITHUB_TOKEN) {
    console.log(`Authenticating using token`);
    _authorization = {
      auth: GITHUB_TOKEN,
    };

    return _authorization;
  }

  throw new Error(`Could not identify the right auth strategy`);
};

/**
 * Sends a `repository_dispatch` event top the given repo `target`
 * with the given type and payload.
 * @param {string} owner The owner of the repo to send the event to
 * @param {string} repo The repo to send the event to
 * @param {string} eventType The type of event_dispatch to use
 * @param {object} payload The event's payload
 */
const sendRepositoryDispatchEvent = async (owner, repo, eventType, payload) => {
  const octokit = new Octokit(getAuthorization());

  console.log(`Sending payload (${eventType}):
${JSON.stringify(payload, null, 2)}`);

  try {
    await octokit.repos.createDispatchEvent({
      owner,
      repo,
      event_type: eventType,
      client_payload: payload,
    });

    console.log(`Payload sent`);
  } catch (e) {
    console.error(`Error sending repository_dispatch`);
    console.error(e);
  }
};

const getAuthenticatedGraphql = async () => {
  const authorization = getAuthorization();

  if (typeof authorization.auth !== 'string') {
    const auth = authorization.authStrategy(authorization.auth);
    const authedGraphql = graphql.defaults({ request: { hook: auth.hook } });

    return authedGraphql;
  } else {
    const authedGraphql = graphql.defaults({
      headers: {
        authorization: `token ${authorization.auth}`,
      },
    });

    return authedGraphql;
  }
};

module.exports = {
  getLatestInformation,
  sendRepositoryDispatchEvent,
  verifyIntegrity,
};
