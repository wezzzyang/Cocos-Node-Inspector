/**
 * Service worker message hub:
 * Panel  --port panel-{tabId}-->  SW  --tabs.sendMessage / content port-->  Content
 * Content --port content-{tabId}--> SW --> Panel
 */

/** @type {Map<number, Set<chrome.runtime.Port>>} */
const panelPorts = new Map();
/** @type {Map<number, chrome.runtime.Port>} */
const contentPorts = new Map();

function getPanelSet(tabId) {
  let set = panelPorts.get(tabId);
  if (!set) {
    set = new Set();
    panelPorts.set(tabId, set);
  }
  return set;
}

function broadcastToPanels(tabId, msg) {
  const set = panelPorts.get(tabId);
  if (!set) return;
  set.forEach((port) => {
    try {
      port.postMessage(msg);
    } catch (_) {
      set.delete(port);
    }
  });
}

function forwardToContent(tabId, msg) {
  const contentPort = contentPorts.get(tabId);
  if (contentPort) {
    try {
      contentPort.postMessage(msg);
      return;
    } catch (_) {
      contentPorts.delete(tabId);
    }
  }
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

chrome.runtime.onConnect.addListener((port) => {
  const name = port.name || '';

  if (name.startsWith('panel-')) {
    const tabId = Number(name.slice('panel-'.length));
    if (!Number.isFinite(tabId)) return;

    getPanelSet(tabId).add(port);
    chrome.tabs.sendMessage(tabId, { type: 'PANEL_ATTACHED' }).catch(() => {});

    port.onMessage.addListener((msg) => {
      if (!msg) return;
      forwardToContent(tabId, {
        from: 'panel',
        type: msg.type,
        id: msg.id,
        payload: msg.payload,
      });
    });

    port.onDisconnect.addListener(() => {
      const set = panelPorts.get(tabId);
      if (set) {
        set.delete(port);
        if (set.size === 0) {
          panelPorts.delete(tabId);
          forwardToContent(tabId, { from: 'panel', type: 'PANEL_CLOSED' });
        }
      }
    });

    port.postMessage({ from: 'sw', type: 'SW_HELLO', payload: { tabId } });
    return;
  }

  if (name.startsWith('content-')) {
    const tabId = Number(name.slice('content-'.length));
    if (!Number.isFinite(tabId)) return;

    contentPorts.set(tabId, port);

    port.onMessage.addListener((msg) => {
      if (!msg) return;
      // Normalize CONTENT_HELLO
      if (msg.type === 'CONTENT_HELLO') {
        broadcastToPanels(tabId, {
          from: 'content',
          type: 'CONTENT_HELLO',
          payload: msg.payload,
        });
        return;
      }
      broadcastToPanels(tabId, {
        from: 'page',
        type: msg.type,
        id: msg.id,
        payload: msg.payload,
        error: msg.error,
      });
    });

    port.onDisconnect.addListener(() => {
      if (contentPorts.get(tabId) === port) contentPorts.delete(tabId);
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'CONTENT_REGISTER') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'no tab' });
      return false;
    }
    sendResponse({ ok: true, tabId: tabId });
    return false;
  }

  if (message.from === 'content' && sender.tab && sender.tab.id != null) {
    broadcastToPanels(sender.tab.id, {
      from: message.type === 'CONTENT_HELLO' ? 'content' : 'page',
      type: message.type,
      id: message.id,
      payload: message.payload,
      error: message.error,
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'INJECT_BRIDGE' && sender.tab && sender.tab.id != null) {
    chrome.scripting
      .executeScript({
        target: { tabId: sender.tab.id },
        files: [
          'src/injected/serializer.js',
          'src/injected/mutator.js',
          'src/injected/picker.js',
          'src/injected/bridge.js',
        ],
        world: 'MAIN',
      })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});
