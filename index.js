const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const app = express();
const upload = multer({ dest: os.tmpdir() });

app.get('/', (req, res) => res.send('FFmpeg service is running'));

app.post('/process', upload.fields([
  { name: 'video', maxCount: 1 }
]), (req, res) => {
  try {
    const videoFile = req.files?.video?.[0];
    if (!videoFile) return res.status(400).json({ error: 'No video file' });

    const inputPath = videoFile.path;
    const outputPath = path.join(os.tmpdir(), 'output.mp4');

    // Только зеркалирование и масштабирование под Shorts
    const vf = 'hflip,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2';

    const args = [
      '-y', '-i', inputPath,
      '-vf', vf,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-threads', '0',
      outputPath
    ];

    console.log('FFmpeg command:', args.join(' '));

    execFile(ffmpegPath, args, { timeout: 120000 }, (err, stdout, stderr) => {
      fs.unlink(inputPath, () => {});

      if (err) {
        console.error('FFmpeg error:', stderr);
        return res.status(500).json({ error: 'FFmpeg failed', details: stderr?.slice(-500) });
      }
      res.sendFile(outputPath, (sendErr) => {
        if (sendErr) console.error('Send error:', sendErr);
        fs.unlink(outputPath, () => {});
      });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
