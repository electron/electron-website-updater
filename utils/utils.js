const latestVersion = require('latest-version');
const { graphql } = require('@octokit/graphql');
const { verify } = require('@octokit/webhooks-methods');
const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');

const DOC_CHANGES_TYPE = 'doc_changes';
const {
  GITHUB_TOKEN,
  WEBHOOK_SECRET,
  APP_ID,
  CLIENT_PRIVATE_KEY,
  INSTALLATION_ID,
  CLIENT_ID,
  CLIENT_SECRET,
} = process.env;

const getLatestInformation = async () => {
  const version = await latestVersion('electron');
  const branch = version.replace(/\.\d+\.\d+$/, '-x-y');

  return {
    version,
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
 * with the type `doc_changes` and the given commit `sha` as part
 * of the payload.
 * @param {string} owner The owner of the repo to send the event to
 * @param {string} repo The repo to send the event to
 * @param {string} sha The commit's SHA
 */
const sendRepositoryDispatchEvent = async (owner, repo, sha) => {
  const octokit = new Octokit(getAuthorization());

  console.log(`Sending payload with SHA "${sha}"`);

  try {
    await octokit.repos.createDispatchEvent({
      owner,
      repo,
      event_type: DOC_CHANGES_TYPE,
      client_payload: {
        sha,
      },
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

/**
 * For a given `tagName`, returns the associated SHA.
 *
 * @param {string} repository The repository in the form of `owner/name`
 * @param {string} tagName
 * @returns {Promise<string>}
 */
const getSHAFromTag = async (repository, tagName) => {
  console.log(`Getting SHA for "${repository}" and "${tagName}"`);

  const [owner, repo] = repository.split('/');

  const parameters = {
    owner,
    repo,
    tagName,
  };

  const graphqlWithAuth = await getAuthenticatedGraphql();

  const {
    repository: {
      release: {
        tagCommit: { oid },
      },
    },
  } = await graphqlWithAuth(
    `
      query shaFromTag($owner: String!, $repo: String!, $tagName: String!) {
        repository(owner: $owner, name: $repo) {
          release(tagName: $tagName) {
            tagCommit {
              oid
            }
          }
        }
      }
    `,
    parameters
  );

  console.log(`SHA is ${oid}`);
  return oid;
};

module.exports = {
  getLatestInformation,
  getSHAFromTag,
  sendRepositoryDispatchEvent,
  verifyIntegrity,
};
