// lib/docker.mjs - R.O.B.I. Docker & Sistem Yönetim Modülü (Güvenlik Korumalı)
import fs from "node:fs";
import { execSync } from "node:child_process";

// Güvenli shell çalıştırma yardımcısı
function runDockerCmd(command, timeoutMs = 60000) {
  return execSync(command, {
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

// Konteyner adı güvenlik doğrulaması (Command injection önleme)
function isValidContainerName(name) {
  return typeof name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name);
}

/**
 * Sunucuda çalışan veya tüm Docker konteynerlerini listeler.
 */
export function listContainers(all = false) {
  try {
    const flag = all ? "-a" : "";
    const cmd = `docker ps ${flag} --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"`;
    const output = runDockerCmd(cmd).trim();
    if (!output || output.split("\n").length <= 1) {
      return "[Bilgi]: Sunucuda şu an çalışan herhangi bir Docker konteyneri bulunamadı.";
    }
    return output;
  } catch (err) {
    const errMsg = err.stderr || err.message || "";
    if (errMsg.includes("not recognized") || errMsg.includes("command not found") || errMsg.includes("docker: not found") || errMsg.includes("Cannot connect")) {
      return "[Docker Erişimi Yok]: Docker komutuna erişilemiyor veya Docker daemon çalışmıyor. R.O.B.I. konteynerinin /var/run/docker.sock bağlantısına sahip olduğundan emin olun.";
    }
    return `[Docker Listeleme Hatası]: ${errMsg}`;
  }
}

/**
 * Belirtilen Docker konteynerinin son N satır logunu getirir ve hata analizi yapar.
 */
export function getContainerLogs(containerName, lines = 50, filter = "") {
  try {
    if (!isValidContainerName(containerName)) {
      return "[Güvenlik Hatası]: Geçersiz konteyner adı. Yalnızca harf, rakam, alt çizgi, nokta ve tire içerebilir.";
    }

    const safeLines = Math.min(Math.max(parseInt(lines, 10) || 50, 10), 300);
    const cmd = `docker logs --tail ${safeLines} ${containerName}`;
    const output = runDockerCmd(cmd).trim();

    if (!output) {
      return `[Bilgi]: '${containerName}' konteynerinde henüz kayıtlı log bulunmuyor.`;
    }

    const logLines = output.split("\n");
    let matchedLines = logLines;
    if (filter && typeof filter === "string") {
      const lower = filter.slice(0, 50).toLowerCase();
      matchedLines = logLines.filter(line => line.toLowerCase().includes(lower));
    }

    // Hata taraması
    const errorKeywords = ["error", "fatal", "exception", "failed", "crash", "panic"];
    const foundErrors = logLines.filter(line => {
      const l = line.toLowerCase();
      return errorKeywords.some(kw => l.includes(kw));
    });

    let result = `=== [${containerName}] Son ${safeLines} Satır Log ===\n`;
    if (foundErrors.length > 0) {
      result += `⚠️ DİKKAT: Loglar içinde ${foundErrors.length} adet potansiyel hata tespit edildi!\n\n`;
    } else {
      result += `✅ Loglarda bariz bir kritik hata tespit edilmedi.\n\n`;
    }

    result += matchedLines.slice(-100).join("\n");
    return result;
  } catch (err) {
    return `[Docker Log Hatası]: ${err.stderr || err.message}`;
  }
}

/**
 * Belirtilen konteyneri yeniden başlatır.
 */
export function restartContainer(containerName) {
  try {
    if (!isValidContainerName(containerName)) {
      return "[Güvenlik Hatası]: Geçersiz konteyner adı.";
    }
    runDockerCmd(`docker restart ${containerName}`, 30000);
    return `[Başarılı]: '${containerName}' konteyneri başarıyla yeniden başlatıldı.`;
  } catch (err) {
    return `[Hata]: '${containerName}' yeniden başlatılamadı: ${err.stderr || err.message}`;
  }
}

/**
 * Docker cache ve kullanılmayan nesneleri temizler (docker system prune).
 */
export function cleanDocker(pruneVolumes = false) {
  try {
    const cmd = `docker system prune -f ${pruneVolumes ? "--volumes" : ""}`;
    const output = runDockerCmd(cmd, 120000);
    return `[Docker Temizliği Başarılı]:\n${output.trim()}`;
  } catch (err) {
    return `[Docker Temizlik Hatası]: ${err.stderr || err.message}`;
  }
}

/**
 * Sunucu disk doluluk oranını denetler (cross-platform fs.statfsSync).
 */
export function checkDiskUsage(threshold = 85) {
  try {
    const checkPath = process.platform === "win32" ? process.cwd() : "/";
    const stat = fs.statfsSync(checkPath);
    const totalBytes = stat.bsize * stat.blocks;
    const freeBytes = stat.bsize * stat.bfree;
    const usedBytes = totalBytes - freeBytes;

    const totalGB = (totalBytes / (1024 ** 3)).toFixed(1);
    const freeGB = (freeBytes / (1024 ** 3)).toFixed(1);
    const usedGB = (usedBytes / (1024 ** 3)).toFixed(1);
    const percentUsed = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
    const isCritical = percentUsed >= threshold;

    return {
      success: true,
      totalGB,
      usedGB,
      freeGB,
      percentUsed,
      threshold,
      isCritical,
      summary: `Disk Durumu: Toplam ${totalGB} GB | Kullanılan: ${usedGB} GB (%${percentUsed}) | Boş Alan: ${freeGB} GB ${isCritical ? `⚠️ KRİTİK EŞİK AŞILDI (Eşik: %${threshold})` : "✅ Normal"}`
    };
  } catch (err) {
    return {
      success: false,
      error: `Disk bilgisi alınamadı: ${err.message}`,
      summary: `[Disk Hatası]: ${err.message}`
    };
  }
}
