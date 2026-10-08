import { accountAddress, accountName, accountPassword } from '../../../game/account.ts';

interface Config { url: string; admin: string; anon: string }
type Credentials = { type: 'register_username' | 'login_username'; username?: unknown; password?: unknown };

export async function usernameAuth(req: Request, action: Credentials, config: Config) {
    const { display, key } = accountName(action.username);
    const password = accountPassword(action.password);
    const { url, admin, anon } = config;
    async function accountRPC<T>(p_action: string, p_data: unknown): Promise<T> {
        const response = await fetch(url + '/rest/v1/rpc/mfc_account', {
            method: 'POST', headers: { apikey: admin, Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_action, p_data }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || '账号服务暂时不可用');
        return data as T;
    }
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    const address = [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
    const rate = await accountRPC<{ allowed: boolean }>('rate', {
        registering: action.type === 'register_username', address, name_key: key,
    });
    if (!rate.allowed) throw new Error('尝试次数较多，请稍后再试；单人模式可直接开始');
    const email = await accountAddress(key);
    if (action.type === 'register_username') {
        const available = await accountRPC<boolean>('available', { name_key: key });
        if (!available) throw new Error('这个用户名已被使用，请换一个');
        const created = await fetch(url + '/auth/v1/admin/users', {
            method: 'POST', headers: { apikey: admin, Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { username: display }, app_metadata: { mfc_username_account: true } }),
        });
        const user = await created.json();
        if (!created.ok) {
            if (created.status === 422 || user.code === 'email_exists') throw new Error('这个用户名已被使用，请换一个');
            throw new Error('账号创建失败，请稍后再试');
        }
        if (typeof user.id !== 'string') throw new Error('账号创建失败');
        try {
            await accountRPC('register', { name_key: key, username: display, user_id: user.id, email });
        } catch (error) {
            // Only undo the fresh, unregistered identity created by this request.
            const cleanup = await fetch(url + '/auth/v1/admin/users/' + user.id, {
                method: 'DELETE', headers: { apikey: admin, Authorization: 'Bearer ' + admin },
            });
            if (!cleanup.ok) throw new Error('账号保存未完成，请稍后再试');
            throw error;
        }
    }
    const account = await accountRPC<{ user_id: string; email: string } | null>('lookup', { name_key: key });
    const logged = await fetch(url + '/auth/v1/token?grant_type=password', {
        method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: account?.email || email, password }),
    });
    const session = await logged.json();
    if (!logged.ok || !account || session.user?.id !== account.user_id)
        throw new Error('用户名或密码不正确');
    return session;
}
