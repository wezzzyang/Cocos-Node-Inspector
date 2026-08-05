/**
 * MAIN-world helpers: serialize Cocos nodes / components to JSON-safe DTOs.
 * Attaches to window.__CCNodeInspectorSerializer
 */
(function () {
  'use strict';

  function safeClassName(obj) {
    try {
      if (typeof cc !== 'undefined' && cc.js && cc.js.getClassName) {
        return cc.js.getClassName(obj) || obj.constructor.name || 'Unknown';
      }
    } catch (_) {}
    return (obj && obj.constructor && obj.constructor.name) || 'Unknown';
  }

  function describeValue(value) {
    if (value === null || value === undefined) {
      return { kind: 'null', value: null, editable: false };
    }
    const t = typeof value;
    if (t === 'number' || t === 'boolean' || t === 'string') {
      return { kind: t, value: value, editable: true };
    }
    if (Array.isArray(value)) {
      return {
        kind: 'array',
        value: '[Array(' + value.length + ')]',
        editable: false,
      };
    }
    if (t === 'object') {
      let typeName = 'Object';
      try {
        if (typeof cc !== 'undefined') {
          if (value instanceof cc.Node) typeName = 'cc.Node';
          else if (value instanceof cc.Component) typeName = safeClassName(value);
          else if (value instanceof cc.Color) {
            return {
              kind: 'color',
              value: { r: value.r, g: value.g, b: value.b, a: value.a },
              editable: false,
            };
          } else if (value instanceof cc.Vec2) {
            return {
              kind: 'vec2',
              value: { x: value.x, y: value.y },
              editable: false,
            };
          } else if (value instanceof cc.Vec3) {
            return {
              kind: 'vec3',
              value: { x: value.x, y: value.y, z: value.z },
              editable: false,
            };
          } else if (value instanceof cc.Size) {
            return {
              kind: 'size',
              value: { width: value.width, height: value.height },
              editable: false,
            };
          }
        }
        typeName = safeClassName(value);
      } catch (_) {}
      return { kind: 'object', value: typeName, editable: false };
    }
    return { kind: t, value: String(value), editable: false };
  }

  function isNumericAttrType(attrType) {
    if (attrType == null) return false;
    try {
      if (typeof cc !== 'undefined') {
        if (attrType === cc.Float || attrType === cc.Integer) return true;
        if (attrType === Number) return true;
      }
    } catch (_) {}
    if (attrType === 'Float' || attrType === 'Integer' || attrType === 'Number') return true;
    return false;
  }

  function serializeComponent(comp, index) {
    const ctor = comp.constructor;
    const className = safeClassName(comp);
    const props = [];
    const propNames = (ctor && ctor.__props__) || [];

    let attrs = null;
    try {
      if (typeof cc !== 'undefined' && cc.Class && cc.Class.Attr) {
        attrs = cc.Class.Attr.getClassAttrs(ctor);
      }
    } catch (_) {}

    const delim =
      (typeof cc !== 'undefined' &&
        cc.Class &&
        cc.Class.Attr &&
        cc.Class.Attr.DELIMETER) ||
      '$_$';

    for (let i = 0; i < propNames.length; i++) {
      const name = propNames[i];
      if (!name || name.charAt(0) === '_') continue;

      let value;
      try {
        value = comp[name];
      } catch (_) {
        continue;
      }

      const described = describeValue(value);
      let editable = described.editable;
      let kind = described.kind;

      // Prefer attr type for numbers
      try {
        if (attrs) {
          const typeKey = name + delim + 'type';
          if (isNumericAttrType(attrs[typeKey]) && typeof value === 'number') {
            editable = true;
            kind = 'number';
          }
        } else if (typeof cc !== 'undefined' && cc.Class && cc.Class.attr) {
          const meta = cc.Class.attr(ctor, name);
          if (meta && isNumericAttrType(meta.type) && typeof value === 'number') {
            editable = true;
            kind = 'number';
          }
        }
      } catch (_) {}

      // SpriteFrame: expose editable UUID (load via assetManager)
      try {
        if (
          name === 'spriteFrame' ||
          (typeof cc !== 'undefined' &&
            cc.SpriteFrame &&
            value instanceof cc.SpriteFrame)
        ) {
          var sfUuid = '';
          if (value && value._uuid) sfUuid = String(value._uuid);
          props.push({
            name: name === 'spriteFrame' ? 'spriteFrame' : name,
            kind: 'asset-uuid',
            value: sfUuid,
            editable: true,
            assetType: 'cc.SpriteFrame',
          });
          continue;
        }
      } catch (_) {}

      // First-phase: only number / boolean / string editable
      if (kind !== 'number' && kind !== 'boolean' && kind !== 'string') {
        editable = false;
      }

      props.push({
        name: name,
        kind: kind,
        value: described.value,
        editable: editable,
      });
    }

    // Ensure spriteFrame uuid shows even if not in __props__ order oddly
    try {
      if (
        typeof cc !== 'undefined' &&
        cc.Sprite &&
        comp instanceof cc.Sprite &&
        !props.some(function (p) {
          return p.name === 'spriteFrame' && p.kind === 'asset-uuid';
        })
      ) {
        var sf = comp.spriteFrame;
        props.unshift({
          name: 'spriteFrame',
          kind: 'asset-uuid',
          value: sf && sf._uuid ? String(sf._uuid) : '',
          editable: true,
          assetType: 'cc.SpriteFrame',
        });
      }
    } catch (_) {}

    return {
      index: index,
      className: className,
      enabled: !!comp.enabled,
      props: props,
    };
  }

  function isSceneNode(node) {
    if (!node) return false;
    try {
      if (typeof cc !== 'undefined' && cc.Scene && node instanceof cc.Scene) return true;
    } catch (_) {}
    return !!(node._isScene);
  }

  function safeActive(node) {
    if (isSceneNode(node)) return true;
    try {
      return !!node.active;
    } catch (_) {
      return true;
    }
  }

  function safeActiveInHierarchy(node) {
    if (isSceneNode(node)) return true;
    try {
      return !!node.activeInHierarchy;
    } catch (_) {
      return true;
    }
  }

  function serializeNodeDetail(node) {
    if (!node) return null;
    const scene = isSceneNode(node);

    let color = { r: 255, g: 255, b: 255, a: 255 };
    try {
      const c = node.color;
      if (c) color = { r: c.r, g: c.g, b: c.b, a: c.a };
    } catch (_) {}

    const components = [];
    try {
      const list = node._components || [];
      for (let i = 0; i < list.length; i++) {
        components.push(serializeComponent(list[i], i));
      }
    } catch (_) {}

    return {
      uuid: node.uuid,
      name: node.name,
      isScene: scene,
      active: safeActive(node),
      activeInHierarchy: safeActiveInHierarchy(node),
      x: node.x,
      y: node.y,
      z: typeof node.z === 'number' ? node.z : 0,
      width: node.width,
      height: node.height,
      anchorX: node.anchorX,
      anchorY: node.anchorY,
      scaleX: node.scaleX,
      scaleY: node.scaleY,
      angle:
        typeof node.angle === 'number'
          ? node.angle
          : typeof node.rotation === 'number'
            ? -node.rotation
            : 0,
      opacity: node.opacity,
      color: color,
      zIndex: node.zIndex,
      parentUuid: node.parent ? node.parent.uuid : null,
      parentName: node.parent ? node.parent.name : null,
      siblingIndex: typeof node.getSiblingIndex === 'function' ? node.getSiblingIndex() : -1,
      childrenCount: node.childrenCount || (node.children ? node.children.length : 0),
      components: components,
    };
  }

  var HIGHLIGHT_NAME = '__CC_NODE_INSPECTOR_HL__';

  function serializeTreeNode(node) {
    if (!node) return null;
    if (node.name === HIGHLIGHT_NAME) return null;
    const children = [];
    const list = node.children || [];
    for (let i = 0; i < list.length; i++) {
      const child = list[i];
      if (child && child.name === HIGHLIGHT_NAME) continue;
      const serialized = serializeTreeNode(child);
      if (serialized) children.push(serialized);
    }
    let compCount = 0;
    let hasLabel = false;
    let hasSprite = false;
    const comps = [];
    try {
      const clist = node._components || [];
      compCount = clist.length;
      for (let ci = 0; ci < clist.length; ci++) {
        const c = clist[ci];
        if (!c) continue;
        let cn = '';
        try {
          cn = safeClassName(c);
        } catch (_) {
          cn = (c.constructor && c.constructor.name) || '';
        }
        if (cn) comps.push(cn);
        try {
          if (typeof cc !== 'undefined') {
            if (cc.Label && c instanceof cc.Label) hasLabel = true;
            if (cc.Sprite && c instanceof cc.Sprite) hasSprite = true;
          }
        } catch (_) {}
        if (!hasLabel && /Label/i.test(cn)) hasLabel = true;
        if (!hasSprite && /Sprite$/i.test(cn) && cn.indexOf('SpriteFrame') === -1) hasSprite = true;
      }
    } catch (_) {}

    return {
      uuid: node.uuid,
      name: node.name || '',
      active: safeActive(node),
      isScene: isSceneNode(node),
      childrenCount: children.length,
      componentCount: compCount,
      hasLabel: hasLabel,
      hasSprite: hasSprite,
      comps: comps,
      children: children,
    };
  }

  function serializeSceneTree() {
    if (typeof cc === 'undefined' || !cc.director) {
      return { ok: false, error: 'cc not ready' };
    }
    const scene = cc.director.getScene();
    if (!scene) {
      return { ok: true, scene: null, tree: null };
    }
    return {
      ok: true,
      sceneUuid: scene.uuid,
      sceneName: scene.name,
      tree: serializeTreeNode(scene),
    };
  }

  window.__CCNodeInspectorSerializer = {
    serializeSceneTree: serializeSceneTree,
    serializeNodeDetail: serializeNodeDetail,
    serializeTreeNode: serializeTreeNode,
    describeValue: describeValue,
  };
})();
