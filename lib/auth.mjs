// lib/auth.mjs - R.O.B.I. Güvenlik ve Kimlik Doğrulama Modülü
import crypto from "node:crypto";

const SESSIONS = new Map(); // token -> { token, ip, createdAt, expiresAt }
const FAILED_ATTEMPTS = new Map(); // ip -> { count, lockedUntil }

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 dakika
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün

function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getClientIp(req) {
  const cfIp = req.headers["cf-connecting-ip"];
  if (cfIp) return String(cfIp).trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket?.remoteAddress || "127.0.0.1";
}

export function getMasterPassword() {
  return process.env.ROBI_ADMIN_PASSWORD || process.env.ROBI_PASSWORD || "robodemy2026";
}

/**
 * Giriş işlemi ve brute-force koruması
 */
export function authenticate(password, ip = "127.0.0.1") {
  const now = Date.now();
  const attemptInfo = FAILED_ATTEMPTS.get(ip);

  // Kilitlenme kontrolü
  if (attemptInfo && attemptInfo.lockedUntil && now < attemptInfo.lockedUntil) {
    const remainingMins = Math.ceil((attemptInfo.lockedUntil - now) / 60000);
    return {
      success: false,
      error: `Çok fazla hatalı giriş denemesi! Güvenlik nedeniyle ${remainingMins} dakika boyunca kilitlendiniz.`
    };
  }

  const expectedPassword = getMasterPassword();
  const isValid = safeCompare(password || "", expectedPassword);

  if (!isValid) {
    const prevCount = (attemptInfo?.count || 0) + 1;
    let lockedUntil = null;
    if (prevCount >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = now + LOCKOUT_MS;
      console.warn(`[GÜVENLİK ALARMI]: ${ip} adresinden 5 kez hatalı şifre denendi. IP 15 dakika kilitlendi.`);
    }
    FAILED_ATTEMPTS.set(ip, { count: prevCount, lockedUntil });

    return {
      success: false,
      error: lockedUntil
        ? `5 kez hatalı şifre girildi! Erişiminiz 15 dakika askıya alındı.`
        : `Hatalı yetkili şifresi! (Kalan deneme: ${MAX_FAILED_ATTEMPTS - prevCount})`
    };
  }

  // Başarılı giriş: Hatalı denemeleri temizle
  FAILED_ATTEMPTS.delete(ip);

  // Kriptografik güvenli oturum token'ı oluştur (64 karakter)
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = now + SESSION_DURATION_MS;

  SESSIONS.set(token, {
    token,
    ip,
    createdAt: now,
    expiresAt
  });

  return {
    success: true,
    token,
    expiresAt
  };
}

/**
 * İstek başlıklarından token'ı doğrular
 */
export function verifySession(req) {
  const authHeader = req.headers["authorization"] || "";
  let token = "";

  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (req.headers["x-robi-token"]) {
    token = String(req.headers["x-robi-token"]).trim();
  } else if (req.headers["cookie"]) {
    const match = req.headers["cookie"].match(/robi_token=([a-f0-9]{64})/i);
    if (match) token = match[1];
  }

  if (!token || !SESSIONS.has(token)) {
    return false;
  }

  const session = SESSIONS.get(token);
  if (Date.now() > session.expiresAt) {
    SESSIONS.delete(token);
    return false;
  }

  return true;
}

/**
 * Oturumu sonlandırır
 */
export function invalidateSession(req) {
  const authHeader = req.headers["authorization"] || "";
  let token = "";
  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (req.headers["x-robi-token"]) {
    token = String(req.headers["x-robi-token"]).trim();
  }
  if (token && SESSIONS.has(token)) {
    SESSIONS.delete(token);
  }
}
