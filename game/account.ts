export function accountName(value: unknown): { display: string; key: string } {
    if (typeof value !== 'string') throw new Error('请输入用户名');
    const display = value.normalize('NFKC').trim();
    if (!/^[\p{L}\p{N}_-]{2,20}$/u.test(display))
        throw new Error('用户名为2–20个字，可使用中文、字母、数字、下划线');
    return { display, key: display.toLowerCase() };
}

export function accountPassword(value: unknown): string {
    if (typeof value !== 'string' || value.length < 8 || value.length > 128)
        throw new Error('密码需要8–128位');
    return value;
}

// Internal Auth address; it is never requested from the player or used for mail.
export async function accountAddress(key: string): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mfc.username.v1:' + key));
    return 'mfc.' + [...new Uint8Array(hash)].slice(0, 16).map(n => n.toString(16).padStart(2, '0')).join('') + '@accounts.moyu.invalid';
}
