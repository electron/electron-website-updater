//@ts-check

const semver = require('semver');

const {
  getLatestInformation,
  verifyIntegrity,
  sendRepositoryDispatchEvent,
} = require('../utils/utils');

const OWNER = process.env.OWNER || 'electron';
const SOURCE_REPO = `electron`;
const TARGET_REPO = `website`;
const EVENT_TYPE = {
  CURRENT: 'doc_changes',
  BRANCHES: 'doc_changes_branches',
};

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
 * Returns the major part of a branch format (`xx-y-z`)
 * @param {string} version
 */
const getMajor = (version) => {
  const majorRegex = /(?:refs\/heads\/)?(\d+)-x-y/;
  const [, major] = majorRegex.exec(version);

  return parseInt(major);
};

/**
 * Compares 2 refs or branches and returns a boolean indicating
 * if `current` is from a previous release than `latest`.
 * @param {string} latest
 * @param {string} current
 */
const isLatest = (latest, current) => {
  try {
    const latestMajor = getMajor(latest);
    const currentMajor = getMajor(current);

    if (currentMajor < latestMajor) {
      return false;
    } else {
      return true;
    }
  } catch (e) {
    return false;
  }
};

/**
 * @returns {boolean}
 */
const shouldSendEvent = (stableBranch, payload) => {
  const branchCommit = payload.ref.replace('refs/heads/', '');
  // Event is coming from the right source
  if (payload.repository.full_name !== `${OWNER}/${SOURCE_REPO}`) {
    return false;
  }

  // The event comes from a stable branch (`vXX-x-y`)
  if (!/^\d\d?-x-y/.test(branchCommit)) {
    return false;
  }

  // Docs have been modified in the commit
  if (!areFilesInFolderChanged(payload, 'docs')) {
    return false;
  }

  // We do not want to process commits from future stables
  if (getMajor(branchCommit) > getMajor(stableBranch)) {
    return false;
  }

  return true;
};

/**
 * Handler for the GitHub webhook `push` event.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const pushHandler = async (req, res) => {
  const { branch } = await getLatestInformation();

  /** @type {import('@octokit/webhooks-types').PushEvent} */
  const payload = req.body;

  if (shouldSendEvent(branch, payload)) {
    const latest = isLatest(branch, payload.ref);

    // Send an event that will update the docs in `vXX-Y-Z`
    await sendRepositoryDispatchEvent(OWNER, TARGET_REPO, EVENT_TYPE.BRANCHES, {
      sha: payload.after,
      branch: payload.ref.replace('refs/heads/', ''),
    });

    // Send an event that will update the docs in `main` if changes are for latest
    if (latest) {
      await sendRepositoryDispatchEvent(
        OWNER,
        TARGET_REPO,
        EVENT_TYPE.CURRENT,
        {
          sha: payload.after,
          branch: payload.ref.replace('refs/heads/', ''),
        },
      );
    }
  }

  return res.status(200).send();
};

/**
 * Handler for the GitHub webhook `release` event.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const releaseHandler = async (req, res) => {
  // We keep this handler for historic reasons but all updates are done via the push event

  console.log(`New release payload received`);

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
