/**
 * MAIN-world mutators: edit node/component props and reparent/reorder.
 * Attaches to window.__CCNodeInspectorMutator
 */
(function () {
  'use strict';

  function findNodeByUuid(uuid) {
    if (!uuid || typeof cc === 'undefined' || !cc.director) return null;
    const scene = cc.director.getScene();
    if (!scene) return null;
    if (scene.uuid === uuid) return scene;

    // Deep search (getChildByUuid is often one-level only)
    let result = null;
    if (typeof scene.walk === 'function') {
      scene.walk(function (n) {
        if (!result && n && n.uuid === uuid) result = n;
      });
      if (result) return result;
    }

    function dfs(node) {
      if (!node) return null;
      if (node.uuid === uuid) return node;
      const children = node.children || [];
      for (let i = 0; i < children.length; i++) {
        const hit = dfs(children[i]);
        if (hit) return hit;
      }
      return null;
    }
    return dfs(scene);
  }

  function isDescendant(ancestor, node) {
    let p = node;
    while (p) {
      if (p === ancestor) return true;
      p = p.parent;
    }
    return false;
  }

  const NODE_PROPS = {
    name: { type: 'string' },
    active: { type: 'boolean' },
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number' },
    width: { type: 'number' },
    height: { type: 'number' },
    anchorX: { type: 'number' },
    anchorY: { type: 'number' },
    scaleX: { type: 'number' },
    scaleY: { type: 'number' },
    angle: { type: 'number' },
    opacity: { type: 'number' },
    zIndex: { type: 'number' },
  };

  function setNodeProp(uuid, prop, value) {
    const node = findNodeByUuid(uuid);
    if (!node) return { ok: false, error: 'node not found' };

    var isScene = false;
    try {
      isScene =
        (typeof cc !== 'undefined' && cc.Scene && node instanceof cc.Scene) || !!node._isScene;
    } catch (_) {}

    if (isScene && (prop === 'active' || prop === 'activeInHierarchy')) {
      return { ok: false, error: 'Scene has no active property' };
    }

    if (prop === 'color') {
      try {
        const c = value || {};
        const cur = node.color || { r: 255, g: 255, b: 255, a: 255 };
        node.color = new cc.Color(
          c.r != null ? Number(c.r) : cur.r,
          c.g != null ? Number(c.g) : cur.g,
          c.b != null ? Number(c.b) : cur.b,
          c.a != null ? Number(c.a) : cur.a
        );
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }

    if (prop === 'colorR' || prop === 'colorG' || prop === 'colorB' || prop === 'colorA') {
      try {
        const c = node.color;
        const r = prop === 'colorR' ? Number(value) : c.r;
        const g = prop === 'colorG' ? Number(value) : c.g;
        const b = prop === 'colorB' ? Number(value) : c.b;
        const a = prop === 'colorA' ? Number(value) : c.a;
        node.color = new cc.Color(r, g, b, a);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }

    const meta = NODE_PROPS[prop];
    if (!meta) return { ok: false, error: 'unsupported prop: ' + prop };

    try {
      let v = value;
      if (meta.type === 'number') v = Number(value);
      if (meta.type === 'boolean') v = !!value;
      if (meta.type === 'string') v = String(value);

      if (prop === 'x' || prop === 'y') {
        node[prop] = v;
      } else if (prop === 'width' || prop === 'height') {
        node[prop] = v;
      } else if (prop === 'angle') {
        try {
          node.angle = v;
        } catch (_) {
          // 更早版本可能主要用 rotation（与 angle 符号相反）
          if ('rotation' in node) node.rotation = -v;
          else throw _;
        }
      } else {
        node[prop] = v;
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  function normalizeAssetUuid(uuid) {
    var u = String(uuid || '').trim();
    if (!u) return '';
    try {
      var utils = cc.assetManager && cc.assetManager.utils;
      if (utils && typeof utils.decompressUuid === 'function' && u.indexOf('-') === -1) {
        u = utils.decompressUuid(u) || u;
      }
    } catch (_) {}
    return u;
  }

  function assignSpriteFrame(comp, asset) {
    if (!asset) {
      comp.spriteFrame = null;
      return true;
    }
    if (typeof cc !== 'undefined' && cc.SpriteFrame && asset instanceof cc.SpriteFrame) {
      comp.spriteFrame = asset;
      return true;
    }
    if (typeof cc !== 'undefined' && cc.Texture2D && asset instanceof cc.Texture2D) {
      try {
        comp.spriteFrame = new cc.SpriteFrame(asset);
        return true;
      } catch (_) {
        try {
          var sf = new cc.SpriteFrame();
          sf.setTexture(asset);
          comp.spriteFrame = sf;
          return true;
        } catch (_2) {
          return false;
        }
      }
    }
    return false;
  }

  /**
   * 2.4+ assetManager；更早 2.x 回退 cc.loader / AssetLibrary
   */
  function loadAssetByUuid(rawUuid, onComplete) {
    var raw = String(rawUuid || '').trim();
    var targetUuid = normalizeAssetUuid(raw);
    var candidates = [];
    if (targetUuid) candidates.push(targetUuid);
    if (raw && raw !== targetUuid) candidates.push(raw);

    function fail(err) {
      onComplete(err || new Error('load asset failed'), null);
    }

    function tryAssign(asset) {
      return !!asset;
    }

    // 2.4+ cache
    try {
      if (cc.assetManager && cc.assetManager.assets) {
        for (var i = 0; i < candidates.length; i++) {
          var cached = cc.assetManager.assets.get(candidates[i]);
          if (cached && tryAssign(cached)) {
            onComplete(null, cached);
            return;
          }
        }
      }
    } catch (_) {}

    // 2.4+ loadAny
    if (cc.assetManager && typeof cc.assetManager.loadAny === 'function') {
      var idx = 0;
      function nextAm() {
        if (idx >= candidates.length) {
          // fall through to loader
          tryLoader();
          return;
        }
        var id = candidates[idx++];
        cc.assetManager.loadAny({ uuid: id }, function (err, asset) {
          if (!err && asset) {
            onComplete(null, asset);
            return;
          }
          cc.assetManager.loadAny(id, function (err2, asset2) {
            if (!err2 && asset2) {
              onComplete(null, asset2);
              return;
            }
            nextAm();
          });
        });
      }
      nextAm();
      return;
    }

    tryLoader();

    function tryLoader() {
      // 2.0～2.3 cc.loader
      if (typeof cc.loader !== 'undefined' && typeof cc.loader.load === 'function') {
        var li = 0;
        function nextLoader() {
          if (li >= candidates.length) {
            tryAssetLibrary();
            return;
          }
          var id = candidates[li++];
          try {
            cc.loader.load({ uuid: id, type: 'uuid' }, function (err, asset) {
              if (!err && asset) {
                onComplete(null, asset);
                return;
              }
              cc.loader.load(id, function (err2, asset2) {
                if (!err2 && asset2) {
                  onComplete(null, asset2);
                  return;
                }
                nextLoader();
              });
            });
          } catch (_) {
            nextLoader();
          }
        }
        nextLoader();
        return;
      }
      tryAssetLibrary();
    }

    function tryAssetLibrary() {
      if (typeof cc.AssetLibrary !== 'undefined' && typeof cc.AssetLibrary.loadAsset === 'function') {
        var ai = 0;
        function nextLib() {
          if (ai >= candidates.length) {
            fail(new Error('no assetManager/loader/AssetLibrary success'));
            return;
          }
          var id = candidates[ai++];
          try {
            cc.AssetLibrary.loadAsset(id, function (err, asset) {
              if (!err && asset) onComplete(null, asset);
              else nextLib();
            });
          } catch (_) {
            nextLib();
          }
        }
        nextLib();
        return;
      }
      fail(new Error('no asset load API (need 2.x assetManager or cc.loader)'));
    }
  }

  /**
   * @param {function=} onDone optional async callback (result)
   */
  function setCompProp(uuid, compIndex, prop, value, onDone) {
    const node = findNodeByUuid(uuid);
    if (!node) {
      var miss = { ok: false, error: 'node not found' };
      if (onDone) onDone(miss);
      return miss;
    }
    const comps = node._components || [];
    const comp = comps[compIndex];
    if (!comp) {
      var missC = { ok: false, error: 'component not found' };
      if (onDone) onDone(missC);
      return missC;
    }

    if (prop === '__enabled') {
      try {
        comp.enabled = !!value;
        var okEn = { ok: true };
        if (onDone) onDone(okEn);
        return okEn;
      } catch (e) {
        var errEn = { ok: false, error: String(e) };
        if (onDone) onDone(errEn);
        return errEn;
      }
    }

    // SpriteFrame by UUID — 2.x: assetManager / loader / AssetLibrary
    if (prop === 'spriteFrame') {
      var raw = value == null ? '' : String(value).trim();
      if (!raw) {
        try {
          comp.spriteFrame = null;
          var cleared = { ok: true };
          if (onDone) onDone(cleared);
          return cleared;
        } catch (e2) {
          var errCl = { ok: false, error: String(e2) };
          if (onDone) onDone(errCl);
          return errCl;
        }
      }

      loadAssetByUuid(raw, function (err, asset) {
        if (err) {
          if (onDone) onDone({ ok: false, error: String(err.message || err) });
          return;
        }
        if (!assignSpriteFrame(comp, asset)) {
          if (onDone) onDone({ ok: false, error: 'asset is not SpriteFrame/Texture2D' });
          return;
        }
        if (onDone) onDone({ ok: true });
      });
      return { ok: true, pending: true };
    }

    try {
      const current = comp[prop];
      const t = typeof current;
      if (t === 'number') {
        comp[prop] = Number(value);
      } else if (t === 'boolean') {
        comp[prop] = !!value;
      } else if (t === 'string') {
        comp[prop] = String(value);
      } else {
        var bad = { ok: false, error: 'prop not editable: ' + prop };
        if (onDone) onDone(bad);
        return bad;
      }
      var ok = { ok: true };
      if (onDone) onDone(ok);
      return ok;
    } catch (e) {
      var err = { ok: false, error: String(e) };
      if (onDone) onDone(err);
      return err;
    }
  }

  /**
   * Move node under newParentUuid at sibling index.
   * If newParentUuid is null, keep current parent and only reorder.
   */
  function moveNode(uuid, newParentUuid, siblingIndex) {
    const node = findNodeByUuid(uuid);
    if (!node) return { ok: false, error: 'node not found' };
    if (!node.parent && newParentUuid) {
      // Scene root shouldn't be reparented typically
    }

    const scene = cc.director.getScene();
    if (node === scene) {
      return { ok: false, error: 'cannot move scene root' };
    }

    let parent = node.parent;
    if (newParentUuid) {
      parent = findNodeByUuid(newParentUuid);
      if (!parent) return { ok: false, error: 'parent not found' };
      if (parent === node || isDescendant(node, parent)) {
        return { ok: false, error: 'cannot parent to self or descendant' };
      }
    }
    if (!parent) return { ok: false, error: 'no parent' };

    try {
      const idx = siblingIndex == null ? -1 : Number(siblingIndex);
      if (node.parent !== parent) {
        if (typeof parent.insertChild === 'function') {
          parent.insertChild(node, idx < 0 ? parent.childrenCount : idx);
        } else {
          node.parent = parent;
          if (typeof node.setSiblingIndex === 'function') {
            node.setSiblingIndex(idx);
          }
        }
      } else if (typeof node.setSiblingIndex === 'function') {
        node.setSiblingIndex(idx);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  var HIGHLIGHT_NAME = '__CC_NODE_INSPECTOR_HL__';
  var highlightNode = null;
  var hoverUuid = null;

  function clearHoverHighlight() {
    hoverUuid = null;
    if (highlightNode) {
      try {
        if (highlightNode.isValid) highlightNode.destroy();
      } catch (_) {}
    }
    highlightNode = null;
    return { ok: true };
  }

  function ensureHighlightNode() {
    if (highlightNode && highlightNode.isValid) return highlightNode;
    var n = new cc.Node(HIGHLIGHT_NAME);
    n.zIndex = typeof cc.macro !== 'undefined' ? cc.macro.MAX_ZINDEX : 9999;
    n.groupIndex = 0;
    n.addComponent(cc.Graphics);
    highlightNode = n;
    return n;
  }

  /** 高亮挂到 Canvas/场景根，不挂在目标节点下，避免被 Mask/透明度/兄弟遮挡 */
  function findHighlightHost(forNode) {
    var p = forNode;
    while (p) {
      try {
        if (cc.Canvas && p.getComponent && p.getComponent(cc.Canvas)) return p;
      } catch (_) {}
      p = p.parent;
    }
    var scene = null;
    try {
      scene = cc.director.getScene();
    } catch (_) {}
    if (!scene) return null;

    function findCanvas(n) {
      if (!n) return null;
      try {
        if (cc.Canvas && n.getComponent && n.getComponent(cc.Canvas)) return n;
      } catch (_) {}
      var ch = n.children || [];
      for (var i = 0; i < ch.length; i++) {
        var found = findCanvas(ch[i]);
        if (found) return found;
      }
      return null;
    }
    return findCanvas(scene) || scene;
  }

  function mountHighlightOnTop(hl, host) {
    if (!hl || !host) return;
    if (hl.parent !== host) {
      hl.parent = host;
    }
    try {
      hl.zIndex = typeof cc.macro !== 'undefined' ? cc.macro.MAX_ZINDEX : 9999;
    } catch (_) {}
    try {
      hl.groupIndex = host.groupIndex;
    } catch (_) {}
    try {
      hl.setSiblingIndex(host.children.length - 1);
    } catch (_) {}
    hl.setPosition(0, 0);
    try {
      hl.angle = 0;
    } catch (_) {}
    hl.scaleX = 1;
    hl.scaleY = 1;
    hl.opacity = 255;
    try {
      hl.active = true;
    } catch (_) {}
  }

  function worldRectToHostLocal(host, worldRect) {
    var lb = host.convertToNodeSpaceAR(cc.v2(worldRect.x, worldRect.y));
    var rt = host.convertToNodeSpaceAR(
      cc.v2(worldRect.x + worldRect.width, worldRect.y + worldRect.height)
    );
    return {
      x: Math.min(lb.x, rt.x),
      y: Math.min(lb.y, rt.y),
      width: Math.abs(rt.x - lb.x),
      height: Math.abs(rt.y - lb.y),
    };
  }

  function getNodeWorldAABB(node) {
    try {
      if (typeof node.getBoundingBoxToWorld === 'function') {
        var box = node.getBoundingBoxToWorld();
        if (box && box.width >= 1 && box.height >= 1) {
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        }
      }
    } catch (_) {}

    // 兜底：用本地宽高四角转到世界
    try {
      var w = Math.max(node.width || 0, 8);
      var h = Math.max(node.height || 0, 8);
      var ax = node.anchorX != null ? node.anchorX : 0.5;
      var ay = node.anchorY != null ? node.anchorY : 0.5;
      var corners = [
        cc.v2(-w * ax, -h * ay),
        cc.v2(w * (1 - ax), -h * ay),
        cc.v2(-w * ax, h * (1 - ay)),
        cc.v2(w * (1 - ax), h * (1 - ay)),
      ];
      var minX = Infinity;
      var minY = Infinity;
      var maxX = -Infinity;
      var maxY = -Infinity;
      for (var i = 0; i < corners.length; i++) {
        var wp = node.convertToWorldSpaceAR(corners[i]);
        if (wp.x < minX) minX = wp.x;
        if (wp.y < minY) minY = wp.y;
        if (wp.x > maxX) maxX = wp.x;
        if (wp.y > maxY) maxY = wp.y;
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    } catch (_2) {}
    return null;
  }

  /** 相机可视区域的世界坐标 AABB（轴对齐） */
  function getVisibleWorldAABB(forNode) {
    var cam = null;
    try {
      if (cc.Camera && typeof cc.Camera.findCamera === 'function') {
        cam = cc.Camera.findCamera(forNode);
      }
    } catch (_) {}
    if (!cam && cc.Camera) {
      try {
        cam = cc.Camera.main;
      } catch (_2) {}
    }

    var vs = null;
    var vo = { x: 0, y: 0 };
    try {
      vs = cc.view.getVisibleSize();
      if (cc.view.getVisibleOrigin) {
        var o = cc.view.getVisibleOrigin();
        vo = { x: o.x, y: o.y };
      }
    } catch (_) {}
    if (!vs) return null;

    var corners = [
      { x: vo.x, y: vo.y },
      { x: vo.x + vs.width, y: vo.y },
      { x: vo.x, y: vo.y + vs.height },
      { x: vo.x + vs.width, y: vo.y + vs.height },
    ];

    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    for (var i = 0; i < corners.length; i++) {
      var p = corners[i];
      var wp = p;
      try {
        if (cam && typeof cam.getScreenToWorldPoint === 'function') {
          wp = cam.getScreenToWorldPoint(cc.v2(p.x, p.y));
        }
      } catch (_) {}
      if (!wp) continue;
      if (wp.x < minX) minX = wp.x;
      if (wp.y < minY) minY = wp.y;
      if (wp.x > maxX) maxX = wp.x;
      if (wp.y > maxY) maxY = wp.y;
    }
    if (!(minX < maxX) || !(minY < maxY)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  function intersectAABB(a, b) {
    if (!a || !b) return null;
    var x1 = Math.max(a.x, b.x);
    var y1 = Math.max(a.y, b.y);
    var x2 = Math.min(a.x + a.width, b.x + b.width);
    var y2 = Math.min(a.y + a.height, b.y + b.height);
    if (x2 - x1 < 1 || y2 - y1 < 1) return null;
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  function refreshHoverHighlight() {
    if (!hoverUuid) return { ok: true };
    var node = findNodeByUuid(hoverUuid);
    if (!node || node.isValid === false) {
      return clearHoverHighlight();
    }

    var host = findHighlightHost(node);
    if (!host) return { ok: false, error: 'no highlight host' };

    var hl = ensureHighlightNode();
    try {
      mountHighlightOnTop(hl, host);

      var g = hl.getComponent(cc.Graphics);
      if (!g) g = hl.addComponent(cc.Graphics);
      g.clear();
      g.lineWidth = 10;
      g.strokeColor = cc.color(0, 220, 0, 255);

      var worldBox = getNodeWorldAABB(node);
      var visible = getVisibleWorldAABB(node);
      var drawWorld = worldBox;

      if (visible && worldBox) {
        var fullyInside =
          worldBox.x >= visible.x - 0.5 &&
          worldBox.y >= visible.y - 0.5 &&
          worldBox.x + worldBox.width <= visible.x + visible.width + 0.5 &&
          worldBox.y + worldBox.height <= visible.y + visible.height + 0.5;
        if (!fullyInside) {
          drawWorld = intersectAABB(worldBox, visible) || visible;
        }
      }

      if (!drawWorld) return { ok: false, error: 'no bounds' };

      var local = worldRectToHostLocal(host, drawWorld);
      var rw = Math.max(local.width, 2);
      var rh = Math.max(local.height, 2);
      g.rect(local.x, local.y, rw, rh);
      g.stroke();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  function setHoverHighlight(uuid) {
    if (!uuid) return clearHoverHighlight();
    hoverUuid = uuid;
    return refreshHoverHighlight();
  }

  window.__CCNodeInspectorMutator = {
    findNodeByUuid: findNodeByUuid,
    setNodeProp: setNodeProp,
    setCompProp: setCompProp,
    moveNode: moveNode,
    setHoverHighlight: setHoverHighlight,
    refreshHoverHighlight: refreshHoverHighlight,
    clearHoverHighlight: clearHoverHighlight,
  };
})();
