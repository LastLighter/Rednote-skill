# 取原文：抓帖子与展开引用链

## 一、为什么必须展开引用链

社媒上大量"爆款"本身是空壳：

```
@A：意想不到的展开，这也能联动？          ← 你要转的"帖子"
  └─ @B：一国元首竟然会发漏洞公告……        ← 真正的吐槽
      └─ @C（当事人）：我家官网昨晚临时停了   ← 真正的信息源
```

只抓 @A，你拿到的素材是 12 个字。**必须递归到没有下一层为止。**

判断标准：当你能够用一句"事情是这样"复述完整因果，才算抓到了。

---

## 二、X / Twitter

### 2.1 常见障碍

国内网络环境下，`x.com` 常被 DNS 解析到 `198.18.x.x`（Clash/TUN 类工具的 fake-ip 段）。内置抓取工具通常会做 SSRF 检查，判定"非公网 IP"直接拒绝：

```
Error: URL hostname "x.com" resolves to a non-public IP address
```

**这不是网络不通。** 用 `curl` 走同一台机器可以正常访问。

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://x.com
# 200
```

### 2.2 取结构化数据

直接用镜像 API，比解析 HTML 稳：

```powershell
curl.exe -s "https://api.vxtwitter.com/i/status/<TWEET_ID>"
```

返回 JSON，关键字段：

| 字段 | 含义 |
| --- | --- |
| `text` | 正文 |
| `user_name` / `user_screen_name` | 作者 |
| `date` | 发布时间 |
| `likes` / `retweets` / `replies` | 互动量 |
| `mediaURLs` | 图片地址（可带 `?name=orig` 取原图） |
| `qrt` | **被引用的帖子对象**（含同样的结构） |
| `qrtURL` | 被引用帖的链接 |

### 2.3 递归展开

`qrt` 对象里还有 `qrt`，最多展开 2–3 层就够：

```js
let cur = await fetchOne(id);
const chain = [cur];
while (cur.qrt) { cur = cur.qrt; chain.push(cur); }
```

或者用脚本（推荐）：

```bash
node scripts/fetch-post.mjs "https://x.com/<user>/status/<id>"
node scripts/fetch-post.mjs <id> --json --out post.json
```

脚本会自动展开引用链，输出成带层级的 markdown。

### 2.4 原图与关键帧（要进成图的素材）

原图/原视频**不整张搬进成图**，但里面的关键画面是证据，必须留下来：

1. 把原图下载 / 把视频下载到本地
2. 按时间点抽帧，裁出能证明结论的那一块（对比图的一半、演示画面、界面截图）
3. 作为参考图传给生图模型，嵌进卡片里（见 `image-prompts.md`）

**只认"看得见的证据"**：模型能力对比、榜单截图、进度条、报错界面、界面文字——这些重画就失去意义。纯风景、纯装饰可以重画。

原帖自带的标签、水印、昵称、播放条，裁剪时全部去掉，只留画面本体。

---

## 三、其他平台

### 网页 / 公众号

```powershell
curl.exe -s -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" "<URL>"
```

只想要正文纯文本时，去掉标签再读：

```powershell
$html = curl.exe -s -L "<URL>" | Out-String
$t = $html -replace '(?s)<script.*?</script>','' -replace '(?s)<style.*?</style>','' -replace '(?s)<!--.*?-->',''
$t = ($t -replace '<[^>]+>',' ') -replace '[ \t]+',' '
[System.Net.WebUtility]::HtmlDecode($t)
```

### 只有文字没有链接

直接进入步骤 2，不要跳过事实核对。

---

## 四、抓不到的时候

按顺序尝试：

1. `curl` 直连（绕开工具层的 SSRF 检查）
2. 换镜像：`api.vxtwitter.com`、`r.jina.ai/<URL>`
3. 搜索引擎找转载：用正文里的独特短语去搜
4. **让用户粘贴正文**

第 4 步不丢人。拿不到原文就硬编，才是真正的事故。

---

## 五、截帧与裁剪（参考图的来源）

### 5.1 用脚本（推荐）

```bash
# 抽第 6 秒的整帧
python scripts/ref-frames.py --video src.mp4 --at 6 --name opus --out-dir refs/

# 上下分屏，各裁一屏
python scripts/ref-frames.py --video src.mp4 --at 6 --split top    --name opus     --out-dir refs/
python scripts/ref-frames.py --video src.mp4 --at 9.8 --crop 0,730,1296,590 --name deepseek --out-dir refs/

# 原图直接裁
python scripts/ref-frames.py --image poster.jpg --crop 120,300,800,600 --name poster --out-dir refs/
```

依赖 `opencv-python`，没有 ffmpeg 也能跑。

### 5.2 用 ffmpeg

```powershell
ffmpeg -ss 6 -i src.mp4 -frames:v 1 full.png
ffmpeg -i full.png -vf "crop=1296:620:0:0"   refs/opus.png
ffmpeg -i full.png -vf "crop=1296:590:0:730" refs/deepseek.png
```

### 5.3 裁剪的三条判断

1. **只留证据**：分屏就各裁一屏，去掉原帖加的模型标签、水印、播放条。
2. **选信息最全的帧**：对话框、分数、角色动作、报错信息都在的那一秒，往往只有一两帧。
3. **保留原始分辨率**：不要先缩小再传给模型，缩过一次字就糊了，模型会把糊当成"本来就糊"。

裁出来的图直接作为 `--ref` 传给 `imagen.mjs`。提示词的写法见 `image-prompts.md`。

---

## 六、抓取后的整理格式

把抓到的内容整理成这样的结构，后面所有步骤都基于它：

```markdown
## 原帖（最后一层）
- 作者：
- 时间：
- 正文：
- 互动：

## 中间层（吐槽/转发）
- 作者：
- 正文：

## 我要转的那条
- 作者：
- 正文：

## 时间线（自己梳理）
- 10/21 发生了什么
- 10/22 发生了什么

## 原帧清单（步骤 5 要用的素材）
- refs/opus.png     ← 6s，上半屏，有中文对话框
- refs/deepseek.png ← 9.8s，下半屏，标题页 + 糊掉的 HUD
```

这份梳理直接决定后面图 2、图 3 能不能立起来；原帧清单决定图 1、图 2 有没有真实感。

> 注意：这份梳理是自己的工作稿，**不随交付物给用户**。交付只有成图 + 对话里的标题和正文。
