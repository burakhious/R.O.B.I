import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Güvenlik ve Kimlik Doğrulama Modülü
import { authenticate, verifySession, invalidateSession, getClientIp } from "./lib/auth.mjs";

// Yetenek Modülleri
import { sendTelegramMessage, isTelegramConfigured } from "./lib/telegram.mjs";
import { listContainers, getContainerLogs, restartContainer, cleanDocker, checkDiskUsage } from "./lib/docker.mjs";
import { checkInbox, sendEmail, prepareEmailDraft } from "./lib/mail.mjs";
import { triggerN8nWebhook } from "./lib/n8n.mjs";
import { generateMorningBriefing } from "./lib/briefing.mjs";
import { startScheduler, triggerManualBriefing } from "./lib/scheduler.mjs";

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

// Güvenli dosya adı ve zaman formatı doğrulayıcıları (Path Traversal ve Injection Koruması)
function safeMediaFilename(filename) {
  if (typeof filename !== "string") return null;
  const base = filename.trim().split(/[\\\/]/).pop();
  if (!base || base.startsWith(".") || !/^[a-zA-Z0-9_\-][a-zA-Z0-9_\.\-]*$/.test(base)) {
    return null;
  }
  return base;
}

function safeMediaTime(t) {
  if (typeof t !== "string" && typeof t !== "number") return null;
  const s = String(t).trim();
  if (!/^[0-9]+(:[0-9]{2}){0,2}(\.[0-9]+)?$/.test(s)) return null;
  return s;
}

// İzin verilen güvenli medya uzantıları
const ALLOWED_MEDIA_EXTS = new Set([
  ".mp4", ".mov", ".webm", ".avi", ".mkv",
  ".mp3", ".wav", ".aac", ".ogg",
  ".jpg", ".jpeg", ".png", ".gif", ".webp"
]);

