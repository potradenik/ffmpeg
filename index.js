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

// Функция парсинга SRT в массив субтитров
function parseSRT(srtText) {
  const blocks = srtText.trim().split(/\n\n+/);
  const subtitles = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length >= 3) {
      const timeLine = lines[1];
      const match = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
      if (match) {
        const start = match[1];
        const end = match[2];
        const text = lines.slice(2).join(' ').replace(/'/g, "'\\''");
        subtitles.push({ start, end, text });
      }
    }
  }
  return subtitles;
}

// Конвертация времени SRT в секунды
function srtTimeToSeconds(timeStr) {
  const [h, m, sec] = timeStr.split(':');
  const [s, ms] = sec.split(',');
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
}

app.post('/process', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'srt', maxCount: 1 }
]), (req, res) => {
  try {
    const videoFile = req.files?.video?.[0];
    if (!videoFile) return res.status(400).json({ error: 'No video file' });

    const inputPath = videoFile.path;
    const outputPath = path.join(os.tmpdir(), 'output.mp4');
    let srtText = null;

    // Получаем SRT текст
    if (req.files?.srt?.[0]) {
      srtText = fs.readFileSync(req.files.srt[0].path, 'utf-8');
    } else if (req.body?.srt_text) {
      srtText = req.body.srt_text;
    }

    // Базовый фильтр
    let vf = 'hflip,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2';

    // Если есть субтитры, добавляем drawtext
    if (srtText) {
      const fontPath = '/app/TT.ttf';
      if (!fs.existsSync(fontPath)) {
        return res.status(500).json({ error: 'Font file not found', path: fontPath });
      }

      const subtitles = parseSRT(srtText);
      if (subtitles.length === 0) {
        return res.status(400).json({ error: 'No valid subtitles found in SRT' });
      }

      // Строим фильтры drawtext для каждой реплики
      const drawtextFilters = subtitles.map(sub => {
        const startSec = srtTimeToSeconds(sub.start);
        const endSec = srtTimeToSeconds(sub.end);
        // Экранируем двоеточия и другие спецсимволы для параметров фильтра
        const escapedText = sub.text
          .replace(/\\/g, '\\\\')
          .replace(/:/g, '\\:')
          .replace(/'/g, "'\\''");
        return `drawtext=fontfile='${fontPath}':text='${escapedText}':fontsize=20:fontcolor=Yellow:enable='between(t,${startSec},${endSec})'`;
      });

      vf += ',' + drawtextFilters.join(',');
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

    console.log('FFmpeg args:', args.join(' '));

    execFile(ffmpegPath, args, { timeout: 120000 }, (err, stdout, stderr) => {
      fs.unlink(inputPath, () => {});
      if (srtText && req.files?.srt?.[0]) fs.unlink(req.files.srt[0].path, () => {});

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
