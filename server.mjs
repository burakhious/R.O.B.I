import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env dosyasını manuel oku (harici paket gerektirmesin)
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...vals] = trimmed.split("=");
      if (key && vals.length > 0) {
        process.env[key.trim()] = vals.join("=").trim().replace(/^["']|["']$/g, "");
      }
    }
  }
}
loadEnv();

const PORT = parseInt(process.env.PORT || "3000", 10);
const API_KEY = process.env.NVIDIA_API_KEY || "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";
const BASE_URL = process.env.BASE_URL || "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL_NAME = process.env.LLM_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b";
const FALLBACK_MODEL = process.env.LLM_FALLBACK_MODEL || "meta/llama-3.1-nemotron-70b-instruct";
const MEDIA_DIR = path.resolve(__dirname, process.env.MEDIA_DIR || "./media");

if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

// Güvenli komut çalıştırma yardımcısı
function runShell(command, timeoutMs = 120000) {
  const isWin = process.platform === "win32";
  const shell = isWin ? "powershell.exe -NoProfile -Command" : "bash -c";
  const sanitized = isWin ? `"${command.replace(/"/g, '`"')}"` : `'${command.replace(/'/g, "'\\''")}'`;
  return execSync(`${shell} ${sanitized}`, {
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

// R.O.B.I. Araçları (Tools)
const tools = {
  execute_command: ({ command }) => {
    try {
      const res = runShell(command);
      return res.trim() || "[Komut başarıyla tamamlandı, çıktı yok]";
    } catch (err) {
      return `[Hata]: ${err.stdout || err.stderr || err.message}`;
    }
  },

  read_file: ({ filePath }) => {
    try {
      const fullPath = path.resolve(filePath);
      if (!fs.existsSync(fullPath)) return `[Hata]: '${filePath}' bulunamadı.`;
      const content = fs.readFileSync(fullPath, "utf-8");
      return content.length > 5000 ? content.slice(0, 5000) + "\n...[Kısaltıldı]" : content;
    } catch (err) {
      return `[Hata]: ${err.message}`;
    }
  },

  write_file: ({ filePath, content }) => {
    try {
      const fullPath = path.resolve(filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf-8");
      return `[Başarılı]: '${filePath}' dosyası kaydedildi.`;
    } catch (err) {
      return `[Hata]: ${err.message}`;
    }
  },

  list_directory: ({ dirPath = "." }) => {
    try {
      const target = path.resolve(dirPath);
      if (!fs.existsSync(target)) return `[Hata]: Dizin bulunamadı: ${dirPath}`;
      const items = fs.readdirSync(target, { withFileTypes: true });
      return items.map(i => `${i.isDirectory() ? "[KLASÖR]" : "[DOSYA]"} ${i.name}`).join("\n");
    } catch (err) {
      return `[Hata]: ${err.message}`;
    }
  },

  get_system_status: () => {
    try {
      const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
      const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
      const cpus = os.cpus();
      const uptimeH = (os.uptime() / 3600).toFixed(1);

      let gpuInfo = "GPU bilgisi yok";
      try {
        gpuInfo = runShell("nvidia-smi --query-gpu=name,memory.total,memory.free,temperature.gpu --format=csv,noheader", 5000).trim();
      } catch {}

      return [
        `İşletim Sistemi: ${os.type()} ${os.release()} (${os.arch()})`,
        `Çalışma Süresi (Uptime): ${uptimeH} saat`,
        `İşlemci: ${cpus[0]?.model || "Bilinmiyor"} (${cpus.length} Çekirdek)`,
        `Bellek (RAM): Toplam ${totalMem} GB | Boşta ${freeMem} GB`,
        `Ekran Kartı: ${gpuInfo}`
      ].join("\n");
    } catch (err) {
      return `[Sistem Durumu Hatası]: ${err.message}`;
    }
  },

  // Video Düzenleme Araçları (FFmpeg)
  video_info: ({ filename }) => {
    try {
      const fullPath = path.resolve(MEDIA_DIR, filename);
      if (!fs.existsSync(fullPath)) return `[Hata]: '${filename}' media klasöründe bulunamadı.`;
      const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,codec_name -of default=noprint_wrappers=1:nokey=0 "${fullPath}"`;
      return runShell(cmd, 15000);
    } catch (err) {
      return `[Hata]: ${err.message}`;
    }
  },

  video_trim: ({ inputFilename, outputFilename, startTime, endTime }) => {
    try {
      const inPath = path.resolve(MEDIA_DIR, inputFilename);
      const outPath = path.resolve(MEDIA_DIR, outputFilename);
      if (!fs.existsSync(inPath)) return `[Hata]: Giriş dosyası '${inputFilename}' bulunamadı.`;

      // Hızlı ve kayıpsız kesme
      const cmd = `ffmpeg -y -ss ${startTime} -to ${endTime} -i "${inPath}" -c copy "${outPath}"`;
      runShell(cmd, 180000);
      return `[Başarılı]: Video kesildi ve kaydedildi: /media/${outputFilename}`;
    } catch (err) {
      return `[Hata]: ${err.message}`;
    }
  },

  video_to_reels: ({ inputFilename, outputFilename }) => {
    try {
      const inPath = path.resolve(MEDIA_DIR, inputFilename);
      const outPath = path.resolve(MEDIA_DIR, outputFilename);
      if (!fs.existsSync(inPath)) return `[Hata]: Giriş dosyası '${inputFilename}' bulunamadı.`;

      // 16:9 yatay videoyu 9:16 dikey yaparak üst ve alta bulanık arka plan ekleme
      const filter = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=luma_radius=min(h\\,w)/20:luma_power=1:chroma_radius=min(cw\\,ch)/20:chroma_power=1[bg];[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`;
      const cmd = `ffmpeg -y -i "${inPath}" -lavfi "${filter}" -c:a copy "${outPath}"`;
      runShell(cmd, 300000);
      return `[Başarılı]: Video 9:16 Reels/TikTok formatına dönüştürüldü: /media/${outputFilename}`;
    } catch (err) {
      return `[Hata]: ${err.message}`;
    }
  },

  video_extract_audio: ({ inputFilename, outputFilename }) => {
    try {
      const inPath = path.resolve(MEDIA_DIR, inputFilename);
      const outPath = path.resolve(MEDIA_DIR, outputFilename);
      if (!fs.existsSync(inPath)) return `[Hata]: Giriş dosyası '${inputFilename}' bulunamadı.`;

      const cmd = `ffmpeg -y -i "${inPath}" -vn -acodec libmp3lame -q:a 2 "${outPath}"`;
      runShell(cmd, 120000);
      return `[Başarılı]: Ses ayrıştırıldı: /media/${outputFilename}`;
    } catch (err) {
      return `[Hata]: ${err.message}`;
    }
  },

  video_compress: ({ inputFilename, outputFilename, crf = 28 }) => {
    try {
      const inPath = path.resolve(MEDIA_DIR, inputFilename);
      const outPath = path.resolve(MEDIA_DIR, outputFilename);
      if (!fs.existsSync(inPath)) return `[Hata]: Giriş dosyası '${inputFilename}' bulunamadı.`;

      const cmd = `ffmpeg -y -i "${inPath}" -vcodec libx264 -crf ${crf} -preset fast -acodec aac -b:a 128k "${outPath}"`;
      runShell(cmd, 300000);
      return `[Başarılı]: Video sıkıştırıldı: /media/${outputFilename}`;
    } catch (err) {
      return `[Hata]: ${err.message}`;
    }
  }
};

const toolsSchema = [
  {
    type: "function",
    function: {
      name: "execute_command",
      description: "Sunucuda terminal komutu (bash/shell) çalıştırır.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "Çalıştırılacak terminal komutu" } },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_system_status",
      description: "Sunucunun RAM, CPU, GPU, Uptime ve işletim sistemi durumunu raporlar.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "Klasördeki dosya ve klasörleri listeler.",
      parameters: {
        type: "object",
        properties: { dirPath: { type: "string", description: "Klasör yolu (varsayılan: .)" } }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Belirtilen dosyanın içeriğini okur.",
      parameters: {
        type: "object",
        properties: { filePath: { type: "string", description: "Dosya yolu" } },
        required: ["filePath"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Dosyaya içerik yazar veya yeni dosya oluşturur.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Dosya yolu" },
          content: { type: "string", description: "Dosya içeriği" }
        },
        required: ["filePath", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "video_info",
      description: "Media klasöründeki bir video hakkında çözünürlük, süre ve codec bilgilerini getirir.",
      parameters: {
        type: "object",
        properties: { filename: { type: "string", description: "Dosya adı (örn: video.mp4)" } },
        required: ["filename"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "video_trim",
      description: "Videoyu belirtilen başlangıç ve bitiş zamanı arasında keser.",
      parameters: {
        type: "object",
        properties: {
          inputFilename: { type: "string", description: "Giriş video adı (örn: video.mp4)" },
          outputFilename: { type: "string", description: "Çıkış video adı (örn: kesilmis.mp4)" },
          startTime: { type: "string", description: "Başlangıç süresi (örn: 00:00:10 veya 10)" },
          endTime: { type: "string", description: "Bitiş süresi (örn: 00:00:30 veya 30)" }
        },
        required: ["inputFilename", "outputFilename", "startTime", "endTime"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "video_to_reels",
      description: "Yatay (16:9) videoyu dikey (9:16) Reels/TikTok formatına çevirir (arka plana bulanık efekt ekler).",
      parameters: {
        type: "object",
        properties: {
          inputFilename: { type: "string", description: "Giriş videosu" },
          outputFilename: { type: "string", description: "Çıkış videosu (örn: reels.mp4)" }
        },
        required: ["inputFilename", "outputFilename"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "video_extract_audio",
      description: "Videodan sesi ayırıp MP3 dosyası olarak kaydeder.",
      parameters: {
        type: "object",
        properties: {
          inputFilename: { type: "string", description: "Giriş videosu" },
          outputFilename: { type: "string", description: "Çıkış mp3 dosyası (örn: ses.mp3)" }
        },
        required: ["inputFilename", "outputFilename"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "video_compress",
      description: "Video dosya boyutunu sıkıştırır ve küçültür.",
      parameters: {
        type: "object",
        properties: {
          inputFilename: { type: "string", description: "Giriş videosu" },
          outputFilename: { type: "string", description: "Çıkış videosu" },
          crf: { type: "number", description: "Sıkıştırma faktörü (varsayılan: 28, 23-32 arası)" }
        },
        required: ["inputFilename", "outputFilename"]
      }
    }
  }
];

const SYSTEM_PROMPT = `Sen R.O.B.I. (Robodemy Operational Brain & Intelligence) adında, Robodemy platformunun zeki, otonom ve operasyonel yapay zeka asistanısın.
Arka planda NVIDIA Nemotron mimarisiyle çalışıyorsun.
Kullanıcının Linux sunucusunu yönetebilir, terminal komutları çalıştırabilir, dosya okuyup yazabilir ve FFmpeg araçlarıyla profesyonel video düzenlemeleri (kesme, 9:16 dikey reels formatına çevirme, ses ayıklama, sıkıştırma) yapabilirsin.

Kuralların:
- İletişim dilin Türkçe, samimi, kibar, dinamik ve profesyoneldir.
- Kullanıcıya cevap verirken hem sesli hem yazılı okunacağını unutma; anlaşılır ve akıcı ol.
- Video düzenleme yaptıysan veya dosya ürettiysen kullanıcıya indirme/izleme linkini '/media/dosya_adi.mp4' formatında mutlaka belirt.
- Sistem işlemlerinde hızlı, pratik ve çözüm odaklı ol.`;

let conversationHistory = [{ role: "system", content: SYSTEM_PROMPT }];

async function callNemotron(messages, modelToUse = MODEL_NAME) {
  const resp = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: modelToUse,
      messages: messages,
      tools: toolsSchema,
      tool_choice: "auto",
      temperature: 0.6,
      max_tokens: 1500
    })
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    if (modelToUse !== FALLBACK_MODEL && (resp.status === 404 || resp.status === 400)) {
      console.warn(`[UYARI] ${modelToUse} başarısız oldu, ${FALLBACK_MODEL} modeline geçiliyor...`);
      return callNemotron(messages, FALLBACK_MODEL);
    }
    throw new Error(`NVIDIA API Hatası (${resp.status}): ${errorText}`);
  }

  return await resp.json();
}

// HTTP Sunucusu
const server = http.createServer(async (req, res) => {
  // CORS başlıkları
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Filename");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Ana Sayfa (Web Arayüzü)
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const filePath = path.join(__dirname, "public", "index.html");
    if (fs.existsSync(filePath)) {
      const html = fs.readFileSync(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
  }

  // 2. Medya Dosyaları Servisi (/media/...)
  if (req.method === "GET" && req.url.startsWith("/media/")) {
    const relFile = decodeURIComponent(req.url.replace(/^\/media\//, ""));
    const safePath = path.resolve(MEDIA_DIR, relFile);
    if (safePath.startsWith(MEDIA_DIR) && fs.existsSync(safePath)) {
      const stat = fs.statSync(safePath);
      const ext = path.extname(safePath).toLowerCase();
      const mimeTypes = {
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".webm": "video/webm",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".png": "image/png",
        ".jpg": "image/jpeg"
      };
      res.writeHead(200, {
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
        "Content-Length": stat.size
      });
      fs.createReadStream(safePath).pipe(res);
      return;
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Dosya bulunamadı.");
      return;
    }
  }

  // 3. Dosya Yükleme API (/api/upload)
  if (req.method === "POST" && req.url === "/api/upload") {
    const rawFilename = req.headers["x-filename"] || `upload_${Date.now()}.mp4`;
    const safeFilename = path.basename(decodeURIComponent(rawFilename));
    const targetPath = path.join(MEDIA_DIR, safeFilename);

    const fileStream = fs.createWriteStream(targetPath);
    req.pipe(fileStream);

    fileStream.on("finish", () => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        success: true,
        filename: safeFilename,
        url: `/media/${safeFilename}`
      }));
    });

    fileStream.on("error", (err) => {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: false, error: err.message }));
    });
    return;
  }

  // 4. Sohbet & Ajan API (/api/chat)
  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const { message } = JSON.parse(body);
        conversationHistory.push({ role: "user", content: message });

        let loop = 0;
        let isDone = false;
        let actionsExecuted = [];
        let finalReply = "";

        while (!isDone && loop < 10) {
          loop++;
          const result = await callNemotron(conversationHistory);
          const choice = result.choices[0];
          const msg = choice.message;
          conversationHistory.push(msg);

          if (!msg.tool_calls || msg.tool_calls.length === 0) {
            finalReply = msg.content || "İşleminiz tamamlandı efendim.";
            isDone = true;
            break;
          }

          for (const tc of msg.tool_calls) {
            const fnName = tc.function.name;
            let fnArgs = {};
            try { fnArgs = JSON.parse(tc.function.arguments); } catch {}

            console.log(`[R.O.B.I. Araç Çağrısı]: ${fnName}`, fnArgs);

            let output = "";
            if (tools[fnName]) {
              output = tools[fnName](fnArgs);
            } else {
              output = `Bilinmeyen fonksiyon: ${fnName}`;
            }

            actionsExecuted.push({ name: fnName, args: fnArgs, output: String(output) });

            conversationHistory.push({
              role: "tool",
              tool_call_id: tc.id,
              content: String(output)
            });
          }
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ reply: finalReply, actions: actionsExecuted }));
      } catch (err) {
        console.error("[Sohbet Hatası]:", err);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n======================================================`);
  console.log(`🚀 R.O.B.I. (Robodemy Operational Brain & Intelligence)`);
  console.log(`🌐 Sunucu Aktif: http://0.0.0.0:${PORT}`);
  console.log(`🎬 Medya Klasörü: ${MEDIA_DIR}`);
  console.log(`🤖 Model: ${MODEL_NAME}`);
  console.log(`======================================================\n`);
});
