/**
 * Wechat Health Check Node
 *
 * 用于检查 Wechat Session 的健康状态。
 * 必须配置 WechatOfficialApi 凭证。
 * 通过调用 getConfig API 验证 session 是否有效。
 */

import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	Icon,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { WechatCore } from '../WechatCore';
import type { SessionData } from '../WechatCore';

export class WechatHealthCheck implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Wechat Health Check',
		name: 'wechatHealthCheck',
		icon: 'file:wechat.svg' as Icon,
		group: ['transform'],
		version: 1,
		description: 'Check if the Wechat session is still valid',
		defaults: {
			name: 'Wechat Health Check',
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
				displayName: 'Test User ID',
				name: 'testUserId',
				type: 'string',
				default: '',
				placeholder: '{{ $json.senderId }}',
				description: '用于测试 session 的用户 ID（可以是任意一个之前互动过的用户）',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// 获取凭证
		const credentials = await this.getCredentials('wechatOfficialApi');
		const sessionDataRaw = (credentials.sessionData as string) || '';

		if (!sessionDataRaw) {
			throw new NodeOperationError(
				this.getNode(),
				'WechatOfficialApi credentials sessionData is empty. Please use the Wechat Login node to obtain sessionData first.',
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

		if (!sessionData.accountId || !sessionData.token || !sessionData.userId) {
			throw new NodeOperationError(
				this.getNode(),
				'Invalid sessionData: accountId, token, and userId are required.',
			);
		}

		const core = new WechatCore();

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				// 获取测试用的 userId（如果没有提供，使用 sessionData 中的 userId）
				const testUserId = this.getNodeParameter('testUserId', itemIndex, '') as string;
				const targetUserId = testUserId || sessionData.userId;

				// 尝试调用 getConfig 来验证 session
				const configResult = await core.getConfig(targetUserId, sessionData);

				// 检查结果
				const isHealthy = configResult.ret === 0;
				const errorCode = configResult.errcode ?? configResult.ret ?? 0;
				const errorMessage = configResult.errmsg || '';

				// 构建输出
				const result: Record<string, string | boolean | number> = {
					healthy: isHealthy,
					accountId: sessionData.accountId,
					testUserId: targetUserId,
					timestamp: new Date().toISOString(),
				};

				if (isHealthy) {
					result.message = 'Session is valid and healthy';
					result.typingTicket = configResult.typing_ticket ? 'Available' : 'Not available';
				} else {
					result.message = 'Session is invalid or expired';
					result.errorCode = errorCode;
					result.errorMessage = errorMessage;
					result.actionRequired = errorCode === -14 
						? 'Session expired. Please use Wechat Login node to re-authenticate.' 
						: 'Check credentials and try again.';
				}

				returnData.push({
					json: result,
					pairedItem: itemIndex,
				});

			} catch (error) {
				// API 调用失败（网络错误等）
				returnData.push({
					json: {
						healthy: false,
						accountId: sessionData.accountId,
						timestamp: new Date().toISOString(),
						message: 'Health check failed due to error',
						error: error instanceof Error ? error.message : String(error),
						actionRequired: 'Check network connection and credentials.',
					},
					pairedItem: itemIndex,
				});
			}
		}

		return [returnData];
	}
}
