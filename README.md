# CHATVERSE

Website chat realtime bằng HTML/CSS/JavaScript, Supabase và WebRTC.

## Tính năng
- Đăng ký / đăng nhập email + mật khẩu (Supabase Auth).
- Mỗi tài khoản tự có ID dạng `CV-XXXXXXXX`.
- Tìm tài khoản và gửi lời mời kết bạn bằng ID.
- Tạo nhóm chat, thêm thành viên bằng ID.
- Nhắn tin realtime.
- Voice chat WebRTC trong cuộc trò chuyện (mesh, phù hợp nhóm nhỏ).

## 1. Tạo backend Supabase
1. Vào https://supabase.com/ và tạo project.
2. Mở **SQL Editor**, dán toàn bộ `supabase-schema.sql`, bấm Run.
3. Vào **Project Settings → API** (hoặc API Keys), lấy Project URL và Publishable key.
4. Mở `app.js`, thay:
   - `YOUR_SUPABASE_URL`
   - `YOUR_SUPABASE_PUBLISHABLE_KEY`
5. Trong **Authentication → URL Configuration**, thêm domain website của bạn vào Site URL / Redirect URLs.
6. Nếu muốn test đăng ký nhanh, có thể tắt email confirmation trong Auth settings; khi chạy thật nên bật xác nhận email.

> Chỉ dùng Publishable key ở trình duyệt. TUYỆT ĐỐI không đưa Secret key hoặc service_role key vào HTML/JavaScript hay GitHub.

## 2. Chạy thử trên máy
Vì `app.js` dùng JavaScript module, hãy chạy qua local web server (không mở file bằng `file://`).
- VS Code: cài extension Live Server, nhấn **Go Live**.
- Hoặc Python: `python -m http.server 5500`, rồi mở http://localhost:5500.

## 3. Đưa lên GitHub
1. Tạo repository mới.
2. Upload `index.html`, `style.css`, `app.js`, `supabase-schema.sql`, `README.md`.
3. Không commit mật khẩu hay Secret key. Publishable key được thiết kế để dùng ở client, nhưng dữ liệu vẫn phải được bảo vệ bằng RLS.

## 4. Deploy lên Render
1. Đẩy mã nguồn lên GitHub.
2. Render → **New → Static Site** → chọn repository.
3. Build Command: để trống.
4. Publish Directory: `.`
5. Deploy. Thêm URL Render vào Supabase Auth URL Configuration.

## 5. Voice chat
- Voice chat cần HTTPS (Render cung cấp HTTPS) hoặc localhost.
- Trình duyệt sẽ hỏi quyền microphone.
- WebRTC dùng STUN công khai để tìm đường kết nối. Một số mạng cần TURN server riêng để gọi ổn định.
- Bản mẫu dùng mesh WebRTC, nên chỉ phù hợp voice room nhỏ. Muốn mở rộng cần SFU như LiveKit hoặc mediasoup.
- Không chia sẻ link voice channel công khai; schema cấu hình private channel và RLS cho thành viên cuộc trò chuyện.

## Lưu ý / giới hạn bản mẫu
- Đây là starter project để bạn triển khai và tiếp tục phát triển, chưa phải sản phẩm thương mại hoàn chỉnh.
- Danh sách yêu cầu kết bạn hiện thông báo bằng hộp thoại khi người nhận đăng nhập.
- Tin nhắn văn bản, nhóm và voice chat cần cấu hình Supabase đúng trước khi hoạt động.
- Nên bổ sung chặn người dùng, báo cáo, giới hạn spam, phân trang tin nhắn, thông báo và kiểm thử bảo mật trước khi mở rộng công khai.

## Cấu trúc
```text
chatverse/
├── index.html
├── style.css
├── app.js
├── supabase-schema.sql
└── README.md
```
