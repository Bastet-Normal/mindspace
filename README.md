# MindSpace

选一两种天气记下今天的心情，写一段日记，或者留一分钟做个呼吸练习。首次打开即可记录，数据默认保存在当前设备。

当前版本 **v1.2.72** · [打开网页版](https://bastet-normal.github.io/mindspace/) · [下载 Windows、Linux 或 Android 版](https://github.com/Bastet-Normal/mindspace/releases/latest)

## 写日记与回顾

- **记录心情**　从晴朗、微风、阴天、大雾、小雨和雷雨中选一到两种，可以直接记录此刻，也可以指定日期和时间补记。
- **写随笔**　正文最多可写 12,000 字，可加标签、自定义标签或留作草稿。底部字体菜单显示当前字体。选中文字后切换字体会应用到选区，直接切换则用于接下来输入的文字。同一篇可以混用宋体、文楷、朱雀仿宋等字体。[字体来源与许可](assets/fonts/README.md)
- **翻看记录**　在「心情日记」搜索文字、标签或天气，也可按天气和时间筛选。「七日心情」和「天气回顾」按日汇总，点选日期可查看当天的全部记录。

每篇日记计 1 分，两种天气各得 0.5 分。例如，当天第一篇选「晴朗＋小雨」，第二篇只选「晴朗」，当天汇总就是晴朗 1.5 分、小雨 0.5 分。首页今日天气、七日心情和回顾日历都采用这套规则。

## 呼吸、专注与环境声

「呼吸练习」提供一分钟练习、5-5 平衡呼吸和 4-7-8 慢呼吸，可开启阶段提示音。切到后台会暂停引导，回到页面可继续练习。

「专注与声音」提供预设时长和 1–180 分钟自定义计时，刷新后可恢复计时。六轨环境声可单独播放。网页版可在专注页下载音轨供离线使用，桌面与 Android 安装包内已包含音轨。

## 备份与同步

在「设置 → 日记与备份」中，选 **导出日记（.md）** 可获得便于阅读的文本，选 **导出完整备份（.json）** 可在另一台设备上恢复日记、设置和练习数据。备份包含日记原文，换设备或清除本机数据前请先导出并妥善保存。

恢复前可预览内容。重复导入同一份备份会合并记录和练习时长。恢复默认写入本机，如果已连接云账户，可在预览中选择将本次新增的日记上传到该账户。

### 使用自己的 Supabase 项目

在「设置 → 云同步」填写项目地址和 Publishable Key（或旧版 anon 公钥），登录并启用同步。云端同步日记，练习统计和偏好保存在本机。首次启用时可选择上传本机已有日记。离线编辑会在重新连接后重试，遇到同一篇日记在云端也被修改或删除时，会将本机修改另存一篇。

<details>
<summary>首次建表与已有项目升级</summary>

在新项目的 SQL 编辑器中运行以下语句，创建日记表并限制每个账户只能访问自己的记录。

```sql
create table public.mood_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    timestamp bigint not null,
    weather text not null,
    tags text[] not null default '{}',
    note text not null default '',
    font_runs jsonb,
    created_at timestamptz not null default now()
);

alter table public.mood_logs enable row level security;
grant select, insert, update, delete on public.mood_logs to authenticated;

create policy "Users manage their own logs"
on public.mood_logs
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create index mood_logs_user_id_key on public.mood_logs (user_id, id);
```

已有日记表可单独运行 `alter table public.mood_logs add column if not exists font_runs jsonb;`，让字体信息与正文分开存储。使用旧表时，新版也能从正文末尾读取字体信息，建议各设备都更新后再编辑混排日记。

</details>

## 本地运行与验证

使用 Node.js 24，在项目根目录运行以下命令，然后打开 [本地网页](http://127.0.0.1:4289)。

```sh
npm ci
npm run serve
```

| 命令 | 用途 |
| --- | --- |
| `npm test` | 检查日记数据、备份、离线资源和练习计时等回归用例 |
| `npm run verify:release` | 核对各端版本号、发布资源和离线配置 |
| `npm run test:safari` | 在已启用 WebDriver 的 Mac 上，用原生 Safari 检查不同窗口宽度下的主要流程 |
| `npm run mobile:sync` | 准备网页资源并同步到 Android 工程 |
| `npm run desktop:build:win:x64` | 构建 Windows x64 安装包与便携版 |

## 部署与下载

网页版直接从 `main` 分支的根目录发布到 GitHub Pages。发布新版本时，先在候选分支通过远程 macOS 的原生 Safari 检查，再把通过验证的版本同步到 `main`，并推送与应用版本一致的标签（如 `v1.2.72`）。

版本标签会触发 Windows x64 / ARM64 安装包与便携版、Linux AppImage 与 deb、Android 调试 APK 与未签名 AAB 的构建。成功后，GitHub Release 会附上这些文件和 `SHA256SUMS.txt`。如需重建已打标签的版本，可手动运行工作流并填写原标签；留空只构建附件。[构建与发布工作流](.github/workflows/compatibility.yml)
