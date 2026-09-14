# Icon source

The app icon and tray portraits are extracted directly from the existing `assets/anim/待机呼吸休闲.webm` animation at 0.3 seconds. The character artwork is preserved with its original alpha channel. No generative redraw is used.

The application icon includes the character's full figure. The 22px tray icon and its 44px Retina variant crop the head and shoulders for recognition at small sizes. The 512px app-icon canvas is an export format requirement; it does not change the resolution or runtime size of any animation.

To regenerate with FFmpeg and its alpha-capable libvpx-vp9 decoder, run from the repository root:

```sh
ffmpeg -c:v libvpx-vp9 -ss 0.3 -i assets/anim/待机呼吸休闲.webm -frames:v 1 -vf 'crop=260:304:50:40,scale=438:512:flags=lanczos,pad=512:512:37:0:color=0x00000000' -y desktop/ui/icon.png
ffmpeg -c:v libvpx-vp9 -ss 0.3 -i assets/anim/待机呼吸休闲.webm -frames:v 1 -vf 'crop=220:220:70:45,scale=22:22:flags=lanczos' -y desktop/ui/tray.png
ffmpeg -c:v libvpx-vp9 -ss 0.3 -i assets/anim/待机呼吸休闲.webm -frames:v 1 -vf 'crop=220:220:70:45,scale=44:44:flags=lanczos' -y desktop/ui/tray@2x.png
```
