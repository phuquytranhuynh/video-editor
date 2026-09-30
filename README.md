# Video Editor Local

Phần mềm dựng video chạy **hoàn toàn trên máy của bạn** (không cần server/VPS, không upload dữ liệu). Bố cục tham khảo Adobe Premiere Pro: Project · Source · Program · Properties · Tools · Timeline · Audio meter.

Được đóng gói thành ứng dụng desktop bằng **Electron** (Windows / macOS / Linux). Mã giao diện là HTML/CSS/JS thuần, không cần build.

## Chạy phần mềm

```bash
npm install      # tải Electron (chỉ lần đầu)
npm start        # mở phần mềm
```

Đóng gói bản cài đặt: `npm run dist:win` / `dist:mac` / `dist:linux` (kết quả trong `dist/`).

> Cần thử nhanh không cài gì? Mở `index.html` bằng Chrome/Edge cũng chạy được (không cần server).

## Tính năng

| Yêu cầu | Cách dùng |
|---|---|
| Vùng làm việc kiểu Premiere | Project / Source / Program / Properties / Timeline, kéo thanh chia để đổi kích thước panel |
| Thiết lập thông số đầu ra | Khi khởi động: **Dự án mới** (TikTok, Shorts, Reels, YouTube 720p/1080p/4K, 1:1, 4:5, tuỳ chỉnh). Đổi sau: *Sequence → Thiết lập Sequence* |
| Xuất video thông số tuỳ chỉnh | **Xuất video** (Ctrl+M): preset TikTok / Shorts / YouTube…, tuỳ chỉnh kích thước, fps, bitrate, định dạng MP4/WebM, cách khớp khung, phạm vi (toàn bộ / work area) |
| Quản lý source | Project panel: nhập (Ctrl+I hoặc kéo thả file), tìm kiếm, dạng list/icon, nhấp đúp để xem ở Source monitor, đặt In/Out (I/O), Insert (,) / Overwrite (.) |
| Vùng edit | Kéo media từ Project vào timeline (Ctrl khi thả = Insert). Nhiều track video/audio, snap, marker |
| Cắt / kéo thả / dài–ngắn | Razor (C) hoặc Ctrl+K; kéo clip; kéo cạnh clip để dài/ngắn; Ripple (B); xoá & dồn (Shift+Del); đổi tốc độ trong Properties |
| Fade in/out 2 đầu | Kéo chấm tròn ở góc clip, hoặc Properties, hoặc Effects → Fade |
| Fade giữa 2 clip sát nhau | Effects → Video Transitions (Cross Dissolve, Dip to Black/White, Wipe, Slide, Push): nhấp khi chọn clip, hoặc kéo thả lên clip |
| Tách audio khỏi video | Chuột phải clip → *Tách audio (Unlink)*; audio & video sau đó chỉnh riêng. *Extract Audio* tạo audio riêng |
| % hiển thị, vị trí ngang/dọc | Properties → Motion (Vị trí X/Y, Hiển thị %, Xoay, Độ mờ, Fit/Fill/100%, căn trái/giữa/phải…) hoặc kéo trực tiếp khung điều khiển trong Program monitor |
| Text & Shape | Text & Shape panel hoặc công cụ T / R. Chỉnh font (kể cả nạp font từ file), màu chữ, nền, viền, bóng; shape: chữ nhật, bo góc, elip, tam giác, sao, đường thẳng, mũi tên (màu nền, màu viền/line) |
| Zoom in/out nhanh, mượt | Effects → Zoom nhanh (ease in-out), hoặc Properties → Zoom nhanh (mức %, vị trí đầu/cuối clip, thời gian, tâm zoom) |

### Tính năng kiểu CapCut (Effects panel → tab Caption / SFX / Hiệu ứng)

