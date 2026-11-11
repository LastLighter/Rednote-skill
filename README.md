# Rednote-skill

把任意帖子（链接或正文）一键转成小红书图文：**3 张竖版图 + 标题 + 正文**，标题和正文直接给在对话里。没有链接时，先按**收藏/赞比**从 X 挖选题、给选题卡片；一次做多篇时走批量模式，一条选题一个子 Agent，过三道闸。

给 Claude Code、Codex、DSH 以及任何支持自定义 skill 的 agent 用。

---

## 它解决什么问题

把一条链接丢给 AI 说"帮我做成小红书"，常见的结果是：

- 抓了个转发帖，里面只有一句"这也能联动？"——**没展开引用链**
- 只看了标题和一张截图就写——**没读原文、没看评论区、不知道同话题别人怎么说**
- 生成了 8 张图，其中 5 张是把文案拆开重排——**读者看不完**
- 正文 600 字，塞满 CVE 编号和技术名词——**读者不是同行**
- 封面是一块纯色背景加两行字——**像 PPT，没人点**
- 把原帖的"世纪级大漏洞"直接抄进图里——**事实是错的**
- 把模型对比图重新画了一遍——**原帖里最有价值的真实画面没了**
- 正文开头写"发帖的博主说"——**把自己降级成了搬运工**

这套 skill 把这些判断固化成流程，让 agent 每次都从"调研上下文（原文、引用链、评论区、同话题其他看法）+ 核事实"开始。

---

## 快速开始

### 1. 安装

```bash
git clone https://github.com/LastLighter/Rednote-skill.git ~/.claude/skills/rednote
# DSH：~/.dsh/skills/rednote
```

`SKILL.md` 单文件不完整，`references/` 和 `scripts/` 都要。

### 2. 配置出图

只需一个支持多参考图的图像模型服务。默认走 imagifly：

```dotenv
# .env 或 ~/.baoyu-skills/imagifly/.env
IMAGIFLY_API_KEY=你的key
IMAGIFLY_BASE_URL=https://imagifly.net
IMAGIFLY_MODEL=nano-banana-2
```

不接 imagifly 也行——提示词是通用的，拿去即梦 / Seedream / Nano Banana / GPT-Image 都能跑。

### 3. 用

对 agent 说：

> 把这条转成小红书：https://x.com/xxx/status/123456789

或者直接把正文贴给它。

**第一次用会先问你四件事**：有没有固定头像 / 简介怎么写 / 写给谁看 / 这个号做什么领域。答一次就存进工作目录的 `.rednote/account.md`，同一目录之后不再重复问；标题口吻、术语深浅、标签池、封面要不要出镜，都按这份档案来。有账号人设图的，一并发给它，存成 `.rednote/avatar.png` 作参考图，画风才能统一。

**给了链接之后，它会先做一轮调研再动笔**：原文看全（视频看完或拿到转录）、引用链展开到底、评论区读完（高赞纠错、当事人回应、主要质疑）、同一话题至少看两种立场。这一步过不了，它会继续查，或者直接找你要材料。

**没给链接、只说"找几个选题"时**，先走选题模式：用 `scripts/x-search.py` 按检索式抓 X 原帖，按**收藏/赞比**排序（不是按赞），筛掉搬运号和出处不明的数字，一次给 6–10 张选题卡片（原始素材 / 为什么值得做 / 3 个标题 / 正文骨架 / 配图 / 风险）。点选之后再进账号确认和调研。方法见 `references/topic-mining.md`。

**要一次交 2–3 篇时**，走批量模式：一条选题一个子 Agent（各写各的，不共享对话），交稿后逐一过事实、合规、规范三道闸；不过闸就打回重跑，不自己改。见 `references/batch-production.md`。

---

## 账号档案

工作目录下 `.rednote/account.md`：

```markdown
- 头像 / 人设：无｜有（`.rednote/avatar.png`）
- 简介：
- 面向谁：（身份 + 处境 + 痛点）
- 领域：
- 标签池：大词 / 中词 / 长尾 / 自造词
```

前四项填完就能开工，标签池和禁区是写几篇之后自然长出来的。完整模板、三个示例档案、同一件事三种写法，见 `references/account-profile.md`。

---

## 产出

```
final/
├── 01-封面.jpg      1080×1440
├── 02-证据.jpg
├── 03-收束.jpg
├── 预览.jpg
└── 小红书图文.zip
```

标题和正文**写在对话里**，不生成 md 文档；核对、自查、来源全部在内部完成，不交付。

批量模式下，每篇先在 `<NNN>-<slug>/note.md` 里成稿（标题 / 3 个标题候选 / 正文 / 标签 / 配图方案 / 风险自检），交付时仍然只给标题、正文和成图。

---

## 目录结构

```
SKILL.md                      主流程（−1 选题 + 步骤 0 账号确认 + 6 步）
references/
├── account-profile.md        账号四问、档案模板、示例档案、定位→输出映射
├── topic-mining.md           选题挖掘：检索式、收藏/赞比、搬运号识别、选题卡片
├── batch-production.md       批量成稿：子 Agent brief、三道闸、长文结构
├── content-sourcing.md       调研四层、抓帖子、展开引用链、评论区、同话题观点
├── copywriting.md            句式模板、降维词表、黑名单、不提原帖
├── cover-design.md           封面构图、密度规则、双钩子
├── image-prompts.md          提示词公式、原帧参考图、翻车对策
├── case-study.md             一次完整实战的 9 个坑
└── xiaohongshu-guide.md      425 篇笔记 + 663 条评论的原始统计
scripts/
├── x-search.py               按检索式抓 X 原帖，按收藏/赞比排序
├── fetch-hot.mjs             拉热门流（推荐 / 分类），可抓正文
├── fetch-post.mjs            抓帖子，自动展开引用链
├── ref-frames.py             从原图/原视频抽关键帧、裁剪成参考图
├── imagen.mjs                批量出图，自动纠正扩展名
└── assemble.py               压尺寸、拼预览、打包
examples/
└── prompts/                  3 个可直接复用的提示词
```

