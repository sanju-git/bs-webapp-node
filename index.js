const express = require('express');
const cors = require('cors');
const { LexRuntimeV2, LexRuntimeV2Client, RecognizeUtteranceCommand } = require('@aws-sdk/client-lex-runtime-v2');
const multer = require('multer');
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');
require('dotenv').config(); // To load environment variables from a .env file
const AWS = require('aws-sdk');
const transcribe = new AWS.TranscribeService();


const app = express();
const port = process.env.PORT || 8080;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

app.use(cors());
const upload = multer(); // No need to specify destination as we don't save files

const lexruntime = new LexRuntimeV2Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const audioBuffer = req.file.buffer;

  const params = {
    LanguageCode: 'en-US',
    Media: {
      MediaFileUri: 'data:audio/wav;base64,' + audioBuffer.toString('base64')
    },
    MediaFormat: 'wav',
    TranscriptionJobName:'sanjeev-bsc-audio-text'
  };

  try {
    const data = await transcribe.startTranscriptionJob(params).promise();
    const jobId = data.TranscriptionJob.TranscriptionJobName;

    // Polling until transcription job is completed
    const interval = setInterval(async () => {
      const { TranscriptionJob } = await transcribe.getTranscriptionJob({ TranscriptionJobName: jobId }).promise();
      if (TranscriptionJob.TranscriptionJobStatus === 'COMPLETED') {
        clearInterval(interval);
        const transcriptUri = TranscriptionJob.Transcript.TranscriptFileUri;
        const transcript = await (await fetch(transcriptUri)).json();
        const text = transcript.results.transcripts[0].transcript;

        // Now you have the text transcript, you can send it to Lex
        const lexParams = {
          botAliasId: process.env.LEX_BOT_ALIAS_ID,
          botId: process.env.LEX_BOT_ID,
          localeId: 'en_US',
          sessionId: req.body.sessionId,
          text: text
        };

        // Send text prompt to Lex
        const lexResponse = await lexruntime.recognizeText(lexParams).promise();

        res.json(lexResponse);
      }
    }, 5000); // Polling every 5 seconds
  } catch (error) {
    console.error('Error processing audio:', error);
    res.status(500).json({ error: error.message });
  }
});


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
