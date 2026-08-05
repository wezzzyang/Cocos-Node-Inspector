/**
 * 枚举并打包 Cocos Creator 2.x 资源（页面内下载，避免 CORS）
 * Spine：同目录导出 json + atlas + 贴图
 */
(function () {
  'use strict';

  if (window.__CCNodeInspectorAssetsInstalled) return;
  window.__CCNodeInspectorAssetsInstalled = true;

  function safeClassName(obj) {
    try {
      if (cc.js && cc.js.getClassName) return cc.js.getClassName(obj) || '';
    } catch (_) {}
    try {
      return (obj && obj.constructor && obj.constructor.name) || '';
    } catch (_2) {}
    return '';
  }

  function absUrl(u) {
    if (!u || typeof u !== 'string') return '';
    var s = u.trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s) || s.indexOf('data:') === 0 || s.indexOf('blob:') === 0) return s;
    try {
      return new URL(s, location.href).href;
    } catch (_) {
      return s;
    }
  }

  function extFromUrl(url) {
    try {
      var path = String(url).split('?')[0].split('#')[0];
      var m = path.match(/\.([a-z0-9]+)$/i);
      return m ? '.' + m[1].toLowerCase() : '';
    } catch (_) {
      return '';
    }
  }

  function sanitizePath(name) {
    return String(name || 'asset')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 120);
  }

  function guessCategory(cn, ext, url) {
    var e = (ext || extFromUrl(url) || '').toLowerCase();
    var c = (cn || '').toLowerCase();
    if (/texture|spriteframe|image|bitmap/.test(c) || /\.(png|jpe?g|gif|webp|pvr|pkm)$/i.test(e)) return 'images';
    if (/audio|audioclip|sound/.test(c) || /\.(mp3|ogg|wav|m4a|aac)$/i.test(e)) return 'audio';
    if (/skeletondata|spine|dragonbones|armature/.test(c)) return 'spine';
    if (/material|effect/.test(c)) return 'materials';
    if (/mesh|bufferasset|gltf/.test(c) || /\.(bin|glb|gltf|cconb)$/i.test(e)) return 'models';
    if (/font|bitmapfont|ttf/.test(c) || /\.(ttf|fnt)$/i.test(e)) return 'fonts';
    if (/animation|animclip/.test(c)) return 'animations';
    if (/\.(mp4|webm)$/i.test(e) || /video/.test(c)) return 'video';
    if (/\.json$/i.test(e) || /json|textasset|prefab/.test(c)) return 'json';
    return 'other';
  }

  function assetUuid(asset) {
    try {
      if (asset && asset._uuid) return String(asset._uuid);
    } catch (_) {}
    return '';
  }

  function assetName(asset) {
    try {
      if (asset && asset.name) return String(asset.name);
    } catch (_) {}
    try {
      if (asset && asset._name) return String(asset._name);
    } catch (_2) {}
    return '';
  }

  /** 真实 native 路径（带扩展名），不猜测 */
  function nativeUrlOf(asset) {
    if (!asset) return '';
    try {
      if (asset.nativeUrl) return absUrl(String(asset.nativeUrl));
    } catch (_) {}
    try {
      if (asset._nativeUrl) return absUrl(String(asset._nativeUrl));
    } catch (_2) {}
    try {
      var native = asset._native;
      if (typeof native === 'string' && native) {
        if (/^https?:\/\//i.test(native) || native.indexOf('/') >= 0) return absUrl(native);
        // 仅文件名：拼到 import 目录旁
        var uuid = assetUuid(asset);
        if (uuid && cc.assetManager && cc.assetManager.utils && cc.assetManager.utils.getUrlWithUuid) {
          var base = cc.assetManager.utils.getUrlWithUuid(uuid, { isNative: true, nativeExt: native });
          if (base) return absUrl(base);
        }
        if (uuid && cc.AssetLibrary && cc.AssetLibrary.getLibUrlNoExt) {
          var lib = cc.AssetLibrary.getLibUrlNoExt(uuid);
          return absUrl(lib + (native.charAt(0) === '.' ? native : '/' + native));
        }
      }
    } catch (_3) {}
    try {
      if (typeof asset.url === 'string' && asset.url && /\.[a-z0-9]+($|\?)/i.test(asset.url)) {
        return absUrl(asset.url);
      }
    } catch (_4) {}
    return '';
  }

  function nativeExtOf(asset) {
    try {
      var n = asset && asset._native;
      if (typeof n === 'string' && /^\.[a-z0-9]+$/i.test(n)) return n.toLowerCase();
    } catch (_) {}
    var u = nativeUrlOf(asset);
    return extFromUrl(u);
  }

  function pushUrl(map, item) {
    if (!item || !item.url) return;
    var url = absUrl(item.url);
    if (!url || url.indexOf('data:') === 0) return;
    // 必须像真实资源路径（有扩展名，或明确 inline 已处理）
    if (!extFromUrl(url) && !item.allowNoExt) return;
    if (map['url:' + url]) return;
    var ext = item.ext || extFromUrl(url);
    var category = item.category || guessCategory(item.className, ext, url);
    var base = sanitizePath(item.name || item.uuid || 'file');
    if (ext && base.toLowerCase().slice(-ext.length) !== ext.toLowerCase()) base += ext;
    var filename = (item.dir ? item.dir.replace(/\/?$/, '/') : category + '/') + base;
    map['url:' + url] = {
      kind: 'url',
      url: url,
      uuid: item.uuid || '',
      name: item.name || '',
      className: item.className || '',
      category: category,
      filename: filename,
    };
  }

  function pushInline(map, item) {
    if (!item || !item.filename || item.data == null) return;
    var key = 'inline:' + item.filename;
    if (map[key]) return;
    map[key] = {
      kind: 'inline',
      filename: item.filename,
      category: item.category || 'other',
      name: item.name || '',
      uuid: item.uuid || '',
      data: item.data, // Uint8Array | string (text)
      encoding: item.encoding || (typeof item.data === 'string' ? 'utf8' : 'binary'),
    };
  }

  function textToU8(text) {
    return new TextEncoder().encode(String(text));
  }

  function dataUrlToU8(dataUrl) {
    var m = String(dataUrl).match(/^data:([^;,]+)?(;base64)?,(.*)$/);
    if (!m) return null;
    var bin = atob(m[2] ? m[3] : decodeURIComponent(m[3]));
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  /** Texture2D → PNG bytes（优先 nativeUrl，否则 canvas 导出） */
  function textureToPngBytes(tex) {
    if (!tex) return null;
    try {
      var htmlImg = null;
      if (typeof tex.getHtmlElementObj === 'function') htmlImg = tex.getHtmlElementObj();
      if (!htmlImg) htmlImg = tex._image || tex.image;
      if (htmlImg && htmlImg.src && /^https?:/i.test(htmlImg.src)) {
        return { via: 'url', url: absUrl(htmlImg.src) };
      }
      var w = tex.width || (htmlImg && (htmlImg.width || htmlImg.naturalWidth)) || 0;
      var h = tex.height || (htmlImg && (htmlImg.height || htmlImg.naturalHeight)) || 0;
      if (htmlImg && w > 0 && h > 0) {
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(htmlImg, 0, 0, w, h);
        var du = canvas.toDataURL('image/png');
        var bytes = dataUrlToU8(du);
        if (bytes) return { via: 'inline', data: bytes, ext: '.png' };
      }
    } catch (_) {}
    var nu = nativeUrlOf(tex);
    if (nu) return { via: 'url', url: nu };
    return null;
  }

  function isSpineData(asset, cn) {
    if (/SkeletonData/i.test(cn)) return true;
    try {
      if (typeof sp !== 'undefined' && sp.SkeletonData && asset instanceof sp.SkeletonData) return true;
    } catch (_) {}
    return !!(asset && (asset.atlasText || asset._atlasText) && (asset.skeletonJson || asset._skeletonJson || asset._skeletonJsonData));
  }

  /** Spine 三件套：json + atlas + 贴图，放同一子目录 */
  function addSpineBundle(map, asset) {
    var uuid = assetUuid(asset);
    var name = sanitizePath(assetName(asset) || uuid.slice(0, 8) || 'spine');
    var dir = 'spine/' + name;
    var atlasText = asset.atlasText || asset._atlasText || '';
    var skeletonJson = asset.skeletonJson || asset._skeletonJson || asset._skeletonJsonData || null;

    if (skeletonJson) {
      var jsonStr =
        typeof skeletonJson === 'string' ? skeletonJson : JSON.stringify(skeletonJson, null, 2);
      pushInline(map, {
        filename: dir + '/' + name + '.json',
        category: 'spine',
        name: name,
        uuid: uuid,
        data: jsonStr,
        encoding: 'utf8',
      });
    } else {
      // 二进制 skel
      var native = nativeUrlOf(asset);
      if (native && /\.(skel|bin|json)($|\?)/i.test(native)) {
        pushUrl(map, {
          url: native,
          uuid: uuid,
          name: name,
          category: 'spine',
          dir: dir,
          className: 'sp.SkeletonData',
        });
      }
    }

    if (atlasText) {
      pushInline(map, {
        filename: dir + '/' + name + '.atlas',
        category: 'spine',
        name: name,
        uuid: uuid,
        data: atlasText,
        encoding: 'utf8',
      });
    }

    var textures = asset.textures || asset._textures || [];
    var textureNames = asset.textureNames || asset._textureNames || [];
    for (var i = 0; i < textures.length; i++) {
      var tex = textures[i];
      var tName = sanitizePath(textureNames[i] || assetName(tex) || name + '_tex' + i);
      if (!/\.(png|jpe?g|webp)$/i.test(tName)) tName += '.png';
      var packed = textureToPngBytes(tex);
      if (!packed) {
        var tu = nativeUrlOf(tex);
        if (tu) packed = { via: 'url', url: tu };
      }
      if (!packed) continue;
      if (packed.via === 'inline') {
        pushInline(map, {
          filename: dir + '/' + tName,
          category: 'spine',
          name: tName,
          uuid: assetUuid(tex) || uuid,
          data: packed.data,
          encoding: 'binary',
        });
      } else if (packed.via === 'url') {
        pushUrl(map, {
          url: packed.url,
          uuid: assetUuid(tex) || uuid,
          name: tName.replace(/\.[^.]+$/, ''),
          category: 'spine',
          dir: dir,
          className: 'Texture2D',
          ext: extFromUrl(packed.url) || '.png',
        });
      }
    }

    // 无 textures 数组时，尝试从 atlas 解析页名 + native
    if ((!textures || !textures.length) && atlasText) {
      var pages = atlasText.split(/\n\n+/);
      for (var p = 0; p < pages.length; p++) {
        var first = (pages[p].split('\n')[0] || '').trim();
        if (!first || first.indexOf('size:') === 0) continue;
        if (/\.(png|jpe?g|webp)$/i.test(first)) {
          // 无法直接得 URL，跳过；有 textures 时已处理
        }
      }
    }
  }

  function readSpriteFrameMeta(sf, nameHint) {
    if (!sf) return null;
    var rect = null;
    var offset = null;
    var originalSize = null;
    var rotated = false;
    try {
      rect = sf.getRect ? sf.getRect() : sf._rect;
    } catch (_) {}
    try {
      offset = sf.getOffset ? sf.getOffset() : sf._offset;
    } catch (_) {}
    try {
      originalSize = sf.getOriginalSize ? sf.getOriginalSize() : sf._originalSize;
    } catch (_) {}
    try {
      rotated = sf.isRotated ? !!sf.isRotated() : !!sf._rotated;
    } catch (_) {
      rotated = !!sf._rotated;
    }
    var tex = null;
    try {
      tex = sf.getTexture ? sf.getTexture() : sf._texture;
    } catch (_) {}
    var nm = nameHint || assetName(sf) || '';
    if (!nm) {
      try {
        nm = (sf._name || sf.name || '') + '';
      } catch (_2) {}
    }
    if (!nm) nm = assetUuid(sf).slice(0, 8) || 'frame';
    return {
      name: String(nm),
      uuid: assetUuid(sf),
      rect: rect
        ? { x: rect.x || 0, y: rect.y || 0, width: rect.width || 0, height: rect.height || 0 }
        : null,
      offset: offset ? { x: offset.x || 0, y: offset.y || 0 } : { x: 0, y: 0 },
      originalSize: originalSize
        ? { width: originalSize.width || 0, height: originalSize.height || 0 }
        : null,
      rotated: !!rotated,
      textureUuid: assetUuid(tex),
      _tex: tex,
    };
  }

  function textureKey(tex) {
    if (!tex) return '';
    var u = assetUuid(tex);
    if (u) return 'uuid:' + u;
    var nu = nativeUrlOf(tex);
    if (nu) return 'url:' + nu;
    try {
      return 'size:' + (tex.width || 0) + 'x' + (tex.height || 0) + ':' + (assetName(tex) || '');
    } catch (_) {
      return '';
    }
  }

  /** 收集贴图 → SpriteFrame 列表（图集信息） */
  function collectTextureFrameIndex() {
    var byTex = Object.create(null);

    function ensure(tex) {
      var key = textureKey(tex);
      if (!key) return null;
      if (!byTex[key]) {
        byTex[key] = { tex: tex, frames: [], seen: Object.create(null), atlasNames: [] };
      }
      return byTex[key];
    }

    function addFrame(sf, nameHint) {
      var meta = readSpriteFrameMeta(sf, nameHint);
      if (!meta || !meta._tex) return;
      var bucket = ensure(meta._tex);
      if (!bucket) return;
      var id = meta.uuid || meta.name + ':' + JSON.stringify(meta.rect);
      if (bucket.seen[id]) return;
      bucket.seen[id] = 1;
      var copy = {
        name: meta.name,
        uuid: meta.uuid,
        rect: meta.rect,
        offset: meta.offset,
        originalSize: meta.originalSize,
        rotated: meta.rotated,
        textureUuid: meta.textureUuid,
      };
      bucket.frames.push(copy);
    }

    function addAtlas(atlas) {
      if (!atlas) return;
      var aName = assetName(atlas) || assetUuid(atlas).slice(0, 8) || 'atlas';
      try {
        var tex = atlas.getTexture ? atlas.getTexture() : atlas._texture;
        if (tex) {
          var b = ensure(tex);
          if (b && b.atlasNames.indexOf(aName) < 0) b.atlasNames.push(aName);
        }
      } catch (_) {}
      try {
        if (atlas._spriteFrames) {
          for (var k in atlas._spriteFrames) {
            if (Object.prototype.hasOwnProperty.call(atlas._spriteFrames, k)) {
              addFrame(atlas._spriteFrames[k], k);
            }
          }
        }
      } catch (_2) {}
      try {
        var list = atlas.getSpriteFrames ? atlas.getSpriteFrames() : null;
        if (list && list.length) {
          for (var i = 0; i < list.length; i++) addFrame(list[i]);
        }
      } catch (_3) {}
    }

    forEachCachedAsset(function (asset) {
      if (!asset) return;
      var cn = safeClassName(asset);
      try {
        if (/SpriteAtlas/i.test(cn) || (cc.SpriteAtlas && asset instanceof cc.SpriteAtlas)) {
          addAtlas(asset);
          return;
        }
      } catch (_) {}
      try {
        if (
          /SpriteFrame/i.test(cn) ||
          (cc.SpriteFrame && asset instanceof cc.SpriteFrame) ||
          (asset.getTexture && asset._rect != null)
        ) {
          addFrame(asset);
        }
      } catch (_2) {}
    });

    try {
      var scene = cc.director && cc.director.getScene();
      if (scene && typeof scene.walk === 'function') {
        scene.walk(function (node) {
          if (!node || !node._components) return;
          for (var i = 0; i < node._components.length; i++) {
            var c = node._components[i];
            if (!c) continue;
            try {
              if (c.spriteFrame) addFrame(c.spriteFrame);
              if (c.spriteAtlas) addAtlas(c.spriteAtlas);
              if (c._spriteAtlas) addAtlas(c._spriteAtlas);
            } catch (_) {}
          }
        });
      }
    } catch (_4) {}

    return byTex;
  }

  /** TexturePacker JSON Hash + Cocos 补充字段，方便对照 */
  function buildAtlasMetaJson(imageFile, tex, frames, atlasNames) {
    var tw = 0;
    var th = 0;
    try {
      tw = tex.width || 0;
      th = tex.height || 0;
    } catch (_) {}
    var tpFrames = {};
    var cocosFrames = [];
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      var r = f.rect || { x: 0, y: 0, width: 0, height: 0 };
      var os = f.originalSize || { width: r.width, height: r.height };
      var off = f.offset || { x: 0, y: 0 };
      var fname = f.name || 'frame_' + i;
      tpFrames[fname] = {
        frame: { x: r.x, y: r.y, w: r.width, h: r.height },
        rotated: !!f.rotated,
        trimmed:
          !!(os.width && os.height) && (os.width !== r.width || os.height !== r.height),
        spriteSourceSize: {
          x: Math.round((os.width - r.width) / 2 + (off.x || 0)),
          y: Math.round((os.height - r.height) / 2 + (off.y || 0)),
          w: r.width,
          h: r.height,
        },
        sourceSize: { w: os.width || r.width, h: os.height || r.height },
        pivot: { x: 0.5, y: 0.5 },
      };
      cocosFrames.push({
        name: fname,
        uuid: f.uuid || '',
        rect: r,
        offset: off,
        originalSize: os,
        rotated: !!f.rotated,
      });
    }
    return {
      __format: 'CocosNodeInspector-SpriteAtlas',
      __note: '从运行时 SpriteFrame/SpriteAtlas 还原；可对照 TexturePacker frames 字段',
      atlasNames: atlasNames || [],
      textureUuid: assetUuid(tex),
      frames: tpFrames,
      cocosFrames: cocosFrames,
      meta: {
        app: 'Cocos Node Inspector',
        version: '1.3.3',
        image: imageFile,
        format: 'RGBA8888',
        size: { w: tw, h: th },
        scale: '1',
      },
    };
  }

  function exportTextureWithAtlasInfo(map, tex, frames, atlasNames) {
    if (!tex) return;
    var uuid = assetUuid(tex);
    var tBase = sanitizePath(assetName(tex) || uuid.slice(0, 8) || 'tex');
    var isAtlas = frames && frames.length > 1;
    var folder = isAtlas ? 'atlases' : 'images';
    if (atlasNames && atlasNames.length) {
      folder = 'atlases/' + sanitizePath(atlasNames[0]);
    } else if (isAtlas) {
      folder = 'atlases/' + tBase;
    }
    var imgName = tBase + '.png';
    var packed = textureToPngBytes(tex);
    if (packed && packed.via === 'inline') {
      pushInline(map, {
        filename: folder + '/' + imgName,
        category: isAtlas ? 'atlases' : 'images',
        name: tBase,
        uuid: uuid,
        data: packed.data,
        encoding: 'binary',
      });
    } else {
      var url = (packed && packed.url) || nativeUrlOf(tex);
      if (url) {
        var ext = extFromUrl(url) || '.png';
        imgName = tBase + ext;
        pushUrl(map, {
          url: url,
          uuid: uuid,
          name: tBase,
          className: 'Texture2D',
          category: isAtlas ? 'atlases' : 'images',
          dir: folder,
          ext: ext,
        });
      } else {
        return;
      }
    }

    if (frames && frames.length > 0) {
      var meta = buildAtlasMetaJson(imgName, tex, frames, atlasNames || []);
      pushInline(map, {
        filename: folder + '/' + tBase + '.json',
        category: 'atlases',
        name: tBase + '_atlas',
        uuid: uuid,
        data: JSON.stringify(meta, null, 2),
        encoding: 'utf8',
      });
      // 额外写一份简表，方便人眼查看
      var lines = ['# ' + imgName + ' frames=' + frames.length];
      for (var i = 0; i < frames.length; i++) {
        var fr = frames[i];
        var rr = fr.rect || {};
        lines.push(
          fr.name +
            '\tx=' +
            (rr.x || 0) +
            '\ty=' +
            (rr.y || 0) +
            '\tw=' +
            (rr.width || 0) +
            '\th=' +
            (rr.height || 0) +
            '\trotated=' +
            (!!fr.rotated)
        );
      }
      pushInline(map, {
        filename: folder + '/' + tBase + '.frames.txt',
        category: 'atlases',
        name: tBase + '_frames',
        uuid: uuid,
        data: lines.join('\n'),
        encoding: 'utf8',
      });
    }
  }

  function addAsset(map, asset, hintCategory, seen, frameIndex) {
    if (!asset || typeof asset !== 'object') return;
    seen = seen || new Set();
    var mark = asset;
    try {
      if (seen.has(mark)) return;
      seen.add(mark);
    } catch (_) {}

    var uuid = assetUuid(asset);
    var name = assetName(asset);
    var cn = safeClassName(asset);
    var category = hintCategory || guessCategory(cn, nativeExtOf(asset), '');

    if (isSpineData(asset, cn)) {
      addSpineBundle(map, asset);
      return;
    }

    // SpriteAtlas / SpriteFrame：由图集索引统一导出，避免只剩碎图
    try {
      if (/SpriteAtlas/i.test(cn) || (cc.SpriteAtlas && asset instanceof cc.SpriteAtlas)) {
        return;
      }
    } catch (_) {}
    try {
      if (
        /SpriteFrame/i.test(cn) ||
        (cc.SpriteFrame && asset instanceof cc.SpriteFrame) ||
        (asset.getTexture && asset._rect != null)
      ) {
        return;
      }
    } catch (_2) {}

    // Texture / Image
    if (/Texture2D|ImageAsset|Texture/i.test(cn) || asset._image || (asset.width && asset.getHtmlElementObj)) {
      var key = textureKey(asset);
      var bucket = frameIndex && key ? frameIndex[key] : null;
      if (bucket) {
        exportTextureWithAtlasInfo(map, asset, bucket.frames, bucket.atlasNames);
        bucket.__exported = true;
      } else {
        exportTextureWithAtlasInfo(map, asset, [], []);
      }
      return;
    }

    // 其它：只收真实 nativeUrl（带扩展名）
    var native = nativeUrlOf(asset);
    if (native && extFromUrl(native)) {
      pushUrl(map, {
        url: native,
        uuid: uuid,
        name: sanitizePath(name || uuid.slice(0, 8) || 'file'),
        className: cn,
        category: category,
      });
    }

    try {
      if (/Material/i.test(cn)) {
        if (asset.effectAsset) addAsset(map, asset.effectAsset, 'materials', seen, frameIndex);
        var props = asset._props || asset.props;
        if (props && typeof props === 'object') {
          for (var pk in props) {
            if (!Object.prototype.hasOwnProperty.call(props, pk)) continue;
            var pv = props[pk];
            if (pv && typeof pv === 'object') addAsset(map, pv, 'images', seen, frameIndex);
          }
        }
      }
    } catch (_3) {}

    try {
      if (asset._texture) addAsset(map, asset._texture, 'images', seen, frameIndex);
      if (asset.texture) addAsset(map, asset.texture, 'images', seen, frameIndex);
    } catch (_4) {}
  }

  function forEachCachedAsset(fn) {
    try {
      if (cc.assetManager && cc.assetManager.assets) {
        var am = cc.assetManager.assets;
        if (typeof am.forEach === 'function') {
          am.forEach(function (asset) {
            fn(asset);
          });
        } else if (am._map) {
          for (var k in am._map) {
            if (Object.prototype.hasOwnProperty.call(am._map, k)) fn(am._map[k]);
          }
        }
      }
    } catch (_) {}
    try {
      var cache = cc.loader && (cc.loader._cache || cc.loader._loaded);
      if (cache) {
        for (var id in cache) {
          if (!Object.prototype.hasOwnProperty.call(cache, id)) continue;
          var item = cache[id];
          var content = item && (item.content !== undefined ? item.content : item);
          if (content && typeof content === 'object') fn(content);
          if (item && typeof item.url === 'string' && extFromUrl(item.url)) {
            fn({ nativeUrl: item.url, _uuid: id, name: id });
          }
        }
      }
    } catch (_2) {}
  }

  /** 只收集 rawAssets 里带真实相对路径的条目，不扫全量 uuid 猜测 */
  function collectFromSettings(map) {
    var settings = null;
    try {
      settings = window._CCSettings || null;
    } catch (_) {}
    if (!settings || !settings.rawAssets) return;

    try {
      for (var group in settings.rawAssets) {
        if (!Object.prototype.hasOwnProperty.call(settings.rawAssets, group)) continue;
        var bag = settings.rawAssets[group];
        for (var key in bag) {
          if (!Object.prototype.hasOwnProperty.call(bag, key)) continue;
          var info = bag[key];
          var path = Array.isArray(info) ? info[0] : typeof info === 'string' ? info : '';
          if (!path || !extFromUrl(path)) continue;
          var url = path;
          if (path.indexOf('http') !== 0) {
            if (path.indexOf('assets/') === 0 || path.indexOf('internal/') === 0) {
              url = 'res/raw-assets/' + path;
            }
          }
          pushUrl(map, {
            url: absUrl(url),
            uuid: key.indexOf('/') < 0 ? key : '',
            name: sanitizePath(path.split('/').pop().replace(/\.[^.]+$/, '')),
            className: 'RawAsset',
            category: guessCategory('', extFromUrl(path), path),
          });
        }
      }
    } catch (_) {}
  }

  function collectAssets() {
    var map = Object.create(null);
    if (typeof cc === 'undefined') {
      return { ok: false, error: 'cc not ready', items: [], stats: {} };
    }

    var frameIndex = collectTextureFrameIndex();

    // 先导出所有带图集信息的贴图
    for (var fk in frameIndex) {
      if (!Object.prototype.hasOwnProperty.call(frameIndex, fk)) continue;
      var bucket = frameIndex[fk];
      exportTextureWithAtlasInfo(map, bucket.tex, bucket.frames, bucket.atlasNames);
      bucket.__exported = true;
    }

    forEachCachedAsset(function (asset) {
      addAsset(map, asset, null, new Set(), frameIndex);
    });
    collectFromSettings(map);

    try {
      var scene = cc.director && cc.director.getScene();
      if (scene && typeof scene.walk === 'function') {
        scene.walk(function (node) {
          if (!node || !node._components) return;
          var comps = node._components;
          for (var i = 0; i < comps.length; i++) {
            var c = comps[i];
            if (!c) continue;
            try {
              if (c.skeletonData) addAsset(map, c.skeletonData, 'spine', new Set(), frameIndex);
              if (c.dragonAsset) addAsset(map, c.dragonAsset, 'spine', new Set(), frameIndex);
              if (c.dragonAtlasAsset) addAsset(map, c.dragonAtlasAsset, 'spine', new Set(), frameIndex);
              if (c.font) addAsset(map, c.font, 'fonts', new Set(), frameIndex);
              if (c.material) addAsset(map, c.material, 'materials', new Set(), frameIndex);
              if (c.clip) addAsset(map, c.clip, 'audio', new Set(), frameIndex);
              if (c.mesh) addAsset(map, c.mesh, 'models', new Set(), frameIndex);
            } catch (_) {}
          }
        });
      }
    } catch (_3) {}

    var items = [];
    for (var key in map) {
      if (Object.prototype.hasOwnProperty.call(map, key)) items.push(map[key]);
    }

    // filename 去重
    var used = Object.create(null);
    for (var fi = 0; fi < items.length; fi++) {
      var f = items[fi].filename;
      if (!used[f]) {
        used[f] = 1;
        continue;
      }
      used[f]++;
      var dot = f.lastIndexOf('.');
      items[fi].filename =
        dot > 0 ? f.slice(0, dot) + '_' + used[f] + f.slice(dot) : f + '_' + used[f];
    }

    var stats = {};
    var atlasTexCount = 0;
    for (var si = 0; si < items.length; si++) {
      var cat = items[si].category || 'other';
      stats[cat] = (stats[cat] || 0) + 1;
    }
    for (var ak in frameIndex) {
      if (frameIndex[ak] && frameIndex[ak].frames && frameIndex[ak].frames.length > 1) {
        atlasTexCount++;
      }
    }
    stats.atlasTextures = atlasTexCount;

    return { ok: true, items: items, total: items.length, stats: stats, baseUrl: location.href };
  }

  function itemToBytes(item) {
    if (item.kind === 'inline') {
      if (item.encoding === 'utf8' || typeof item.data === 'string') return textToU8(item.data);
      if (item.data instanceof Uint8Array) return item.data;
      return new Uint8Array(item.data || []);
    }
    return null;
  }

  function fetchUrlBytes(url) {
    return fetch(url, { credentials: 'same-origin', cache: 'force-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer().then(function (ab) {
        return new Uint8Array(ab);
      });
    });
  }

  function triggerBlobDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    setTimeout(function () {
      try {
        a.remove();
        URL.revokeObjectURL(url);
      } catch (_) {}
    }, 60000);
  }

  /**
   * 在页面内拉取+打包+触发下载（同域无 CORS 问题）
   * onProgress(done, total, failed)
   */
  function exportAndDownloadZip(onProgress) {
    var collected = collectAssets();
    if (!collected.ok) return Promise.resolve(collected);
    var items = collected.items || [];
    if (!items.length) {
      return Promise.resolve({ ok: false, error: '未找到可导出资源', items: [], total: 0 });
    }

    var zipApi = window.__CCNodeInspectorZip;
    if (!zipApi || typeof zipApi.build !== 'function') {
      return Promise.resolve({ ok: false, error: 'zip 模块未加载' });
    }

    var files = [];
    var failed = [];
    var idx = 0;
    var done = 0;
    var parallel = 6;

    function bump() {
      done++;
      if (typeof onProgress === 'function') onProgress(done, items.length, failed.length);
    }

    function worker() {
      if (idx >= items.length) return Promise.resolve();
      var item = items[idx++];
      var name = item.filename;

      if (item.kind === 'inline') {
        try {
          files.push({ name: name, data: itemToBytes(item) });
        } catch (e) {
          failed.push(name + '\tinline\t' + e);
        }
        bump();
        return worker();
      }

      return fetchUrlBytes(item.url)
        .then(function (u8) {
          files.push({ name: name, data: u8 });
          bump();
        })
        .catch(function (err) {
          failed.push(name + '\t' + item.url + '\t' + (err && err.message ? err.message : err));
          bump();
        })
        .then(worker);
    }

    var starters = [];
    for (var p = 0; p < parallel && p < items.length; p++) starters.push(worker());

    return Promise.all(starters).then(function () {
      if (failed.length) {
        files.push({
          name: '_download_failed.txt',
          data: textToU8('failed=' + failed.length + '/' + items.length + '\n' + failed.join('\n')),
        });
      }
      if (!files.length) {
        return { ok: false, error: '全部拉取失败', failed: failed.length, total: items.length };
      }
      var blob = zipApi.build(files);
      var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      var filename = 'CocosAssets_' + stamp + '.zip';
      triggerBlobDownload(blob, filename);
      return {
        ok: true,
        filename: filename,
        packed: files.length - (failed.length ? 1 : 0),
        failed: failed.length,
        total: items.length,
        stats: collected.stats,
      };
    });
  }

  window.__CCNodeInspectorAssets = {
    collectAssets: collectAssets,
    exportAndDownloadZip: exportAndDownloadZip,
  };
})();
