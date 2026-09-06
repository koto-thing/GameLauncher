import { setupVideo } from "./video.ts";

const video = document.querySelector<HTMLVideoElement>(".background-video");
if (video) setupVideo(video);

import { setupLanguage } from "./language.ts";
setupLanguage();
