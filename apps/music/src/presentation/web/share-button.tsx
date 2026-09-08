import { useId, useRef, useState, type ReactNode } from "react";

/** @brief 曲のリンクをサービス選択・コピー・端末の共有メニューで渡す */
export function ShareButton({
  url,
  title,
  children,
}: {
  url: string;
  title: string;
  children?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const [message, setMessage] = useState("");
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  const services = [
    {
      name: "X",
      icon: "𝕏",
      color: "#111",
      href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
    },
    {
      name: "LINE",
      icon: "LINE",
      color: "#06c755",
      href: `https://social-plugins.line.me/lineit/share?url=${encodedUrl}&text=${encodedTitle}`,
    },
    {
      name: "Facebook",
      icon: "f",
      color: "#1877f2",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    },
    {
      name: "WhatsApp",
      icon: "↗",
      color: "#128c4a",
      href: `https://wa.me/?text=${encodeURIComponent(`${title}\n${url}`)}`,
    },
    {
      name: "メール",
      icon: "✉",
      color: "#656975",
      href: `mailto:?subject=${encodedTitle}&body=${encodeURIComponent(`${title}\n${url}`)}`,
    },
  ];

  /** @brief コピー結果を通知し、失敗時は手動コピーできるよう選択する */
  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("URLをコピーしました。");
    } catch {
      input.current?.focus();
      input.current?.select();
      setMessage(
        "コピーできませんでした。URLを選択して手動でコピーしてください。",
      );
    }
  }

  /** @brief 対応端末で共有先を選択し、キャンセルはエラー扱いにしない */
  async function shareNative() {
    try {
      await navigator.share({ title, url });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setMessage(
          "共有メニューを開けませんでした。共有先のボタンかURLコピーをご利用ください。",
        );
      }
    }
  }

  return (
    <>
      <button
        type="button"
        className="share-trigger"
        aria-haspopup="dialog"
        onClick={
          /** @brief 共有ダイアログを開く */ () => {
            setMessage("");
            dialog.current?.showModal();
          }
        }
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m14 3 8 7-8 7v-5C8 12 5 15 2 20c0-9 5-13 12-13V3Z" />
        </svg>
        共有
      </button>
      <dialog
        ref={dialog}
        className="share-dialog"
        aria-labelledby={headingId}
        onClick={
          /** @brief 背景を押した場合だけ閉じる */ (event) => {
            if (event.target === event.currentTarget) {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom
              )
                dialog.current?.close();
            }
          }
        }
      >
        <header className="share-heading">
          <h2 id={headingId}>共有</h2>
          <button
            type="button"
            aria-label="共有を閉じる"
            autoFocus
            onClick={
              /** @brief ダイアログを閉じる */ () => dialog.current?.close()
            }
          >
            ×
          </button>
        </header>
        <p className="share-title">{title}</p>
        <div className="share-services">
          {services.map(
            /** @brief 各サービスの共有画面へのリンクを表示する */ (
              service,
            ) => (
              <a
                key={service.name}
                href={service.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${service.name}で共有（新しいタブで開く）`}
              >
                <span
                  className="share-service-icon"
                  style={{ background: service.color }}
                  aria-hidden="true"
                >
                  {service.icon}
                </span>
                <span>{service.name}</span>
              </a>
            ),
          )}
          {typeof navigator.share === "function" && (
            <button
              type="button"
              onClick={
                /** @brief 端末の共有メニューを開く */ () =>
                  void shareNative()
              }
            >
              <span className="share-service-icon" aria-hidden="true">
                •••
              </span>
              <span>その他</span>
            </button>
          )}
        </div>
        {children}
        <div className="share-copy">
          <input
            ref={input}
            aria-label="共有URL"
            readOnly
            value={url}
            onFocus={
              /** @brief 手動コピー用にURLを選択する */ (event) =>
                event.target.select()
            }
          />
          <button
            type="button"
            onClick={
              /** @brief URLをクリップボードへコピーする */ () =>
                void copyUrl()
            }
          >
            コピー
          </button>
        </div>
        <p className="share-status" role="status">
          {message}
        </p>
      </dialog>
    </>
  );
}
