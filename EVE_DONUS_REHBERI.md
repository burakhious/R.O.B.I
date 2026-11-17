# 🤖 R.O.B.I. (Robodemy Operational Brain & Intelligence) - Hızlı Devam Rehberi

Bu dosya, eve döndüğünüzde sistemi tek tıkla ayağa kaldırmak ve **Güvenlik Duvarı & Kimlik Doğrulama** korumasıyla sistemi çalıştırmak için gereken tüm bilgileri içerir.

GitHub Reposu: https://github.com/burakhious/R.O.B.I

---

## 🛡️ Güvenlik Sıkılaştırması (Kapatılan Açıklar)
1. **Şifreli Kilit Ekranı (Auth Gate):** Web arayüzü ve tüm arka plan API'leri (`/api/chat`, `/api/upload`, vb.) yönetici şifresiyle kilitlendi. Şifresiz kimse komut veremez veya dosya yükleyemez.
2. **Ham Terminal & Shell Erişimi Kapatıldı:** `execute_command` ve rastgele sunucu dosyalarını okuma/yazma yetkileri tamamen kaldırıldı. RCE (uzaktan kod yürütme) açığı kapatıldı.
3. **İç Mimari & Bilgi Sızıntısı Engellendi:** Asistanın `.env`, API anahtarları veya sunucu iç açıklarını kullanıcılara ifşa etmesi sistem promptu düzeyinde kesin kurallarla yasaklandı.
4. **Brute-Force Koruması:** 5 kez hatalı şifre giren IP adresi otomatik olarak 15 dakika boyunca kilitlenir.

---

## 1. Cloudflare Tünel Ayarı (Mevcutsa)
```bash
sudo nano /etc/cloudflared/config.yml
```
Ingress altına ekleyin:
```yaml
  - hostname: robodemy.com
    path: robi*
    service: http://localhost:3000
```
Tüneli yeniden başlatın:
```bash
sudo systemctl restart cloudflared
```

---

## 2. R.O.B.I.'yi Başlatma ve Ortam Değişkenleri (.env)

Sunucuda repoya girin:
```bash
git clone https://github.com/burakhious/R.O.B.I.git
cd R.O.B.I
nano .env
```

İçeriğe kendi API anahtarlarınızı ve tercihlerinizi girin:
```env
# --- 1. Temel Sunucu & Güvenlik ---
PORT=3000
# 🛡️ YÖNETİCİ ŞİFRENİZ (Web paneline girerken bu şifreyi yazacaksınız):
ROBI_ADMIN_PASSWORD=robodemy2026

# LLM Beyin
NVIDIA_API_KEY=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
LLM_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
LLM_FALLBACK_MODEL=meta/llama-3.1-nemotron-70b-instruct
BASE_URL=https://integrate.api.nvidia.com/v1/chat/completions
MEDIA_DIR=./media

# --- 2. Telegram Botu (Cebine Proaktif Bildirim) ---
# @BotFather ile oluşturulan token ve @userinfobot ile alınan Chat ID:
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# --- 3. E-Posta Yönetimi (IMAP & SMTP) ---
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=seninmailin@gmail.com
IMAP_PASS=xxxx-xxxx-xxxx-xxxx

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=seninmailin@gmail.com
SMTP_PASS=xxxx-xxxx-xxxx-xxxx

# --- 4. Zamanlayıcı & Sabah Brifingi ---
BRIEFING_TIME=08:30
BRIEFING_CITY=Istanbul
DISK_ALERT_THRESHOLD=85

# --- 5. n8n Otomasyon Motoru ---
N8N_BASE_URL=http://n8n:5678
```

---

## 3. Docker ile Sistemi Tek Tıkla Ayağa Kaldırma
```bash
docker compose up -d --build
```

* **R.O.B.I. Güvenli Web Paneli:** `http://SUNUCU_IP:3000` veya `https://robodemy.com/robi`
  *(Açıldığında `ROBI_ADMIN_PASSWORD` şifrenizi girerek sisteme giriş yapabilirsiniz).*
* **n8n Otomasyon Paneli:** `http://SUNUCU_IP:5678`

---

## 4. Güvenli Örnek Komutlar

### 🌅 Sabah Brifingi & Telegram:
* *"Bana bugünün sabah brifingini hazırla ve Telegram'dan ilet."*
* *(Her sabah saat 08:30'da otomatik olarak cebinize hava durumu, döviz, e-postalar ve sunucu durumu raporu gelir).*

### 📧 E-Posta Yönetimi:
* *"Son 24 saatte gelen önemli mailleri özetle."*
* *"Ahmet Bey'den yeni bir mail geldi mi, kontrol et."*
* *"Toplantı ertelemesi için Ahmet Bey'e taslak hazırla, onaylarsam gönder."*

### 🐳 Servisler & Sistem Sağlığı:
* *"Sunucuda şu an hangi Docker servisleri çalışıyor?"*
* *"Blog servisinin son 50 satır loguna bak, hata var mı?"*
* *"Sunucunun RAM, CPU ve disk durumunu raporla."*
* *"Kullanılmayan docker cache ve geçici dosyaları temizle."*

### 🎬 Video Düzenleme:
* *"Yüklediğim videoyu 9:16 Reels formatına çevir."*
* *"Videoyu 00:05 ile 00:30 arasından kesip bana ver."*
* *"Videodan sesi ayırıp MP3 olarak kaydet."*
