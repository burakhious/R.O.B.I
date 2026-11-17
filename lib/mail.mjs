// lib/mail.mjs - R.O.B.I. E-Posta Yönetimi (IMAP/SMTP)
// Harici kütüphane gerektirmez (Node.js TLS/Net soketleri üzerinden doğrudan çalışır)

import tls from "node:tls";
import net from "node:net";

export function isMailConfigured() {
  const user = process.env.IMAP_USER || process.env.EMAIL_USER;
  const pass = process.env.IMAP_PASS || process.env.EMAIL_PASS;
  return Boolean(user && pass && user.trim() !== "" && pass.trim() !== "");
}

/**
 * IMAP üzerinden son gelen veya okunmamış e-postaları sorgular.
 */
export async function checkInbox({ limit = 5, unreadOnly = false, filterSender = "" } = {}) {
  const host = process.env.IMAP_HOST || process.env.EMAIL_HOST || "imap.gmail.com";
  const port = parseInt(process.env.IMAP_PORT || process.env.EMAIL_PORT || "993", 10);
  const user = process.env.IMAP_USER || process.env.EMAIL_USER;
  const pass = process.env.IMAP_PASS || process.env.EMAIL_PASS;

  if (!isMailConfigured()) {
    return {
      success: false,
      configured: false,
      message: "[E-Posta Yapılandırması Eksik]: E-postalarınızı okuyabilmem için lütfen .env dosyasına IMAP_HOST (örn: imap.gmail.com), IMAP_USER ve IMAP_PASS (Gmail Uygulama Şifresi) bilgilerini tanımlayın."
    };
  }

  const maxEmails = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20);

  return new Promise((resolve) => {
    let timer = setTimeout(() => {
      safeEnd();
      resolve({ success: false, message: "[Hata]: IMAP sunucusuna bağlanırken zaman aşımı oluştu." });
    }, 15000);

    let socket;
    try {
      socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, onConnected);
    } catch (err) {
      clearTimeout(timer);
      return resolve({ success: false, message: `IMAP bağlantı hatası: ${err.message}` });
    }

    let buffer = "";
    let step = 0; // 0: greeting, 1: login, 2: select inbox, 3: search, 4: fetch, 5: done
    let emailIds = [];
    let fetchedMails = [];

    function safeEnd() {
      try {
        if (socket && !socket.destroyed) {
          socket.write("A99 LOGOUT\r\n");
          socket.end();
        }
      } catch {}
    }

    function onConnected() {
      // Bağlantı kuruldu, selamlama bekleniyor
    }

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf-8");

      if (step === 0 && buffer.includes("* OK")) {
        step = 1;
        buffer = "";
        socket.write(`A01 LOGIN "${user}" "${pass}"\r\n`);
      } else if (step === 1 && (buffer.includes("A01 OK") || buffer.includes("A01 NO") || buffer.includes("A01 BAD"))) {
        if (!buffer.includes("A01 OK")) {
          clearTimeout(timer);
          safeEnd();
          return resolve({ success: false, message: "[IMAP Giriş Hatası]: Kullanıcı adı veya uygulama şifresi hatalı." });
        }
        step = 2;
        buffer = "";
        socket.write("A02 SELECT INBOX\r\n");
      } else if (step === 2 && buffer.includes("A02 OK")) {
        step = 3;
        buffer = "";
        const searchCriteria = unreadOnly ? "UNSEEN" : "ALL";
        socket.write(`A03 SEARCH ${searchCriteria}\r\n`);
      } else if (step === 3 && buffer.includes("A03 OK")) {
        const searchLine = buffer.split("\n").find(l => l.startsWith("* SEARCH"));
        buffer = "";
        if (!searchLine) {
          clearTimeout(timer);
          safeEnd();
          return resolve({ success: true, count: 0, mails: [], summary: "Gelen kutunuzda kriterlere uygun e-posta bulunamadı." });
        }

        const ids = searchLine.replace("* SEARCH", "").trim().split(/\s+/).filter(Boolean);
        if (ids.length === 0) {
          clearTimeout(timer);
          safeEnd();
          return resolve({ success: true, count: 0, mails: [], summary: "Gelen kutunuzda okunmamış/bekleyen e-posta bulunmuyor." });
        }

        // Son N adedini al
        emailIds = ids.slice(-maxEmails);
        step = 4;
        const fetchCmd = `A04 FETCH ${emailIds.join(",")} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] FLAGS)\r\n`;
        socket.write(fetchCmd);
      } else if (step === 4 && buffer.includes("A04 OK")) {
        clearTimeout(timer);
        safeEnd();

        // Header parçalama
        const rawMails = buffer.split(/\* \d+ FETCH/);
        for (const item of rawMails) {
          if (!item.trim()) continue;
          const fromMatch = item.match(/From:\s*(.+)/i);
          const subjMatch = item.match(/Subject:\s*(.+)/i);
          const dateMatch = item.match(/Date:\s*(.+)/i);
          const isUnread = !item.includes("\\Seen");

          const from = fromMatch ? decodeMime(fromMatch[1].trim()) : "Bilinmiyor";
          const subject = subjMatch ? decodeMime(subjMatch[1].trim()) : "(Konusuz)";
          const date = dateMatch ? dateMatch[1].trim() : "Bilinmiyor";

          if (filterSender && !from.toLowerCase().includes(filterSender.toLowerCase())) {
            continue;
          }

          fetchedMails.push({ from, subject, date, isUnread });
        }

        resolve({
          success: true,
          count: fetchedMails.length,
          mails: fetchedMails,
          summary: fetchedMails.map((m, i) => `${i + 1}. [${m.isUnread ? "OKUNMAMIŞ" : "Okunmuş"}] Kimden: ${m.from}\n   Konu: ${m.subject}\n   Tarih: ${m.date}`).join("\n\n")
        });
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, message: `IMAP Soket Hatası: ${err.message}` });
    });
  });
}

