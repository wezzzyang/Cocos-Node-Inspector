/**
 * 最小 ZIP（Store，无压缩）打包器 — 图片/音频本身已压缩，体积影响很小
 * 用法：CCNodeZip.build([{ name: 'images/a.png', data: Uint8Array|ArrayBuffer }]) => Blob
 */
(function (global) {
  'use strict';

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var c = 0xffffffff;
    for (var i = 0; i < u8.length; i++) {
      c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(n) {
    var b = new Uint8Array(2);
    b[0] = n & 0xff;
    b[1] = (n >>> 8) & 0xff;
    return b;
  }

  function u32(n) {
    var b = new Uint8Array(4);
    b[0] = n & 0xff;
    b[1] = (n >>> 8) & 0xff;
    b[2] = (n >>> 16) & 0xff;
    b[3] = (n >>> 24) & 0xff;
    return b;
  }

  function encodeName(name) {
    // 使用 UTF-8；设置 general purpose bit 11
    return new TextEncoder().encode(String(name).replace(/\\/g, '/'));
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

  /**
   * @param {{name:string, data:ArrayBuffer|Uint8Array}[]} files
   * @returns {Blob}
   */
  function build(files) {
    var localParts = [];
    var centralParts = [];
    var offset = 0;
    var count = 0;

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!f || !f.name) continue;
      var data = f.data;
      var u8 = data instanceof Uint8Array ? data : new Uint8Array(data || []);
      var nameBytes = encodeName(f.name);
      var crc = crc32(u8);
      var size = u8.length;

      // Local file header
      var local = concat([
        u32(0x04034b50),
        u16(20), // version needed
        u16(0x0800), // UTF-8 flag
        u16(0), // store
        u16(0),
        u16(0), // time/date
        u32(crc),
        u32(size),
        u32(size),
        u16(nameBytes.length),
        u16(0), // extra
        nameBytes,
        u8,
      ]);
      localParts.push(local);

      var central = concat([
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
      ]);
      centralParts.push(central);

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

    var zipBytes = concat(localParts.concat([centralDir, end]));
    return new Blob([zipBytes], { type: 'application/zip' });
  }

  global.CCNodeZip = { build: build };
})(window);
