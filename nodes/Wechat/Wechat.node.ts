/**
 * Wechat Send Node
 *
 * 必须配置 WechatOfficialApi 凭证。
 * 支持发送文本、图片和文件消息。
 */

import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	Icon,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { WechatCore } from './WechatCore';
import type { SessionData } from './WechatCore';

export class Wechat implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Wechat Send',
		name: 'wechat',
		icon: 'file:wechat.svg' as Icon,
		group: ['output'],
		version: 1,
		description: 'Send a Wechat message, image, or file to a recipient',
		defaults: {
			name: 'Wechat Send',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'wechatOfficialApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Target ID (e.g., senderId)',
				name: 'targetId',
				type: 'string',
				default: '',
				placeholder: '{{ $json.senderId }}',
				required: true,
				description: '填入 {{ $json.senderId }} 以回复发送者，或填入指定的微信 ID',
			},
			{
				displayName: 'Typing Session ID',
				name: 'typingSessionId',
				type: 'string',
				default: '',
				placeholder: '{{ $json.typingSessionId }}',
				required: false,
				description: '用于取消"输入中"状态的会话ID。从 Wechat Trigger 节点的 typingSessionId 获取',
			},
			{
				displayName: 'Message Type',
				name: 'messageType',
				type: 'options',
				options: [
					{
						name: 'Text',
						value: 'text',
						description: 'Send a text message',
					},
					{
						name: 'Image',
						value: 'image',
						description: 'Send an image',
					},
					{
						name: 'File',
						value: 'file',
						description: 'Send a file',
					},
				],
				default: 'text',
				required: true,
				description: 'The type of message to send',
			},
			{
				displayName: 'Message Content',
				name: 'messageContent',
				type: 'string',
				default: '',
				typeOptions: {
					rows: 4,
				},
				placeholder: 'Enter your message here...',
				required: true,
				displayOptions: {
					show: {
						messageType: ['text'],
					},
				},
				description: 'The text content to send',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: {
					show: {
						messageType: ['image', 'file'],
					},
				},
				description: 'The name of the binary property containing the file data to send',
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				placeholder: 'e.g., document.pdf',
				required: true,
				displayOptions: {
					show: {
						messageType: ['file'],
					},
				},
				description: 'The name of the file to send (required for file messages)',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// 获取并解析凭证
		const credentials = await this.getCredentials('wechatOfficialApi');
		const sessionDataRaw = (credentials.sessionData as string) || '';

		if (!sessionDataRaw) {
			throw new NodeOperationError(
				this.getNode(),
				'WechatOfficialApi credentials sessionData is empty. ' +
					'Please use the Wechat Login node to obtain sessionData and paste it into the credentials.',
			);
		}

		let sessionData: SessionData;
		try {
			sessionData = JSON.parse(sessionDataRaw) as SessionData;
		} catch {
			throw new NodeOperationError(
				this.getNode(),
				'Invalid sessionData JSON in WechatOfficialApi credentials.',
			);
		}

		if (!sessionData.accountId || !sessionData.token) {
			throw new NodeOperationError(
				this.getNode(),
				'Invalid sessionData: accountId and token are required.',
			);
		}

		// 实例化 WechatCore 并初始化会话（不启动轮询，仅用于发送）
		const core = new WechatCore();
		await core.init(sessionData);

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const targetId = this.getNodeParameter('targetId', itemIndex, '') as string;
				const messageType = this.getNodeParameter('messageType', itemIndex, 'text') as string;

				if (!targetId) {
					throw new NodeOperationError(
						this.getNode(),
						'Target ID is required.',
						{ itemIndex },
					);
				}

				let result: { messageId: string };

				if (messageType === 'text') {
					const messageContent = this.getNodeParameter('messageContent', itemIndex, '') as string;
					if (!messageContent) {
						throw new NodeOperationError(
							this.getNode(),
							'Message Content is required for text messages.',
							{ itemIndex },
						);
					}
					result = await core.sendMessage(targetId, messageContent);
				} else if (messageType === 'image') {
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex, 'data') as string;
					const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
					result = await core.sendImage(targetId, buffer);
				} else if (messageType === 'file') {
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex, 'data') as string;
					const fileName = this.getNodeParameter('fileName', itemIndex, '') as string;
					if (!fileName) {
						throw new NodeOperationError(
							this.getNode(),
							'File Name is required for file messages.',
							{ itemIndex },
						);
					}
					const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
					result = await core.sendFile(targetId, buffer, fileName);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Unsupported message type: ${messageType}`,
						{ itemIndex },
					);
				}

				// 如果填写了 Typing Session ID，则取消"输入中"状态
				const typingSessionId = this.getNodeParameter('typingSessionId', itemIndex, '') as string;
				if (typingSessionId) {
					try {
						await core.sendTyping(targetId, 'cancel');
					} catch {
						// 忽略取消失败，不影响消息发送
					}
				}

				returnData.push({
					json: {
						success: true,
						messageId: result.messageId,
						to: targetId,
						messageType,
						accountId: sessionData.accountId,
					},
					pairedItem: itemIndex,
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							success: false,
							to: this.getNodeParameter('targetId', itemIndex, '') as string,
							messageType: this.getNodeParameter('messageType', itemIndex, 'text') as string,
							error: error instanceof Error ? error.message : String(error),
						},
						pairedItem: itemIndex,
					});
					continue;
				}

				if (error instanceof NodeOperationError && error.context) {
					error.context.itemIndex = itemIndex;
					throw error;
				}

				throw new NodeOperationError(this.getNode(), error, {
					itemIndex,
				});
			}
		}

		return [returnData];
	}
}
