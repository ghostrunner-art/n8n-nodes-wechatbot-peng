/**
 * Wechat Official API Credentials
 *
 * 仅提供 sessionData 一个字段，由 Wechat Login 节点生成后粘贴至此。
 */

import type {
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class WechatOfficialApi implements ICredentialType {
	name = 'wechatOfficialApi';

	displayName = 'Wechat Official API';

	icon: Icon = { light: 'file:../icons/wechat.svg', dark: 'file:../icons/wechat.svg' };

	documentationUrl = 'https://github.com/your-org/n8n-nodes-wechat-official#readme';

	properties: INodeProperties[] = [
		{
			displayName: 'Session Data',
			name: 'sessionData',
			type: 'string',
			typeOptions: {
				rows: 6,
			},
			default: '',
			required: true,
			description: '请使用 Wechat Login 节点获取您的 Session Data 并粘贴至此',
		},
	];
}
