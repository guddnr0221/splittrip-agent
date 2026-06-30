# GitHub Pages 배포 체크리스트

## 1. 새 저장소 만들기

1. GitHub에서 `New repository`를 선택합니다.
2. 저장소 이름은 `splittrip-agent`를 권장합니다.
3. 공개 URL 제출을 위해 `Public`으로 생성합니다.

## 2. 파일 올리기

이 배포 폴더 또는 `SplitTrip_GitHubPages_배포파일.zip`의 **내용물 전체**를 저장소 최상위에 올립니다. ZIP 파일 자체를 올리는 것이 아닙니다.

필수 항목:

- `index.html`, `styles.css`, `app.js`
- `favicon.svg`, `site.webmanifest`, `.nojekyll`

## 3. Pages 켜기

1. 저장소의 `Settings → Pages`로 이동합니다.
2. Source에서 `Deploy from a branch`를 선택합니다.
3. Branch는 `main`, 폴더는 `/(root)`를 선택하고 저장합니다.
4. 1~3분 뒤 표시되는 공개 URL을 시크릿 창과 휴대폰에서 확인합니다.

예상 URL: `https://사용자명.github.io/splittrip-agent/`

## 4. 제출 전 실기기 확인

- 공개 URL이 로그인 없이 열리는지
- 새 영수증 추가와 삭제가 동작하는지
- 수량·개당 가격·품목 총액이 서로 자동 계산되는지
- 품목별 수량 배분과 최종 송금액 계산이 정확한지
- Word 제출본의 URL 칸을 실제 공개 URL로 교체했는지

## 주의

입력 내용은 사용자의 브라우저에 저장됩니다. 공용 PC에서는 테스트 후 `새 정산`으로 데이터를 지우세요.
