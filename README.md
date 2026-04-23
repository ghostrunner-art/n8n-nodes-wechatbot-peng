# n8n 微信节点插件

基于微信官方 iLink Bot API 的 n8n 节点插件，支持个人微信消息的收发、媒体文件处理和健康监控。

## 功能特性

### 核心功能
- **扫码登录** - 通过二维码安全登录微信，获取持久化会话
- **消息监听** - 实时接收微信消息（文本、图片、语音、文件、视频）
- **消息发送** - 支持发送文本、图片、文件消息
- **健康检查** - 定期检查会话状态，及时预警过期

### 高级特性
- **输入状态指示** - 处理消息时自动显示"对方正在输入..."
- **消息去重** - 基于 message_id 自动去重，防止重复处理
- **媒体下载** - 自动下载图片、语音、文件等媒体到 n8n binary
- **语音转文字** - 自动提取微信 ASR 转写结果
- **引用消息** - 支持识别和提取引用/回复的消息内容
- **断线重连** - 内置指数退避重试机制

## 节点说明

### 1. Wechat Login（微信登录）
独立登录节点，无需配置凭证。

**操作：**
- **Get QR Code** - 获取登录二维码
  - 输出：`qrcodeUrl`（二维码图片链接）、`sessionKey`（会话密钥）
- **Verify Scan Result** - 验证扫码结果
  - 输入：`sessionKey`（从上一步获取）
  - 输出：`sessionData`（完整的会话数据，用于配置凭证）

### 2. Wechat Trigger（微信触发器）
必须配置 `WechatOfficialApi` 凭证。

**功能：**
- 实时监听微信消息
- 支持消息类型过滤（文本/图片/语音/文件/视频）
- 自动下载媒体文件并挂载到 `binary.data`
- 收到消息时自动显示"输入中"状态
- 输出包含 `typingSessionId` 和 `isTypingActive` 字段

**输出字段：**
- `senderId` - 发送者微信 ID
- `messageType` - 消息类型（text/image/voice/file/video）
- `content` - 文本内容
- `voiceText` - 语音转文字结果（语音消息）
- `fileName` / `fileSize` - 文件信息（文件消息）
- `quoted` - 引用消息信息
- `binary.data` - 媒体文件二进制数据
- `typingSessionId` - 输入状态会话 ID（用于 Send 节点取消）
- `isTypingActive` - 是否正在输入中

### 3. Wechat Send（微信发送）
必须配置 `WechatOfficialApi` 凭证。

**消息类型：**
- **Text** - 发送文本消息
- **Image** - 发送图片（从 binary 数据读取）
- **File** - 发送文件（从 binary 数据读取）

**特性：**
- 发送成功后自动取消"输入中"状态
- 支持通过 `{{ $json.senderId }}` 回复发送者
- 动态 UI：选择不同消息类型显示不同输入框

### 4. Wechat Health Check（健康检查）
必须配置 `WechatOfficialApi` 凭证。

**功能：**
- 调用 `getConfig` API 验证会话有效性
- 检测 session 是否过期（errcode -14）
- 返回健康状态和错误信息

**输出字段：**
- `healthy` - 是否健康（true/false）
- `errorCode` - 错误代码
- `errorMessage` - 错误信息
- `actionRequired` - 建议操作

## 快速开始

### 1. 在 n8n 中安装节点

**方式一：通过 n8n 社区节点安装（推荐）**
1. 进入 n8n 设置 → 社区节点
2. 点击 "安装" 按钮
3. 输入包名：`n8n-nodes-wechatbot-peng`
4. 等待安装完成，n8n 会自动重启

**方式二：通过 npm 安装**
```bash
# 进入 n8n 安装目录
cd ~/.n8n

# 安装节点包
npm install n8n-nodes-wechatbot-peng

# 重启 n8n 服务
```

**方式三：通过环境变量安装**
```bash
# 启动 n8n 时指定节点路径
N8N_CUSTOM_EXTENSIONS=/path/to/n8n-nodes-wechatbot-peng n8n start
```

### 3. 配置微信登录

**第一步：获取二维码**
1. 在工作流中添加 **Wechat Login** 节点
2. 选择操作 **Get QR Code**
3. 运行节点，获取 `qrcodeUrl` 和 `sessionKey`
4. 在浏览器中打开 `qrcodeUrl`，使用微信扫码

**第二步：验证登录**
1. 添加另一个 **Wechat Login** 节点
2. 选择操作 **Verify Scan Result**
3. 填入上一步获取的 `sessionKey`
4. 运行节点，获取 `sessionData`

**第三步：配置凭证**
1. 进入 n8n 凭证管理
2. 创建 **Wechat Official Api** 凭证
3. 将 `sessionData` JSON 字符串粘贴到 `Session Data` 字段

### 4. 创建消息监听工作流

