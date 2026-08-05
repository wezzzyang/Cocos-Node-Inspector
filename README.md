# Cocos Node Inspector

Chrome DevTools 扩展：在运行时查看 / 编辑 **Cocos Creator 2.x（2.0～2.4）** 节点树。

## 安装

1. 打开 Chrome → `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本仓库根目录
4. 启动 Creator Web 预览（任意地址，如 `http://localhost:7456/` 或 `http://192.168.1.2:7456/`）
5. 打开页面 F12 → 顶部面板 **Cocos Node**（扩展会探测页面是否存在 `cc`，与 IP 无关）

## 版本兼容（2.x）

| 能力 | 说明 |
|------|------|
| 节点树 / 属性编辑 / 拖拽 / 悬停高亮 | 2.0～2.4 通用 `cc` API |
| Sprite 换图 | 2.4：`assetManager`；更早：`cc.loader` / `AssetLibrary` 自动回退 |
| 旋转 | 优先 `angle`，旧版回退 `rotation` |
| 预览地址 | 任意 `http://` / `https://`（含局域网 IP）；支持 iframe 内 `cc` |

## 功能

- **节点树**：按名称过滤，轮询刷新（可关）
- **属性检查**：编辑节点与组件 number / boolean / string；`spriteFrame` UUID 换图
- **拖拽**：偏左同级、偏右成子节点；**Alt+点击**子树全展/全折
- **搜索**：`tt:组件名`；徽标 L/S
- **画面拾取**：工具栏最左「拾取」或 **Alt+Shift+P**；游戏画面悬停定位，滚轮按深度切换，点击选中
- **下载资源**：页面内打包单个 zip；Spine 导出 `json + atlas + 贴图` 三件套到同目录
- **主题 / 字号 / 字重 / 说明**：见面板工具栏

## 开发说明

纯 JS，无构建。改代码后扩展页「重新加载」→ 刷新预览 → 重开 DevTools。

因 `manifest` 扩大了 host 权限，更新后需在扩展页重新加载一次。
