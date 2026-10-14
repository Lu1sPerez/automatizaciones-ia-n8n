# Workflows de n8n

Acá van los workflows exportados desde n8n, en JSON, para que cualquiera pueda importarlos.

## Cómo exportarlos sin filtrar secretos

1. En n8n, abrir el workflow → menú `⋯` → **Download**. Se descarga un `.json`.
2. n8n **no** incluye las claves de las credenciales en el export, pero sí sus nombres e IDs, las URLs de webhook y cualquier valor escrito a mano en los nodos. Antes de subirlo, revisar y reemplazar:
   - números de teléfono reales, tokens de WhatsApp o de Stripe pegados en nodos HTTP
   - URLs de tu VPS o dominio (`https://n8n.midominio.com` → `https://n8n.ejemplo.com`)
   - `tenant_id` o datos de clientes reales en nodos de prueba ("pinned data")
3. Buscar en el archivo antes de hacer commit:
   ```bash
   grep -nE "sk_live|sk_test|Bearer |EAAG|@gmail|\+54" *.json
   ```
4. Guardar cada uno con un nombre claro:
   - `whatsapp-asistente-shopper.json`
   - `chat-stock-web.json`
   - `stripe-webhook-suscripciones.json`

## Para importarlos

En n8n: **Workflows → Import from File**, y después asignar las credenciales propias (Supabase, proveedor de IA, WhatsApp Cloud API, Stripe).
