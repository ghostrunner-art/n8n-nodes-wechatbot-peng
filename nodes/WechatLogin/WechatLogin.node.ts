/**
 * Wechat Login Node
 *
 * 独立登录节点，不需要配置凭证。
 * 提供两个 operation：
 *   - Get QR Code：获取二维码 URL
 *   - Verify Scan Result：使用 sessionKey 验证扫码结果
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

export class WechatLogin implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Wechat Login',
		name: 'wechatLogin',
		icon: 'file:wechat.svg' as Icon,
		group: ['transform'],
		version: 1,
		description: 'Get QR code or verify Wechat login scan result',
		defaults: {
			name: 'Wechat Login',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				options: [
					{
						name: 'Get QR Code',
						value: 'getQRCode',
						description: '获取登录二维码',
					},
					{
						name: 'Verify Scan Result',
						value: 'verifyScan',
						description: '验证扫码登录结果',
					},
				],
				default: 'getQRCode',
				required: true,
			},
			{
				displayName: 'Session Key',
				name: 'sessionKey',
				type: 'string',
				default: '',
				placeholder: 'Paste the sessionKey from Get QR Code result',
				required: true,
				displayOptions: {
					show: {
						operation: ['verifyScan'],
					},
				},
				description: '从 Get QR Code 步骤获取的 sessionKey',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		const core = new WechatCore();

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				if (operation === 'getQRCode') {
					const result = await core.startLogin();
					if (!result.qrcodeUrl) {
						throw new NodeOperationError(
							this.getNode(),
							`Failed to get QR code: ${result.message}`,
							{ itemIndex },
						);
					}

					returnData.push({
						json: {
							qrcodeUrl: result.qrcodeUrl,
							sessionKey: result.sessionKey,
							instruction: '请在浏览器打开 url 扫码，然后复制 sessionKey 使用下一步验证',
						},
						pairedItem: itemIndex,
					});
				} else if (operation === 'verifyScan') {
					const sessionKey = this.getNodeParameter('sessionKey', itemIndex, '') as string;
					if (!sessionKey) {
						throw new NodeOperationError(
							this.getNode(),
							'Session Key is required for Verify Scan Result operation.',
							{ itemIndex },
						);
					}

					const result = await core.waitForLogin(sessionKey);

					if (!result.connected || !result.botToken || !result.accountId) {
						throw new NodeOperationError(
							this.getNode(),
							`Login verification failed: ${result.message}`,
							{ itemIndex },
						);
					}

					const sessionData = {
						accountId: result.accountId,
						token: result.botToken,
						baseUrl: result.baseUrl || 'https://ilinkai.weixin.qq.com',
						userId: result.userId,
					};

					returnData.push({
						json: {
							sessionData: JSON.stringify(sessionData),
							instruction: '请将上面的 sessionData 复制并填入 Wechat Official Api 凭证中',
							connected: result.connected,
							accountId: result.accountId,
							userId: result.userId,
						},
						pairedItem: itemIndex,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							success: false,
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