---

## 六个脚本

### x-search.py

```bash
set APIFY_API_TOKEN=apify_api_xxx
python scripts/x-search.py --query '("return to office" OR burnout) lang:en min_faves:800 since:2026-07-01 -filter:replies -filter:nativeretweets' --name work --max 30
```

只依赖 Python 标准库（3.9+）。一个检索式一次运行，结果存 `data/x/<name>.json`，终端按**收藏/赞比**排序打印。

> 三个坑：必须带 `-filter:nativeretweets`，否则 Top 被转推占满；`min_faves` + `since` 是质量闸；有些同类 actor（如 `apidojo/tweet-scraper`）每月只有 5 次免费运行，超限后返回 HTTP 201 + `SUCCEEDED` + 单条 `{"noResults": true}`，脚本会识别并提示，别当成"真的没搜到"。

### fetch-hot.mjs

```bash
node scripts/fetch-hot.mjs                       # 推荐流，按点赞排序
node scripts/fetch-hot.mjs --channel 美食 --limit 10
node scripts/fetch-hot.mjs --detail 3 --json --out hot.json
```

免登录拉小红书首屏热门流（推荐 + 11 个分类），按点赞排序输出标题 / 作者 / 点赞 / 链接，
`--detail N` 再抓前 N 条的正文。

> 为什么能免登录：`/explore` 的 SSR 会把首屏 feed 写进 `window.__INITIAL_STATE__`，
> 但只在对的请求头下才吐 —— 实测必须同时带 `user-agent` 和 `accept-encoding: gzip, deflate, br`，
> 少一个就退化成 36KB 空壳（feeds=0）。
>
> 限制：一次只有 ~25–34 条，翻页要 x-s 签名，脚本不做；搜索/关注需登录。
> 想要更多就换 channel 或重复拉（推荐流每次都不一样）。

### fetch-post.mjs

```bash
node scripts/fetch-post.mjs https://x.com/user/status/1234567890
node scripts/fetch-post.mjs 1234567890 --json --out post.json
```

自动展开引用链（最多 3 层），输出带层级的 markdown。

> 为什么需要它：社媒上大量"爆款"只是转发，真正的内容在被引用的帖子里。手工挖容易漏。

### ref-frames.py

```bash
python scripts/ref-frames.py --video src.mp4 --at 6 --crop 0,0,1296,620 --name opus --out-dir refs/
python scripts/ref-frames.py --image poster.jpg --crop 120,300,800,600 --name poster --out-dir refs/
```

从视频/图片里抽出能证明结论的画面，裁掉标签水印，作为参考图传给生图模型。需要 opencv。

### imagen.mjs

```bash
node scripts/imagen.mjs \
  --prompt-file prompts/01-封面.md \
  --prompt-file prompts/02-证据.md \
  --out-dir out/ \
  --ref assets/persona.jpg \
  --ratio 3:4 --tier 2k --concurrency 3
```

提交 → 轮询 → 下载全自动。会根据文件头自动纠正扩展名——模型经常返回 JPEG 却叫 `.png`，不纠正会在很多工具里读不出来。

### assemble.py

```bash
python scripts/assemble.py --src out/ --dst final/ --names 01-封面,02-对比,03-时间线
```

压到 1080×1440、拼预览、打 zip。需要 Pillow。

---

## 核心原则

| 原则 | 说明 |
| --- | --- |
| 先确认账号 | 头像 / 简介 / 受众 / 领域，落盘 `.rednote/account.md`，全篇按它写 |
| 先选题再写 | 没链接时按收藏/赞比挑，不按赞；赞是路过鼓掌，收藏才是"要存下来" |
| 先调研再动笔 | 原文、引用链、评论区、同话题其他看法，四层都过一遍再写 |
| 先核事实再动笔 | 事实错了，图做得再好也是负资产 |
| 搬运号不是事实源 | "This is f*cking insane" 开头、几千粉拿几万赞、同一句多号重复，弃用 |
| 不编数据 | 核不到的数字 / 研究 / 人名不写；只有流行说法才用"有个说法" |
| 医疗只描述现象 | 不下诊断、不承诺疗效，正文带"不替代专业诊断" |
| 批量过三闸 | 事实 / 合规 / 规范，不合格打回重跑，不自己改 |
| 原帧优先 | 能证明结论的画面裁下来当参考图，别重画 |
| 3 张图 | 上限 5 张。图承担信息，文案只打一个点 |
| ≤50 或 400+ 字 | 避开 200–400 的塌陷区；短句，大量换行，只打一个反差 |
| 封面要填满 | 大字 + 人物 + 道具 + 散点，四边铺满 |
| 封面 ≠ 标题 | 两个入口打两个点，别浪费一半流量 |
| 图 3 讲故事 | 不是技术总结，不是知识点 |
| 名人用本名 | "某国首相"会把情绪抽干 |
| 不提原帖 | 用我们自己的话讲，别把自己降级成搬运工 |
| 交付只有标题 + 正文 | 不写 md、不写核对表、不写首评 |
| 留缺口不留错误 | 让人来补充，别让人来纠错 |

---

## License

MIT
