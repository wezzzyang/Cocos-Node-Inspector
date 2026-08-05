/**
 * Hierarchy tree + Creator-style DnD:
 * - 指针偏左 / 同级区：按上下半区插入为兄弟（前/后）
 * - 指针偏右：成为目标子节点
 * Alt+Click：全部展开 / 折叠
 */
(function (global) {
  'use strict';

  var CHILD_INDENT_PX = 28;

  function TreeView(rootEl, callbacks) {
    this.rootEl = rootEl;
    this.callbacks = callbacks || {};
    this.tree = null;
    this.selectedUuid = null;
    this.collapsed = new Set();
    this.filter = '';
    this._dragUuid = null;
    this._hoverUuid = null;
    this._dropMode = null;
  }

  TreeView.prototype.setFilter = function (q) {
    this.filterRaw = (q || '').trim();
    this.filterMode = 'name';
    this.filter = '';
    const m = /^tt:\s*(.+)$/i.exec(this.filterRaw);
    if (m) {
      this.filterMode = 'comp';
      this.filter = m[1].trim().toLowerCase();
    } else {
      this.filter = this.filterRaw.toLowerCase();
    }
    this.render();
  };

  TreeView.prototype._nodeMatchesSelf = function (node) {
    if (!this.filter) return true;
    if (this.filterMode === 'comp') {
      const comps = node.comps || [];
      for (let i = 0; i < comps.length; i++) {
        if (String(comps[i]).toLowerCase().indexOf(this.filter) !== -1) return true;
      }
      // also allow L/S shortcuts
      if (this.filter === 'l' || this.filter === 'label') {
        if (node.hasLabel) return true;
      }
      if (this.filter === 's' || this.filter === 'sprite') {
        if (node.hasSprite) return true;
      }
      return false;
    }
    return (node.name || '').toLowerCase().indexOf(this.filter) !== -1;
  };

  TreeView.prototype._matchesFilter = function (node) {
    if (!this.filter) return true;
    if (this._nodeMatchesSelf(node)) return true;
    const ch = node.children || [];
    for (let i = 0; i < ch.length; i++) {
      if (this._matchesFilter(ch[i])) return true;
    }
    return false;
  };

  TreeView.prototype.setTree = function (tree) {
    this.tree = tree;
    this.render();
  };

  TreeView.prototype.select = function (uuid, silent) {
    this.selectedUuid = uuid;
    this.render();
    if (!silent && this.callbacks.onSelect) this.callbacks.onSelect(uuid);
  };

  /** @returns {string[]|null} name path from root to uuid */
  TreeView.prototype.getPathToUuid = function (uuid) {
    function walk(node, path) {
      if (!node) return null;
      const next = path.concat([node.name || '']);
      if (node.uuid === uuid) return next;
      const ch = node.children || [];
      for (let i = 0; i < ch.length; i++) {
        const hit = walk(ch[i], next);
        if (hit) return hit;
      }
      return null;
    }
    return walk(this.tree, []);
  };

  /** @returns {{uuid:string}|null} */
  TreeView.prototype.findByUuid = function (uuid) {
    function walk(node) {
      if (!node) return null;
      if (node.uuid === uuid) return node;
      const ch = node.children || [];
      for (let i = 0; i < ch.length; i++) {
        const hit = walk(ch[i]);
        if (hit) return hit;
      }
      return null;
    }
    return walk(this.tree);
  };

  /**
   * Match by name path (from scene root).
   * @returns {{uuid:string}|null}
   */
  TreeView.prototype.findByNamePath = function (namePath) {
    if (!this.tree || !namePath || !namePath.length) return null;
    let node = this.tree;
    let start = 0;
    if (namePath[0] === node.name) start = 1;
    for (let i = start; i < namePath.length; i++) {
      const kids = node.children || [];
      let hit = null;
      for (let k = 0; k < kids.length; k++) {
        if (kids[k].name === namePath[i]) {
          hit = kids[k];
          break;
        }
      }
      if (!hit) return null;
      node = hit;
    }
    return node;
  };

  /** Expand ancestors so uuid is visible (collapsed set = folded). */
  TreeView.prototype.expandToUuid = function (uuid) {
    const pathNodes = [];
    function walk(node, stack) {
      if (!node) return false;
      const next = stack.concat([node]);
      if (node.uuid === uuid) {
        for (let i = 0; i < next.length; i++) pathNodes.push(next[i]);
        return true;
      }
      const ch = node.children || [];
      for (let i = 0; i < ch.length; i++) {
        if (walk(ch[i], next)) return true;
      }
      return false;
    }
    if (!walk(this.tree, [])) return false;
    // unfold all ancestors (and the node itself if it has children)
    for (let i = 0; i < pathNodes.length; i++) {
      this.collapsed.delete(pathNodes[i].uuid);
    }
    return true;
  };

  TreeView.prototype.scrollToUuid = function (uuid) {
    const el = this.rootEl.querySelector('.tree-row[data-uuid="' + uuid + '"]');
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };

  TreeView.prototype._isCollapsed = function (uuid) {
    return this.collapsed.has(uuid);
  };

  TreeView.prototype.toggleCollapse = function (uuid) {
    if (this.collapsed.has(uuid)) this.collapsed.delete(uuid);
    else this.collapsed.add(uuid);
    this.render();
  };

  TreeView.prototype._collectBranchUuids = function (node, out) {
    if (!node) return;
    const ch = node.children || [];
    if (ch.length > 0) {
      out.push(node.uuid);
      for (let i = 0; i < ch.length; i++) this._collectBranchUuids(ch[i], out);
    }
  };

  /**
   * Alt+click：只对该节点及其子孙分叉做全展/全折（不影响树的其他分支）。
   */
  TreeView.prototype.toggleExpandCollapseSubtree = function (rootNode) {
    if (!rootNode) return;
    const branches = [];
    this._collectBranchUuids(rootNode, branches);
    if (!branches.length) return;

    let anyExpanded = false;
    for (let i = 0; i < branches.length; i++) {
      if (!this.collapsed.has(branches[i])) {
        anyExpanded = true;
        break;
      }
    }

    if (anyExpanded) {
      for (let j = 0; j < branches.length; j++) this.collapsed.add(branches[j]);
    } else {
      for (let k = 0; k < branches.length; k++) this.collapsed.delete(branches[k]);
    }
    this.render();
  };

  TreeView.prototype._emitHover = function (uuid) {
    if (this._hoverUuid === uuid) return;
    this._hoverUuid = uuid;
    if (this.callbacks.onHover) this.callbacks.onHover(uuid);
  };

  TreeView.prototype._clearDropIndicators = function () {
    this.rootEl.querySelectorAll('.drop-before, .drop-after, .drop-inside').forEach(function (n) {
      n.classList.remove('drop-before', 'drop-after', 'drop-inside');
    });
    this._dropMode = null;
  };

  /**
   * @returns {'before'|'after'|'inside'}
   */
  TreeView.prototype._calcDropMode = function (row, e, depth) {
    const rect = row.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const padLeft = 4 + depth * 14;
    // 鼠标相对行内容再向右偏移 → 视为「成为子节点」
    const childThreshold = padLeft + CHILD_INDENT_PX;
    if (x >= childThreshold) return 'inside';
    if (y < rect.height * 0.5) return 'before';
    return 'after';
  };

  TreeView.prototype.render = function () {
    const el = this.rootEl;
    el.innerHTML = '';
    if (!this.tree) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '无场景';
      el.appendChild(empty);
      return;
    }
    this._renderNode(this.tree, el, 0, null, 0);
  };

  TreeView.prototype._renderNode = function (node, parentEl, depth, parentUuid, siblingIndex) {
    if (!node) return;
    if (!this._matchesFilter(node)) return;

    const self = this;
    const row = document.createElement('div');
    row.className = 'tree-row';
    if (node.uuid === this.selectedUuid) row.classList.add('selected');
    if (!node.active) row.classList.add('inactive');
    row.style.paddingLeft = 4 + depth * 14 + 'px';
    row.dataset.uuid = node.uuid;
    row.dataset.parentUuid = parentUuid || '';
    row.dataset.siblingIndex = String(siblingIndex);
    row.dataset.depth = String(depth);
    row.draggable = depth > 0;

    const hasChildren = node.children && node.children.length > 0;
    const twist = document.createElement('span');
    twist.className = 'tree-twist' + (hasChildren ? '' : ' empty');
    const collapsed = this._isCollapsed(node.uuid);
    twist.textContent = hasChildren ? (collapsed ? '▶' : '▼') : '•';
    if (hasChildren) {
      twist.addEventListener('click', function (e) {
        e.stopPropagation();
        if (e.altKey) {
          self.toggleExpandCollapseSubtree(node);
          return;
        }
        self.toggleCollapse(node.uuid);
      });
    }
    row.appendChild(twist);

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node.name || '(unnamed)';
    row.appendChild(name);

    if (node.hasLabel) {
      const badgeL = document.createElement('span');
      badgeL.className = 'tree-badge badge-l';
      badgeL.textContent = 'L';
      badgeL.title = 'cc.Label';
      row.appendChild(badgeL);
    }
    if (node.hasSprite) {
      const badgeS = document.createElement('span');
      badgeS.className = 'tree-badge badge-s';
      badgeS.textContent = 'S';
      badgeS.title = 'cc.Sprite';
      row.appendChild(badgeS);
    }

    if (node.componentCount) {
      const meta = document.createElement('span');
      meta.className = 'tree-meta';
      meta.textContent = '组件:' + node.componentCount;
      row.appendChild(meta);
    }

    row.addEventListener('click', function (e) {
      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        self.toggleExpandCollapseSubtree(node);
        return;
      }
      self.select(node.uuid);
    });

    row.addEventListener('mouseenter', function () {
      self._emitHover(node.uuid);
    });

    row.addEventListener('mouseleave', function () {
      self._emitHover(null);
    });

    row.addEventListener('dragstart', function (e) {
      self._dragUuid = node.uuid;
      e.dataTransfer.setData('text/plain', node.uuid);
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', function () {
      self._dragUuid = null;
      self._clearDropIndicators();
    });

    row.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      self.rootEl.querySelectorAll('.drop-before, .drop-after, .drop-inside').forEach(function (n) {
        if (n !== row) n.classList.remove('drop-before', 'drop-after', 'drop-inside');
      });
      const mode = self._calcDropMode(row, e, depth);
      row.classList.remove('drop-before', 'drop-after', 'drop-inside');
      row.classList.add('drop-' + (mode === 'inside' ? 'inside' : mode));
      self._dropMode = { mode: mode, uuid: node.uuid, parentUuid: parentUuid, siblingIndex: siblingIndex };
    });

    row.addEventListener('dragleave', function (e) {
      if (!row.contains(e.relatedTarget)) {
        row.classList.remove('drop-before', 'drop-after', 'drop-inside');
      }
    });

    row.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const dragUuid = e.dataTransfer.getData('text/plain') || self._dragUuid;
      const mode = self._calcDropMode(row, e, depth);
      self._clearDropIndicators();
      if (!dragUuid || dragUuid === node.uuid) return;
      if (!self.callbacks.onMove) return;

      if (mode === 'inside') {
        self.callbacks.onMove({
          uuid: dragUuid,
          newParentUuid: node.uuid,
          siblingIndex: -1,
        });
        return;
      }

      // 同级：放到目标节点的父下，before / after
      if (!parentUuid) {
        // 落在场景根上且偏左：作为场景直接子节点
        self.callbacks.onMove({
          uuid: dragUuid,
          newParentUuid: node.uuid,
          siblingIndex: mode === 'before' ? 0 : -1,
        });
        return;
      }

      const idx = mode === 'before' ? siblingIndex : siblingIndex + 1;
      self.callbacks.onMove({
        uuid: dragUuid,
        newParentUuid: parentUuid,
        siblingIndex: idx,
      });
    });

    parentEl.appendChild(row);

    if (hasChildren && !collapsed) {
      for (let i = 0; i < node.children.length; i++) {
        this._renderNode(node.children[i], parentEl, depth + 1, node.uuid, i);
      }
    }
  };

  global.CCNodeTreeView = TreeView;
})(window);
