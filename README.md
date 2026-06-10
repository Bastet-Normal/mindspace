# MindSpace 心空

MindSpace 是一款本地优先的心理健康与正念记录应用。它保留网页版，同时提供可安装的 PWA、Android 应用和 Windows / Linux 桌面软件。

## 在线使用

- 网页版：[https://wangjiehu.github.io/mindspace/](https://wangjiehu.github.io/mindspace/)
- 软件下载：[GitHub Releases](https://github.com/wangjiehu/mindspace/releases)

Release 中会提供：

- `Android-debug.apk`：Android 手机可侧载安装。
- `Android-release-unsigned.aab`：用于后续签名或应用商店发布。
- `Windows-Setup-x64.exe` / `Windows-Portable-x64.exe`：Intel / AMD Windows 电脑。
- `Windows-Setup-arm64.exe` / `Windows-Portable-arm64.exe`：Windows on ARM 电脑。
- `Linux-x86_64.AppImage` / `Linux-amd64.deb`：Linux x86_64 桌面。

## 主要功能

- 账号登录：启动后先登录，支持云端同步账号体系。
- 内心天气：用晴朗、微风、阴天、大雾、小雨、雷雨记录当天状态。
- 心声随笔：记录每天的文字随笔，支持搜索、详情查看和删除。
- 气象导图：按最近 7 天加权计算心情晴空指数，越近的记录权重越高；最近 3 天没有记录时不显示指数。
- 正念呼吸：提供稳定的呼吸节奏引导。
- 静心专注：提供专注计时器和环境声音控制。
- 数据与安全：支持导出随笔、本地数据清理和云端配置。

## 隐私与数据

MindSpace 默认将记录保存在当前设备的浏览器本地存储中。开启云同步后，数据会同步到配置的 Supabase 项目；项目代码不保存用户密码或私密记录。

## 本地运行

```bash
npm install
npm run serve
```

也可以直接打开根目录的 `index.html` 使用静态网页版。为了完整验证 PWA、Service Worker 和浏览器兼容性，推荐使用本地服务方式。

## 打包

### Android

```bash
npm run mobile:sync
npm run mobile:build:android:debug
```

本地构建 Android 需要 Java 与 Android SDK。GitHub Actions 会在打 `v*` 标签时自动构建 APK/AAB 并上传到 Release。

### Windows / Linux

```bash
npm run desktop:build:win
npm run desktop:build:linux
```

也可以按架构定向构建：

```bash
npm run desktop:build:win:arm64
npm run desktop:build:win:x64
npm run desktop:build:linux:x64
```

桌面端基于 Electron，兼容性优先；Android 端基于 Capacitor 和系统 WebView，体积更小。

## 兼容性测试

```bash
npm run test:compat
```

测试覆盖 Chromium、Firefox、WebKit、Android Chrome、Android 窄屏视口和 iOS Safari 视口，验证登录门、导航、记录、随笔、气象导图、呼吸、专注、设置和 PWA 元数据。

## 项目结构

```text
index.html                  SPA 入口
css/style.css               全局样式与响应式布局
js/                         应用逻辑、存储、呼吸、专注和云同步
assets/                     PWA、桌面端与 Android 图标
desktop/main.cjs            Electron 主进程
android/                    Capacitor Android 工程
scripts/                    移动端同步、图标生成和 Gradle 辅助脚本
tests/compat.spec.js        跨浏览器兼容性测试
.github/workflows/          CI、打包和 Release 发布
```

## License

MIT
