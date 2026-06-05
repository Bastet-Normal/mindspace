# MindSpace - 心空 🌌

MindSpace（心空）是一款致力于为用户提供**轻量、温暖**的心理健康与正念呼吸引导助手。采用精致的 **极简磨砂玻璃态（Glassmorphism）** 与 **莫兰迪（Morandi）治愈系色调**，打造平静安宁的交互体验。

---

## 🌟 项目亮点

- 🔒 **本地优先 (Local-first)**：默认所有情绪数据、随笔均安全存储在用户的浏览器本地（LocalStorage），保护绝对隐私。
- ☁️ **无缝云端同步**：支持对接个人 Supabase 数据库。用户在网页端配置后即可开启云账户体系，实现多设备数据同步。
- 📱 **可安装应用**：保留网页版，同时支持手机 PWA 安装，以及 Windows / Linux 桌面端打包。
- 🧘 **正念呼吸舱**：支持多种经典呼吸模式，平滑的视觉球过渡与去临床化的疗愈指引，快速缓解焦虑。
- ⏳ **静心专注钟**：结合番茄工作法，陪伴您的专注时光。
- ✍️ **内心天气日志**：以非批判性的温暖文案，陪伴您记录每日的心声起伏。

---

## 🚀 快速开始

### 在线体验
直接点击 [在线网址](https://wangjiehu.github.io/mindspace/) 即可开始使用。

### 本地直接运行
网页版无需任何复杂的构建环境（纯 HTML/JS 静态单页应用）：
1. 下载或克隆项目代码。
2. 双击根目录下的 index.html，即可直接在浏览器中开启您的心灵之旅。

### 安装到手机
网页已支持 PWA。用手机浏览器打开在线网址后，可通过浏览器菜单选择「添加到主屏幕」或「安装应用」，安装后仍使用本地优先的数据存储方式。

### 桌面端打包
桌面端使用 Electron 包裹同一套网页应用，当前配置覆盖 Windows x64(x86_64) / arm64 与 Linux x64(x86_64)。

```bash
npm install
npm run desktop:build:win
npm run desktop:build:linux
```

只发布单一平台/架构时可使用更小的定向构建：

```bash
npm run desktop:build:win:arm64
npm run desktop:build:win:x64
npm run desktop:build:linux:x64
```

Windows 本机可直接构建 Windows 包；Linux 包建议在 Linux 环境或仓库内置的 GitHub Actions 中构建。

> 体积说明：Electron 兼容性最好，但每个桌面包都会携带 Chromium。若后续要进一步压缩体积且不损耗现有网页内容，更优路线是保留当前静态应用内核，桌面端迁移到 Tauri/WebView2，移动端继续使用 PWA 或 Capacitor 壳。

### 开启云同步（可选）
如果您希望开启账号登录并跨设备同步数据：
1. 访问网页中的「设置」 -> **“配置云端数据库”**。
2. 填入您个人 Supabase 项目的 `API URL` 和 `Anon Key` 并保存（项目代码内已预设配置，也可在此手动覆盖）。
3. 即可直接注册和登录您的个人云账号！

---

## 📂 项目结构

```text
├── index.html                # 主页面（SPA 单页入口）
├── manifest.webmanifest      # PWA 安装清单
├── sw.js                     # 离线缓存 Service Worker
├── desktop/
│   └── main.cjs              # Electron 桌面端主进程
├── tests/
│   └── compat.spec.js        # 多浏览器与移动视口兼容性测试
├── css/
│   └── style.css             # 核心样式表（含全局磨砂玻璃设计系统与自适应排版）
└── js/
    ├── app.js                # 核心路由与 SPA 视图交互逻辑
    ├── config.js             # Supabase 连接凭证配置
    ├── supabase-service.js # 数据库与账号体系服务封装
    ├── storage.js            # 本地缓存与数据导出逻辑
    ├── breathing.js          # 正念呼吸引导交互与动画逻辑
    ├── focus.js              # 专注计时器逻辑
    └── quotes.js             # 温暖治愈短语库
```

---

## ✅ 兼容性测试

```bash
npm run test:compat
```

测试覆盖 Chromium、Firefox、WebKit、Pixel 7 Android Chrome、Galaxy S8 窄屏 Android Chrome 和 iPhone 14 Safari 移动视口，验证页面加载、启动登录门、导航、情绪记录、随笔列表、呼吸/专注/设置入口与 PWA 元数据。

---

## 📄 授权协议
本项目采用 [MIT License](LICENSE) 协议开源。
