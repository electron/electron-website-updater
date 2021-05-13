//@ts-check
if (!(process.env.CI || process.env.NODE_ENV === 'test')) {
  require('dotenv-safe').config();
}

const express = require('express');
const bodyParser = require('body-parser');

const { addWebhooks } = require('./routes/webhook');

const start = async (port) => {
  return new Promise(async (resolve) => {
    const app = express();

    app.use(bodyParser.json());

    await addWebhooks(app);

    app.get('/', (req, res) => {
      res.send(`There's nothing here!`);
    });

    const server = app.listen(port, () => {
      console.log(`API listening on port ${port}`);
      server.port = port;
      resolve(server);
    });
  });
};

// When a file is run directly from Node.js, `require.main` is set to its module.
// That means that it is possible to determine whether a file has been run directly
// by testing `require.main === module`.
// https://nodejs.org/docs/latest/api/modules.html#modules_accessing_the_main_module
if (require.main === module) {
  const port = process.env.PORT || 3000;

  start(port);
}

module.exports = {
  start,
};