```
[Wechat Trigger]  ← 配置 WechatOfficialApi 凭证
    ↓
[处理逻辑]        ← AI 回复、数据处理等
    ↓
[Wechat Send]     ← 配置 WechatOfficialApi 凭证，Target ID 填 {{ $json.senderId }}
```

## 工作流示例

### 示例 1：简单回声机器人

```
[Wechat Trigger] (messageTypeFilter: text)
    ↓
[Wechat Send]
  - Target ID: {{ $json.senderId }}
  - Message Type: Text
  - Message Content: 你说了：{{ $json.content }}
```

### 示例 2：AI 智能回复

```
[Wechat Trigger] (messageTypeFilter: text)
    ↓
[OpenAI Chat Model]
  - System Prompt: 你是一个友好的助手
  - User Message: {{ $json.content }}
    ↓
[Wechat Send]
  - Target ID: {{ $json.senderId }}
  - Message Type: Text
  - Message Content: {{ $json.message }}
```

### 示例 3：健康检查监控

```
[Schedule Trigger] (每 6 小时运行)
    ↓
[Wechat Health Check]
    ↓
[IF Node] (条件: {{ $json.healthy }} === false)
    ↓ 是
[Send Email] 或 [Send Slack Message]
  - 主题：微信 Bot Session 过期提醒
  - 内容：Session 已过期，请重新扫码登录
```

## 技术细节

### Session 生命周期
- `bot_token`（会话令牌）有效期为数天到数周
- `context_token`（消息路由令牌）有效期为 24 小时
- 超过 24 小时未互动，无法主动推送消息
- 用户随时发消息可重置 24 小时窗口

### 输入状态机制
1. **触发器收到消息** → 立即发送 `typing` 状态
2. **每 5 秒刷新** → 保持"输入中"显示
3. **Send 节点发送完成** → 自动发送 `cancel` 取消状态
4. **使用 UUID** → 每条消息有独立的 typing 会话，防止冲突

### 消息去重
- 基于 `message_id` 去重
- 内存缓存最近 1000 条消息
- 防止网络重试导致的重复处理

### 错误处理
- **errcode -14** - Session 过期，需要重新登录
- **连续失败** - 指数退避重试（1秒 → 2秒 → 4秒...）
- **网络错误** - 自动重连，最多 5 次尝试

## 限制说明

| 限制项 | 说明 |
|--------|------|
| 主动推送窗口 | 用户最后一条消息 24 小时内 |
| 文件大小 | 最大 100MB |
| 消息去重窗口 | 最近 1000 条 |
| 输入状态刷新 | 每 5 秒 |
| 长轮询超时 | 35 秒 |

## 常见问题

### Q: 为什么超过 24 小时不能主动发消息？
A: 这是微信 iLink 协议的限制。需要用户先发消息，才能重置 24 小时窗口。

### Q: Session 过期了怎么办？
A: 使用 **Wechat Login** 节点重新扫码获取新的 `sessionData`，更新凭证即可。

### Q: 如何监控 Session 状态？
A: 使用 **Wechat Health Check** 节点定期检查，配合 **Schedule Trigger** 和邮件通知。

### Q: 可以同时处理多个用户的消息吗？
A: 可以。每个消息有独立的 UUID 标识，并发处理不会互相干扰。

### Q: 媒体文件保存在哪里？
A: 下载的媒体文件挂载到 n8n 的 `binary.data`，可在后续节点中通过 `binary` 访问。

## 开发

### 项目结构

```
nodes/
├── WechatCore.ts                    # 核心通信协议
├── WechatLogin/
│   ├── WechatLogin.node.ts          # 登录节点
│   └── wechat.svg
├── WechatTrigger/
│   ├── WechatTrigger.node.ts        # 触发器节点
│   └── wechat.svg
├── Wechat/
│   ├── Wechat.node.ts               # 发送节点
│   └── wechat.svg
└── WechatHealthCheck/
    ├── WechatHealthCheck.node.ts    # 健康检查节点
    └── wechat.svg

credentials/
└── WechatOfficialApi.credentials.ts  # 凭证定义
```

### 可用脚本

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 构建生产版本 |
| `npm run build:watch` | 监视模式构建 |
| `npm run lint` | 代码检查 |
| `npm run lint:fix` | 自动修复代码风格 |
| `npm run release` | 发布新版本 |

## 依赖

- `n8n-workflow` - n8n 工作流 SDK
- `@tencent-weixin/openclaw-weixin` - 微信官方 iLink API（类型参考）
- `sharp` - 图片处理（缩略图生成）

## 许可证

MIT

## 相关资源

- [n8n 官方文档](https://docs.n8n.io/)
- [n8n 社区节点开发指南](https://docs.n8n.io/integrations/creating-nodes/)
- [微信 iLink Bot API 协议文档](https://www.wechatbot.dev/en/protocol)
- [n8n 社区论坛](https://community.n8n.io/)
