// lib/n8n.mjs - R.O.B.I. n8n Entegrasyon Modülü
// Harici paket gerektirmez

export async function triggerN8nWebhook(webhookPath, payload = {}) {
  const baseUrl = (process.env.N8N_BASE_URL || "http://localhost:5678").replace(/\/$/, "");
  const cleanPath = String(webhookPath || "").replace(/^\//, "");

  if (!cleanPath) {
    return {
      success: false,
      message: "[Hata]: Lütfen tetiklenecek n8n webhook adını veya yolunu belirtin (örn: 'notion-sync' veya 'crm-lead')."
    };
  }

  const url = `${baseUrl}/webhook/${cleanPath}`;
  const apiKey = process.env.N8N_API_KEY;

  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
      headers["X-N8N-API-KEY"] = apiKey;
    }

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...payload,
        triggered_by: "ROBI",
        timestamp: new Date().toISOString()
      }),
      signal: AbortSignal.timeout(15000)
    });

    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (resp.ok) {
      return {
        success: true,
        statusCode: resp.status,
        message: `[n8n Başarılı]: '${cleanPath}' webhook'u başarıyla tetiklendi.`,
        data
      };
    } else {
      return {
        success: false,
        statusCode: resp.status,
        message: `[n8n Hatası - ${resp.status}]: ${typeof data === "string" ? data : JSON.stringify(data)}`
      };
    }
  } catch (err) {
    return {
      success: false,
      message: `[n8n Bağlantı Hatası]: ${url} adresine ulaşılamadı. n8n servisinin çalıştığından emin olun (${err.message}).`
    };
  }
}
