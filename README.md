# 🚀 R.O.B.I. (Robodemy Operational Brain & Intelligence)

R.O.B.I., Linux sunucunuzda veya yerel ortamınızda çalışan; sesli, görsel, otonom, operasyonel ve **güvenlik duvarı korumalı** yapay zeka asistanınızdır.

* **Beyin / LLM:** NVIDIA Nemotron 3.5 Lightning (`nvidia/nemotron-3.5-lightning-30b-a3b` / Fallback: `meta/llama-3.1-nemotron-70b-instruct`)
* **Arayüz:** Web sitesi (Holografik Çekirdek, Sesli Yanıt / Mikrofon, Sohbet ve Video Önizleme Paneli)
* **Güvenlik Mimarisi:** Şifreli Kilit Ekranı (Auth Gate), Brute-force korumalı oturum yönetimi, kapalı terminal/dosya erişimi.
* **Kullanıcı:** Mustafa Bey için özelleştirilmiş operasyonel asistan.

---

## 🛡️ Güvenlik ve Yetkilendirme

* **Yönetici Girişi (Auth Gate):** Web arayüzü ve API'ler parola korumalıdır. `.env` içindeki `ROBI_ADMIN_PASSWORD` doğrulanmadan sisteme girilemez ve komut verilemez.
* **Brute-Force Savunması:** 5 kez hatalı şifre denemesinde IP adresi 15 dakika kilitlenir.
* **Sıfır RCE (Zero Remote Code Execution):** Doğrudan terminal (bash/shell/cmd) ve rastgele dosya okuma/yazma araçları tamamen kapatılmıştır. Sistem yalnızca parametreleri katı bir şekilde doğrulanan güvenli servisler üzerinden çalışır.
* **Sızıntı Önleme:** Asistanın `.env`, API anahtarları veya sunucu açıklarını paylaşması engellenmiştir.

---

## 🌟 Temel Yetenekler

### 1. 📧 E-Posta Entegrasyonu (IMAP & SMTP)
* **Son 24 Saati Özetleme:** "Son 24 saatte gelen önemli mailleri özetle."
* **Kişi Bazlı Takip:** "Ahmet Bey'den mail gelirse beni uyar."
* **Onaylı Taslak ve Gönderim:** "Toplantı ertelemesi için bir taslak hazırla, onaylarsam gönder."

### 2. ⏰ Dahili Zamanlayıcı (Scheduler) & n8n Entegrasyonu
* **Sabah Brifingi:** Her sabah saat 08:30'da hava durumu, döviz/borsa kurları, bekleyen e-postalar ve sunucu durumunu derler, Telegram'dan cebinize iletir.
* **n8n Entegrasyonu:** Notion, Trello, Google E-Tablolar, CRM veya sosyal medya otomasyon akışlarını `trigger_n8n_webhook` ile başlatır.

### 3. 🐳 Docker & Sistem Sağlığı
* **Aktif Servisleri Sorgulama:** "Sunucuda hangi siteler ve Docker servisleri çalışıyor?"
* **Log ve Hata Analizi:** "Blog servisinin son 50 satır loguna bak, hata var mı?"
* **Proaktif Disk Koruması:** Disk doluluğu %85'i geçerse Telegram'dan temizlik onayı ister ve `docker system prune` ile cache temizliği yapar.

### 4. 📱 Proaktif Telegram Bildirim Kanalı
* Web paneli başında değilken sunucu disk alarmlarını ve sabah brifingini doğrudan telefonunuza gönderir.

### 5. 🎬 FFmpeg ile Video Düzenleme
* 16:9 yatay videoları 9:16 dikey Reels/TikTok formatına dönüştürme (bulanık arka plan efektli).
* Hassas video kesme ve birleştirme.
* Videodan ses ayıklama (MP3).
* Video dosya boyutunu sıkıştırma.

---

## 🛠️ Linux Sunucuda Kurulum (Docker ile 2 Dakikada)

### 1. Repoyu Sunucuya Çekin:
```bash
git clone https://github.com/burakhious/R.O.B.I.git
cd R.O.B.I
```

### 2. Ortam Değişkenlerini Ayarlayın:
```bash
cp .env.example .env
nano .env
```
*(Yönetici şifrenizi `ROBI_ADMIN_PASSWORD`, NVIDIA API anahtarınızı, Telegram Bot Token/Chat ID ve e-posta ayarlarınızı girip kaydedin).*

### 3. Docker Konteynerlerini Başlatın:
```bash
docker compose up -d --build
```

* **R.O.B.I. Güvenli Web Paneli:** `http://SUNUCU_IP:3000` (veya `https://robodemy.com/robi`)
* **n8n Otomasyon Paneli:** `http://SUNUCU_IP:5678`
