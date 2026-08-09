# 제출물 — NHN GAME × AI HACKATHON (NAN 2026) 사전 과제

접수 폼의 항목 이름과 이 폴더의 파일 이름을 **1:1로 맞춰 두었다.**
아래 표의 순서대로 올리면 된다.

| 접수 폼 항목 | 올릴 것 | 필수 |
|---|---|---|
| 게임 소개 및 설명 문서 | `QUARANTINE_No3_게임소개및설명문서.pdf` (8쪽) | ✔ |
| AI 활용 기술 문서 | `QUARANTINE_No3_AI활용기술문서.pdf` (16쪽) | ✔ |
| 팀 소개 문서 | **올리지 않는다** — 2인 이상 팀만 해당. 이 작품은 1인 개발 | |
| 포트폴리오 및 참고자료 | **올리지 않는다** — 선택 사항 | |

## 폼에 직접 입력하는 것

```
플레이 (빌드)   https://yunseok-map.github.io/zombie_games/
전체 소스       https://github.com/yunseok-map/zombie_games
플레이 영상     https://www.youtube.com/watch?v=TH71shPSNqs      (60초 · 공개)
```

세 링크는 두 PDF 안에도 들어 있다 (게임 소개 문서 §1 「링크」).

## 제출 전 마지막 확인

- [ ] 영상이 **공개 또는 일부공개**인가 — 비공개면 심사자가 못 본다
- [ ] 저장소가 **공개**인가 · 커밋 기록이 그대로인가
- [ ] 위 두 PDF 를 열어 **글자가 깨지지 않는가** (한글 폰트)
- [ ] 접수 마감 **2026-08-10**

## 이 PDF 를 고치려면

**PDF 를 직접 고치지 않는다.** 원본은 HTML 이고, 저장소 루트에서 다시 뽑는다.

```bash
npm run pdf        # docs/submission_*.html → 이 폴더에 PDF 2개
```

- `docs/submission_game_overview.html` → 게임 소개 및 설명 문서
- `docs/submission_ai_tech.html` → AI 활용 기술 문서

뽑고 나면 `node tools/check_pdf_layout.mjs` 로 쪽마다 하단이 얼마나 비었는지 볼 수 있다.
`npm run pdf` 자체가 이미 **이미지 깨짐 · 가로 넘침 · 로드 실패**를 검사한다 —
"배경 그래픽" 체크를 빠뜨린 채 손으로 인쇄해서 표가 통째로 하얗게 나오는 사고를 막으려고
자동화한 것이다.
