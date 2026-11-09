# Rednote-skill

把任意帖子（链接或正文）一键转成小红书图文：**3 张竖版图 + 标题 + 正文**，标题和正文直接给在对话里。

给 Claude Code、Codex、DSH 以及任何支持自定义 skill 的 agent 用。

---

## 它解决什么问题

把一条链接丢给 AI 说"帮我做成小红书"，常见的结果是：

- 抓了个转发帖，里面只有一句"这也能联动？"——**没展开引用链**
- 生成了 8 张图，其中 5 张是把文案拆开重排——**读者看不完**
- 正文 600 字，塞满 CVE 编号和技术名词——**读者不是同行**
- 封面是一块纯色背景加两行字——**像 PPT，没人点**
- 把原帖的"世纪级大漏洞"直接抄进图里——**事实是错的**
- 把模型对比图重新画了一遍——**原帖里最有价值的真实画面没了**
- 正文开头写"发帖的博主说"——**把自己降级成了搬运工**

这套 skill 把这些判断固化成流程，让 agent 每次都从"展开引用链 + 核事实"开始。

---

## 快速开始

### 1. 安装

```bash
git clone https://github.com/LastLighter/Rednote-skill.git ~/.claude/skills/rednote
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

有账号人设图的，一并给它，会作为参考图保持画风一致。

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

---

## 目录结构

```
SKILL.md                      主流程（6 步）
references/
├── content-sourcing.md       抓帖子、展开引用链、截帧裁剪
├── copywriting.md            句式模板、降维词表、黑名单、不提原帖
├── cover-design.md           封面构图、密度规则、双钩子
├── image-prompts.md          提示词公式、原帧参考图、翻车对策
└── case-study.md             一次完整实战的 9 个坑
scripts/
├── fetch-hot.mjs             拉热门流（推荐 / 分类），可抓正文
├── fetch-post.mjs            抓帖子，自动展开引用链
├── ref-frames.py             从原图/原视频抽关键帧、裁剪成参考图
├── imagen.mjs                批量出图，自动纠正扩展名
└── assemble.py               压尺寸、拼预览、打包
examples/
└── prompts/                  3 个可直接复用的提示词
```

---

## 五个脚本

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
| 先展开引用链 | 只抓最外层，八成拿不到素材 |
| 先核事实再动笔 | 事实错了，图做得再好也是负资产 |
| 原帧优先 | 能证明结论的画面裁下来当参考图，别重画 |
| 3 张图 | 上限 5 张。图承担信息，文案只打一个点 |
| 150–220 字 | 短句，大量换行，只打一个反差 |
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
