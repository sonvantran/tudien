# Học Đều — từ điển tự học offline

Từ điển đầy đủ kèm công cụ học: tra từ, thẻ nhớ ôn lặp lại, luyện tập trắc nghiệm, sổ từ và theo dõi tiến độ. Tra từ, thẻ nhớ và luyện tập chạy hoàn toàn trên máy bạn, không cần internet. Riêng mục **Dịch câu** (dịch cả câu/đoạn văn) cần kết nối mạng.

| Ngôn ngữ | Số mục | Nguồn |
|---|---|---|
| Tiếng Anh | ~172.000 | ECDICT (MIT). Có nhãn IELTS, TOEFL, GRE, CET-4/6, Oxford 3000 |
| Tiếng Nhật | ~213.000 | JMdict, gắn cấp JLPT N5–N1 từ danh sách JLPT mở |
| Tiếng Trung | ~124.000 | CC-CEDICT, gắn cấp HSK 2.0 (1–6) và HSK 3.0 (1–7) |
| Tiếng Hàn | ~106.000 | KENGDIC Hàn–Anh (CC BY-SA 3.0 / LGPL 2.0). Có Hán tự, phiên âm Romaja và nhãn cấp A/B/C |
| Tiếng Việt | ~54.000 | VNEDICT Việt–Anh (Paul Denisowski, 2019) |

## Chạy trong VS Code

