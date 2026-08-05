/**
 * MAIN-world bridge: talks to content via postMessage, drives poll + selection listeners.
 */
(function () {
  'use strict';

  if (window.__CCNodeInspectorBridgeInstalled) return;
  window.__CCNodeInspectorBridgeInstalled = true;

  const PAGE_SOURCE = 'CC_NODE_INSPECTOR_PAGE';
  const HOST_SOURCE = 'CC_NODE_INSPECTOR';

  let pollTimer = null;
  let pollIntervalMs = 450;
  let lastSceneUuid = null;
  let lastTreeFingerprint = '';
  let selectedUuid = null;
  let selectedNodeRef = null;
  let selectedParentRef = null;
  let lastDetailFingerprint = '';
  const boundHandlers = [];

  function emit(type, payload, id, error) {
    window.postMessage(
      {
        source: PAGE_SOURCE,
        type: type,
        id: id,
        payload: payload,
        error: error,
      },
      '*'
    );
  }

  function getSerializer() {
    return window.__CCNodeInspectorSerializer;
  }

  function getMutator() {
    return window.__CCNodeInspectorMutator;
  }

  function isCcReady() {
    return typeof cc !== 'undefined' && cc.director && typeof cc.director.getScene === 'function';
  }

  function waitForCc(cb) {
    if (isCcReady() && cc.director.getScene()) {
      cb();
      return;
    }
    let tries = 0;
    const t = setInterval(function () {
      tries++;
      if (isCcReady() && cc.director.getScene()) {
        clearInterval(t);
        cb();
      } else if (tries > 200) {
        clearInterval(t);
        // Still announce ready if cc exists without scene yet
        if (isCcReady()) cb();
      }
    }, 100);
  }

  function fingerprintTree(tree) {
    if (!tree) return '';
    const parts = [];
    function walk(n) {
      parts.push(
        n.uuid +
          ':' +
          n.name +
          ':' +
          (n.active ? 1 : 0) +
          ':' +
          (n.childrenCount || 0) +
          ':' +
          (n.hasLabel ? 'L' : '') +
          (n.hasSprite ? 'S' : '') +
          ':' +
          ((n.comps && n.comps.join(',')) || '')
      );
      const ch = n.children || [];
      for (let i = 0; i < ch.length; i++) walk(ch[i]);
    }
    walk(tree);
    return parts.join('|');
  }

  function pushTree(force) {
    const ser = getSerializer();
    if (!ser || !isCcReady()) return;
    const data = ser.serializeSceneTree();
    if (!data.ok) {
      emit('CC_ERROR', { message: data.error || 'serialize failed' });
      return;
    }
    const sceneUuid = data.sceneUuid || null;
    const fp = fingerprintTree(data.tree);
    const sceneChanged = sceneUuid !== lastSceneUuid;
    if (!force && !sceneChanged && fp === lastTreeFingerprint) {
      return;
    }
    lastSceneUuid = sceneUuid;
    lastTreeFingerprint = fp;
    emit('TREE', {
      sceneUuid: sceneUuid,
      sceneName: data.sceneName,
      tree: data.tree,
      sceneChanged: sceneChanged,
    });
  }

  function pushNodeDetail(uuid, force) {
    const ser = getSerializer();
    const mut = getMutator();
    if (!ser || !mut) return;
    const node = mut.findNodeByUuid(uuid);
    if (!node) {
      lastDetailFingerprint = '';
      emit('NODE_DETAIL', null);
      return;
    }
    const detail = ser.serializeNodeDetail(node);
    const fp = JSON.stringify(detail);
    if (!force && fp === lastDetailFingerprint) return;
    lastDetailFingerprint = fp;
    emit('NODE_DETAIL', detail);
  }

  function clearSelectionListeners() {
    for (let i = 0; i < boundHandlers.length; i++) {
      const h = boundHandlers[i];
      try {
        if (h.node && h.node.off) h.node.off(h.type, h.fn);
      } catch (_) {}
    }
    boundHandlers.length = 0;
    selectedNodeRef = null;
    selectedParentRef = null;
  }

  function bindNodeEvent(node, type, fn) {
    if (!node || !node.on) return;
    node.on(type, fn);
    boundHandlers.push({ node: node, type: type, fn: fn });
  }

  function onSelectedChanged() {
    if (selectedUuid) {
      pushNodeDetail(selectedUuid);
      pushTree(true);
    }
  }

  function selectNode(uuid) {
    clearSelectionListeners();
    selectedUuid = uuid || null;
    lastDetailFingerprint = '';
    if (!uuid) {
      emit('NODE_DETAIL', null);
      return;
    }
    const mut = getMutator();
    if (!mut || !isCcReady()) return;
    const node = mut.findNodeByUuid(uuid);
    if (!node) {
      emit('NODE_DETAIL', null);
      return;
    }
    selectedNodeRef = node;
    selectedParentRef = node.parent || null;

    const refreshDetail = function () {
      pushNodeDetail(selectedUuid);
    };
    const refreshTree = function () {
      pushTree(true);
      pushNodeDetail(selectedUuid);
    };

    const ET = (cc.Node && cc.Node.EventType) || {};
    // 2.x 全线：EventType 常量缺失时用字符串事件名兜底
    const detailEvents = [
      ET.POSITION_CHANGED || 'position-changed',
      ET.ROTATION_CHANGED || 'rotation-changed',
      ET.SCALE_CHANGED || 'scale-changed',
      ET.SIZE_CHANGED || 'size-changed',
      ET.ANCHOR_CHANGED || 'anchor-changed',
      ET.COLOR_CHANGED || 'color-changed',
    ];
    for (let i = 0; i < detailEvents.length; i++) {
      if (detailEvents[i]) bindNodeEvent(node, detailEvents[i], refreshDetail);
    }

    const treeEvents = [
      ET.CHILD_ADDED || 'child-added',
      ET.CHILD_REMOVED || 'child-removed',
      ET.CHILD_REORDER || 'child-reorder',
      ET.SIBLING_ORDER_CHANGED || 'sibling-order-changed',
    ];
    for (let j = 0; j < treeEvents.length; j++) {
      if (treeEvents[j]) {
        bindNodeEvent(node, treeEvents[j], refreshTree);
        if (selectedParentRef) bindNodeEvent(selectedParentRef, treeEvents[j], refreshTree);
      }
    }

    // active / name don't always emit; poll covers them
    pushNodeDetail(uuid);
  }

  function startPolling(ms) {
    if (typeof ms === 'number' && ms >= 100) pollIntervalMs = ms;
    stopPolling();
    pollTimer = setInterval(function () {
      if (!isCcReady()) return;
      pushTree(false);
      if (selectedUuid) {
        // Soft refresh detail for props that don't emit events
        pushNodeDetail(selectedUuid);
      }
      var mut = getMutator();
      if (mut && mut.refreshHoverHighlight) mut.refreshHoverHighlight();
    }, pollIntervalMs);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function hookSceneLaunch() {
    if (!isCcReady() || !cc.director || !cc.director.on) return;
    const ev =
      (cc.Director && cc.Director.EVENT_AFTER_SCENE_LAUNCH) ||
      'director_after_scene_launch';
    try {
      cc.director.on(ev, function () {
        lastSceneUuid = null;
        lastTreeFingerprint = '';
        clearSelectionListeners();
        selectedUuid = null;
        var mutSc = getMutator();
        if (mutSc && mutSc.clearHoverHighlight) mutSc.clearHoverHighlight();
        pushTree(true);
        emit('SCENE_LAUNCHED', {});
      });
    } catch (_) {}
  }

  function engineVersionHint() {
    try {
      if (cc.ENGINE_VERSION) return String(cc.ENGINE_VERSION);
      if (cc.engine && cc.engine.version) return String(cc.engine.version);
      if (cc.GAME_VIEW && cc.GAME_VIEW.version) return String(cc.GAME_VIEW.version);
    } catch (_) {}
    return '2.x';
  }

  function handleHostMessage(data) {
    const type = data.type;
    const id = data.id;
    const payload = data.payload || {};

    try {
      if (type === 'PING') {
        emit('PONG', { ready: isCcReady() }, id);
        if (isCcReady()) emit('CC_READY', { hasScene: !!cc.director.getScene() });
        return;
      }

      if (type === 'PANEL_CLOSED') {
        clearSelectionListeners();
        selectedUuid = null;
        var mutClose = getMutator();
        if (mutClose && mutClose.clearHoverHighlight) mutClose.clearHoverHighlight();
        var pickerOff = window.__CCNodeInspectorPicker;
        if (pickerOff && pickerOff.isEnabled && pickerOff.isEnabled()) {
          pickerOff.setEnabled(false);
        }
        return;
      }

      if (type === 'GET_TREE') {
        pushTree(true);
        emit('RPC_RESULT', { ok: true }, id);
        return;
      }

      if (type === 'SET_POLL') {
        if (payload.enabled === false) stopPolling();
        else startPolling(payload.intervalMs);
        emit('RPC_RESULT', { ok: true, intervalMs: pollIntervalMs }, id);
        return;
      }

      if (type === 'SELECT_NODE') {
        selectNode(payload.uuid);
        emit('RPC_RESULT', { ok: true }, id);
        return;
      }

      if (type === 'SET_NODE_PROP') {
        const mut = getMutator();
        const result = mut.setNodeProp(payload.uuid, payload.prop, payload.value);
        if (result.ok) pushNodeDetail(payload.uuid);
        emit('RPC_RESULT', result, id);
        return;
      }

      if (type === 'SET_COMP_PROP') {
        const mut = getMutator();
        const done = function (result) {
          if (result && result.ok) pushNodeDetail(payload.uuid);
          emit('RPC_RESULT', result, id);
        };
        const result = mut.setCompProp(
          payload.uuid,
          payload.compIndex,
          payload.prop,
          payload.value,
          done
        );
        // Sync results already called done; pending async waits for callback
        if (result && result.pending) return;
        return;
      }

      if (type === 'MOVE_NODE') {
        const mut = getMutator();
        const result = mut.moveNode(payload.uuid, payload.newParentUuid, payload.siblingIndex);
        if (result.ok) {
          lastTreeFingerprint = '';
          pushTree(true);
          if (selectedUuid) pushNodeDetail(selectedUuid);
        }
        emit('RPC_RESULT', result, id);
        return;
      }

      if (type === 'HOVER_NODE') {
        // 拾取模式中由 picker 管高亮，忽略树上悬停
        var pickerH = window.__CCNodeInspectorPicker;
        if (pickerH && pickerH.isEnabled && pickerH.isEnabled()) {
          emit('RPC_RESULT', { ok: true, skipped: true }, id);
          return;
        }
        const mut = getMutator();
        const result = mut.setHoverHighlight(payload.uuid || null);
        emit('RPC_RESULT', result, id);
        return;
      }

      if (type === 'PICK_MODE') {
        var picker = window.__CCNodeInspectorPicker;
        if (!picker) {
          emit('RPC_RESULT', { ok: false, error: 'picker not loaded' }, id);
          return;
        }
        var r = picker.setEnabled(!!payload.enabled);
        emit('RPC_RESULT', r, id);
        return;
      }

      if (type === 'LIST_ASSETS') {
        var assetsApi = window.__CCNodeInspectorAssets;
        if (!assetsApi || typeof assetsApi.collectAssets !== 'function') {
          emit('RPC_RESULT', { ok: false, error: 'assets module not loaded' }, id);
          return;
        }
        var collected = assetsApi.collectAssets();
        // 精简回传（不含 inline 二进制）
        var light = {
          ok: collected.ok,
          error: collected.error,
          total: collected.total,
          stats: collected.stats,
          items: (collected.items || []).map(function (it) {
            return {
              kind: it.kind,
              filename: it.filename,
              category: it.category,
              url: it.kind === 'url' ? it.url : '',
              name: it.name,
              uuid: it.uuid,
            };
          }),
        };
        emit('RPC_RESULT', light, id);
        return;
      }

      if (type === 'EXPORT_ASSETS_ZIP') {
        var assetsExp = window.__CCNodeInspectorAssets;
        if (!assetsExp || typeof assetsExp.exportAndDownloadZip !== 'function') {
          emit('RPC_RESULT', { ok: false, error: 'assets module not loaded' }, id);
          return;
        }
        assetsExp
          .exportAndDownloadZip(function (done, total, failed) {
            emit('ASSET_EXPORT_PROGRESS', { done: done, total: total, failed: failed });
          })
          .then(function (result) {
            emit('RPC_RESULT', result, id);
          })
          .catch(function (e) {
            emit('RPC_RESULT', { ok: false, error: String(e) }, id);
          });
        return;
      }

      emit('RPC_RESULT', { ok: false, error: 'unknown type ' + type }, id);
    } catch (e) {
      emit('RPC_RESULT', { ok: false, error: String(e) }, id);
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== HOST_SOURCE) return;
    handleHostMessage(data);
  });

  waitForCc(function () {
    emit('CC_READY', {
      hasScene: !!(cc.director && cc.director.getScene()),
      versionHint: engineVersionHint(),
    });
    hookSceneLaunch();
    startPolling(pollIntervalMs);
    pushTree(true);
  });
})();
