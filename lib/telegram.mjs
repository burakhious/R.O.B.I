// lib/telegram.mjs - R.O.B.I. Telegram Bildirim Kanalı
// Harici npm paketi gerektirmez (Node.js dahili fetch kullanır)

export function isTelegramConfigured() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  return Boolean(token && chatId && token.trim() !== "" && chatId.trim() !== "");
}

/**
 * Telegram üzerinden Mustafa Bey'e proaktif bildirim veya mesaj gönderir.
 * @param {string} text - Gönderilecek mesaj metni (HTML veya düz metin)
 * @param {object} options - { parseMode: "HTML" | "Markdown" | null, silent: boolean }
 */
export async function sendTelegramMessage(text, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!isTelegramConfigured()) {
    console.warn("[Telegram]: TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID .env dosyasında tanımlanmamış.");
    return {
      success: false,
      error: "Telegram botu yapılandırılmamış. Lütfen .env dosyasında TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID alanlarını tanımlayın."
    };
  }

  const parseMode = options.parseMode !== undefined ? options.parseMode : "HTML";
  const silent = Boolean(options.silent);

  // Telegram maksimum 4096 karaktere izin verir, güvenli sınır 4000
  const maxLen = 4000;
  const chunks = [];
  let remaining = String(text);

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx < 1000) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const results = [];

  for (const chunk of chunks) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: parseMode || undefined,
          disable_web_page_preview: true,
          disable_notification: silent
        })
      });

      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        // Eğer HTML parse hatası verirse düz metin olarak tekrar dene
        if (parseMode && data.description && data.description.includes("can't parse entities")) {
          const fallbackResp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: chunk.replace(/<[^>]+>/g, ""),
              disable_web_page_preview: true,
              disable_notification: silent
            })
          });
          const fallbackData = await fallbackResp.json();
          results.push(fallbackData);
          continue;
        }
        return { success: false, error: data.description || "Telegram API isteği reddetti." };
      }
      results.push(data);
    } catch (err) {
      return { success: false, error: `Telegram bağlantı hatası: ${err.message}` };
    }
  }

  return { success: true, count: chunks.length, results };
}
