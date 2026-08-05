/**
 * Inspector panel: node props + component editable fields.
 */
(function (global) {
  'use strict';

  function InspectorView(rootEl, callbacks) {
    this.rootEl = rootEl;
    this.callbacks = callbacks || {};
    this.detail = null;
    this._collapsedComps = new Set();
  }

  InspectorView.prototype.setDetail = function (detail) {
    // Avoid stomping in-progress edits
    if (this.rootEl.querySelector('input:focus')) {
      this._pendingDetail = detail;
      return;
    }
    const next = detail ? JSON.stringify(detail) : '';
    if (next === this._lastJson) return;
    this._lastJson = next;
    this._pendingDetail = null;
    this.detail = detail;
    this.render();
  };

  InspectorView.prototype.render = function () {
    const el = this.rootEl;
    el.innerHTML = '';
    const d = this.detail;
    if (!d) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '请选择节点';
      el.appendChild(empty);
      return;
    }

    el.appendChild(this._section('节点', this._buildNodeFields(d)));

    const comps = d.components || [];
    for (let i = 0; i < comps.length; i++) {
      el.appendChild(this._buildComponent(d.uuid, comps[i]));
    }
  };

  InspectorView.prototype._section = function (title, bodyEl) {
    const sec = document.createElement('div');
    sec.className = 'section';
    const h = document.createElement('div');
    h.className = 'section-title';
    h.textContent = title;
    sec.appendChild(h);
    sec.appendChild(bodyEl);
    return sec;
  };

  InspectorView.prototype._row = function (label, control) {
    const row = document.createElement('div');
    row.className = 'prop-row';
    const lab = document.createElement('div');
    lab.className = 'prop-label';
    lab.textContent = label;
    lab.title = label;
    const val = document.createElement('div');
    val.className = 'prop-value';
    val.appendChild(control);
    row.appendChild(lab);
    row.appendChild(val);
    return row;
  };

  InspectorView.prototype._flushPendingAfterBlur = function () {
    const self = this;
    return function () {
      if (self._pendingDetail !== undefined && self._pendingDetail !== null) {
        const d = self._pendingDetail;
        self._pendingDetail = null;
        self._lastJson = '';
        self.setDetail(d);
      }
    };
  };

  InspectorView.prototype._numInput = function (value, onCommit) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.value = value != null ? value : 0;
    input.addEventListener('change', () => onCommit(Number(input.value)));
    input.addEventListener('blur', this._flushPendingAfterBlur());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
        onCommit(Number(input.value));
      }
    });
    return input;
  };

  InspectorView.prototype._textInput = function (value, onCommit) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value != null ? value : '';
    input.addEventListener('change', () => onCommit(input.value));
    input.addEventListener('blur', this._flushPendingAfterBlur());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
        onCommit(input.value);
      }
    });
    return input;
  };

  InspectorView.prototype._boolInput = function (value, onCommit) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!value;
    input.addEventListener('change', () => onCommit(!!input.checked));
    return input;
  };

  function toHex2(n) {
    const v = Math.max(0, Math.min(255, Number(n) || 0));
    return ('0' + Math.round(v).toString(16)).slice(-2);
  }

  function rgbaToHex(c) {
    return '#' + toHex2(c.r) + toHex2(c.g) + toHex2(c.b);
  }

  function hexToRgb(hex) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return { r: 255, g: 255, b: 255 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  InspectorView.prototype._colorInput = function (color, onCommit) {
    const wrap = document.createElement('div');
    wrap.className = 'color-field';

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = rgbaToHex(color);
    picker.title = 'Pick color';

    const alpha = document.createElement('input');
    alpha.type = 'number';
    alpha.min = '0';
    alpha.max = '255';
    alpha.step = '1';
    alpha.className = 'color-alpha';
    alpha.value = color.a != null ? color.a : 255;
    alpha.title = 'Alpha 0-255';

    const commit = function () {
      const rgb = hexToRgb(picker.value);
      onCommit({
        r: rgb.r,
        g: rgb.g,
        b: rgb.b,
        a: Number(alpha.value),
      });
    };

    picker.addEventListener('input', commit);
    picker.addEventListener('change', commit);
    alpha.addEventListener('change', commit);
    alpha.addEventListener('blur', this._flushPendingAfterBlur());

    const aLab = document.createElement('span');
    aLab.className = 'color-alpha-label';
    aLab.textContent = 'A';

    wrap.appendChild(picker);
    wrap.appendChild(aLab);
    wrap.appendChild(alpha);
    return wrap;
  };

  InspectorView.prototype._assetUuidInput = function (value, assetType, onCommit) {
    const wrap = document.createElement('div');
    wrap.className = 'uuid-field';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value != null ? value : '';
    input.placeholder = '资源 UUID（可粘贴）';
    input.title = assetType ? '类型: ' + assetType : '资源 UUID';
    input.addEventListener('change', function () {
      onCommit(input.value.trim());
    });
    input.addEventListener('blur', this._flushPendingAfterBlur());
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        input.blur();
        onCommit(input.value.trim());
      }
    });
    wrap.appendChild(input);
    return wrap;
  };

  InspectorView.prototype._buildNodeFields = function (d) {
    const wrap = document.createElement('div');
    const self = this;
    const set = function (prop, value) {
      if (self.callbacks.onSetNodeProp) {
        self.callbacks.onSetNodeProp(d.uuid, prop, value);
      }
    };

    wrap.appendChild(this._row('uuid', readonlyText(d.uuid)));
    wrap.appendChild(this._row('name', this._textInput(d.name, (v) => set('name', v))));
    if (!d.isScene) {
      wrap.appendChild(this._row('active', this._boolInput(d.active, (v) => set('active', v))));
    }

    wrap.appendChild(
      vecRow('position', [
        ['x', d.x],
        ['y', d.y],
        ['z', d.z],
      ], (k, v) => set(k, v), this)
    );
    wrap.appendChild(
      vecRow('size', [
        ['width', d.width],
        ['height', d.height],
      ], (k, v) => set(k, v), this)
    );
    wrap.appendChild(
      vecRow('anchor', [
        ['anchorX', d.anchorX],
        ['anchorY', d.anchorY],
      ], (k, v) => set(k, v), this)
    );
    wrap.appendChild(
      vecRow('scale', [
        ['scaleX', d.scaleX],
        ['scaleY', d.scaleY],
      ], (k, v) => set(k, v), this)
    );
    wrap.appendChild(this._row('angle', this._numInput(d.angle, (v) => set('angle', v))));
    wrap.appendChild(this._row('opacity', this._numInput(d.opacity, (v) => set('opacity', v))));
    wrap.appendChild(this._row('zIndex', this._numInput(d.zIndex, (v) => set('zIndex', v))));

    const c = d.color || { r: 255, g: 255, b: 255, a: 255 };
    wrap.appendChild(this._row('color', this._colorInput(c, function (rgba) {
      set('color', rgba);
    })));

    wrap.appendChild(
      this._row('parent', readonlyText((d.parentName || '') + (d.parentUuid ? ' (' + shortId(d.parentUuid) + ')' : '')))
    );
    wrap.appendChild(this._row('siblingIndex', readonlyText(String(d.siblingIndex))));

    return wrap;
  };

  function shortId(uuid) {
    return uuid ? String(uuid).slice(0, 8) : '';
  }

  function readonlyText(text) {
    const span = document.createElement('span');
    span.className = 'readonly';
    span.textContent = text == null ? '' : String(text);
    return span;
  }

  function vecRow(label, pairs, onSet, inspector) {
    const row = document.createElement('div');
    row.className = 'prop-row vec';
    const lab = document.createElement('div');
    lab.className = 'prop-label';
    lab.textContent = label;
    const val = document.createElement('div');
    val.className = 'prop-value';
    pairs.forEach(function (p) {
      const key = p[0];
      const short = key.replace('anchor', 'a').replace('scale', 's').replace('color', '');
      const lbl = document.createElement('label');
      lbl.textContent = short.charAt(0);
      const input = inspector._numInput(p[1], function (v) {
        onSet(key, v);
      });
      lbl.appendChild(input);
      val.appendChild(lbl);
    });
    row.appendChild(lab);
    row.appendChild(val);
    return row;
  }

  InspectorView.prototype._buildComponent = function (nodeUuid, comp) {
    const self = this;
    const key = nodeUuid + '#' + comp.index;
    const block = document.createElement('div');
    block.className = 'comp-block';

    const header = document.createElement('div');
    header.className = 'comp-header';
    const twist = document.createElement('span');
    const collapsed = this._collapsedComps.has(key);
    twist.textContent = collapsed ? '▶' : '▼';
    header.appendChild(twist);
    const title = document.createElement('span');
    title.textContent = comp.className || 'Component';
    header.appendChild(title);

    const enWrap = document.createElement('label');
    enWrap.className = 'en';
    enWrap.textContent = 'enabled ';
    const en = this._boolInput(comp.enabled, function (v) {
      if (self.callbacks.onSetCompProp) {
        self.callbacks.onSetCompProp(nodeUuid, comp.index, '__enabled', v);
      }
    });
    enWrap.appendChild(en);
    header.appendChild(enWrap);

    header.addEventListener('click', function (e) {
      if (e.target === en || e.target === enWrap) return;
      if (self._collapsedComps.has(key)) self._collapsedComps.delete(key);
      else self._collapsedComps.add(key);
      self.render();
    });
    block.appendChild(header);

    if (!collapsed) {
      const body = document.createElement('div');
      const props = comp.props || [];
      if (!props.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '无可序列化属性';
        body.appendChild(empty);
      }
      for (let i = 0; i < props.length; i++) {
        const p = props[i];
        let control;
        if (!p.editable) {
          control = readonlyText(
            typeof p.value === 'object' ? JSON.stringify(p.value) : String(p.value)
          );
        } else if (p.kind === 'number') {
          control = this._numInput(p.value, function (v) {
            self.callbacks.onSetCompProp(nodeUuid, comp.index, p.name, v);
          });
        } else if (p.kind === 'boolean') {
          control = this._boolInput(p.value, function (v) {
            self.callbacks.onSetCompProp(nodeUuid, comp.index, p.name, v);
          });
        } else if (p.kind === 'string') {
          control = this._textInput(p.value, function (v) {
            self.callbacks.onSetCompProp(nodeUuid, comp.index, p.name, v);
          });
        } else if (p.kind === 'asset-uuid') {
          control = self._assetUuidInput(p.value, p.assetType, function (v) {
            self.callbacks.onSetCompProp(nodeUuid, comp.index, p.name, v);
          });
        } else {
          control = readonlyText(String(p.value));
        }
        body.appendChild(this._row(p.name, control));
      }
      block.appendChild(body);
    }

    return block;
  };

  global.CCNodeInspectorView = InspectorView;
})(window);
