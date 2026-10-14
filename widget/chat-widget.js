/**
 * Widget de chat embebible para el chatbot de stock.
 *
 * Uso en el sitio del cliente (una sola línea):
 *   <script src="https://TU-DOMINIO/chat-widget.js"
 *           data-endpoint="https://n8n.TU-DOMINIO/webhook/chat-stock"
 *           data-clave="CLAVE_PUBLICA_DEL_COMERCIO"
 *           data-titulo="¿Tenemos lo que buscás?"
 *           data-color="#2a78d6" defer></script>
 *
 * - Sin dependencias, aislado en Shadow DOM: no hereda ni rompe los estilos del sitio.
 * - La "clave" identifica al comercio (tenant). n8n la valida contra la vista tenants_habilitados
 *   y comprueba que el Origin del pedido coincida con el dominio registrado.
 * - El id de sesión se guarda en sessionStorage para mantener el hilo de la conversación.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || window.__chatStockCargado) return;
  window.__chatStockCargado = true;

  var cfg = {
    endpoint: script.dataset.endpoint,
    clave: script.dataset.clave,
    titulo: script.dataset.titulo || "Consultá stock y precios",
    color: script.dataset.color || "#2a78d6",
  };
  if (!cfg.endpoint || !cfg.clave) {
    console.error("[chat-stock] Faltan data-endpoint o data-clave en el <script>.");
    return;
  }

  function sesion() {
    try {
      var id = sessionStorage.getItem("chat-stock-sesion");
      if (!id) {
        id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2);
        sessionStorage.setItem("chat-stock-sesion", id);
      }
      return id;
    } catch (e) {
      return "anonimo-" + Date.now();
    }
  }

  function escapar(t) {
    return String(t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var tituloSeguro = escapar(cfg.titulo);

  // Modo demo (data-endpoint="demo"): responde con un catálogo de ejemplo, sin servidor.
  // Sirve para mostrar el widget en GitHub Pages sin exponer el webhook real.
  var CATALOGO_DEMO = [
    { n: "Neumático 205/55 R16 Pirelli Cinturato P1", p: 189900, s: 6 },
    { n: "Neumático 185/65 R15 Fate Eximia Pininfarina", p: 134500, s: 0 },
    { n: "Neumático 175/70 R13 Bridgestone Ecopia", p: 118200, s: 11 },
    { n: "Aceite 5W-30 sintético 4 L", p: 52300, s: 14 },
    { n: "Cambio de aceite y filtro (servicio)", p: 38000, s: 99 },
  ];
  function respuestaDemo(texto) {
    var t = texto.toLowerCase().replace(/\s+/g, " ");
    var hits = CATALOGO_DEMO.filter(function (x) {
      return t.split(" ").some(function (w) { return w.length > 2 && x.n.toLowerCase().indexOf(w) >= 0; });
    }).slice(0, 3);
    if (!hits.length) return "No encontré ese producto. Probá con la medida (ej: 205/55 R16) o con 'aceite'.";
    return hits.map(function (x) {
      var precio = "$ " + x.p.toLocaleString("es-AR");
      return x.s > 0 ? "✓ " + x.n + ": " + precio + " (" + (x.s > 20 ? "disponible" : x.s + " en stock") + ")"
                     : "✗ " + x.n + ": sin stock por ahora";
    }).join("\n") + "\n\n(Modo demo con datos de ejemplo)";
  }
  function consultar(cuerpo, signal) {
    if (cfg.endpoint === "demo") {
      return new Promise(function (ok) {
        setTimeout(function () { ok({ ok: true, status: 200, json: function () { return { respuesta: respuestaDemo(cuerpo.mensaje) }; } }); }, 600);
      });
    }
    return fetch(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: signal,
    });
  }

  var host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483000;";
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });

  root.innerHTML =
    "<style>" +
    ":host{--c:" + cfg.color + ";font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}" +
    ".btn{width:56px;height:56px;border-radius:50%;border:0;background:var(--c);color:#fff;cursor:pointer;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.18);display:grid;place-items:center}" +
    ".btn:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--c);outline-offset:2px}" +
    ".panel{position:absolute;right:0;bottom:68px;width:min(360px,calc(100vw - 32px));height:min(520px,calc(100vh - 110px));" +
    "background:#fff;color:#141a21;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.2);display:flex;flex-direction:column;overflow:hidden}" +
    ".panel[hidden]{display:none}" +
    ".cab{background:var(--c);color:#fff;padding:12px 14px;font-weight:600;display:flex;justify-content:space-between;align-items:center}" +
    ".cab button{background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1}" +
    ".msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f5f7f9}" +
    ".m{max-width:85%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}" +
    ".u{align-self:flex-end;background:var(--c);color:#fff;border-bottom-right-radius:4px}" +
    ".a{align-self:flex-start;background:#fff;border:1px solid #e1e5ea;border-bottom-left-radius:4px}" +
    ".escribiendo{opacity:.6;font-style:italic}" +
    "form{display:flex;gap:8px;padding:10px;border-top:1px solid #e1e5ea;background:#fff}" +
    "input{flex:1;border:1px solid #d5dae0;border-radius:8px;padding:9px 10px;font:inherit;min-width:0}" +
    "form button{border:0;background:var(--c);color:#fff;border-radius:8px;padding:0 14px;font:inherit;font-weight:600;cursor:pointer}" +
    "form button:disabled{opacity:.5;cursor:default}" +
    "</style>" +
    '<div class="panel" role="dialog" aria-label="' + tituloSeguro + '" hidden>' +
    '<div class="cab"><span>' + tituloSeguro + '</span><button type="button" aria-label="Cerrar">×</button></div>' +
    '<div class="msgs" aria-live="polite"></div>' +
    '<form><input id="chat-stock-texto" autocomplete="off" placeholder="Ej: ¿tienen 205/55 R16?" aria-label="Tu consulta">' +
    '<button type="submit">Enviar</button></form></div>' +
    '<button class="btn" type="button" aria-label="Abrir chat de stock">' +
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg></button>';

  var panel = root.querySelector(".panel");
  var msgs = root.querySelector(".msgs");
  var form = root.querySelector("form");
  var input = root.querySelector("input");
  var enviar = root.querySelector("form button");

  function agregar(texto, quien, extraClase) {
    var d = document.createElement("div");
    d.className = "m " + quien + (extraClase ? " " + extraClase : "");
    d.textContent = texto; // textContent: nunca se interpreta HTML que venga del modelo
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }

  function abrir(estado) {
    panel.hidden = !estado;
    if (estado) {
      if (!msgs.childElementCount) agregar("¡Hola! Preguntame por un producto y te digo si hay stock y a qué precio.", "a");
      input.focus();
    }
  }
  root.querySelector(".btn").addEventListener("click", function () { abrir(panel.hidden); });
  root.querySelector(".cab button").addEventListener("click", function () { abrir(false); });

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var texto = input.value.trim();
    if (!texto) return;
    agregar(texto, "u");
    input.value = "";
    enviar.disabled = true;
    var espera = agregar("Buscando…", "a", "escribiendo");

    var control = new AbortController();
    var limite = setTimeout(function () { control.abort(); }, 30000);
    consultar({ clave: cfg.clave, sesion: sesion(), mensaje: texto.slice(0, 1000) }, control.signal)
      .then(function (r) {
        if (r.status === 402) throw new Error("El servicio de chat no está disponible en este momento.");
        if (!r.ok) throw new Error("No pude consultar el stock. Probá de nuevo en un minuto.");
        return r.json();
      })
      .then(function (data) { espera.remove(); agregar(data.respuesta || "No encontré una respuesta.", "a"); })
      .catch(function (err) {
        espera.remove();
        agregar(err.name === "AbortError" ? "La consulta tardó demasiado. Probá de nuevo." : err.message, "a");
      })
      .finally(function () { clearTimeout(limite); enviar.disabled = false; input.focus(); });
  });
})();
