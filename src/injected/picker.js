/**
 * 游戏画面节点拾取（类似 Chrome 审查元素）
 * 悬停高亮 → 滚轮按深度切换重叠节点 → 点击选中
 * 仅拾取带渲染组件的节点（Label/Sprite/Spine/RichText 等）
 */
(function () {
  'use strict';

  if (window.__CCNodeInspectorPickerInstalled) return;
  window.__CCNodeInspectorPickerInstalled = true;

  var HIGHLIGHT_NAME = '__CC_NODE_INSPECTOR_HL__';
  var enabled = false;
  var candidates = [];
  var candidateIndex = 0;
  var lastEmitKey = '';
  var savedCursor = '';
  var overlayEl = null;

  function getMutator() {
    return window.__CCNodeInspectorMutator;
  }

  function emit(type, payload) {
    window.postMessage(
      {
        source: 'CC_NODE_INSPECTOR_PAGE',
        type: type,
        payload: payload,
      },
      '*'
    );
  }

  function isOverGameCanvas(e) {
    try {
      var canvas = cc.game && cc.game.canvas;
      if (!canvas) return false;
      var r = canvas.getBoundingClientRect();
      return (
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      );
    } catch (_) {
      return false;
    }
  }

  function getCanvasRelatedPos() {
    var canvas = cc.game.canvas;
    var box = canvas.getBoundingClientRect();
    return {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    };
  }

  /**
   * 与引擎鼠标事件同一套换算：client → 设计分辨率屏幕坐标
   * （cc.view._convertMouseToLocationInView）
   */
  function clientToScreenLocation(clientX, clientY) {
    var pos = getCanvasRelatedPos();
    var loc = cc.v2(clientX, clientY);
    try {
      if (cc.view && typeof cc.view._convertMouseToLocationInView === 'function') {
        cc.view._convertMouseToLocationInView(loc, pos);
        return loc;
      }
    } catch (_) {}

    // 公开 API 兜底（等价于 _convertMouseToLocationInView）
    try {
      var dpr = cc.view.getDevicePixelRatio ? cc.view.getDevicePixelRatio() : 1;
      var viewport = cc.view.getViewportRect();
      var scaleX = cc.view.getScaleX();
      var scaleY = cc.view.getScaleY();
      loc.x = (dpr * (clientX - pos.left) - viewport.x) / scaleX;
      loc.y = (dpr * (pos.top + pos.height - clientY) - viewport.y) / scaleY;
      return loc;
    } catch (_) {}

    return loc;
  }

  function screenToWorld(screenLoc) {
    try {
      var cams = [];
      if (cc.Camera) {
        if (cc.Camera.cameras && cc.Camera.cameras.length) {
          cams = cc.Camera.cameras.slice();
          cams.sort(function (a, b) {
            return (a.depth || 0) - (b.depth || 0);
          });
        } else if (cc.Camera.main) {
          cams = [cc.Camera.main];
        }
      }
      // depth 高的相机优先（UI Camera）
      for (var i = cams.length - 1; i >= 0; i--) {
        var cam = cams[i];
        if (!cam || cam.enabled === false) continue;
        try {
          if (cam.node && cam.node.activeInHierarchy === false) continue;
        } catch (_) {}
        if (typeof cam.getScreenToWorldPoint === 'function') {
          try {
            var out = cam.getScreenToWorldPoint(screenLoc);
            if (out) return out;
          } catch (_) {}
        }
      }
    } catch (_) {}
    return screenLoc;
  }

  function clientToWorld(clientX, clientY) {
    if (typeof cc === 'undefined' || !cc.view) return null;
    var screenLoc = clientToScreenLocation(clientX, clientY);
    return screenToWorld(screenLoc);
  }

  /** 是否带「可见渲染」组件（排除纯 Widget/Layout 等） */
  function hasRenderableComponent(node) {
    var comps = node._components || [];
    for (var i = 0; i < comps.length; i++) {
      var c = comps[i];
      if (!c) continue;

      try {
        if (cc.Label && c instanceof cc.Label) return true;
        if (cc.Sprite && c instanceof cc.Sprite) return true;
        if (cc.RichText && c instanceof cc.RichText) return true;
        if (cc.Mask && c instanceof cc.Mask) return true;
        if (cc.Graphics && c instanceof cc.Graphics) return true;
        if (cc.MotionStreak && c instanceof cc.MotionStreak) return true;
        if (cc.ParticleSystem && c instanceof cc.ParticleSystem) return true;
      } catch (_) {}

      try {
        if (typeof sp !== 'undefined' && sp.Skeleton && c instanceof sp.Skeleton) return true;
      } catch (_) {}
      try {
        if (
          typeof dragonBones !== 'undefined' &&
          dragonBones.ArmatureDisplay &&
          c instanceof dragonBones.ArmatureDisplay
        ) {
          return true;
        }
      } catch (_) {}

      // 通用：RenderComponent（Widget/Layout/Button 等不在此列）
      try {
        if (cc.RenderComponent && c instanceof cc.RenderComponent) return true;
      } catch (_) {}

      var cn = '';
      try {
        cn = (cc.js && cc.js.getClassName && cc.js.getClassName(c)) || c.constructor.name || '';
      } catch (_) {}
      if (
        /Label|RichText|Sprite$|Skeleton|ArmatureDisplay|ParticleSystem|MotionStreak|TiledMap|TiledLayer|MeshRenderer|Graphics|Mask/.test(
          cn
        ) &&
        !/SpriteFrame|SpriteAtlas|Layout|Widget|Button|ScrollView|EditBox|Canvas|Camera|ProgressBar|Toggle|Slider|PageView|BlockInput/.test(
          cn
        )
      ) {
        return true;
      }
    }
    return false;
  }

  function pointInNode(worldPt, node) {
    try {
      var box = node.getBoundingBoxToWorld && node.getBoundingBoxToWorld();
      if (
        box &&
        typeof box.contains === 'function' &&
        box.width >= 1 &&
        box.height >= 1 &&
        box.contains(worldPt)
      ) {
        return true;
      }
    } catch (_) {}

    // 兜底：本地包围盒（部分节点 bbox 异常时）
    try {
      var local = node.convertToNodeSpaceAR(worldPt);
      var w = node.width || 0;
      var h = node.height || 0;
      if (w < 1 || h < 1) return false;
      var ax = node.anchorX != null ? node.anchorX : 0.5;
      var ay = node.anchorY != null ? node.anchorY : 0.5;
      return local.x >= -w * ax && local.x <= w * (1 - ax) && local.y >= -h * ay && local.y <= h * (1 - ay);
    } catch (_) {}
    return false;
  }

  function collectHits(worldPt, node, out, depth) {
    if (!node || node.name === HIGHLIGHT_NAME) return;

    var isScene = false;
    try {
      isScene =
        !!node._isScene ||
        (typeof cc !== 'undefined' && cc.Scene && node instanceof cc.Scene);
    } catch (_) {}

    if (!isScene) {
      var ok = true;
      try {
        if (node.activeInHierarchy === false) ok = false;
      } catch (_) {
        try {
          if (node.active === false) ok = false;
        } catch (_2) {}
      }

      if (ok && hasRenderableComponent(node) && pointInNode(worldPt, node)) {
        var sib = 0;
        try {
          if (node.parent && node.parent.children) {
            sib = node.parent.children.indexOf(node);
            if (sib < 0) sib = 0;
          }
        } catch (_) {}
        out.push({
          uuid: node.uuid,
          name: node.name || '',
          depth: depth,
          siblingIndex: sib,
          zIndex: typeof node.zIndex === 'number' ? node.zIndex : 0,
        });
      }
    }

    var children = node.children || [];
    for (var i = 0; i < children.length; i++) {
      collectHits(worldPt, children[i], out, depth + 1);
    }
  }

  /** 优先最远离树根：更深 / 同层靠后的兄弟 / 更高 zIndex */
  function sortCandidates(list) {
    list.sort(function (a, b) {
      if (b.depth !== a.depth) return b.depth - a.depth;
      if (b.siblingIndex !== a.siblingIndex) return b.siblingIndex - a.siblingIndex;
      return (b.zIndex || 0) - (a.zIndex || 0);
    });
  }

  function sameCandidateList(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].uuid !== b[i].uuid) return false;
    }
    return true;
  }

  function ensureOverlay() {
    if (overlayEl && overlayEl.parentNode) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = '__cc_node_pick_overlay__';
    overlayEl.style.cssText =
      'position:fixed;z-index:2147483646;left:8px;bottom:8px;max-width:60%;' +
      'padding:6px 10px;border-radius:4px;font:12px/1.4 Consolas,monospace;' +
      'background:rgba(0,0,0,0.75);color:#9ec5ff;pointer-events:none;' +
      'display:none;white-space:pre-wrap;';
    document.documentElement.appendChild(overlayEl);
    return overlayEl;
  }

  function updateOverlay() {
    var el = ensureOverlay();
    if (!enabled || !candidates.length) {
      el.style.display = 'none';
      return;
    }
    var cur = candidates[candidateIndex];
    el.textContent =
      '拾取 ' +
      (candidateIndex + 1) +
      '/' +
      candidates.length +
      '（滚轮切换 · 仅渲染节点）\n' +
      (cur.name || '(unnamed)') +
      '  depth:' +
      cur.depth;
    el.style.display = 'block';
  }

  function applyCurrentHighlight() {
    var mut = getMutator();
    if (!mut || !mut.setHoverHighlight) return;
    if (!candidates.length) {
      mut.clearHoverHighlight && mut.clearHoverHighlight();
      updateOverlay();
      return;
    }
    if (candidateIndex < 0) candidateIndex = 0;
    if (candidateIndex >= candidates.length) candidateIndex = candidates.length - 1;
    var cur = candidates[candidateIndex];
    mut.setHoverHighlight(cur.uuid);
    updateOverlay();

    var key = cur.uuid + '@' + candidateIndex + '/' + candidates.length;
    if (key !== lastEmitKey) {
      lastEmitKey = key;
      emit('PICK_HOVER', {
        uuid: cur.uuid,
        name: cur.name,
        index: candidateIndex,
        total: candidates.length,
        candidates: candidates,
      });
    }
  }

  function pickAt(clientX, clientY) {
    if (typeof cc === 'undefined' || !cc.director) return;
    var scene = cc.director.getScene();
    if (!scene) {
      candidates = [];
      applyCurrentHighlight();
      return;
    }
    var world = clientToWorld(clientX, clientY);
    if (!world) {
      candidates = [];
      applyCurrentHighlight();
      return;
    }
    var hits = [];
    collectHits(world, scene, hits, 0);
    sortCandidates(hits);
    // 命中列表变化时始终选最深（index 0）；仅列表未变时保留滚轮切换的下标
    // （旧逻辑按 uuid 粘滞会把大面积父节点一直钉住，看起来怎么排都靠近树根）
    var keepIndex = sameCandidateList(candidates, hits);
    candidates = hits;
    if (!keepIndex) {
      candidateIndex = 0;
    } else if (candidateIndex >= candidates.length) {
      candidateIndex = Math.max(0, candidates.length - 1);
    }
    applyCurrentHighlight();
  }

  function onMove(e) {
    if (!enabled) return;
    if (!isOverGameCanvas(e)) {
      candidates = [];
      applyCurrentHighlight();
      return;
    }
    pickAt(e.clientX, e.clientY);
  }

  function onWheel(e) {
    if (!enabled) return;
    if (!isOverGameCanvas(e)) return;
    if (!candidates.length) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.deltaY > 0) {
      candidateIndex = (candidateIndex + 1) % candidates.length;
    } else if (e.deltaY < 0) {
      candidateIndex = (candidateIndex - 1 + candidates.length) % candidates.length;
    }
    applyCurrentHighlight();
  }

  function onClick(e) {
    if (!enabled) return;
    if (!isOverGameCanvas(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!candidates.length) return;
    var cur = candidates[candidateIndex];
    if (!cur) return;
    emit('PICK_SELECT', { uuid: cur.uuid, name: cur.name });
  }

  function onMouseDown(e) {
    if (!enabled) return;
    if (!isOverGameCanvas(e)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function setCanvasCursor(on) {
    try {
      var canvas = cc.game && cc.game.canvas;
      if (!canvas) return;
      if (on) {
        savedCursor = canvas.style.cursor || '';
        canvas.style.cursor = 'crosshair';
      } else {
        canvas.style.cursor = savedCursor;
      }
    } catch (_) {}
  }

  function setEnabled(on) {
    on = !!on;
    if (on === enabled) {
      emit('PICK_MODE', { enabled: enabled });
      return { ok: true, enabled: enabled };
    }
    enabled = on;
    lastEmitKey = '';
    candidates = [];
    candidateIndex = 0;

    if (enabled) {
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('wheel', onWheel, { capture: true, passive: false });
      window.addEventListener('click', onClick, true);
      window.addEventListener('mousedown', onMouseDown, true);
      setCanvasCursor(true);
      ensureOverlay();
    } else {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      setCanvasCursor(false);
      var mut = getMutator();
      if (mut && mut.clearHoverHighlight) mut.clearHoverHighlight();
      if (overlayEl) overlayEl.style.display = 'none';
    }
    emit('PICK_MODE', { enabled: enabled });
    return { ok: true, enabled: enabled };
  }

  /** Alt+Shift+P：与面板工具栏拾取切换一致（尽量避开 Chrome/DevTools 常用快捷键） */
  function isPickHotkey(e) {
    return (
      e.altKey &&
      e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      (e.code === 'KeyP' || e.key === 'p' || e.key === 'P')
    );
  }

  function onHotkey(e) {
    if (!isPickHotkey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setEnabled(!enabled);
  }

  window.addEventListener('keydown', onHotkey, true);

  window.__CCNodeInspectorPicker = {
    setEnabled: setEnabled,
    isEnabled: function () {
      return enabled;
    },
  };
})();
