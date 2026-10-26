import {
  siX,
  siYoutube,
  siGithub,
  siInstagram,
  siBluesky,
  siTwitch,
  siDiscord,
  siNote,
} from "simple-icons";

const services = [
  { hosts: ["x.com", "twitter.com"], icon: siX },
  { hosts: ["youtube.com", "youtu.be"], icon: siYoutube },
  { hosts: ["github.com"], icon: siGithub },
  { hosts: ["instagram.com"], icon: siInstagram },
  { hosts: ["bsky.app"], icon: siBluesky },
  { hosts: ["twitch.tv"], icon: siTwitch },
  { hosts: ["discord.com", "discord.gg"], icon: siDiscord },
  { hosts: ["note.com"], icon: siNote },
];

/**
 * リンク先ドメインからSNSを識別する
 *
 * @param value 公開URL
 * @returns 対応サービスのアイコン、不正な URL や未対応サービスの場合は undefined
 */
export function socialIcon(value: string) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return undefined;
    return services.find((service) =>
      service.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)),
    )?.icon;
  } catch {
    return undefined;
  }
}