/**
 * SMTP üzerinden e-posta gönderir.
 */
export async function sendEmail({ to, subject, body } = {}) {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const user = process.env.SMTP_USER || process.env.IMAP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.IMAP_PASS || process.env.EMAIL_PASS;

  if (!user || !pass) {
    return {
      success: false,
      message: "[SMTP Hatası]: E-posta gönderebilmek için .env dosyasında SMTP_USER ve SMTP_PASS (veya IMAP_USER/PASS) tanımlanmalıdır."
    };
  }

  if (!to || !subject || !body) {
    return { success: false, message: "[Hata]: Alıcı adresi (to), konu (subject) ve mesaj içeriği (body) zorunludur." };
  }

  return new Promise((resolve) => {
    let timer = setTimeout(() => {
      safeClose();
      resolve({ success: false, message: "[Hata]: SMTP sunucusuna bağlanırken zaman aşımı oluştu." });
    }, 20000);

    let socket;
    try {
      socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, onConnected);
    } catch (err) {
      clearTimeout(timer);
      return resolve({ success: false, message: `SMTP bağlantı hatası: ${err.message}` });
    }

    let step = 0;
    function safeClose() {
      try {
        if (socket && !socket.destroyed) {
          socket.write("QUIT\r\n");
          socket.end();
        }
      } catch {}
    }

    function onConnected() {}

    socket.on("data", (chunk) => {
      const resp = chunk.toString("utf-8");

      if (step === 0 && resp.startsWith("220")) {
        step = 1;
        socket.write(`EHLO robi.local\r\n`);
      } else if (step === 1 && resp.startsWith("250")) {
        step = 2;
        socket.write("AUTH LOGIN\r\n");
      } else if (step === 2 && resp.startsWith("334")) {
        step = 3;
        socket.write(Buffer.from(user).toString("base64") + "\r\n");
      } else if (step === 3 && resp.startsWith("334")) {
        step = 4;
        socket.write(Buffer.from(pass).toString("base64") + "\r\n");
      } else if (step === 4 && resp.startsWith("235")) {
        step = 5;
        socket.write(`MAIL FROM:<${user}>\r\n`);
      } else if (step === 5 && resp.startsWith("250")) {
        step = 6;
        socket.write(`RCPT TO:<${to}>\r\n`);
      } else if (step === 6 && resp.startsWith("250")) {
        step = 7;
        socket.write("DATA\r\n");
      } else if (step === 7 && resp.startsWith("354")) {
        step = 8;
        const msg = [
          `From: "R.O.B.I. Asistanı" <${user}>`,
          `To: <${to}>`,
          `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
          "MIME-Version: 1.0",
          "Content-Type: text/plain; charset=UTF-8",
          "",
          body,
          "",
          ".\r\n"
        ].join("\r\n");
        socket.write(msg);
      } else if (step === 8 && resp.startsWith("250")) {
        clearTimeout(timer);
        safeClose();
        resolve({
          success: true,
          message: `[Başarılı]: E-posta '${to}' adresine başarıyla gönderildi.\nKonu: ${subject}`
        });
      } else if (resp.startsWith("5") || resp.startsWith("4")) {
        clearTimeout(timer);
        safeClose();
        resolve({ success: false, message: `SMTP Sunucu Reddi: ${resp.trim()}` });
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, message: `SMTP Soket Hatası: ${err.message}` });
    });
  });
}

/**
 * Kullanıcı onayı için e-posta taslağı hazırlar (göndermeden önce gösterir).
 */
export function prepareEmailDraft({ to, subject, body }) {
  return [
    `📝 **E-Posta Taslağı Hazırlandı (Onayınız Bekleniyor)**`,
    `----------------------------------------------------`,
    `📬 **Alıcı:** ${to}`,
    `📌 **Konu:** ${subject}`,
    `📄 **İçerik:**`,
    body,
    `----------------------------------------------------`,
    `*Mustafa Bey, taslak uygunsa onayınızı verdiğiniz anda e-postayı göndereceğim.*`
  ].join("\n");
}

function decodeMime(text) {
  if (!text) return "";
  return text.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b64) => {
    try {
      return Buffer.from(b64, "base64").toString("utf-8");
    } catch {
      return b64;
    }
  }).replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (_, q) => {
    try {
      return q.replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    } catch {
      return q;
    }
  });
}