| Tính năng | Cách dùng |
|---|---|
| **Caption / keyword nổi bật** | Tab **Caption**: 9 kiểu có sẵn (phụ đề cam, keyword trắng pop, keyword + khung highlight cam, hộp trắng bo tròn, chữ nảy từng ký tự, lặp hình toả ra, gõ chữ, đập xuống vàng Impact, neon). Bấm **+** để thêm tại playhead, **Áp** để đổi kiểu caption đang chọn |
| Highlight từ khoá | Gõ `*từ khoá*` (giữa 2 dấu sao) → tô khung màu quét vào, chỉnh màu/bo góc ở Properties. Nút "✱ Tô highlight phần đang chọn" |
| Animation cho mọi clip hình/chữ | Properties → *Hiệu ứng xuất hiện*: 13 kiểu vào (fade, pop, slam, zoom, trượt, xoay, blur, rơi nảy, glitch) + 4 kiểu riêng cho chữ (gõ chữ, từng ký tự nảy/bật, từng từ bật), 10 kiểu ra, 8 kiểu lặp (pulse, lơ lửng, rung, lắc, nhấp nháy, sóng chữ, echo) |
| Nhập caption hàng loạt | *Nhập phụ đề hàng loạt…*: dán từng dòng hoặc file `.srt`, chọn kiểu, tự chia thời lượng |
| **Sound effect đúng lúc keyword** | 17 SFX tự tổng hợp (pop, ting, ding, whoosh, swoosh, whip, impact, glitch, gõ phím…, không bản quyền). Bật *Tự chèn SFX* ở tab Caption: mỗi caption tạo ra sẽ có clip SFX trên track audio, căn để "đỉnh" âm thanh trùng lúc chữ xuất hiện. SFX **đi theo** caption khi kéo/di chuyển; đổi SFX, độ lệch, âm lượng ở Properties → *Sound effect*. Tab **SFX**: nghe thử, thêm tại playhead hoặc kéo thả |
| **33 chuyển cảnh** | Tab Hiệu ứng, chia nhóm: cơ bản (dissolve, dip, flash), trượt & đẩy (slide/push 4 hướng, whip pan mờ), quét & hình khối (wipe, chéo, iris, clock, blinds, mở cửa), zoom & xoay (zoom in/out, spin, flip, blur), hiệu ứng (glitch, pixelate, shake). Tự chèn SFX tại điểm chuyển cảnh (tắt được) |
| B-roll dạng thẻ | Clip video/ảnh ở track trên: Properties → *Thẻ / khung* (viền màu, bo góc, đổ bóng, làm mờ cảnh nền phía dưới) hoặc nút "Áp kiểu B-roll" |

Phím tắt: menu **Trợ giúp → Phím tắt**.

## Lưu ý kỹ thuật

- Dự án được **tự động lưu** trong máy (IndexedDB, kèm cả file media); lần mở sau chọn *Mở lại dự án gần nhất*. Ngoài ra có thể lưu file dự án `.json` (chỉ chứa timeline, không chứa media).
- Xuất video **theo thời gian thực** bằng MediaRecorder (thời gian xuất ≈ thời lượng video). Không cần giữ cửa sổ ở phía trước khi dùng bản Electron.
- **MP4 (H.264 + AAC)** trong bản desktop: Electron chỉ ghi được WebM nên phần mềm ghi WebM rồi chuyển sang MP4 bằng **ffmpeg** (đi kèm qua gói `ffmpeg-static`, hoặc dùng `ffmpeg` có sẵn trong PATH). Nếu không có ffmpeg, tuỳ chọn MP4 sẽ không hiện và bạn xuất WebM. Xuất WebM cũng được remux bằng ffmpeg để có thời lượng/seek đúng.
- Định dạng nhập phụ thuộc codec của Chromium/Electron (MP4 H.264, WebM, MOV H.264, MP3, WAV, AAC, PNG, JPG…).
- Chạy trên Chrome/Edge (không qua Electron) thì định dạng xuất phụ thuộc trình duyệt (Chrome mới hỗ trợ MP4 trực tiếp).

## Cấu trúc

```
index.html  main.js  preload.js  package.json
css/style.css
js/util.js icons.js store.js media.js anim.js sfx.js player.js timeline.js monitor.js
   panels.js inspector.js dialogs.js exporter.js persist.js app.js
```
