/**
 * Content script (isolated world): inject MAIN bridge + relay via SW.
 * Guards against "Extension context invalidated" after reload.
 */
(function () {
  const SOURCE = 'CC_NODE_INSPECTOR';
  const PAGE_SOURCE = 'CC_NODE_INSPECTOR_PAGE';

  let bridgeReady = false;
  let injectAttempted = false;
  let dead = false;
  /** @type {chrome.runtime.Port|null} */
  let swPort = null;

  function isExtensionAlive() {
    try {
      return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  function markDead() {
    if (dead) return;
    dead = true;
    swPort = null;
  }

  function connectToSw(tabId) {
    if (dead || !isExtensionAlive()) {
      markDead();
      return;
    }
    if (swPort) {
      try {
        swPort.disconnect();
      } catch (_) {}
    }
    try {
      swPort = chrome.runtime.connect({ name: 'content-' + tabId });
    } catch (_) {
      markDead();
      return;
    }
    swPort.onMessage.addListener((msg) => {
      if (!msg || dead) return;
      if (msg.type === 'PANEL_CLOSED') {
        postToPage({ type: 'PANEL_CLOSED' });
        return;
      }
      if (msg.type === 'ENSURE_INJECT') {
        injectAttempted = false;
        document.documentElement.dataset.ccNodeInspector = '';
        ensureInjected();
        return;
      }
      postToPage({
        type: msg.type,
        id: msg.id,
        payload: msg.payload,
      });
    });
    swPort.onDisconnect.addListener(() => {
      swPort = null;
      if (!isExtensionAlive()) markDead();
    });
  }

  function emitToExtension(msg) {
    if (dead || !isExtensionAlive()) {
      markDead();
      return;
    }
    if (swPort) {
      try {
        swPort.postMessage(msg);
        return;
      } catch (_) {
        swPort = null;
        if (!isExtensionAlive()) {
          markDead();
          return;
        }
      }
    }
    try {
      chrome.runtime.sendMessage(
        {
          from: 'content',
          type: msg.type,
          id: msg.id,
          payload: msg.payload,
          error: msg.error,
        },
        () => {
          if (chrome.runtime.lastError) {
            const err = chrome.runtime.lastError.message || '';
            if (err.indexOf('Extension context invalidated') !== -1 || err.indexOf('context') !== -1) {
              markDead();
            }
          }
        }
      );
    } catch (_) {
      markDead();
    }
  }

  function injectViaScriptTags() {
    if (dead || !isExtensionAlive()) {
      markDead();
      return Promise.resolve();
    }
    if (document.documentElement.dataset.ccNodeInspector === '1') {
      return Promise.resolve();
    }
    document.documentElement.dataset.ccNodeInspector = '1';

    const files = [
      'src/injected/serializer.js',
      'src/injected/mutator.js',
      'src/injected/picker.js',
      'src/injected/bridge.js',
    ];

    let chain = Promise.resolve();
    files.forEach((file) => {
      chain = chain.then(
        () =>
          new Promise((resolve, reject) => {
            if (!isExtensionAlive()) {
              markDead();
              resolve();
              return;
            }
            const s = document.createElement('script');
            try {
              s.src = chrome.runtime.getURL(file);
            } catch (_) {
              markDead();
              resolve();
              return;
            }
            s.onload = () => {
              s.remove();
              resolve();
            };
            s.onerror = () => reject(new Error('Failed to load ' + file));
            (document.head || document.documentElement).appendChild(s);
          })
      );
    });

    return chain.catch((err) => {
      if (dead || !isExtensionAlive()) return null;
      console.warn('[CocosNode] script tag inject failed, trying SW', err);
      document.documentElement.dataset.ccNodeInspector = '';
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: 'INJECT_BRIDGE' }, (resp) => {
            if (chrome.runtime.lastError) {
              markDead();
              resolve(null);
              return;
            }
            if (resp && resp.ok) {
              document.documentElement.dataset.ccNodeInspector = '1';
            }
            resolve(resp);
          });
        } catch (_) {
          markDead();
          resolve(null);
        }
      });
    });
  }

  function ensureInjected() {
    if (dead) return;
    if (injectAttempted && document.documentElement.dataset.ccNodeInspector === '1') {
      postToPage({ type: 'PING' });
      return;
    }
    injectAttempted = true;
    injectViaScriptTags().then(() => {
      if (!dead) postToPage({ type: 'PING' });
    });
  }

  /** 任意 IP/域名：先轻量探测 window.cc，确认是 Cocos 再注入完整桥（避免污染普通网页） */
  function injectCcProbe() {
    if (dead || !isExtensionAlive()) return;
    if (document.documentElement.dataset.ccNodeInspectorProbe === '1') return;
    document.documentElement.dataset.ccNodeInspectorProbe = '1';
    try {
      const s = document.createElement('script');
      s.textContent =
        '(function(){try{' +
        'function ok(){try{return typeof cc!=="undefined"&&cc&&cc.director;}catch(e){return false;}}' +
        'function emit(){window.postMessage({source:"CC_NODE_INSPECTOR_PAGE",type:"CC_PROBE_OK"},"*");}' +
        'if(ok()){emit();return;}' +
        'var n=0,t=setInterval(function(){if(ok()){clearInterval(t);emit();}else if(++n>120)clearInterval(t);},250);' +
        '}catch(e){}})();';
      (document.documentElement || document.head).appendChild(s);
      s.remove();
    } catch (_) {}
  }

  function postToPage(msg) {
    window.postMessage(
      {
        source: SOURCE,
        ...msg,
      },
      '*'
    );
  }

  window.addEventListener('message', (event) => {
    if (dead) return;
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== PAGE_SOURCE) return;

    if (data.type === 'CC_PROBE_OK') {
      ensureInjected();
      return;
    }

    if (data.type === 'CC_READY') {
      bridgeReady = true;
      // 仅在真正检测到 cc 的 frame 注册，避免 all_frames 下空页面抢消息
      if (!swPort) discoverTabAndConnect();
    }

    emitToExtension({
      type: data.type,
      id: data.id,
      payload: data.payload,
      error: data.error,
    });
  });

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (dead || !isExtensionAlive()) {
        markDead();
        return false;
      }
      if (!msg) return false;

      if (msg.type === 'PANEL_ATTACHED') {
        ensureInjected();
        if (bridgeReady) discoverTabAndConnect();
        else postToPage({ type: 'PING' });
        sendResponse({ ok: true });
        return false;
      }

      if (msg.from === 'panel') {
        if (msg.type === 'ENSURE_INJECT') {
          injectAttempted = false;
          document.documentElement.dataset.ccNodeInspector = '';
          ensureInjected();
          sendResponse({ ok: true });
          return false;
        }
        if (msg.type === 'PANEL_CLOSED') {
          postToPage({ type: 'PANEL_CLOSED' });
          sendResponse({ ok: true });
          return false;
        }
        // 无 cc 的 iframe/顶层不处理业务命令
        if (!bridgeReady && msg.type !== 'PING') {
          sendResponse({ ok: false, error: 'no cc in this frame' });
          return false;
        }
        postToPage({
          type: msg.type,
          id: msg.id,
          payload: msg.payload,
        });
        sendResponse({ ok: true });
        return false;
      }

      return false;
    });
  } catch (_) {
    markDead();
  }

  function discoverTabAndConnect() {
    if (dead || !isExtensionAlive()) {
      markDead();
      return;
    }
    if (swPort) return;
    try {
      chrome.runtime.sendMessage({ type: 'CONTENT_REGISTER' }, (resp) => {
        if (chrome.runtime.lastError) {
          markDead();
          return;
        }
        if (resp && resp.tabId != null) {
          connectToSw(resp.tabId);
          emitToExtension({
            type: 'CONTENT_HELLO',
            payload: { bridgeReady: bridgeReady },
          });
          if (bridgeReady) {
            emitToExtension({ type: 'CC_READY', payload: {} });
          } else {
            postToPage({ type: 'PING' });
          }
        }
      });
    } catch (_) {
      markDead();
    }
  }

  function boot() {
    if (!isExtensionAlive()) {
      markDead();
      return;
    }
    // 任意 http(s) 预览（含局域网 IP）：探测到 Cocos 或面板打开后再注入
    injectCcProbe();
    setTimeout(function () {
      if (!dead) postToPage({ type: 'PING' });
    }, 300);
    setTimeout(function () {
      if (!dead && bridgeReady && !swPort) discoverTabAndConnect();
    }, 1500);
  }

  if (document.documentElement) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
