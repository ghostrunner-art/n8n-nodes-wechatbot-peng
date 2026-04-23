# n8n WeChat Node Plugin

An n8n node plugin based on the WeChat official iLink Bot API, supporting personal WeChat message sending/receiving, media file processing, and health monitoring.

## Features

### Core Features
- **QR Code Login** - Secure login via QR code to obtain persistent sessions
- **Message Listening** - Real-time WeChat message reception (text, image, voice, file, video)
- **Message Sending** - Support for sending text, image, and file messages
- **Health Check** - Regular session status checks with expiration alerts

### Advanced Features
- **Typing Indicator** - Automatically shows typing status while processing messages
- **Message Deduplication** - Automatic deduplication based on message_id to prevent duplicate processing
- **Media Download** - Automatic download of images, voice, files, and other media to n8n binary
- **Voice-to-Text** - Automatic extraction of WeChat ASR transcription results
- **Quoted Messages** - Support for recognizing and extracting quoted/replied message content
- **Auto-Reconnect** - Built-in exponential backoff retry mechanism

## Node Documentation

### 1. Wechat Login
Standalone login node, no credentials required.

**Operations:**
- **Get QR Code** - Get login QR code
  - Output: qrcodeUrl (QR code image link), sessionKey (session key)
- **Verify Scan Result** - Verify scan result
  - Input: sessionKey (from previous step)
  - Output: sessionData (complete session data for credential configuration)

### 2. Wechat Trigger
Requires WechatOfficialApi credentials.

**Features:**
- Real-time WeChat message listening
- Message type filtering (text/image/voice/file/video)
- Automatic media file download and mount to binary.data
- Automatic typing status display when receiving messages
- Output includes typingSessionId and isTypingActive fields

**Output Fields:**
- senderId - Sender WeChat ID
- messageType - Message type (text/image/voice/file/video)
- content - Text content
- voiceText - Voice-to-text result (voice messages)
- fileName / fileSize - File information (file messages)
- quoted - Quoted message information
- binary.data - Media file binary data
- typingSessionId - Typing status session ID (used by Send node to cancel)
- isTypingActive - Whether currently typing

### 3. Wechat Send
Requires WechatOfficialApi credentials.

**Message Types:**
- **Text** - Send text message
- **Image** - Send image (read from binary data)
- **File** - Send file (read from binary data)

**Features:**
- Automatically cancels typing status after successful send
- Supports replying to sender via {{ $json.senderId }}
- Dynamic UI: Different input fields shown for different message types

### 4. Wechat Health Check
Requires WechatOfficialApi credentials.

**Features:**
- Calls getConfig API to verify session validity
- Detects session expiration (errcode -14)
- Returns health status and error information

**Output Fields:**
- healthy - Health status (true/false)
- errorCode - Error code
- errorMessage - Error message
- actionRequired - Recommended action

## Quick Start

### 1. Install in n8n

**Option 1: Via n8n Community Nodes (Recommended)**
1. Go to n8n Settings → Community Nodes
2. Click "Install" button
3. Enter package name: `n8n-nodes-wechatbot-peng`
4. Wait for installation to complete, n8n will automatically restart

**Option 2: Via npm**
```bash
# Navigate to n8n installation directory
cd ~/.n8n

# Install the node package
npm install n8n-nodes-wechatbot-peng

# Restart n8n service
```

**Option 3: Via Environment Variable**
```bash
# Start n8n with custom extensions path
N8N_CUSTOM_EXTENSIONS=/path/to/n8n-nodes-wechatbot-peng n8n start
```

### 3. Configure WeChat Login

**Step 1: Get QR Code**
1. Add Wechat Login node to workflow
2. Select operation Get QR Code
3. Run node to get qrcodeUrl and sessionKey
4. Open qrcodeUrl in browser and scan with WeChat

**Step 2: Verify Login**
1. Add another Wechat Login node
2. Select operation Verify Scan Result
3. Fill in sessionKey from previous step
4. Run node to get sessionData

**Step 3: Configure Credentials**
1. Go to n8n credentials management
2. Create Wechat Official Api credential
3. Paste sessionData JSON string into Session Data field

### 4. Create Message Listening Workflow

```
[Wechat Trigger]  - Configure WechatOfficialApi credentials
    ↓
[Processing]      - AI reply, data processing, etc.
    ↓
[Wechat Send]     - Configure WechatOfficialApi credentials, Target ID: {{ $json.senderId }}
```

