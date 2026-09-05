import type { DomainPolicy } from "../domain/models";

// 素材制限と編集ルールをここだけで調整し、APIと画面に同じ値を渡す。
export const DOMAIN_POLICY_DEFAULTS: DomainPolicy = {
  media: {
    maxAudioFileBytes: 64 * 1024 * 1024,
    maxImageFileBytes: 8 * 1024 * 1024,
    maxAudioDurationSeconds: 600,
    maxImageEdgePixels: 4096,
  },
  loop: { minimumLengthSeconds: 0.1 },
  text: {
    titleMax: 160,
    descriptionMax: 4000,
    creditMax: 24,
    creditNameMax: 160,
    creditRoleMax: 80,
    imageAltMax: 300,
    urlMax: 2048,
  },
};
