import type { TalkContent } from "../../../contracts/lt/v1";
import { sessionFields, relatedFields, difficulties } from "../../../contracts/lt/session-options";

type Session = NonNullable<TalkContent["session"]>;

/** @brief 改行・読点・カンマで指定したタグを整形する @param text 入力 @returns 重複しないタグ */
export function splitTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,、\n\r]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

/** @brief フォーム値を検証して発表情報を構築する @param f 入力値 @returns セッション情報 */
export function readSession(f: FormData): Session {
  const field = String(f.get("field")),
    difficulty = String(f.get("difficulty"));
  const selected = f.getAll("relatedFields").map(String);
  const keywords = splitTags(String(f.get("keywords") ?? ""));
  const platforms = splitTags(String(f.get("platforms") ?? ""));
  if (
    !Object.hasOwn(sessionFields, field) ||
    !Object.hasOwn(difficulties, difficulty) ||
    selected.some((key) => !Object.hasOwn(relatedFields, key))
  )
    throw new Error("分野と難易度を選択してください。");
  if (keywords.length > 10 || keywords.some((v) => Array.from(v).length > 40))
    throw new Error("キーワードは10個まで、1個40文字以内で入力してください。");
  if (platforms.length > 10 || platforms.some((v) => Array.from(v).length > 60))
    throw new Error("対象プラットフォームは10個まで、1個60文字以内で入力してください。");
  return {
    field: field as Session["field"],
    relatedFields: selected as Session["relatedFields"],
    keywords,
    platforms,
    difficulty: difficulty as Session["difficulty"],
    prerequisites: String(f.get("prerequisites") ?? "").trim(),
    takeaways: String(f.get("takeaways") ?? "").trim(),
  };
}

/** @brief 発表者が任意に公開するリンクのURLを確認する @param value URL @returns 安全なHTTP(S)か */
export function isSpeakerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

/** @brief 発表分類と聴講者向け情報の入力欄 @param props 保存済み情報 @returns 入力欄 */
export function SessionFields({ value }: { value?: Session }) {
  return (
    <fieldset className="session-form-fields">
      <legend>発表の情報</legend>

      <label className="required-field">
        分野
        <select name="field" required defaultValue={value?.field ?? ""}>
          <option value="">選択してください</option>
          {Object.entries(sessionFields).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="related-field-options">
        <legend>関連分野</legend>
        {Object.entries(relatedFields).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              name="relatedFields"
              value={key}
              defaultChecked={value?.relatedFields.includes(key as keyof typeof relatedFields)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label>
        キーワード
        <textarea
          name="keywords"
          defaultValue={value?.keywords.join("、")}
          placeholder="Unity、シェーダー、チーム開発など"
          maxLength={420}
        />
        <small>カンマ区切りで10個まで</small>
      </label>
      <label>
        対象プラットフォーム
        <textarea
          name="platforms"
          defaultValue={value?.platforms.join("、")}
          placeholder="PC、Web、Androidなど"
          maxLength={620}
        />
      </label>
      <label className="required-field">
        難易度
        <select name="difficulty" required defaultValue={value?.difficulty ?? ""}>
          <option value="">選択してください</option>
          {Object.entries(difficulties).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        求められるスキル
        <textarea
          name="prerequisites"
          maxLength={3000}
          defaultValue={value?.prerequisites}
          placeholder="前提知識なし、Unityの基本操作など"
        />
      </label>
      <label>
        得られる知見
        <textarea
          name="takeaways"
          maxLength={3000}
          defaultValue={value?.takeaways}
          placeholder="発表を聞いて分かること・できるようになること"
        />
      </label>
    </fieldset>
  );
}
