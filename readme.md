# webhook

This project handles the webhooks from `electron/electron` and filters them
to dispatch only the appropriate ones as `repository_dispatch` events to
`electron/website` ("that repo").

These events are used to let that repo know there have been documentation changes.

This repo is subscribed to all `push` events in `electron/electron`. When
a payload comes it:

1. Checks if there have been changes to the `/docs` folder
1. Determines in what branch the commit has happend
1. Sends a `repository_dispatch` with the following information:
   * `sha`: the SHA of the commit received
   * `branch`: the branch of the commit, usually something like `15-x-y`
   * `event_type`:
     * `doc_changes` if the changes have happened in the major release
     * `doc_changes_previous` if the changes have happened in a previous major release

## Local setup

The local setup uses a Personal Access Token instead of a GitHub Application
to make the onboarding process faster.

### Getting Code Locally

In order to be capable of testing this project you will have to:

- Fork and clone locally `electron/electron`
- Fork and clone locally `electron/electron-website-updater`:

  ```console
  git clone https://github.com/OWNER/electron-website-updater
  cd electron-website-updater
  yarn
  ```

### Configuring the webhooks

You will have to add a webhook to your fork of `electron/electron` and deliver
the payload to your local machine. To do that follow this steps:

1. Go to [smee.io](https://smee.io/) and click **Start a new channel**.
   You will be redirected to a new URL, this will be the webhook URL later on.
1. Create a `.env` under `webhook/` with the contents of `webhook/.env.example`
1. Create a new webhook in your `electron/electron` fork in
   https://github.com/OWNER/electron/settings/hooks/new
   - **Payload URL**: The URL from the first step.
   - **Content type**: `application/json`
   - **Secret**: `development`
1. Create a new Personal Access Token (PAT) [here][pat] with the `repo` scope and
   write it down.
1. Use `webhook/.env.example` as the source to create `webhook/.env` file with the
   following values:

   ```
   APP_ID=
   CLIENT_ID=
   CLIENT_SECRET=
   CLIENT_PRIVATE_KEY=
   INSTALLATION_ID=
   GITHUB_TOKEN=%THE_PAT_CREATED_PREVIOUSLY%
   WEBHOOK_SECRET=development
   OWNER=%OWNER%
   ```

   The values that are empty are used only when using a GitHub App instead of a PAT.

### Creating a GitHub App

This step is only necessary if you prefer this authentication approach over the PAT.
Go [here to create a new GitHub App][github app] and use the following data (if something is not
mentioned, you can leave the defaults):

- GitHub App name: Electron Website Updater
- Homepage URL: https://github.com/OWNER/website
- Webhook: deactivated
- Repository permissions:
  - Contents - Read & write
- Subscribe to events: None, we will configure the payload manually
- Where can this GitHub App be installed? Only in this account

Write down the following information:

- App ID
- Client ID
- Client secret: You might need to generate a new one
- Private key: You might need to generate a new one. The private key will be downloaded to your machine,
  open it and `JSON.stringify` the contents.

You will have to install the application now in your org and obtain the installation id. To do
so you can use the following snippet (and install the required depdendencies):

```js
const { createAppAuth } = require('@octokit/auth-app');
const { Octokit } = require('@octokit/rest');

const start = async () => {
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.APP_ID,
      privateKey: JSON.parse(process.env.CLIENT_PRIVATE_KEY),
      // installationId: process.env.INSTALLATION_ID,
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
    },
  });

  const { data } = await appOctokit.request('/app/installations');

  // If you've only installed it once, this should be the one
  const installationId = data[0].app_id;

  console.log(installationId);
};

start();
```

Create then a `webhook/.env` file with the following values:

```
APP_ID=%APP_ID%
CLIENT_ID=%CLIENT_ID%
CLIENT_SECRET=%CLIENT_SECRET%
CLIENT_PRIVATE_KEY=%STRINGIFY_PRIVATE_KEY%
INSTALLATION_ID=%INSTALLATION_ID%
GITHUB_TOKEN=
WEBHOOK_SECRET=development
OWNER=%OWNER%
```

The value of `CLIENT_PRIVATE_KEY` should look similar to (pay attention to the initial `'"`):

```
'"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"'
```

### Running the code locally

To run the code locally you need to launch 2 processes:

- the `smee` process with the right URL you got earlier
- the webhook server process

The easiest way to do this is to use VS Code (opening at the root of this repo, not `/webhook`)
and select the task `webhook local debugging`.

![vs code debugging targets](./img/webhook-local-debugging.png)

Once you run this task (select and press F5), you will be prompted with the smee URL.
Paste it and it will start the smee tunnel and the local server listening on the port 3000.

![VS Code prompt for the smee url](./img/smee-url-prompt.png)

If you prefer to do this manually you will have to open 2 terminals and run the following
from the `/webhook` folder:

1. `yarn smee --target THE_SMEE_WEBHOOK_URL`
2. `node index.js`

### Testing the webhooks locally

Once you have done all of the above, your local server should receive payloads for the
following scenarios:

* `push`: Push any change to the right branch of `electron/electron`
* `release`: From the releases page of your `electron/electron` fork
  (https://github.com/OWNER/electron/releases), create a new release

## Running the tests

Tests for `/webhook` are written using [Jest][jest], and run from the root of the repo:

```console
yarn test
```

Test files should be close to the files they are testing under a folder `__tests__`.

[pat]: https://github.com/settings/tokens
[jest]: https://jestjs.io/
[github app]: https://github.com/settings/apps/new
