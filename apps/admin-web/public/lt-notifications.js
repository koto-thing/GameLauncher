/**
 * プッシュ受信時に個人情報を含まない通知を表示する
 * @param event ブラウザーのプッシュイベント
 * @returns 戻り値なし
 */
self.addEventListener("push", function showOperationsNotification(event) {
  event.waitUntil(self.registration.showNotification("LT会：運営の確認が必要です", {
    body: "要対応事項または自動運営の稼働状況が変わりました。管理画面で確認してください。",
    tag: "lt-operations-attention",
    icon: "/favicon.png",
  }));
});

/**
 * 通知クリック時に同一サイトの管理画面へ移動する
 * @param event 通知のクリックイベント
 * @returns 戻り値なし
 */
self.addEventListener("notificationclick", function openOperations(event) {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(new URL("/lt#lt-monitor", self.location.origin).href));
});
