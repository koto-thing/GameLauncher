import { useState } from "react";
import type { Application } from "../../../contracts/lt/v1";

/**
 * 発表内容とは独立して資料を提出する
 * @param props 申請、操作状態、資料の保存処理
 * @returns 資料の提出状況と入力フォーム
 */
export function MaterialForm({
  application,
  disabled,
  onSave,
}: {
  application: Application;
  disabled: boolean;
  onSave: (url: string) => void;
}) {
  const [url, setUrl] = useState(application.materialUrl);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(url.trim());
      }}
    >
      <p>
        資料:{" "}
        {!application.materialUrl
          ? "未提出"
          : application.materialReviewed
            ? "確認済み"
            : "運営の確認待ち"}
      </p>
      {application.materialDeadlineAt && (
        <p>
          資料提出期限:{" "}
          <time dateTime={application.materialDeadlineAt}>
            {new Date(application.materialDeadlineAt).toLocaleString("ja-JP", {
              timeZone: "Asia/Tokyo",
            })}
            （日本時間）
          </time>
        </p>
      )}
      <label>
        資料URL
        <input
          type="url"
          pattern="https?://.*"
          maxLength={2048}
          value={url}
          disabled={disabled}
          onChange={(event) => setUrl(event.currentTarget.value)}
        />
      </label>
      <button disabled={disabled || url.trim() === application.materialUrl}>資料を保存</button>
    </form>
  );
}
