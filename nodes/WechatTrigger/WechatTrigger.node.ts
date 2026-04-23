/**
 * Wechat Trigger Node
 *
 * 必须配置 WechatOfficialApi 凭证。
 * 从凭证获取 sessionData，实例化 WechatCore 进行无感连接。
 * 流式监听消息，仅在收到消息时 emit 触发工作流。
 */

import type {
	ITriggerFunctions,
	ITriggerResponse,
	INodeType,
	INodeTypeDescription,
	Icon,
	IDataObject,
} from 'n8n-workflow';

import { randomUUID } from 'node:crypto';
import { WechatCore } from './WechatCore';
import type { SessionData, WeixinMessage } from './WechatCore';

export class WechatTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Wechat Trigger',
		name: 'wechatTrigger',
		icon: 'file:wechat.svg' as Icon,
		group: ['trigger'],
		version: 1,
		description: 'Triggers a workflow when a Wechat message is received',
		defaults: {
			name: 'Wechat Trigger',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'wechatOfficialApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Message Type Filter',
				name: 'messageTypeFilter',
				type: 'multiOptions',
				options: [
					{
						name: 'Text',
						value: 'text',
						description: 'Text messages',
					},
					{
						name: 'Image',
						value: 'image',
						description: 'Image messages',
					},
					{
						name: 'Voice',
						value: 'voice',
						description: 'Voice messages (with ASR text if available)',
					},
					{
						name: 'File',
						value: 'file',
						description: 'File attachments',
					},
					{
						name: 'Video',
						value: 'video',
						description: 'Video messages',
					},
				],
				default: ['text', 'image', 'voice', 'file', 'video'],
				description: 'Only trigger on selected message types. Select all to receive every message.',
			},
			{
				displayName: 'Include Raw Message',
				name: 'includeRaw',
				type: 'boolean',
				default: false,
				description: 'Whether to include the full raw message object in the output',
			},
			{
				displayName: 'Deduplication',
				name: 'deduplication',
				type: 'boolean',
				default: true,
				description: 'Whether to filter out duplicate messages based on message ID',
			},
		],
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse | undefined> {
		const credentials = await this.getCredentials('wechatOfficialApi');
		const messageTypeFilter = this.getNodeParameter('messageTypeFilter', []) as string[];
		const includeRaw = this.getNodeParameter('includeRaw', false) as boolean;
		const deduplication = this.getNodeParameter('deduplication', true) as boolean;

		// 解析凭证中的 sessionData
		const sessionDataRaw = (credentials.sessionData as string) || '';
		if (!sessionDataRaw) {
			throw new Error(
				'WechatOfficialApi credentials sessionData is empty. ' +
					'Please use the Wechat Login node to obtain sessionData and paste it into the credentials.',
			);
		}

		let sessionData: SessionData;
		try {
			sessionData = JSON.parse(sessionDataRaw) as SessionData;
		} catch {
			throw new Error('Invalid sessionData JSON in WechatOfficialApi credentials.');
		}

		if (!sessionData.accountId || !sessionData.token) {
			throw new Error(
				'Invalid sessionData: accountId and token are required. ' +
					'Please use the Wechat Login node to obtain valid sessionData.',
			);
		}

		// 实例化 WechatCore 并传入凭证启动长连接
		const core = new WechatCore();

		// 消息去重缓存
		const seenMessageIds = new Set<number>();

		// 跟踪正在输入中的会话
		const typingSessions = new Set<string>();

		// 消息处理器 —— 唯一允许调用 this.emit 的地方
		const messageHandler = async (event: {
			content: string;
			from: string;
			to: string;
			raw: WeixinMessage;
			contextToken?: string;
		}) => {
			const raw = event.raw;

			// 为每条消息生成唯一的 typing 会话 ID
			const typingSessionId = randomUUID();
			const senderId = event.from;
			
			// 立即发送"输入中"状态
			if (senderId) {
				try {
					await core.sendTyping(senderId, 'typing');
					typingSessions.add(typingSessionId);
					
					// 每5秒刷新一次"输入中"状态，保持显示
					const typingInterval = setInterval(async () => {
						if (typingSessions.has(typingSessionId)) {
							try {
								await core.sendTyping(senderId, 'typing');
							} catch {
								// 忽略刷新失败
							}
						} else {
							clearInterval(typingInterval);
						}
					}, 5000);
				} catch {
					// 忽略发送失败
				}
			}

			// 去重检查
			if (deduplication && raw.message_id != null) {
				if (seenMessageIds.has(raw.message_id)) {
					return; // 跳过重复消息
				}
				seenMessageIds.add(raw.message_id);
				// 防止内存无限增长，保留最近 1000 条
				if (seenMessageIds.size > 1000) {
					const first = seenMessageIds.values().next().value;
					if (first != null) {
						seenMessageIds.delete(first);
					}
				}
			}

			// 检测消息类型
			const itemList = raw.item_list || [];
			let detectedType = 'unknown';
			let messageContent = event.content;
			let quotedContent: string | undefined;
			let quotedType: string | undefined;
			let voiceText: string | undefined;
			let fileName: string | undefined;
			let fileSize: string | undefined;

			for (const item of itemList) {
				// 文本消息（可能包含引用）
				if (item.type === 1 && item.text_item) {
					detectedType = 'text';
					// 提取引用信息
					if (item.ref_msg) {
						quotedType = item.ref_msg.message_item?.type === 2 ? 'image' :
							item.ref_msg.message_item?.type === 3 ? 'voice' :
							item.ref_msg.message_item?.type === 4 ? 'file' :
							item.ref_msg.message_item?.type === 5 ? 'video' : 'text';
						quotedContent = item.ref_msg.title || '';
						if (item.ref_msg.message_item?.text_item?.text) {
							quotedContent = item.ref_msg.message_item.text_item.text;
						}
					}
				}
				// 图片
				if (item.type === 2) {
					detectedType = 'image';
				}
				// 语音
				if (item.type === 3 && item.voice_item) {
					detectedType = 'voice';
					voiceText = item.voice_item.text;
				}
				// 文件
				if (item.type === 4 && item.file_item) {
					detectedType = 'file';
					fileName = item.file_item.file_name;
					fileSize = item.file_item.len;
				}
				// 视频
				if (item.type === 5) {
					detectedType = 'video';
				}
			}

			// 类型过滤
			if (!messageTypeFilter.includes(detectedType)) {
				return; // 跳过不匹配的消息类型
			}

			// 构建输出
			const formattedMessage: IDataObject = {
				senderId: event.from,
				recipientId: event.to,
				messageType: detectedType,
				content: messageContent,
				contextToken: event.contextToken,
				timestamp: raw.create_time_ms ? new Date(raw.create_time_ms).toISOString() : new Date().toISOString(),
				messageId: raw.message_id,
				seq: raw.seq,
				sessionId: raw.session_id,
				// 用于关联 typing 状态，Send 节点收到后会取消"输入中"
				typingSessionId,
				isTypingActive: true,
				typingTargetId: senderId,
			};

			// 引用消息信息
			if (quotedContent) {
				formattedMessage.quoted = {
					content: quotedContent,
					type: quotedType,
				};
			}

			// 语音转文字
			if (voiceText) {
				formattedMessage.voiceText = voiceText;
			}

			// 文件信息
			if (fileName) {
				formattedMessage.fileName = fileName;
				formattedMessage.fileSize = fileSize;
			}

			// 原始消息（可选）
			if (includeRaw) {
				formattedMessage.rawMessage = raw as IDataObject;
			}

			// 下载媒体文件（图片、语音、文件、视频）并挂载到 binary
			if (['image', 'voice', 'file', 'video'].includes(detectedType)) {
				try {
					const mediaResult = await core.getMessageMediaBuffer(raw);
					if (mediaResult) {
						// 将文件内容挂载到 binary 数据
						const binaryData = await this.helpers.prepareBinaryData(
							mediaResult.buffer,
							mediaResult.fileName,
							mediaResult.mimeType,
						);
						formattedMessage.binary = {
							data: binaryData,
						};
					}
				} catch (err) {
					// 下载失败不影响消息触发，只记录日志
					console.warn(`Failed to download media for message ${raw.message_id}: ${err}`);
				}
			}

			this.emit([this.helpers.returnJsonArray([formattedMessage])]);
		};

		// 错误处理器
		const errorHandler = (error: Error) => {
			this.emitError(error);
		};

		// 注册事件监听
		core.on('message', messageHandler);
		core.on('error', errorHandler);

		// 启动 WechatCore（传入 sessionData 直接恢复连接并启动轮询）
		await core.init(sessionData);

		// 返回 closeFunction，在节点停用时释放资源
		const closeFunction = async () => {
			// 清理所有 typing 会话
			typingSessions.clear();
			core.off('message', messageHandler);
			core.off('error', errorHandler);
			core.stop();
		};

		return {
			closeFunction,
		};
	}
}
