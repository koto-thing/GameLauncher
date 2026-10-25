import type { Page, PublicEvent } from '../../../contracts/lt/v1';
// 開発専用。通常ビルドから選択できない fixture アダプター
export async function fixture<T>(path: string): Promise<T> {
 if (path === '/events') return {items:[{id:'fixture-event',version:1,title:'開発 fixture LT会',venue:'架空会場',guidance:'検証用データ',startsAt:'2030-01-01T01:00:00.000Z',endsAt:'2030-01-01T02:00:00.000Z',timeZone:'Asia/Tokyo',recruitment:'open',schedule:[]}],nextCursor:null} satisfies Page<PublicEvent> as T;
 throw new Error('開発 fixture: この操作は未接続です');
}
