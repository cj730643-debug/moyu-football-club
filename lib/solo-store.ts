import type { Replay, Room } from '../game/types.ts';

export interface SoloStore {
    loadRoom(): Promise<Room | null>;
    loadReplay(id: string): Promise<Replay | null>;
    saveRoom(room: Room, replay?: Replay, expectedRevision?: number): Promise<void>;
    allReplays(): Promise<Replay[]>;
    replace(room: Room, replays: Replay[]): Promise<void>;
}

function result<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('存档读取失败'));
    });
}
function completed(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error('存档已在其他页面更新，请刷新后再试'));
        transaction.onerror = () => reject(transaction.error || new Error('存档保存失败，请检查浏览器存储空间'));
    });
}

export class BrowserSoloStore implements SoloStore {
    private database: Promise<IDBDatabase> | null = null;
    private db(): Promise<IDBDatabase> {
        if (!this.database) this.database = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') { reject(new Error('当前浏览器无法保存游戏，请使用 Chrome 或 Edge 打开网页')); return; }
            const request = indexedDB.open('mfc.solo.v1', 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('campaign');
                request.result.createObjectStore('replays', { keyPath: 'match_id' });
            };
            request.onsuccess = () => {
                request.result.onversionchange = () => request.result.close();
                resolve(request.result);
            };
            request.onerror = () => reject(new Error('无法保存单人存档，请允许浏览器存储并重新打开网页'));
            request.onblocked = () => reject(new Error('另一个页面正在使用旧版存档，请关闭它后重试'));
        });
        return this.database;
    }
    async loadRoom(): Promise<Room | null> {
        const db = await this.db();
        const value = await result(db.transaction('campaign').objectStore('campaign').get('current'));
        if (!value) return null;
        if (value.version !== 1 || !value.room) throw new Error('存档版本无法读取，请先导出备份');
        return value.room as Room;
    }
    async loadReplay(id: string): Promise<Replay | null> {
        const db = await this.db();
        return await result(db.transaction('replays').objectStore('replays').get(id)) || null;
    }
    async saveRoom(room: Room, replay?: Replay, expectedRevision?: number): Promise<void> {
        const db = await this.db();
        const tx = db.transaction(['campaign', 'replays'], 'readwrite');
        const done = completed(tx);
        const store = tx.objectStore('campaign');
        const old = store.get('current');
        old.onsuccess = () => {
            if (expectedRevision !== undefined && old.result?.room?.revision !== expectedRevision) { tx.abort(); return; }
            store.put({ version: 1, room }, 'current');
            if (replay) tx.objectStore('replays').put(replay);
        };
        await done;
    }
    async allReplays(): Promise<Replay[]> {
        const db = await this.db();
        return result(db.transaction('replays').objectStore('replays').getAll());
    }
    async replace(room: Room, replays: Replay[]): Promise<void> {
        const db = await this.db();
        const tx = db.transaction(['campaign', 'replays'], 'readwrite');
        const done = completed(tx);
        tx.objectStore('campaign').put({ version: 1, room }, 'current');
        const store = tx.objectStore('replays');
        store.clear();
        for (const replay of replays) store.put(replay);
        await done;
    }
}
