import { musicApi } from "@/music/presentation/api";

// Music専用入口に集約し、全動詞を同じ本人・作品認可へ通す。
export const GET = musicApi;
export const HEAD = musicApi;
export const POST = musicApi;
export const PUT = musicApi;
