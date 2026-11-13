# 🚀 R.O.B.I. (Robodemy Operational Brain & Intelligence)

R.O.B.I., evinizdeki Linux sunucuda çalışan; sesli, görsel ve operasyonel yapay zeka asistanınızdır.

* **Beyin / LLM:** NVIDIA Nemotron 3.5 Lightning (`nvidia/nemotron-3.5-lightning-30b-a3b`)
* **Arayüz:** Web sitesi (Holografik Çekirdek, Sesli Yanıt / Mikrofon, Sohbet ve Video Önizleme)
* **Yetenekler:** Sunucu yönetimi, terminal komutları, dosya okuma/yazma ve **FFmpeg ile Video Düzenleme** (kesme, 16:9'dan 9:16 Reels/TikTok formatına dönüştürme, ses ayıklama, video sıkıştırma).

---

## 🛠️ Linux Sunucuda Kurulum (Docker ile 2 Dakikada)

### 1. Repoyu Sunucuya Çekin:
```bash
git clone https://github.com/KULLANICI_ADINIZ/robi.git
cd robi
```

### 2. Ortam Değişkenlerini Ayarlayın:
`.env` dosyasını oluşturun veya düzenleyin:
```bash
cp .env.example .env
nano .env
```
*(NVIDIA API anahtarınızı girip Ctrl+O ve Enter ile kaydedin, Ctrl+X ile çıkın).*

### 3. Docker Konteynerini Başlatın:
```bash
docker compose up -d --build
```

Sunucu açıldığında `http://SUNUCU_IP:3000` adresinden R.O.B.I.'ye anında erişebilirsiniz!

---

## 🌐 Cloudflare Tunnel ile Dünyaya Açma

Eğer sunucunuzda zaten Cloudflare Tunnel (`cloudflared`) kuruluysa:

1. Cloudflare Zero Trust paneline girin: **Networks > Tunnels**.
2. Mevcut tünelinizi seçip **Public Hostname** ekleyin:
   * **Subdomain:** `robi`
   * **Domain:** `seninalanadin.com`
   * **Service:** `HTTP://localhost:3000`
3. Kaydettiğinizde artık telefonunuzdan veya herhangi bir tarayıcıdan **`https://robi.seninalanadin.com`** adresine girerek R.O.B.I. ile konuşabilirsiniz!

---

## 🎬 Video Düzenleme Örnek Komutları

Arayüzdeki **"Video Yükle"** butonundan bir video yükledikten sonra R.O.B.I.'ye şunları söyleyebilirsiniz:

* *"Yüklediğim videoyu 9:16 Reels formatına çevir, arka planı bulanıklaştır."*
* *"Videoyu 00:05 ile 00:30 arasından kesip bana ver."*
* *"Videonun içindeki sesi ayırıp MP3 olarak kaydet."*
* *"Sunucu durumunu, RAM ve işlemciyi kontrol et."*
