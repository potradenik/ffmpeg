const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const app = express();
const upload = multer({ dest: os.tmpdir() });

app.get('/', (req, res) => {
  res.status(200).send('FFmpeg service is running');
});


app.post('/process', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'srt', maxCount: 1 }   // необязательно
]), (req, res) => {
  const videoFile = req.files?.video?.[0];
  if (!videoFile) {
    return res.status(400).json({ error: 'No video file' });
  }

  const inputPath = videoFile.path;
  const outputPath = path.join(os.tmpdir(), 'output.mp4');
  const srtPath = req.files?.srt?.[0]?.path || null;

  // Фильтры FFmpeg
  let vf = 'hflip,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2';
  if (srtPath) {
    vf += `,subtitles=${srtPath}:force_style='Fontsize=20,PrimaryColour=&H00FFFF&'`;
  }

  const args = [
    '-y', '-i', inputPath,
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    outputPath
  ];

  execFile('ffmpeg', args, (err) => {
    // Очистка временных файлов
    fs.unlink(inputPath, () => {});
    if (srtPath) fs.unlink(srtPath, () => {});

    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'FFmpeg processing failed' });
    }

    res.sendFile(outputPath, () => {
      fs.unlink(outputPath, () => {});
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FFmpeg service on port ${PORT}`));
