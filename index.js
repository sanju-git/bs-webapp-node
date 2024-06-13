const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const aws = require('aws-sdk');
const multer = require('multer');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');
const { LexRuntimeV2, RecognizeUtteranceCommand } = require('@aws-sdk/client-lex-runtime-v2');
require('dotenv').config();
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const base64 = require('base-64');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Set up AWS SDK
aws.config.update({
  region: 'us-west-2', // Update to your region
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Create LexRuntimeV2 client
const lexruntime = new LexRuntimeV2({ region: 'us-east-1' }); // Update to your region

// Set up multer for handling file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }
  let audioFilePath = req.file.path;

  try {
    let audioInfo = getAudioInfo(audioFilePath);

    // If the audio file is not in the correct format, convert it
    if (!audioInfo || audioInfo.sampleRate !== 16000 || audioInfo.channels !== 1) {
      console.log('Converting audio file to 16kHz mono...');
      const convertedFileName = `converted-${Date.now()}.wav`;
      const convertedFilePath = path.join('uploads', convertedFileName);

      await convertToWav(audioFilePath, convertedFilePath);

      audioInfo = getAudioInfo(convertedFilePath);

      if (audioInfo.sampleRate !== 16000 || audioInfo.channels !== 1) {
        return res.status(400).send('Error converting audio file to 16000 Hz mono.');
      }

      audioFilePath = convertedFilePath;
    }

    // Read the audio file from the saved file in the uploads folder
    const audioBuffer = fs.readFileSync(audioFilePath);

    // Compress the sessionState and requestAttributes if needed
    const sessionState = req.body.sessionState ?
      compressAndEncodeBase64(req.body.sessionState) :
      compressAndEncodeBase64({ dialogAction: { type: "ElicitIntent" } });

    const requestAttributes = req.body.requestAttributes ?
      compressAndEncodeBase64(req.body.requestAttributes) :
      compressAndEncodeBase64({});

    const params = {
      botAliasId: process.env.LEX_BOT_ALIAS_ID,
      botId: process.env.LEX_BOT_ID,
      localeId: 'en_US',
      sessionId: 136344,
      requestContentType: 'audio/l16; rate=16000; channels=1',
      responseContentType: 'audio/mpeg',
      inputStream: audioBuffer,
      sessionState: sessionState,
      requestAttributes: requestAttributes,
    };

    const command = new RecognizeUtteranceCommand(params);
    const data = await lexruntime.send(command);

    // Decode and decompress fields
    const inputTranscript = decodeAndDecompress(data.inputTranscript);
    const interpretations = decodeAndDecompress(data.interpretations);
    const messages = decodeAndDecompress(data.messages);
    const sessionStateResponse = decodeAndDecompress(data.sessionState);
    const requestAttributesResponse = decodeAndDecompress(data.requestAttributes);

    // Send the audio stream as a base64 string
    const responseAudio = Buffer.from(await streamToBuffer(data.audioStream)).toString('base64');

    res.json({
      audio: responseAudio,
      inputTranscript: inputTranscript,
      interpretations: interpretations,
      messages: messages,
      sessionState: sessionStateResponse,
      requestAttributes: requestAttributesResponse,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error processing audio');
  } finally {
    // Cleanup: Remove the uploaded file
    fs.unlinkSync(audioFilePath);
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

// Helper functions
function compressAndEncodeBase64(object) {
  const jsonString = JSON.stringify(object);
  const compressed = zlib.gzipSync(jsonString);
  return compressed.toString('base64');
}

function decodeAndDecompress(encoded) {
  const buffer = Buffer.from(encoded, 'base64');
  const decompressed = zlib.gunzipSync(buffer);
  return JSON.parse(decompressed.toString());
}

function getAudioInfo(audioFilePath) {
  try {
    // Read the file as an array buffer
    const audioBuffer = fs.readFileSync(audioFilePath);

    // Check if it's a valid WAV file (first 4 bytes should be "RIFF")
    if (audioBuffer.toString('utf8', 0, 4) !== 'RIFF') {
      return null;
    }

    // Get sample rate and channels from header data (assuming WAV format)
    const sampleRate = audioBuffer.readUInt32LE(24);
    const channels = audioBuffer.readUInt16LE(22);

    return {
      sampleRate,
      channels,
    };
  } catch (err) {
    console.error('Error getting audio info:', err);
    return null;
  }
}

function convertToWav(inputFilePath, outputFilePath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputFilePath)
      .output(outputFilePath)
      .audioChannels(1)
      .audioFrequency(16000)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
