const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const app = express();
const upload = multer({ dest: os.tmpdir() });

// Создаём виртуальный fonts.conf, который заставит fontconfig искать шрифты только в указанной папке
function createFontsConfig(fontDir) {
  return `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontDir}</dir>
  <cachedir>/tmp/fonts-cache</cachedir>
  <config>
    <rescan>
      <int>30</int>
    </rescan>
  </config>
</fontconfig>`;
}

app.get('/', (req, res) => res.send('FFmpeg service is running'));

app.post('/process', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'srt', maxCount: 1 }
]), (req, res) => {
  try {
    const videoFile = req.files?.video?.[0];
    if (!videoFile) return res.status(400).json({ error: 'No video file' });

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

    // Готовим временный fonts.conf, если есть субтитры
    let fontsConfPath = null;
    if (srtPath) {
      const fontDir = path.dirname('/app/TT.ttf'); // /app
      const fontsConfContent = createFontsConfig(fontDir);
      fontsConfPath = path.join(os.tmpdir(), 'fonts.conf');
      fs.writeFileSync(fontsConfPath, fontsConfContent);

      // 👇 ВАША СТРОКА С НАСТРОЙКАМИ СУБТИТРОВ 👇
      vf += `,subtitles=${srtPath}:force_style='Fontsize=22,PrimaryColour=&HFFFFFF&,Alignment=2,MarginV=40'`;
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

    // Копируем fonts.conf в /etc/fonts/local.conf, чтобы fontconfig его увидел
    if (fontsConfPath) {
      fs.copyFileSync(fontsConfPath, '/etc/fonts/local.conf');
    }

    console.log('FFmpeg command:', args.join(' '));

    execFile(ffmpegPath, args, { timeout: 120000 }, (err, stdout, stderr) => {
      // Очистка временных файлов
      fs.unlink(inputPath, () => {});
      if (srtPath && srtPath !== (req.files?.srt?.[0]?.path)) fs.unlink(srtPath, () => {});
      if (fontsConfPath) fs.unlink(fontsConfPath, () => {});

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
