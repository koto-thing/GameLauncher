"use client";
import { useState } from "react";
import type { OperatorApplication } from "../../../../contracts/lt/v1";
import { ApplicationForm } from "../../../lt-web/src/ApplicationForm";

/**
 * 管理者・幹部が申請内容をまとめて編集する
 * @param props 編集対象と保存操作
 * @param props.application 対象の申請
 * @param props.busy 保存中または再読込が必要な状態
 * @param props.onSave 入力内容を保存する処理
 * @returns 編集ボタンまたは申請フォーム
 */
export function ApplicationEditor({ application, busy, onSave }: {
  application: OperatorApplication;
  busy: boolean;
  onSave: (data: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) return <button type="button" disabled={busy} onClick={() => setEditing(true)}>申請情報を編集</button>;

  // 保存成功時は親の申請版が変わり、編集フォームを初期化する
  return <div className="lt-application-editor">
    <p>公開済みの発表内容・登壇者情報は、保存すると公開ページにも反映されます。資料URLを変更すると確認済み状態が解除されます。</p>
    <ApplicationForm application={application} events={{ items: [], nextCursor: null }} busy={busy}
      operatorEdit save={onSave} cancel={() => setEditing(false)} />
  </div>;
}
