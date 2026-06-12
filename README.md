# MindSpace · 心空 🍃

<p align="center">
  <img src="assets/icon.png" width="100" height="100" alt="MindSpace Logo" />
</p>

<p align="center">
  <strong>「无论此刻你的内心是晴是雨，都在这里安歇片刻吧。」</strong>
</p>

<p align="center">
  <a href="https://wangjiehu.github.io/mindspace/">🌐 在线网页体验 (PWA)</a> &nbsp;·&nbsp;
  <a href="https://github.com/wangjiehu/mindspace/releases">📦 桌面端与安卓 APK 下载</a>
</p>

---

## 🎐 关于 MindSpace

`MindSpace（心空）` 是一款专注于个人心灵疗愈与正念呼吸的**本地优先、零压力、非批判性**心理健康与正念助手。

在数字喧嚣的当下，MindSpace 拒绝繁复的数据对比、指标打分与社交干扰。我们采用极简的毛玻璃美学设计，辅以本地离线播放的高品质白噪音和正念呼引导，在本地存储层为您构建起一座纯净、安宁、完全属于您个人的**心灵避风港**。

---

## 🎨 极简淡雅美学 (Aesthetic Design Philosophy)

MindSpace 贯彻极度“轻量”、“淡雅”与“无压感”的设计语言：
* **全平台自适应设计 (Responsive Layout)**：精心设计并覆盖多档分辨率（从 `<380px` 窄屏、`<767px` 手机端、`768px~1023px` 平板端，到 `1024px~1440px` 电脑端），实现无缝流畅的尺寸自适应，大屏自动平铺，小屏转为抽屉/折行。
* **统一的镂空轻感交互 (Outlined UI)**：所有控制按钮、设置操作及弹窗控件均舍弃了厚重的色块填充，采用精细的镂空边框（Outlined）设计，消除大块色彩给视觉带来的压迫感。
* **温润的悬停微光反馈**：鼠标移入按钮时，以极低的 `8%` 透明主题色进行缓慢的渐变填充，配合微小的悬浮位移与柔和阴影，带来细腻的交互确认感。
* **高对比度原生字体**：采用平滑美观的原生系统无衬线字体，搭配高度适中的字距与行高，带来绝佳的阅读体验。

---

## 🚀 核心功能亮点

### 🌤️ 内心天气日志 (Weather Diary)
* **天然气象隐喻**：用“晴朗”、“微风”、“阴天”、“大雾”、“小雨”、“雷雨” 6 种自然天气投影代替冷冰冰的情绪分数，温和接纳心境的阴晴圆缺。
* **无批判随笔**：支持添加自定义生活因素标签，并在没有字数限制、没有排版干扰的日志卡片中安全书写心声。

### 🧘 正念呼吸舱 (Mindful Breath)
* **科学呼吸法**：内置 **4-7-8 深度安神** 与 **5-5 平衡呼吸** 双模式。
* **Canvas 呼吸涨落动效**：基于 HTML5 Canvas 绘制动态粒子群的收缩、漂浮与扩散，提供平滑的视觉引导。
* **Web Audio 声效反馈**：精心调校的本地高保真提示音，闭眼亦能清晰捕捉吸气、憋气与呼气的时间节点。

### ⏱️ 静心专注舱 & 高保真白噪音 (Focus Timer)
* **本地化高保真音轨**：内置 6 种完全本地化、支持离线播放的自然原声白噪音：
  * 🌧️ **柔和雨声** · 🍃 **穿林微风** · 🌊 **潮起潮落**
  * 🔥 **林中篝火** · 🐦 **晨曦鸟鸣** · ☕ **午后咖啡馆**
* **多通道淡入淡出**：开启、关闭、切换音轨时声音自动平滑过渡，避免瞬间音量骤变刺激耳膜。

