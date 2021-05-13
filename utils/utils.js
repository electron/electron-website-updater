const latestVersion = require('latest-version');
const { graphql } = require('@octokit/graphql');
const { verify } = require('@octokit/webhooks-methods');
const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');

const SECRET = process.env.WEBHOOK_SECRET;
const DOC_CHANGES_TYPE = 'doc_changes';

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
  if (!SECRET) {
    console.log('No secret specified, skipping integrity check');
    return next();
  }
  const signature = req.header('X-Hub-Signature-256');

  if (!signature) {
    console.error(`Missing signature in payload`);
    return res.status(400).send(`Missing signature in payload`);
  }

  const valid = await verify(SECRET, req.body, signature);

  if (valid) {
    return next();
  } else {
    console.error(`Invalid signature`);
    return res.status(400).send(`Invalid signature`);
  }
};

/**
 * Returns an authenticated `Octokit` object.
 * It will be as a user if `GITHUB_TOKEN` is available
 * or an installation otherwise.
 *
 * @returns {Octokit}
 */
const getOctokit = () => {
  if (process.env.GITHUB_TOKEN) {
    const user = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });
  } else {
    const app = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: process.env.APP_ID,
        privateKey: JSON.parse(process.env.CLIENT_PRIVATE_KEY),
        installationId: process.env.INSTALLATION_ID,
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
      },
    });

    return app;
  }
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
  const octokit = getOctokit();

  return await octokit.repos.createDispatchEvent({
    owner,
    repo,
    event_type: DOC_CHANGES_TYPE,
    client_payload: {
      sha,
    },
  });
};

/**
 * For a given `tagName`, returns the associated SHA.
 *
 * @param {string} repository The repository in the form of `owner/name`
 * @param {string} tagName
 * @returns {Promise<string>}
 */
const getSHAFromTag = async (repository, tagName) => {
  const [owner, repo] = repository.split('/');

  const parameters = {
    owner,
    repo,
    tagName,
    headers: {
      authorization: `token ${GITHUB_TOKEN}`,
    },
  };

  const {
    repository: {
      release: {
        tagCommit: { oid },
      },
    },
  } = await graphql(
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

  return oid;
};

module.exports = {
  getLatestInformation,
  getSHAFromTag,
  sendRepositoryDispatchEvent,
  verifyIntegrity,
};