// R.O.B.I. Güvenli Araçları (Tools) - Arbitrary Terminal/File Read-Write TAMAMEN KALDIRILMIŞTIR
const tools = {
  // 1. Güvenli Medya Listeleme
  list_media_files: () => {
    try {
      const items = fs.readdirSync(MEDIA_DIR, { withFileTypes: true });
      const files = items.filter(i => i.isFile() && !i.name.startsWith(".")).map(i => i.name);
      if (files.length === 0) return "[Bilgi]: Media klasöründe henüz herhangi bir medya dosyası bulunmuyor.";
      return "Media Klasöründeki Dosyalar:\n" + files.map(f => `• ${f} (/media/${f})`).join("\n");
    } catch (err) {
      return `[Hata]: ${err.message}`;
    }
  },

  // 2. Video & Medya Düzenleme (Parametre Doğrulamalı ve Shell'siz Güvenli Çağrılar)
  video_info: ({ filename }) => {
    try {
      const safeName = safeMediaFilename(filename);
      if (!safeName) return "[Güvenlik Hatası]: Geçersiz dosya adı.";
      const fullPath = path.join(MEDIA_DIR, safeName);
      if (!fs.existsSync(fullPath)) return `[Hata]: '${safeName}' media klasöründe bulunamadı.`;

      const args = [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,duration,codec_name",
        "-of", "default=noprint_wrappers=1:nokey=0",
        fullPath
      ];
      const output = execFileSync("ffprobe", args, { encoding: "utf-8", timeout: 15000 });
      return output.trim() || "[Bilgi]: Video bilgileri alındı.";
    } catch (err) {
      return `[Hata]: FFprobe çalıştırılamadı: ${err.message}`;
    }
  },

  video_trim: ({ inputFilename, outputFilename, startTime, endTime }) => {
    try {
      const inBase = safeMediaFilename(inputFilename);
      const outBase = safeMediaFilename(outputFilename);
      const sTime = safeMediaTime(startTime);
      const eTime = safeMediaTime(endTime);

      if (!inBase || !outBase) return "[Güvenlik Hatası]: Dosya adları geçersiz veya tehlikeli karakterler içeriyor.";
      if (!sTime || !eTime) return "[Güvenlik Hatası]: Başlangıç veya bitiş zaman formatı geçersiz.";

      const inPath = path.join(MEDIA_DIR, inBase);
      const outPath = path.join(MEDIA_DIR, outBase);
      if (!fs.existsSync(inPath)) return `[Hata]: Giriş dosyası '${inBase}' bulunamadı.`;

      const args = ["-y", "-ss", sTime, "-to", eTime, "-i", inPath, "-c", "copy", outPath];
      execFileSync("ffmpeg", args, { encoding: "utf-8", timeout: 180000 });
      return `[Başarılı]: Video kesildi ve kaydedildi: /media/${outBase}`;
    } catch (err) {
      return `[Hata]: Video kesme işlemi başarısız: ${err.message}`;
    }
  },

  video_to_reels: ({ inputFilename, outputFilename }) => {
    try {
      const inBase = safeMediaFilename(inputFilename);
      const outBase = safeMediaFilename(outputFilename);
      if (!inBase || !outBase) return "[Güvenlik Hatası]: Geçersiz dosya adı.";

      const inPath = path.join(MEDIA_DIR, inBase);
      const outPath = path.join(MEDIA_DIR, outBase);
      if (!fs.existsSync(inPath)) return `[Hata]: Giriş dosyası '${inBase}' bulunamadı.`;

      const filter = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=luma_radius=min(h\\,w)/20:luma_power=1:chroma_radius=min(cw\\,ch)/20:chroma_power=1[bg];[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`;
      const args = ["-y", "-i", inPath, "-lavfi", filter, "-c:a", "copy", outPath];
      execFileSync("ffmpeg", args, { encoding: "utf-8", timeout: 300000 });
      return `[Başarılı]: Video 9:16 Reels/TikTok formatına dönüştürüldü: /media/${outBase}`;
    } catch (err) {
      return `[Hata]: Reels dönüştürme başarısız: ${err.message}`;
    }
  },

  video_extract_audio: ({ inputFilename, outputFilename }) => {
    try {
      const inBase = safeMediaFilename(inputFilename);
      const outBase = safeMediaFilename(outputFilename);
      if (!inBase || !outBase) return "[Güvenlik Hatası]: Geçersiz dosya adı.";

      const inPath = path.join(MEDIA_DIR, inBase);
      const outPath = path.join(MEDIA_DIR, outBase);
      if (!fs.existsSync(inPath)) return `[Hata]: Giriş dosyası '${inBase}' bulunamadı.`;

      const args = ["-y", "-i", inPath, "-vn", "-acodec", "libmp3lame", "-q:a", "2", outPath];
      execFileSync("ffmpeg", args, { encoding: "utf-8", timeout: 120000 });
      return `[Başarılı]: Ses ayrıştırıldı: /media/${outBase}`;
    } catch (err) {
      return `[Hata]: Ses ayıklama başarısız: ${err.message}`;
    }
  },

  video_compress: ({ inputFilename, outputFilename, crf = 28 }) => {
    try {
      const inBase = safeMediaFilename(inputFilename);
      const outBase = safeMediaFilename(outputFilename);
      if (!inBase || !outBase) return "[Güvenlik Hatası]: Geçersiz dosya adı.";

      const safeCrf = Math.min(Math.max(parseInt(crf, 10) || 28, 18), 36);
      const inPath = path.join(MEDIA_DIR, inBase);
      const outPath = path.join(MEDIA_DIR, outBase);
      if (!fs.existsSync(inPath)) return `[Hata]: Giriş dosyası '${inBase}' bulunamadı.`;

      const args = ["-y", "-i", inPath, "-vcodec", "libx264", "-crf", String(safeCrf), "-preset", "fast", "-acodec", "aac", "-b:a", "128k", outPath];
      execFileSync("ffmpeg", args, { encoding: "utf-8", timeout: 300000 });
      return `[Başarılı]: Video sıkıştırıldı: /media/${outBase}`;
    } catch (err) {
      return `[Hata]: Video sıkıştırma başarısız: ${err.message}`;
    }
  },

  // 3. Sistem Sağlığı Raporu (Salt Okunur)
  get_system_status: () => {
    try {
      const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
      const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
      const cpus = os.cpus();
      const uptimeH = (os.uptime() / 3600).toFixed(1);
      const disk = checkDiskUsage();

      return [
        `İşletim Sistemi: ${os.type()} ${os.release()} (${os.arch()})`,
        `Çalışma Süresi (Uptime): ${uptimeH} saat`,
        `İşlemci: ${cpus[0]?.model || "Bilinmiyor"} (${cpus.length} Çekirdek)`,
        `Bellek (RAM): Toplam ${totalMem} GB | Boşta ${freeMem} GB`,
        `Disk Durumu: Toplam ${disk.totalGB} GB | Dolu: %${disk.percentUsed} | Boş: ${disk.freeGB} GB`
      ].join("\n");
    } catch (err) {
      return `[Sistem Durumu Hatası]: ${err.message}`;
    }
  },

  check_disk_usage: () => {
    const res = checkDiskUsage();
    return res.summary;
  },

  // 4. Docker ve Servis Yönetimi (Regex Doğrulamalı)
  docker_list_containers: ({ all = false } = {}) => {
    return listContainers(all);
  },

  docker_container_logs: ({ containerName, lines = 50, filter = "" }) => {
    return getContainerLogs(containerName, lines, filter);
  },

  docker_restart_container: ({ containerName }) => {
    return restartContainer(containerName);
  },

  docker_cleanup: ({ pruneVolumes = false } = {}) => {
    return cleanDocker(pruneVolumes);
  },

  // 5. E-Posta Entegrasyonu
  mail_check_inbox: async ({ limit = 5, unreadOnly = false, filterSender = "" } = {}) => {
    const res = await checkInbox({ limit, unreadOnly, filterSender });
    if (!res.success) return res.message;
    return res.summary || "Gelen kutusunda e-posta bulunamadı.";
  },

  mail_send: async ({ to, subject, body }) => {
    const res = await sendEmail({ to, subject, body });
    return res.message;
  },

  mail_draft_preview: ({ to, subject, body }) => {
    return prepareEmailDraft({ to, subject, body });
  },

  // 6. Proaktif Telegram Bildirim Kanalı
  send_telegram_notification: async ({ message, parseMode = "HTML" }) => {
    const res = await sendTelegramMessage(message, { parseMode });
    if (res.success) return "[Başarılı]: Bildirim Telegram üzerinden Mustafa Bey'e iletildi.";
    return `[Telegram Hatası]: ${res.error}`;
  },

  // 7. Otomasyon & Zamanlayıcı & n8n
  get_morning_briefing: async ({ sendToTelegram = false } = {}) => {
    const briefing = await generateMorningBriefing();
    if (sendToTelegram && isTelegramConfigured()) {
      await sendTelegramMessage(briefing.html, { parseMode: "HTML" });
    }
    return briefing.text;
  },

  trigger_n8n_webhook: async ({ webhookPath, payload = {} }) => {
    const res = await triggerN8nWebhook(webhookPath, payload);
    return res.message;
  }
};

const toolsSchema = [
  // Medya ve Video Araçları
  {
    type: "function",
    function: {
      name: "list_media_files",
      description: "Media klasöründe bulunan video ve ses dosyalarını listeler.",
      parameters: { type: "object", properties: {} }
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
          crf: { type: "number", description: "Sıkıştırma faktörü (varsayılan: 28, 18-36 arası)" }
        },
        required: ["inputFilename", "outputFilename"]
      }
    }
  },

  // Sistem ve Docker İzleme
  {
    type: "function",
    function: {
      name: "get_system_status",
      description: "Sunucunun RAM, CPU, Uptime ve disk durumunu raporlar.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "check_disk_usage",
      description: "Sunucunun disk kullanım oranını ve boş depolama alanını raporlar.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "docker_list_containers",
      description: "Sunucudaki Docker konteynerlerini, çalışan web servislerini ve portlarını listeler.",
      parameters: {
        type: "object",
        properties: {
          all: { type: "boolean", description: "Duran konteynerler dahil hepsini mi listelesin?" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "docker_container_logs",
      description: "Belirtilen Docker servisinin son satır loglarını inceler ve hata analizi yapar.",
      parameters: {
        type: "object",
        properties: {
          containerName: { type: "string", description: "Konteyner adı (örn: robi, blog, nginx)" },
          lines: { type: "number", description: "Getirilecek satır sayısı (varsayılan: 50)" },
          filter: { type: "string", description: "Loglarda aranacak filtre kelimesi (örn: error)" }
        },
        required: ["containerName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "docker_restart_container",
      description: "Belirtilen Docker konteynerini yeniden başlatır.",
      parameters: {
        type: "object",
        properties: {
          containerName: { type: "string", description: "Yeniden başlatılacak konteyner adı" }
        },
        required: ["containerName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "docker_cleanup",
      description: "Kullanılmayan Docker önbelleklerini ve durmuş konteynerleri temizler (docker system prune).",
      parameters: {
        type: "object",
        properties: {
          pruneVolumes: { type: "boolean", description: "Kullanılmayan volumeleri de temizlesin mi? (varsayılan: false)" }
        }
      }
    }
  },

  // E-Posta Yönetimi
  {
    type: "function",
    function: {
      name: "mail_check_inbox",
      description: "Gelen kutusundaki e-postaları sorgular, listeler veya özetler. Okunmamış veya belirli bir gönderenden gelen mailleri filtreleyebilir.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Getirilecek maksimum mail sayısı (varsayılan: 5)" },
          unreadOnly: { type: "boolean", description: "Sadece okunmamış mailleri mi getirsin?" },
          filterSender: { type: "string", description: "Belirli bir gönderen adına veya adresine göre filtrele" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "mail_send",
      description: "Belirtilen alıcıya SMTP üzerinden e-posta gönderir. Kullanıcıdan onay alındıktan sonra çağrılmalıdır.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Alıcı e-posta adresi" },
          subject: { type: "string", description: "E-posta konusu" },
          body: { type: "string", description: "E-posta metin içeriği" }
        },
        required: ["to", "subject", "body"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "mail_draft_preview",
      description: "Gönderilmeden önce kullanıcının onaylaması için e-posta taslağı oluşturur ve ekranda gösterir.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Alıcı e-posta adresi" },
          subject: { type: "string", description: "E-posta konusu" },
          body: { type: "string", description: "E-posta metin içeriği" }
        },
        required: ["to", "subject", "body"]
      }
    }
  },

  // Telegram Bildirimi
  {
    type: "function",
    function: {
      name: "send_telegram_notification",
      description: "Mustafa Bey'in telefonuna Telegram üzerinden proaktif bildirim veya acil durum uyarısı gönderir.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Gönderilecek mesaj metni (HTML veya düz metin)" },
          parseMode: { type: "string", description: "Biçimlendirme türü: 'HTML' veya 'Markdown'", enum: ["HTML", "Markdown"] }
        },
        required: ["message"]
      }
    }
  },

  // Otomasyon ve n8n
  {
    type: "function",
    function: {
      name: "get_morning_briefing",
      description: "Hava durumu, döviz kurları, okunmamış e-postalar ve sunucu durumunu içeren günlük Sabah Brifingini oluşturur.",
      parameters: {
        type: "object",
        properties: {
          sendToTelegram: { type: "boolean", description: "Hazırlanan brifingi doğrudan Mustafa Bey'in Telegram'ına da göndersin mi?" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "trigger_n8n_webhook",
      description: "n8n otomasyon motoru üzerindeki bir senaryo webhook'unu tetikler.",
      parameters: {
        type: "object",
        properties: {
          webhookPath: { type: "string", description: "Tetiklenecek webhook adı/yolu (örn: 'sync-notion')" },
          payload: { type: "object", description: "Webhook'a gönderilecek JSON veri paketi" }
        },
        required: ["webhookPath"]
      }
    }
  }
];

const SYSTEM_PROMPT = `Sen R.O.B.I. (Robodemy Operational Brain & Intelligence) adında, Robodemy platformunun güvenli, akıllı, otonom ve operasyonel yapay zeka asistanısın.
Kullanıcın: Mustafa Bey'dir. Kendisine hitap ederken her zaman saygılı, samimi ve dinamik şekilde "Mustafa Bey" olarak hitap et.
Arka planda NVIDIA Nemotron mimarisiyle çalışıyorsun.

🛡️ KESİN GÜVENLİK KURALLARI (ASLA ÇİĞNENEMEZ):
1. Terminal veya kabuk komutları (bash, sh, powershell, cmd) çalıştırma yetkin KESİNLİKLE YOKTUR ve bu yetki güvenlik nedeniyle tamamen kaldırılmıştır. Kullanıcıdan terminal komutu talebi gelirse, güvenlik politikaları gereğince doğrudan terminal komutu çalıştıramayacağını, yalnızca güvenli R.O.B.I. servislerini kullanabileceğini net ve nazik bir dille belirt.
2. ASLA .env dosyasını, API anahtarlarını, şifreleri, veritabanı bağlantılarını veya sistem kimlik bilgilerini kullanıcıyla paylaşma, sızdırma veya ifşa etme.
3. Yetkisiz dosya okuma/yazma yetkin yoktur. Sadece medya klasöründeki dosyalarla çalışabilirsin.
4. Sistemin arka plan teknik açıklarını, zaafiyetlerini veya sunucu iç mimarisini kullanıcılara ifşa etme.
5. Kullanıcı yeteneklerini sorduğunda ("ne yapabilirsin?", "neler yaparsın?"), yalnızca aşağıdaki onaylı operasyonel hizmetleri listele.

Onaylı Yeteneklerin:
1. 🎬 FFmpeg Medya & Video Düzenleme: Videoları kesme, 9:16 Reels/TikTok formatına dönüştürme, ses ayıklama ve sıkıştırma.
2. 📧 E-Posta Yönetimi: Gelen e-postaları sorgulama, son 24 saati özetleme ve onay alındığında taslak hazırlayıp e-posta gönderme.
3. 📱 Proaktif Telegram Bildirimleri: Acil durumlarda ve sabah brifinginde Mustafa Bey'in telefonuna Telegram üzerinden bildirim gönderme.
4. ⏰ Sabah Brifingi & Otomasyon: Hava durumu, döviz kurları, bekleyen e-postalar ve sunucu durumunu derleme; n8n webhook'larını tetikleme.
5. 📊 Sistem & Servis İzleme: RAM, CPU, disk doluluk durumu ve çalışan Docker servislerinin sağlık durumunu raporlama.

İletişim Kuralları:
- Dilin Türkçe, profesyonel, saygılı, net ve çözüm odaklıdır.
- Yanıtlarının hem sesli hem yazılı dinleneceğini unutma, gereksiz kod veya komut çıktısı dökmek yerine anlaşılır Türkçe özetler ver.`;

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
      temperature: 0.5,
      max_tokens: 1800
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

// Güvenli JSON gövde okuyucu (Bellek taşması korumalı - maks 1MB)
function readJsonBody(req, maxSize = 1048576) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        return reject(new Error("İstek boyutu çok büyük!"));
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        resolve(parsed);
      } catch (err) {
        reject(new Error("Geçersiz JSON formatı."));
      }
    });
    req.on("error", err => reject(err));
  });
}

// HTTP Sunucusu
const server = http.createServer(async (req, res) => {
  const clientIp = getClientIp(req);

  // Güvenli CORS başlıkları
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Robi-Token, X-Filename");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // URL normalize et
  let cleanUrl = req.url || "/";
  if (cleanUrl.toLowerCase().startsWith("/robi/")) {
    cleanUrl = cleanUrl.slice(5) || "/";
  } else if (cleanUrl.toLowerCase() === "/robi") {
    cleanUrl = "/";
  }

  // 1. Ana Sayfa (Web Arayüzü) - Herkese açık (kilit ekranı barındırır)
  if (req.method === "GET" && (cleanUrl === "/" || cleanUrl === "/index.html")) {
    const filePath = path.join(__dirname, "public", "index.html");
    if (fs.existsSync(filePath)) {
      const html = fs.readFileSync(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
  }

  // 2. KİMLİK DOĞRULAMA ENDPOINT'LERİ (Auth Routes)
  if (req.method === "POST" && cleanUrl === "/api/auth/login") {
    try {
      const { password } = await readJsonBody(req);
      const authResult = authenticate(password, clientIp);

      if (authResult.success) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          success: true,
          token: authResult.token,
          expiresAt: authResult.expiresAt
        }));
      } else {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: authResult.error }));
      }
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (cleanUrl === "/api/auth/verify") {
    const isValid = verifySession(req);
    res.writeHead(isValid ? 200 : 401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ authenticated: isValid }));
    return;
  }

  if (req.method === "POST" && cleanUrl === "/api/auth/logout") {
    invalidateSession(req);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // 3. Medya Dosyaları Servisi (/media/...) - Path Traversal Korumalı
  if (req.method === "GET" && cleanUrl.startsWith("/media/")) {
    const rawName = decodeURIComponent(cleanUrl.replace(/^\/media\//, ""));
    const safeName = safeMediaFilename(rawName);

    if (!safeName) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Geçersiz veya yetkisiz dosya talebi.");
      return;
    }

    const safePath = path.join(MEDIA_DIR, safeName);
    if (fs.existsSync(safePath) && safePath.startsWith(MEDIA_DIR)) {
      const stat = fs.statSync(safePath);
      const ext = path.extname(safePath).toLowerCase();
      const mimeTypes = {
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".webm": "video/webm",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg"
      };
      res.writeHead(200, {
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
        "Content-Length": stat.size
      });
      fs.createReadStream(safePath).pipe(res);
      return;
    } else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Dosya bulunamadı.");
      return;
    }
  }

  // --- BU NOKTADAN İTİBAREN TÜM ENDPOINT'LER YETKİLENDİRME (AUTH) ZORUNLUDUR ---
  if (!verifySession(req)) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Yetkisiz Erişim: Lütfen önce R.O.B.I. şifrenizle giriş yapınız." }));
    return;
  }

  // 4. Güvenli Dosya Yükleme API (/api/upload)
  if (req.method === "POST" && cleanUrl === "/api/upload") {
    const rawFilename = req.headers["x-filename"] || `upload_${Date.now()}.mp4`;
    const decodedName = decodeURIComponent(rawFilename);
    const ext = path.extname(decodedName).toLowerCase();

    // Uzantı denetimi: Sadece video, ses ve görsel kabul edilir (sh, js, exe, php engellendi)
    if (!ALLOWED_MEDIA_EXTS.has(ext)) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: false, error: "Güvenlik Engeli: Yalnızca video, ses ve görsel dosyaları yüklenebilir!" }));
      return;
    }

    const cleanBase = path.basename(decodedName, ext).replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 50);
    const safeFilename = `${cleanBase}_${Date.now()}${ext}`;
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

  // 5. Manuel Sabah Brifingi API (/api/briefing)
  if ((req.method === "GET" || req.method === "POST") && cleanUrl === "/api/briefing") {
    try {
      const briefing = await triggerManualBriefing();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: true, briefing }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 6. Sohbet & Ajan API (/api/chat) - Yetkilendirilmiş ve Sıkılaştırılmış
  if (req.method === "POST" && cleanUrl === "/api/chat") {
    try {
      const { message } = await readJsonBody(req);
      if (!message || typeof message !== "string") {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Mesaj içeriği gereklidir." }));
        return;
      }

      conversationHistory.push({ role: "user", content: message.slice(0, 3000) });

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
          finalReply = msg.content || "İşleminiz tamamlandı Mustafa Bey.";
          isDone = true;
          break;
        }

        for (const tc of msg.tool_calls) {
          const fnName = tc.function.name;
          let fnArgs = {};
          try { fnArgs = JSON.parse(tc.function.arguments); } catch {}

          console.log(`[R.O.B.I. Güvenli Araç]: ${fnName}`, fnArgs);

          let output = "";
          if (tools[fnName]) {
            output = await tools[fnName](fnArgs);
          } else {
            output = `[Erişim Reddedildi]: '${fnName}' aracı güvenlik nedeniyle devre dışı bırakılmıştır veya tanımlı değildir.`;
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
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n======================================================`);
  console.log(`🛡️ R.O.B.I. - Güvenlik Duvarı & Kimlik Doğrulama Aktif`);
  console.log(`🌐 Sunucu: http://0.0.0.0:${PORT}`);
  console.log(`🔒 Yönetici Şifresi Koruması: Aktif`);
  console.log(`🚫 Ham Terminal & Dosya Erişimi: Tamamen Kapatıldı`);
  console.log(`📱 Telegram Durumu: ${isTelegramConfigured() ? "Bağlı ✅" : "Yapılandırılmadı ⚠️"}`);
  console.log(`======================================================\n`);

  startScheduler();
});
