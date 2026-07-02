# MindSpace · 心空 🍃

> **「无论此刻你的内心是晴是雨，都在这里安歇片刻吧。」**

MindSpace 是一款本地优先、零压力、非批判性的心灵疗愈与正念呼吸助手。在数字喧嚣的当下，我们采用极简的毛玻璃美学设计，辅以本地离线高保真白噪音和正念呼吸引导，在本地存储层为您构建起一座纯净、安宁、完全属于您个人的**心灵避风港**。

当前正式版本：**v1.1.1**

<p align="left">
  <a href="https://bastet-normal.github.io/mindspace/">🌐 在线网页体验 (PWA)</a> &nbsp;·&nbsp;
  <a href="https://github.com/Bastet-Normal/mindspace/releases">📦 桌面端与安卓 APK 下载</a>
</p>

---

## 🚀 核心功能 (Core Features)

* **🌤️ 内心天气日志**：用“晴朗、微风、阴天、大雾、小雨、雷雨” 6 种自然天气投影代替冷冰冰的情绪分数，温暖接纳心境起伏。
* **🧘 正念呼吸舱**：内置 **4-7-8 深度安神** 与 **5-5 平衡呼吸** 双模式，配合 HTML5 Canvas 动态粒子涨落与高保真提示音引导。
* **⏱️ 静心专注舱**：内置 6 种完全本地化、支持离线播放的自然白噪音音轨（雨声、微风、海浪、篝火、鸟鸣、咖啡馆），支持多通道淡入淡出混音。
* **📊 心灵气象导图**：基于近期天气进行智能加权分析，以环形仪表盘展示“心灵晴空指数”，并通过 30 天日历和因子分析归纳情绪触发源。
* **🎨 自适应美学**：精心适配 `<380px`（窄屏）、`<767px`（手机）、`768px~1023px`（平板）和 `1024px~1440px`（桌面），实现大屏铺满，小屏化繁为简。

---

## ☁️ 云端同步 (Supabase Sync)

MindSpace 默认将数据完全保存在本地浏览器（LocalStorage）中。若需启用多设备同步，可配置个人 Supabase 数据库：

1. **执行建表 SQL 及 RLS 安全策略**：
```sql
create table public.mood_logs (
    id uuid not null default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    timestamp bigint not null,
    weather text not null,
    tags text[] not null default '{}'::text[],
    note text not null default ''::text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint mood_logs_pkey primary key (id)
);
alter table public.mood_logs enable row level security;
create policy "Users can perform all actions on their own logs" on public.mood_logs for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_mood_logs_user_timestamp on public.mood_logs (user_id, timestamp desc);
```

2. **配置连接**：在应用中进入 **「数据与安全」** -> **「配置云端数据库连接」**，填入您的 Supabase `API URL` 和 `Anon Key`（公钥）并保存，登录账户即可自动合并本地与云端数据。

---

## 🛠️ 本地开发与构建 (Development & Build)

```bash
# 1. 安装锁定依赖并校验发布元数据
npm ci
npm run verify:release

# 2. 运行本地开发调试 (浏览器打开 http://127.0.0.1:4289)
npm run serve

# 3. 运行兼容性与端到端测试 (Playwright)
npm run test:compat

# 4. 编译并同步至 Android (需配置 JAVA_HOME 环境变量)
npm run mobile:sync
npm run mobile:build:android:debug

# 5. 本地打包 Windows 桌面端安装包 (NSIS Setup & Portable)
npm run desktop:build:win:x64
```

正式版本标签会自动构建 Windows x64/ARM64、Linux x64 与 Android 附件，并在 GitHub Release 中附带 `SHA256SUMS.txt`。

---

## 📂 主要项目结构 (Project Structure)

* `index.html` - 单页 SPA 核心骨架及多端 DOM 布局
* `manifest.webmanifest` & `sw.js` - PWA 配置文件与缓存控制服务
* `css/style.css` - 极简毛玻璃设计系统（镂空按钮、自适应响应布局）
* `js/app.js` - SPA 核心路由、交互逻辑与模态弹窗系统
* `js/storage.js` - 本地 LocalStorage 读写与数据去重合并算法
* `js/breathing.js` & `js/focus.js` - Canvas 粒子波动自适应绘制与番茄钟多轨混音器
* `js/supabase-service.js` - Supabase 数据库交互与身份鉴权封装
* `assets/` - 界面图标及高保真自然原声音频文件
