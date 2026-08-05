/**
 * 最小 ZIP（Store）— 供 MAIN world 页面内打包下载
 */
(function () {
  'use strict';
  if (window.__CCNodeInspectorZipInstalled) return;
  window.__CCNodeInspectorZipInstalled = true;

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var c = 0xffffffff;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(n) {
    return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  }
  function u32(n) {
    return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  }
  function concat(chunks) {
    var total = 0;
    for (var i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total);
    var off = 0;
    for (var j = 0; j < chunks.length; j++) {
      out.set(chunks[j], off);
      off += chunks[j].length;
    }
    return out;
  }

  function build(files) {
    var localParts = [];
    var centralParts = [];
    var offset = 0;
    var count = 0;
    var enc = new TextEncoder();
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!f || !f.name) continue;
      var u8 = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data || []);
      var nameBytes = enc.encode(String(f.name).replace(/\\/g, '/'));
      var crc = crc32(u8);
      var size = u8.length;
      var local = concat([
        u32(0x04034b50),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(size),
        u32(size),
        u16(nameBytes.length),
        u16(0),
        nameBytes,
        u8,
      ]);
      localParts.push(local);
      centralParts.push(
        concat([
          u32(0x02014b50),
          u16(20),
          u16(20),
          u16(0x0800),
          u16(0),
          u16(0),
          u16(0),
          u32(crc),
          u32(size),
          u32(size),
          u16(nameBytes.length),
          u16(0),
          u16(0),
          u16(0),
          u16(0),
          u32(0),
          u32(offset),
          nameBytes,
        ])
      );
      offset += local.length;
      count++;
    }
    var centralDir = concat(centralParts);
    var end = concat([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(count),
      u16(count),
      u32(centralDir.length),
      u32(offset),
      u16(0),
    ]);
    return new Blob([concat(localParts.concat([centralDir, end]))], { type: 'application/zip' });
  }

  window.__CCNodeInspectorZip = { build: build };
})();
