# Quy trình làm việc với Git

Repo: **yt-mindmap**

## Mô hình branch

```
main      ← luôn chạy được, chỉ nhận merge từ develop (hoặc hotfix)
 └ develop ← nhánh tích hợp, mọi thay đổi đều đi qua đây
    └ feature/<ten-ngan>   ← làm tính năng mới
    └ fix/<ten-ngan>       ← sửa lỗi
    └ hotfix/<ten-ngan>    ← sửa gấp, tách từ main
```

- `main`: bản ổn định. Không commit trực tiếp, không thử nghiệm ở đây.
- `develop`: nơi làm việc hằng ngày, gom các thay đổi trước khi phát hành.
- `feature/*`, `fix/*`: nhánh ngắn hạn cho từng việc, xong thì merge vào `develop`.

## Quy trình chuẩn

```bash
# 1. Bắt đầu việc mới từ develop
git switch develop
git pull --ff-only            # nếu đã có remote
git switch -c feature/export-mindmap

# 2. Làm việc, commit theo từng bước nhỏ
git add -A
git commit -m "feat(map): export mind map as PNG"

# 3. Đồng bộ develop mới nhất trước khi merge
git switch develop
git merge feature/export-mindmap
git branch -d feature/export-mindmap

# 4. Phát hành: đưa develop lên main
git switch main
git merge --no-ff develop
git tag -a v0.2.0 -m "Export + tests"
```

## Khi có lỗi trên main

```bash
git switch main
git switch -c hotfix/<ten-loi>
# sửa lỗi
git commit -m "fix: ..."
git switch main && git merge --no-ff hotfix/<ten-loi>
git switch develop && git merge hotfix/<ten-loi>
git branch -d hotfix/<ten-loi>
```

## Quy ước commit

`<type>(<scope>): <mô tả ngắn>` — type: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.

Scope gợi ý: `backend`, `ai`, `map`, `ui`, `session`, `cache`.

## Lưu ý

- **Không commit** `.env`, `backend/data/`, `node_modules/`, `venv/`, `dist/` (đã có trong `.gitignore`).
- `backend/.env` chứa `GEMINI_API_KEY` — chỉ dùng `backend/.env.example` làm mẫu.
- Trước khi merge vào `main`: chạy `npm run lint`, `npm run build` (frontend) và kiểm tra backend khởi động được.
