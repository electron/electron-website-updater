//@ts-check

const semver = require('semver');

const {
  getLatestInformation,
  verifyIntegrity,
  sendRepositoryDispatchEvent,
  getSHAFromTag,
} = require('../utils/utils');

const OWNER = process.env.OWNER || 'electron';
const SOURCE_REPO = `electron`;
const TARGET_REPO = `electronjs.org-new`;

/**
 * Verifies there is at least one file added, modified, or removed
 * in the given `folder` through all the commits associated in the
 * push.
 * @param {import('@octokit/webhooks-types').PushEvent} pushEvent
 * @param {string} folder
 */
const areFilesInFolderChanged = (pushEvent, folder) => {
  const isInPath = (file) => {
    return file.includes(folder);
  };

  const { commits } = pushEvent;

  return commits.some((commit) => {
    return (
      commit.modified.some(isInPath) ||
      commit.added.some(isInPath) ||
      commit.removed.some(isInPath)
    );
  });
};

/**
 * Handler for the GitHub webhook `push` event.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const pushHandler = async (req, res) => {
  const { branch } = await getLatestInformation();
  const ref = `refs/heads/${branch}`;

  /** @type {import('@octokit/webhooks-types').PushEvent} */
  const payload = req.body;

  if (
    payload.ref === ref &&
    payload.repository.full_name === `${OWNER}/${SOURCE_REPO}` &&
    areFilesInFolderChanged(payload, 'docs')
  ) {
    await sendRepositoryDispatchEvent(OWNER, TARGET_REPO, payload.after);
  }

  return res.status(200).send();
};

/**
 * Handler for the GitHub webhook `release` event.
 * The payload will be processed only if the release
 * payload is for the stable branch.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const releaseHandler = async (req, res) => {
  console.log(`New release payload received`);
  /** @type {import('@octokit/webhooks-types').ReleaseEvent} */
  const payload = req.body;

  const { version } = await getLatestInformation();

  // Tags can be v14.0.0-nightly.20210504, v13.0.0-beta.21, v10.4.5, etc.
  // We only want to process the stable ones, i.e.: v10.4.5
  // so we remove the initial `v` and we "clean it". If the cleaned
  // string is the same as before, then it's a stable release.
  // We also check that the new release is greater or equal than the
  // published npm version. There can be 30-120s delay between a GitHub
  // release and an npm one.
  const tag = payload.release.tag_name.replace(/^v/, '');
  const isStable = semver.coerce(tag).version === tag;

  console.log(`Version received: ${tag}`);
  console.log(`Latest version:   ${version}`);

  if (
    payload.action === 'released' &&
    !payload.release.draft &&
    !payload.release.prerelease &&
    isStable &&
    semver.gte(tag, version)
  ) {
    const sha = await getSHAFromTag(
      payload.repository.full_name,
      payload.release.tag_name
    );

    await sendRepositoryDispatchEvent(OWNER, TARGET_REPO, sha);
  }
  return res.status(200).send();
};
/**
 * Event handler router.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const eventHandler = (req, res, next) => {
  switch (req.header('X-GitHub-Event')) {
    case 'ping':
      res.status(200).send();
      break;
    case 'push':
      pushHandler(req, res);
      break;
    case 'release':
      releaseHandler(req, res);
      break;
    default:
      next();
  }

  return;
};

/**
 * Adds the right handles for the `push` and `release`
 * webhooks to the given `app`.
 * @param {import('express').Application} app
 */
const addWebhooks = async (app) => {
  app.post('/webhook', verifyIntegrity, eventHandler);
};

module.exports = {
  addWebhooks,
};
