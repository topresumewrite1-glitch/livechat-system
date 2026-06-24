(function () {
  'use strict';

  var SERVER_URL = document.currentScript
    ? document.currentScript.src.replace('/chat.js', '')
    : window.LiveChatConfig && window.LiveChatConfig.serverUrl
    ? window.LiveChatConfig.serverUrl
    : '';

  var config = window.LiveChatConfig || {};
  var apiKey = config.apiKey;
  if (!apiKey) return console.warn('[LiveChat] No apiKey provided in LiveChatConfig');

  // Load Socket.io from server
  var script = document.createElement('script');
  script.src = SERVER_URL + '/socket.io/socket.io.js';
  script.onload = initWidget;
  document.head.appendChild(script);

  function initWidget() {
    var socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
    var conversationId = null;
    var visitorName = config.visitorName || null;
    var isOpen = false;
    var hasIdentified = false;

    // ── Inject Styles ──────────────────────────────────────
    var style = document.createElement('style');
    style.textContent = `
      #lc-widget * { box-sizing: border-box; font-family: 'Segoe UI', sans-serif; }
      #lc-btn {
        position: fixed; bottom: 24px; right: 24px;
        width: 56px; height: 56px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        border-radius: 50%; border: none; cursor: pointer;
        box-shadow: 0 4px 16px rgba(102,126,234,0.5);
        z-index: 99998; font-size: 24px;
        display: flex; align-items: center; justify-content: center;
        transition: transform 0.2s;
      }
      #lc-btn:hover { transform: scale(1.1); }
      #lc-badge {
        position: absolute; top: -4px; right: -4px;
        background: #e53e3e; color: #fff;
        border-radius: 50%; width: 18px; height: 18px;
        font-size: 11px; font-weight: 700;
        display: none; align-items: center; justify-content: center;
      }
      #lc-panel {
        position: fixed; bottom: 90px; right: 24px;
        width: 340px; height: 480px;
        background: #fff; border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.18);
        z-index: 99999; display: none;
        flex-direction: column; overflow: hidden;
      }
      #lc-panel.open { display: flex; }
      #lc-header {
        background: linear-gradient(135deg, #667eea, #764ba2);
        padding: 16px; color: #fff;
        display: flex; align-items: center; justify-content: space-between;
      }
      #lc-header .lc-title { font-weight: 700; font-size: 15px; }
      #lc-header .lc-sub { font-size: 12px; opacity: 0.85; margin-top: 2px; }
      #lc-close { background: none; border: none; color: #fff; font-size: 20px; cursor: pointer; opacity: 0.8; }
      #lc-close:hover { opacity: 1; }
      #lc-identify {
        padding: 16px;
        border-bottom: 1px solid #eee;
      }
      #lc-identify p { font-size: 13px; color: #555; margin-bottom: 10px; }
      #lc-identify input {
        width: 100%; padding: 9px 12px;
        border: 1px solid #ddd; border-radius: 8px;
        font-size: 13px; margin-bottom: 8px; outline: none;
      }
      #lc-identify input:focus { border-color: #667eea; }
      #lc-identify button {
        width: 100%; padding: 10px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff; border: none; border-radius: 8px;
        font-size: 14px; font-weight: 600; cursor: pointer;
      }
      #lc-messages {
        flex: 1; overflow-y: auto; padding: 14px;
        display: flex; flex-direction: column; gap: 8px;
        background: #f8f9ff;
      }
      .lc-msg { max-width: 80%; padding: 9px 13px; border-radius: 12px; font-size: 13px; line-height: 1.5; }
      .lc-msg.visitor { background: #fff; color: #333; align-self: flex-end; border-bottom-right-radius: 3px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
      .lc-msg.agent { background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; align-self: flex-start; border-bottom-left-radius: 3px; }
      .lc-msg-time { font-size: 10px; opacity: 0.6; margin-top: 3px; }
      .lc-msg-sender { font-size: 10px; font-weight: 700; opacity: 0.8; margin-bottom: 2px; }
      #lc-input-area {
        padding: 12px; background: #fff;
        border-top: 1px solid #eee;
        display: flex; gap: 8px;
      }
      #lc-input {
        flex: 1; padding: 9px 12px;
        border: 1px solid #ddd; border-radius: 8px;
        font-size: 13px; outline: none; resize: none;
        font-family: inherit;
      }
      #lc-input:focus { border-color: #667eea; }
      #lc-send {
        padding: 9px 14px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff; border: none; border-radius: 8px;
        cursor: pointer; font-size: 18px;
      }
      #lc-status { padding: 8px 14px; font-size: 12px; color: #888; text-align: center; border-top: 1px solid #f0f0f0; }
    `;
    document.head.appendChild(style);

    // ── Build Widget HTML ──────────────────────────────────
    var container = document.createElement('div');
    container.id = 'lc-widget';
    container.innerHTML = `
      <button id="lc-btn">
        💬
        <span id="lc-badge">1</span>
      </button>
      <div id="lc-panel">
        <div id="lc-header">
          <div>
            <div class="lc-title">${config.title || 'Chat with us'}</div>
            <div class="lc-sub">${config.subtitle || 'We usually reply in minutes'}</div>
          </div>
          <button id="lc-close">✕</button>
        </div>
        <div id="lc-identify">
          <p>Please introduce yourself:</p>
          <input type="text" id="lc-visitor-name" placeholder="Your name">
          <input type="email" id="lc-visitor-email" placeholder="Email (optional)">
          <button onclick="window._lcStartChat()">Start Chat →</button>
        </div>
        <div id="lc-messages" style="display:none"></div>
        <div id="lc-input-area" style="display:none">
          <textarea id="lc-input" placeholder="Type a message..." rows="1"></textarea>
          <button id="lc-send">➤</button>
        </div>
        <div id="lc-status" style="display:none">Connecting to agent...</div>
      </div>
    `;
    document.body.appendChild(container);

    // ── Events ─────────────────────────────────────────────
    document.getElementById('lc-btn').addEventListener('click', togglePanel);
    document.getElementById('lc-close').addEventListener('click', togglePanel);
    document.getElementById('lc-send').addEventListener('click', sendMessage);
    document.getElementById('lc-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    function togglePanel() {
      isOpen = !isOpen;
      var panel = document.getElementById('lc-panel');
      var btn = document.getElementById('lc-btn');
      if (isOpen) { panel.classList.add('open'); btn.textContent = '✕'; clearBadge(); }
      else { panel.classList.remove('open'); btn.innerHTML = '💬 <span id="lc-badge" style="display:none"></span>'; }
    }

    function clearBadge() {
      var badge = document.getElementById('lc-badge');
      if (badge) badge.style.display = 'none';
    }

    // ── Start Chat ─────────────────────────────────────────
    window._lcStartChat = function() {
      var name = document.getElementById('lc-visitor-name').value.trim() || 'Visitor';
      var email = document.getElementById('lc-visitor-email').value.trim();
      document.getElementById('lc-identify').style.display = 'none';
      document.getElementById('lc-messages').style.display = 'flex';
      document.getElementById('lc-input-area').style.display = 'flex';
      document.getElementById('lc-status').style.display = 'block';

      socket.emit('visitor:identify', { name, email });
      addMsg('agent', 'Support', config.greeting || 'Hello! How can we help you today? 👋');
    };

    // ── Socket Events ──────────────────────────────────────
    socket.on('connect', function() {
      socket.emit('visitor:init', {
        apiKey: apiKey,
        pageUrl: window.location.href,
        userAgent: navigator.userAgent
      });
    });

    socket.on('visitor:ready', function(data) {
      conversationId = data.conversationId;
      document.getElementById('lc-status').textContent = '🟢 Connected — An agent will be with you shortly';
    });

    socket.on('message:new', function(data) {
      if (data.senderType === 'agent') {
        addMsg('agent', data.senderName, data.message);
        if (!isOpen) showBadge();
      }
    });

    socket.on('disconnect', function() {
      var s = document.getElementById('lc-status');
      if (s) s.textContent = '🔴 Disconnected. Reconnecting...';
    });

    // ── Send Message ───────────────────────────────────────
    function sendMessage() {
      var input = document.getElementById('lc-input');
      var msg = input.value.trim();
      if (!msg || !conversationId) return;

      // Show identify form first if not started
      if (document.getElementById('lc-identify').style.display !== 'none') {
        window._lcStartChat();
      }

      socket.emit('visitor:message', { message: msg });
      addMsg('visitor', 'You', msg);
      input.value = '';
    }

    function addMsg(type, sender, text) {
      var area = document.getElementById('lc-messages');
      if (!area) return;
      var d = document.createElement('div');
      d.className = 'lc-msg ' + type;
      d.innerHTML = (type === 'agent' ? `<div class="lc-msg-sender">${escHtml(sender)}</div>` : '') +
        escHtml(text) + `<div class="lc-msg-time">${now()}</div>`;
      area.appendChild(d);
      area.scrollTop = area.scrollHeight;
    }

    function showBadge() {
      var badge = document.getElementById('lc-badge');
      if (badge) { badge.style.display = 'flex'; badge.textContent = '1'; }
    }

    function now() {
      return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function escHtml(str) {
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
  }
})();
