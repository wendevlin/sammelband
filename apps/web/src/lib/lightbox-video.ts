import type { Photo } from "@sammelband/shared";
import type { SlideData } from "photoswipe";
import type PhotoSwipeLightbox from "photoswipe/lightbox";
import type { ImageUrls } from "#lib/images.ts";

// Videos in PhotoSwipe. A playable video becomes a slide of type "video": a
// <video> with the native controls, its poster shown until it plays. It plays
// when its slide is shown and pauses when the viewer swipes on. A video that
// is still being converted is shown as its poster, like a photo.

type VideoSlide = SlideData & { type: "video"; videoSrc: string; posterSrc: string };

/** The PhotoSwipe slide of a photo or video. */
export function slideOf(p: Photo, urls: ImageUrls): SlideData {
  const image = {
    src: urls.src(p.filename, 1920),
    srcset: urls.srcset(p.filename),
    width: p.width,
    height: p.height,
    alt: p.caption ?? "",
  };
  if (p.kind !== "video" || p.video_status !== "ready" || !p.video_filename) return image;
  return {
    ...image,
    type: "video",
    videoSrc: urls.video(p.video_filename),
    posterSrc: image.src,
  } satisfies VideoSlide;
}

/** Let `lightbox` show video slides. Call before `init()`. */
export function enableVideos(lightbox: PhotoSwipeLightbox): void {
  lightbox.on("contentLoad", (e) => {
    const { content } = e;
    if (content.type !== "video") return;
    e.preventDefault();
    const data = content.data as VideoSlide;
    const video = document.createElement("video");
    video.className = "pswp__video";
    video.src = data.videoSrc;
    video.poster = data.posterSrc;
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    if (data.alt) video.setAttribute("aria-label", data.alt);
    // PhotoSwipe types its content as an image or a div; any element works.
    content.element = video as unknown as HTMLDivElement;
    content.state = "loaded";
  });
  lightbox.on("contentActivate", ({ content }) => {
    if (content.element instanceof HTMLVideoElement) {
      // Browsers may refuse to start with sound; then the play button does.
      content.element.play().catch(() => {});
    }
  });
  lightbox.on("contentDeactivate", ({ content }) => {
    if (content.element instanceof HTMLVideoElement) content.element.pause();
  });
  lightbox.on("contentDestroy", ({ content }) => {
    if (content.element instanceof HTMLVideoElement) {
      content.element.pause();
      content.element.removeAttribute("src");
      content.element.load();
    }
  });
  // The player's own controls: PhotoSwipe must not turn their clicks and drags
  // into swipes. With a mouse that's the whole video (arrows and keys still
  // switch slides); on touch screens only the control bar at the bottom, so a
  // swipe across the picture still goes to the next slide.
  lightbox.on("pointerDown", (e) => {
    const target = e.originalEvent.target;
    if (!(target instanceof HTMLVideoElement)) return;
    const bar = target.getBoundingClientRect().bottom - 72;
    if (e.originalEvent.pointerType === "mouse" || e.originalEvent.clientY > bar) {
      e.preventDefault();
    }
  });
}
