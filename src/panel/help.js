/**
 * 功能说明（集中维护：新增功能时在此追加条目即可）
 * 每项：{ id, title, items: string[] }
 */
(function (global) {
  'use strict';

  var HELP_SECTIONS = [
    {
      id: 'basic',
      title: '基础',
      items: [
        '在 Chrome 加载本扩展后，打开 Cocos Creator 2.x Web 预览（任意 IP/域名，如 `localhost:7456` 或 `192.168.x.x:7456`），按 F12 打开「Cocos Node」面板。探测到页面存在 `cc` 后自动连接。',
        '兼容 Creator 2.0～2.4；状态栏会显示引擎版本号（若可读取）。',
        '状态栏显示连接状态与当前场景名；点「刷新」可强制拉取节点树。',
        '「轮询」开启后会周期性同步节点树与选中节点属性；可调整间隔（毫秒）。',
        '「下载资源」：在游戏页内打包成一个 zip；Spine 会导出同目录下的 `.json` + `.atlas` + 贴图。',
      ],
    },
    {
      id: 'assets',
      title: '一键下载资源',
      items: [
        '在页面主世界拉取并打包（避免扩展面板 CORS 导致大量失败）。',
        'Spine：每个 SkeletonData 导出到 `spine/名称/`，包含 json、atlas、png 三件套（内存优先，不靠乱猜扩展名）。',
        '合图/图集：从运行时 SpriteFrame、SpriteAtlas 还原裁切信息，与贴图同目录输出 `.json`（TexturePacker frames 兼容）和 `.frames.txt`；多帧贴图在 `atlases/`。',
        '其它资源只收集带真实扩展名的 nativeUrl / rawAssets，不再对每个 uuid 盲猜 .png/.mp3。',
        '压缩包内仍按 images、atlases、spine、audio、materials、models 等目录分类；失败列表见 `_download_failed.txt`。',
        '建议先进入资源已加载的界面再点下载。',
      ],
    },
      id: 'hierarchy',
      title: '节点树',
      items: [
        '点击节点可选中，并在右侧查看/编辑属性。',
        '点击左侧三角可展开/折叠该节点的直接子级。',
        '名称后绿色 L 表示挂有 cc.Label；蓝色 S 表示挂有 cc.Sprite；「组件:N」为组件数量。',
        'inactive（半透明）表示节点 active 为 false。',
      ],
    },
    {
      id: 'search',
      title: '搜索过滤',
      items: [
        '直接输入文字：按节点名称模糊过滤。',
        '输入 tt:组件名：按组件类型过滤，例如 tt:Label、tt:cc.Sprite、tt:Layout。',
        '快捷：tt:l / tt:label 找 Label；tt:s / tt:sprite 找 Sprite。',
        '匹配到的节点会保留其祖先路径，便于定位。',
      ],
    },
    {
      id: 'dnd',
      title: '拖拽改层级',
      items: [
        '拖到目标行偏左（同级区）：按落点上半/下半插入为该节点的前/后兄弟。',
        '拖到目标行偏右：成为该节点的子节点（插到末尾）。',
        '蓝色横线表示同级前/后；绿色高亮表示成为子节点。',
        '不能拖动场景根节点；不能把节点拖到自己的子孙下。',
      ],
    },
    {
      id: 'alt',
      title: 'Alt + 点击',
      items: [
        'Alt + 点击某个节点（或点其三角）：只对该节点及其子孙做「全部展开 / 全部折叠」。',
        '若子树中仍有展开的分叉 → 全部折叠；若已全部折叠 → 全部展开。',
        '不影响树上其他无关分支的展开状态。',
      ],
    },
    {
      id: 'hover',
      title: '悬停高亮',
      items: [
        '鼠标在节点树上滑过某节点时，游戏画面中对应节点显示绿色粗边框。',
        '移开鼠标后边框消失。',
      ],
    },
    {
      id: 'inspector',
      title: '属性检查',
      items: [
        '可编辑节点：name、active、position、size、anchor、scale、angle、opacity、zIndex、color 等。',
        '颜色使用取色器，并单独编辑 Alpha（0–255）。',
        '组件区可编辑 number / boolean / string 类型属性；勾选 enabled 可开关组件。',
        'cc.Sprite 的 spriteFrame 可粘贴资源 UUID 换图（2.4 用 assetManager，更早 2.x 自动用 cc.loader / AssetLibrary；不是只改 _uuid）。',
        'Scene 根节点没有 active，界面不会显示该项。',
      ],
    },
    {
      id: 'pick',
      title: '画面拾取（类似审查元素）',
      items: [
        '工具栏最左侧「拾取」，或快捷键 Alt+Shift+P（面板与游戏页均可）切换。',
        '开启后光标移到游戏画布上，会高亮鼠标下的节点。',
        '只拾取带渲染组件的节点：cc.Label / cc.Sprite / cc.RichText / Spine / Graphics 等；纯 Widget、Layout 或空节点不会被拾取。',
        '坐标换算与引擎鼠标事件一致，保证与画面位置对应。',
        '同一位置有多个渲染节点时，用鼠标滚轮按深度切换（更深的优先）。',
        '左下角浮层显示当前候选 序号/总数 与节点名。',
        '点击确认选中：节点树会展开并选中该节点，随后自动退出拾取模式。',
        '再次点「拾取」、按 Alt+Shift+P，或关闭面板可退出。',
      ],
    },
    {
      id: 'memory',
      title: '记忆选中',
      items: [
        '选中节点后会按场景记住位置（uuid + 名称路径）。',
        '再次进入同一场景时，会自动展开路径并选中上次的节点。',
      ],
    },
    {
      id: 'ui',
      title: '界面',
      items: [
        '「深色 / 浅色」：切换主题，设置会保存；配色已提高标签与未激活节点对比度，减轻刺眼感。',
        '右侧「字号」滑条：缩放字体大小；「字重」滑条：400～800 调节粗细（尺寸固定，会记住）。',
        '未激活节点：仅字体改为琥珀色斜体（不改背景）；选中为蓝底+蓝字；悬停为浅底。',
        '本「说明」按钮：随时查看全部功能说明。',
      ],
    },
    {
      id: 'tips',
      title: '使用提示',
      items: [
        '修改扩展代码后：在 chrome://extensions 点重新加载，然后刷新预览页并重开 DevTools。',
        '若出现「扩展已重载 / Extension context invalidated」：刷新预览页并重开本面板即可。',
        '预览地址：任意 http(s)（含局域网 IP）；检测到 Cocos `cc` 即连接；游戏在 iframe 里也能识别（all_frames）。',
        '支持范围：Cocos Creator 2.0～2.4.x。',
      ],
    },
  ];

  function renderHelpHtml(sections) {
    var html = '';
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      html += '<section class="help-section" data-help-id="' + s.id + '">';
      html += '<h3>' + s.title + '</h3><ul>';
      for (var j = 0; j < s.items.length; j++) {
        html += '<li>' + s.items[j] + '</li>';
      }
      html += '</ul></section>';
    }
    return html;
  }

  global.CCNodeHelp = {
    sections: HELP_SECTIONS,
    renderHelpHtml: renderHelpHtml,
    /** 后续新增功能：往 sections 追加，或调用 pushSection */
    pushSection: function (section) {
      HELP_SECTIONS.push(section);
    },
  };
})(window);
