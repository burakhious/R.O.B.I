// lib/briefing.mjs - R.O.B.I. Sabah Brifingi Oluşturucu
import os from "node:os";
import { checkDiskUsage, listContainers } from "./docker.mjs";
import { checkInbox, isMailConfigured } from "./mail.mjs";

/**
 * Hava durumu bilgisini çeker (wttr.in veya open-meteo).
 */
export async function fetchWeather(city = "Istanbul") {
  try {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json();
      const curr = data.current_condition?.[0];
      if (curr) {
        const temp = curr.temp_C;
        const feels = curr.FeelsLikeC;
        const desc = curr.lang_tr?.[0]?.value || curr.weatherDesc?.[0]?.value || "Açık";
        const humidity = curr.humidity;
        return `${temp}°C (Hissedilen: ${feels}°C), ${desc}, Nem: %${humidity}`;
      }
    }
  } catch {}

  // Yedek basit metin sorgusu
  try {
    const resp = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`, { signal: AbortSignal.timeout(4000) });
    if (resp.ok) {
      const text = (await resp.text()).trim();
      if (text) return text;
    }
  } catch {}

  return `${city}: Hava durumu servisi şu an yanıt vermiyor.`;
}

/**
 * Güncel döviz kurlarını çeker (USD/TRY, EUR/TRY).
 */
export async function fetchExchangeRates() {
  try {
    const resp = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json();
      const usdTry = data.rates?.TRY ? data.rates.TRY.toFixed(2) : "N/A";
      const usdEur = data.rates?.EUR || 1;
      const eurTry = (data.rates?.TRY / usdEur).toFixed(2);
      return `Dolar (USD): ₺${usdTry} | Euro (EUR): ₺${eurTry}`;
    }
  } catch {}

  // Yedek API (frankfurter)
  try {
    const [usdResp, eurResp] = await Promise.all([
      fetch("https://api.frankfurter.app/latest?from=USD&to=TRY", { signal: AbortSignal.timeout(4000) }),
      fetch("https://api.frankfurter.app/latest?from=EUR&to=TRY", { signal: AbortSignal.timeout(4000) })
    ]);
    if (usdResp.ok && eurResp.ok) {
      const usdData = await usdResp.json();
      const eurData = await eurResp.json();
      return `Dolar (USD): ₺${usdData.rates.TRY.toFixed(2)} | Euro (EUR): ₺${eurData.rates.TRY.toFixed(2)}`;
    }
  } catch {}

  return "Piyasa kurları şu an güncellenemedi.";
}

/**
 * Mustafa Bey için tam donanımlı Sabah Brifingi hazırlar.
 */
export async function generateMorningBriefing() {
  const city = process.env.BRIEFING_CITY || "Istanbul";
  const now = new Date();
  const dateStr = now.toLocaleDateString("tr-TR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

  // 1. Hava durumu ve Döviz (paralel)
  const [weather, finance] = await Promise.all([
    fetchWeather(city),
    fetchExchangeRates()
  ]);

  // 2. Sistem & Sunucu Durumu
  const disk = checkDiskUsage(parseInt(process.env.DISK_ALERT_THRESHOLD || "85", 10));
  const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
  const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
  const usedMem = (parseFloat(totalMem) - parseFloat(freeMem)).toFixed(1);
  const memPct = Math.round((parseFloat(usedMem) / parseFloat(totalMem)) * 100);
  const uptimeH = (os.uptime() / 3600).toFixed(1);

  // Docker durumu
  let dockerInfo = "Docker bilgisi alınamadı";
  try {
    const rawDocker = listContainers(false);
    if (typeof rawDocker === "string" && rawDocker.includes("\n")) {
      const lines = rawDocker.trim().split("\n");
      const activeCount = Math.max(0, lines.length - 1);
      dockerInfo = `${activeCount} aktif konteyner çalışıyor`;
    } else {
      dockerInfo = rawDocker;
    }
  } catch {}

  // 3. E-Posta Kontrolü
  let mailSummary = "E-posta entegrasyonu henüz yapılandırılmamış.";
  if (isMailConfigured()) {
    try {
      const inbox = await checkInbox({ limit: 5, unreadOnly: true });
      if (inbox.success) {
        if (inbox.count === 0) {
          mailSummary = "Gelen kutunuzda okunmamış yeni e-posta yok. Her şey güncel!";
        } else {
          mailSummary = `${inbox.count} yeni/okunmamış e-posta var:\n` +
            inbox.mails.slice(0, 3).map(m => `   • <b>${escapeHtml(m.from)}</b>: ${escapeHtml(m.subject)}`).join("\n");
        }
      } else {
        mailSummary = `E-posta kontrolünde uyarı: ${inbox.message}`;
      }
    } catch (err) {
      mailSummary = `E-posta okunamadı: ${err.message}`;
    }
  }

  // HTML formatında (Telegram ve Web için)
  const htmlMessage = [
    `🌅 <b>GÜNAYDIN MUSTAFA BEY!</b>`,
    `📅 <i>${dateStr} - ${timeStr}</i>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `🌤️ <b>Hava Durumu (${city}):</b>`,
    `   ${weather}`,
    ``,
    `📈 <b>Piyasa & Döviz:</b>`,
    `   ${finance}`,
    ``,
    `📬 <b>E-Posta Durumu:</b>`,
    `   ${mailSummary}`,
    ``,
    `🖥️ <b>Sunucu Sağlığı:</b>`,
    `   • <b>RAM:</b> ${usedMem} GB / ${totalMem} GB (%${memPct})`,
    `   • <b>Disk:</b> %${disk.percentUsed} Dolu (${disk.freeGB} GB Boş)`,
    `   • <b>Docker:</b> ${dockerInfo}`,
    `   • <b>Uptime:</b> ${uptimeH} saat`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `🤖 <i>R.O.B.I. göreve hazır. Verimli ve harika bir gün dilerim!</i>`
  ].join("\n");

  // Düz metin formatı
  const plainText = htmlMessage.replace(/<[^>]+>/g, "");

  return {
    date: dateStr,
    weather,
    finance,
    mailSummary,
    disk,
    html: htmlMessage,
    text: plainText
  };
}

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
