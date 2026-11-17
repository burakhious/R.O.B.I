// lib/scheduler.mjs - R.O.B.I. Dahili Proaktif Zamanlayıcı
import { generateMorningBriefing } from "./briefing.mjs";
import { sendTelegramMessage, isTelegramConfigured } from "./telegram.mjs";
import { checkDiskUsage } from "./docker.mjs";

let schedulerInterval = null;
let lastBriefingDate = null;
let lastDiskAlertTime = 0;

/**
 * Zamanlayıcıyı başlatır (Her 60 saniyede bir kontrol yapar).
 */
export function startScheduler() {
  if (schedulerInterval) return;

  const briefingTarget = process.env.BRIEFING_TIME || "08:30";
  const diskThreshold = parseInt(process.env.DISK_ALERT_THRESHOLD || "85", 10);

  console.log(`[Scheduler]: Dahili zamanlayıcı aktif.`);
  console.log(`[Scheduler]: Sabah Brifingi Hedef Saati: ${briefingTarget}`);
  console.log(`[Scheduler]: Disk Alarm Eşiği: %${diskThreshold}`);

  schedulerInterval = setInterval(async () => {
    const now = new Date();
    const currentHours = String(now.getHours()).padStart(2, "0");
    const currentMinutes = String(now.getMinutes()).padStart(2, "0");
    const currentTime = `${currentHours}:${currentMinutes}`;
    const todayStr = now.toISOString().slice(0, 10);

    // 1. Sabah Brifingi Kontrolü
    if (currentTime === briefingTarget && lastBriefingDate !== todayStr) {
      lastBriefingDate = todayStr;
      console.log(`[Scheduler]: Saat ${currentTime} - Sabah brifingi hazırlanıyor...`);
      try {
        const briefing = await generateMorningBriefing();
        if (isTelegramConfigured()) {
          const res = await sendTelegramMessage(briefing.html, { parseMode: "HTML" });
          if (res.success) {
            console.log(`[Scheduler]: ✅ Sabah brifingi Telegram üzerinden Mustafa Bey'e iletildi.`);
          } else {
            console.warn(`[Scheduler]: ⚠️ Telegram brifing iletilemedi: ${res.error}`);
          }
        } else {
          console.log(`[Scheduler]: ℹ️ Telegram yapılandırılmadığı için brifing konsola yazıldı:\n${briefing.text}`);
        }
      } catch (err) {
        console.error(`[Scheduler Hatası - Sabah Brifingi]:`, err);
      }
    }

    // 2. Proaktif Disk Doluluk Kontrolü (Dakikanın 0 veya 30 olduğu anlarda kontrol et)
    if (now.getMinutes() === 0 || now.getMinutes() === 30) {
      const disk = checkDiskUsage(diskThreshold);
      const sixHours = 6 * 60 * 60 * 1000;
      if (disk.isCritical && (Date.now() - lastDiskAlertTime > sixHours)) {
        lastDiskAlertTime = Date.now();
        console.warn(`[Scheduler - Alarm]: Disk doluluğu kritik seviyede: %${disk.percentUsed}`);

        const alertMessage = [
          `🚨 <b>DİKKAT: Sunucu Disk Alanı Uyarısı</b>`,
          `━━━━━━━━━━━━━━━━━━━━━`,
          `Mustafa Bey, sunucu disk doluluğu <b>%${disk.percentUsed}</b> seviyesine ulaştı!`,
          `• <b>Toplam:</b> ${disk.totalGB} GB`,
          `• <b>Kullanılan:</b> ${disk.usedGB} GB`,
          `• <b>Kalan Boş Alan:</b> ${disk.freeGB} GB`,
          ``,
          `İzin verirseniz <code>docker system prune</code> ile gereksiz konteyner ve cache temizliği başlatabilirim.`
        ].join("\n");

        if (isTelegramConfigured()) {
          await sendTelegramMessage(alertMessage, { parseMode: "HTML" });
          console.log(`[Scheduler]: Disk alarmı Telegram'a gönderildi.`);
        }
      }
    }
  }, 60000);
}

/**
 * Zamanlayıcıyı durdurur.
 */
export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

/**
 * Manuel olarak Sabah Brifingini hemen çalıştırır ve Telegram'a atar.
 */
export async function triggerManualBriefing() {
  const briefing = await generateMorningBriefing();
  if (isTelegramConfigured()) {
    await sendTelegramMessage(briefing.html, { parseMode: "HTML" });
  }
  return briefing;
}