## Workflow Examples

### Example 1: Simple Echo Bot

```
[Wechat Trigger] (messageTypeFilter: text)
    ↓
[Wechat Send]
  - Target ID: {{ $json.senderId }}
  - Message Type: Text
  - Message Content: You said: {{ $json.content }}
```

### Example 2: AI Smart Reply

```
[Wechat Trigger] (messageTypeFilter: text)
    ↓
[OpenAI Chat Model]
  - System Prompt: You are a friendly assistant
  - User Message: {{ $json.content }}
    ↓
[Wechat Send]
  - Target ID: {{ $json.senderId }}
  - Message Type: Text
  - Message Content: {{ $json.message }}
```

### Example 3: Health Check Monitoring

```
[Schedule Trigger] (Run every 6 hours)
    ↓
[Wechat Health Check]
    ↓
[IF Node] (Condition: {{ $json.healthy }} === false)
    ↓ Yes
[Send Email] or [Send Slack Message]
  - Subject: WeChat Bot Session Expired Alert
  - Content: Session expired, please re-scan QR code to login
```

## Technical Details

### Session Lifecycle
- bot_token (session token) valid for several days to weeks
- context_token (message routing token) valid for 24 hours
- Cannot proactively push messages after 24 hours of inactivity
- User sending a message resets the 24-hour window

### Typing Indicator Mechanism
1. Trigger receives message - Immediately sends typing status
2. Refresh every 5 seconds - Maintains typing display
3. Send node completes - Automatically sends cancel to stop
4. Uses UUID - Each message has independent typing session to prevent conflicts

### Message Deduplication
- Based on message_id deduplication
- Memory cache of last 1000 messages
- Prevents duplicate processing from network retries

### Error Handling
- errcode -14 - Session expired, requires re-login
- Consecutive failures - Exponential backoff retry (1s to 2s to 4s...)
- Network errors - Auto-reconnect, max 5 attempts

## Limitations

| Limitation | Description |
|------------|-------------|
| Proactive Push Window | Within 24 hours of user's last message |
| File Size | Maximum 100MB |
| Message Deduplication Window | Last 1000 messages |
| Typing Status Refresh | Every 5 seconds |
| Long Poll Timeout | 35 seconds |

## FAQ

### Q: Why can't I send proactive messages after 24 hours?
A: This is a WeChat iLink protocol limitation. The user needs to send a message first to reset the 24-hour window.

### Q: What to do when session expires?
A: Use Wechat Login node to re-scan QR code for new sessionData, then update credentials.

### Q: How to monitor session status?
A: Use Wechat Health Check node with Schedule Trigger and email notifications.

### Q: Can multiple users be handled simultaneously?
A: Yes. Each message has a unique UUID identifier, concurrent processing won't interfere.

### Q: Where are media files saved?
A: Downloaded media files are mounted to n8n's binary.data, accessible via binary in subsequent nodes.

## Development

### Project Structure

```
nodes/
├── WechatCore.ts                    # Core communication protocol
├── WechatLogin/
│   ├── WechatLogin.node.ts          # Login node
│   └── wechat.svg
├── WechatTrigger/
│   ├── WechatTrigger.node.ts        # Trigger node
│   └── wechat.svg
├── Wechat/
│   ├── Wechat.node.ts               # Send node
│   └── wechat.svg
└── WechatHealthCheck/
    ├── WechatHealthCheck.node.ts    # Health check node
    └── wechat.svg

credentials/
└── WechatOfficialApi.credentials.ts  # Credential definition
```

### Available Scripts

| Script | Description |
|--------|-------------|
| npm run dev | Start development server |
| npm run build | Build production version |
| npm run build:watch | Watch mode build |
| npm run lint | Code linting |
| npm run lint:fix | Auto-fix code style |
| npm run release | Release new version |

## Dependencies

- n8n-workflow - n8n workflow SDK
- @tencent-weixin/openclaw-weixin - WeChat official iLink API (type reference)
- sharp - Image processing (thumbnail generation)

## License

MIT

## Resources

- n8n Official Documentation: https://docs.n8n.io/
- n8n Community Node Development Guide: https://docs.n8n.io/integrations/creating-nodes/
- WeChat iLink Bot API Protocol Documentation: https://www.wechatbot.dev/en/protocol
- n8n Community Forum: https://community.n8n.io/
