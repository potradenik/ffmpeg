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
  { name: 'video', maxCount: 1 },
  { name: 'srt', maxCount: 1 }
]), (req, res) => {
  try {
    const videoFile = req.files?.video?.[0];
    if (!videoFile) {
      return res.status(400).json({ error: 'No video file' });
    }

    const inputPath = videoFile.path;
    const outputPath = path.join(os.tmpdir(), 'output.mp4');
    let srtPath = null;

    // Получаем субтитры (либо файл, либо текст)
    if (req.files?.srt?.[0]) {
      srtPath = req.files.srt[0].path;
    } else if (req.body?.srt_text) {
      srtPath = path.join(os.tmpdir(), 'subs.srt');
      fs.writeFileSync(srtPath, req.body.srt_text, 'utf-8');
    }

    // Базовый фильтр зеркалирования и масштабирования
    let vf = 'hflip,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2';

    // Если субтитры есть, добавляем их в фильтр с указанием шрифта
    if (srtPath) {
      const fontPath = '/app/TT.ttf';  // шрифт должен лежать в корне репозитория
      if (fs.existsSync(fontPath)) {
        vf += `,subtitles=${srtPath}:force_style='Fontsize=20,PrimaryColour=&H00FFFF&,Fontfile=${fontPath}'`;
      } else {
        // Если шрифт не найден – возвращаем понятную ошибку
        return res.status(500).json({
          error: 'Font file not found',
          expectedPath: fontPath
        });
      }
    }

    const args = [
      '-y', '-i', inputPath,
      '-vf', vf,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-threads', '0',
      outputPath
    ];

    console.log('FFmpeg command:', ffmpegPath, args.join(' '));

    execFile(ffmpegPath, args, { timeout: 120000 }, (err, stdout, stderr) => {
      // Очистка временных файлов
      fs.unlink(inputPath, () => {});
      if (srtPath && srtPath !== (req.files?.srt?.[0]?.path)) {
        fs.unlink(srtPath, () => {});
      }

      if (err) {
        console.error('FFmpeg error:', err.message);
        console.error('FFmpeg stderr:', stderr);
        return res.status(500).json({
          error: 'FFmpeg processing failed',
          details: stderr ? stderr.slice(-500) : err.message
        });
      }

      console.log('FFmpeg finished successfully');
      res.sendFile(outputPath, (sendErr) => {
        if (sendErr) console.error('Error sending file:', sendErr);
        fs.unlink(outputPath, () => {});
      });
    });
  } catch (e) {
    console.error('Unexpected error:', e);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FFmpeg service on port ${PORT}`));