### 📊 心灵气象导图 (Insights)
* **晴空指数**：基于近期心情天气进行智能加权分析，以亮丽的仪表盘环形展示整体心灵气候。
* **30天日历走势**：以直观的色彩日历呈现您一个月以来的情绪波动轨迹。
* **高频词频标签**：归纳分析与特定内心天气伴随的因素，助您直观洞察内心波动的触发诱因。

---

## ☁️ 云端同步配置 (Supabase Sync)

MindSpace 采用本地优先策略，数据默认完全保存在浏览器本地（LocalStorage）中。若您需要多端账号同步，可以配置您自己的云端 Supabase 数据库。

### 1. 数据库 SQL 建表脚本
请在 Supabase 后台的 SQL Editor 中执行以下建表语句及 RLS 行级安全策略：

```sql
-- 创建情绪日志表
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

-- 开启行级安全策略 (RLS)
alter table public.mood_logs enable row level security;

-- 创建数据读写安全策略：仅允许已登录用户管理自己本人的记录
create policy "Users can perform all actions on their own logs"
on public.mood_logs
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- 建立索引以优化时间线加载性能
create index idx_mood_logs_user_timestamp on public.mood_logs (user_id, timestamp desc);
```

### 2. 启用多端账号同步步骤
1. 打开应用左侧/底部菜单中的 **「数据与安全」**。
2. 点击 **「配置云端数据库连接」**。
3. 输入您的 Supabase `API URL` 和 `Anon Key`（公钥）并保存。
4. 此时账户登录和多端同步服务已成功激活，您可直接注册/登录云账号，本地日志将安全合并。

---

## 🛠️ 本地开发与打包编译

### 1. 运行本地开发调试
```bash
# 安装开发依赖
npm install

# 启动本地热重载开发服务器
npm run serve
```
在浏览器中打开 `http://127.0.0.1:4289` 即可预览调试。

### 2. 运行兼容性与端到端测试
```bash
# 运行 Playwright 自动化测试（涵盖桌面及移动端视图）
npm run test:compat
```

### 3. 编译并同步至 Android 壳
> [!NOTE]
> 编译 Android 需要本地安装有 Java JDK 17+ / 21 并且配置好 `JAVA_HOME` 环境变量。

```bash
# 自动编译、复制资源并重新配置 Android 图标
npm run mobile:sync

# 构建 Android Debug APK 安装包
npm run mobile:build:android:debug
```

### 4. 本地打包 Windows 安装包及绿色版
```bash
# 一键构建 Windows x64 便携版与安装程序
npm run desktop:build:win:x64
```

---

## 📂 项目结构指南

```text
├── index.html                 # 极简 SPA 单页骨架及多端 DOM 布局
├── manifest.webmanifest       # PWA 配置文件 (离线安装与启动配置)
├── sw.js                      # Service Worker (实现完全离线运行及音频/样式本地缓存)
├── assets/                    # 图标资源及本地音频
│   └── sounds/                # 本地化高保真白噪音音频文件
├── capacitor.config.json      # Capacitor 移动端配置文件
├── android/                   # Android 原生壳工程代码
├── desktop/
│   └── main.cjs               # Electron 主进程及窗口管理
├── css/
│   └── style.css              # 极简淡雅设计系统（Outlined 镂空按钮、超薄隐形滚动条）
└── js/
    ├── app.js                 # 核心路由跳转、动态模态框系统与页面渲染
    ├── config.js              # Supabase 连接凭证配置文件
    ├── supabase-service.js    # Supabase 客户端数据存取与身份鉴权封装
    ├── storage.js             # 备份导入导出及数据排重智能合并算法
    ├── breathing.js           # 呼吸舱 Canvas 粒子波动自适应绘制
    ├── focus.js               # 番茄钟计时器及多音轨 Web Audio 淡入淡出混音
    ├── pwa.js                 # PWA Service Worker 注册及生命周期状态管理
    └── quotes.js              # 精选治愈语录库
```

---

## 📄 开源授权
本项目基于 **MIT License** 许可协议开源。您可以完全自由地定制或二次开发您专属的情绪空间。