1. Cài [Node.js](https://nodejs.org) bản 18 trở lên (kiểm tra bằng `node -v`).
2. Trong VS Code chọn **File → Open Folder** và mở thư mục này.
3. Mở terminal (**Ctrl+`**) và gõ `npm start`. Hoặc nhấn **F5**, hoặc **Ctrl+Shift+B**.
4. Mở http://localhost:3000. Lần đầu server mất vài giây để nạp dữ liệu vào bộ nhớ (cần khoảng 1 GB RAM trống).

Đổi cổng: `PORT=4000 npm start` (Windows PowerShell: `$env:PORT=4000; npm start`).
Không cần `npm install`, dự án không có thư viện phụ thuộc.

## Cách dùng

- **Tiếng Việt**: gõ từ Việt (có hoặc không dấu) để xem nghĩa tiếng Anh, hoặc gõ từ Anh để tìm từ Việt tương ứng. Bấm nút Anh/Nhật/Trung bên dưới nghĩa để tra tiếp trong từ điển đó.
- **Tra từ**: tiếng Anh gõ từ hoặc dạng chia ("negotiated" ra "negotiate"); tiếng Nhật gõ kanji, kana, romaji hoặc nghĩa tiếng Anh; tiếng Trung gõ chữ Hán, pinyin có hoặc không dấu, hoặc nghĩa tiếng Anh. Bấm ngôi sao để lưu vào sổ từ và ghi nghĩa tiếng Việt của riêng bạn.
- **Tiếng Hàn**: gõ chữ Hàn (Hangul), phiên âm Latinh (`sarang`), Hán tự (`學校`) hoặc nghĩa tiếng Anh (`love`). Gõ dạng chia như `먹었어요` sẽ gợi ý `먹다`. Phiên âm Romaja là gần đúng (có nối âm đơn giản, chưa xét mọi quy tắc đồng hóa).
- **Dịch câu**: chọn ngôn ngữ nguồn (hoặc để tự nhận diện) và ngôn ngữ đích (Việt, Anh, Nhật, Trung, Hàn), dán câu/đoạn văn tối đa 5000 ký tự rồi bấm Dịch hoặc Ctrl + Enter. Có nút nghe, sao chép và đổi chiều. Nếu nhập một từ ngắn, có nút tra thẳng trong từ điển tương ứng.
- **Thẻ nhớ**: chọn bộ từ (IELTS, Oxford 3000, JLPT N5–N1, HSK 1–6...), lật thẻ và tự chấm Quên / Khó / Nhớ. Thẻ nhớ được hẹn ôn lại sau 1, 2, 4, 8, 16, 30 ngày. Phím tắt: cách để lật, 1/2/3 để chấm.
- **Luyện tập**: 10 câu trắc nghiệm từ bộ từ đã chọn, hai chiều (từ sang nghĩa, nghĩa sang từ). Câu sai quay lại thẻ nhớ.
- **Sổ từ & tiến độ**: chuỗi ngày học, XP, biểu đồ 7 ngày, sao lưu và khôi phục tiến độ.

Tiến độ, sổ từ và ghi chú lưu trong trình duyệt (localStorage). Dùng nút "Tải bản sao lưu" nếu bạn đổi trình duyệt hoặc máy.

## Dịch câu: nguồn dịch và cấu hình

Server gọi dịch vụ dịch trực tuyến theo thứ tự: LibreTranslate tự dựng (nếu bạn đặt biến `LIBRETRANSLATE_URL`) → cổng dịch web của Google (không cần khóa API, không chính thức nên có thể bị giới hạn hoặc thay đổi) → MyMemory (giới hạn lượt dùng miễn phí mỗi ngày). Không dịch được thì giao diện báo lỗi, phần từ điển vẫn dùng bình thường.

Muốn dịch offline hoàn toàn, tự chạy [LibreTranslate](https://github.com/LibreTranslate/LibreTranslate) trên máy rồi chạy: `LIBRETRANSLATE_URL=http://localhost:5000 npm start` (PowerShell: `$env:LIBRETRANSLATE_URL="http://localhost:5000"; npm start`). Cần kiểm tra bản LibreTranslate của bạn đã có đủ các cặp ngôn ngữ cần dùng. Không gửi nội dung nhạy cảm qua các dịch vụ trực tuyến.

## Giới hạn cần biết

- **Tiếng Hàn**: KENGDIC do cộng đồng đóng góp nên còn lẫn nghĩa sai hoặc lạ (ví dụ nghĩa đầu của 먹다 có thể là "Eat" kèm các nghĩa ít dùng). Nhãn cấp A/B/C là nhãn trong KENGDIC, chưa phải danh sách TOPIK chính thức; chỉ khoảng 5.000 từ có nhãn cấp. Chưa có phân tích động từ chia đầy đủ.

- **Nghĩa tiếng Việt là gợi ý tra ngược.** Từ Anh, Nhật, Trung chưa có từ điển sang tiếng Việt, nên ứng dụng lấy nghĩa tiếng Anh của từ rồi tìm trong VNEDICT các từ Việt có cùng nghĩa. Cách này phủ khoảng 90–99% bộ IELTS, Oxford 3000, JLPT và khoảng 65–70% HSK, nhưng có thể chưa sát nghĩa (ví dụ 便宜 'rẻ' có thể ra 'tiện'). Gặp từ chưa đúng, hãy ghi nghĩa của bạn vào ô "Nghĩa tiếng Việt của bạn", ghi chú đó luôn được ưu tiên.
- **Không có danh sách TOEIC chính thức miễn phí.** Nhóm TOEIC dùng Oxford 3000, CET-4/6 và các dải tần suất làm từ vựng nền tảng. Bạn thêm từ TOEIC của mình vào sổ từ để học riêng.
- Định nghĩa tiếng Anh trong ECDICT lấy từ WordNet nên nghĩa đầu tiên không phải lúc nào cũng là nghĩa thông dụng nhất. Xem đủ các nghĩa ở trang chi tiết.
- Phát âm dùng giọng đọc có sẵn của trình duyệt. Máy chưa cài giọng Nhật hoặc Trung có thể không phát được.

## Cấu trúc

```
server.mjs            server tra từ (Node, không phụ thuộc gói ngoài)
public/               giao diện web (index.html, style.css, app.js)
data/                 en.json, ja.json, zh.json, ko.json, vi.json đã gộp sẵn
scripts/build_data.py gộp lại dữ liệu từ nguồn gốc (tùy chọn)
```

## Tạo lại dữ liệu (tùy chọn)

Tải nguồn vào thư mục `src/` rồi chạy `python3 scripts/build_data.py src`:
`stardict.db` (ECDICT release), `jmdict-eng-*.json` (jmdict-simplified), `cedict.json` (gói npm `cedict-json`), `hsk.json` (drkameleon/complete-hsk-vocabulary), `n1.csv`–`n5.csv` (jamsinclair/open-anki-jlpt-decks), `vnedict.txt` (VNEDICT), `kengdic.tsv` (KENGDIC, `raw.githubusercontent.com/garfieldnate/kengdic/master/kengdic.tsv`). Chỉ tạo lại riêng tiếng Hàn: `python3 scripts/build_data.py src ko`. Tên các tệp và đường dẫn chi tiết nằm ở đầu `scripts/build_data.py`.

## Giấy phép dữ liệu

VNEDICT theo giấy phép của tác giả (Paul Denisowski, denisowski.org). JMdict và CC-CEDICT theo CC BY-SA (cần ghi nguồn khi chia sẻ lại). ECDICT theo MIT. KENGDIC theo CC BY-SA 3.0 hoặc LGPL 2.0 (cần ghi nguồn khi chia sẻ lại). Các danh sách HSK và JLPT theo giấy phép của từng kho gốc.
