const express = require('express');
const cors = require('cors');
const { LexRuntimeV2 } = require('@aws-sdk/client-lex-runtime-v2');
const bodyParser = require('body-parser');
require('dotenv').config();  // To load environment variables from a .env file

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json());

const lexruntime = new LexRuntimeV2({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

app.post('/lex', async (req, res) => {
  const { text, sessionId } = req.body;

  const lexparams = {
    botAliasId: process.env.LEX_BOT_ALIAS_ID,
    botId: process.env.LEX_BOT_ID,
    localeId: 'en_US',
    text,
    sessionId,
  };

  try {
    const data = await lexruntime.recognizeText(lexparams);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
