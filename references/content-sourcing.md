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

### 2.4 原图

```powershell
curl.exe -s -L -A "Mozilla/5.0" -o cover.jpg "https://pbs.twimg.com/media/<ID>.jpg?name=orig"
```

原图只用于"看清内容"，**不要直接搬进小红书成图**（版权 + 观感）。

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

## 五、抓取后的整理格式

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
```

这份梳理直接决定后面图 2、图 3 能不能立起来。
