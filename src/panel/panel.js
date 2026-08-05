/**
 * DevTools panel controller: Port to content script, wire tree + inspector.
 * Remembers last selected node per scene (chrome.storage.local).
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ccNodeLastByScene';
  const FONT_SCALE_KEY = 'ccNodeFontScale';
  const FONT_WEIGHT_KEY = 'ccNodeFontWeight';
  const THEME_KEY = 'ccNodeTheme';
  const tabId = chrome.devtools.inspectedWindow.tabId;
  let port = null;
  let rpcSeq = 1;
  const pending = new Map();

  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const treeRoot = document.getElementById('treeRoot');
  const inspectorRoot = document.getElementById('inspectorRoot');
  const searchInput = document.getElementById('searchInput');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnDownloadAssets = document.getElementById('btnDownloadAssets');
  const btnPick = document.getElementById('btnPick');
  const pollToggle = document.getElementById('pollToggle');
  const pollInterval = document.getElementById('pollInterval');
  const fontScaleInput = document.getElementById('fontScale');
  const fontScaleVal = document.getElementById('fontScaleVal');
  const fontWeightInput = document.getElementById('fontWeight');
  const fontWeightVal = document.getElementById('fontWeightVal');
  const themeToggle = document.getElementById('themeToggle');
  const btnHelp = document.getElementById('btnHelp');
  const helpOverlay = document.getElementById('helpOverlay');
  const helpBody = document.getElementById('helpBody');
  const helpClose = document.getElementById('helpClose');

  let connected = false;
  let selectedUuid = null;
  let currentSceneUuid = null;
  let currentSceneName = null;
  /** scene key we already tried to restore for (avoid repeat every poll) */
  let restoredForSceneKey = null;
  let currentTheme = 'dark';
  let pickMode = false;

  function isExtensionAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  function applyTheme(theme) {
    currentTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    if (themeToggle) {
      themeToggle.textContent = currentTheme === 'light' ? '浅色' : '深色';
      themeToggle.title = currentTheme === 'light' ? '当前浅色，点击切换深色' : '当前深色，点击切换浅色';
    }
  }

  function loadTheme() {
    chrome.storage.local.get([THEME_KEY], function (data) {
      applyTheme(data[THEME_KEY] || 'dark');
    });
  }

  function saveTheme(theme) {
    const obj = {};
    obj[THEME_KEY] = theme;
    chrome.storage.local.set(obj);
  }

  function applyFontScale(scale) {
    const s = Math.max(0.85, Math.min(1.6, Number(scale) || 1));
    document.documentElement.style.setProperty('--font-scale', String(s));
    if (fontScaleInput) fontScaleInput.value = String(s);
    if (fontScaleVal) fontScaleVal.textContent = Math.round(s * 100) + '%';
  }

  function loadFontScale() {
    chrome.storage.local.get([FONT_SCALE_KEY], function (data) {
      applyFontScale(data[FONT_SCALE_KEY] != null ? data[FONT_SCALE_KEY] : 1.1);
    });
  }

  function saveFontScale(scale) {
    const obj = {};
    obj[FONT_SCALE_KEY] = scale;
    chrome.storage.local.set(obj);
  }

  function applyFontWeight(weight) {
    var w = Math.round(Number(weight) || 700);
    if (w < 400) w = 400;
    if (w > 800) w = 800;
    // 对齐到 50 的步进
    w = Math.round(w / 50) * 50;
    var strong = Math.min(900, w + 100);
    document.documentElement.style.setProperty('--font-weight', String(w));
    document.documentElement.style.setProperty('--font-weight-strong', String(strong));
    if (fontWeightInput) fontWeightInput.value = String(w);
    if (fontWeightVal) fontWeightVal.textContent = String(w);
  }

  function loadFontWeight() {
    chrome.storage.local.get([FONT_WEIGHT_KEY], function (data) {
      applyFontWeight(data[FONT_WEIGHT_KEY] != null ? data[FONT_WEIGHT_KEY] : 700);
    });
  }

  function saveFontWeight(weight) {
    const obj = {};
    obj[FONT_WEIGHT_KEY] = weight;
    chrome.storage.local.set(obj);
  }

  function setStatus(kind, text) {
    statusDot.className = 'dot ' + (kind || '');
    statusText.textContent = text;
  }

  function sceneStorageKeys(sceneUuid, sceneName) {
    const keys = [];
    if (sceneUuid) keys.push('uuid:' + sceneUuid);
    if (sceneName) keys.push('name:' + sceneName);
    return keys;
  }

  function rememberSelection(uuid) {
    if (!uuid) return;
    const path = treeView.getPathToUuid(uuid);
    const record = {
      uuid: uuid,
      path: path || [],
      sceneUuid: currentSceneUuid,
      sceneName: currentSceneName,
      savedAt: Date.now(),
    };
    chrome.storage.local.get([STORAGE_KEY], function (data) {
      const map = data[STORAGE_KEY] || {};
      const keys = sceneStorageKeys(currentSceneUuid, currentSceneName);
      if (!keys.length) return;
      for (let i = 0; i < keys.length; i++) map[keys[i]] = record;
      const obj = {};
      obj[STORAGE_KEY] = map;
      chrome.storage.local.set(obj);
    });
  }

  function loadSavedRecord(sceneUuid, sceneName, cb) {
    chrome.storage.local.get([STORAGE_KEY], function (data) {
      const map = data[STORAGE_KEY] || {};
      const keys = sceneStorageKeys(sceneUuid, sceneName);
      for (let i = 0; i < keys.length; i++) {
        if (map[keys[i]]) {
          cb(map[keys[i]]);
          return;
        }
      }
      cb(null);
    });
  }

  function tryRestoreSelection(sceneUuid, sceneName) {
    const sceneKey = (sceneUuid && 'uuid:' + sceneUuid) || (sceneName && 'name:' + sceneName);
    if (!sceneKey || restoredForSceneKey === sceneKey) return;
    restoredForSceneKey = sceneKey;

    loadSavedRecord(sceneUuid, sceneName, function (record) {
      if (!record) return;
      let node = null;
      if (record.uuid) node = treeView.findByUuid(record.uuid);
      if (!node && record.path && record.path.length) {
        node = treeView.findByNamePath(record.path);
      }
      if (!node) return;

      treeView.expandToUuid(node.uuid);
      selectedUuid = node.uuid;
      treeView.select(node.uuid, true);
      treeView.scrollToUuid(node.uuid);
      send('SELECT_NODE', { uuid: node.uuid });
    });
  }

  function connect() {
    if (!isExtensionAlive()) {
      setStatus('err', '扩展已重载，请关闭并重新打开 DevTools');
      return;
    }
    if (port) {
      try {
        port.disconnect();
      } catch (_) {}
    }
    try {
      port = chrome.runtime.connect({ name: 'panel-' + tabId });
    } catch (_) {
      setStatus('err', '扩展已重载，请关闭并重新打开 DevTools');
      return;
    }
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(function () {
      connected = false;
      port = null;
      if (!isExtensionAlive()) {
        setStatus('err', '扩展已重载，请关闭并重新打开 DevTools');
        return;
      }
      setStatus('err', '已断开，正在重连…');
      setTimeout(connect, 800);
    });
    setStatus('warn', '等待页面桥接…');
    try {
      port.postMessage({ type: 'ENSURE_INJECT' });
      port.postMessage({ type: 'PING', id: nextId() });
    } catch (_) {
      setStatus('err', '扩展已重载，请关闭并重新打开 DevTools');
    }
  }

  function nextId() {
    return 'rpc-' + rpcSeq++;
  }

  function send(type, payload, timeoutMs) {
    const wait = timeoutMs != null ? timeoutMs : type === 'MOVE_NODE' ? 8000 : 3000;
    return new Promise(function (resolve) {
      if (!port || !isExtensionAlive()) {
        resolve({ ok: false, error: 'no port' });
        return;
      }
      const id = nextId();
      pending.set(id, resolve);
      try {
        port.postMessage({ type: type, id: id, payload: payload || {} });
      } catch (_) {
        pending.delete(id);
        resolve({ ok: false, error: 'context invalidated' });
        return;
      }
      setTimeout(function () {
        if (pending.has(id)) {
          pending.delete(id);
          resolve({ ok: false, error: 'timeout' });
        }
      }, wait);
    });
  }

  function onPortMessage(msg) {
    if (!msg) return;

    if (msg.type === 'SW_HELLO') {
      setStatus('warn', '等待页面桥接…');
      return;
    }

    if (msg.type === 'INJECT_STATUS') {
      if (msg.payload && msg.payload.ok === false) {
        setStatus(
          'err',
          (msg.payload.hint || msg.payload.error || '无法注入页面').slice(0, 120)
        );
      } else if (msg.payload && msg.payload.via === 'scripting') {
        setStatus('warn', '已强制注入，等待 cc…');
      }
      return;
    }

    if (msg.type === 'CONTENT_HELLO') {
      if (msg.payload && msg.payload.bridgeReady) {
        connected = true;
        setStatus('ok', '已连接');
      } else {
        setStatus('warn', '内容脚本就绪，等待 cc…');
      }
      return;
    }

    if (msg.type === 'CC_READY' || msg.type === 'PONG') {
      connected = true;
      const ver =
        (msg.payload && msg.payload.versionHint) ||
        (msg.payload && msg.payload.ready != null ? '' : '');
      setStatus('ok', '已连接' + (ver ? ' · ' + ver : ''));
      send('GET_TREE', {});
      applyPollSettings();
      return;
    }

    if (msg.type === 'CC_ERROR') {
      setStatus('err', (msg.payload && msg.payload.message) || '错误');
      return;
    }

    if (msg.type === 'TREE') {
      connected = true;
      const sceneUuid = msg.payload.sceneUuid || null;
      const sceneName = msg.payload.sceneName || null;
      const sceneChanged =
        sceneUuid !== currentSceneUuid ||
        (!sceneUuid && sceneName !== currentSceneName);

      currentSceneUuid = sceneUuid;
      currentSceneName = sceneName;

      setStatus(
        'ok',
        '已连接 · ' + (sceneName || 'scene') + (msg.payload.tree ? '' : '（空）')
      );
      treeView.setTree(msg.payload.tree);

      if (sceneChanged) {
        selectedUuid = null;
        restoredForSceneKey = null;
      }

      if (!selectedUuid) {
        tryRestoreSelection(sceneUuid, sceneName);
      } else if (treeView.findByUuid(selectedUuid)) {
        treeView.select(selectedUuid, true);
      } else {
        selectedUuid = null;
        restoredForSceneKey = null;
        tryRestoreSelection(sceneUuid, sceneName);
      }
      return;
    }

    if (msg.type === 'NODE_DETAIL') {
      inspectorView.setDetail(msg.payload);
      return;
    }

    if (msg.type === 'SCENE_LAUNCHED') {
      selectedUuid = null;
      restoredForSceneKey = null;
      inspectorView.setDetail(null);
      setStatus('warn', '场景已切换，正在刷新…');
      return;
    }

    if (msg.type === 'PICK_HOVER') {
      if (msg.payload && msg.payload.name) {
        setStatus(
          'ok',
          '拾取 ' +
            (msg.payload.index + 1) +
            '/' +
            msg.payload.total +
            ' · ' +
            msg.payload.name
        );
      }
      return;
    }

    if (msg.type === 'PICK_SELECT') {
      var uuid = msg.payload && msg.payload.uuid;
      if (!uuid) return;
      selectedUuid = uuid;
      treeView.expandToUuid(uuid);
      treeView.select(uuid, true);
      treeView.scrollToUuid(uuid);
      rememberSelection(uuid);
      send('SELECT_NODE', { uuid: uuid });
      // 选中后自动关闭拾取，避免继续拦截游戏点击
      setPickMode(false);
      return;
    }

    if (msg.type === 'PICK_MODE') {
      pickMode = !!(msg.payload && msg.payload.enabled);
      if (btnPick) btnPick.classList.toggle('active', pickMode);
      return;
    }

    if (msg.type === 'ASSET_EXPORT_PROGRESS') {
      var p = msg.payload || {};
      if (downloadingAssets) {
        setStatus(
          'warn',
          '打包中 ' +
            (p.done || 0) +
            '/' +
            (p.total || 0) +
            (p.failed ? '（失败 ' + p.failed + '）' : '') +
            '…'
        );
      }
      return;
    }

    if (msg.type === 'RPC_RESULT' && msg.id && pending.has(msg.id)) {
      const resolve = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg.payload || { ok: true });
      return;
    }
  }

  let hoverTimer = null;
  const treeView = new CCNodeTreeView(treeRoot, {
    onSelect: function (uuid) {
      selectedUuid = uuid;
      rememberSelection(uuid);
      send('SELECT_NODE', { uuid: uuid });
    },
    onMove: function (info) {
      send('MOVE_NODE', info, 8000).then(function (res) {
        if (!res || res.ok) return;
        // timeout / no port 多为扩展重载或消息丢失，树轮询会纠正，避免刷屏
        if (res.error === 'timeout' || res.error === 'no port' || res.error === 'context invalidated') {
          return;
        }
        console.warn('[CocosNode] 移动失败', res.error);
      });
    },
    onHover: function (uuid) {
      if (pickMode) return;
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      if (!uuid) {
        hoverTimer = setTimeout(function () {
          send('HOVER_NODE', { uuid: null });
        }, 50);
        return;
      }
      send('HOVER_NODE', { uuid: uuid });
    },
  });

  const inspectorView = new CCNodeInspectorView(inspectorRoot, {
    onSetNodeProp: function (uuid, prop, value) {
      send('SET_NODE_PROP', { uuid: uuid, prop: prop, value: value });
    },
    onSetCompProp: function (uuid, compIndex, prop, value) {
      send('SET_COMP_PROP', {
        uuid: uuid,
        compIndex: compIndex,
        prop: prop,
        value: value,
      });
    },
  });

  function applyPollSettings() {
    const enabled = !!pollToggle.checked;
    const intervalMs = Number(pollInterval.value) || 450;
    send('SET_POLL', { enabled: enabled, intervalMs: intervalMs });
  }

  searchInput.addEventListener('input', function () {
    treeView.setFilter(searchInput.value);
  });

  btnRefresh.addEventListener('click', function () {
    send('GET_TREE', {});
  });

  let downloadingAssets = false;
  function formatAssetStats(stats) {
    if (!stats) return '';
    var parts = [];
      var order = ['images', 'atlases', 'spine', 'audio', 'materials', 'models', 'fonts', 'animations', 'json', 'video', 'other', 'atlasTextures'];
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      if (stats[k]) parts.push(k + ':' + stats[k]);
    }
    for (var key in stats) {
      if (Object.prototype.hasOwnProperty.call(stats, key) && order.indexOf(key) < 0 && stats[key]) {
        parts.push(key + ':' + stats[key]);
      }
    }
    return parts.join(' · ');
  }

  function downloadAssetsOneClick() {
    if (downloadingAssets) return;
    if (!connected) {
      setStatus('err', '未连接，无法下载资源');
      return;
    }
    downloadingAssets = true;
    if (btnDownloadAssets) btnDownloadAssets.disabled = true;
    setStatus('warn', '正在页面内扫描并打包资源（含 Spine 三件套）…');

    send('EXPORT_ASSETS_ZIP', {}, 180000)
      .then(function (res) {
        downloadingAssets = false;
        if (btnDownloadAssets) btnDownloadAssets.disabled = false;
        if (!res || !res.ok) {
          setStatus('err', '导出失败：' + ((res && res.error) || 'unknown'));
          return;
        }
        var tip = formatAssetStats(res.stats);
        setStatus(
          'ok',
          '已下载 ' +
            (res.filename || 'CocosAssets_*.zip') +
            '（成功 ' +
            (res.packed || 0) +
            '/' +
            (res.total || 0) +
            (res.failed ? '，跳过 ' + res.failed : '') +
            '）' +
            (tip ? ' · ' + tip : '')
        );
      })
      .catch(function (e) {
        downloadingAssets = false;
        if (btnDownloadAssets) btnDownloadAssets.disabled = false;
        setStatus('err', '导出失败：' + String(e));
      });
  }

  if (btnDownloadAssets) {
    btnDownloadAssets.addEventListener('click', downloadAssetsOneClick);
  }

  function setPickMode(on) {
    pickMode = !!on;
    if (btnPick) btnPick.classList.toggle('active', pickMode);
    send('PICK_MODE', { enabled: pickMode }).then(function (res) {
      if (res && res.ok === false) {
        pickMode = false;
        if (btnPick) btnPick.classList.remove('active');
        setStatus('err', '拾取启动失败');
        return;
      }
      if (pickMode) {
        setStatus('warn', '拾取中：移到画面上，滚轮切换，点击选中');
      }
    });
  }

  function isPickHotkey(e) {
    return e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyP' || e.key === 'p' || e.key === 'P');
  }

  if (btnPick) {
    btnPick.addEventListener('click', function () {
      setPickMode(!pickMode);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (!isPickHotkey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setPickMode(!pickMode);
  });

  pollToggle.addEventListener('change', applyPollSettings);
  pollInterval.addEventListener('change', applyPollSettings);

  if (fontScaleInput) {
    fontScaleInput.addEventListener('input', function () {
      const s = Number(fontScaleInput.value) || 1;
      applyFontScale(s);
      saveFontScale(s);
    });
  }

  if (fontWeightInput) {
    fontWeightInput.addEventListener('input', function () {
      const w = Number(fontWeightInput.value) || 700;
      applyFontWeight(w);
      saveFontWeight(w);
    });
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      const next = currentTheme === 'light' ? 'dark' : 'light';
      applyTheme(next);
      saveTheme(next);
    });
  }

  function openHelp() {
    if (!helpOverlay || !helpBody || !window.CCNodeHelp) return;
    helpBody.innerHTML = CCNodeHelp.renderHelpHtml(CCNodeHelp.sections);
    helpOverlay.classList.remove('hidden');
    helpOverlay.setAttribute('aria-hidden', 'false');
  }

  function closeHelp() {
    if (!helpOverlay) return;
    helpOverlay.classList.add('hidden');
    helpOverlay.setAttribute('aria-hidden', 'true');
  }

  if (btnHelp) btnHelp.addEventListener('click', openHelp);
  if (helpClose) helpClose.addEventListener('click', closeHelp);
  if (helpOverlay) {
    helpOverlay.addEventListener('click', function (e) {
      if (e.target === helpOverlay) closeHelp();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeHelp();
  });

  applyTheme('dark');
  loadTheme();
  applyFontScale(1.1);
  loadFontScale();
  applyFontWeight(700);
  loadFontWeight();
  connect();

  // 远程页若未注入 content，几秒后给出可操作提示
  setTimeout(function () {
    if (connected) return;
    setStatus(
      'warn',
      '仍未连上：请确认扩展已重载、网站访问=所有网站，并刷新本页后重开 DevTools'
    );
    try {
      if (port) port.postMessage({ type: 'ENSURE_INJECT' });
    } catch (_) {}
  }, 4000);
})();
