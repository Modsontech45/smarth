import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import Groq from 'groq-sdk';

const router = Router();
const upload = multer({ dest: os.tmpdir() });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post('/', upload.single('audio'), async (req: Request, res: Response) => {
  const file = (req as any).file;
  if (!file) return void res.status(400).json({ error: 'No audio file provided' });

  // Groq requires a file extension to detect MIME type — rename temp file to .wav
  const wavPath = file.path + '.wav';
  fs.renameSync(file.path, wavPath);

  try {
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(wavPath),
      model: 'whisper-large-v3-turbo',
      language: 'fr',
      response_format: 'json',
    });
    res.json({ text: transcription.text.trim() });
  } catch (err: any) {
    console.error('[Transcribe] Groq error:', err.message);
    res.status(500).json({ error: 'Transcription failed' });
  } finally {
    fs.unlink(wavPath, () => {});
  }
});

export default router;
